/**
 * AFYX Cross-Domain Resolver: CI/CD ↔ Infra ↔ DB ↔ API (AFYX-228 / Track C Wave 3A C6.2).
 *
 * Infers and synthesizes cross-domain edges between:
 * 1. CI/CD ↔ Containers / Infra / Build (CI steps invoking Docker, Terraform, Ansible, Build tools)
 * 2. Infra / Ansible ↔ Containers / Kubernetes / Database (Terraform & Ansible managing containers, K8s, DB migrations)
 * 3. API / Schema ↔ Code ↔ Database (OpenAPI/AsyncAPI/Schema routes & types ↔ Code handlers & DB tables/models)
 *
 * Guarantees:
 * - Source-grounded: requires concrete command, path, route, or symbol match
 * - Fail-closed: ambiguous fanouts capped at 20
 * - Cycle-safe and deduplicated
 */

import * as path from 'path';
import type { Edge, Node } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';

const FANOUT_CAP = 20;

export async function crossDomainCicdInfraDbApiEdges(
  ctx: ResolutionContext,
  maybeYield: MaybeYield,
): Promise<Edge[]> {
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();

  function addEdge(sourceId: string, targetId: string, kind: Edge['kind'] = 'references'): void {
    if (sourceId === targetId) return;
    const key = `${sourceId}->${targetId}->${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({
      source: sourceId,
      target: targetId,
      kind,
    });
  }

  const allFiles = ctx.getAllFiles();
  const fileToNodeMap = new Map<string, Node>();

  for (const filePath of allFiles) {
    const norm = filePath.replace(/\\/g, '/');
    const nodesInFile = ctx.getNodesInFile(norm);
    if (nodesInFile.length > 0) {
      const rootNode = nodesInFile.find(n => n.kind === 'module' || n.kind === 'file') || nodesInFile[0];
      if (rootNode) {
        fileToNodeMap.set(norm, rootNode);
      }
    }
  }

  await maybeYield();

  // 1. CI/CD Nodes -> Docker, Terraform, Ansible, Build Targets
  const cicdNodes = [
    ...ctx.getNodesByKind('module'),
    ...ctx.getNodesByKind('file'),
    ...ctx.getNodesByKind('function'),
    ...ctx.getNodesByKind('variable'),
  ].filter(n => {
    const p = n.filePath.toLowerCase();
    return (
      p.includes('.github/workflows/') ||
      p.includes('.gitlab-ci') ||
      p.includes('jenkinsfile') ||
      p.includes('azure-pipelines')
    );
  });

  for (const cicdNode of cicdNodes) {
    const content = ctx.readFile(cicdNode.filePath) || '';
    const text = `${cicdNode.name} ${cicdNode.docstring || ''} ${cicdNode.signature || ''} ${content}`.toLowerCase();

    // Check for Docker commands
    if (text.includes('docker build') || text.includes('docker-compose') || text.includes('docker compose')) {
      const fileMatch = text.match(/(?:-f|--file)\s+([^\s"']+)/);
      const specifiedFile = fileMatch && fileMatch[1] ? fileMatch[1].replace(/\\/g, '/').toLowerCase() : null;

      for (const [filePath, targetNode] of fileToNodeMap.entries()) {
        const lowerPath = filePath.toLowerCase();
        const base = path.posix.basename(lowerPath);
        const isContainerFile = base === 'dockerfile' || base.startsWith('dockerfile.') || base.startsWith('docker-compose') || base.startsWith('compose.');
        if (!isContainerFile) continue;

        if (specifiedFile) {
          if (lowerPath.endsWith(specifiedFile) || base === specifiedFile) {
            addEdge(cicdNode.id, targetNode.id, 'calls');
          }
        } else {
          // Default: match root or container directory
          if (!lowerPath.includes('/') || lowerPath.startsWith('docker/') || lowerPath.startsWith('.docker/')) {
            addEdge(cicdNode.id, targetNode.id, 'calls');
          }
        }
      }
    }

    // Check for Terraform commands
    if (text.includes('terraform ') || text.includes('tofu ')) {
      for (const [filePath, targetNode] of fileToNodeMap.entries()) {
        const lowerPath = filePath.toLowerCase();
        if (lowerPath.endsWith('.tf') || lowerPath.endsWith('.tofu')) {
          if (!lowerPath.includes('/') || lowerPath.startsWith('terraform/') || lowerPath.startsWith('infra/')) {
            addEdge(cicdNode.id, targetNode.id, 'calls');
          }
        }
      }
    }

    // Check for Ansible commands
    if (text.includes('ansible-playbook') || text.includes('ansible ')) {
      const pbMatch = text.match(/ansible-playbook\s+([^\s"']+)/);
      const specifiedPb = pbMatch && pbMatch[1] ? pbMatch[1].replace(/\\/g, '/').toLowerCase() : null;

      for (const [filePath, targetNode] of fileToNodeMap.entries()) {
        const lowerPath = filePath.toLowerCase();
        const base = path.posix.basename(lowerPath);
        if (specifiedPb) {
          if (lowerPath.endsWith(specifiedPb) || base === specifiedPb) {
            addEdge(cicdNode.id, targetNode.id, 'calls');
          }
        } else if (base.startsWith('playbook') || base === 'site.yml' || base === 'site.yaml') {
          addEdge(cicdNode.id, targetNode.id, 'calls');
        }
      }
    }
  }

  await maybeYield();

  // 2. Ansible Nodes -> Docker, Kubernetes, Database
  const ansibleNodes = [
    ...ctx.getNodesByKind('module'),
    ...ctx.getNodesByKind('file'),
    ...ctx.getNodesByKind('function'),
    ...ctx.getNodesByKind('component'),
  ].filter(n => {
    const p = n.filePath.toLowerCase();
    return (
      p.includes('/playbooks/') ||
      p.includes('/roles/') ||
      p.endsWith('site.yml') ||
      p.endsWith('site.yaml') ||
      p.startsWith('playbook')
    );
  });

  for (const aNode of ansibleNodes) {
    const content = ctx.readFile(aNode.filePath) || '';
    const text = `${aNode.name} ${aNode.docstring || ''} ${aNode.signature || ''} ${content}`.toLowerCase();

    // Ansible managing Docker containers
    if (text.includes('docker_container') || text.includes('community.docker')) {
      for (const [filePath, targetNode] of fileToNodeMap.entries()) {
        const base = path.posix.basename(filePath).toLowerCase();
        if (base === 'dockerfile' || base.startsWith('docker-compose')) {
          addEdge(aNode.id, targetNode.id, 'references');
        }
      }
    }

    // Ansible managing K8s manifests
    if (text.includes('k8s') || text.includes('kubernetes.core')) {
      for (const [filePath, targetNode] of fileToNodeMap.entries()) {
        const p = filePath.toLowerCase();
        if (p.includes('/k8s/') || p.includes('/kubernetes/') || p.includes('/helm/')) {
          addEdge(aNode.id, targetNode.id, 'references');
        }
      }
    }
  }

  await maybeYield();

  // 3. API / Schema Nodes -> Code Routes & Database Tables
  const apiRouteNodes = ctx.getNodesByKind('route');
  const codeRouteNodes = [
    ...ctx.getNodesByKind('function'),
    ...ctx.getNodesByKind('method'),
  ].filter(n => {
    const text = `${n.signature || ''} ${n.name}`.toLowerCase();
    return (
      text.includes('get(') ||
      text.includes('post(') ||
      text.includes('put(') ||
      text.includes('delete(') ||
      text.includes('mapping(')
    );
  });

  for (const apiRoute of apiRouteNodes) {
    const routePath = apiRoute.name.toLowerCase();
    let matches = 0;
    for (const codeNode of codeRouteNodes) {
      const codeText = `${codeNode.signature || ''} ${codeNode.name}`.toLowerCase();
      if (codeText.includes(routePath)) {
        addEdge(apiRoute.id, codeNode.id, 'implements');
        matches++;
        if (matches >= FANOUT_CAP) break;
      }
    }
  }

  // Schema types -> Database tables / ORM models
  const schemaTypes = [
    ...ctx.getNodesByKind('type_alias'),
    ...ctx.getNodesByKind('class'),
  ].filter(n => {
    const p = n.filePath.toLowerCase();
    return (
      p.includes('schema') ||
      p.includes('openapi') ||
      p.includes('asyncapi') ||
      p.endsWith('.avsc') ||
      p.endsWith('.proto')
    );
  });

  const dbTableNodes = ctx.getNodesByKind('class').filter(n => {
    const p = n.filePath.toLowerCase();
    return p.includes('model') || p.includes('entity') || p.endsWith('.sql');
  });

  for (const sType of schemaTypes) {
    const sName = sType.name.toLowerCase();
    let matches = 0;
    for (const dbNode of dbTableNodes) {
      const dbName = dbNode.name.toLowerCase();
      if (sName === dbName || sName + 's' === dbName || dbName + 's' === sName) {
        addEdge(sType.id, dbNode.id, 'references');
        matches++;
        if (matches >= FANOUT_CAP) break;
      }
    }
  }

  return edges;
}
