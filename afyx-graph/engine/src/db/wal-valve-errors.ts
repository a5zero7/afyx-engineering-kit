/**
 * Error type for the WAL checkpoint valve's fail-closed path (#1539): thrown when a parked
 * backfill cannot progress (a reader pinning frames) while the WAL is past the hard/file
 * caps, instead of releasing the writer. See `wal-checkpoint-coordinator.ts` for where it's
 * thrown and the header comment there for why aborting is the safe terminal mode.
 */
export class WalValveAbortError extends Error {
  readonly code = 'WAL_VALVE_ABORT' as const;
  readonly walBytes: number;
  readonly fileCapBytes: number;
  readonly hardBytes: number;

  constructor(message: string, sizes: { walBytes: number; fileCapBytes: number; hardBytes: number }) {
    super(message);
    this.name = 'WalValveAbortError';
    this.walBytes = sizes.walBytes;
    this.fileCapBytes = sizes.fileCapBytes;
    this.hardBytes = sizes.hardBytes;
  }
}
