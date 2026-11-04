/**
 * Facade for Afyx main-loop health supervision.
 *
 * A separate Node process observes heartbeats because a worker thread can be
 * stranded by the same V8 safepoint that wedges the main isolate. When
 * progress paths are supplied, file size/mtime changes distinguish slow
 * synchronous SQLite work from a CPU wedge, but continuous silence is always
 * bounded by a hard cap.
 */
import { parsePositiveDeadline } from './supervision-policy';
import { watchdogChildSource } from './watchdog-policy';
import {
  startWatchdogRuntime,
  type WatchdogHandle,
  type WatchdogRuntimeDependencies,
} from './watchdog-runtime';

export type { WatchdogHandle } from './watchdog-runtime';

export const DEFAULT_WATCHDOG_TIMEOUT_MS = 60_000;
export const PROGRESS_CAP_MULTIPLIER = 10;

function isEnvTruthy(raw: string | undefined): boolean {
  return raw !== undefined && ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function parseWatchdogTimeoutMs(
  raw: string | undefined,
  fallback: number = DEFAULT_WATCHDOG_TIMEOUT_MS,
): number {
  return parsePositiveDeadline(raw, fallback);
}

export function deriveCheckIntervalMs(timeoutMs: number): number {
  return Math.min(2000, Math.max(50, Math.round(timeoutMs / 5)));
}

export interface WatchdogOptions {
  /** DB/WAL or caller-owned artifacts whose size/mtime proves forward progress. */
  progressPaths?: string[];
}

/**
 * Internal injection seam for deterministic runtime ownership tests. Production
 * callers use {@link installMainThreadWatchdog} and never provide dependencies.
 */
export function installMainThreadWatchdogWithRuntime(
  options: WatchdogOptions,
  runtime: WatchdogRuntimeDependencies,
): WatchdogHandle | null {
  if (isEnvTruthy(process.env.AFYX_GRAPH_NO_WATCHDOG)) return null;
  const timeoutMs = parseWatchdogTimeoutMs(process.env.AFYX_GRAPH_WATCHDOG_TIMEOUT_MS);
  return startWatchdogRuntime(
    {
      childSource: watchdogChildSource(),
      timeoutMs,
      checkMs: deriveCheckIntervalMs(timeoutMs),
      capMs: timeoutMs * PROGRESS_CAP_MULTIPLIER,
      progressPaths: options.progressPaths ?? [],
    },
    runtime,
  );
}

/** Arm the watchdog, or degrade safely to `null` when disabled/spawn fails. */
export function installMainThreadWatchdog(options: WatchdogOptions = {}): WatchdogHandle | null {
  return installMainThreadWatchdogWithRuntime(options, {});
}
