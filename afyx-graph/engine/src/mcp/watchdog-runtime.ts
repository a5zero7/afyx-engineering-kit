import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { usesExternalStateDir } from '../directory';

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

function debug(message: string): void {
  if (!process.env.AFYX_GRAPH_MCP_DEBUG) return;
  try { fs.writeSync(2, `[Afyx Graph watchdog] ${message}\n`); } catch { /* ignore */ }
}

/** Own the child process, heartbeat timer, and their idempotent teardown. */
export function startWatchdogRuntime(
  config: WatchdogRuntimeConfig,
  dependencies: WatchdogRuntimeDependencies = {},
): WatchdogHandle | null {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  let childEnv: NodeJS.ProcessEnv | undefined;
  if (usesExternalStateDir()) {
    childEnv = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' };
    delete childEnv.NODE_COMPILE_CACHE;
  }
  let child: ChildProcess;
  try {
    child = spawnProcess(
      dependencies.executable ?? process.execPath,
      [
        '-e', config.childSource,
        String(dependencies.parentPid ?? process.pid),
        String(config.timeoutMs),
        String(config.capMs),
        ...config.progressPaths,
      ],
      {
        stdio: ['pipe', 'ignore', 'inherit'],
        windowsHide: true,
        cwd: dependencies.cwd ?? os.tmpdir(),
        env: childEnv,
      },
    );
  } catch (error) {
    debug(`spawn failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const heartbeatStream = child.stdin;
  if (!heartbeatStream) {
    debug('child has no stdin pipe; not arming');
    try { child.kill(); } catch { /* already gone */ }
    return null;
  }

  heartbeatStream.on('error', () => { /* child exited; writes are best effort */ });
  child.on('error', (error) => debug(`child error: ${error.message}`));

  const schedule = dependencies.setIntervalFn ?? setInterval;
  const cancel = dependencies.clearIntervalFn ?? clearInterval;
  const heartbeat = schedule(() => {
    try { heartbeatStream.write('\n'); } catch { /* child already gone */ }
  }, config.checkMs);
  heartbeat.unref?.();
  child.unref();
  try { (heartbeatStream as unknown as { unref?: () => void }).unref?.(); } catch { /* ignore */ }

  debug(
    `armed (child pid ${child.pid ?? '?'}): timeoutMs=${config.timeoutMs} ` +
    `checkMs=${config.checkMs} progressPaths=${config.progressPaths.length}`,
  );

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      cancel(heartbeat);
      try { heartbeatStream.end(); } catch { /* already closed */ }
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}
