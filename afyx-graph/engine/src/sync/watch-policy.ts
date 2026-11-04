/**
 * Watch Policy
 *
 * Decides whether the live file watcher should run for a given project, and
 * why not when it shouldn't. Centralized so the watcher itself, the MCP
 * server (diagnostics), and the installer all reach the same conclusion.
 *
 * The WSL2 carve-out exists because native recursive `fs.watch` is
 * pathologically slow on `/mnt/*` drives (NTFS exposed over the 9p/drvfs
 * bridge): installing the recursive watch walks the whole tree, and every
 * readdir/stat crosses the Windows boundary. Inside an MCP server this stalls
 * the event loop during startup long enough to blow past host handshake
 * timeouts (opencode's 30s), so the tools never appear (issue #199).
 */

import * as fs from 'fs';
import { normalizePath } from '../utils';

type WslCache = { checked: boolean; value: boolean };
let wslCache: WslCache = { checked: false, value: false };

/**
 * Detect whether the current process is running under WSL (Windows
 * Subsystem for Linux). Cached after the first call.
 */
export function detectWsl(): boolean {
  if (wslCache.checked) return wslCache.value;

  const value = computeWslDetection();
  wslCache = { checked: true, value };
  return value;
}

function computeWslDetection(): boolean {
  if (process.platform !== 'linux') return false;
  if (hasWslEnvMarkers(process.env)) return true;
  return procVersionMentionsWsl();
}

function hasWslEnvMarkers(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

function procVersionMentionsWsl(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return version.includes('microsoft') || version.includes('wsl');
  } catch {
    return false;
  }
}

/**
 * True for a WSL Windows-drive mount like `/mnt/c` or `/mnt/d/project`. Only
 * a single-letter drive segment right after `/mnt/` counts, so a genuinely
 * fast Linux mount such as `/mnt/wsl/...` is never flagged.
 */
function isWindowsDriveMount(projectRoot: string): boolean {
  const DRIVE_MOUNT_PATTERN = /^\/mnt\/[a-z](\/|$)/i;
  return DRIVE_MOUNT_PATTERN.test(normalizePath(projectRoot));
}

/** Inputs a test can override so the decision is deterministic. */
export interface WatchProbe {
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to `detectWsl()`. */
  isWsl?: boolean;
}

type PolicyDecision = { disabled: true; reason: string } | { disabled: false };

/**
 * Precedence, first match wins:
 *  1. `AFYX_GRAPH_NO_WATCH=1`    -> off  (explicit opt-out always wins)
 *  2. `AFYX_GRAPH_FORCE_WATCH=1` -> on   (overrides auto-detection)
 *  3. WSL2 + `/mnt/*` drive     -> off  (recursive fs.watch is too slow; #199)
 */
function decide(projectRoot: string, probe: WatchProbe): PolicyDecision {
  const env = probe.env ?? process.env;

  if (env.AFYX_GRAPH_NO_WATCH === '1') {
    return { disabled: true, reason: 'AFYX_GRAPH_NO_WATCH=1 is set' };
  }
  if (env.AFYX_GRAPH_FORCE_WATCH === '1') {
    return { disabled: false };
  }
  const isWsl = probe.isWsl ?? detectWsl();
  if (isWsl && isWindowsDriveMount(projectRoot)) {
    return {
      disabled: true,
      reason: 'project is on a WSL2 /mnt/ drive, where recursive fs.watch is too slow to be reliable',
    };
  }
  return { disabled: false };
}

/**
 * Whether the file watcher should be disabled for a project, and why.
 * Returns a short human-readable reason when watching should be skipped, or
 * `null` when it should run normally.
 */
export function watchDisabledReason(projectRoot: string, probe: WatchProbe = {}): string | null {
  const decision = decide(projectRoot, probe);
  return decision.disabled ? decision.reason : null;
}

/** Test-only: reset the cached WSL detection. */
export function __resetWslCacheForTests(): void {
  wslCache = { checked: false, value: false };
}
