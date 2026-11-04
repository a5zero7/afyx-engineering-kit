import { createHash } from 'crypto';
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { groupDefinitions } from '../src/graph/symbol-lookup';
import { executeRelationshipTool } from '../src/mcp/relationship-tool';
import { ToolHandler } from '../src/mcp/tools';
import type { Edge, Node } from '../src/types';

type Direction = 'callers' | 'callees';
type Relation = { node: Node; edge: Edge };

const node = (
  id: string,
  name = id,
  filePath = `src/${id}.ts`,
  qualifiedName = name,
  startLine: number | undefined = 1,
): Node => ({
  id,
  name,
  qualifiedName,
  kind: 'function',
  filePath,
  language: 'typescript',
  startLine,
} as Node);

const edge = (id: string, kind = 'calls', metadata?: Record<string, unknown>): Edge => ({
  id,
  source: `source-${id}`,
  target: `target-${id}`,
  kind,
  metadata,
} as Edge);

interface Scenario {
  nodes?: Node[];
  note?: string;
  callers?: Record<string, Relation[]>;
  callees?: Record<string, Relation[]>;
}

interface RecordEntry {
  scenario_id: string;
  direction: Direction;
  request: Record<string, unknown>;
  domain_calls: string[];
  result: unknown;
  serialized_bytes: number;
  sha256: string;
}

const records: RecordEntry[] = [];

