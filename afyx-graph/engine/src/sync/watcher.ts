/**
 * File Watcher
 *
 * Watches the project directory for file changes and triggers debounced sync
 * operations to keep the code graph up-to-date.
 *
 * This is a thin facade composing five single-responsibility collaborators
 * (Afyx-native architecture, Phase 3B.6):
 *
 *   FsWatchAdapter      — raw OS fs.watch handles, one platform strategy
 *        |                (recursive macOS/Windows, per-directory Linux)
 *        v
 *   watcher-scope         — pure event classification (ignored / scope-
 *        |                  refresh / non-source / source-change)
 *        v
 *   PendingChangeSet     — the one owner of "files seen but not yet synced"
 *        |
 *        v
 *   DebounceScheduler    — the one timer (quick-window vs full debounce,
 *        |                  or a fixed retry backoff)
 *        v
 *   RetryPolicy          — lock-contention vs generic-failure streaks,
 *                          backoff, degrade-threshold decisions
 *
 * This class owns the parts that don't belong to any single collaborator:
 * the public API, `ready`/`waitUntilReady`, the `degradedReason` latch, the
 * `syncing` single-flight flag, `needsFullScan`, and the `flush()` control
 * flow that ties everything together — no other module has a global timer,
 * pending-set, or retry counter of its own.
 *
 * See fs-watch-adapter.ts's module doc for the platform-strategy rationale
 * (bounded O(1)/O(directories) descriptor cost, no chokidar, no native addon).
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildScopeIgnore, type ScopeIgnore } from '../extraction';
import { logDebug, logWarn } from '../errors';
import { normalizePath } from '../utils';
import { watchDisabledReason } from './watch-policy';
import { PendingChangeSet, type PendingFile } from './pending-change-set';
import { RetryPolicy } from './retry-policy';
import { DebounceScheduler } from './debounce-scheduler';
import { classify } from './watcher-scope';
import { FsWatchAdapter, setFsWatchImplForTests, type FsWatchAdapterCallbacks } from './fs-watch-adapter';

export type { PendingFile } from './pending-change-set';

/** @internal Test-only seam to inject a fake fs.watch implementation. */
export function __setFsWatchForTests(fn: typeof fs.watch | null): void {
  setFsWatchImplForTests(fn);
}

const MAX_LOCK_RETRIES = 5;
const MAX_SYNC_FAILURE_RETRIES = 5;
const QUICK_SYNC_MAX_PENDING = 2;
const QUICK_SYNC_QUIET_MS = 300;
const QUICK_SYNC_FLOOR_MS = 100;
const SCOPED_SYNC_MAX_PENDING = 500;

/** Actionable degrade message; both exhaustion paths share it verbatim. */
const EXHAUSTION_REASON =
  'OS watch/file limit exhausted; auto-sync disabled. Run `afyx-graph sync` ' +
  '(or install git sync hooks) to refresh the graph after changes.';

/**
 * Actionable, NON-fatal warning for Linux inotify watch-count exhaustion.
 * Unlike {@link EXHAUSTION_REASON} this does not disable the watcher — the
 * watches already installed keep working — so it names the exact kernel knob to
 * raise instead.
 */
const INOTIFY_LIMIT_REASON =
  'Linux inotify watch limit reached (fs.inotify.max_user_watches); live ' +
  'watching now covers only part of the project, so edits in unwatched ' +
  'directories will not auto-sync. Raise the limit (e.g. `sudo sysctl ' +
  'fs.inotify.max_user_watches=1048576`, persisted in /etc/sysctl.d) and ' +
  'restart, or run `afyx-graph sync` (or install git sync hooks) to refresh.';

/**
 * Test seam (see {@link __emitWatchEventForTests}). Maps a watcher's project
 * root to its live instance so tests can synthesize a change event
 * deterministically — real fs.watch delivery latency races under parallel
 * vitest. Only populated under a test runner, so production carries no
 * bookkeeping or retained references.
 */
const liveWatchersForTests = new Map<string, FileWatcher>();
const IS_TEST_RUNTIME = !!(process.env.VITEST || process.env.NODE_ENV === 'test');

