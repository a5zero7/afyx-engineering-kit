/**
 * Silence evaluation policy and standalone child monitor entry point for
 * AFYX Graph's external main-thread liveness watchdog.
 */

export type WatchdogVerdict = 'defer' | 'terminate-stalled' | 'terminate-hard-cap';

interface SilenceTrackerState {
  silentStartMs: number | null;
  lastHealthyPollMs: number;
  knownSignature: string;
}

/**
 * Tracks heartbeat gaps against disk-backed progress signatures so slow synchronous
 * storage operations can be tolerated up to an explicit hard ceiling.
 */
export class ProgressSilencePolicy {
  private readonly state: SilenceTrackerState;

  constructor(
    private readonly timeoutMs: number,
    private readonly capMs: number,
    initialSignature: string,
    startedAtMs: number,
  ) {
    this.state = {
      silentStartMs: null,
      lastHealthyPollMs: startedAtMs,
      knownSignature: initialSignature,
    };
  }

  /** Limit healthy-path file metadata checks to once per second. */
  shouldSampleHealthyProgress(nowMs: number): boolean {
    return nowMs - this.state.lastHealthyPollMs >= 1_000;
  }

  /** Clear active silence tracking on receipt of a heartbeat pulse. */
  heartbeat(nowMs: number, currentSignature?: string): void {
    this.state.silentStartMs = null;
    if (currentSignature !== undefined) {
      this.state.knownSignature = currentSignature;
      this.state.lastHealthyPollMs = nowMs;
    }
  }

  /** Evaluate whether a missed heartbeat deadline should defer or terminate. */
  deadline(nowMs: number, currentSignature: string): WatchdogVerdict {
    if (this.state.silentStartMs === null) {
      this.state.silentStartMs = nowMs - this.timeoutMs;
    }

    const diskChanged = currentSignature !== this.state.knownSignature;
    if (!diskChanged) {
      return 'terminate-stalled';
    }

    const silentElapsedMs = nowMs - this.state.silentStartMs;
    if (silentElapsedMs < this.capMs) {
      this.state.knownSignature = currentSignature;
      return 'defer';
    }
    return 'terminate-hard-cap';
  }
}

/**
 * Dependency-free child supervisor executed inside `node -e`.
 * Reads target PID, timeout, cap, and optional progress paths from `process.argv`.
 */
function runExternalWatchdogChild(): void {
  const nodeFs = require('fs') as typeof import('fs');
  const targetPid = Number(process.argv[1]);
  const timeoutMs = Number(process.argv[2]);
  const hardCapMs = Number(process.argv[3]);
  const watchedPaths = process.argv.slice(4);
  const timeoutSec = Math.round(timeoutMs / 1_000);
  const capSec = Math.round(hardCapMs / 1_000);

  const readArtifactSignature = (): string =>
    watchedPaths
      .map((targetPath: string) => {
        try {
          const stats = nodeFs.statSync(targetPath);
          return `${stats.size}:${stats.mtimeMs}`;
        } catch {
          return 'absent';
        }
      })
      .join('|');

  const terminateParentProcess = (reason: 'stalled' | 'hard-cap'): never => {
    const reasonDetail =
      reason === 'hard-cap'
        ? ` despite ongoing storage activity (hard cap ${capSec}s reached)`
        : '';
    const diagnosticLine =
      `[${new Date().toISOString()}] [Afyx Graph] Main event loop unresponsive for ~${timeoutSec}s${reasonDetail}; ` +
      'terminating stalled process for clean recovery. Disable via AFYX_GRAPH_NO_WATCHDOG=1.\n';

    try {
      nodeFs.writeSync(2, Buffer.from(diagnosticLine));
    } catch {
      // Standard error may already be closed when parent crashes.
    }
    try {
      process.kill(targetPid, 'SIGKILL');
    } catch {
      // Parent process already terminated.
    }
    process.exit(0);
  };

  const progressTracker =
    watchedPaths.length > 0
      ? new ProgressSilencePolicy(timeoutMs, hardCapMs, readArtifactSignature(), Date.now())
      : null;

  let activeTimer: ReturnType<typeof setTimeout>;

  const handleTimerExpired = (): void => {
    if (progressTracker === null) {
      terminateParentProcess('stalled');
      return;
    }
    const decision = progressTracker.deadline(Date.now(), readArtifactSignature());
    if (decision === 'defer') {
      activeTimer = setTimeout(handleTimerExpired, timeoutMs);
      return;
    }
    terminateParentProcess(decision === 'terminate-hard-cap' ? 'hard-cap' : 'stalled');
  };

  const resetTimer = (): void => {
    activeTimer = setTimeout(handleTimerExpired, timeoutMs);
  };

  resetTimer();

  process.stdin.on('data', () => {
    if (progressTracker !== null) {
      const timestamp = Date.now();
      const snapshot = progressTracker.shouldSampleHealthyProgress(timestamp)
        ? readArtifactSignature()
        : undefined;
      progressTracker.heartbeat(timestamp, snapshot);
    }
    clearTimeout(activeTimer);
    resetTimer();
  });

  const exitCleanly = (): void => process.exit(0);
  process.stdin.on('end', exitCleanly);
  process.stdin.on('error', exitCleanly);
  process.stdin.resume();
}

/** Serialize policy logic and child supervisor entry point for `node -e` execution. */
export function watchdogChildSource(): string {
  return `${ProgressSilencePolicy.toString()}\n(${runExternalWatchdogChild.toString()})();`;
}
