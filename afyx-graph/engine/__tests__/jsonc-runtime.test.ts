import { describe, expect, it } from 'vitest';
import { parseJsonc, updateJsoncPath } from '../src/runtime/jsonc';

describe('Afyx JSONC reader/editor', () => {
  it('reads every JSON value kind with comments and trailing commas', () => {
    const value = parseJsonc(`{
      // comment markers inside strings are data
      "url": "https://example.test/a/*b*/",
      "brace": "} // not a comment",
      "array": [1, true, false, null,],
      "nested": { "value": -1.5e2, },
    }`) as Record<string, any>;
    expect(value.url).toBe('https://example.test/a/*b*/');
    expect(value.brace).toBe('} // not a comment');
    expect(value.array).toEqual([1, true, false, null]);
    expect(value.nested.value).toBe(-150);
  });

  it('surgically updates an existing Afyx-owned entry', () => {
    const input = `{
  // user heading
  "servers": {
    "sibling": { "command": "keep" }, // sibling comment
    "afyx-graph": { "command": "old" },
  },
  "unrelated": "literal { // /* text",
}
`;
    const output = updateJsoncPath(input, ['servers', 'afyx-graph'], {
      command: 'afyx-graph',
      args: ['serve', '--mcp'],
    });
    expect(output).toContain('// user heading');
    expect(output).toContain('"sibling": { "command": "keep" }, // sibling comment');
    expect(output).toContain('"unrelated": "literal { // /* text"');
    expect((parseJsonc(output) as any).servers['afyx-graph']).toEqual({
      command: 'afyx-graph',
      args: ['serve', '--mcp'],
    });
  });

  it('creates missing nested objects without reserializing siblings', () => {
    const input = '{\n  "keep": 1, // untouched\n}\n';
    const output = updateJsoncPath(input, ['mcp', 'servers', 'afyx-graph'], { disabled: false });
    expect(output).toContain('"keep": 1, // untouched');
    expect((parseJsonc(output) as any).mcp.servers['afyx-graph']).toEqual({ disabled: false });
  });

  it('removes only the selected property and leaves valid trailing-comma JSONC', () => {
    const input = '{\n  "servers": {\n    "before": 1,\n    "afyx-graph": 2,\n    "after": 3,\n  },\n}\n';
    const output = updateJsoncPath(input, ['servers', 'afyx-graph'], undefined);
    expect(output).toContain('"before": 1');
    expect(output).toContain('"after": 3');
    expect(output).not.toContain('"afyx-graph"');
    expect((parseJsonc(output) as any).servers).toEqual({ before: 1, after: 3 });
  });

  it('preserves CRLF and trailing newline', () => {
    const input = '{\r\n  // keep\r\n  "servers": {},\r\n}\r\n';
    const output = updateJsoncPath(input, ['servers', 'afyx-graph'], { command: 'afyx-graph' });
    expect(output.replace(/\r\n/g, '')).not.toContain('\n');
    expect(output.endsWith('\r\n')).toBe(true);
    expect(output).toContain('// keep');
  });

  it('refuses malformed input without returning destructive output', () => {
    const malformed = '{\n  "servers": { broken },\n  "keep": true\n}\n';
    expect(parseJsonc(malformed)).toBeUndefined();
    expect(() => updateJsoncPath(malformed, ['servers', 'afyx-graph'], {})).toThrow(
      /Refusing to modify malformed JSONC/,
    );
  });

  it('does not treat duplicate-looking text inside strings as structure', () => {
    const input = '{\n  "note": "\\\"afyx-graph\\\": { fake }",\n  "servers": {}\n}\n';
    const output = updateJsoncPath(input, ['servers', 'afyx-graph'], { command: 'real' });
    expect(output).toContain('"note": "\\\"afyx-graph\\\": { fake }"');
    expect((parseJsonc(output) as any).servers['afyx-graph'].command).toBe('real');
  });
});
