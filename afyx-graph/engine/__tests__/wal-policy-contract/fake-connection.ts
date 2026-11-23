/**
 * A controllable stand-in for `DatabaseConnection`, exposing exactly the four methods
 * `WalCheckpointValve` calls: `getWalSizeBytes`, `getDbFileSizeBytes`, `checkpointWalPassive`,
 * `checkpointWalTruncate`. Every call is traced in order, so a contract scenario can assert
 * not just outcomes but *what the valve actually did* — how many checkpoints, which mode,
 * in what order relative to the WAL size at the time.
 *
 * Default checkpoint behavior mirrors real SQLite: PASSIVE reports a full backfill
 * (`busy: 0, log === checkpointed`) without changing the WAL's on-disk size (a passive
 * checkpoint never shrinks the file); TRUNCATE reports the same full backfill AND chops
 * the file to a small residual. A scenario overrides either with a queued result — a
 * partial pass, a busy reader, or `null` (checkpoint machinery unavailable) — and can also
 * mutate `walBytes` from inside an override to simulate what that checkpoint would really
 * do to the file.
 */
export interface CheckpointResult { busy: number; log: number; checkpointed: number }
export type ScriptedResult = CheckpointResult | null | ((conn: FakeWalConnection) => CheckpointResult | null);

export type Call =
  | { kind: 'getWalSizeBytes'; result: number }
  | { kind: 'checkpointWalPassive'; result: CheckpointResult | null; walBytesAfter: number }
  | { kind: 'checkpointWalTruncate'; result: CheckpointResult | null; walBytesAfter: number };

/** Bytes a fully-backfilled-and-truncated WAL is left at — SQLite never gets to exactly 0. */
export const TRUNCATED_RESIDUAL_BYTES = 32 * 1024;

export class FakeWalConnection {
  walBytes = 0;
  dbFileSizeBytes = 100 * 1024 * 1024;
  readonly calls: Call[] = [];
  private passiveQueue: ScriptedResult[] = [];
  private truncateQueue: ScriptedResult[] = [];

  /** Queue the result(s) of the next `checkpointWalPassive` call(s), in order. */
  queuePassive(...results: ScriptedResult[]): void {
    this.passiveQueue.push(...results);
  }
  /** Queue the result(s) of the next `checkpointWalTruncate` call(s), in order. */
  queueTruncate(...results: ScriptedResult[]): void {
    this.truncateQueue.push(...results);
  }

  getWalSizeBytes(): number {
    this.calls.push({ kind: 'getWalSizeBytes', result: this.walBytes });
    return this.walBytes;
  }

  getDbFileSizeBytes(): number {
    return this.dbFileSizeBytes;
  }

  // Both methods push a call record the instant they're invoked (so "was it
  // called" assertions are correct even for a scripted result that never
  // resolves — a deliberately hung backfill pass under a pinned reader) and
  // patch the record's `result`/`walBytesAfter` fields in place once the
  // scripted value (sync or async) actually settles.

  async checkpointWalPassive(): Promise<CheckpointResult | null> {
    const scripted = this.passiveQueue.shift();
    const call: Call = { kind: 'checkpointWalPassive', result: null, walBytesAfter: this.walBytes };
    this.calls.push(call);
    const raw = scripted === undefined
      ? { busy: 0, log: 100, checkpointed: 100 } // default: fully backfilled, file size unchanged
      : typeof scripted === 'function' ? scripted(this) : scripted;
    const result = await raw;
    call.result = result;
    call.walBytesAfter = this.walBytes;
    return result;
  }

  async checkpointWalTruncate(): Promise<CheckpointResult | null> {
    const scripted = this.truncateQueue.shift();
    const call: Call = { kind: 'checkpointWalTruncate', result: null, walBytesAfter: this.walBytes };
    this.calls.push(call);
    let result: CheckpointResult | null;
    if (scripted === undefined) {
      result = { busy: 0, log: 100, checkpointed: 100 };
      this.walBytes = TRUNCATED_RESIDUAL_BYTES; // default: truncate actually shrinks the file
    } else {
      result = await (typeof scripted === 'function' ? scripted(this) : scripted);
    }
    call.result = result;
    call.walBytesAfter = this.walBytes;
    return result;
  }
}
