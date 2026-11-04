/**
 * Path and identity helpers for the shared daemon's IPC surface (issue #411).
 *
 * One daemon per project root means every cooperating process needs a
 * stable, project-keyed way to find it. That surface is normally two paths:
 *
 *   - `daemon.sock` — the Unix-domain socket (a named pipe on Windows) the
 *     daemon listens on.
 *   - `daemon.pid` — the atomically-created lockfile holding its pid and version.
 *
 * On Windows the bound lock also advertises a dedicated named pipe for
 * lifecycle probes and shutdown, keeping management available while the data
 * pipe carries a long-lived MCP session.
 *
 * Both live under `.afyx-graph/`, so a project-scoped `afyx-graph uninit`
 * sweeps them up for free, with no special-casing needed.
 *
 * Two platform hazards complicate the socket path specifically:
 *
 *   1. Unix-domain socket paths have a hard length ceiling (roughly 104 bytes
 *      on macOS, 108 on Linux). When the in-project path would exceed it,
 *      binding falls back to a hashed path under `os.tmpdir()` instead. The
 *      pidfile has no such limit and always stays in the project, acting as
 *      the authoritative record of whichever socket path the daemon actually
 *      chose.
 *   2. Some filesystems can't host an AF_UNIX node at all — ExFAT/FAT
 *      external volumes, some network mounts, WSL2 DrvFs — and `listen()`
 *      there throws ENOTSUP/EACCES regardless of path length (#997, #974).
 *      Telling those apart from an ordinary volume ahead of time isn't
 *      cheap, so rather than guess, {@link getDaemonSocketCandidates}
 *      exposes an ORDERED list: the in-project path first, the deterministic
 *      tmpdir path as the last resort. The daemon binds the first candidate
 *      that works, relocating past anything that fails for a capability
 *      reason; the proxy connects to the first one that answers. Both walk
 *      the exact same list, so they converge on whichever the daemon
 *      actually bound with no coordination between them at all.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { getAfyxGraphDir, usesExternalStateDir } from '../directory';

/** Soft ceiling for an in-project socket path before it's considered too long to risk. */
const POSIX_SOCKET_PATH_LIMIT = 100;

/** Canonical display/socket spelling while preserving the historical pipe hash contract. */
export function canonicalDaemonProjectRoot(projectRoot: string): string {
  const resolvedRoot = path.resolve(projectRoot);
  let canonicalRoot = resolvedRoot;
  if (process.platform === 'win32') {
    // `realpathSync()` preserves the caller's spelling on Windows, while the
    // native variant returns the filesystem's stable component casing.  Keep
    // the drive letter lower-case for compatibility with existing daemons
    // launched from the common `d:\\...` project spelling.
    try { canonicalRoot = fs.realpathSync.native(resolvedRoot); } catch { /* path may not exist yet */ }
    canonicalRoot = canonicalRoot.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
  } else if (usesExternalStateDir()) {
    canonicalRoot = fs.realpathSync(resolvedRoot);
  }
  return path.normalize(canonicalRoot);
}

/** Stable socket identity; external state remains part of the project boundary. */
function daemonSocketIdentity(projectRoot: string): string {
  const canonicalRoot = canonicalDaemonProjectRoot(projectRoot);
  return usesExternalStateDir()
    ? `${canonicalRoot}\0${getAfyxGraphDir(canonicalRoot)}`
    : canonicalRoot;
}

/**
 * Comparison/registry identity. Windows paths are case-insensitive, but the
 * socket identity above deliberately preserves its existing hash contract.
 */
export function daemonProjectComparisonKey(projectRoot: string): string {
  const identity = daemonSocketIdentity(projectRoot);
  return process.platform === 'win32' ? identity.toLowerCase() : identity;
}

