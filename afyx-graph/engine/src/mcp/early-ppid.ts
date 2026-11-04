/**
 * Capture the parent during module evaluation, before ordinary MCP startup.
 * Node cannot observe the spawn-to-first-JS window; startup abandonment covers
 * the case where reparenting already happened before this module ran.
 */
function captureParentPid(readParent: () => number): number {
  return readParent();
}

export const EARLY_PPID: number = captureParentPid(() => process.ppid);