export interface WatchOptions {
  /** Debounce delay in milliseconds. Default: 2000ms */
  debounceMs?: number;
  /** Callback when a sync completes (for logging/diagnostics). */
  onSyncComplete?: (result: { filesChanged: number; durationMs: number }) => void;
  /** Callback when a sync errors (for logging/diagnostics). */
  onSyncError?: (error: Error) => void;
  /**
   * Callback fired ONCE when live watching degrades permanently and auto-sync
   * is disabled — OS watch-resource exhaustion (EMFILE/ENFILE), a write lock
   * held past the retry budget, or a generic sync failure that persists past
   * the retry budget (#1127).
   */
  onDegraded?: (reason: string) => void;
  /**
   * Test-only. When true, `start()` installs NO OS-level fs.watch — the
   * watcher is "inert" and only the {@link __emitWatchEventForTests} /
   * {@link FileWatcher.ingestEventForTests} seam drives its pipeline.
   */
  inertForTests?: boolean;
}

/**
 * Thrown by a `syncFn` to signal that the underlying sync couldn't acquire
 * the cross-process write lock (#449). The watcher treats this as "no
 * progress" — preserves pending files, skips `onSyncComplete`, and reschedules.
 */
export class LockUnavailableError extends Error {
  constructor(message = 'Afyx Graph file lock unavailable; another process is writing') {
    super(message);
    this.name = 'LockUnavailableError';
  }
}

/**
 * FileWatcher monitors a project directory for changes and triggers
 * debounced sync operations via a provided callback.
 */
export class FileWatcher {
  private readonly pending = new PendingChangeSet();
  private readonly retry: RetryPolicy;
  private readonly scheduler: DebounceScheduler;
  private fsAdapter: FsWatchAdapter | null = null;
  private inert = false;

  private degradedReason: string | null = null;
  private syncStartedMs = 0;
  private syncing = false;
  private stopped = false;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  /**
   * True when the pending set does NOT exactly describe the change (a
   * directory removal's children are unknown from the event, #1285) — the
   * next sync must be a full scan-diff. Cleared only after a successful FULL
   * sync reconciles the tree.
   */
  private needsFullScan = false;
  /** The shared scope matcher (see watcher-scope.ts), rebuilt on scope-refresh triggers. */
  private ignoreMatcher: ScopeIgnore | null = null;

  private readonly projectRoot: string;
  private readonly debounceMs: number;
  private readonly syncFn: (paths?: string[]) => Promise<{ filesChanged: number; durationMs: number }>;
  private readonly onSyncComplete?: WatchOptions['onSyncComplete'];
  private readonly onSyncError?: WatchOptions['onSyncError'];
  private readonly onDegraded?: WatchOptions['onDegraded'];
  private readonly inertForTests: boolean;

  constructor(
    projectRoot: string,
    syncFn: (paths?: string[]) => Promise<{ filesChanged: number; durationMs: number }>,
    options: WatchOptions = {}
  ) {
    this.projectRoot = projectRoot;
    this.syncFn = syncFn;
    this.debounceMs = options.debounceMs ?? 2000;
    this.onSyncComplete = options.onSyncComplete;
    this.onSyncError = options.onSyncError;
    this.onDegraded = options.onDegraded;
    this.inertForTests = options.inertForTests ?? false;
    this.retry = new RetryPolicy({
      maxLockRetries: MAX_LOCK_RETRIES,
      maxSyncFailureRetries: MAX_SYNC_FAILURE_RETRIES,
      debounceMs: this.debounceMs,
    });
    this.scheduler = new DebounceScheduler({
      debounceMs: this.debounceMs,
      quickMaxPending: QUICK_SYNC_MAX_PENDING,
      quickQuietMs: QUICK_SYNC_QUIET_MS,
      quickFloorMs: QUICK_SYNC_FLOOR_MS,
    });
  }

