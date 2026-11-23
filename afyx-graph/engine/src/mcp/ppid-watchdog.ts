/** Stable PPID/host supervision facade backed by Afyx-owned policy. */
import {
  parentSupervisionLoss,
  parsePollingInterval,
  parseSupervisedPid,
  type ParentSupervisionSnapshot,
} from './supervision-policy';

export interface SupervisionState extends Omit<ParentSupervisionSnapshot, 'platform'> {
  platform?: NodeJS.Platform;
}

export function supervisionLostReason(state: SupervisionState): string | null {
  return parentSupervisionLoss({ ...state, platform: state.platform ?? process.platform });
}

export const DEFAULT_PPID_POLL_MS = 5000;

/** Optional launcher-provided PID for supervising the original host process. */
export const HOST_PPID_ENV = 'AFYX_GRAPH_HOST_PPID';

export function parsePpidPollMs(raw: string | undefined): number {
  return parsePollingInterval(raw, DEFAULT_PPID_POLL_MS);
}

export function parseHostPpid(raw: string | undefined): number | null {
  return parseSupervisedPid(raw);
}

export interface PpidWatchdogOptions {
  originalPpid: number;
  hostPpid: number | null;
  isAlive: (pid: number) => boolean;
  pollMsRaw?: string;
}

/** Install one unref'd poller; zero remains the explicit disable sentinel. */
export function installPpidWatchdog(
  onLost: (reason: string) => void,
  options: PpidWatchdogOptions,
): NodeJS.Timeout | null {
  const pollMs = parsePpidPollMs(options.pollMsRaw);
  if (pollMs <= 0) return null;
  const timer = setInterval(() => {
    const reason = supervisionLostReason({
      originalPpid: options.originalPpid,
      currentPpid: process.ppid,
      hostPpid: options.hostPpid,
      isAlive: options.isAlive,
    });
    if (reason !== null) onLost(reason);
  }, pollMs);
  timer.unref?.();
  return timer;
}
