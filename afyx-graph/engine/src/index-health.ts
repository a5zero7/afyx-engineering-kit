import { EXTRACTION_VERSION } from './extraction/extraction-version';
import { getFreshness, type FreshnessReport } from './freshness';

export interface IndexPhaseTimings {
  /** Directory walk and supported-language classification. */
  scanMs: number;
  /** Parse, extraction and ordered store; these are interleaved by design. */
  parseStoreMs: number;
  /** Reference resolution plus post-resolution linking passes. */
  resolutionLinkMs: number;
  /** SQLite planner upkeep and final WAL maintenance. */
  maintenanceMs: number;
  /** Whole AfyxGraph.indexAll call, including all orchestration overhead. */
  totalMs: number;
}

export interface IndexAccounting {
  discovered: number;
  eligible: number;
  indexed: number;
  /** Null for indexes built before universal catalog accounting. */
  metadataIndexed: number | null;
  /** Null for old indexes; currently zero because full-text content is not indexed. */
  contentIndexed: number | null;
  /** Null for indexes built before universal catalog accounting. */
  structurallyIndexed: number | null;
  skipped: number;
  unsupported: number;
  failed: number;
  /** Ignored paths are deliberately not enumerated by the scanner. */
  ignored: null;
  retry: { attemptedFiles: number; recoveredFiles: number; failedFiles: number };
  /** Aggregate-only: no source paths or contents are exposed. */
  skippedReasons: Record<string, number> | null;
  /** Bounded to the extensions already counted during the original scan. */
  unsupportedExtensions: Array<{ ext: string; count: number }> | null;
  completedAt: number | null;
  timings: IndexPhaseTimings | null;
}

export interface PendingFileLike {
  path: string;
  lastSeenMs: number;
  indexing?: boolean;
}

export interface IndexHealthSource {
  getIndexState(): 'indexing' | 'complete' | 'partial' | 'failed' | null;
  getIndexAccounting(): IndexAccounting | null;
  getIndexBuildInfo(): { version: string | null; extractionVersion: number | null };
  isIndexStale(): boolean;
  getPendingReferenceCount(): number;
  isWatching(): boolean;
  isWatcherDegraded(): boolean;
  getWatcherDegradedReason(): string | null;
  getPendingFiles(): PendingFileLike[];
}

export interface DiskChangeCounts {
  added: number;
  modified: number;
  removed: number;
}

export interface IndexHealthEvidence {
  diskChanges?: DiskChangeCounts;
  freshness?: FreshnessReport;
  pendingFiles?: PendingFileLike[];
}

export interface IndexHealth {
  gitFreshness: FreshnessReport;
  pendingChanges: {
    state: 'CURRENT' | 'PENDING' | 'UNKNOWN';
    count: number | null;
    source: 'filesystem-scan' | 'watcher' | 'unavailable';
    added: number | null;
    modified: number | null;
    removed: number | null;
  };
  extraction: {
    state: 'indexing' | 'complete' | 'partial' | 'failed' | 'unknown';
    accounting: IndexAccounting | null;
  };
  compatibility: {
    builtWithVersion: string | null;
    builtWithExtractionVersion: number | null;
    currentExtractionVersion: number;
    reindexRecommended: boolean;
  };
  pendingReferences: number;
  watcher: {
    state: 'ENABLED' | 'DEGRADED' | 'DISABLED';
    reason: string | null;
  };
}

/**
 * One read-only health contract shared by CLI, MCP and the viewer.
 *
 * Callers may reuse freshness, an exact filesystem comparison, or a live
 * pending snapshot they already read. Long-lived surfaces otherwise use the
 * watcher's bounded pending set; without a watcher they say UNKNOWN instead of
 * silently claiming zero drift.
 */
export function buildIndexHealth(
  source: IndexHealthSource,
  projectRoot: string,
  evidence: IndexHealthEvidence = {},
): IndexHealth {
  const pendingFiles = evidence.pendingFiles ?? source.getPendingFiles();
  const watching = source.isWatching();
  const degraded = source.isWatcherDegraded();
  const build = source.getIndexBuildInfo();

  let pendingChanges: IndexHealth['pendingChanges'];
  if (evidence.diskChanges) {
    const { added, modified, removed } = evidence.diskChanges;
    const count = added + modified + removed;
    pendingChanges = {
      state: count > 0 ? 'PENDING' : 'CURRENT',
      count,
      source: 'filesystem-scan',
      added,
      modified,
      removed,
    };
  } else if (watching || degraded || pendingFiles.length > 0) {
    pendingChanges = {
      state: pendingFiles.length > 0 ? 'PENDING' : degraded ? 'UNKNOWN' : 'CURRENT',
      count: pendingFiles.length,
      source: 'watcher',
      added: null,
      modified: null,
      removed: null,
    };
  } else {
    pendingChanges = {
      state: 'UNKNOWN',
      count: null,
      source: 'unavailable',
      added: null,
      modified: null,
      removed: null,
    };
  }

  return {
    gitFreshness: evidence.freshness ?? getFreshness(projectRoot),
    pendingChanges,
    extraction: {
      state: source.getIndexState() ?? 'unknown',
      accounting: source.getIndexAccounting(),
    },
    compatibility: {
      builtWithVersion: build.version,
      builtWithExtractionVersion: build.extractionVersion,
      currentExtractionVersion: EXTRACTION_VERSION,
      reindexRecommended: source.isIndexStale(),
    },
    pendingReferences: source.getPendingReferenceCount(),
    watcher: {
      state: degraded ? 'DEGRADED' : watching ? 'ENABLED' : 'DISABLED',
      reason: degraded ? source.getWatcherDegradedReason() : null,
    },
  };
}
