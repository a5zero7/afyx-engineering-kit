/**
 * Pending Change Set
 *
 * The one owner of "files the watcher has seen an event for but hasn't yet
 * synced into the index." Keyed by project-relative POSIX path, in FIRST-SEEN
 * insertion order (a JS Map never reorders a key on a repeated `set()`, so
 * touching an already-pending path again does not move it to the end).
 *
 * Deliberately generic: no knowledge of debounce, retries, or sync results —
 * those are the scheduler/retry-policy's job. This class only tracks what is
 * pending and when it was (first/last) touched.
 */

export interface PendingEntry {
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface PendingFile {
  path: string;
  firstSeenMs: number;
  lastSeenMs: number;
  indexing: boolean;
}

export class PendingChangeSet {
  private readonly entries = new Map<string, PendingEntry>();

  /** Record an event for `path` at `nowMs`, preserving firstSeenMs if already pending. */
  touch(path: string, nowMs: number): void {
    const existing = this.entries.get(path);
    this.entries.set(path, { firstSeenMs: existing?.firstSeenMs ?? nowMs, lastSeenMs: nowMs });
  }

  get size(): number {
    return this.entries.size;
  }

  /** First-seen insertion order — the order a scoped sync call receives. */
  paths(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Remove every entry whose most recent event predates (or is exactly at)
   * `syncStartedMs` — i.e. entries a just-completed sync is presumed to have
   * captured. Entries touched AFTER the sync began (mid-sync arrivals) are
   * deliberately kept: whether the in-flight sync actually captured them
   * depends on exactly when it read that file, and false positives ("shown
   * stale, actually fresh") are preferred over false negatives.
   */
  retainTouchedAfter(syncStartedMs: number): void {
    for (const [path, info] of this.entries) {
      if (info.lastSeenMs <= syncStartedMs) {
        this.entries.delete(path);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  /** Snapshot for the public `getPendingFiles()` surface. `isIndexing` decides the per-entry `indexing` flag. */
  snapshot(isIndexing: (info: PendingEntry) => boolean): PendingFile[] {
    const result: PendingFile[] = [];
    for (const [path, info] of this.entries) {
      result.push({ path, firstSeenMs: info.firstSeenMs, lastSeenMs: info.lastSeenMs, indexing: isIndexing(info) });
    }
    return result;
  }
}
