/**
 * Phase 3B.6 — Afyx Sync/Watcher characterization contract.
 *
 * Freezes the observable behavior of FileWatcher (src/sync/watcher.ts),
 * watch-policy (src/sync/watch-policy.ts), and freshness (src/freshness.ts)
 * BEFORE the Afyx-native rewrite, so the rewrite can be verified against it
 * byte-for-byte in intent (not byte-for-byte in implementation).
 *
 * Uses the same `inertForTests` + `__emitWatchEventForTests` seams as
 * __tests__/watcher.test.ts for deterministic event delivery — no OS fs.watch
 * involved in the deterministic scenarios below. The debounce/retry timers
 * ARE real (setTimeout), matching the existing suite's proven-stable style;
 * timing constants are chosen with wide margins around the documented
 * thresholds (QUICK_SYNC_QUIET_MS=300 floor 100, debounceMs, retry backoff)
 * so assertions are not sensitive to normal CI scheduling jitter.
 *
 * This file is NOT a golden/JSON-diffed contract (unlike the DB/Graph/Search
 * contracts) because FileWatcher is a stateful, timer-driven class exercised
 * through its own TypeScript API, not a CLI/MCP subprocess or a pure function
 * over serializable inputs — assertion-based characterization (the same style
 * __tests__/watcher.test.ts already uses) is the correct seam here, exactly as
 * __tests__/file-graph-walk.test.ts used fake-store assertions rather than a
 * golden file for a comparable in-process, newly-isolated primitive.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  FileWatcher,
  LockUnavailableError,
  __emitWatchEventForTests,
  __setFsWatchForTests,
  type WatchOptions,
} from '../src/sync/watcher';
import {
  watchDisabledReason,
  detectWsl,
  __resetWslCacheForTests,
  type WatchProbe,
} from '../src/sync/watch-policy';
import { writeFreshness, getFreshness, FRESHNESS_FILE_NAME } from '../src/freshness';
import { getAfyxGraphDir, getDatabasePath } from '../src/directory';

type SyncFn = (paths?: string[]) => Promise<{ filesChanged: number; durationMs: number }>;
type SyncResult = { filesChanged: number; durationMs: number };

// Several scenarios here (degradation after MAX_*_RETRIES, real `git`
// subprocess spawns inside refreshScope) legitimately need internal waitFor
// budgets above vitest's 5000ms default test timeout; raise it file-wide
// instead of annotating every single `it(...)` call.
vi.setConfig({ testTimeout: 15000 });

function waitFor(condition: () => boolean, timeoutMs = 3000, intervalMs = 15): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/** A syncFn that resolves after `ms` — used to hold "syncing" open deliberately. */
function slowSync(ms: number, result: SyncResult = { filesChanged: 1, durationMs: ms }): SyncFn {
  return () => new Promise((resolve) => setTimeout(() => resolve(result), ms));
}

