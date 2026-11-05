/**
 * AFYX Engineering Kit - Cooperative Event Loop Yielding
 *
 * Implements low-overhead wall-clock budgeted cooperative yield points for long-running
 * synchronous operations (indexing, reference resolution, AST analysis), preventing
 * event loop starvation and keeping heartbeat watchdogs active without performance degradation.
 */

/** Function checking if yield threshold is reached and returning an optional awaitable promise. */
export type MaybeYield = () => Promise<void> | undefined;

/** Default time slice threshold in milliseconds before yielding control. */
export const DEFAULT_YIELD_BUDGET_MS = 250;

/**
 * Creates a cooperative yielder with a specified wall-clock threshold.
 */
export function createYielder(budgetMs: number = DEFAULT_YIELD_BUDGET_MS): MaybeYield {
  let lastYieldTimestamp = Date.now();

  return function maybeYield(): Promise<void> | undefined {
    const elapsed = Date.now() - lastYieldTimestamp;
    if (elapsed < budgetMs) {
      return undefined;
    }

    return new Promise<void>((resolve) => {
      setImmediate(() => {
        lastYieldTimestamp = Date.now();
        resolve();
      });
    });
  };
}
