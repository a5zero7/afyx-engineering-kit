/**
 * Pure main-loop silence policy. The same class is serialized into the
 * watchdog child, so tests and the isolated runtime execute one decision model.
 */
export class ProgressSilencePolicy {
  private silenceStartedAt: number | null = null;
  private lastHealthySampleAt: number;

  constructor(
    private readonly timeoutMs: number,
    private readonly capMs: number,
    private baseline: string,
    now: number,
  ) {
    this.lastHealthySampleAt = now;
  }

  shouldSampleHealthyProgress(now: number): boolean {
    return now - this.lastHealthySampleAt >= 1000;
  }

  heartbeat(now: number, sample?: string): void {
    this.silenceStartedAt = null;
    if (sample !== undefined) {
      this.baseline = sample;
      this.lastHealthySampleAt = now;
    }
  }

  deadline(now: number, sample: string): 'defer' | 'terminate-stalled' | 'terminate-hard-cap' {
    this.silenceStartedAt ??= now - this.timeoutMs;
    const withinCap = now - this.silenceStartedAt < this.capMs;
    if (sample !== this.baseline && withinCap) {
      this.baseline = sample;
      return 'defer';
    }
    return sample !== this.baseline ? 'terminate-hard-cap' : 'terminate-stalled';
  }
}

/** Self-contained entry point executed by `node -e` in the watchdog process. */
function watchdogChildMain(): void {
  // These globals are intentionally resolved only inside the child process.
  const fs = require('fs') as typeof import('fs');
  const parentPid = Number(process.argv[1]);
  const timeoutMs = Number(process.argv[2]);
  const capMs = Number(process.argv[3]);
  const progressPaths = process.argv.slice(4);
  const timeoutSeconds = Math.round(timeoutMs / 1000);

  const fingerprint = (): string => progressPaths.map((filePath: string) => {
    try {
      const stat = fs.statSync(filePath);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return 'missing';
    }
  }).join(';');

  const terminateParent = (hardCap: boolean): never => {
    const suffix = hardCap
      ? ` despite ongoing disk activity (hard cap ${Math.round(capMs / 1000)}s reached)`
      : '';
    try {
      fs.writeSync(
        2,
        Buffer.from(
          `[${new Date().toISOString()}] [Afyx Graph] Main thread unresponsive for ~${timeoutSeconds}s${suffix}` +
          ' — killing the wedged process so a fresh one can start (#850). ' +
          'Disable with AFYX_GRAPH_NO_WATCHDOG=1.\n',
        ),
      );
    } catch { /* stderr may already be gone */ }
    try { process.kill(parentPid, 'SIGKILL'); } catch { /* parent already gone */ }
    process.exit(0);
  };

  const tracksProgress = progressPaths.length > 0;
  const progress = tracksProgress
    ? new ProgressSilencePolicy(timeoutMs, capMs, fingerprint(), Date.now())
    : null;
  let deadline: ReturnType<typeof setTimeout>;

  const armDeadline = (): void => {
    deadline = setTimeout(onDeadline, timeoutMs);
  };
  const onDeadline = (): void => {
    if (progress === null) {
      terminateParent(false);
      return;
    }
    const now = Date.now();
    const decision = progress.deadline(now, fingerprint());
    if (decision === 'defer') {
      armDeadline();
      return;
    }
    terminateParent(decision === 'terminate-hard-cap');
  };

  armDeadline();
  process.stdin.on('data', () => {
    const now = Date.now();
    const sample = progress?.shouldSampleHealthyProgress(now) ? fingerprint() : undefined;
    progress?.heartbeat(now, sample);
    clearTimeout(deadline);
    armDeadline();
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(0));
  process.stdin.resume();
}

/** Build the dependency-free child program from the tested policy implementation. */
export function watchdogChildSource(): string {
  return `${ProgressSilencePolicy.toString()}\n(${watchdogChildMain.toString()})();`;
}
