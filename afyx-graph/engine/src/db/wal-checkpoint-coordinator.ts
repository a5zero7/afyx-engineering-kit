/**
 * WAL checkpoint coordinator — bounds WAL growth while auto-checkpointing is
 * deferred during a bulk index (#1231).
 *
 * Why deferral: SQLite's default `wal_autocheckpoint` (1000 pages) re-writes
 * hot B-tree/FTS pages into the main DB file over and over during a bulk
 * index — measured at ~95% of ALL disk I/O, and the difference between 45s
 * and 19+ minutes on HDD-class storage (150 random IOPS). Deferring
 * checkpoints turns the store into pure sequential WAL appends; each backfill
 * pass writes distinct pages once, in page order (≈ sequential).
 *
 * Why a valve: unbounded deferral is its own failure mode, both measured in
 * the #1231 repro. The WAL duplicates hot pages per COMMIT, so it grows far
 * faster than the DB (5.9GB WAL for a ~340MB DB on a 3.3k-file index) —
 * filling the disk, and poisoning every subsequent read that must page
 * through it (the first resolution-phase read blocked the main thread >60s
 * and the #850 liveness watchdog killed the healthy index). The coordinator
 * watches WAL growth on a timer (via {@link WalPressure}) and, past a soft
 * threshold, backfills with `PRAGMA wal_checkpoint(PASSIVE)` on a
 * worker-thread connection — PASSIVE never blocks the writer, and off-thread
 * means the main thread (and the watchdog heartbeat) keep turning regardless
 * of how long a backfill takes. See `wal-pressure.ts` for why growth (not raw
 * WAL size) is what triggers a fold.
 *
 * Backpressure: if the writer outruns the checkpointer past a hard cap of
 * growth (2× soft), {@link WalCheckpointCoordinator.backpressure} pauses the
 * writer (at a safe, between-transactions boundary) until a FULL backfill
 * lands. One in-flight pass is not enough: on a disk saturated by the
 * writer, every concurrent PASSIVE pass is already stale by the time it
 * finishes (the writer appended past its snapshot), so neither SQLite's WAL
 * wrap nor the baseline ever trigger and the WAL grows without bound
 * (measured: 5.9GB on guava at 150 IOPS, then a >60s read stall and a
 * watchdog kill). With the writer parked, the next pass covers everything,
 * the WAL wraps on the following commit, and the pause is the disk's honest
 * catch-up cost — the correct terminal mode when hardware genuinely can't
 * keep up with the append rate.
 *
 * Fail-closed (#1539): if parked backfills cannot progress (a reader pinning
 * frames) while the WAL is past the hard/file caps, the coordinator throws
 * {@link WalValveAbortError} instead of releasing the writer. The previous
 * "futility latch" disabled parking for 60s after consecutive give-ups so a
 * pinned reader would not churn checkpoint workers — but that also let the
 * WAL grow without a bound (observed 64 GiB on a kernel-scale daemon catch-up
 * with the query pool holding read marks). Aborting with a clear error is the
 * safe terminal mode; the caller closes readers / retries once the pin clears.
 */

import type { DatabaseConnection } from './index';
import type { CheckpointResult } from './wal-maintenance';
import { WalPressure, resolveWalValveMb } from './wal-pressure';
import { WalValveAbortError } from './wal-valve-errors';

/** Passes attempted per writer pause before giving up (a pinned reader could stall forever). */
const MAX_PAUSED_BACKFILL_PASSES = 20;
/** How often the timer looks at the WAL file size. */
const CHECK_INTERVAL_MS = 2000;

