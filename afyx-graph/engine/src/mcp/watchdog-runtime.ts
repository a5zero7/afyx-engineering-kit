/**
 * Runtime launcher and pipe heartbeat controller for the external liveness watchdog process.
 */
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { usesExternalStateDir } from '../directory';
import { SettlementGate } from './supervision-policy';

export interface WatchdogHandle {
  stop(): void;
}

export interface WatchdogRuntimeConfig {
  childSource: string;
  timeoutMs: number;
  checkMs: number;
  capMs: number;
  progressPaths: string[];
}

export interface WatchdogRuntimeDependencies {
  spawnProcess?: typeof spawn;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  executable?: string;
  parentPid?: number;
  cwd?: string;
}

function logWatchdogDebug(message: string): void {
  if (!process.env.AFYX_GRAPH_MCP_DEBUG) return;
  try {
    fs.writeSync(2, `[Afyx Graph watchdog] ${message}\n`);
  } catch {
    // Ignore diagnostic write failures.
  }
}

function buildChildEnvironment(): NodeJS.ProcessEnv | undefined {
  if (!usesExternalStateDir()) return undefined;
  const envCopy: NodeJS.ProcessEnv = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' };
  delete envCopy.NODE_COMPILE_CACHE;
  return envCopy;
}

function detachUnreferenced(handle: unknown): void {
  try {
    (handle as { unref?: () => void } | null | undefined)?.unref?.();
  } catch {
    // Ignore handles that do not support unref().
  }
}

/**
 * Spawn an external Node watchdog process, establish periodic stdin heartbeats,
 * and return an idempotent shutdown handle. Returns `null` if spawn fails or no
 * stdin pipe is available.
 */
export function startWatchdogRuntime(
  config: WatchdogRuntimeConfig,
  dependencies: WatchdogRuntimeDependencies = {},
): WatchdogHandle | null {
  const spawnChild = dependencies.spawnProcess ?? spawn;
  const childArgs = [
    '-e',
    config.childSource,
    String(dependencies.parentPid ?? process.pid),
    String(config.timeoutMs),
    String(config.capMs),
    ...config.progressPaths,
  ];

  let monitorProcess: ChildProcess;
  try {
    monitorProcess = spawnChild(
      dependencies.executable ?? process.execPath,
      childArgs,
      {
        stdio: ['pipe', 'ignore', 'inherit'],
        windowsHide: true,
        cwd: dependencies.cwd ?? os.tmpdir(),
        env: buildChildEnvironment(),
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logWatchdogDebug(`spawn failed: ${reason}`);
    return null;
  }

  const pipe = monitorProcess.stdin;
  if (!pipe) {
    logWatchdogDebug('child has no stdin pipe; aborting arm');
    try {
      monitorProcess.kill();
    } catch {
      // Ignore already exited child.
    }
    return null;
  }

  pipe.on('error', () => {
    // Heartbeat pipe breaks harmlessly when child exits.
  });
  monitorProcess.on('error', (err) => {
    logWatchdogDebug(`child error: ${err.message}`);
  });

  const scheduleInterval = dependencies.setIntervalFn ?? setInterval;
  const cancelInterval = dependencies.clearIntervalFn ?? clearInterval;

  const beatTimer = scheduleInterval(() => {
    try {
      pipe.write('\n');
    } catch {
      // Child already exited.
    }
  }, config.checkMs);

  detachUnreferenced(beatTimer);
  detachUnreferenced(monitorProcess);
  detachUnreferenced(pipe);

  logWatchdogDebug(
    `armed (pid=${monitorProcess.pid ?? 'unknown'}, timeoutMs=${config.timeoutMs}, checkMs=${config.checkMs}, watched=${config.progressPaths.length})`,
  );

  const teardownGate = new SettlementGate();
  return {
    stop(): void {
      if (!teardownGate.claim()) return;
      cancelInterval(beatTimer);
      try {
        pipe.end();
      } catch {
        // Pipe already ended.
      }
      try {
        monitorProcess.kill();
      } catch {
        // Process already exited.
      }
    },
  };
}