/** Short, stable, project-scoped identifier — the basis for both the tmpdir path and the Windows pipe name. */
function projectHash(projectRoot: string): string {
  const identity = daemonSocketIdentity(projectRoot);
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

function windowsPipeName(projectRoot: string): string {
  return `\\\\.\\pipe\\afyx-graph-${projectHash(projectRoot)}`;
}

/**
 * Dedicated Windows management pipe. A long-lived MCP proxy can occupy the
 * data pipe on some native Node/Windows combinations, so lifecycle probes and
 * shutdown requests use an independent pipe instance instead of competing
 * with application traffic. POSIX keeps its existing single-socket behavior.
 */
export function getDaemonControlSocketPath(projectRoot: string): string | null {
  return process.platform === 'win32' ? `${windowsPipeName(projectRoot)}-control` : null;
}

/**
 * The deterministic tmpdir socket path for `projectRoot` — the fallback for
 * an in-project location that can't host a socket (too long a path, or a
 * filesystem without AF_UNIX support). Being a pure function of the project
 * root, purely hash-derived, means the daemon and every proxy compute the
 * identical path independently, without ever needing to tell each other
 * what they picked.
 */
function tmpdirSocketPath(projectRoot: string): string {
  return path.join(os.tmpdir(), `afyx-graph-${projectHash(projectRoot)}.sock`);
}

function inProjectSocketPath(projectRoot: string): string {
  return path.join(getAfyxGraphDir(projectRoot), 'daemon.sock');
}

/**
 * The ordered list of socket (or named-pipe) paths the daemon should try to
 * bind, and the proxy should try to connect, for `projectRoot` — most
 * preferred first. A pure function of the root, so independent processes
 * converge on the same choice with no coordination, even when the preferred
 * candidate turns out to be unusable and both fall through to the same
 * fallback:
 *
 *   - **Windows** gets exactly one candidate: a named pipe. It lives in the
 *     kernel's own pipe namespace rather than on the project's filesystem,
 *     so neither the length limit nor the ExFAT hazard below applies to it.
 *   - A **short in-project path** yields `[daemon.sock, <tmpdir path>]` — try
 *     the project location first, fall back to tmpdir only if that
 *     filesystem can't host a socket at all (#997).
 *   - A **long in-project path** (deep monorepos, Bazel-style out dirs)
 *     yields `[<tmpdir path>]` alone — binding it would throw ENAMETOOLONG,
 *     so candidates skip straight to tmpdir instead of trying and failing first.
 */
export function getDaemonSocketCandidates(projectRoot: string): string[] {
  if (process.platform === 'win32') return [windowsPipeName(projectRoot)];
  const inProject = inProjectSocketPath(projectRoot);
  // An explicit external-state contract must never spill a socket into the OS
  // temp directory. A too-long socket path therefore fails at bind time.
  if (usesExternalStateDir()) return [inProject];
  if (inProject.length > POSIX_SOCKET_PATH_LIMIT) return [tmpdirSocketPath(projectRoot)];
  return [inProject, tmpdirSocketPath(projectRoot)];
}

/**
 * The single PREFERRED socket path — candidate 0 — for callers that only
 * want one representative path (the lockfile's informational `socketPath`
 * field, a status display). Binding or connecting should instead walk the
 * full {@link getDaemonSocketCandidates} list, since the daemon may have
 * bound a fallback candidate when this one turned out to be unusable.
 */
export function getDaemonSocketPath(projectRoot: string): string {
  // The candidate list is never empty on any platform, so index 0 is safe.
  return getDaemonSocketCandidates(projectRoot)[0]!;
}

/** Absolute path to the daemon's pid lockfile for `projectRoot`. */
export function getDaemonPidPath(projectRoot: string): string {
  return path.join(getAfyxGraphDir(projectRoot), 'daemon.pid');
}

/** The structured contents of the pid lockfile. */
export interface DaemonLockInfo {
  pid: number;
  version: string;
  socketPath: string;
  /** Windows-only lifecycle endpoint; absent in older and POSIX lock records. */
  controlSocketPath?: string;
  startedAt: number;
}

function managementSocketPath(info: DaemonLockInfo): string {
  return info.controlSocketPath || info.socketPath;
}

/**
 * Identity-bound management request sent only after the daemon hello matches
 * the lockfile. This is not cryptographic authentication or OS-level caller
 * authorization; local IPC access remains governed by the host and pipe ACLs.
 */
export interface DaemonControlRequest {
  afyx_graph_control: 1;
  action: 'shutdown';
  pid: number;
  startedAt: number;
}

interface DaemonControlReply {
  afyx_graph_control: 1;
  status: 'accepted' | 'rejected';
  pid: number;
  startedAt: number;
  detail?: string;
}

export type DaemonShutdownRequestResult =
  | { outcome: 'accepted' }
  | { outcome: 'identity-mismatch'; detail: string }
  | { outcome: 'permission-denied'; detail: string }
  | { outcome: 'unavailable'; detail: string }
  | { outcome: 'rejected'; detail: string };

/** Convert a native IPC error into an actionable, bounded management result. */
export function classifyDaemonIpcError(err: NodeJS.ErrnoException): DaemonShutdownRequestResult {
  const detail = `${err.code ?? 'IPC_ERROR'}: ${err.message}`;
  return err.code === 'EACCES' || err.code === 'EPERM'
    ? { outcome: 'permission-denied', detail }
    : { outcome: 'unavailable', detail };
}

/** Whether a lock record carries enough identity information to attempt a socket-hello probe at all. */
export function canProbeDaemonIdentity(info: DaemonLockInfo): boolean {
  return Number.isInteger(info.pid) && info.pid > 0 && typeof info.socketPath === 'string' && info.socketPath.length > 0;
}

const IDENTITY_PROBE_TIMEOUT_MS = 1_000;
const IDENTITY_PROBE_MAX_HELLO_BYTES = 4096;

function helloMatchesLockRecord(hello: Record<string, unknown>, info: DaemonLockInfo): boolean {
  return (hello.protocol === 1 || hello.protocol === 2)
    && hello.pid === info.pid
    && (info.version === 'unknown' || hello.afyxGraph === info.version);
}

/** Parse the bounded first-line management preface accepted by the daemon. */
export function parseDaemonControlRequestLine(line: string): DaemonControlRequest | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (
      value.afyx_graph_control === 1
      && value.action === 'shutdown'
      && Number.isInteger(value.pid)
      && (value.pid as number) > 0
      && typeof value.startedAt === 'number'
      && Number.isFinite(value.startedAt)
    ) return value as unknown as DaemonControlRequest;
  } catch { /* not a control request */ }
  return null;
}

