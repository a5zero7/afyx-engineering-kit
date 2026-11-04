import { describe, expect, it } from 'vitest';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import type { Language } from '../src/types';

async function semanticTokens(source: string, language: Language) {
  const result = await tokenizeSource(source, language);
  return result?.spans
    .filter((span) => span.cls !== 'other')
    .map((span) => [span.cls, source.slice(span.start, span.end)] as const);
}

describe('Afyx-native syntax tokens', () => {
  it.each([
    ['typescript', 'export class Store { read(value: string) { return api.load(value); } } // note', 'Store', 'load'],
    ['javascript', 'export function run() { return api.load("function fake() {}"); }', 'run', 'load'],
    ['python', 'def run(value: str):\n    # fake def hidden():\n    return api.load(value)', 'run', 'load'],
    ['go', 'func Run(value string) string { return api.Load(value) } // note', 'Run', 'Load'],
    ['java', 'public class Sample { public String run() { return Api.load(); } }', 'Sample', 'load'],
    ['tsx', 'export function View(): string { return render(); }', 'View', 'render'],
    ['jsx', 'export function View() { return render(); }', 'View', 'render'],
  ] as const)('classifies definitions and identifiers for %s', async (language, source, definition, identifier) => {
    const tokens = await semanticTokens(source, language);
    expect(tokens).toContainEqual(['def', definition]);
    expect(tokens).toContainEqual(['ident', identifier]);
  });

  it('keeps interpolation code claimable while strings and comments stay opaque', async () => {
    const source = 'const text = `fake() ${store.size()} // text`; // real';
    const tokens = await semanticTokens(source, 'typescript');
    expect(tokens).toContainEqual(['ident', 'size']);
    expect(tokens).toContainEqual(['comment', '// real']);
    expect(tokens).not.toContainEqual(['ident', 'fake']);
  });
});
