import { describe, expect, it, vi } from 'vitest';
import type { QueryBuilder } from '../src/db/queries';
import type { Edge, ExtractionResult, Node } from '../src/types';
import {
  ExtractionAdmission,
  recoverUnresolvedReference,
} from '../src/extraction/extraction-admission';
import {
  ResolutionAdmission,
  failedCleanup,
  resolvedCleanup,
} from '../src/resolution/resolution-admission';
import type { ResolvedRef, UnresolvedRef } from '../src/resolution/types';

function queryDouble(methods: Record<string, unknown> = {}): QueryBuilder {
  return methods as unknown as QueryBuilder;
}

function unresolved(overrides: Partial<UnresolvedRef> = {}): UnresolvedRef {
  return {
    fromNodeId: 'source',
    referenceName: 'target',
    referenceKind: 'calls',
    line: 7,
    column: 3,
    filePath: 'src/source.ts',
    language: 'typescript',
    ...overrides,
  };
}

function resolved(overrides: Partial<ResolvedRef> = {}): ResolvedRef {
  return {
    original: unresolved({ rowId: 41 }),
    targetNodeId: 'target',
    confidence: 0.9,
    resolvedBy: 'exact-match',
    ...overrides,
  };
}

describe('extraction admission', () => {
  it('recovers only edges carrying the original reference contract', () => {
    const edge = {
      source: 'source',
      target: 'old-target',
      kind: 'instantiates',
      line: 7,
      column: 3,
      metadata: { refName: 'Widget', refKind: 'calls' },
      sourceFilePath: 'src/source.ts',
      sourceLanguage: 'typescript',
    } as Edge & { sourceFilePath: string; sourceLanguage: 'typescript' };

    expect(recoverUnresolvedReference(edge)).toEqual({
      fromNodeId: 'source',
      referenceName: 'Widget',
      referenceKind: 'calls',
      line: 7,
      column: 3,
      filePath: 'src/source.ts',
      language: 'typescript',
    });
    expect(recoverUnresolvedReference({ ...edge, metadata: undefined })).toBeNull();
  });

  it('builds a normalized fresh bundle without admitting dangling facts', () => {
    const admission = new ExtractionAdmission(queryDouble());
    const result: ExtractionResult = {
      nodes: [
        {
          id: 'file', kind: 'file', name: 'source.ts', filePath: 'src/source.ts',
          language: 'typescript', startLine: 1, endLine: 1, startColumn: 0,
          endColumn: 0, updatedAt: 1,
        },
      ],
      edges: [
        { source: 'file', target: 'file', kind: 'contains' },
        { source: 'file', target: 'missing', kind: 'calls' },
      ],
      unresolvedReferences: [
        { ...unresolved({ fromNodeId: 'file' }), filePath: undefined, language: undefined },
        unresolved({ fromNodeId: 'missing' }),
      ],
      errors: [],
      durationMs: 1,
    };

    const bundle = admission.freshBundle(
      'src/source.ts',
      'export const value = 1;\n',
      'typescript',
      { size: 24, mtimeMs: 10 },
      result,
    );
    expect(bundle.nodes.map((node) => node.id)).toEqual(['file']);
    expect(bundle.edges).toHaveLength(1);
    expect(bundle.refs).toEqual([
      expect.objectContaining({
        fromNodeId: 'file',
        filePath: 'src/source.ts',
        language: 'typescript',
      }),
    ]);
  });

  it('reopens only recoverable edges outside changed files', () => {
    const replace = vi.fn();
    const query = queryDouble({
      getResolutionEdgesByTargetName: vi.fn(() => [
        {
          edgeId: 1, source: 'a', target: 't', kind: 'calls',
          sourceFilePath: 'src/unchanged.ts', sourceLanguage: 'typescript',
          metadata: { refName: 'target' },
        },
        {
          edgeId: 2, source: 'b', target: 't', kind: 'calls',
          sourceFilePath: 'src/changed.ts', sourceLanguage: 'typescript',
          metadata: { refName: 'target' },
        },
        {
          edgeId: 3, source: 'c', target: 't', kind: 'calls',
          sourceFilePath: 'src/legacy.ts', sourceLanguage: 'typescript',
        },
      ]),
      replaceResolutionEdgesWithUnresolvedRefs: replace,
    });

    const count = new ExtractionAdmission(query).reopenAffectedResolutionEdges(
      ['target'],
      ['src/changed.ts'],
    );
    expect(count).toBe(1);
    expect(replace).toHaveBeenCalledWith(
      [1],
      [expect.objectContaining({ fromNodeId: 'a', referenceName: 'target' })],
    );
  });
});

describe('resolution admission', () => {
  it('partitions exact database rows from legacy identity fallbacks', () => {
    const exact = resolved();
    const legacy = resolved({ original: unresolved({ rowId: undefined, referenceName: 'legacy' }) });
    expect(resolvedCleanup([exact, legacy])).toEqual({
      rowIds: [41],
      legacyKeys: [{ fromNodeId: 'source', referenceName: 'legacy', referenceKind: 'calls' }],
    });
    expect(failedCleanup([exact.original, legacy.original])).toEqual({
      byRowId: [{ rowId: 41, referenceName: 'target' }],
      legacyKeys: [{ fromNodeId: 'source', referenceName: 'legacy', referenceKind: 'calls' }],
    });
  });

  it('promotes semantic edge kinds and preserves multi-target metadata', () => {
    const nodes = new Map<string, Partial<Node>>([
      ['source', { kind: 'class' }],
      ['target', { kind: 'class' }],
      ['other', { kind: 'function' }],
    ]);
    const admission = new ResolutionAdmission(queryDouble({
      getNodeById: (id: string) => nodes.get(id) ?? null,
    }));

    expect(admission.createEdges([
      resolved({ alsoTargets: [{ targetNodeId: 'other', metadata: { branch: 'alternate' } }] }),
    ])).toEqual([
      expect.objectContaining({
        source: 'source', target: 'target', kind: 'instantiates',
        metadata: expect.objectContaining({ refName: 'target', refKind: 'calls' }),
      }),
      expect.objectContaining({
        source: 'source', target: 'other', kind: 'instantiates',
        metadata: expect.objectContaining({ branch: 'alternate' }),
      }),
    ]);
  });

  it('admits edges before settling exact and legacy queue rows', () => {
    const calls: string[] = [];
    const query = queryDouble({
      getNodeById: () => null,
      insertEdges: () => calls.push('edges'),
      deleteReferencesByRowIds: () => calls.push('resolved-row'),
      deleteSpecificResolvedReferences: () => calls.push('resolved-legacy'),
      markReferencesFailedByRowIds: () => calls.push('failed-row'),
      markReferencesFailed: () => calls.push('failed-legacy'),
    });
    const admitted = new ResolutionAdmission(query).admit(
      {
        resolved: [resolved()],
        unresolved: [unresolved({ rowId: 42, referenceName: 'missing' })],
        stats: { total: 2, resolved: 1, unresolved: 1, byMethod: { 'exact-match': 1 } },
      },
      [unresolved({ rowId: 42, referenceName: 'missing' })],
    );

    expect(admitted).toBe(1);
    expect(calls).toEqual([
      'edges', 'resolved-row', 'resolved-legacy', 'failed-row', 'failed-legacy',
    ]);
  });
});
