/**
 * Debounce Scheduler
 *
 * The one owner of the watcher's single debounce/retry timer. Two scheduling
 * modes, both trailing-edge (a new call always cancels and rearms):
 *
 *  - `scheduleSync(pendingSize)`: adaptive quiet window — a small pending set
 *    (<= quickMaxPending) fires after a short quiet window instead of the
 *    full debounce, so a lone save (or an editor + its test file) syncs near
 *    instantly, while a bigger burst keeps the full configured window and
 *    coalesces exactly as before. The quiet window is floored so it never
 *    exceeds the configured debounce and never goes below a sane minimum.
 *  - `scheduleRetry(delayMs)`: a fixed delay after a recoverable failure, kept
 *    separate so prolonged contention/failure backs off exponentially instead
 *    of retrying at the normal debounce cadence.
 */

export interface DebounceSchedulerOptions {
  debounceMs: number;
  quickMaxPending: number;
  quickQuietMs: number;
  quickFloorMs: number;
}

export class DebounceScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: DebounceSchedulerOptions) {}

  private rearm(delayMs: number, onFire: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      onFire();
    }, delayMs);
  }

  scheduleSync(pendingSize: number, onFire: () => void): void {
    const { debounceMs, quickMaxPending, quickQuietMs, quickFloorMs } = this.options;
    const quickMs = Math.max(quickFloorMs, Math.min(quickQuietMs, debounceMs));
    const delay = pendingSize <= quickMaxPending ? quickMs : debounceMs;
    this.rearm(delay, onFire);
  }

  scheduleRetry(delayMs: number, onFire: () => void): void {
    this.rearm(delayMs, onFire);
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** @internal test/inspection only — never used for control flow. */
  get isArmed(): boolean {
    return this.timer !== null;
  }
}
