/**
 * Initial parent process identifier sampled at module load time.
 * Captures the launcher PID before early reparenting can alter `process.ppid`.
 */
export function snapshotParentProcessId(
  readPid: () => number = () => process.ppid,
): number {
  const pid = readPid();
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

/** Parent PID recorded when the MCP/CLI runtime evaluates this module. */
export const EARLY_PPID: number = snapshotParentProcessId();
