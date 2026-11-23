/**
 * Process liveness probes — shared by every lock/registry module that needs to
 * ask "is this PID still alive?" (daemon.ts, writer-lock.ts, daemon-registry.ts,
 * index.ts). Dependency-free on purpose: those modules would otherwise each
 * need their own private copy to avoid a cycle (daemon.ts imports
 * writer-lock.ts and daemon-registry.ts; daemon-registry.ts imports
 * writer-lock.ts) — a single leaf module every one of them can import from
 * removes the duplication without introducing any new edge.
 *
 * Two variants, not one — they differ in exactly one respect (whether a
 * non-positive pid short-circuits to "dead" before ever asking the kernel),
 * and callers are NOT interchangeable:
 *
 *   - {@link isProcessAlive} never special-cases the pid itself; `pid 0` is
 *     signal-0'd like any other and (per POSIX `kill(2)`) targets the caller's
 *     own process GROUP, which is always alive — so it reads as "alive". Used
 *     wherever a caller already trusts its pid is meaningful (typically
 *     because it just read it from a lockfile alongside an inline `pid > 0`
 *     check, or is intentionally checking a client-hello pid where treating
 *     an attacker-supplied `0` as "can't prove it's dead" is the conservative
 *     choice for a liveness *sweep* that would otherwise reap a real client).
 *   - {@link isValidPidAlive} rejects any non-positive/non-integer pid
 *     up front. Used by the discovery registry, which parses pids straight out
 *     of on-disk JSON it does not otherwise validate — a corrupt or
 *     hand-edited record must read as "dead" (prune it), never "alive".
 */

function signalZeroAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists, it's just not ours to signal — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Signal-0 liveness probe, no pid validation. See module doc for when to use this vs {@link isValidPidAlive}. */
export function isProcessAlive(pid: number): boolean {
  return signalZeroAlive(pid);
}

/** Signal-0 liveness probe that treats any non-positive/non-integer pid as dead. See module doc. */
export function isValidPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return signalZeroAlive(pid);
}
