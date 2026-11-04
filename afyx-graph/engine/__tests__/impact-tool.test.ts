import { createHash } from 'crypto';
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { groupDefinitions } from '../src/graph/symbol-lookup';
import { executeImpactTool, type ImpactToolSource } from '../src/mcp/impact-tool';
import { ToolHandler } from '../src/mcp/tools';
import type { Edge, Node, Subgraph } from '../src/types';

type ImpactScenario = {
  nodes: Node[];
  note?: string;
  impacts?: Record<string, Subgraph>;
};

type OracleEntry = {
  scenario_id: string;
  request: Record<string, unknown>;
  domain_calls: string[];
  result: unknown;
  serialized_bytes: number;
  sha256: string;
};

const node = (
  id: string,
  name = id,
  filePath = `src/${id}.ts`,
  qualifiedName = name,
  startLine = 1,
): Node => ({
  id,
  kind: 'function',
  name,
  qualifiedName,
  filePath,
  language: 'typescript',
  startLine,
  endLine: startLine,
  startColumn: 0,
  endColumn: 1,
});

const edge = (id: string): Edge => ({
  id,
  source: 'source',
  target: 'target',
  kind: 'calls',
});

const subgraph = (nodes: Node[], edges: Edge[] = []): Subgraph => ({
  nodes: new Map(nodes.map((item) => [item.id, item])),
  edges,
  roots: [],
});

const records: OracleEntry[] = [];

