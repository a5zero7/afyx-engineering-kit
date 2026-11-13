/**
 * Configuration facade for AFYX Graph main-loop liveness monitoring.
 * Uses an external Node monitor process so non-yielding V8 event-loop stalls
 * remain observable and recoverable without sharing isolate state.
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

const MIN_CHECK_INTERVAL_MS = 50;
const MAX_CHECK_INTERVAL_MS = 2_000;
const CHECKS_PER_TIMEOUT = 5;
const TRUTHY_FLAGS = new Set(['1', 'true', 'yes', 'on']);

function isDisabledFlagSet(raw: string | undefined): boolean {
  return raw !== undefined && TRUTHY_FLAGS.has(raw.trim().toLowerCase());
}

/** Parse watchdog silence deadline in milliseconds (`> 0`), else fallback. */
export function parseWatchdogTimeoutMs(
  raw: string | undefined,
  fallback: number = DEFAULT_WATCHDOG_TIMEOUT_MS,
): number {
  return parsePositiveDeadline(raw, fallback);
}

/** Compute bounded heartbeat write frequency for a given timeout window. */
export function deriveCheckIntervalMs(timeoutMs: number): number {
  const scaled = Math.round(timeoutMs / CHECKS_PER_TIMEOUT);
  return Math.max(MIN_CHECK_INTERVAL_MS, Math.min(MAX_CHECK_INTERVAL_MS, scaled));
}

export interface WatchdogOptions {
  /** Files (such as DB/WAL) whose growth indicates active storage progress. */
  progressPaths?: string[];
}

/** Dependency-injected entry point for deterministic unit verification. */
export function installMainThreadWatchdogWithRuntime(
  options: WatchdogOptions,
  runtime: WatchdogRuntimeDependencies,
): WatchdogHandle | null {
  if (isDisabledFlagSet(process.env.AFYX_GRAPH_NO_WATCHDOG)) {
    return null;
  }

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

/** Start the liveness watchdog for this process, or return `null` when disabled. */
export function installMainThreadWatchdog(options: WatchdogOptions = {}): WatchdogHandle | null {
  return installMainThreadWatchdogWithRuntime(options, {});
}
