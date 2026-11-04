/** Fan terminal stdin events into one best-effort stream teardown and callback. */
import { SettlementGate } from './supervision-policy';

export function treatStdinFailureAsShutdown(
  onTerminal: () => void,
  stream: NodeJS.ReadableStream = process.stdin,
): void {
  const gate = new SettlementGate();
  const terminalEvents = ['end', 'close', 'error'] as const;

  const onTerminalEvent = (): void => {
    if (!gate.claim()) return;
    for (const event of terminalEvents) stream.removeListener(event, onTerminalEvent);
    try {
      (stream as Partial<{ destroy(): void }>).destroy?.();
    } catch { /* stream is already unusable */ }
    onTerminal();
  };

  for (const event of terminalEvents) stream.on(event, onTerminalEvent);
}
