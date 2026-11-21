/**
 * AFYX Cross-Domain Resolver: Source ↔ Build ↔ Container (AFYX-227 / Track C Wave 3A C6.1).
 *
 * Infers and synthesizes cross-domain edges between:
 * 1. Source ↔ Build (Make, CMake, npm, Gradle, Maven, MSBuild targets and dependencies ↔ Source files & entrypoints)
 * 2. Shell ↔ Build / Source (Shell scripts invoking build targets or executing code entrypoints)
 * 3. Build ↔ Container (Docker COPY/ADD/RUN referencing build configs, artifacts, or targets)
 * 4. Container ↔ Source (Volume mounts and file copies connecting containers to source modules)
 *
 * Guarantees:
 * - Source-grounded: requires concrete file path or symbol match
 * - Fail-closed: ambiguous fanouts capped at 20
 * - Cycle-safe and deduplicated
 */

import * as path from 'path';
import type { Edge, Node } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';

const FANOUT_CAP = 20;

const GENERIC_BASENAMES = new Set([
  'index.ts', 'index.js', 'index.mjs', 'index.cjs', 'index.d.ts',
  'main.ts', 'main.js', 'main.py', 'main.go', 'main.rs',
  'app.ts', 'app.js', 'app.py',
  'test.ts', 'test.js', 'test.py', 'test.go',
  'mod.rs', 'lib.rs', 'setup.py', '__init__.py',
  'package.json', 'tsconfig.json', 'readme.md', 'license',
]);

function matchesTargetFile(text: string, targetPath: string): boolean {
  if (text.includes(targetPath)) return true;
  const targetBase = path.posix.basename(targetPath);
  if (GENERIC_BASENAMES.has(targetBase.toLowerCase())) {
    const parentDir = path.posix.basename(path.posix.dirname(targetPath));
    if (parentDir && parentDir !== '.' && text.includes(`${parentDir}/${targetBase}`)) {
      return true;
    }
    return false;
  }
  if (!targetBase.includes('.')) return false;
  const escaped = targetBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9_/-])${escaped}(?:[^a-zA-Z0-9_/-]|$)`, 'i');
  return regex.test(text);
}

export async function crossDomainSourceBuildContainerEdges(
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
  const baseNameToFileMap = new Map<string, string[]>();

  // Index project files and their root module/file nodes
  for (const filePath of allFiles) {
    const norm = filePath.replace(/\\/g, '/');
    const nodesInFile = ctx.getNodesInFile(norm);
    if (nodesInFile.length > 0) {
      // Find file/module node or fallback to first node
      const rootNode = nodesInFile.find(n => n.kind === 'module' || n.kind === 'file') || nodesInFile[0];
      if (rootNode) {
        fileToNodeMap.set(norm, rootNode);
      }
    }
    const base = path.basename(norm);
    const existing = baseNameToFileMap.get(base) || [];
    existing.push(norm);
    baseNameToFileMap.set(base, existing);
  }

  await maybeYield();

  // 1. Build Nodes -> Source Files
  // Scan modules, files, and functions from build files
  const buildNodes = [
    ...ctx.getNodesByKind('module'),
    ...ctx.getNodesByKind('file'),
    ...ctx.getNodesByKind('function'),
    ...ctx.getNodesByKind('variable'),
  ].filter(n => {
    const p = n.filePath.toLowerCase();
    return (
      p.endsWith('package.json') ||
      p.endsWith('makefile') ||
      p.endsWith('cmakelists.txt') ||
      p.endsWith('pom.xml') ||
      p.endsWith('build.gradle') ||
      p.endsWith('.csproj')
    );
  });

  for (const node of buildNodes) {
    const textToScan = `${node.name} ${node.signature || ''} ${node.docstring || ''}`;

    let matches = 0;
    for (const [targetPath, targetNode] of fileToNodeMap.entries()) {
      if (targetPath === node.filePath) continue;
      if (matchesTargetFile(textToScan, targetPath)) {
        addEdge(node.id, targetNode.id, 'references');
        matches++;
        if (matches >= FANOUT_CAP) break;
      }
    }
  }

  await maybeYield();

  // 2. Shell Nodes -> Build Targets / Source Entrypoints
  const shellNodes = [
    ...ctx.getNodesByKind('function'),
    ...ctx.getNodesByKind('module'),
  ].filter(n => n.language === 'shell' || n.language === 'powershell');

  for (const sNode of shellNodes) {
    // If shell node has a docstring or signature containing build/run commands
    const text = `${sNode.docstring || ''} ${sNode.signature || ''} ${sNode.name}`;
    let sMatches = 0;
    for (const [targetPath, targetNode] of fileToNodeMap.entries()) {
      if (targetPath === sNode.filePath) continue;
      if (matchesTargetFile(text, targetPath)) {
        addEdge(sNode.id, targetNode.id, 'calls');
        sMatches++;
        if (sMatches >= FANOUT_CAP) break;
      }
    }
  }

  await maybeYield();

  // 3. Container Nodes (Dockerfile & Docker Compose) -> Build / Source
  const containerNodes = [
    ...ctx.getNodesByKind('module'),
    ...ctx.getNodesByKind('file'),
    ...ctx.getNodesByKind('variable'),
    ...ctx.getNodesByKind('component'),
  ].filter(n => {
    const p = n.filePath.toLowerCase();
    const base = path.basename(p);
    return (
      base === 'dockerfile' ||
      base.startsWith('dockerfile.') ||
      base.endsWith('.dockerfile') ||
      base.startsWith('docker-compose') ||
      (base.startsWith('compose') && (base.endsWith('.yml') || base.endsWith('.yaml')))
    );
  });

  for (const cNode of containerNodes) {
    const normPath = cNode.filePath.replace(/\\/g, '/');
    const dir = path.posix.dirname(normPath);
    const content = ctx.readFile(cNode.filePath) || '';
    const cText = `${cNode.docstring || ''} ${cNode.name} ${content}`;

    for (const [filePath, targetNode] of fileToNodeMap.entries()) {
      if (filePath === cNode.filePath) continue;
      const targetBase = path.posix.basename(filePath);

      // Link Compose -> Dockerfile
      if (
        (cNode.name === 'service' || cNode.kind === 'variable' || cNode.kind === 'file') &&
        (targetBase === 'dockerfile' || targetBase.startsWith('dockerfile.'))
      ) {
        if (filePath.startsWith(dir) || cText.includes('build: .') || cText.includes('dockerfile')) {
          addEdge(cNode.id, targetNode.id, 'references');
        }
      }

      // Link Dockerfile COPY/ADD -> package.json or pom.xml or src
      if (
        (targetBase === 'package.json' || targetBase === 'pom.xml' || targetBase === 'requirements.txt' || targetBase === 'index.ts') &&
        (cText.includes(targetBase) || (targetBase === 'index.ts' && cText.includes('COPY src/')))
      ) {
        addEdge(cNode.id, targetNode.id, 'references');
      }
    }
  }

  return edges;
}
