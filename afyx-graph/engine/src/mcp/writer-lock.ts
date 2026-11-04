/**
 * The project writer lock (#1740).
 *
 * A given project may have at most one long-lived MCP *writer* — either the
 * shared daemon, or a direct-mode / in-process engine that owns the
 * FileWatcher. The shared daemon already multiplexes many stdio proxies onto
 * one writer on its own; this lock closes the remaining same-machine gap,
 * where two direct-mode `serve --mcp` processes (reached via
 * `AFYX_GRAPH_NO_DAEMON=1`, or a proxy's own in-process fallback) could each
 * start a watcher, fight over `afyx-graph.lock`, and degrade auto-sync for
 * both.
 *
 * Kept deliberately separate from `daemon.pid`: a proxy probes the daemon
 * socket directly and may clear a live pid that answers no socket at all, so
 * a direct-mode holder must never be mistaken for a daemon. `writer.pid`
 * answers exactly one question — who currently owns live auto-sync — and
 * nothing else.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAfyxGraphDir } from '../directory';
import { isProcessAlive } from './process-liveness';
import { acquireAtomicLockfile } from './atomic-lockfile';

/** Absolute path to the writer pid lockfile for `projectRoot`. */
export function getWriterPidPath(projectRoot: string): string {
  let root = projectRoot;
  try { root = fs.realpathSync(projectRoot); } catch { /* keep lexical */ }
  return path.join(getAfyxGraphDir(root), 'writer.pid');
}

/** Structured contents of the writer pidfile. */
export interface WriterLockInfo {
  pid: number;
  /** `direct` | `daemon` | `fallback` — for actionable error text only. */
  mode: string;
  startedAt: number;
}

export type WriterAcquireResult =
  | { kind: 'acquired'; pidPath: string; info: WriterLockInfo }
  | { kind: 'taken'; existing: WriterLockInfo | null; pidPath: string };

function encode(info: WriterLockInfo): string {
  return JSON.stringify(info) + '\n';
}

