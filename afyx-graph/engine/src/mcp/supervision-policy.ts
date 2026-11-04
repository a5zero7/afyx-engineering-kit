/** Pure decisions shared by process-supervision runtime adapters. */

export interface ParentSupervisionSnapshot {
  originalPpid: number;
  currentPpid: number;
  hostPpid: number | null;
  isAlive: (pid: number) => boolean;
  platform: NodeJS.Platform;
}

/** Preserve the platform-specific supervision precedence without owning a timer. */
export function parentSupervisionLoss(snapshot: ParentSupervisionSnapshot): string | null {
  if (snapshot.currentPpid !== snapshot.originalPpid) {
    return `ppid ${snapshot.originalPpid} -> ${snapshot.currentPpid}`;
  }
  if (
    snapshot.platform === 'win32' &&
    snapshot.originalPpid > 1 &&
    !snapshot.isAlive(snapshot.originalPpid)
  ) {
    return `parent pid ${snapshot.originalPpid} exited`;
  }
  if (snapshot.hostPpid !== null && !snapshot.isAlive(snapshot.hostPpid)) {
    return `host pid ${snapshot.hostPpid} exited`;
  }
  return null;
}

/** Missing/invalid/negative values use the fallback; zero remains an explicit disable sentinel. */
export function parsePollingInterval(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

/** Missing/invalid values use the fallback; non-positive values disable the deadline. */
export function parseDisableableDeadline(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed <= 0 ? 0 : Math.floor(parsed);
}

/** Missing, invalid, or non-positive values use the positive fallback. */
export function parsePositiveDeadline(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Only a real process PID may identify an explicitly threaded host. */
export function parseSupervisedPid(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 1 ? parsed : null;
}

/** Small single-settlement primitive for timers and terminal event fan-in. */
export class SettlementGate {
  private settled = false;

  claim(): boolean {
    if (this.settled) return false;
    this.settled = true;
    return true;
  }
}