  /**
   * Start watching for file changes.
   * Returns true if watching started successfully, false otherwise.
   */
  start(): boolean {
    if ((this.fsAdapter?.isActive ?? false) || this.inert) return true; // Already watching
    this.stopped = false;
    this.degradedReason = null;
    this.retry.reset();

    // Some environments make filesystem watching unusable — most notably
    // WSL2 /mnt/ drives, where the underlying fs.watch calls block long
    // enough to break MCP startup handshakes (issue #199). Skip watching
    // there; callers fall back to manual `afyx-graph sync` or git sync hooks.
    const disabledReason = watchDisabledReason(this.projectRoot);
    if (disabledReason) {
      logDebug('File watcher disabled', { reason: disabledReason, projectRoot: this.projectRoot });
      return false;
    }

    // Reuse the indexer's ignore set so the watcher and indexer agree on scope.
    this.ignoreMatcher = buildScopeIgnore(this.projectRoot);

    try {
      if (this.inertForTests) {
        // Test-only: install no OS watcher; the seam drives events instead.
        this.inert = true;
      } else {
        this.fsAdapter = new FsWatchAdapter(this.projectRoot, this.adapterCallbacks());
        this.fsAdapter.start();
      }

      // A synchronous exhaustion degrade during setup already ran stop(),
      // clearing fsAdapter/inert — surface that as a failed start().
      if (this.degradedReason) return false;

      // No async crawl to wait on: as soon as the watch set is installed we
      // have a clean baseline (pending is only populated by post-start
      // events). Clear defensively and flip ready.
      this.pending.clear();
      this.ready = true;
      for (const cb of this.readyWaiters) cb();
      this.readyWaiters.length = 0;
      if (IS_TEST_RUNTIME) liveWatchersForTests.set(this.projectRoot, this);

      logDebug('File watcher started', {
        projectRoot: this.projectRoot,
        debounceMs: this.debounceMs,
        mode: this.inertForTests ? 'inert' : 'live',
        watchedDirs: this.fsAdapter?.watchedDirCount || undefined,
      });
      return true;
    } catch (err) {
      // Watch-resource exhaustion is terminal — degrade cleanly with one
      // actionable warning instead of leaving a half-broken watcher.
      // Everything else (permission denied, missing directory) keeps the
      // prior quiet-stop.
      if (this.isExhaustionError(err)) {
        this.degrade(EXHAUSTION_REASON, { error: String(err) });
      } else {
        logWarn('Could not start file watcher', { error: String(err) });
        this.stop();
      }
      return false;
    }
  }

  private isExhaustionError(err: unknown): boolean {
    const e = err as NodeJS.ErrnoException | undefined;
    if (e?.code === 'EMFILE' || e?.code === 'ENFILE') return true;
    if (!e?.code && e?.message) return /EMFILE|ENFILE|too many open files/i.test(e.message);
    return false;
  }

  private adapterCallbacks(): FsWatchAdapterCallbacks {
    return {
      onPathEvent: (rel) => this.handleChange(rel),
      onExhaustion: (context) => this.degrade(EXHAUSTION_REASON, context),
      onInotifyLimitReached: (context) => logWarn(INOTIFY_LIMIT_REASON, context),
      onDirCapReached: (cap) =>
        logWarn('File watcher hit directory-watch cap; remaining subtrees rely on manual/periodic sync', { cap }),
      onWarn: (message, context) => logWarn(message, context),
      getIgnoreMatcher: () => this.ignoreMatcher,
    };
  }

  /**
   * Shared change handler for both watch strategies. `rel` is a
   * project-relative POSIX path. Classifies the event (watcher-scope.ts) and,
   * for a real source change, records it as pending (#403) and schedules a
   * debounced sync.
   */
  private handleChange(rel: string): void {
    if (!rel || rel === '.' || rel.startsWith('..')) return;

    const result = classify(rel, this.ignoreMatcher, this.projectRoot);
    switch (result.kind) {
      case 'always-ignored':
      case 'ignored-by-matcher':
        return;
      case 'scope-refresh':
        this.refreshScope(rel);
        return;
      case 'non-source':
        this.maybeScheduleForRemovedDir(rel);
        return;
      case 'source-change':
        break;
    }

    logDebug('File change detected', { file: rel });
    if (this.ready) {
      this.pending.touch(rel, Date.now());
    }
    this.scheduleSync();
  }

  /**
   * A scope-defining file changed (`afyx-graph.json`, a `.gitignore`): rebuild
   * the ignore matcher and make the next sync a FULL reconcile (#1590). See
   * watcher-scope.ts's `classify()` doc for the exact precedence this
   * dispatches from.
   */
  private refreshScope(rel: string): void {
    logDebug('Scope config changed; rebuilding watcher scope', { file: rel });
    this.ignoreMatcher = buildScopeIgnore(this.projectRoot);
    this.needsFullScan = true;
    this.scheduleSync();
  }

