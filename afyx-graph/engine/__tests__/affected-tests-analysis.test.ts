import { describe, expect, it } from 'vitest';
import { analyzeAffectedTests, type AffectedTestsResult } from '../src/impact/affected-tests';
import type { IndexHealth } from '../src/index-health';
import type { FileRecord } from '../src/types';

const empty: AffectedTestsResult = { affectedTests: [], totalDependentsTraversed: 0 };

function file(path: string, indexingLevel: FileRecord['indexingLevel'] = 'structural'): FileRecord {
  return {
    path,
    contentHash: path,
    language: 'typescript',
    size: 1,
    modifiedAt: 1,
    indexedAt: 1,
    nodeCount: indexingLevel === 'structural' ? 1 : 0,
    indexingLevel,
  };
}

function healthy(): IndexHealth {
  return {
    gitFreshness: { state: 'FRESH', detail: 'current' },
    pendingChanges: { state: 'CURRENT', count: 0, source: 'filesystem-scan', added: 0, modified: 0, removed: 0 },
    extraction: {
      state: 'complete',
      accounting: {
        discovered: 2,
        eligible: 2,
        indexed: 2,
        metadataIndexed: 0,
        contentIndexed: 0,
        structurallyIndexed: 2,
        skipped: 0,
        unsupported: 0,
        failed: 0,
        ignored: null,
        retry: { attemptedFiles: 0, recoveredFiles: 0, failedFiles: 0 },
        skippedReasons: {},
        unsupportedExtensions: [],
        completedAt: 1,
        timings: null,
      },
    },
    compatibility: { builtWithVersion: '1.0.0', builtWithExtractionVersion: 1, currentExtractionVersion: 1, reindexRecommended: false },
    pendingReferences: 0,
    watcher: { state: 'DISABLED', reason: null },
  };
}

describe('affected-test empty-result analysis', () => {
  it('distinguishes a complete index with no indexed tests', () => {
    expect(analyzeAffectedTests(empty, ['src/service.ts'], [file('src/service.ts')], healthy())).toMatchObject({
      emptyReason: 'NO_INDEXED_TESTS',
      evidenceSufficient: true,
      provesNoTestsAffected: false,
      indexedTestFiles: 0,
    });
  });

  it('refuses a complete-reachability conclusion when maxDepth truncated the traversal', () => {
    const result = analyzeAffectedTests(
      { affectedTests: [], totalDependentsTraversed: 1, traversalTruncated: true },
      ['src/service.ts'],
      [file('src/service.ts'), file('src/helper.ts'), file('test/service.test.ts')],
      healthy(),
    );

    expect(result.emptyReason).toBe('INSUFFICIENT_GRAPH_EVIDENCE');
    expect(result.evidenceSufficient).toBe(false);
    expect(result.provesNoTestsAffected).toBe(false);
    expect(result.limitations).toContain('TRAVERSAL_DEPTH_LIMITED');
  });

  it('keeps recognized-test accounting independent from a custom filter', () => {
    const result = analyzeAffectedTests(
      empty,
      ['src/service.ts'],
      [file('src/service.ts'), file('test/service.test.ts')],
      healthy(),
      /\.spec\.ts$/,
    );

    expect(result).toMatchObject({
      emptyReason: 'NO_REACHABLE_INDEXED_TESTS',
      indexedTestFiles: 1,
      candidateTestFiles: 0,
      customFilterApplied: true,
      provesNoTestsAffected: false,
    });
  });

  it('distinguishes indexed tests that are not reachable from the changed file', () => {
    expect(analyzeAffectedTests(empty, ['src/service.ts'], [file('src/service.ts'), file('test/unrelated.test.ts')], healthy())).toMatchObject({
      emptyReason: 'NO_REACHABLE_INDEXED_TESTS',
      evidenceSufficient: true,
      indexedTestFiles: 1,
      structurallyIndexedTestFiles: 1,
    });
  });

  it('fails closed when index state, freshness, or structural coverage is insufficient', () => {
    const health = healthy();
    health.extraction.state = 'partial';
    health.pendingChanges.state = 'PENDING';
    health.gitFreshness = { state: 'STALE', detail: 'changed' };
    const result = analyzeAffectedTests(
      empty,
      ['src/service.ts'],
      [file('src/service.ts', 'metadata'), file('test/service.test.ts', 'metadata')],
      health,
    );

    expect(result.emptyReason).toBe('INSUFFICIENT_GRAPH_EVIDENCE');
    expect(result.evidenceSufficient).toBe(false);
    expect(result.limitations).toEqual(expect.arrayContaining([
      'CHANGED_FILE_NOT_STRUCTURALLY_INDEXED',
      'INDEX_FRESHNESS_UNPROVEN',
      'INDEX_NOT_COMPLETE',
      'TEST_COVERAGE_NOT_STRUCTURAL',
    ]));
  });

  it('does not assign an empty reason when affected tests were found', () => {
    const result = analyzeAffectedTests(
      { affectedTests: ['test/service.test.ts'], totalDependentsTraversed: 1 },
      ['src/service.ts'],
      [file('src/service.ts'), file('test/service.test.ts')],
      healthy(),
    );

    expect(result.emptyReason).toBeNull();
    expect(result.evidenceSufficient).toBe(true);
  });
});