export function decodeWriterLockInfo(raw: string): WriterLockInfo | null {
  try {
    const parsed = JSON.parse(raw.trim()) as Partial<WriterLockInfo>;
    if (typeof parsed.pid !== 'number' || typeof parsed.mode !== 'string') return null;
    return {
      pid: parsed.pid,
      mode: parsed.mode,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

/** A holder counts as stale — safe to clear — when its record can't be read/decoded, or its pid isn't alive. */
function isStaleHolder(holder: WriterLockInfo | null): boolean {
  return !holder || holder.pid <= 0 || !isProcessAlive(holder.pid);
}

/**
 * Compare-and-delete the lockfile: re-read it immediately before unlinking,
 * so a different process that has since acquired it is never disturbed.
 * Bails out both if the current record no longer names the pid believed
 * stale, and if that fresh read shows it isn't actually stale after all — a
 * new, genuinely live holder could have raced in since the very first read.
 */
function clearIfStillStale(pidPath: string, believedStalePid: number | undefined): void {
  try {
    const current = decodeWriterLockInfo(fs.readFileSync(pidPath, 'utf8'));
    if (current && current.pid !== believedStalePid) return; // someone else's lock now
    if (isStaleHolder(current)) fs.unlinkSync(pidPath);
  } catch {
    /* ENOENT is fine — already gone */
  }
}

function attemptAcquire(pidPath: string, info: WriterLockInfo): WriterAcquireResult {
  const result = acquireAtomicLockfile(pidPath, encode(info));
  if (result.acquired) return { kind: 'acquired', pidPath, info };
  const existing = result.existingContents ? decodeWriterLockInfo(result.existingContents) : null;
  return { kind: 'taken', existing, pidPath };
}

/**
 * Atomically create `writer.pid` (link-into-place, falling back to O_EXCL).
 * A holder whose pid has died gets cleared and the acquire retried once;
 * a genuinely live holder is never stolen from.
 */
export function tryAcquireWriterLock(
  projectRoot: string,
  mode: string,
): WriterAcquireResult {
  const pidPath = getWriterPidPath(projectRoot);
  const info: WriterLockInfo = { pid: process.pid, mode, startedAt: Date.now() };

  const first = attemptAcquire(pidPath, info);
  if (first.kind === 'acquired') return first;

  // This same process already holds it — e.g. the daemon acquired it before
  // the engine's own watch() call reaches this point and re-acquires. Treat
  // that as ours already, not as contention.
  if (first.existing && first.existing.pid === process.pid) {
    return { kind: 'acquired', pidPath: first.pidPath, info: first.existing };
  }

  if (!isStaleHolder(first.existing)) return first;

  clearIfStillStale(pidPath, first.existing?.pid);
  return attemptAcquire(pidPath, info);
}

/**
 * Claim the existing project writer authority for a destructive full rebuild.
 *
 * Unlike the long-lived MCP acquisition path, rebuild never treats a malformed
 * or unreadable record as stale and never treats a same-PID record as
 * re-entrant.  A valid record whose process is demonstrably dead may be
 * compare-and-deleted; every ambiguous/live owner remains taken.  The atomic
 * lockfile primitive closes the check-then-delete race before SQLite files are
 * touched.
 */
export function tryAcquireFullReindexWriterLock(projectRoot: string): WriterAcquireResult {
  const pidPath = getWriterPidPath(projectRoot);
  const info: WriterLockInfo = { pid: process.pid, mode: 'reindex', startedAt: Date.now() };
  const first = attemptAcquire(pidPath, info);
  if (first.kind === 'acquired') return first;

  // An undecodable, inaccessible, invalid, or live record is inconclusive.
  // Full rebuild is destructive, so it must not recover ownership on a guess.
  if (!first.existing || first.existing.pid <= 0 || isProcessAlive(first.existing.pid)) return first;

  clearIfStillStale(pidPath, first.existing.pid);
  return attemptAcquire(pidPath, info);
}

function sameWriterLock(left: WriterLockInfo | null, right: WriterLockInfo): boolean {
  return !!left && left.pid === right.pid && left.mode === right.mode && left.startedAt === right.startedAt;
}

/** Release one exact claim, never a successor or another same-process role. */
export function releaseWriterLockClaim(projectRoot: string, claim: WriterLockInfo): void {
  const pidPath = getWriterPidPath(projectRoot);
  try {
    const current = decodeWriterLockInfo(fs.readFileSync(pidPath, 'utf8'));
    if (sameWriterLock(current, claim)) fs.unlinkSync(pidPath);
  } catch { /* best-effort; a missing claim is already released */ }
}

/** Hold full-reindex ownership from before recreate/delete until the action settles. */
export async function withFullReindexWriterLock<T>(
  projectRoot: string,
  action: () => Promise<T>,
): Promise<T> {
  const claim = tryAcquireFullReindexWriterLock(projectRoot);
  if (claim.kind === 'taken') throw new Error(writerLockHeldMessage(claim.existing, claim.pidPath));
  try {
    return await action();
  } finally {
    releaseWriterLockClaim(projectRoot, claim.info);
  }
}

/** Release if we still own the lock (pid match). */
export function releaseWriterLock(projectRoot: string): void {
  const pidPath = getWriterPidPath(projectRoot);
  try {
    if (!fs.existsSync(pidPath)) return;
    const info = decodeWriterLockInfo(fs.readFileSync(pidPath, 'utf8'));
    if (info && info.pid === process.pid) {
      fs.unlinkSync(pidPath);
    }
  } catch { /* best-effort */ }
}

/** Read current lock without acquiring. */
export function readWriterLock(projectRoot: string): WriterLockInfo | null {
  const pidPath = getWriterPidPath(projectRoot);
  try {
    return decodeWriterLockInfo(fs.readFileSync(pidPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Actionable message when another live process owns the writer lock (#1740).
 */
export function writerLockHeldMessage(
  existing: WriterLockInfo | null,
  pidPath: string,
): string {
  const who = existing && existing.pid > 0
    ? `PID ${existing.pid} (${existing.mode || 'unknown'} mode)`
    : 'another process';
  return (
    'Afyx Graph writer lock held by ' + who + '. ' +
    'Only one live Graph writer or full rebuild may own a project (auto-sync / index). ' +
    'Stop the other server (afyx-graph daemon stop if a shared daemon, or end the other MCP session), ' +
    'or unset AFYX_GRAPH_NO_DAEMON so additional clients proxy to the shared daemon. ' +
    'If this is believed stale, verify the recorded PID is no longer alive before removing ' + pidPath
  );
}
