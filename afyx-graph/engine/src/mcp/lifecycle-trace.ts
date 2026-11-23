/**
 * Opt-in, payload-free lifecycle diagnostics for shared MCP processes.
 *
 * The trace is intentionally limited to process/session identity, counters,
 * and state transitions. It never records JSON-RPC messages, prompts, source
 * content, credentials, paths, or provider configuration.
 */

const TRACE_ENV = 'AFYX_GRAPH_LIFECYCLE_TRACE';

export type LifecycleTraceValue = string | number | boolean | null;

export function lifecycleTrace(
  event: string,
  details: Readonly<Record<string, LifecycleTraceValue>> = {},
): void {
  if (process.env[TRACE_ENV] !== '1') return;
  const record = {
    event,
    monotonicMs: Math.round(process.uptime() * 1000),
    pid: process.pid,
    ppid: process.ppid,
    ...details,
  };
  try {
    process.stderr.write(`[afyx-graph-lifecycle] ${JSON.stringify(record)}\n`);
  } catch {
    // Diagnostics must never alter lifecycle behavior.
  }
}
