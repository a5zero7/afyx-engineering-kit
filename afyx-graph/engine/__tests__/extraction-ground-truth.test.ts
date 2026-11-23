import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AfyxGraph from '../src/index';
import { extractFromSource } from '../src/extraction/extract';

import type { Edge, Node, UnresolvedReference } from '../src/types';

const fixtureRoot = path.join(__dirname, 'fixtures', 'extraction-ground-truth');


function facts(fileName: string) {
  const source = fs.readFileSync(path.join(fixtureRoot, fileName), 'utf8');
  const result = extractFromSource(fileName, source);
  return {
    nodes: result.nodes.map(({ updatedAt: _updatedAt, ...node }) => node),
    refs: result.unresolvedReferences.map(({ rowId: _rowId, ...ref }) => ref),
    errors: result.errors,
  };
}

function symbol(nodes: Array<Omit<Node, 'updatedAt'>>, name: string, kind: Node['kind']) {
  return nodes.find((node) => node.name === name && node.kind === kind);
}

describe('extraction ground truth', () => {
  it('extracts TypeScript class/method facts without comment or string symbols', () => {
    const result = facts('ledger.ts');
    expect(symbol(result.nodes, 'Ledger', 'class')).toMatchObject({
      filePath: 'ledger.ts', startLine: 3, endLine: 7, isExported: true,
    });
    expect(symbol(result.nodes, 'total', 'method')).toMatchObject({
      filePath: 'ledger.ts', startLine: 4, endLine: 6,
    });
    expect(result.nodes.some((node) => ['ghost', 'phantom'].includes(node.name))).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('extracts Python class/method facts without comment or string symbols', () => {
    const result = facts('service.py');
    expect(symbol(result.nodes, 'PaymentService', 'class')).toMatchObject({
      filePath: 'service.py', startLine: 3, endLine: 5,
    });
    expect(symbol(result.nodes, 'charge', 'method')).toMatchObject({
      filePath: 'service.py', startLine: 4, endLine: 5,
    });
    expect(result.nodes.some((node) => ['ghost', 'phantom'].includes(node.name))).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('extracts Go type/function facts without comment or string symbols', () => {
    const result = facts('worker.go');
    expect(symbol(result.nodes, 'Job', 'struct')).toMatchObject({
      filePath: 'worker.go', startLine: 5, endLine: 7,
    });
    expect(symbol(result.nodes, 'Process', 'function')).toMatchObject({
      filePath: 'worker.go', startLine: 9, endLine: 11,
    });
    expect(result.nodes.some((node) => ['Ghost', 'Phantom'].includes(node.name))).toBe(false);
    expect(result.errors).toEqual([]);
  });
});

type CanonicalState = {
  files: unknown[];
  nodes: unknown[];
  edges: unknown[];
  refs: unknown[];
};

function canonicalState(graph: AfyxGraph): CanonicalState {
  const files = graph.getFiles()
    .map(({ indexedAt: _indexedAt, modifiedAt: _modifiedAt, ...file }) => file)
    .sort((a, b) => a.path.localeCompare(b.path));
  const nodes = files
    .flatMap((file) => graph.getNodesInFile(file.path))
    .map(({ updatedAt: _updatedAt, ...node }) => node)
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = (nodes as Array<Omit<Node, 'updatedAt'>>)
    .flatMap((node) => graph.getOutgoingEdges(node.id))
    .map((edge: Edge) => ({
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      metadata: edge.metadata,
      line: edge.line,
      column: edge.column,
      provenance: edge.provenance,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const refs = files
    .flatMap((file) => graph.getUnresolvedReferencesInFile(file.path))
    .map(({ rowId: _rowId, ...ref }: UnresolvedReference) => ref)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { files, nodes, edges, refs };
}

function digest(state: CanonicalState): string {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('incremental extraction reconciliation ground truth', () => {
  const roots: string[] = [];
  const graphs: AfyxGraph[] = [];

  afterEach(() => {
    for (const graph of graphs.splice(0)) graph.destroy();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  async function freshState(root: string): Promise<CanonicalState> {
    const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-extract-fresh-'));
    roots.push(freshRoot);
    fs.cpSync(path.join(root, 'src'), path.join(freshRoot, 'src'), { recursive: true });
    const fresh = AfyxGraph.initSync(freshRoot, { config: { include: ['**/*.ts'], exclude: [] } });
    graphs.push(fresh);
    await fresh.indexAll();
    return canonicalState(fresh);
  }

  it('converges with a fresh extraction after add/modify/delete/rename/no-op/repeat', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-extract-incremental-'));
    roots.push(root);
    write(root, 'src/base.ts', 'export function base(): number { return 1; }\n');
    const graph = AfyxGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    graphs.push(graph);
    await graph.indexAll();

    const assertConverged = async () => {
      const incremental = canonicalState(graph);
      const fresh = await freshState(root);
      expect(incremental).toEqual(fresh);
      expect(digest(incremental)).toBe(digest(fresh));
    };

    await assertConverged();

    write(root, 'src/added.ts', 'export const added = (): number => 2;\n');
    expect(await graph.sync()).toMatchObject({ filesAdded: 1, filesModified: 0, filesRemoved: 0 });
    await assertConverged();

    write(root, 'src/base.ts', 'export function changed(): number { return 3; }\n');
    expect(await graph.sync()).toMatchObject({ filesAdded: 0, filesModified: 1, filesRemoved: 0 });
    await assertConverged();

    fs.rmSync(path.join(root, 'src', 'added.ts'));
    expect(await graph.sync()).toMatchObject({ filesAdded: 0, filesModified: 0, filesRemoved: 1 });
    await assertConverged();

    fs.renameSync(path.join(root, 'src', 'base.ts'), path.join(root, 'src', 'moved.ts'));
    expect(await graph.sync()).toMatchObject({ filesAdded: 1, filesModified: 0, filesRemoved: 1 });
    await assertConverged();

    expect(await graph.sync()).toMatchObject({ filesAdded: 0, filesModified: 0, filesRemoved: 0 });
    const stable = digest(canonicalState(graph));
    expect(await graph.sync()).toMatchObject({ filesAdded: 0, filesModified: 0, filesRemoved: 0 });
    expect(digest(canonicalState(graph))).toBe(stable);
  }, 30_000);

  it('scoped sync replaces changed data and removes an excluded tracked path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-extract-scoped-'));
    roots.push(root);
    write(root, 'src/a.ts', 'export function before(): number { return 1; }\n');
    write(root, 'src/b.ts', 'export function untouched(): number { return 2; }\n');
    const graph = AfyxGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    graphs.push(graph);
    await graph.indexAll();

    write(root, 'src/a.ts', 'export function after(): number { return 3; }\n');
    const changed = await graph.sync({ paths: ['src/a.ts'] });
    expect(changed).toMatchObject({ filesChecked: 1, filesModified: 1 });
    expect(graph.searchNodes('before')).toHaveLength(0);
    expect(graph.searchNodes('after').length).toBeGreaterThan(0);
    expect(graph.searchNodes('untouched').length).toBeGreaterThan(0);

    fs.writeFileSync(path.join(root, 'afyx-graph.json'), JSON.stringify({ exclude: ['src/a.ts'] }));
    const removed = await graph.sync({ paths: ['src/a.ts'] });
    expect(removed).toMatchObject({ filesChecked: 1, filesRemoved: 1 });
    expect(graph.searchNodes('after')).toHaveLength(0);
  });
});
