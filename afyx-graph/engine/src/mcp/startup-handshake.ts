/**
 * Abandoned-launch deadline monitor for MCP stdio servers.
 * Reclaims server processes whose launcher terminated before sending any payload.
 */
import { parseDisableableDeadline, SettlementGate } from './supervision-policy';

export const DEFAULT_STARTUP_HANDSHAKE_TIMEOUT_MS = 900_000;
export const STARTUP_HANDSHAKE_TIMEOUT_ENV = 'AFYX_GRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS';

/** Parse startup timeout in milliseconds (`<= 0` disables the deadline). */
export function parseStartupHandshakeTimeoutMs(raw: string | undefined): number {
  return parseDisableableDeadline(raw, DEFAULT_STARTUP_HANDSHAKE_TIMEOUT_MS);
}

/**
 * Monitor `stream` for the first incoming chunk of protocol data.
 * Invokes `onAbandoned` once if no traffic arrives within `timeoutMs`.
 * Returns an idempotent cancellation callback.
 */
export function armStartupHandshakeTimeout(
  onAbandoned: () => void,
  stream: NodeJS.ReadableStream = process.stdin,
  timeoutMs: number = parseStartupHandshakeTimeoutMs(process.env[STARTUP_HANDSHAKE_TIMEOUT_ENV]),
): () => void {
  if (timeoutMs <= 0) {
    return () => {};
  }

  const lifecycleGate = new SettlementGate();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const disarm = (): boolean => {
    if (!lifecycleGate.claim()) return false;
    stream.removeListener('data', handleInitialTraffic);
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }
    return true;
  };

  const handleInitialTraffic = (): void => {
    disarm();
  };

  deadlineTimer = setTimeout(() => {
    if (disarm()) {
      onAbandoned();
    }
  }, timeoutMs);
  deadlineTimer.unref?.();

  stream.once('data', handleInitialTraffic);
  return () => {
    disarm();
  };
}
