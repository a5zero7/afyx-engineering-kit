import { describe, expect, it } from 'vitest';
import { executeSearchTool, type SearchToolSource } from '../src/mcp/search-tool';
import type { SearchResult } from '../src/types';

const result = (name: string, filePath = `src/${name}.ts`, extra: Record<string, unknown> = {}): SearchResult => ({
  node: { id: name, name, kind: 'function', filePath, language: 'typescript', ...extra } as SearchResult['node'],
  score: 1,
});

function fixture(results: SearchResult[]) {
  const calls: Array<{ query: string; options: unknown }> = [];
  const predicateInputs: string[][] = [];
  const source: SearchToolSource = {
    searchNodes(query, options) { calls.push({ query, options }); return results; },
    generatedFilePredicate(paths) {
      predicateInputs.push([...paths]);
      return (path) => path.includes('/generated/');
    },
  };
  return { source, calls, predicateInputs };
}

describe('MCP Search adapter', () => {
  it('maps type to type_alias and invokes the domain exactly once', () => {
    const { source, calls } = fixture([result('hit')]);
    executeSearchTool(source, { query: 'needle', kind: 'type', limit: 5 });
    expect(calls).toEqual([{ query: 'needle', options: { limit: 6, kinds: ['type_alias'] } }]);
  });

  it('omits kinds when no kind is supplied and forwards other runtime kinds', () => {
    const omitted = fixture([result('hit')]);
    executeSearchTool(omitted.source, { query: 'q' });
    expect(omitted.calls[0]).toEqual({ query: 'q', options: { limit: 11, kinds: undefined } });

    const unknown = fixture([result('hit')]);
    executeSearchTool(unknown.source, { query: 'q', kind: 'mystery' });
    expect(unknown.calls[0]).toEqual({ query: 'q', options: { limit: 11, kinds: ['mystery'] } });
  });

  it.each([
    [undefined, 10], [0, 10], [5, 5], [-3, 1], [101, 100], ['7', 7], ['bad', 10],
  ])('normalizes limit %p to %p', (input, expected) => {
    const { source, calls } = fixture([result('hit')]);
    executeSearchTool(source, { query: 'q', limit: input });
    expect((calls[0]!.options as { limit: number }).limit).toBe(expected + 1);
  });

  it('returns exact success-shaped empty result', () => {
    const { source } = fixture([]);
    expect(executeSearchTool(source, { query: 'missing' })).toEqual({
      content: [{ type: 'text', text: 'No results found for "missing"' }],
    });
  });

  it('stably orders handwritten results before generated results', () => {
    const { source, predicateInputs } = fixture([
      result('genA', 'src/generated/a.ts'), result('handA'),
      result('genB', 'src/generated/b.ts'), result('handB'),
    ]);
    const text = executeSearchTool(source, { query: 'q' }).content[0]!.text;
    expect(predicateInputs).toEqual([['src/generated/a.ts', 'src/handA.ts', 'src/generated/b.ts', 'src/handB.ts']]);
    expect([...text.matchAll(/^\*\*(.+?)\*\* \(/gm)].map((match) => match[1])).toEqual(['handA', 'handB', 'genA', 'genB']);
  });

  it('uses the over-fetched boundary row when composing handwritten before generated results', () => {
    const { source, calls } = fixture([
      result('generatedTop', 'src/generated/top.ts'),
      result('handRankedSecond'),
      result('handBoundary'),
    ]);
    const text = executeSearchTool(source, { query: 'q', limit: 2 }).content[0]!.text;
    expect(calls[0]).toEqual({ query: 'q', options: { limit: 3, kinds: undefined } });
    expect([...text.matchAll(/^\*\*(.+?)\*\* \(/gm)].map((match) => match[1]))
      .toEqual(['handRankedSecond', 'handBoundary']);
    expect(text).not.toContain('**generatedTop**');
    expect(text).toContain('Results truncated at 2');
  });

  it('distinguishes an exact full page from a page with one over-fetched result', () => {
    const exact = fixture([result('one'), result('two')]);
    const exactText = executeSearchTool(exact.source, { query: 'q', limit: 2 }).content[0]!.text;
    expect(exactText).not.toContain('Results truncated');

    const over = fixture([result('one'), result('two'), result('three')]);
    const overText = executeSearchTool(over.source, { query: 'q', limit: 2 }).content[0]!.text;
    expect(overText).toContain('Results truncated at 2');
    expect(overText).toContain('not an exhaustive source-declaration inventory');
  });

  it('preserves exact compact formatting, optional signature, and optional line', () => {
    const { source } = fixture([
      result('signed', 'src/signed.ts', { startLine: 17, signature: 'signed(): void' }),
      result('plain', 'src/plain.ts'),
    ]);
    expect(executeSearchTool(source, { query: 'q' }).content[0]!.text).toBe(
      '**Search Results (2 shown)**\n\n' +
      '**signed** (function)\nsrc/signed.ts:17\n`signed(): void`\n\n' +
      '**plain** (function)\nsrc/plain.ts\n'
    );
  });

  it('reports a bounded Odoo-like discovery page without presenting it as a complete inventory', () => {
    const matches = Array.from({ length: 9 }, (_, index) =>
      result(`SaleOrderAddon${index + 1}`, `addon_${index + 1}/models/sale_order.py`),
    );
    const { source, calls } = fixture(matches);
    const text = executeSearchTool(source, { query: 'sale.order', limit: 4 }).content[0]!.text;
    expect(calls[0]).toEqual({ query: 'sale.order', options: { limit: 5, kinds: undefined } });
    expect(text).toContain('**Search Results (4 shown)**');
    expect(text).not.toContain('**SaleOrderAddon5**');
    expect(text).toContain('Results truncated at 4; pass `limit` (up to 100) to widen.');
    expect(text).toContain('not an exhaustive source-declaration inventory');
  });

  it('consumes the frozen shared output bound', () => {
    const results = Array.from({ length: 180 }, (_, index) =>
      result(`item${index}`, `src/${'x'.repeat(80)}/${index}.ts`, { signature: `${'arg: string, '.repeat(12)}` }),
    );
    const { source } = fixture(results);
    const text = executeSearchTool(source, { query: 'q', limit: 100 }).content[0]!.text;
    expect(text.endsWith('\n\n... (output truncated)')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(15_024);
    expect(text).toContain('Results truncated at 100');
    expect(text).toContain('not an exhaustive source-declaration inventory');
  });
});
