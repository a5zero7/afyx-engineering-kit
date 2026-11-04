import { describe, expect, it } from 'vitest';
import { boundToolOutput } from '../src/mcp/tool-output';

const LIMIT = 15_000;
const MARKER = '\n\n... (output truncated)';

describe('MCP bounded tool output', () => {
  it('returns short and exactly-at-limit text unchanged', () => {
    expect(boundToolOutput('')).toBe('');
    expect(boundToolOutput('short')).toBe('short');
    const atLimit = 'a'.repeat(LIMIT);
    expect(boundToolOutput(atLimit)).toBe(atLimit);
  });

  it('uses the raw character cap when no eligible newline exists', () => {
    const input = 'a'.repeat(LIMIT + 1);
    expect(boundToolOutput(input)).toBe('a'.repeat(LIMIT) + MARKER);
  });

  it('ignores newlines at or below the strict 80 percent threshold', () => {
    for (const newlineAt of [11_000, 12_000]) {
      const input = `${'a'.repeat(newlineAt)}\n${'b'.repeat(LIMIT)}`;
      expect(boundToolOutput(input)).toBe(input.slice(0, LIMIT) + MARKER);
    }
  });

  it('uses the last newline above the threshold', () => {
    const input = `${'a'.repeat(12_001)}\n${'b'.repeat(1_500)}\n${'c'.repeat(2_000)}`;
    expect(boundToolOutput(input)).toBe(input.slice(0, 13_502) + MARKER);
  });

  it('preserves the complete-line behavior established by C07.3', () => {
    const input = Array.from(
      { length: 500 },
      (_, index) => `Line ${index}: ${'a'.repeat(50)}`,
    ).join('\n');
    const output = boundToolOutput(input);
    const beforeMarker = output.slice(0, -MARKER.length);

    expect(output.endsWith(MARKER)).toBe(true);
    expect(beforeMarker.split('\n').at(-1)).toMatch(/^Line \d+: a{50}$/);
  });

  it('is deterministic and treats an existing marker as ordinary text', () => {
    const input = `prefix${MARKER}suffix${'a'.repeat(16_000)}`;
    const first = boundToolOutput(input);
    expect(boundToolOutput(input)).toBe(first);
    expect(first).toBe(input.slice(0, LIMIT) + MARKER);
  });
});