export class WalCheckpointCoordinator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  /** Writer pause in progress (hard cap breached): passes loop until a full backfill. */
  private pause: Promise<void> | null = null;
  private readonly pressure: WalPressure;

  /**
   * Consecutive parked-backfill give-ups. Used only for diagnostics in the
   * abort message — parking is never disabled (#1539 fail-closed).
   */
  private consecutiveGiveUps = 0;

  constructor(
    private readonly db: DatabaseConnection,
    softMb: number = resolveWalValveMb(process.env.AFYX_GRAPH_WAL_VALVE_MB),
    private readonly intervalMs: number = CHECK_INTERVAL_MS,
    log: (msg: string) => void = () => {}
  ) {
    this.pressure = new WalPressure(db, softMb);
    // AFYX_GRAPH_WAL_VALVE_DEBUG=1 surfaces valve decisions to stderr without
    // needing the caller's verbose plumbing — the observability gap that let
    // §7a.1 run 1 fail silently (give-ups were verbose-gated and invisible).
    this.log = process.env.AFYX_GRAPH_WAL_VALVE_DEBUG
      ? (m) => console.error(`[wal-valve] ${m}`)
      : log;
  }

  private readonly log: (msg: string) => void;
  private ticks = 0;

  private mb(n: number): string {
    return `${Math.round(n / 1024 / 1024)}MB`;
  }

  /** Begin watching the WAL. Idempotent; the timer never holds the loop open. */
  start(): void {
    if (this.timer) return;
    // One armed line per run under either diagnostics env: §7a.1's failed
    // kernel-scale runs burned three 25-minute cycles before "is the valve
    // even alive?" could be answered.
    if (process.env.AFYX_GRAPH_SYNTH_TIMINGS || process.env.AFYX_GRAPH_WAL_VALVE_DEBUG) {
      console.error(`[wal-valve] armed soft=${this.mb(this.pressure.softBytes)} hard=${this.mb(this.pressure.hardBytes)} wal=${this.mb(this.pressure.walBytes())}`);
    }
    this.timer = setInterval(() => this.onTimer(), this.intervalMs);
    this.timer.unref?.();
  }

  private onTimer(): void {
    this.ticks += 1;
    if (this.ticks % 15 === 0) {
      this.log(`alive: wal=${this.mb(this.pressure.walBytes())} baseline=${this.mb(this.pressure.baseline)} inflight=${this.inflight ? 'y' : 'n'} paused=${this.pause ? 'y' : 'n'}`);
    }
    this.check();
  }

  /** Stop watching. Any in-flight checkpoint keeps running — await drain(). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One poll: fire an off-thread passive checkpoint when growth passes the soft threshold. */
  check(): void {
    if (!this.pause && !this.inflight && this.pressure.exceedsSoft()) this.fire();
  }

  /**
   * Writer-side backstop, called at a between-transactions boundary. Returns
   * null (no wait) while growth is under the hard cap; past it, returns a
   * promise that resolves only once a FULL backfill has landed — see the
   * header comment for why a single pass is not enough on a saturated disk.
   */
  backpressure(): Promise<void> | null {
    if (this.pause) return this.pause;
    // Past the file cap, park and TRUNCATE at the barrier — the backfill
    // part is instant when the backlog is already folded. See
    // `WalPressure.withinCaps` for the two independent triggers.
    if (this.pressure.withinCaps()) return null;
    this.log(`backpressure: wal=${this.mb(this.pressure.walBytes())} baseline=${this.mb(this.pressure.baseline)} — pausing writer for full backfill`);
    const startedAt = Date.now();
    this.pause = this.backfillFully().finally(() => {
      this.pause = null;
      this.log(`backpressure released after ${Date.now() - startedAt}ms: wal=${this.mb(this.pressure.walBytes())} baseline=${this.mb(this.pressure.baseline)}`);
    });
    return this.pause;
  }

  /** Await any in-flight checkpoint and writer pause. */
  async drain(): Promise<void> {
    while (this.pause || this.inflight) {
      if (this.pause) await this.pause;
      if (this.inflight) await this.inflight;
    }
  }

  /**
   * Phase-boundary fold: backfill the ENTIRE WAL now (off-thread, awaited).
   * Called between bulk phases — e.g. after parsing, before resolution's
   * first reads — so the next phase never pages a bulk-write-sized WAL on
   * the main thread (the post-parse read against a multi-GB WAL is what
   * blew the #850 watchdog's 60s window in the #1231 repro). The await
   * keeps the event loop (and the watchdog heartbeat) turning.
   */
  async foldNow(): Promise<void> {
    await this.drain();
    if (this.pressure.growthBytes() <= 0) return;
    this.log(`foldNow: wal=${this.mb(this.pressure.walBytes())} baseline=${this.mb(this.pressure.baseline)}`);
    this.pause = this.backfillFully().finally(() => { this.pause = null; });
    await this.pause;
  }

  private isFullBackfill(result: CheckpointResult): boolean {
    return result.busy === 0 && result.log === result.checkpointed;
  }

  private pressureAbort(message: string, walBytes: number): WalValveAbortError {
    return new WalValveAbortError(message, {
      walBytes,
      fileCapBytes: this.pressure.fileCapBytes,
      hardBytes: this.pressure.hardBytes,
    });
  }

  /**
   * With the writer parked on the returned promise, loop passive passes until
   * one reports the entire WAL backfilled (typically the second: the first
   * drains the pass that was already running against a stale snapshot). After
   * a bounded number of passes without a full backfill — e.g. a reader
   * pinning the WAL — throws {@link WalValveAbortError} when still past the
   * hard/file caps (#1539 fail-closed). Soft give-up under those caps is
   * reserved for foldNow on a modest backlog that could not complete.
   */
  private async backfillFully(): Promise<void> {
    let pass = 0;
    while (pass < MAX_PAUSED_BACKFILL_PASSES) {
      if (this.inflight) await this.inflight; // fold in the stale in-flight pass first
      const res = await this.db.checkpointWalPassive();
      if (!res) {
        // Machinery unavailable: fail closed past the documented caps (#1539),
        // otherwise soft-return so a non-WAL / closing connection does not abort.
        const walBytes = this.pressure.walBytes();
        const growth = this.pressure.growthBytes();
        if (walBytes > this.pressure.fileCapBytes || growth > this.pressure.hardBytes) {
          throw this.pressureAbort(
            `WAL checkpoint machinery unavailable while over the documented cap ` +
              `(wal=${this.mb(walBytes)}, fileCap=${this.mb(this.pressure.fileCapBytes)}). ` +
              `Aborting to avoid unbounded disk growth.`,
            walBytes
          );
        }
        return;
      }
      pass += 1;
      this.log(`backfill pass ${pass}: busy=${res.busy} log=${res.log} checkpointed=${res.checkpointed} wal=${this.mb(this.pressure.walBytes())}`);
      if (this.isFullBackfill(res)) {
        // Backfill complete AND we are at a parked barrier (backfillFully only
        // runs under a writer pause): the no-reader window is guaranteed, so
        // chop the FILE too — a fully-backfilled WAL otherwise keeps growing
        // whenever commits land while pool readers hold marks (§7a.1: 22GB
        // on-disk at kernel scale despite backfills). A racing reader turns
        // this into a no-op (busy=1); the passive result above still stands.
        const trunc = await this.db.checkpointWalTruncate();
        if (trunc) this.log(`truncate: busy=${trunc.busy} wal=${this.mb(this.pressure.walBytes())}`);
        this.pressure.noteFullBackfill();
        this.consecutiveGiveUps = 0;
        return;
      }
    }
    this.consecutiveGiveUps++;
    const walBytes = this.pressure.walBytes();
    const growth = this.pressure.growthBytes();
    const msg =
      `backfill gave up after ${MAX_PAUSED_BACKFILL_PASSES} passes ` +
      `(streak ${this.consecutiveGiveUps}) — a reader is pinning the WAL ` +
      `(wal=${this.mb(walBytes)} growth=${this.mb(growth)} ` +
      `hard=${this.mb(this.pressure.hardBytes)} fileCap=${this.mb(this.pressure.fileCapBytes)})`;
    this.log(msg);
    // Give-ups are rare and load-bearing for §7a.1-class diagnosis — surface
    // them on any timing-instrumented run, not just valve-debug ones.
    if (process.env.AFYX_GRAPH_SYNTH_TIMINGS && !process.env.AFYX_GRAPH_WAL_VALVE_DEBUG) {
      console.error(`[wal-valve] ${msg}`);
    }
    // Fail closed (#1539): never release the writer past the documented caps
    // when checkpoints cannot progress. The old futility latch disabled
    // parking for 60s and allowed unbounded growth (64 GiB observed).
    if (walBytes > this.pressure.fileCapBytes || growth > this.pressure.hardBytes) {
      throw this.pressureAbort(
        `WAL checkpoint cannot progress while a reader pins frames ` +
          `(wal=${this.mb(walBytes)}, growth=${this.mb(growth)}, ` +
          `fileCap=${this.mb(this.pressure.fileCapBytes)}, hard=${this.mb(this.pressure.hardBytes)}, ` +
          `give-ups=${this.consecutiveGiveUps}). Aborting to avoid unbounded disk growth. ` +
          `Close concurrent readers (for example the MCP query pool) and retry, ` +
          `or raise AFYX_GRAPH_WAL_VALVE_MB if the threshold is too tight for this project.`,
        walBytes
      );
    }
  }

  private fire(): void {
    this.log(`fire: wal=${this.mb(this.pressure.walBytes())} baseline=${this.mb(this.pressure.baseline)}`);
    const operation = this.db
      .checkpointWalPassive()
      .then((res) => {
        this.log(`timer pass: ${res ? `busy=${res.busy} log=${res.log} checkpointed=${res.checkpointed}` : 'null (machinery unavailable)'} wal=${this.mb(this.pressure.walBytes())}`);
        // Full backfill (busy 0, every log frame checkpointed) ⇒ the writer's
        // next commit wraps the WAL; the file's current size becomes the new
        // growth baseline. A partial pass (writer appended during it, or a
        // read transaction pinned frames) leaves the baseline alone, so the
        // next tick fires again and copies the remainder. In non-WAL mode
        // SQLite reports log = checkpointed = -1, which is harmless here.
        if (res && this.isFullBackfill(res)) {
          this.pressure.noteFullBackfill();
          // NO truncate here. A truncate checkpoint that starts against an
          // ACTIVE writer wins the lock race and then blocks that writer for
          // its entire backfill — after a multi-GB single-transaction burst
          // (edge-index recreate) that exceeds the writer's 5s busy_timeout
          // and fails the index with "database is locked" (§7a.2 record run).
          // The file chop happens exclusively at parked barriers
          // (backpressure/foldNow), where the writer is awaiting us by
          // construction and cannot collide.
        }
      })
      .catch(() => { /* best effort */ })
      .finally(() => {
        if (this.inflight === operation) this.inflight = null;
      });
    this.inflight = operation;
  }
}