async function capture(
  scenarioId: string,
  direction: Direction,
  request: Record<string, unknown>,
  scenario: Scenario = {},
): Promise<RecordEntry> {
  const definitions = scenario.nodes ?? [node('focus', String(request.symbol ?? 'focus'))];
  const calls: string[] = [];
  const source = {
    resolveSymbols: () => ({ nodes: definitions, note: scenario.note ?? '' }),
    groupDefinitions,
    getCallers(id: string): Relation[] {
      calls.push(`callers:${id}`);
      return scenario.callers?.[id] ?? [];
    },
    getCallees(id: string): Relation[] {
      calls.push(`callees:${id}`);
      return scenario.callees?.[id] ?? [];
    },
  };
  let result: unknown;
  if (typeof request.symbol === 'string' && request.symbol.length > 0) {
    result = executeRelationshipTool(source, {
      symbol: request.symbol,
      file: request.file,
      limit: request.limit,
    }, direction);
  } else {
    const handler = new ToolHandler(source as never) as unknown as Record<string, unknown>;
    const method = direction === 'callers' ? 'handleCallers' : 'handleCallees';
    result = await (handler[method] as (args: Record<string, unknown>) => Promise<unknown>)(request);
  }
  const serialized = JSON.stringify(result);
  const entry: RecordEntry = {
    scenario_id: scenarioId,
    direction,
    request,
    domain_calls: calls,
    result,
    serialized_bytes: Buffer.byteLength(serialized),
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
  records.push(entry);
  return entry;
}

const related = Array.from({ length: 105 }, (_, index) => node(`related-${index}`, `related${index}`));
const relations = related.map((item, index) => ({ node: item, edge: edge(`edge-${index}`) }));

describe('MCP Relationship adapter', () => {
  for (const direction of ['callers', 'callees'] as const) {
    const relationKey = direction;
    const one = { [relationKey]: { focus: relations.slice(0, 1) } };
    const many = { [relationKey]: { focus: relations } };

    it(`${direction}: captures validation and runtime limit matrix`, async () => {
      const requests: Array<[string, Record<string, unknown>, Scenario]> = [
        ['missing-symbol', {}, one],
        ['empty-symbol', { symbol: '' }, one],
        ['non-string-symbol', { symbol: 7 }, one],
        ['oversize-symbol', { symbol: 'x'.repeat(501) }, one],
        ['limit-omitted', { symbol: 'focus' }, many],
        ['limit-null', { symbol: 'focus', limit: null }, many],
        ['limit-zero', { symbol: 'focus', limit: 0 }, many],
        ['limit-one', { symbol: 'focus', limit: 1 }, many],
        ['limit-normal', { symbol: 'focus', limit: 7 }, many],
        ['limit-twenty', { symbol: 'focus', limit: 20 }, many],
        ['limit-hundred', { symbol: 'focus', limit: 100 }, many],
        ['limit-over-max', { symbol: 'focus', limit: 101 }, many],
        ['limit-negative', { symbol: 'focus', limit: -4 }, many],
        ['limit-numeric-string', { symbol: 'focus', limit: '7' }, many],
        ['limit-bad-string', { symbol: 'focus', limit: 'bad' }, many],
        ['limit-nan', { symbol: 'focus', limit: Number.NaN }, many],
      ];
      for (const [name, request, scenario] of requests) {
        await capture(`${direction}-${name}`, direction, request, scenario);
      }
    });

    it(`${direction}: captures resolution, filtering, collection, and formatting`, async () => {
      const overloadA = node('overload-a', 'focus', 'src/overloads.ts', 'focus', 3);
      const overloadB = node('overload-b', 'focus', 'src/overloads.ts', 'focus', 8);
      const otherDef = node('other-def', 'focus', 'apps/other/focus.ts', 'Other.focus', 12);
      const shared = node('shared', 'shared', 'src/shared.ts', 'shared', 4);
      const first = node('first', 'first', 'src/first.ts', 'first', 0);
      const second = node('second', 'second', 'src/second.ts', 'second', undefined);
      const relationMap: Record<string, Relation[]> = {
        'overload-a': [
          { node: first, edge: edge('calls', 'calls') },
          { node: shared, edge: edge('callback', 'references', { fnRef: true }) },
        ],
        'overload-b': [
          { node: shared, edge: edge('later', 'imports') },
          { node: second, edge: edge('instantiates', 'instantiates') },
        ],
        'other-def': [{ node: node('other'), edge: edge('references', 'references') }],
      };
      const scenario: Scenario = {
        nodes: [overloadA, overloadB, otherDef],
        note: '\n\n> **Note:** Aggregated results across 3 exact symbol matches.',
        [relationKey]: relationMap,
      };
      const variants: Array<[string, Record<string, unknown>, Scenario]> = [
        ['multiple-definitions', { symbol: 'focus' }, scenario],
        ['file-exact', { symbol: 'focus', file: 'src/overloads.ts' }, scenario],
        ['file-suffix', { symbol: 'focus', file: 'overloads.ts' }, scenario],
        ['file-narrow-other', { symbol: 'focus', file: 'apps/other/focus.ts' }, scenario],
        ['file-miss', { symbol: 'focus', file: 'missing.ts' }, scenario],
        ['per-group-limit', { symbol: 'focus', limit: 1 }, scenario],
        ['high-limit', { symbol: 'focus', limit: 100 }, scenario],
        ['exact-single', { symbol: 'focus' }, { nodes: [overloadA], [relationKey]: relationMap }],
        ['same-file-overloads', { symbol: 'focus' }, { nodes: [overloadA, overloadB], [relationKey]: relationMap }],
        ['fuzzy-only-missing', { symbol: 'focuz' }, { nodes: [], note: '\n\nDid you mean: focus?' }],
        ['case-differing-exact', { symbol: 'Focus' }, { nodes: [node('case', 'Focus')], [relationKey]: { case: [] } }],
        ['qualified-symbol', { symbol: 'Other.focus' }, { nodes: [otherDef], [relationKey]: relationMap }],
      ];
      for (const [name, request, item] of variants) {
        await capture(`${direction}-${name}`, direction, request, item);
      }
    });

    it(`${direction}: captures labels, dedup, zero relations, and output bound`, async () => {
      const focus = node('focus');
      const labelRelations: Relation[] = [
        { node: node('plain'), edge: edge('plain', 'calls') },
        { node: node('callback'), edge: edge('callback', 'calls', { fnRef: true }) },
        { node: node('instance'), edge: edge('instance', 'instantiates') },
        { node: node('imported'), edge: edge('imported', 'imports') },
        { node: node('referenced'), edge: edge('referenced', 'references') },
        { node: node('custom'), edge: edge('custom', 'custom-edge') },
        { node: node('callback'), edge: edge('callback-second', 'imports') },
      ];
      await capture(`${direction}-labels-dedup-first-edge`, direction, { symbol: 'focus' }, {
        nodes: [focus],
        [relationKey]: { focus: labelRelations },
      });
      await capture(`${direction}-zero-relations`, direction, { symbol: 'focus' }, {
        nodes: [focus],
        note: '\n\n> **Note:** resolver note.',
        [relationKey]: { focus: [] },
      });
      await capture(`${direction}-zero-file-miss`, direction, { symbol: 'focus', file: 'missing.ts' }, {
        nodes: [focus],
        [relationKey]: { focus: [] },
      });
      const large = Array.from({ length: 100 }, (_, index) =>
        node(`large-${index}`, `large-${index}-${'x'.repeat(180)}`, `src/${'y'.repeat(180)}/${index}.ts`));
      await capture(`${direction}-shared-output-bound`, direction, { symbol: 'focus', limit: 100 }, {
        nodes: [focus],
        [relationKey]: { focus: large.map((item, index) => ({ node: item, edge: edge(`large-${index}`) })) },
      });
    });
  }

  it('preserves route, formatting, limits, labels, notes, and output bound', () => {
    expect(records).toHaveLength(64);
    const byId = (id: string): RecordEntry => records.find((entry) => entry.scenario_id === id)!;
    expect(byId('callers-exact-single').domain_calls).toEqual(['callers:overload-a']);
    expect(byId('callees-exact-single').domain_calls).toEqual(['callees:overload-a']);
    expect(byId('callers-exact-single').result).toEqual({
      content: [{
        type: 'text',
        text: '**Callers of focus (2 found)**\n\n'
          + '- first (function) - src/first.ts\n'
          + '- shared (function) - src/shared.ts:4 — via callback registration',
      }],
    });
    expect((byId('callees-multiple-definitions').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('**Callees of focus — 2 distinct definitions (narrow with `file`)**');
    expect((byId('callers-file-miss').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('no definition of "focus" matches file "missing.ts" — showing all definitions instead.');
    expect((byId('callers-labels-dedup-first-edge').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('callback (function) - src/callback.ts:1');
    expect((byId('callers-labels-dedup-first-edge').result as { content: Array<{ text: string }> }).content[0]!.text)
      .not.toContain('callback (function) - src/callback.ts:1 — import');
    const labels = (byId('callers-labels-dedup-first-edge').result as { content: Array<{ text: string }> })
      .content[0]!.text;
    expect(labels).toContain('instance (function) - src/instance.ts:1 — via instantiation');
    expect(labels).toContain('imported (function) - src/imported.ts:1 — via import');
    expect(labels).toContain('referenced (function) - src/referenced.ts:1 — via reference');
    expect(labels).toContain('custom (function) - src/custom.ts:1 — via custom-edge');
    expect((byId('callers-limit-one').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('Showing 1 of 105 callers; pass `limit` (up to 100) to widen.');
    expect((byId('callees-per-group-limit').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('… +2 more (pass `limit` to widen)');
    expect((byId('callers-zero-relations').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('No callers found for "focus"');
    expect((byId('callees-zero-relations').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('No callees found for "focus"');
    expect((byId('callers-fuzzy-only-missing').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toBe('Symbol "focuz" not found in the codebase\n\nDid you mean: focus?');
    expect((byId('callers-shared-output-bound').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toMatch(/\.\.\. \(output truncated\)$/);

    const output = process.env.AFYX_REL_ORACLE_OUT;
    if (output) {
      fs.writeFileSync(output, JSON.stringify({ phase: 'NEW', cases: records }, null, 2) + '\n');
    }
    const expectedPath = process.env.AFYX_REL_ORACLE_EXPECT;
    if (expectedPath) {
      const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8')) as { cases: RecordEntry[] };
      expect(JSON.parse(JSON.stringify(records))).toEqual(expected.cases);
    }
  });
});
