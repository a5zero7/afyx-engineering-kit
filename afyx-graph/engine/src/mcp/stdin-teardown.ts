/**
 * Readable-stream termination watcher for stdio/socket-backed MCP transports.
 * Ensures any stream closure or transport error triggers cleanup once and releases listeners.
 */
import { SettlementGate } from './supervision-policy';

const TERMINAL_STREAM_EVENTS = ['end', 'close', 'error'] as const;

type DestroyableStream = NodeJS.ReadableStream & { destroy?: () => void };

function closeReadableStream(stream: DestroyableStream): void {
  try {
    stream.destroy?.();
  } catch {
    // Ignore streams that are already closed or errored.
  }
}

/**
 * Bind shutdown notification to terminal events on `stream`.
 * Detaches all registered listeners and closes the underlying stream at most once.
 */
export function treatStdinFailureAsShutdown(
  onTerminal: () => void,
  stream: NodeJS.ReadableStream = process.stdin,
): void {
  const gate = new SettlementGate();

  const handleStreamTermination = (): void => {
    if (!gate.claim()) return;
    for (const eventName of TERMINAL_STREAM_EVENTS) {
      stream.removeListener(eventName, handleStreamTermination);
    }
    closeReadableStream(stream as DestroyableStream);
    onTerminal();
  };

  for (const eventName of TERMINAL_STREAM_EVENTS) {
    stream.on(eventName, handleStreamTermination);
  }
}
