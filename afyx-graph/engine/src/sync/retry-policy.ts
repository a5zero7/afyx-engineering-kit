/**
 * Retry / Degradation Policy
 *
 * The one owner of "how many times has a watcher-triggered sync failed in a
 * row, and has it failed enough to give up." Two independent counters:
 *
 *  - lock-contention retries (another writer holds the cross-process file
 *    lock — expected to be transient, so quiet/debug-only until the budget
 *    is exhausted)
 *  - generic sync-failure retries (anything else — a broken extractor, DB
 *    corruption, an OOM — surfaced via onSyncError every time)
 *
 * A non-lock failure resets the lock streak (mixed failures don't sum toward
 * the lock budget); a clean sync resets BOTH streaks. Degradation uses
 * whichever counter is higher, so interleaved failure kinds still back off
 * and eventually degrade instead of retrying forever.
 */

const MAX_RETRY_BACKOFF_MS = 30_000;

export interface RetryPolicyOptions {
  maxLockRetries: number;
  maxSyncFailureRetries: number;
  /** Same debounce value the scheduler uses; the backoff base is derived from it. */
  debounceMs: number;
}

export interface FailureOutcome {
  /** True once this failure kind's streak has crossed its budget. */
  shouldDegrade: boolean;
  /** The larger of the two streaks, used to compute the next backoff delay. */
  activeRetryCount: number;
}

export class RetryPolicy {
  private lockRetryCount = 0;
  private syncFailureRetryCount = 0;

  constructor(private readonly options: RetryPolicyOptions) {}

  recordLockFailure(): FailureOutcome {
    this.lockRetryCount += 1;
    return {
      shouldDegrade: this.lockRetryCount > this.options.maxLockRetries,
      activeRetryCount: Math.max(this.lockRetryCount, this.syncFailureRetryCount),
    };
  }

  recordGenericFailure(): FailureOutcome {
    this.lockRetryCount = 0; // a non-lock failure isn't contention; reset that streak
    this.syncFailureRetryCount += 1;
    return {
      shouldDegrade: this.syncFailureRetryCount > this.options.maxSyncFailureRetries,
      activeRetryCount: Math.max(this.lockRetryCount, this.syncFailureRetryCount),
    };
  }

  /** A clean sync clears any contention/failure backoff. */
  recordSuccess(): void {
    this.lockRetryCount = 0;
    this.syncFailureRetryCount = 0;
  }

  reset(): void {
    this.lockRetryCount = 0;
    this.syncFailureRetryCount = 0;
  }

  get activeRetryCount(): number {
    return Math.max(this.lockRetryCount, this.syncFailureRetryCount);
  }

  /** Exponential backoff (debounceMs · 2^(n-1)), capped so it never sleeps absurdly long. */
  backoffDelayMs(retryCount: number): number {
    return Math.min(this.options.debounceMs * 2 ** Math.max(0, retryCount - 1), MAX_RETRY_BACKOFF_MS);
  }
}
