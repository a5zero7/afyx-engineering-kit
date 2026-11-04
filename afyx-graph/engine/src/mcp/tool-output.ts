const MAX_OUTPUT_LENGTH = 15_000;
const TRUNCATION_MARKER = '\n\n... (output truncated)';

/** Bound MCP tool text without changing the established character-based contract. */
export function boundToolOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_LENGTH) return text;

  const boundedSource = text.slice(0, MAX_OUTPUT_LENGTH);
  const lastNewline = boundedSource.lastIndexOf('\n');
  const cutPoint = lastNewline > MAX_OUTPUT_LENGTH * 0.8
    ? lastNewline
    : MAX_OUTPUT_LENGTH;

  return boundedSource.slice(0, cutPoint) + TRUNCATION_MARKER;
}
