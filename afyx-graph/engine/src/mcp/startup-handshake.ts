/** Startup-abandonment facade for an MCP process that has received no bytes. */
import { parseDisableableDeadline, SettlementGate } from './supervision-policy';

export const DEFAULT_STARTUP_HANDSHAKE_TIMEOUT_MS = 900_000;
export const STARTUP_HANDSHAKE_TIMEOUT_ENV = 'AFYX_GRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS';

export function parseStartupHandshakeTimeoutMs(raw: string | undefined): number {
  return parseDisableableDeadline(raw, DEFAULT_STARTUP_HANDSHAKE_TIMEOUT_MS);
}

/**
 * Arm only after the real stdin consumer is attached. Traffic, expiry, and
 * explicit disarm all settle one shared gate and release the observer.
 */
export function armStartupHandshakeTimeout(
  onAbandoned: () => void,
  stream: NodeJS.ReadableStream = process.stdin,
  timeoutMs: number = parseStartupHandshakeTimeoutMs(process.env[STARTUP_HANDSHAKE_TIMEOUT_ENV]),
): () => void {
  if (timeoutMs <= 0) return () => { /* disabled */ };

  const gate = new SettlementGate();
  let timer: ReturnType<typeof setTimeout>;
  const release = (): boolean => {
    if (!gate.claim()) return false;
    stream.removeListener('data', onFirstData);
    clearTimeout(timer);
    return true;
  };
  const onFirstData = (): void => { release(); };

  timer = setTimeout(() => {
    if (release()) onAbandoned();
  }, timeoutMs);
  timer.unref?.();
  stream.once('data', onFirstData);
  return () => { release(); };
}
