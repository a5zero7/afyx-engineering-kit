/**
 * Shared supervision policies and single-shot settlement coordination for
 * AFYX Graph background servers and watchdogs.
 */

export interface ParentSupervisionSnapshot {
  originalPpid: number;
  currentPpid: number;
  hostPpid: number | null;
  isAlive: (pid: number) => boolean;
  platform: NodeJS.Platform;
}

const NODE_MAX_TIMEOUT_MS = 2_147_483_647;

type NumericParseRule = 'non-negative' | 'disableable' | 'positive';

function parseConfiguredNumber(
  raw: string | undefined,
  fallback: number,
  rule: NumericParseRule,
): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  if (rule === 'non-negative') {
    return parsed < 0 ? fallback : Math.floor(parsed);
  }
  if (rule === 'disableable') {
    return parsed <= 0 ? 0 : Math.min(Math.floor(parsed), NODE_MAX_TIMEOUT_MS);
  }
  return parsed > 0 ? Math.min(parsed, NODE_MAX_TIMEOUT_MS) : fallback;
}

/**
 * Evaluate parent/host liveness and return a diagnostic reason when
 * supervision authority is lost, or `null` while the parent chain is healthy.
 */
export function parentSupervisionLoss(snapshot: ParentSupervisionSnapshot): string | null {
  const rules: Array<() => string | null> = [
    () =>
      snapshot.currentPpid !== snapshot.originalPpid
        ? `ppid ${snapshot.originalPpid} -> ${snapshot.currentPpid}`
        : null,
    () =>
      snapshot.platform === 'win32'
      && snapshot.originalPpid > 1
      && !snapshot.isAlive(snapshot.originalPpid)
        ? `parent pid ${snapshot.originalPpid} exited`
        : null,
    () =>
      snapshot.hostPpid !== null && !snapshot.isAlive(snapshot.hostPpid)
        ? `host pid ${snapshot.hostPpid} exited`
        : null,
  ];

  for (const evaluate of rules) {
    const lossReason = evaluate();
    if (lossReason !== null) return lossReason;
  }
  return null;
}

/** Parse a polling cadence setting where `0` explicitly disables polling. */
export function parsePollingInterval(raw: string | undefined, fallback: number): number {
  return parseConfiguredNumber(raw, fallback, 'non-negative');
}

/** Parse a deadline setting where values `<= 0` disable monitoring (`0`). */
export function parseDisableableDeadline(raw: string | undefined, fallback: number): number {
  return parseConfiguredNumber(raw, fallback, 'disableable');
}

/** Parse a strictly positive duration setting, falling back on invalid values. */
export function parsePositiveDeadline(raw: string | undefined, fallback: number): number {
  return parseConfiguredNumber(raw, fallback, 'positive');
}

/** Parse a valid user-space host PID (`integer > 1`), or `null` if absent. */
export function parseSupervisedPid(raw: string | undefined): number | null {
  if (!raw) return null;
  const candidate = Number(raw);
  return Number.isInteger(candidate) && candidate > 1 ? candidate : null;
}

/** Coordinates one-time execution across competing asynchronous triggers. */
export class SettlementGate {
  private claimed = false;

  claim(): boolean {
    if (this.claimed) return false;
    this.claimed = true;
    return true;
  }

  get isSettled(): boolean {
    return this.claimed;
  }
}
