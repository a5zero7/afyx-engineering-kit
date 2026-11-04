/**
 * Pure WAL-growth pressure math: the soft/hard/file-cap thresholds a project's soft-MB
 * setting derives, and the growth-past-last-full-backfill estimate they're measured
 * against. Split out of the checkpoint valve's orchestration (`wal-checkpoint-coordinator.ts`)
 * because this half has no timers, no promises and no I/O beyond reading the WAL's current
 * size — it is what decides whether pressure exists, never what to DO about it.
 *
 * The load-bearing subtlety this module exists to isolate: a WAL file's SIZE never
 * shrinks. After a full backfill, the writer's next commit RESTARTS the WAL from the top
 * and the frames recycle inside the same file — so raw size says nothing about the
 * un-backfilled backlog, and a size-triggered valve degenerates into firing (and pausing
 * the writer) forever once the file passes its threshold (measured: guava crawled at
 * ~9min per 160 files, #1231). Instead pressure is measured as GROWTH past
 * `sizeAtLastFullBackfill` — refreshed only when a checkpoint reports `log === checkpointed`
 * (everything backfilled) via {@link WalPressure.noteFullBackfill} — which only rises when
 * genuinely un-backfilled frames push past the file's prior high-water mark.
 */

/** Soft WAL-growth threshold (MB) that triggers an off-thread passive checkpoint. */
const DEFAULT_WAL_VALVE_MB = 256;
/** Hard cap = this × soft threshold; past it the writer pauses for a full backfill. */
const HARD_CAP_MULTIPLIER = 2;
/** File cap = this × soft threshold; past it the barrier also TRUNCATEs the file. */
const FILE_CAP_MULTIPLIER = 4;
const MIB = 1024 * 1024;

export interface WalSizeSource {
  getWalSizeBytes(): number;
}

/**
 * Resolve the valve's soft threshold from the `AFYX_GRAPH_WAL_VALVE_MB`
 * override; non-numeric / non-positive values fall back to the default.
 */
export function resolveWalValveMb(envVal: string | undefined, dbSizeBytes?: number): number {
  const override = envVal === undefined || envVal === '' ? Number.NaN : Number(envVal);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  // Scale with the project when the caller knows the DB size: every fold
  // re-writes hot B-tree pages into the main file (the #1231 pathology in
  // bounded form — 111s of a kernel-scale batch loop at the flat 256MB cap,
  // §7a.2), so a big project affords a proportionally bigger transient WAL
  // (~dbSize/4 soft ⇒ file cap ≈ dbSize) in exchange for ~4× fewer folds.
  if (dbSizeBytes !== undefined && dbSizeBytes > 0) {
    const scaled = Math.floor(dbSizeBytes / (4 * MIB));
    return Math.max(DEFAULT_WAL_VALVE_MB, Math.min(2048, scaled));
  }
  return DEFAULT_WAL_VALVE_MB;
}

/**
 * Thresholds derived from one soft-MB setting, plus the mutable growth baseline they're
 * measured against. Every size read goes straight to `db.getWalSizeBytes()` — no caching —
 * so callers control exactly how many times the WAL is stat'd, same as reading the size
 * directly; this module only centralizes what the caps ARE and what GROWTH means.
 */
export class WalPressure {
  readonly softBytes: number;
  readonly hardBytes: number;
  readonly fileCapBytes: number;

  /**
   * WAL file size observed when a checkpoint last reported the ENTIRE WAL backfilled.
   * Growth is measured against this baseline — see the header comment for why absolute
   * size cannot be used.
   */
  private sizeAtLastFullBackfill = 0;

  constructor(
    private readonly db: WalSizeSource,
    softMb: number
  ) {
    this.softBytes = softMb * MIB;
    this.hardBytes = this.softBytes * HARD_CAP_MULTIPLIER;
    this.fileCapBytes = this.softBytes * FILE_CAP_MULTIPLIER;
  }

  /** Current WAL file size, straight from the connection. */
  walBytes(): number {
    return this.db.getWalSizeBytes();
  }

  /** Un-backfilled growth estimate: bytes the WAL has grown past the last full backfill. */
  growthBytes(): number {
    return this.db.getWalSizeBytes() - this.sizeAtLastFullBackfill;
  }

  /** Soft-threshold fire decision: strictly past the soft threshold (not equal to it). */
  exceedsSoft(): boolean {
    return this.growthBytes() > this.softBytes;
  }

  /**
   * Both gates `backpressure()`'s barrier checks; true means "no wait needed". Two
   * independent triggers, checked in this order — growth: un-backfilled BACKLOG past the
   * hard cap (the original valve). File size: a WAL can stay fully backfilled and still
   * grow without bound (a writer only restarts at frame 0 if a commit finds no reader
   * marks, which never happens under sustained concurrent readers) — see
   * `wal-checkpoint-coordinator.ts` for what happens past this gate.
   */
  withinCaps(): boolean {
    if (this.growthBytes() > this.hardBytes) return false;
    return this.walBytes() <= this.fileCapBytes;
  }

  /** Past either cap: the sole condition the bounded backfill retry's fail-closed checks use. */
  overCaps(): boolean {
    if (this.walBytes() > this.fileCapBytes) return true;
    return this.growthBytes() > this.hardBytes;
  }

  /** Record that a checkpoint just reported the ENTIRE WAL backfilled: the new growth baseline. */
  noteFullBackfill(): void {
    this.sizeAtLastFullBackfill = this.walBytes();
  }

  /** The current baseline, for diagnostics (`AFYX_GRAPH_WAL_VALVE_DEBUG` logging). */
  get baseline(): number {
    return this.sizeAtLastFullBackfill;
  }
}

export { DEFAULT_WAL_VALVE_MB, HARD_CAP_MULTIPLIER, FILE_CAP_MULTIPLIER };