/**
 * Corroborate that the endpoint named by a lockfile reports the expected Afyx
 * Graph PID/version. This does not authenticate the caller or cryptographically
 * prove process identity. A bare pid-liveness check can't establish even this
 * bounded identity match on its own — the OS can and does reuse pids after an
 * OOM-kill or SIGKILL (#1553), so the bounded match also requires a live
 * socket hello.
 */
export function probeDaemonIdentity(info: DaemonLockInfo, timeoutMs = IDENTITY_PROBE_TIMEOUT_MS): Promise<boolean> {
  if (!canProbeDaemonIdentity(info)) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let received = '';
    let socket: net.Socket;

    const settle = (matched: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(matched);
    };

    const onData = (chunk: string): void => {
      received += chunk;
      if (received.length > IDENTITY_PROBE_MAX_HELLO_BYTES) return settle(false);
      const newlineAt = received.indexOf('\n');
      if (newlineAt < 0) return;
      try {
        settle(helloMatchesLockRecord(JSON.parse(received.slice(0, newlineAt)) as Record<string, unknown>, info));
      } catch {
        settle(false);
      }
    };

    const timer = setTimeout(() => settle(false), timeoutMs);
    timer.unref?.();

    try {
      socket = net.createConnection(managementSocketPath(info));
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    socket.setEncoding('utf8');
    socket.on('data', onData);
    socket.on('error', () => settle(false));
    socket.on('close', () => settle(false));
  });
}

