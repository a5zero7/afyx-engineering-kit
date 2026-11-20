/**
 * AFYX-native Kubernetes Manifest Intelligence Extractor (AFYX-211).
 *
 * Provides static extraction for Kubernetes YAML manifests:
 * - Workloads: Deployment, StatefulSet, DaemonSet, Pod, Job, CronJob
 * - Networking: Service, Ingress
 * - Configuration & Storage: ConfigMap, Secret, PersistentVolumeClaim, StorageClass
 * - Namespace isolation & multi-document manifests (---)
 *
 * Explicit Label Selector Contract:
 * - Service-to-Pod linking strictly matches `spec.selector` against `spec.template.metadata.labels`
 *   in matching namespaces, never linking by name alone.
 * - Ingress backends link to Service in matching namespace.
 * - Volume mounts link to ConfigMap / Secret in matching namespace.
 *
 * Secret-Safe Contract:
 * - Never persists `.data` or `.stringData` secret values.
 * - Redacts all sensitive values to "[REDACTED]".
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';
import { parseYamlWithLocations } from './yaml-utils';
import { isCicdFile } from './cicd-extractor';
import { isDockerRelatedFile } from './docker-extractor';
import { isOpenApiFile } from './openapi-extractor';

export function isKubernetesFile(filePath: string, source?: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.yaml' && ext !== '.yml') return false;

  // Exclude other recognized YAML formats
  if (isCicdFile(filePath) || isDockerRelatedFile(filePath) || isOpenApiFile(filePath, source)) {
    return false;
  }

  if (source) {
    return /\bapiVersion:\s*\S+/m.test(source) && /\bkind:\s*\S+/m.test(source);
  }

  // Path heuristic when source is omitted
  return /(?:k8s|kubernetes|manifests|deploy|charts|helm)\b/i.test(filePath);
}

interface ParsedK8sDoc {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
  labels: Record<string, string>;
  selector?: Record<string, string>;
  podLabels?: Record<string, string>;
  lineNum: number;
  nodeId: string;
  data: any;
}

export class KubernetesExtractor {
  private filePath: string;
  private source: string;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private unresolvedReferences: UnresolvedReference[] = [];
  private errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();

    try {
      const fileNode = this.createFileNode();
      const rawDocs = this.splitMultiDoc(this.source);
      const parsedDocs: ParsedK8sDoc[] = [];

      for (const rawDoc of rawDocs) {
        if (!rawDoc.content.trim()) continue;
        const parsed = parseYamlWithLocations(rawDoc.content);
        if (!parsed.data || typeof parsed.data !== 'object') continue;

        const doc = parsed.data;
        const apiVersion = String(doc.apiVersion || '').trim();
        const kind = String(doc.kind || '').trim();
        const metadata = doc.metadata || {};
        const name = String(metadata.name || '').trim();
        const namespace = String(metadata.namespace || 'default').trim();

        if (!kind || !name) continue;

        const labels: Record<string, string> =
          metadata.labels && typeof metadata.labels === 'object' ? { ...metadata.labels } : {};

        // Extract workload pod template labels & selectors
        let selector: Record<string, string> | undefined;
        let podLabels: Record<string, string> | undefined;

        if (doc.spec) {
          if (doc.spec.selector && typeof doc.spec.selector === 'object') {
            if (doc.spec.selector.matchLabels) {
              selector = { ...doc.spec.selector.matchLabels };
            } else if (!Array.isArray(doc.spec.selector)) {
              selector = { ...doc.spec.selector };
            }
          }
          if (doc.spec.template && doc.spec.template.metadata && doc.spec.template.metadata.labels) {
            podLabels = { ...doc.spec.template.metadata.labels };
          }
        }

        const docLineNum = rawDoc.startLine;
        const qualName = `${namespace}/${kind}/${name}`;
        const nodeId = generateNodeId(this.filePath, 'component', qualName, docLineNum);

        // Security check: Redact secret data
        let signature = `${kind}: ${name} (namespace: ${namespace}, apiVersion: ${apiVersion})`;
        if (kind === 'Secret') {
          signature += ' [REDACTED_SECRET_PAYLOAD]';
        }

        const node: Node = {
          id: nodeId,
          kind: 'component',
          name,
          qualifiedName: `${this.filePath}#${qualName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: docLineNum,
          endLine: rawDoc.endLine,
          startColumn: 0,
          endColumn: 0,
          signature,
          updatedAt: Date.now(),
        };

        this.nodes.push(node);
        this.edges.push({
          source: fileNode.id,
          target: nodeId,
          kind: 'contains',
        });

        parsedDocs.push({
          apiVersion,
          kind,
          name,
          namespace,
          labels,
          selector,
          podLabels,
          lineNum: docLineNum,
          nodeId,
          data: doc,
        });
      }

      // Cross-document relationship linking within manifest
      this.linkRelationships(parsedDocs);
    } catch (err) {
      this.errors.push({
        message: `Kubernetes extraction error in ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'k8s_parse_error',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private createFileNode(): Node {
    const lines = this.source.split(/\r?\n/);
    const fileName = path.basename(this.filePath);
    const id = generateNodeId(this.filePath, 'file', fileName, 1);

    const fileNode: Node = {
      id,
      kind: 'file',
      name: fileName,
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: 'yaml',
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 0,
      endColumn: (lines[lines.length - 1] || '').length,
      updatedAt: Date.now(),
    };

    this.nodes.push(fileNode);
    return fileNode;
  }

  private splitMultiDoc(source: string): Array<{ content: string; startLine: number; endLine: number }> {
    const lines = source.split(/\r?\n/);
    const docs: Array<{ content: string; startLine: number; endLine: number }> = [];
    let curLines: string[] = [];
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim() === '---') {
        if (curLines.length > 0) {
          docs.push({
            content: curLines.join('\n'),
            startLine,
            endLine: i,
          });
          curLines = [];
        }
        startLine = i + 2;
      } else {
        curLines.push(line);
      }
    }

    if (curLines.length > 0) {
      docs.push({
        content: curLines.join('\n'),
        startLine,
        endLine: lines.length,
      });
    }

    return docs;
  }

  private linkRelationships(docs: ParsedK8sDoc[]): void {
    for (const doc of docs) {
      // 1. Service -> Workload linking via explicit label selector matching
      if (doc.kind === 'Service' && doc.selector && Object.keys(doc.selector).length > 0) {
        const selectorKeys = Object.keys(doc.selector);

        for (const candidate of docs) {
          // Strict contract: matching namespace, workload pod labels match ALL selector entries
          if (candidate.namespace !== doc.namespace || !candidate.podLabels) continue;

          const allMatch = selectorKeys.every(
            (k) => candidate.podLabels![k] === doc.selector![k]
          );

          if (allMatch) {
            this.edges.push({
              source: doc.nodeId,
              target: candidate.nodeId,
              kind: 'references',
            });
            this.unresolvedReferences.push({
              fromNodeId: doc.nodeId,
              referenceName: `${candidate.namespace}/${candidate.kind}/${candidate.name}`,
              referenceKind: 'references',
              line: doc.lineNum,
              column: 0,
            });
          }
        }
      }

      // 2. Ingress -> Service backend routing
      if (doc.kind === 'Ingress' && doc.data.spec && doc.data.spec.rules) {
        const rules = Array.isArray(doc.data.spec.rules) ? doc.data.spec.rules : [];
        for (const rule of rules) {
          const http = rule && rule.http;
          const paths = http && Array.isArray(http.paths) ? http.paths : [];
          for (const p of paths) {
            const svcName =
              p.backend?.service?.name ||
              p.backend?.serviceName;
            if (svcName) {
              const targetService = docs.find(
                (d) => d.kind === 'Service' && d.name === svcName && d.namespace === doc.namespace
              );
              if (targetService) {
                this.edges.push({
                  source: doc.nodeId,
                  target: targetService.nodeId,
                  kind: 'references',
                });
              }
              this.unresolvedReferences.push({
                fromNodeId: doc.nodeId,
                referenceName: `${doc.namespace}/Service/${svcName}`,
                referenceKind: 'references',
                line: doc.lineNum,
                column: 0,
              });
            }
          }
        }
      }

      // 3. Workload volume mounts -> ConfigMap / Secret
      if (doc.data.spec?.template?.spec?.volumes && Array.isArray(doc.data.spec.template.spec.volumes)) {
        for (const vol of doc.data.spec.template.spec.volumes) {
          if (vol.configMap?.name) {
            const cmName = vol.configMap.name;
            const targetCm = docs.find(
              (d) => d.kind === 'ConfigMap' && d.name === cmName && d.namespace === doc.namespace
            );
            if (targetCm) {
              this.edges.push({
                source: doc.nodeId,
                target: targetCm.nodeId,
                kind: 'references',
              });
            }
            this.unresolvedReferences.push({
              fromNodeId: doc.nodeId,
              referenceName: `${doc.namespace}/ConfigMap/${cmName}`,
              referenceKind: 'references',
              line: doc.lineNum,
              column: 0,
            });
          }
          if (vol.secret?.secretName) {
            const secName = vol.secret.secretName;
            const targetSec = docs.find(
              (d) => d.kind === 'Secret' && d.name === secName && d.namespace === doc.namespace
            );
            if (targetSec) {
              this.edges.push({
                source: doc.nodeId,
                target: targetSec.nodeId,
                kind: 'references',
              });
            }
            this.unresolvedReferences.push({
              fromNodeId: doc.nodeId,
              referenceName: `${doc.namespace}/Secret/${secName}`,
              referenceKind: 'references',
              line: doc.lineNum,
              column: 0,
            });
          }
        }
      }
    }
  }
}