  /**
   * A deleted DIRECTORY arrives as one event on the directory's own path — no
   * source extension, so the source-file filter drops it, and the files
   * underneath may never get events of their own (#1285). If the path no
   * longer exists on disk, schedule a full scan-diff (the ground truth for
   * what was underneath); pending is left alone (the children are unknown
   * from the event alone).
   */
  private maybeScheduleForRemovedDir(rel: string): void {
    try {
      fs.statSync(path.join(this.projectRoot, rel));
      return; // still on disk — an ordinary non-source change, ignore
    } catch {
      /* gone — fall through */
    }
    logDebug('Non-source path removed; scheduling sync for possible directory removal', { path: rel });
    this.needsFullScan = true;
    this.scheduleSync();
  }

  /**
   * Permanently disable live watching after a terminal runtime failure.
   * Idempotent: logs one actionable warning, fires {@link WatchOptions.onDegraded}
   * once, and stops the watcher. A subsequent start() clears the latch.
   */
  private degrade(reason: string, context: Record<string, unknown> = {}): void {
    if (this.degradedReason) return;
    this.degradedReason = reason;
    logWarn('File watcher disabled', { projectRoot: this.projectRoot, reason, ...context });
    this.onDegraded?.(reason);
    this.stop();
  }

  /** Whether live watching has degraded permanently (until the next start()). */
  isDegraded(): boolean {
    return this.degradedReason !== null;
  }

  /** The reason live watching degraded, or null if it is healthy. */
  getDegradedReason(): string | null {
    return this.degradedReason;
  }

  /** Stop watching for file changes. */
  stop(): void {
    this.stopped = true;
    this.scheduler.cancel();
    this.fsAdapter?.stop();
    this.fsAdapter = null;
    // NB: degradedReason is intentionally NOT reset here — it must survive the
    // stop() that degrade() triggers so isDegraded() stays true. start() clears it.
    this.inert = false;
    this.pending.clear();
    this.ready = false;
    this.ignoreMatcher = null;
    if (IS_TEST_RUNTIME) liveWatchersForTests.delete(this.projectRoot);
    logDebug('File watcher stopped');
  }

  /**
   * @internal Test-only: feed a synthetic project-relative change through the
   * same filter -> pending -> debounced-sync path a real fs.watch event
   * takes. See {@link __emitWatchEventForTests}.
   */
  ingestEventForTests(relPath: string): void {
    this.handleChange(normalizePath(relPath));
  }

  /** Whether the watcher is currently active. */
  isActive(): boolean {
    return ((this.fsAdapter?.isActive ?? false) || this.inert) && !this.stopped;
  }

