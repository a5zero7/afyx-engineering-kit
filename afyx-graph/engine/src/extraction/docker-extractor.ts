/**
 * AFYX-native Dockerfile and Docker Compose Intelligence Extractor (AFYX-207).
 *
 * Provides static extraction for:
 * - Dockerfile (`Dockerfile`, `Dockerfile.*`, `*.dockerfile`)
 * - Docker Compose (`docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`)
 *
 * Extracted Relationships:
 * - Base image dependencies (`FROM <image>`)
 * - Multi-stage build dependencies (`FROM ... AS <stage>`, `COPY --from=<stage>`)
 * - Build arguments & environment declarations (`ARG`, `ENV` - secret-safe)
 * - Compose services, images, and inter-service dependencies (`depends_on`)
 * - Port mappings, volumes, and network references
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';
import { parseYamlWithLocations } from './yaml-utils';

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth|credential/i;

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)(?::-[^}]*)?\}|\$([A-Z_][A-Z0-9_]*)/g;

export function isDockerRelatedFile(filePath: string): boolean {
  return isDockerfile(filePath) || isDockerCompose(filePath);
}

export function isDockerfile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === 'Dockerfile' || base.startsWith('Dockerfile.') || base.endsWith('.dockerfile');
}

export function isDockerCompose(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return (
    base.startsWith('docker-compose') ||
    base.startsWith('compose')
  ) && (base.endsWith('.yml') || base.endsWith('.yaml'));
}

export class DockerExtractor {
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

      if (isDockerfile(this.filePath)) {
        this.extractDockerfile(fileNode.id);
      } else if (isDockerCompose(this.filePath)) {
        this.extractCompose(fileNode.id);
      }
    } catch (err) {
      this.errors.push({
        message: `Docker extraction error in ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'docker_parse_error',
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
      language: isDockerfile(this.filePath) ? 'yaml' : 'yaml',
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 0,
      endColumn: (lines[lines.length - 1] || '').length,
      updatedAt: Date.now(),
    };

    this.nodes.push(fileNode);
    return fileNode;
  }

  private extractDockerfile(fileNodeId: string): void {
    const rawLines = this.source.split(/\r?\n/);
    const stages = new Map<string, string>(); // stageName -> nodeId
    let currentStageNodeId = fileNodeId;
    let currentStageName = '';

    // Handle backslash line continuations
    interface MergedLine {
      startLine: number;
      endLine: number;
      text: string;
    }
    const mergedLines: MergedLine[] = [];
    let accum = '';
    let startIdx = 1;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]!;
      if (!accum) startIdx = i + 1;

      if (line.trimEnd().endsWith('\\')) {
        accum += line.trimEnd().slice(0, -1) + ' ';
      } else {
        accum += line;
        mergedLines.push({ startLine: startIdx, endLine: i + 1, text: accum.trim() });
        accum = '';
      }
    }
    if (accum) {
      mergedLines.push({ startLine: startIdx, endLine: rawLines.length, text: accum.trim() });
    }

    for (const item of mergedLines) {
      const line = item.text;
      if (!line || line.startsWith('#')) continue;

      // Scan for environment variable references: ${VAR} or $VAR
      let envVarMatch: RegExpExecArray | null;
      const envPattern = /\$\{([A-Z0-9_]+)(?::-[^}]*)?\}|\$([A-Z_][A-Z0-9_]*)/g;
      while ((envVarMatch = envPattern.exec(line)) !== null) {
        const varName = envVarMatch[1] || envVarMatch[2];
        if (varName && varName !== 'AS' && !varName.startsWith('HTTP_') && !varName.startsWith('PATH')) {
          this.unresolvedReferences.push({
            fromNodeId: currentStageNodeId,
            referenceName: varName,
            referenceKind: 'references',
            line: item.startLine,
            column: envVarMatch.index,
          });
        }
      }

      // FROM [--platform=...] <image> [AS <stage>]
      const fromMatch = line.match(/^FROM\s+(?:--platform=[^\s]+\s+)?([^\s]+)(?:\s+[aA][sS]\s+([^\s]+))?/i);
      if (fromMatch) {
        const baseImage = fromMatch[1]!;
        const stageName = fromMatch[2] || '';

        // Base image node
        const imgId = generateNodeId(this.filePath, 'component', `image:${baseImage}`, item.startLine);
        this.nodes.push({
          id: imgId,
          kind: 'component',
          name: baseImage,
          qualifiedName: `${this.filePath}#image:${baseImage}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: item.startLine,
          endLine: item.endLine,
          startColumn: 0,
          endColumn: line.length,
          signature: `FROM ${baseImage}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: imgId,
          kind: 'contains',
        });

        if (stageName) {
          const stageId = generateNodeId(this.filePath, 'component', `stage:${stageName}`, item.startLine);
          this.nodes.push({
            id: stageId,
            kind: 'component',
            name: stageName,
            qualifiedName: `${this.filePath}#stage:${stageName}`,
            filePath: this.filePath,
            language: 'yaml',
            startLine: item.startLine,
            endLine: item.endLine,
            startColumn: 0,
            endColumn: line.length,
            signature: `stage AS ${stageName}`,
            updatedAt: Date.now(),
          });
          this.edges.push({
            source: fileNodeId,
            target: stageId,
            kind: 'contains',
          });
          this.edges.push({
            source: stageId,
            target: imgId,
            kind: 'references',
          });
          stages.set(stageName.toLowerCase(), stageId);
          currentStageNodeId = stageId;
          currentStageName = stageName;
        } else {
          currentStageNodeId = imgId;
          currentStageName = baseImage;
        }
        continue;
      }

      // COPY [--from=<stage>] <src>... <dest>
      const copyFromMatch = line.match(/^COPY\s+--from=([^\s]+)\s+/i);
      if (copyFromMatch) {
        const fromStage = copyFromMatch[1]!.toLowerCase();
        const targetStageId = stages.get(fromStage);
        if (targetStageId) {
          this.edges.push({
            source: currentStageNodeId,
            target: targetStageId,
            kind: 'references',
          });
        } else {
          this.unresolvedReferences.push({
            fromNodeId: currentStageNodeId,
            referenceName: fromStage,
            referenceKind: 'references',
            line: item.startLine,
            column: 0,
          });
        }
      }

      // ARG <name>[=<val>]
      const argMatch = line.match(/^ARG\s+([^=\s]+)(?:=(.*))?/i);
      if (argMatch) {
        const argName = argMatch[1]!;
        const rawVal = argMatch[2] || '';
        const safeVal = SENSITIVE_KEY_PATTERN.test(argName) ? '[REDACTED]' : rawVal;
        const argId = generateNodeId(this.filePath, 'variable', `arg:${argName}`, item.startLine);

        this.nodes.push({
          id: argId,
          kind: 'variable',
          name: argName,
          qualifiedName: `${this.filePath}#${currentStageName}:arg:${argName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: item.startLine,
          endLine: item.endLine,
          startColumn: 0,
          endColumn: line.length,
          signature: `ARG ${argName}=${safeVal}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: currentStageNodeId,
          target: argId,
          kind: 'contains',
        });
        continue;
      }

      // ENV <name>=<val> or ENV <name> <val>
      const envMatch = line.match(/^ENV\s+([^\s=]+)[=\s]+(.*)/i);
      if (envMatch) {
        const envName = envMatch[1]!;
        const rawVal = envMatch[2] || '';
        const safeVal = SENSITIVE_KEY_PATTERN.test(envName) ? '[REDACTED]' : rawVal;
        const envId = generateNodeId(this.filePath, 'variable', `env:${envName}`, item.startLine);

        this.nodes.push({
          id: envId,
          kind: 'variable',
          name: envName,
          qualifiedName: `${this.filePath}#${currentStageName}:env:${envName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: item.startLine,
          endLine: item.endLine,
          startColumn: 0,
          endColumn: line.length,
          signature: `ENV ${envName}=${safeVal}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: currentStageNodeId,
          target: envId,
          kind: 'contains',
        });
        continue;
      }

      // EXPOSE <port>
      const exposeMatch = line.match(/^EXPOSE\s+(.*)/i);
      if (exposeMatch) {
        const port = exposeMatch[1]!.trim();
        const expId = generateNodeId(this.filePath, 'property', `expose:${port}`, item.startLine);
        this.nodes.push({
          id: expId,
          kind: 'property',
          name: `EXPOSE ${port}`,
          qualifiedName: `${this.filePath}#expose:${port}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: item.startLine,
          endLine: item.endLine,
          startColumn: 0,
          endColumn: line.length,
          signature: `EXPOSE ${port}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: currentStageNodeId,
          target: expId,
          kind: 'contains',
        });
        continue;
      }

      // WORKDIR / ENTRYPOINT / CMD
      const cmdMatch = line.match(/^(WORKDIR|ENTRYPOINT|CMD)\s+(.*)/i);
      if (cmdMatch) {
        const verb = cmdMatch[1]!.toUpperCase();
        const val = cmdMatch[2]!.trim();
        const cmdId = generateNodeId(this.filePath, 'property', `${verb}:${val}`, item.startLine);
        this.nodes.push({
          id: cmdId,
          kind: 'property',
          name: `${verb} ${val}`,
          qualifiedName: `${this.filePath}#${verb}:${val}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: item.startLine,
          endLine: item.endLine,
          startColumn: 0,
          endColumn: line.length,
          signature: `${verb} ${val}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: currentStageNodeId,
          target: cmdId,
          kind: 'contains',
        });
      }
    }
  }

  private extractCompose(fileNodeId: string): void {
    const { data, lineMap, errors } = parseYamlWithLocations(this.source);
    if (errors.length > 0) {
      for (const err of errors) {
        this.errors.push({
          message: err,
          filePath: this.filePath,
          severity: 'warning',
          code: 'yaml_syntax_warning',
        });
      }
    }

    if (!data || typeof data !== 'object') return;

    const services = data.services || data.Services;
    if (!services || typeof services !== 'object') return;

    const serviceNodes = new Map<string, string>(); // serviceName -> nodeId

    // First pass: create service nodes
    for (const [serviceName, serviceDef] of Object.entries(services)) {
      if (!serviceDef || typeof serviceDef !== 'object') continue;
      const lineNum = lineMap.get(`services.${serviceName}`) || 1;
      const svcId = generateNodeId(this.filePath, 'component', `service:${serviceName}`, lineNum);

      this.nodes.push({
        id: svcId,
        kind: 'component',
        name: serviceName,
        qualifiedName: `${this.filePath}#service:${serviceName}`,
        filePath: this.filePath,
        language: 'yaml',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: 0,
        signature: `service ${serviceName}`,
        updatedAt: Date.now(),
      });

      this.edges.push({
        source: fileNodeId,
        target: svcId,
        kind: 'contains',
      });

      serviceNodes.set(serviceName.toLowerCase(), svcId);
    }

    // Second pass: extract service details and dependencies
    for (const [serviceName, serviceDef] of Object.entries(services)) {
      if (!serviceDef || typeof serviceDef !== 'object') continue;
      const svc = serviceDef as Record<string, any>;
      const svcId = serviceNodes.get(serviceName.toLowerCase())!;
      const svcLine = lineMap.get(`services.${serviceName}`) || 1;

      // Image
      if (svc.image) {
        const imgName = String(svc.image);
        const imgLine = lineMap.get(`services.${serviceName}.image`) || svcLine;
        const imgId = generateNodeId(this.filePath, 'component', `image:${imgName}`, imgLine);

        this.nodes.push({
          id: imgId,
          kind: 'component',
          name: imgName,
          qualifiedName: `${this.filePath}#image:${imgName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: imgLine,
          endLine: imgLine,
          startColumn: 0,
          endColumn: 0,
          signature: `image: ${imgName}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: svcId,
          target: imgId,
          kind: 'references',
        });
      }

      // Build context
      if (svc.build) {
        const buildCtx = typeof svc.build === 'string' ? svc.build : svc.build.context || '.';
        const buildLine = lineMap.get(`services.${serviceName}.build`) || svcLine;
        const buildId = generateNodeId(this.filePath, 'property', `build:${buildCtx}`, buildLine);

        this.nodes.push({
          id: buildId,
          kind: 'property',
          name: `build: ${buildCtx}`,
          qualifiedName: `${this.filePath}#service:${serviceName}:build`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: buildLine,
          endLine: buildLine,
          startColumn: 0,
          endColumn: 0,
          signature: `build: ${buildCtx}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: svcId,
          target: buildId,
          kind: 'contains',
        });
      }

      // depends_on: list or map
      if (svc.depends_on) {
        let targets: string[] = [];
        if (Array.isArray(svc.depends_on)) {
          targets = svc.depends_on.map(String);
        } else if (typeof svc.depends_on === 'object') {
          targets = Object.keys(svc.depends_on);
        }

        for (const depName of targets) {
          const targetSvcId = serviceNodes.get(depName.toLowerCase());
          if (targetSvcId) {
            this.edges.push({
              source: svcId,
              target: targetSvcId,
              kind: 'references',
            });
          } else {
            this.unresolvedReferences.push({
              fromNodeId: svcId,
              referenceName: depName,
              referenceKind: 'references',
              line: svcLine,
              column: 0,
            });
          }
        }
      }

      // Ports
      if (Array.isArray(svc.ports)) {
        for (let pIdx = 0; pIdx < svc.ports.length; pIdx++) {
          const port = String(svc.ports[pIdx]);
          const portLine = lineMap.get(`services.${serviceName}.ports[${pIdx}]`) || svcLine;
          const portId = generateNodeId(this.filePath, 'property', `port:${port}`, portLine);

          this.nodes.push({
            id: portId,
            kind: 'property',
            name: port,
            qualifiedName: `${this.filePath}#service:${serviceName}:port:${port}`,
            filePath: this.filePath,
            language: 'yaml',
            startLine: portLine,
            endLine: portLine,
            startColumn: 0,
            endColumn: 0,
            signature: `ports: [${port}]`,
            updatedAt: Date.now(),
          });
          this.edges.push({
            source: svcId,
            target: portId,
            kind: 'contains',
          });
        }
      }

      // Environment
      if (svc.environment) {
        const envEntries: Array<{ key: string; val: string }> = [];
        if (Array.isArray(svc.environment)) {
          for (const item of svc.environment) {
            const str = String(item);
            const eq = str.indexOf('=');
            if (eq > 0) {
              envEntries.push({ key: str.slice(0, eq).trim(), val: str.slice(eq + 1).trim() });
            } else {
              envEntries.push({ key: str.trim(), val: '' });
            }
          }
        } else if (typeof svc.environment === 'object') {
          for (const [k, v] of Object.entries(svc.environment)) {
            envEntries.push({ key: k, val: String(v) });
          }
        }

        for (const env of envEntries) {
          const safeVal = SENSITIVE_KEY_PATTERN.test(env.key) ? '[REDACTED]' : env.val;
          const envId = generateNodeId(this.filePath, 'variable', `env:${env.key}`, svcLine);

          this.nodes.push({
            id: envId,
            kind: 'variable',
            name: env.key,
            qualifiedName: `${this.filePath}#service:${serviceName}:env:${env.key}`,
            filePath: this.filePath,
            language: 'yaml',
            startLine: svcLine,
            endLine: svcLine,
            startColumn: 0,
            endColumn: 0,
            signature: `${env.key}=${safeVal}`,
            updatedAt: Date.now(),
          });
          this.edges.push({
            source: svcId,
            target: envId,
            kind: 'contains',
          });

          // Detect env references e.g. ${PORT}
          let m: RegExpExecArray | null;
          ENV_VAR_PATTERN.lastIndex = 0;
          while ((m = ENV_VAR_PATTERN.exec(env.val)) !== null) {
            const varName = m[1] || m[2];
            if (varName) {
              this.unresolvedReferences.push({
                fromNodeId: envId,
                referenceName: varName,
                referenceKind: 'references',
                line: svcLine,
                column: m.index,
              });
            }
          }
        }
      }
    }
  }
}