async function capture(
  scenarioId: string,
  request: Record<string, unknown>,
  scenario: ImpactScenario,
): Promise<OracleEntry> {
  const domainCalls: string[] = [];
  const source: ImpactToolSource = {
    resolveSymbols: () => ({
      nodes: scenario.nodes,
      note: scenario.note ?? '',
    }),
    groupDefinitions,
    getImpactRadius(nodeId: string, depth: number): Subgraph {
      domainCalls.push(`${nodeId}:${String(depth)}`);
      return scenario.impacts?.[nodeId] ?? subgraph([]);
    },
  };
  const result = executeImpactTool(source, request as { symbol: string });
  const serialized = JSON.stringify(result);
  const entry: OracleEntry = {
    scenario_id: scenarioId,
    request,
    domain_calls: domainCalls,
    result,
    serialized_bytes: Buffer.byteLength(serialized),
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
  records.push(entry);
  return entry;
}

describe('MCP Impact adapter', () => {
  const focus = node('focus', 'focus', 'src/focus.ts', 'focus', 4);
  const affectedA = node('affected-a', 'alpha', 'src/a.ts', 'alpha', 8);
  const affectedB = node('affected-b', 'beta', 'src/a.ts', 'beta', 13);
  const affectedC = node('affected-c', 'gamma', 'src/c.ts', 'gamma', 21);
  const ordinary: ImpactScenario = {
    nodes: [focus],
    impacts: { focus: subgraph([affectedA, affectedB, affectedC], [edge('one')]) },
  };

  it('captures the raw depth coercion and clamp matrix', async () => {
    const cases: Array<[string, unknown]> = [
      ['omitted', undefined],
      ['null', null],
      ['zero', 0],
      ['one', 1],
      ['two', 2],
      ['three', 3],
      ['ten', 10],
      ['eleven', 11],
      ['five-hundred', 500],
      ['negative', -7],
      ['numeric-string', '3'],
      ['invalid-string', 'bad'],
      ['nan', Number.NaN],
    ];
    for (const [name, depth] of cases) {
      const request: Record<string, unknown> = { symbol: 'focus' };
      if (name !== 'omitted') request.depth = depth;
      await capture(`depth-${name}`, request, ordinary);
    }
  });

  it('captures resolution, filtering, grouping, formatting, and bounding', async () => {
    const overload = node('overload', 'focus', 'src/focus.ts', 'focus', 17);
    const other = node('other', 'focus', 'apps/other/focus.ts', 'Other.focus', 9);
    const grouped: ImpactScenario = {
      nodes: [focus, overload, other],
      note: '\n\n> **Note:** Aggregated results across 3 exact symbol matches.',
      impacts: {
        focus: subgraph([affectedA]),
        overload: subgraph([affectedB]),
        other: subgraph([affectedC]),
      },
    };

    await capture('not-found', { symbol: 'missing' }, {
      nodes: [],
      note: '\n\nDid you mean: focus?',
    });
    await capture('single-with-note', { symbol: 'focus' }, {
      ...ordinary,
      note: '\n\n> **Note:** resolver note.',
    });
    await capture('file-exact', { symbol: 'focus', file: 'src/focus.ts' }, grouped);
    await capture('file-suffix', { symbol: 'focus', file: 'focus.ts' }, grouped);
    await capture('file-miss', { symbol: 'focus', file: 'missing.ts' }, grouped);
    await capture('file-non-string', { symbol: 'focus', file: 42 }, grouped);
    await capture('same-file-overloads', { symbol: 'focus' }, {
      nodes: [focus, overload],
      note: grouped.note,
      impacts: grouped.impacts,
    });
    await capture('multiple-definitions', { symbol: 'focus' }, grouped);
    await capture('zero-impact', { symbol: 'focus' }, {
      nodes: [focus],
      impacts: { focus: subgraph([]) },
    });
    await capture('ordered-files-and-nodes', { symbol: 'focus' }, ordinary);

    const largeNodes = Array.from({ length: 120 }, (_, index) =>
      node(
        `large-${index}`,
        `large-${index}-${'x'.repeat(150)}`,
        `src/${'y'.repeat(120)}/${index}.ts`,
        `large-${index}`,
        index + 1,
      ));
    await capture('shared-output-bound', { symbol: 'focus' }, {
      nodes: [focus],
      impacts: { focus: subgraph(largeNodes) },
    });
  });

  it('freezes exact OLD observable behavior', () => {
    expect(records).toHaveLength(24);
    const byId = (id: string): OracleEntry => records.find((entry) => entry.scenario_id === id)!;

    const outputPath = process.env.AFYX_IMPACT_ORACLE_OUT;
    if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify({ phase: 'NEW', cases: records }, null, 2));
    }

    expect(byId('depth-omitted').domain_calls).toEqual(['focus:2']);
    expect(byId('depth-null').domain_calls).toEqual(['focus:2']);
    expect(byId('depth-zero').domain_calls).toEqual(['focus:2']);
    expect(byId('depth-negative').domain_calls).toEqual(['focus:1']);
    expect(byId('depth-eleven').domain_calls).toEqual(['focus:10']);
    expect(byId('depth-five-hundred').domain_calls).toEqual(['focus:10']);
    expect(byId('depth-numeric-string').domain_calls).toEqual(['focus:3']);
    expect(byId('depth-invalid-string').domain_calls).toEqual(['focus:NaN']);
    expect(byId('depth-nan').domain_calls).toEqual(['focus:2']);

    expect(byId('not-found').result).toEqual({
      content: [{ type: 'text', text: 'Symbol "missing" not found in the codebase\n\nDid you mean: focus?' }],
    });
    expect(byId('single-with-note').result).toEqual({
      content: [{
        type: 'text',
        text: '**Impact: "focus" affects 3 symbols**\n\n' +
          '**src/a.ts:**\nalpha:8, beta:13\n\n' +
          '**src/c.ts:**\ngamma:21\n\n\n' +
          '> **Note:** resolver note.',
      }],
    });
    expect(byId('file-exact').domain_calls).toEqual(['focus:2', 'overload:2']);
    expect((byId('file-exact').result as { content: Array<{ text: string }> }).content[0]!.text)
      .not.toContain('Aggregated results');
    expect((byId('file-miss').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('no definition of "focus" matches file "missing.ts" — showing all definitions instead.');
    expect(byId('same-file-overloads').domain_calls).toEqual(['focus:2', 'overload:2']);
    expect(byId('multiple-definitions').domain_calls).toEqual(['focus:2', 'overload:2', 'other:2']);
    expect((byId('multiple-definitions').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toContain('**Impact of focus — 2 distinct definitions (each with its own blast radius; narrow with `file`)**');
    expect((byId('zero-impact').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toBe('**Impact: "focus" affects 0 symbols**\n');
    expect((byId('ordered-files-and-nodes').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toBe('**Impact: "focus" affects 3 symbols**\n\n**src/a.ts:**\nalpha:8, beta:13\n\n**src/c.ts:**\ngamma:21\n');
    expect((byId('shared-output-bound').result as { content: Array<{ text: string }> }).content[0]!.text)
      .toMatch(/\.\.\. \(output truncated\)$/);

  });

  it('keeps ToolHandler as a validation and project-wiring facade', async () => {
    const graph = {
      getImpactRadius: () => subgraph([affectedA]),
    };
    const handler = new ToolHandler(graph as never) as unknown as Record<string, unknown>;
    handler.findAllSymbols = (() => ({ nodes: [focus], note: '' })) as unknown;
    handler.groupDefinitions = groupDefinitions as unknown;

    const valid = await (handler.handleImpact as (
      args: Record<string, unknown>,
    ) => Promise<unknown>)({ symbol: 'focus' });
    const invalid = await (handler.handleImpact as (
      args: Record<string, unknown>,
    ) => Promise<unknown>)({ symbol: [] });

    expect(valid).toEqual(executeImpactTool({
      resolveSymbols: () => ({ nodes: [focus], note: '' }),
      groupDefinitions,
      getImpactRadius: () => subgraph([affectedA]),
    }, { symbol: 'focus' }));
    expect(invalid).toEqual({
      content: [{ type: 'text', text: 'Error: symbol must be a non-empty string' }],
      isError: true,
    });
  });
});
