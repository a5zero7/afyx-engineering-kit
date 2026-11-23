/**
 * Daemon idle/liveness timer mechanics — the raw arm/disarm/interval plumbing
 * for the three timers that decide when an otherwise-unwatched daemon should
 * exit:
 *
 *   - the idle-exit timer, armed only at zero connected clients;
 *   - the maxIdle inactivity backstop, a defense against a phantom client
 *     whose socket-close was never delivered (#692);
 *   - the client liveness sweep, which periodically drops any client whose
 *     peer process has died.
 *
 * This module owns only the timers themselves. The DECISIONS those timers
 * trigger (is this client's peer actually dead? should the backstop reap the
 * daemon right now?) stay with the daemon, which is the only thing that knows
 * about connected clients — see daemon.ts's `reapDeadClients`/
 * `backstopShouldExit`.
 */

export interface ActivityTimerOptions {
  idleTimeoutMs: number;
  maxIdleMs: number;
  clientSweepMs: number;
}

/** Default idle linger after the last client disconnects. */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/**
 * Hard ceiling on how long the daemon stays up with clients connected but no
 * inbound traffic. A backstop (#692): if a client's socket-close is never
 * delivered (a Windows named-pipe hazard) it stays counted forever and the
 * normal idle timer — which only arms at zero clients — never fires. A phantom
 * client sends no traffic, so bounding on inactivity reaps the daemon anyway.
 * Set generously so a real but momentarily-idle session isn't reaped mid-use.
 */
export const DEFAULT_MAX_IDLE_MS = 1_800_000; // 30 min

/** How often the daemon sweeps connected clients for a dead peer process (#692). */
export const DEFAULT_CLIENT_SWEEP_MS = 30_000;

function parseNonNegativeMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed); // 0 means "disabled" to every caller of these
}

export function resolveIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseNonNegativeMs(env.AFYX_GRAPH_DAEMON_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS);
}

export function resolveMaxIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseNonNegativeMs(env.AFYX_GRAPH_DAEMON_MAX_IDLE_MS, DEFAULT_MAX_IDLE_MS);
}

export function resolveClientSweepMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseNonNegativeMs(env.AFYX_GRAPH_DAEMON_CLIENT_SWEEP_MS, DEFAULT_CLIENT_SWEEP_MS);
}

/** Cadence cap for the maxIdle backstop interval, independent of how large maxIdleMs itself is. */
const MAX_IDLE_TICK_CAP_MS = 60_000;

export class ActivityTimers {
  private idleTimer: NodeJS.Timeout | null = null;
  private maxIdleTimer: NodeJS.Timeout | null = null;
  private clientSweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ActivityTimerOptions) {}

  /**
   * Arm the idle-exit timer. No-op if already armed, if the caller reports
   * `stopped`, or if idle-exit is disabled (`idleTimeoutMs <= 0`). `onFire`
   * runs once, with the timer already cleared, when the delay elapses.
   */
  armIdle(stopped: boolean, onFire: () => void): void {
    if (this.idleTimer || stopped) return;
    if (this.options.idleTimeoutMs <= 0) return; // 0 = never idle-exit
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      onFire();
    }, this.options.idleTimeoutMs);
    // Don't keep the event loop alive just for this — the net.Server keeps the
    // loop alive while listening, so the timer still fires; once stopped the
    // loop should drain naturally.
    this.idleTimer.unref?.();
  }

  disarmIdle(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /**
   * Start the maxIdle backstop and client-sweep intervals (each only if its
   * threshold is > 0). Both unref'd — the listening server keeps the loop
   * alive, and neither timer should hold it open on its own.
   */
  startLiveness(onBackstopTick: () => void, onSweepTick: () => void): void {
    if (this.options.maxIdleMs > 0) {
      const tick = Math.min(this.options.maxIdleMs, MAX_IDLE_TICK_CAP_MS);
      this.maxIdleTimer = setInterval(onBackstopTick, tick);
      this.maxIdleTimer.unref?.();
    }
    if (this.options.clientSweepMs > 0) {
      this.clientSweepTimer = setInterval(onSweepTick, this.options.clientSweepMs);
      this.clientSweepTimer.unref?.();
    }
  }

  /** Clear every armed timer. Idempotent. */
  stopAll(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxIdleTimer) {
      clearInterval(this.maxIdleTimer);
      this.maxIdleTimer = null;
    }
    if (this.clientSweepTimer) {
      clearInterval(this.clientSweepTimer);
      this.clientSweepTimer = null;
    }
  }
}
