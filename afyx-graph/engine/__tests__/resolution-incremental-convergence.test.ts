import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AfyxGraph from '../src/index';

describe('resolution incremental R0-R9 convergence', () => {
  const roots: string[] = [];
  let graph: AfyxGraph | undefined;

  const makeRoot = (prefix: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push(root);
    return root;
  };

  const write = (root: string, relativePath: string, content: string) => {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  const canonicalState = (candidate: AfyxGraph) => {
    const files = candidate.getFiles().map((file) => file.path).sort();
    const nodes = files.flatMap((filePath) => candidate.getNodesInFile(filePath));
    const semanticById = new Map(
      nodes.map((node) => [
        node.id,
        `${node.filePath}:${node.kind}:${node.qualifiedName ?? node.name}:${node.startLine}`,
      ])
    );
    const edges = nodes
      .flatMap((node) => candidate.getOutgoingEdges(node.id))
      .map((edge) => ({
        source: semanticById.get(edge.source),
        target: semanticById.get(edge.target),
        kind: edge.kind,
        refName: edge.metadata?.refName ?? null,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const unresolved = files
      .flatMap((filePath) => candidate.getUnresolvedReferencesInFile(filePath))
      .map((entry) => ({
        source: semanticById.get(entry.fromNodeId),
        filePath: entry.filePath,
        name: entry.referenceName,
        kind: entry.referenceKind,
        line: entry.line,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify({ edges, unresolved });
  };

  async function freshState(sourceRoot: string): Promise<string> {
    const freshRoot = makeRoot('afyx-resolution-r-fresh-');
    fs.cpSync(sourceRoot, freshRoot, {
      recursive: true,
      filter: (source) => !source.split(path.sep).includes('.afyx-graph'),
    });
    const fresh = AfyxGraph.initSync(freshRoot, {
      config: { include: ['**/*.ts'], exclude: [] },
    });
    try {
      await fresh.indexAll();
      return canonicalState(fresh);
    } finally {
      fresh.destroy();
    }
  }

  async function expectConverged(root: string, label: string) {
    expect(canonicalState(graph!), `${label}: incremental must equal fresh`).toBe(
      await freshState(root)
    );
  }

  afterEach(() => {
    graph?.destroy();
    graph = undefined;
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('converges after add, modify, move, delete, competition, alias, restore, and no-op', async () => {
    const root = makeRoot('afyx-resolution-r-');
    write(
      root,
      'src/caller.ts',
      `export function stable(): number { return 1; }\n` +
        `export function run(): number { stable(); return work(); }\n`
    );
    graph = AfyxGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    await graph.indexAll();
    await expectConverged(root, 'R0 initial stable + unresolved state');

    write(root, 'src/target.ts', `export function work(): number { return 2; }\n`);
    await graph.sync();
    await expectConverged(root, 'R1 add target');

    write(root, 'src/target.ts', `export function work(): number { return 3; }\n`);
    await graph.sync();
    await expectConverged(root, 'R2 modify target');

    fs.rmSync(path.join(root, 'src', 'target.ts'));
    write(root, 'src/moved.ts', `export function renamed(): number { return 4; }\n`);
    write(
      root,
      'src/caller.ts',
      `import { renamed as work } from './moved';\n` +
        `export function stable(): number { return 1; }\n` +
        `export function run(): number { stable(); return work(); }\n`
    );
    await graph.sync();
    await expectConverged(root, 'R3 rename and move target');

    const removedTargetIds = graph
      .getNodesInFile('src/moved.ts')
      .filter((node) => node.name === 'renamed')
      .map((node) => node.id);
    fs.rmSync(path.join(root, 'src', 'moved.ts'));
    await graph.sync();
    expect(
      graph
        .getNodesByName('run')
        .flatMap((node) => graph!.getOutgoingEdges(node.id))
        .some((edge) => removedTargetIds.includes(edge.target)),
      'R4 must remove stale target edges'
    ).toBe(false);
    await expectConverged(root, 'R4 delete target');

    write(root, 'src/other.ts', `export function work(): number { return 5; }\n`);
    await graph.sync();
    await expectConverged(root, 'R5 add competing same-name target');

    write(
      root,
      'src/caller.ts',
      `import { work } from './other';\n` +
        `export function stable(): number { return 1; }\n` +
        `export function run(): number { stable(); return work(); }\n`
    );
    await graph.sync();
    expect(
      graph
        .getNodesByName('run')
        .flatMap((node) => graph!.getOutgoingEdges(node.id))
        .map((edge) => graph!.getNode(edge.target)?.filePath)
    ).toContain('src/other.ts');
    await expectConverged(root, 'R6 alter import');

    write(root, 'src/moved.ts', `export function renamed(): number { return 6; }\n`);
    write(
      root,
      'src/caller.ts',
      `import { renamed as work } from './moved';\n` +
        `export function stable(): number { return 1; }\n` +
        `export function run(): number { stable(); return work(); }\n`
    );
    await graph.sync();
    expect(
      graph
        .getNodesByName('run')
        .flatMap((node) => graph!.getOutgoingEdges(node.id))
        .map((edge) => graph!.getNode(edge.target)?.filePath)
    ).toContain('src/moved.ts');
    await expectConverged(root, 'R7 restore target');

    const beforeNoOp = canonicalState(graph);
    const noOp = await graph.sync();
    expect(noOp.filesAdded + noOp.filesModified + noOp.filesRemoved).toBe(0);
    expect(canonicalState(graph)).toBe(beforeNoOp);
    await expectConverged(root, 'R8 no-op sync');

    const repeat = graph.resolveReferences();
    expect(repeat.stats.resolved).toBe(0);
    expect(canonicalState(graph)).toBe(beforeNoOp);
    await expectConverged(root, 'R9 repeated resolution');
  }, 120_000);
});