describe('Sync/Watcher contract (Phase 3B.6 freeze)', () => {
  let testDir: string;

  const newWatcher = (syncFn: SyncFn, opts: WatchOptions = {}) =>
    new FileWatcher(testDir, syncFn, { inertForTests: true, ...opts });

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-sync-contract-'));
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(path.join(testDir, 'src', 'index.ts'), 'export const x = 1;\n');
  });

  afterEach(() => {
    __setFsWatchForTests(null);
    vi.restoreAllMocks();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ============================================================
  // 1. LIFECYCLE: start / stop / ready
  // ============================================================
  describe('1. lifecycle', () => {
    it('1.1 start() returns true and isActive() true', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      expect(w.start()).toBe(true);
      expect(w.isActive()).toBe(true);
      w.stop();
    });

    it('1.2 stop() returns isActive() false', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      w.start();
      w.stop();
      expect(w.isActive()).toBe(false);
    });

    it('1.3 double start() is idempotent (still returns true, still active)', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      expect(w.start()).toBe(true);
      expect(w.start()).toBe(true);
      expect(w.isActive()).toBe(true);
      w.stop();
    });

    it('1.3b stop() nulls out the debounce timer handle, not just guarding against it firing', async () => {
      // flush()'s own `if (this.syncing || this.stopped) return;` guard means
      // a stray, un-cleared timer object is harmless for syncFn-call
      // observability alone — but a real Node Timeout left alive after stop()
      // is exactly the kind of handle/timer leak the Windows/Linux leak
      // contract cares about (many start/stop cycles must not accumulate live
      // timers). Assert the field directly rather than only its side effect.
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 5000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts'); // arms the debounce timer
      expect((w as any).scheduler.isArmed).toBe(true);
      w.stop();
      expect((w as any).scheduler.isArmed).toBe(false);
    });

    it('1.4 double stop() is idempotent (no throw)', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      w.start();
      expect(() => {
        w.stop();
        w.stop();
      }).not.toThrow();
      expect(w.isActive()).toBe(false);
    });

    it('1.5 stop() before start() is a safe no-op', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      expect(() => w.stop()).not.toThrow();
      expect(w.isActive()).toBe(false);
    });

    it('1.6 restart after stop() works (start returns true again, isActive true)', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      w.start();
      w.stop();
      expect(w.start()).toBe(true);
      expect(w.isActive()).toBe(true);
      w.stop();
    });

    it('1.7 waitUntilReady() resolves immediately once already ready', async () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      w.start();
      await expect(w.waitUntilReady(500)).resolves.toBeUndefined();
      w.stop();
    });

    it('1.8 waitUntilReady() before start() times out', async () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      await expect(w.waitUntilReady(50)).rejects.toThrow(/timed out/);
    });

    it('1.9 stop() clears pendingFiles', async () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      expect(w.getPendingFiles().length).toBe(1);
      w.stop();
      expect(w.getPendingFiles().length).toBe(0);
    });

    it('1.10 stop() during an active debounce timer cancels the pending sync (never fires)', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 150 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      w.stop();
      await new Promise((r) => setTimeout(r, 300));
      expect(syncFn).not.toHaveBeenCalled();
    });

    it('1.11 stop() during an in-flight sync leaves isActive() false immediately (sync still resolves in background)', async () => {
      const w = newWatcher(slowSync(200), { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => (w as any).syncing === true, 1000);
      w.stop();
      expect(w.isActive()).toBe(false);
    });

    it('1.12 start() while watch-disabled by env returns false and stays inactive', () => {
      const prior = process.env.AFYX_GRAPH_NO_WATCH;
      process.env.AFYX_GRAPH_NO_WATCH = '1';
      try {
        const w = new FileWatcher(testDir, vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), {});
        expect(w.start()).toBe(false);
        expect(w.isActive()).toBe(false);
      } finally {
        if (prior === undefined) delete process.env.AFYX_GRAPH_NO_WATCH;
        else process.env.AFYX_GRAPH_NO_WATCH = prior;
      }
    });
  });

  // ============================================================
  // 2. CONSTANTS / THRESHOLD BOUNDARIES
  // ============================================================
  describe('2. threshold boundaries', () => {
    it('2.1 QUICK_SYNC_MAX_PENDING boundary: 2 pending files use the quick window (fires well under debounceMs)', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 2, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 1000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      __emitWatchEventForTests(testDir, 'src/b.ts');
      await waitFor(() => syncFn.mock.calls.length > 0, 700); // well under 1000ms debounce
      w.stop();
    });

    it('2.2 QUICK_SYNC_MAX_PENDING boundary: 3 pending files use the FULL debounce (does not fire in the quick window)', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 3, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 1000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      __emitWatchEventForTests(testDir, 'src/b.ts');
      __emitWatchEventForTests(testDir, 'src/c.ts');
      await new Promise((r) => setTimeout(r, 450)); // past the ~300ms quick window
      expect(syncFn).not.toHaveBeenCalled();
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      w.stop();
    });

    it('2.3 quick window is floored at 100ms even with a smaller debounceMs', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 1, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      // Should not fire before the 100ms floor even though debounceMs=30.
      await new Promise((r) => setTimeout(r, 60));
      expect(syncFn).not.toHaveBeenCalled();
      await waitFor(() => syncFn.mock.calls.length > 0, 500);
      w.stop();
    });

    it('2.4 SCOPED_SYNC_MAX_PENDING boundary: 500 pending paths still pass a scoped array', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 500, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 100 });
      w.start();
      for (let i = 0; i < 500; i++) __emitWatchEventForTests(testDir, `src/f${i}.ts`);
      await waitFor(() => syncFn.mock.calls.length > 0, 2000);
      const arg = syncFn.mock.calls[0][0];
      expect(Array.isArray(arg)).toBe(true);
      expect((arg as string[]).length).toBe(500);
      w.stop();
    });

    it('2.5 SCOPED_SYNC_MAX_PENDING boundary: 501 pending paths force a full reconcile (undefined arg)', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 501, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 100 });
      w.start();
      for (let i = 0; i < 501; i++) __emitWatchEventForTests(testDir, `src/f${i}.ts`);
      await waitFor(() => syncFn.mock.calls.length > 0, 2000);
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      w.stop();
    });

    it('2.6 MAX_LOCK_RETRIES boundary: exactly 6 syncFn calls occur before degrading (5 retries + the one that crosses the budget)', async () => {
      const onDegraded = vi.fn();
      const syncFn = vi.fn().mockRejectedValue(new LockUnavailableError());
      const w = newWatcher(syncFn, { debounceMs: 20, onDegraded });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => onDegraded.mock.calls.length > 0, 8000);
      expect(syncFn.mock.calls.length).toBe(6);
      w.stop();
    });

    it('2.7 MAX_SYNC_FAILURE_RETRIES boundary: exactly 6 syncFn calls occur before degrading on generic failures', async () => {
      const onDegraded = vi.fn();
      const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const w = newWatcher(syncFn, { debounceMs: 20, onDegraded });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => onDegraded.mock.calls.length > 0, 8000);
      expect(syncFn.mock.calls.length).toBe(6);
      w.stop();
    });

    it('2.8 AFYX_GRAPH_MAX_DIR_WATCHES: non-numeric value is ignored (falls back to default, does not throw)', () => {
      const prior = process.env.AFYX_GRAPH_MAX_DIR_WATCHES;
      process.env.AFYX_GRAPH_MAX_DIR_WATCHES = 'not-a-number';
      try {
        const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
        expect(() => w.start()).not.toThrow();
        w.stop();
      } finally {
        if (prior === undefined) delete process.env.AFYX_GRAPH_MAX_DIR_WATCHES;
        else process.env.AFYX_GRAPH_MAX_DIR_WATCHES = prior;
      }
    });
  });

  // ============================================================
  // 3. PENDING-PATH SEMANTICS
  // ============================================================
  describe('3. pending-path semantics', () => {
    it('3.1 a single event adds exactly one pending entry with matching firstSeenMs/lastSeenMs', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      const pending = w.getPendingFiles();
      expect(pending.length).toBe(1);
      expect(pending[0].path).toBe('src/a.ts');
      expect(pending[0].firstSeenMs).toBe(pending[0].lastSeenMs);
      w.stop();
    });

    it('3.2 the same path repeated keeps firstSeenMs from the first event and advances lastSeenMs', async () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      const first = w.getPendingFiles()[0].firstSeenMs;
      await new Promise((r) => setTimeout(r, 20));
      __emitWatchEventForTests(testDir, 'src/a.ts');
      const pending = w.getPendingFiles();
      expect(pending.length).toBe(1);
      expect(pending[0].firstSeenMs).toBe(first);
      expect(pending[0].lastSeenMs).toBeGreaterThanOrEqual(first);
      w.stop();
    });

    it('3.3 two distinct paths produce two pending entries', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      __emitWatchEventForTests(testDir, 'src/b.ts');
      expect(w.getPendingFiles().map((p) => p.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
      w.stop();
    });

    it('3.4 scoped path array preserves first-seen insertion order, not most-recently-touched order and not sorted order', async () => {
      // Deliberately NOT alphabetical (zebra/apple/mango): a naive `.sort()`
      // of the pending set would silently produce a different, wrong order
      // here, whereas alphabetically-named paths could pass either way.
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 3, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 200 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/zebra.ts');
      __emitWatchEventForTests(testDir, 'src/apple.ts');
      __emitWatchEventForTests(testDir, 'src/mango.ts');
      // Re-touch 'zebra' last — insertion order must still be zebra, apple,
      // mango (not zebra moved to the end, and not alphabetically resorted).
      __emitWatchEventForTests(testDir, 'src/zebra.ts');
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      expect(syncFn.mock.calls[0][0]).toEqual(['src/zebra.ts', 'src/apple.ts', 'src/mango.ts']);
      w.stop();
    });

    it('3.5 an ignored file (.afyx-graph/*) never becomes pending', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      __emitWatchEventForTests(testDir, '.afyx-graph/afyx-graph.db');
      expect(w.getPendingFiles().length).toBe(0);
      w.stop();
    });

    it('3.6 a .git/* path (other than .git/info/exclude) never becomes pending', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      __emitWatchEventForTests(testDir, '.git/HEAD');
      expect(w.getPendingFiles().length).toBe(0);
      w.stop();
    });

    it('3.7 an unsupported (non-source) extension never becomes pending', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      fs.writeFileSync(path.join(testDir, 'README.txt'), 'unsupported');
      __emitWatchEventForTests(testDir, 'README.txt');
      expect(w.getPendingFiles().length).toBe(0);
      w.stop();
    });

    it('3.8 events before ready (synthetic, pre-start) are not tracked as pending', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      // Not started: __emitWatchEventForTests only finds a *live* registered watcher,
      // so this call is a documented no-op (returns false) rather than reaching handleChange.
      const delivered = __emitWatchEventForTests(testDir, 'src/a.ts');
      expect(delivered).toBe(false);
    });

    it('3.9 empty pending set produces getPendingFiles() === []', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      w.start();
      expect(w.getPendingFiles()).toEqual([]);
      w.stop();
    });

    it('3.10 getPendingFiles()[].indexing is false while still in the debounce window', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }), { debounceMs: 30_000 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      expect(w.getPendingFiles()[0].indexing).toBe(false);
      w.stop();
    });

    it('3.11 getPendingFiles()[].indexing is true once a sync claiming that event is in flight', async () => {
      const w = newWatcher(slowSync(300), { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => (w as any).syncing === true, 1000);
      expect(w.getPendingFiles()[0].indexing).toBe(true);
      w.stop();
    });
  });

  // ============================================================
  // 4. DURING-SYNC PRESERVATION RULE (load-bearing)
  // ============================================================
  describe('4. during-sync event preservation', () => {
    it('4.1 a file that changes again DURING an in-flight sync remains pending after that sync succeeds', async () => {
      let releaseSync!: () => void;
      const gate = new Promise<void>((r) => (releaseSync = r));
      const syncFn: SyncFn = vi.fn(async () => {
        await gate;
        return { filesChanged: 1, durationMs: 0 };
      });
      const w = newWatcher(syncFn, { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => (syncFn as any).mock.calls.length > 0, 1000); // sync has started
      // See 4.2's comment: a few ms clear of syncStartedMs avoids the
      // same-millisecond Date.now() ambiguity in the post-sync removal rule.
      await new Promise((r) => setTimeout(r, 20));
      // File A changes again mid-sync.
      __emitWatchEventForTests(testDir, 'src/a.ts');
      releaseSync();
      await waitFor(() => (syncFn as any).mock.calls.length > 1, 5000); // a follow-up sync was scheduled
      // Required: 'a' was retained across the first sync's success (that's WHY a
      // second sync was scheduled/observed at all for the same lone pending file).
      expect((syncFn as any).mock.calls.length).toBeGreaterThanOrEqual(2);
      w.stop();
    });

    it('4.2 a NEW file B arriving during an in-flight sync is preserved for the next pass', async () => {
      let releaseSync!: () => void;
      const gate = new Promise<void>((r) => (releaseSync = r));
      const syncFn: SyncFn = vi.fn(async () => {
        await gate;
        return { filesChanged: 1, durationMs: 0 };
      });
      const w = newWatcher(syncFn, { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => (syncFn as any).mock.calls.length > 0, 1000);
      // A small buffer past syncStartedMs's capture: Date.now() has only
      // millisecond granularity, and the post-sync removal rule compares with
      // `<=` — an event landing in the SAME millisecond as syncStartedMs would
      // be (mis)classified as "covered by this sync" regardless of true causal
      // order. A few ms of real separation removes that ambiguity zone without
      // changing what's being tested ('b' still arrives well before the gate
      // is released, i.e. still genuinely mid-sync).
      await new Promise((r) => setTimeout(r, 20));
      __emitWatchEventForTests(testDir, 'src/b.ts'); // new file, arrives mid-sync
      expect(w.getPendingFiles().map((p) => p.path)).toContain('src/b.ts');
      releaseSync();
      // 'b' must eventually show up in SOME later syncFn call's argument list
      // (scoped or, if a full reconcile was forced for any incidental reason,
      // that call's arg is undefined and the file is still covered by it) —
      // checked by outcome (b gets absorbed, never silently dropped) rather
      // than pinning an exact call index, which is what actually matters here.
      await waitFor(() => !w.getPendingFiles().some((p) => p.path === 'src/b.ts'), 10000);
      const laterCalls = (syncFn as any).mock.calls.slice(1) as Array<[string[] | undefined]>;
      expect(laterCalls.length).toBeGreaterThan(0);
      expect(laterCalls.some(([arg]) => arg === undefined || arg.includes('src/b.ts'))).toBe(true);
      w.stop();
    });

    it('4.3 a file whose lastSeenMs is BEFORE sync start is removed once that sync succeeds', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 1, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      await waitFor(() => w.getPendingFiles().length === 0, 1000);
    });

    it('4.4 on sync FAILURE, pendingFiles is left completely untouched (no removal at all)', async () => {
      const syncFn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ filesChanged: 1, durationMs: 0 });
      const onSyncError = vi.fn();
      const w = newWatcher(syncFn, { debounceMs: 30, onSyncError });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => onSyncError.mock.calls.length > 0, 1000);
      expect(w.getPendingFiles().map((p) => p.path)).toEqual(['src/a.ts']);
      w.stop();
    });
  });

  // ============================================================
  // 5. SINGLE-FLIGHT SEMANTICS
  // ============================================================
  describe('5. single-flight', () => {
    it('5.1 while a sync is in flight, no second concurrent syncFn call is made even as more events arrive', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const syncFn: SyncFn = vi.fn(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 150));
        concurrent--;
        return { filesChanged: 1, durationMs: 0 };
      });
      const w = newWatcher(syncFn, { debounceMs: 20 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => (syncFn as any).mock.calls.length > 0, 1000);
      __emitWatchEventForTests(testDir, 'src/b.ts');
      __emitWatchEventForTests(testDir, 'src/c.ts');
      await new Promise((r) => setTimeout(r, 250));
      expect(maxConcurrent).toBe(1);
      w.stop();
    });
  });

  // ============================================================
  // 6. DEBOUNCE / TIMER RE-ARM
  // ============================================================
  describe('6. debounce timer behavior', () => {
    it('6.1 a new event resets the debounce timer (trailing edge, not leading edge)', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 1, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 300 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      __emitWatchEventForTests(testDir, 'src/b.ts');
      __emitWatchEventForTests(testDir, 'src/c.ts'); // keeps re-arming the same 300ms window
      await new Promise((r) => setTimeout(r, 200));
      // A fresh event at t=200ms should push firing out to ~500ms, not let it
      // fire at the original ~300ms mark.
      __emitWatchEventForTests(testDir, 'src/d.ts');
      await new Promise((r) => setTimeout(r, 200)); // total elapsed ~400ms since first event
      expect(syncFn).not.toHaveBeenCalled();
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      w.stop();
    });

    it('6.2 a successful sync leaving pending entries (during-sync arrivals) schedules a follow-up via the normal debounce policy, not instantly', async () => {
      let releaseSync!: () => void;
      const gate = new Promise<void>((r) => (releaseSync = r));
      const syncFn: SyncFn = vi.fn(async () => {
        await gate;
        return { filesChanged: 1, durationMs: 0 };
      });
      const w = newWatcher(syncFn, { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => (syncFn as any).mock.calls.length > 0, 1000);
      // See 4.2's comment: clear the same-millisecond Date.now() ambiguity zone.
      await new Promise((r) => setTimeout(r, 20));
      __emitWatchEventForTests(testDir, 'src/a.ts'); // during-sync re-touch
      releaseSync();
      await waitFor(() => (syncFn as any).mock.calls.length > 1, 5000);
      w.stop();
    });
  });

  // ============================================================
  // 7. LOCK-RETRY SEMANTICS
  // ============================================================
  describe('7. lock retry semantics', () => {
    it('7.1 LockUnavailableError preserves pendingFiles across the failure', async () => {
      const syncFn = vi.fn().mockRejectedValue(new LockUnavailableError());
      const w = newWatcher(syncFn, { debounceMs: 20 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length >= 2, 2000);
      expect(w.getPendingFiles().map((p) => p.path)).toEqual(['src/a.ts']);
      w.stop();
    });

    it('7.2 onSyncError is NOT invoked for LockUnavailableError (quiet, distinct from generic failure)', async () => {
      const onSyncError = vi.fn();
      const syncFn = vi.fn().mockRejectedValue(new LockUnavailableError());
      const w = newWatcher(syncFn, { debounceMs: 20, onSyncError });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length >= 3, 2000);
      expect(onSyncError).not.toHaveBeenCalled();
      w.stop();
    });

    it('7.3 a successful sync after lock contention resets the retry counter (a fresh run of failures afterward needs its own full budget)', async () => {
      // A single trailing success proves nothing on its own: with no more
      // pending files, the watcher makes no further calls regardless of
      // whether the counter was reset. The counter is only OBSERVABLE by
      // forcing MORE failures afterward and checking whether they degrade on
      // their own schedule (reset: needs a full fresh budget) or immediately
      // (not reset: the old streak's count carries over).
      const onDegraded = vi.fn();
      let call = 0;
      const syncFn: SyncFn = vi.fn(async () => {
        call++;
        if (call <= 3) throw new LockUnavailableError(); // 3 lock failures
        if (call === 4) return { filesChanged: 1, durationMs: 0 }; // 1 success (should reset)
        throw new LockUnavailableError(); // 4 MORE lock failures afterward
      });
      const w = newWatcher(syncFn, { debounceMs: 15, onDegraded });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length >= 4, 2000); // through the success
      // pendingFiles is now empty (the success absorbed it) — re-touch to
      // restart the failure sequence.
      __emitWatchEventForTests(testDir, 'src/a.ts');
      // 4 more lock failures: if the counter was properly reset to 0 at the
      // success, 4 more never crosses MAX_LOCK_RETRIES=5 -> no degrade. If it
      // were NOT reset (still 3), 4 more would reach 7, crossing 5 partway
      // through -> degrade. Waiting for all 4 extra calls and asserting no
      // degrade distinguishes the two.
      await waitFor(() => syncFn.mock.calls.length >= 8, 3000);
      expect(onDegraded).not.toHaveBeenCalled();
      w.stop();
    });

    it('7.4 a non-lock failure resets the lock-retry streak (mixed failures do not sum toward the lock budget)', async () => {
      // Same distinguishing shape as 7.3: 3 lock failures, then 1 generic
      // failure (should reset the LOCK streak specifically to 0), then 4 MORE
      // lock failures. Reset: 4 more stays under budget (5), no degrade.
      // Not reset: 3 (carried over) + 4 more = 7, crosses 5, degrades.
      const onDegraded = vi.fn();
      let call = 0;
      const syncFn: SyncFn = vi.fn(async () => {
        call++;
        if (call === 4) throw new Error('generic');
        throw new LockUnavailableError();
      });
      const w = newWatcher(syncFn, { debounceMs: 15, onDegraded });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length >= 8, 4000);
      expect(onDegraded).not.toHaveBeenCalled();
      w.stop();
    });
  });

  // ============================================================
  // 8. GENERIC SYNC-FAILURE RETRY SEMANTICS
  // ============================================================
  describe('8. generic sync-failure retry semantics', () => {
    it('8.1 a generic failure preserves pendingFiles across the failure', async () => {
      const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const w = newWatcher(syncFn, { debounceMs: 20 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length >= 2, 2000);
      expect(w.getPendingFiles().map((p) => p.path)).toEqual(['src/a.ts']);
      w.stop();
    });

    it('8.2 onSyncError fires once per generic failure with the thrown Error', async () => {
      const onSyncError = vi.fn();
      const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const w = newWatcher(syncFn, { debounceMs: 20, onSyncError });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => onSyncError.mock.calls.length >= 2, 2000);
      expect(onSyncError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onSyncError.mock.calls[0][0].message).toBe('boom');
      w.stop();
    });

    it('8.3 a non-Error throw is wrapped into an Error for onSyncError', async () => {
      const onSyncError = vi.fn();
      const syncFn: SyncFn = vi.fn().mockRejectedValue('a string failure');
      const w = newWatcher(syncFn, { debounceMs: 20, onSyncError });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => onSyncError.mock.calls.length > 0, 2000);
      expect(onSyncError.mock.calls[0][0]).toBeInstanceOf(Error);
      w.stop();
    });

    it('8.4 a clean sync after generic failures resets the failure counter (a fresh run afterward needs its own full budget)', async () => {
      // Same distinguishing shape as 7.3: a single trailing success proves
      // nothing on its own (no more pending files -> no more calls either
      // way). Force MORE failures afterward: reset means 4 more stays under
      // budget (5); not reset means 3 (carried over) + 4 more = 7, crossing 5.
      const onDegraded = vi.fn();
      let call = 0;
      const syncFn: SyncFn = vi.fn(async () => {
        call++;
        if (call <= 3) throw new Error('boom');
        if (call === 4) return { filesChanged: 1, durationMs: 0 };
        throw new Error('boom again');
      });
      const w = newWatcher(syncFn, { debounceMs: 20, onDegraded });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length >= 4, 2000); // through the success
      __emitWatchEventForTests(testDir, 'src/a.ts'); // pendingFiles was cleared; re-touch
      await waitFor(() => syncFn.mock.calls.length >= 8, 3000);
      expect(onDegraded).not.toHaveBeenCalled();
      w.stop();
    });
  });

  // ============================================================
  // 9. DEGRADATION SEMANTICS
  // ============================================================
  describe('9. degradation semantics', () => {
    it('9.1 onDegraded fires exactly once even if failures continue after degrading', async () => {
      const onDegraded = vi.fn();
      const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const w = newWatcher(syncFn, { debounceMs: 15, onDegraded });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => onDegraded.mock.calls.length > 0, 3000);
      await new Promise((r) => setTimeout(r, 200));
      expect(onDegraded).toHaveBeenCalledTimes(1);
    });

    it('9.2 isDegraded()/getDegradedReason() reflect the degrade and survive stop()', async () => {
      const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const w = newWatcher(syncFn, { debounceMs: 15 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => w.isDegraded(), 3000);
      const reason = w.getDegradedReason();
      expect(reason).toBeTruthy();
      w.stop();
      // Explicitly load-bearing: stop() must NOT clear a degrade latch.
      expect(w.isDegraded()).toBe(true);
      expect(w.getDegradedReason()).toBe(reason);
    });

    it('9.3 a fresh start() clears the degrade latch', async () => {
      const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const w = newWatcher(syncFn, { debounceMs: 15 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => w.isDegraded(), 3000);
      w.stop();
      w.start();
      expect(w.isDegraded()).toBe(false);
      expect(w.getDegradedReason()).toBeNull();
      w.stop();
    });

    it('9.4 degrade() implies the watcher becomes inactive (stop() runs)', async () => {
      const syncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const w = newWatcher(syncFn, { debounceMs: 15 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => w.isDegraded(), 3000);
      expect(w.isActive()).toBe(false);
    });

    it('9.5 a healthy watcher reports isDegraded() === false and getDegradedReason() === null', () => {
      const w = newWatcher(vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 }));
      w.start();
      expect(w.isDegraded()).toBe(false);
      expect(w.getDegradedReason()).toBeNull();
      w.stop();
    });
  });

  // ============================================================
  // 10. SCOPE REFRESH / IGNORE ORDERING
  // ============================================================
  describe('10. scope refresh and ignore precedence', () => {
    it('10.1 a root .gitignore change schedules a sync (via scope refresh) even with no other pending files', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'dist/\n');
      const w = newWatcher(syncFn, { debounceMs: 50 });
      w.start();
      __emitWatchEventForTests(testDir, '.gitignore');
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      // A scope-refresh sync is always a FULL reconcile (undefined arg).
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      w.stop();
    });

    it('10.2 afyx-graph.json changes trigger a scope refresh + full-sync request', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 50 });
      w.start();
      __emitWatchEventForTests(testDir, 'afyx-graph.json');
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      w.stop();
    });

    it("10.2b a user's own .gitignore rule that would otherwise hide afyx-graph.json cannot suppress its own scope-refresh (#1590)", async () => {
      // The root scope-file carve-out must be checked BEFORE the ignore
      // matcher: a `*.json` (or `.*`) rule in the user's own .gitignore would
      // otherwise make their own afyx-graph.json edits invisible to the
      // watcher. Requires a real .gitignore on disk since buildScopeIgnore()
      // reads it directly.
      fs.writeFileSync(path.join(testDir, '.gitignore'), '*.json\n');
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 50 });
      w.start();
      __emitWatchEventForTests(testDir, 'afyx-graph.json');
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      w.stop();
    });

    it('10.3 .git/info/exclude is let through for scope refresh despite being under .git/', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 50 });
      w.start();
      __emitWatchEventForTests(testDir, '.git/info/exclude');
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      w.stop();
    });

    it('10.4 a nested .gitignore under an IGNORED directory (node_modules) does NOT trigger a scope refresh', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 80 });
      w.start();
      __emitWatchEventForTests(testDir, 'node_modules/pkg/.gitignore');
      await new Promise((r) => setTimeout(r, 200));
      expect(syncFn).not.toHaveBeenCalled();
      w.stop();
    });

    it('10.5 a nested .gitignore INSIDE current scope (src/feature/.gitignore) triggers a scope refresh', async () => {
      // NB: 'vendor' is itself a built-in default-ignored directory name (see
      // src/extraction/index.ts's DEFAULT_IGNORE_DIRS-equivalent list) — using
      // it here would test the SAME "already-ignored, no refresh" case as 10.4
      // rather than a genuinely in-scope nested .gitignore. 'feature' is not on
      // that list.
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 50 });
      w.start();
      __emitWatchEventForTests(testDir, 'src/feature/.gitignore');
      await waitFor(() => syncFn.mock.calls.length > 0, 3000);
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      w.stop();
    });

    it('10.6 a deleted non-source path (already gone from disk) schedules a full-scan sync', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 50 });
      w.start();
      // 'docs/removed-dir' does not exist on disk in testDir.
      __emitWatchEventForTests(testDir, 'docs/removed-dir');
      await waitFor(() => syncFn.mock.calls.length > 0, 1000);
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      w.stop();
    });

    it('10.7 an existing non-source file change is fully ignored (no sync scheduled)', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      fs.writeFileSync(path.join(testDir, 'README.txt'), 'unsupported');
      const w = newWatcher(syncFn, { debounceMs: 60 });
      w.start();
      __emitWatchEventForTests(testDir, 'README.txt');
      await new Promise((r) => setTimeout(r, 200));
      expect(syncFn).not.toHaveBeenCalled();
      w.stop();
    });

    it('10.8 needsFullScan persists across a FAILED full-scan sync (still full on the next retry)', async () => {
      // A retry is only scheduled by the finally block when pendingFiles is
      // non-empty (#see flush()'s `if (this.pendingFiles.size > 0 ...)` gate) —
      // a lone scope-refresh event never touches pendingFiles by itself, so it
      // alone would never be retried after a failure. Pairing it with a normal
      // source-file event gives the failed full-scan sync something to retry
      // FOR, while still proving needsFullScan forces that retry to stay full
      // despite pendingFiles being small enough to otherwise qualify as scoped.
      let call = 0;
      const syncFn: SyncFn = vi.fn(async (paths) => {
        call++;
        if (call === 1) throw new Error('boom');
        return { filesChanged: 0, durationMs: 0 };
      });
      const w = newWatcher(syncFn, { debounceMs: 30 });
      w.start();
      __emitWatchEventForTests(testDir, 'afyx-graph.json'); // forces needsFullScan
      __emitWatchEventForTests(testDir, 'src/a.ts'); // gives pendingFiles something, enabling a retry
      await waitFor(() => syncFn.mock.calls.length >= 2, 5000);
      // Both calls (the failed one and the retry) must have been full (undefined),
      // even though pendingFiles alone (just 'src/a.ts') would otherwise qualify
      // for a scoped sync.
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      expect(syncFn.mock.calls[1][0]).toBeUndefined();
      w.stop();
    });

    it('10.8b a lone scope-refresh failure with nothing else pending is NOT retried (retry is gated on pendingFiles being non-empty)', async () => {
      const syncFn: SyncFn = vi.fn().mockRejectedValue(new Error('boom'));
      const onSyncError = vi.fn();
      const w = newWatcher(syncFn, { debounceMs: 30, onSyncError });
      w.start();
      __emitWatchEventForTests(testDir, 'afyx-graph.json'); // forces needsFullScan, touches no pendingFiles
      await waitFor(() => onSyncError.mock.calls.length > 0, 2000);
      await new Promise((r) => setTimeout(r, 400)); // long past any retry window
      expect(syncFn.mock.calls.length).toBe(1); // no retry: pendingFiles was empty
      w.stop();
    });

    it('10.9 needsFullScan clears after a SUCCESSFUL full-scan sync (a later lone-file edit goes back to scoped)', async () => {
      const syncFn = vi.fn().mockResolvedValue({ filesChanged: 0, durationMs: 0 });
      const w = newWatcher(syncFn, { debounceMs: 40 });
      w.start();
      __emitWatchEventForTests(testDir, 'afyx-graph.json');
      await waitFor(() => syncFn.mock.calls.length >= 1, 1000);
      expect(syncFn.mock.calls[0][0]).toBeUndefined();
      __emitWatchEventForTests(testDir, 'src/a.ts');
      await waitFor(() => syncFn.mock.calls.length >= 2, 1000);
      expect(syncFn.mock.calls[1][0]).toEqual(['src/a.ts']);
      w.stop();
    });
  });

  // ============================================================
  // 11. WATCH POLICY (env / WSL)
  // ============================================================
  describe('11. watch policy', () => {
    afterEach(() => __resetWslCacheForTests());

    it('11.1 AFYX_GRAPH_NO_WATCH=1 disables regardless of anything else', () => {
      const reason = watchDisabledReason('/tmp/project', {
        env: { AFYX_GRAPH_NO_WATCH: '1', AFYX_GRAPH_FORCE_WATCH: '1' },
        isWsl: true,
      });
      expect(reason).toMatch(/AFYX_GRAPH_NO_WATCH/);
    });

    it('11.2 AFYX_GRAPH_NO_WATCH takes precedence over AFYX_GRAPH_FORCE_WATCH', () => {
      const reason = watchDisabledReason('/mnt/c/project', {
        env: { AFYX_GRAPH_NO_WATCH: '1', AFYX_GRAPH_FORCE_WATCH: '1' },
        isWsl: true,
      });
      expect(reason).not.toBeNull();
    });

    it('11.3 AFYX_GRAPH_FORCE_WATCH=1 overrides WSL auto-detection', () => {
      const reason = watchDisabledReason('/mnt/c/project', {
        env: { AFYX_GRAPH_FORCE_WATCH: '1' },
        isWsl: true,
      });
      expect(reason).toBeNull();
    });

    it('11.4 WSL + /mnt/<letter> drive is disabled by default', () => {
      const reason = watchDisabledReason('/mnt/c/project', { env: {}, isWsl: true });
      expect(reason).toMatch(/WSL2/);
    });

    it('11.5 WSL + native WSL home (not /mnt) is NOT disabled', () => {
      const reason = watchDisabledReason('/home/user/project', { env: {}, isWsl: true });
      expect(reason).toBeNull();
    });

    it('11.6 non-WSL platform on a /mnt-looking path is NOT disabled (isWsl=false wins)', () => {
      const reason = watchDisabledReason('/mnt/c/project', { env: {}, isWsl: false });
      expect(reason).toBeNull();
    });

    it('11.7 /mnt/wsl (fast 9p mount, not a drive letter) is NOT disabled', () => {
      const reason = watchDisabledReason('/mnt/wsl/some-share', { env: {}, isWsl: true });
      expect(reason).toBeNull();
    });

    it('11.8 no env / not WSL: watching is enabled (null)', () => {
      const reason = watchDisabledReason('/some/project', { env: {}, isWsl: false });
      expect(reason).toBeNull();
    });

    it('11.9 detectWsl() caches its result (env changes after the first call do not retroactively change it)', () => {
      __resetWslCacheForTests();
      const prior = process.env.WSL_DISTRO_NAME;
      try {
        delete process.env.WSL_DISTRO_NAME;
        const first = detectWsl();
        process.env.WSL_DISTRO_NAME = 'Ubuntu';
        const second = detectWsl();
        expect(second).toBe(first);
      } finally {
        if (prior === undefined) delete process.env.WSL_DISTRO_NAME;
        else process.env.WSL_DISTRO_NAME = prior;
      }
    });
  });
});

