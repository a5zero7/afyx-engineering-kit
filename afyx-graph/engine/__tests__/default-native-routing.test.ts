import { afterEach, describe, expect, it } from 'vitest';
import { extractFromSource } from '../src/extraction/extract';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { guardsInSource } from '../src/graph/branch-guards';

const originalGate = process.env.AFYX_GRAPH_NATIVE_PARSER;

afterEach(() => {
  if (originalGate === undefined) delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  else process.env.AFYX_GRAPH_NATIVE_PARSER = originalGate;
});

function withGate(value: string | undefined): void {
  if (value === undefined) delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  else process.env.AFYX_GRAPH_NATIVE_PARSER = value;
}

describe('unconditional Afyx-native production routing', () => {
  it('ignores the retired parser-selection environment switch for extraction', () => {
    const source = 'export function run(value: string) { return helper(value); }';
    const snapshots = [undefined, '0', '1'].map((gate) => {
      withGate(gate);
      const result = extractFromSource('sample.ts', source, 'typescript');
      return {
        nodes: result.nodes.map(({ updatedAt: _updatedAt, ...node }) => node),
        edges: result.edges,
        unresolvedReferences: result.unresolvedReferences,
        errors: result.errors,
      };
    });
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
    expect(snapshots[0].nodes.some((node) => node.name === 'run')).toBe(true);
  });

  it('ignores the retired switch for syntax and guard production paths', async () => {
    const source = 'function run(ready: boolean) { if (ready) helper(); }';
    const syntax = [];
    const guards = [];
    for (const gate of [undefined, '0', '1']) {
      withGate(gate);
      syntax.push(await tokenizeSource(source, 'typescript'));
      guards.push(await guardsInSource(source, 'typescript', 1, source.indexOf('helper')));
    }
    expect(syntax[1]).toEqual(syntax[0]);
    expect(syntax[2]).toEqual(syntax[0]);
    expect(guards[1]).toEqual(guards[0]);
    expect(guards[2]).toEqual(guards[0]);
    expect(guards[0]).toEqual([expect.objectContaining({ text: 'ready', form: 'if' })]);
  });

  it('keeps incomplete embedded scripts on the native special-format route', () => {
    withGate('0');
    const result = extractFromSource(
      'Panel.vue',
      '<script setup lang="ts">\nexport function load() { return fetchData(); }',
      'vue'
    );
    expect(result.nodes.some((node) => node.name === 'load')).toBe(true);
  });
});
