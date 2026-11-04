import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildIndexHealth, type IndexHealthSource } from '../src/index-health';
import { EXTRACTION_VERSION } from '../src/extraction/extraction-version';

describe('shared index health contract', () => {
  let root: string;

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-health-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function source(overrides: Partial<IndexHealthSource> = {}): IndexHealthSource {
    return {
      getIndexState: () => 'complete',
      getIndexAccounting: () => null,
      getIndexBuildInfo: () => ({ version: '1.0.0', extractionVersion: EXTRACTION_VERSION }),
      isIndexStale: () => false,
      getPendingReferenceCount: () => 0,
      isWatching: () => true,
      isWatcherDegraded: () => false,
      getWatcherDegradedReason: () => null,
      getPendingFiles: () => [],
      ...overrides,
    };
  }

  it('keeps Git freshness, filesystem changes and extraction completeness independent', () => {
    const health = buildIndexHealth(source({
      getIndexState: () => 'partial',
      getPendingReferenceCount: () => 3,
    }), root, { diskChanges: { added: 1, modified: 2, removed: 0 } });

    expect(health.gitFreshness.state).toBe('MISSING');
    expect(health.pendingChanges).toMatchObject({ state: 'PENDING', count: 3, source: 'filesystem-scan' });
    expect(health.extraction.state).toBe('partial');
    expect(health.pendingReferences).toBe(3);
  });

  it('distinguishes enabled, degraded and disabled watcher evidence', () => {
    expect(buildIndexHealth(source(), root).watcher.state).toBe('ENABLED');
    const degraded = buildIndexHealth(source({
      isWatching: () => false,
      isWatcherDegraded: () => true,
      getWatcherDegradedReason: () => 'watch limit exhausted',
      getPendingFiles: () => [{ path: 'a.ts', lastSeenMs: 1 }],
    }), root);
    expect(degraded.watcher).toEqual({ state: 'DEGRADED', reason: 'watch limit exhausted' });
    expect(degraded.pendingChanges).toMatchObject({ state: 'PENDING', count: 1, source: 'watcher' });

    const disabled = buildIndexHealth(source({ isWatching: () => false }), root);
    expect(disabled.watcher.state).toBe('DISABLED');
    expect(disabled.pendingChanges).toMatchObject({ state: 'UNKNOWN', count: null, source: 'unavailable' });
  });

  it('reports an old extraction version independently from a complete run', () => {
    const health = buildIndexHealth(source({
      getIndexBuildInfo: () => ({ version: '0.9.0', extractionVersion: 26 }),
      isIndexStale: () => true,
    }), root);

    expect(health.extraction.state).toBe('complete');
    expect(health.compatibility).toMatchObject({
      builtWithExtractionVersion: 26,
      currentExtractionVersion: EXTRACTION_VERSION,
      reindexRecommended: true,
    });
  });
});