  /**
   * Resolves once the watch set has been installed (or immediately if it
   * already has).
   */
  waitUntilReady(timeoutMs = 10000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const idx = this.readyWaiters.indexOf(handler);
        if (idx >= 0) this.readyWaiters.splice(idx, 1);
        reject(new Error(`FileWatcher.waitUntilReady timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const handler = () => {
        clearTimeout(t);
        resolve();
      };
      this.readyWaiters.push(handler);
    });
  }

  /** Schedule a normal debounced sync after a source edit (adaptive quick-window vs full debounce). */
  private scheduleSync(): void {
    this.scheduler.scheduleSync(this.pending.size, () => this.flush());
  }

  /** Schedule a retry after a recoverable sync failure, with exponential backoff. */
  private scheduleRetrySync(delayMs: number): void {
    this.scheduler.scheduleRetry(delayMs, () => this.flush());
  }

  /**
   * Flush pending changes by running sync.
   *
   * The pending set is NOT cleared at the start of sync — entries are removed
   * only after sync commits successfully, and only for entries whose
   * lastSeenMs <= syncStartedMs (see PendingChangeSet.retainTouchedAfter). On
   * sync failure the pending set is left completely untouched.
   */
  private async flush(): Promise<void> {
    // If already syncing, the post-sync check will re-trigger.
    if (this.syncing || this.stopped) return;

    this.syncStartedMs = Date.now();
    this.syncing = true;

    // Scoped fast path: when every pending change is a known file event, hand
    // the exact paths to sync and skip its O(repo) scan-diff. Anything the
    // events can't fully describe — a directory removal, an empty pending set
    // (retry paths), or an event storm past the ceiling — runs the full
    // scan-diff, which remains the ground truth.
    const scoped =
      !this.needsFullScan && this.pending.size > 0 && this.pending.size <= SCOPED_SYNC_MAX_PENDING
        ? this.pending.paths()
        : undefined;

    try {
      const result = await this.syncFn(scoped);
      if (!scoped) this.needsFullScan = false;
      this.retry.recordSuccess();
      this.pending.retainTouchedAfter(this.syncStartedMs);
      this.onSyncComplete?.(result);
    } catch (err) {
      if (err instanceof LockUnavailableError) {
        const outcome = this.retry.recordLockFailure();
        // Lock-failure no-op (another writer holds the lock). pending stays
        // intact and the finally block reschedules with backoff. Keep brief
        // contention quiet (debug-only), but stop retrying forever past the
        // budget.
        logDebug('Watch sync skipped: file lock unavailable', {
          pendingFiles: this.pending.size,
          retryCount: outcome.activeRetryCount,
        });
        if (outcome.shouldDegrade) {
          this.degrade(
            'Afyx Graph file lock held by another process past the retry budget; ' +
              'auto-sync disabled. Run `afyx-graph sync` once the other writer finishes ' +
              '(or install git sync hooks) to refresh the graph.',
            { pendingFiles: this.pending.size, retryCount: outcome.activeRetryCount }
          );
        }
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        const outcome = this.retry.recordGenericFailure();
        logWarn('Watch sync failed', { error: error.message, retryCount: outcome.activeRetryCount });
        this.onSyncError?.(error);
        // A persistent (deterministic) sync failure would otherwise retry
        // forever at the debounce cadence — bound it exactly like lock
        // contention: back off exponentially, and past the budget degrade so
        // the dead auto-update guarantee is surfaced instead of hidden.
        if (outcome.shouldDegrade) {
          this.degrade(
            `Afyx Graph auto-sync failed ${outcome.activeRetryCount} times in a row; ` +
              'auto-sync disabled. Run `afyx-graph sync` (or install git sync hooks) to ' +
              `refresh the graph after changes. Last error: ${error.message}`,
            { error: error.message, retryCount: outcome.activeRetryCount }
          );
        }
      }
      // Failure: leave pending untouched. Every edit it tracks is still
      // unindexed; the rescheduled sync sees the same set.
    } finally {
      this.syncing = false;

      // If pending files remain (mid-sync events, or this sync failed),
      // schedule another pass. After EITHER failure mode, back off
      // exponentially instead of retrying at the normal debounce cadence; a
      // clean sync resets both counters so normal edits keep the fast
      // debounce. A degrade() above already set `stopped`, so this won't
      // reschedule a watcher that has given up.
      if (this.pending.size > 0 && !this.stopped) {
        const retryCount = this.retry.activeRetryCount;
        if (retryCount > 0) {
          this.scheduleRetrySync(this.retry.backoffDelayMs(retryCount));
        } else {
          this.scheduleSync();
        }
      }
    }
  }

  /**
   * Snapshot of files seen by the watcher since the last successful sync.
   * `indexing` is true when a sync is currently in flight whose start time is
   * AFTER this file's most recent event — i.e. that sync will absorb the edit.
   */
  getPendingFiles(): PendingFile[] {
    return this.pending.snapshot((info) => this.syncing && this.syncStartedMs >= info.lastSeenMs);
  }
}

/**
 * Test-only: synthesize a source-file change for the live watcher running at
 * `projectRoot`, exercising the real filter -> pending -> debounced-sync
 * logic without depending on fs.watch delivery timing. `relPath` is
 * project-relative POSIX (e.g. "src/foo.ts"). Returns false if no live
 * watcher is registered for that root.
 */
export function __emitWatchEventForTests(projectRoot: string, relPath: string): boolean {
  const w = liveWatchersForTests.get(projectRoot);
  if (!w) return false;
  w.ingestEventForTests(relPath);
  return true;
}