/** Ask the exact daemon named by `info` to shut itself down gracefully over its IPC pipe. */
export function requestDaemonShutdown(
  info: DaemonLockInfo,
  timeoutMs = 3_000,
): Promise<DaemonShutdownRequestResult> {
  if (!canProbeDaemonIdentity(info)) {
    return Promise.resolve({ outcome: 'identity-mismatch', detail: 'daemon lock lacks a probeable identity' });
  }

  return new Promise<DaemonShutdownRequestResult>((resolve) => {
    let settled = false;
    let received = '';
    let helloVerified = false;
    let socket: net.Socket;

    const settle = (result: DaemonShutdownRequestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const unavailable = (err: NodeJS.ErrnoException): void => {
      settle(classifyDaemonIpcError(err));
    };
    const consumeLines = (): void => {
      while (!settled) {
        const newlineAt = received.indexOf('\n');
        if (newlineAt < 0) return;
        const line = received.slice(0, newlineAt);
        received = received.slice(newlineAt + 1);
        let message: Record<string, unknown>;
        try { message = JSON.parse(line) as Record<string, unknown>; }
        catch {
          settle({ outcome: 'identity-mismatch', detail: 'daemon returned malformed identity data' });
          return;
        }
        if (!helloVerified) {
          if (!helloMatchesLockRecord(message, info)) {
            settle({ outcome: 'identity-mismatch', detail: 'named-pipe hello does not match the authoritative daemon lock' });
            return;
          }
          helloVerified = true;
          const request: DaemonControlRequest = {
            afyx_graph_control: 1,
            action: 'shutdown',
            pid: info.pid,
            startedAt: info.startedAt,
          };
          socket.write(JSON.stringify(request) + '\n');
          continue;
        }
        const reply = message as unknown as DaemonControlReply;
        if (reply.afyx_graph_control !== 1 || reply.pid !== info.pid || reply.startedAt !== info.startedAt) {
          settle({ outcome: 'identity-mismatch', detail: 'shutdown acknowledgement does not match the authoritative daemon lock' });
          return;
        }
        settle(reply.status === 'accepted'
          ? { outcome: 'accepted' }
          : { outcome: 'rejected', detail: reply.detail ?? 'daemon rejected the shutdown request' });
      }
    };
    const onData = (chunk: string): void => {
      received += chunk;
      if (received.length > IDENTITY_PROBE_MAX_HELLO_BYTES) {
        settle({ outcome: 'identity-mismatch', detail: 'daemon response exceeded the identity bound' });
        return;
      }
      consumeLines();
    };

    const timer = setTimeout(() => settle({
      outcome: 'unavailable',
      detail: helloVerified ? 'timed out waiting for shutdown acknowledgement' : 'timed out waiting for daemon identity hello',
    }), timeoutMs);
    timer.unref?.();

    try { socket = net.createConnection(managementSocketPath(info)); }
    catch (err) {
      clearTimeout(timer);
      resolve({ outcome: 'unavailable', detail: err instanceof Error ? err.message : String(err) });
      return;
    }
    socket.setEncoding('utf8');
    socket.on('data', onData);
    socket.on('error', unavailable);
    socket.on('close', () => {
      if (!settled) settle({ outcome: 'unavailable', detail: 'daemon pipe closed before shutdown acknowledgement' });
    });
  });
}

/**
 * Serialize a {@link DaemonLockInfo} for the pidfile. Pretty-printed JSON —
 * an operator occasionally `cat`s this file directly while debugging, and
 * readability there costs nothing.
 */
export function encodeLockInfo(info: DaemonLockInfo): string {
  return JSON.stringify(info, null, 2) + '\n';
}

function decodeStructuredLockInfo(parsed: unknown): DaemonLockInfo | null {
  if (
    parsed &&
    typeof (parsed as Record<string, unknown>).pid === 'number' &&
    typeof (parsed as Record<string, unknown>).version === 'string' &&
    typeof (parsed as Record<string, unknown>).socketPath === 'string' &&
    typeof (parsed as Record<string, unknown>).startedAt === 'number' &&
    ((parsed as Record<string, unknown>).controlSocketPath === undefined ||
      typeof (parsed as Record<string, unknown>).controlSocketPath === 'string')
  ) {
    return parsed as DaemonLockInfo;
  }
  return null;
}

/** A bare positive decimal integer — the shape of a pre-#411 plain-pid lockfile, e.g. `"12345"`. */
const LEGACY_PLAIN_PID_PATTERN = /^[1-9]\d*$/;

function decodeLegacyPlainPidLockInfo(trimmed: string): DaemonLockInfo | null {
  if (!LEGACY_PLAIN_PID_PATTERN.test(trimmed)) return null;
  const pid = Number(trimmed);
  if (!Number.isSafeInteger(pid)) return null;
  return { pid, version: 'unknown', socketPath: '', startedAt: 0 };
}

/**
 * Parse a pidfile's contents, tolerating the old plain-decimal-pid format so
 * a newer daemon never trips over a lockfile an older one left behind — such
 * a record decodes as "an unknown-version process", which the caller treats
 * as not safe to share.
 *
 * The legacy parser runs whenever the structured decode comes back null,
 * which happens for two different reasons: the text isn't valid JSON at all,
 * OR it parses fine but isn't shaped like a lock record. That second case
 * matters because a bare `"42"` IS valid JSON — it parses to the number 42
 * without throwing — so the fallback has to trigger on a failed shape match
 * too, not only on a parse exception.
 */
export function decodeLockInfo(raw: string): DaemonLockInfo | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let structured: DaemonLockInfo | null = null;
  try {
    structured = decodeStructuredLockInfo(JSON.parse(trimmed));
  } catch {
    structured = null;
  }
  return structured ?? decodeLegacyPlainPidLockInfo(trimmed);
}