// ============================================================
// 12. FRESHNESS CONTRACT
// ============================================================
describe('Freshness contract (Phase 3B.6 freeze)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-freshness-contract-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  function initGitRepo(dir: string) {
    const { execFileSync } = require('child_process');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
    // Real projects get an auto-generated .afyx-graph/.gitignore (see
    // src/directory.ts's ensureGitignore); without it `git add -A` would sweep
    // the freshness sidecar itself into git, and the NEXT writeFreshness() call
    // would then "dirty" a just-committed tracked file forever, making FRESH
    // unreachable for reasons that have nothing to do with the contract under
    // test. Mirror that real-world exclusion here.
    fs.writeFileSync(path.join(dir, '.gitignore'), '.afyx-graph/\n');
  }
  function commitAll(dir: string, msg: string) {
    const { execFileSync } = require('child_process');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir });
  }

  it('12.1 MISSING when there is no database at all', () => {
    const report = getFreshness(testDir);
    expect(report.state).toBe('MISSING');
  });

  it('12.2 INVALID when the database file exists but is not a SQLite file', () => {
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), 'not a real sqlite file');
    const report = getFreshness(testDir);
    expect(report.state).toBe('INVALID');
  });

  it('12.3 UNKNOWN when the DB is valid SQLite but no freshness sidecar exists yet', () => {
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    const report = getFreshness(testDir);
    expect(report.state).toBe('UNKNOWN');
  });

  it('12.4 INVALID when the freshness sidecar is not valid JSON', () => {
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    fs.writeFileSync(path.join(getAfyxGraphDir(testDir), FRESHNESS_FILE_NAME), '{not json');
    const report = getFreshness(testDir);
    expect(report.state).toBe('INVALID');
  });

  it('12.5 UNKNOWN outside a git working tree even with a valid sidecar', () => {
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    writeFreshness(testDir);
    const report = getFreshness(testDir);
    expect(report.state).toBe('UNKNOWN');
  });

  it('12.6 FRESH after a full index in a clean git tree', () => {
    initGitRepo(testDir);
    fs.writeFileSync(path.join(testDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(testDir, 'init');
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    writeFreshness(testDir);
    const report = getFreshness(testDir);
    expect(report.state).toBe('FRESH');
  });

  it('12.7 STALE when a tracked file changes after the index was written (index untouched)', () => {
    initGitRepo(testDir);
    fs.writeFileSync(path.join(testDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(testDir, 'init');
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    writeFreshness(testDir);
    fs.appendFileSync(path.join(testDir, 'a.ts'), '// edited\n');
    const report = getFreshness(testDir);
    expect(report.state).toBe('STALE');
  });

  it('12.8 STALE -> FRESH after HEAD moves and a resync happens', () => {
    initGitRepo(testDir);
    fs.writeFileSync(path.join(testDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(testDir, 'init');
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    writeFreshness(testDir);
    fs.writeFileSync(path.join(testDir, 'b.ts'), 'export const b = 2;\n');
    commitAll(testDir, 'second');
    expect(getFreshness(testDir).state).toBe('STALE');
    writeFreshness(testDir); // resync
    expect(getFreshness(testDir).state).toBe('FRESH');
  });

  it('12.9 STALE when the index was built from a tree with uncommitted changes (still dirty at check time)', () => {
    initGitRepo(testDir);
    fs.writeFileSync(path.join(testDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(testDir, 'init');
    fs.appendFileSync(path.join(testDir, 'a.ts'), '// dirty at index time\n');
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    writeFreshness(testDir); // recorded while dirty
    // Tree is STILL dirty in the same way, so HEAD matches and the tree is
    // unchanged from what was recorded — but tracked_clean was false at index
    // time, so the verdict must be STALE, not FRESH.
    const report = getFreshness(testDir);
    expect(report.state).toBe('STALE');
  });

  it('12.9b STALE when the index was built dirty, and the dirty edit is later discarded (same HEAD, clean NOW, but dirty at index time)', () => {
    // This is the specific branch 12.9 cannot reach on its own: 12.9 stays
    // dirty at check time, so it's caught by the "tracked files changed"
    // check before ever consulting `meta.tracked_clean`. Discarding the
    // uncommitted edit (not committing it) returns the tree to EXACTLY HEAD
    // — same head, clean right now — isolating the "recorded from a dirty
    // tree" check on its own.
    const { execFileSync } = require('child_process');
    initGitRepo(testDir);
    fs.writeFileSync(path.join(testDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(testDir, 'init');
    fs.appendFileSync(path.join(testDir, 'a.ts'), '// dirty at index time\n');
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    writeFreshness(testDir); // recorded while dirty (tracked_clean: false)
    execFileSync('git', ['checkout', '--', 'a.ts'], { cwd: testDir }); // discard the edit: same HEAD, clean now
    const report = getFreshness(testDir);
    expect(report.state).toBe('STALE');
  });

  it('12.10 writeFreshness never throws even when the target directory does not exist', () => {
    expect(() => writeFreshness(path.join(testDir, 'does-not-exist'))).not.toThrow();
  });

  it('12.11 writeFreshness is a no-op (does not create the sidecar) when the afyx-graph dir does not exist', () => {
    writeFreshness(testDir);
    expect(fs.existsSync(path.join(getAfyxGraphDir(testDir), FRESHNESS_FILE_NAME))).toBe(false);
  });

  it('12.12 writeFreshness leaves no temp file behind after a successful write', () => {
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    writeFreshness(testDir);
    const entries = fs.readdirSync(getAfyxGraphDir(testDir));
    expect(entries.some((e) => e.includes('.tmp'))).toBe(false);
    expect(entries).toContain(FRESHNESS_FILE_NAME);
  });

  it('12.13 the freshness record is valid JSON with schema_version 1', () => {
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    writeFreshness(testDir);
    const raw = fs.readFileSync(path.join(getAfyxGraphDir(testDir), FRESHNESS_FILE_NAME), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schema_version).toBe(1);
    expect(typeof parsed.indexed_at).toBe('string');
  });

  it('12.14 an unsupported schema_version reports INVALID', () => {
    initGitRepo(testDir);
    fs.mkdirSync(getAfyxGraphDir(testDir), { recursive: true });
    fs.writeFileSync(getDatabasePath(testDir), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    fs.writeFileSync(
      path.join(getAfyxGraphDir(testDir), FRESHNESS_FILE_NAME),
      JSON.stringify({ schema_version: 99, git_head: 'abc', tracked_clean: true })
    );
    expect(getFreshness(testDir).state).toBe('INVALID');
  });
});
