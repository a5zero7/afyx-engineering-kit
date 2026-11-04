import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import AfyxGraph from '../src/index';
import { extractImportMappings } from '../src/resolution/import-resolver';

interface SemanticTarget {
  filePath: string;
  name: string;
  kind: string;
}

const FIXTURE = path.join(__dirname, 'fixtures', 'resolution-ground-truth');

describe('resolution ground truth', () => {
  let root: string;
  let graph: AfyxGraph;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-resolution-ground-truth-'));
    fs.cpSync(FIXTURE, root, { recursive: true });
    graph = AfyxGraph.initSync(root);
    await graph.indexAll();
  }, 120_000);

  afterAll(() => {
    graph?.destroy();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  function node(filePath: string, name: string, kind?: string) {
    const matches = graph
      .getNodesByName(name)
      .filter((candidate) => candidate.filePath === filePath && (!kind || candidate.kind === kind));
    expect(matches, `expected one semantic node ${filePath}:${name}:${kind ?? '*'}`).toHaveLength(1);
    return matches[0]!;
  }

  function targetsFrom(filePath: string, sourceName: string, edgeKind: string): SemanticTarget[] {
    const source = node(filePath, sourceName);
    return graph
      .getOutgoingEdges(source.id)
      .filter((edge) => edge.kind === edgeKind)
      .map((edge) => graph.getNode(edge.target))
      .filter((target): target is NonNullable<typeof target> => target !== null)
      .map((target) => ({ filePath: target.filePath, name: target.name, kind: target.kind }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  function canonicalResolutionState(candidateGraph = graph): string {
    const files = candidateGraph.getFiles().map((file) => file.path).sort();
    const semanticNodes = files
      .flatMap((filePath) => candidateGraph.getNodesInFile(filePath))
      .map((entry) => ({
        id: entry.id,
        semantic: `${entry.filePath}:${entry.kind}:${entry.qualifiedName ?? entry.name}:${entry.startLine}`,
      }));
    const semanticById = new Map(semanticNodes.map((entry) => [entry.id, entry.semantic]));
    const edges = semanticNodes
      .flatMap((entry) => candidateGraph.getOutgoingEdges(entry.id))
      .map((edge) => ({
        source: semanticById.get(edge.source),
        target: semanticById.get(edge.target),
        kind: edge.kind,
        refName: edge.metadata?.refName ?? null,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const unresolved = files
      .flatMap((filePath) => candidateGraph.getUnresolvedReferencesInFile(filePath))
      .map((ref) => ({
        filePath: ref.filePath,
        from: semanticById.get(ref.fromNodeId),
        name: ref.referenceName,
        kind: ref.referenceKind,
        line: ref.line,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return createHash('sha256').update(JSON.stringify({ edges, unresolved })).digest('hex');
  }

  it('resolves a same-file TypeScript call to the local function', () => {
    expect(targetsFrom('ts/local.ts', 'localCaller', 'calls')).toEqual([
      { filePath: 'ts/local.ts', name: 'localTarget', kind: 'function' },
    ]);
  });

  it('uses the imported alias to reject the same-name function in another file', () => {
    expect(targetsFrom('ts/consumer.ts', 'aliasCaller', 'calls')).toEqual([
      { filePath: 'ts/right.ts', name: 'shared', kind: 'function' },
    ]);
  });

  it('uses the qualified namespace receiver to select the imported module target', () => {
    expect(targetsFrom('ts/consumer.ts', 'qualifiedCaller', 'calls')).toEqual([
      { filePath: 'ts/right.ts', name: 'shared', kind: 'function' },
    ]);
  });

  it('resolves an imported same-name base class to the correct module', () => {
    expect(targetsFrom('ts/consumer.ts', 'Child', 'extends')).toEqual([
      { filePath: 'ts/right.ts', name: 'Base', kind: 'class' },
    ]);
  });

  it('keeps an unknown TypeScript call unresolved without inventing a target', () => {
    expect(targetsFrom('ts/consumer.ts', 'unknownCaller', 'calls')).toEqual([]);
    expect(
      graph
        .getUnresolvedReferencesInFile('ts/consumer.ts')
        .some((ref) => ref.referenceName === 'missingTarget' && ref.referenceKind === 'calls')
    ).toBe(true);
  });

  it('preserves the deterministic first-candidate tie-break for equal ambiguous targets', () => {
    expect(targetsFrom('ts/ambiguity-consumer.ts', 'ambiguousCaller', 'calls')).toEqual([
      { filePath: 'ts/ambiguity-a.ts', name: 'ambiguousTarget', kind: 'function' },
    ]);
  });

  it('resolves a Python imported symbol to its source module, not a same-name competitor', () => {
    expect(targetsFrom('python/consumer.py', 'invoke', 'calls')).toEqual([
      { filePath: 'python/source.py', name: 'pay', kind: 'function' },
    ]);
  });

  it('preserves Python import provenance before candidate selection', () => {
    const content = fs.readFileSync(path.join(root, 'python/consumer.py'), 'utf8');
    expect(extractImportMappings('python/consumer.py', content, 'python')).toEqual([
      {
        localName: 'pay',
        exportedName: 'pay',
        source: 'source',
        isDefault: false,
        isNamespace: false,
      },
      {
        localName: 'imported_refund',
        exportedName: 'refund',
        source: 'source',
        isDefault: false,
        isNamespace: false,
      },
    ]);
  });

  it('resolves a Python imported alias using the same explicit module provenance', () => {
    expect(targetsFrom('python/consumer.py', 'invoke_alias', 'calls')).toEqual([
      { filePath: 'python/source.py', name: 'refund', kind: 'function' },
    ]);
  });

  it('does not collapse an unvalidated member call onto its imported root function', () => {
    expect(targetsFrom('python/member_consumer.py', 'invoke_unvalidated_member', 'calls')).toEqual([]);
    expect(
      graph
        .getUnresolvedReferencesInFile('python/member_consumer.py')
        .some(
          (ref) =>
            ref.referenceName === 'pay.some_member' &&
            ref.referenceKind === 'calls'
        )
    ).toBe(true);
  });

  it('resolves a qualified Go package call to the imported package', () => {
    expect(targetsFrom('go/main/main.go', 'Run', 'calls')).toEqual([
      { filePath: 'go/helper/helper.go', name: 'Do', kind: 'function' },
    ]);
  });

  it('is deterministic and idempotent across a repeated resolution pass', () => {
    const first = canonicalResolutionState();
    const repeated = graph.resolveReferences();
    const second = canonicalResolutionState();
    expect(repeated.stats.resolved).toBe(0);
    expect(second).toBe(first);
  });

  it('produces the same canonical resolution state from an equivalent fresh project', async () => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-resolution-ground-truth-repeat-'));
    fs.cpSync(FIXTURE, otherRoot, { recursive: true });
    const otherGraph = AfyxGraph.initSync(otherRoot);
    try {
      await otherGraph.indexAll();
      expect(canonicalResolutionState(otherGraph)).toBe(canonicalResolutionState(graph));
    } finally {
      otherGraph.destroy();
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});
