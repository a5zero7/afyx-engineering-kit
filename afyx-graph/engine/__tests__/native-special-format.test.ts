import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { syntaxRegionsFor, tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

const SOURCES = {
  svelte: `<script context="module">export function loadModule() { return boot(); }</script>
<script lang="ts">
import { helper } from './helper';
export function run(value: string) { return helper(value); }
</script>
<button>{format(run('x'))}</button>`,
  vue: `<template><Widget /></template>
<script>export function normal() { return first(); }</script>
<script setup lang="ts">
import Widget from './Widget.vue';
export function setupRun(value: string) { return second(value); }
</script>`,
  astro: `---
import Card from './Card.astro';
export function front(value: string) { return prepare(value); }
---
<Card>{front('x')}</Card>
<script>export function client(value: string) { return hydrate(value); }</script>`,
} as const;

function contract(result: ReturnType<typeof extractFromSource>) {
  const owners = new Map(result.nodes.map((node) => [node.id, `${node.kind}:${node.name}`]));
  return {
    nodes: result.nodes.filter((node) => node.kind !== 'file').map((node) => ({
      kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
      startLine: node.startLine,
    })).sort((left, right) => `${left.kind}:${left.name}:${left.startLine}`.localeCompare(`${right.kind}:${right.name}:${right.startLine}`)),
    refs: result.unresolvedReferences.map((reference) => ({
      owner: owners.get(reference.fromNodeId), kind: reference.referenceKind,
      name: reference.referenceName, line: reference.line,
    })).sort((left, right) => `${left.line}:${left.kind}:${left.name}`.localeCompare(`${right.line}:${right.kind}:${right.name}`)),
  };
}

describe('Afyx-native Svelte/Vue/Astro script regions', () => {

  afterEach(() => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  });

  it.each([
    ['Svelte', 'Component.svelte', 'svelte' as const, SOURCES.svelte],
    ['Vue', 'Component.vue', 'vue' as const, SOURCES.vue],
    ['Astro', 'Component.astro', 'astro' as const, SOURCES.astro],
  ])('preserves the parser-backed %s script-region contract', (_label, file, language, source) => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = extractFromSource(file, source, language);
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const nativeResult = extractFromSource(file, source, language);
    expect(contract(nativeResult)).toEqual(contract(oldResult));
  });

  it('maps same-line and multi-region facts to absolute UTF-16 positions without scope leakage', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = `<script>function first(){ return one(); }</script>
<script lang="ts">function second(value: string){ return two(value); }</script>`;
    const result = extractFromSource('Offsets.vue', source, 'vue');
    const first = result.nodes.find((node) => node.kind === 'function' && node.name === 'first');
    const second = result.nodes.find((node) => node.kind === 'function' && node.name === 'second');
    expect(first).toEqual(expect.objectContaining({ startLine: 1, startColumn: source.indexOf('function first') }));
    expect(second).toEqual(expect.objectContaining({ startLine: 2, startColumn: source.indexOf('function second') - source.indexOf('\n') - 1 }));
    const owner = new Map(result.nodes.map((node) => [node.id, node.name]));
    expect(result.unresolvedReferences.filter((reference) => reference.referenceKind === 'calls')
      .map((reference) => [reference.referenceName, owner.get(reference.fromNodeId)]))
      .toEqual(expect.arrayContaining([['one', 'first'], ['two', 'second']]));
  });

  it.each([
    ['Svelte', 'Broken.svelte', 'svelte' as const, `<script lang="ts">function kept(){ return helper(`],
    ['Vue', 'Broken.vue', 'vue' as const, `<template><div /></template>\n<script setup>function kept(){ return helper(`],
    ['Astro script', 'Broken.astro', 'astro' as const, `<div />\n<script>function kept(){ return helper(`],
  ])('keeps bounded prefix facts for incomplete %s input', (_label, file, language, source) => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource(file, source, language);
    expect(result.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'function', name: 'kept' })]));
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native_incomplete_source' })]));
  });

  it('keeps incomplete Astro frontmatter bounded as template input', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource('Broken.astro', `---\nconst hidden = helper();\n<div />`, 'astro');
    expect(result.nodes.find((node) => node.name === 'hidden')).toBeUndefined();
    expect(result.nodes.filter((node) => node.kind === 'component')).toHaveLength(1);
  });

  it('uses JS/TS native semantics and syntax for all three formats without requesting a parser', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    for (const [language, file, source] of [
      ['svelte', 'Component.svelte', SOURCES.svelte],
      ['vue', 'Component.vue', SOURCES.vue],
      ['astro', 'Component.astro', SOURCES.astro],
    ] as const) {
      expect(extractFromSource(file, source, language).nodes.some((node) => node.kind === 'function')).toBe(true);
      expect((await tokenizeSource(source, language))?.spans.length).toBeGreaterThan(0);
    }
  });

  it('selects JavaScript by default and TypeScript for lang=ts while accepting an unclosed native region', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const regions = syntaxRegionsFor(`<script>const js = 1;</script>\n<script setup lang="ts">const ts: string = 'x';`, 'vue');
    expect(regions?.map((region) => region.language)).toEqual(['javascript', 'typescript']);
    expect(regions?.[1]?.end).toBe(`<script>const js = 1;</script>\n<script setup lang="ts">const ts: string = 'x';`.length);
  });
});
