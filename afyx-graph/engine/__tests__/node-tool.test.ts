import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolHandler } from '../src/mcp/tools';
import type { Edge, Node, Subgraph } from '../src/types';

type Relation = { node: Node; edge: Edge };
type Scenario = {
  exact?: Record<string, Node[]>;
  search?: Record<string, Node[]>;
  files?: Array<{ path: string; language: string; nodeCount: number }>;
  fileNodes?: Record<string, Node[]>;
  dependents?: Record<string, string[]>;
  code?: Record<string, string | null>;
  children?: Record<string, Node[]>;
  callers?: Record<string, Relation[]>;
  callees?: Record<string, Relation[]>;
  generated?: string[];
  stale?: boolean;
};

type OracleEntry = {
  scenario_id: string;
  request: Record<string, unknown>;
  calls: string[];
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
  endLine = startLine,
  kind: Node['kind'] = 'function',
): Node => ({
  id,
  name,
  qualifiedName,
  filePath,
  kind,
  language: filePath.endsWith('.py') ? 'python' : 'typescript',
  startLine,
  endLine,
  startColumn: 0,
  endColumn: 1,
});

const edge = (id: string, metadata?: Record<string, unknown>): Edge => ({
  id,
  source: 'source',
  target: 'target',
  kind: 'calls',
  provenance: metadata ? 'heuristic' : 'tree-sitter',
  metadata,
});

const records: OracleEntry[] = [];
let projectRoot = '';

function write(relative: string, content: string): void {
  const absolute = path.join(projectRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function makeHandler(scenario: Scenario, calls: string[]): ToolHandler {
  const graph = {
    getProjectRoot: () => projectRoot,
    getNodesByName(name: string): Node[] {
      calls.push(`exact:${name}`);
      return scenario.exact?.[name] ?? [];
    },
    searchNodes(query: string, options: number | { limit?: number }) {
      const limit = typeof options === 'number' ? options : options?.limit;
      calls.push(`search:${query}:${String(limit)}`);
      return (scenario.search?.[query] ?? []).map((item) => ({
        node: item,
        score: 1,
        matchedFields: ['name'],
      }));
    },
    generatedFilePredicate: () => (filePath: string) =>
      (scenario.generated ?? []).includes(filePath),
    getFiles: () => scenario.files ?? [],
    getNodesInFile(filePath: string): Node[] {
      calls.push(`file-nodes:${filePath}`);
      return scenario.fileNodes?.[filePath] ?? [];
    },
    getFileDependents(filePath: string): string[] {
      calls.push(`dependents:${filePath}`);
      return scenario.dependents?.[filePath] ?? [];
    },
    getChildren(nodeId: string): Node[] {
      calls.push(`children:${nodeId}`);
      return scenario.children?.[nodeId] ?? [];
    },
    async getCode(nodeId: string): Promise<string | null> {
      calls.push(`code:${nodeId}`);
      return scenario.code?.[nodeId] ?? null;
    },
    getCallers(nodeId: string): Relation[] {
      calls.push(`callers:${nodeId}`);
      return scenario.callers?.[nodeId] ?? [];
    },
    getCallees(nodeId: string): Relation[] {
      calls.push(`callees:${nodeId}`);
      return scenario.callees?.[nodeId] ?? [];
    },
  };
  const handler = new ToolHandler(graph as never) as unknown as Record<string, unknown>;
  handler.isFileStaleOnDisk = (() => scenario.stale ?? false) as unknown;
  return handler as unknown as ToolHandler;
}

async function capture(
  scenarioId: string,
  request: Record<string, unknown>,
  scenario: Scenario,
): Promise<OracleEntry> {
  const calls: string[] = [];
  const result = await makeHandler(scenario, calls).executeReadTool('afyx_graph_node', request);
  const serialized = JSON.stringify(result);
  const entry: OracleEntry = {
    scenario_id: scenarioId,
    request,
    calls,
    result,
    serialized_bytes: Buffer.byteLength(serialized),
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
  records.push(entry);
  return entry;
}

function text(entry: OracleEntry): string {
  return (entry.result as { content: Array<{ text: string }> }).content[0]!.text;
}

describe('MCP Node adapter contract oracle', () => {
  const focus = node('focus', 'focus', 'src/focus.ts', 'focus', 3, 6);
  const generated = node('generated', 'focus', 'src/focus.pb.ts', 'focus', 2, 4);
  const other = node('other', 'focus', 'apps/other/focus.ts', 'Other.focus', 20, 30);
  const basic: Scenario = {
    exact: { focus: [focus] },
    code: { focus: 'function focus() {\n  return 1;\n}' },
  };

  beforeAll(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-node-oracle-'));
    write('src/focus.ts', 'function focus() {\n  return 1;\n}\n');
    write('src/read.ts', 'alpha\nbeta\ngamma\n');
    write('src/large.ts', `${Array.from({ length: 2_100 }, (_, index) => `line-${index + 1}`).join('\n')}\n`);
    write('config/app.properties', 'api_key=SUPER_SECRET_NODE_VALUE\nmode=prod\n');
    write('src/stale-small.ts', 'export const current = 2;\n');
    write('src/stale-large.ts', `${'x'.repeat(13_000)}\n`);
  });

  afterAll(() => {
    const output = process.env.AFYX_NODE_ORACLE_OUT;
    if (output) {
      const phase = process.env.AFYX_NODE_ORACLE_PHASE ?? 'CURRENT';
      fs.writeFileSync(output, JSON.stringify({ phase, cases: records }, null, 2));
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('captures mode selection and literal option normalization', async () => {
    const files: Scenario = {
      files: [{ path: 'src/read.ts', language: 'typescript', nodeCount: 1 }],
      fileNodes: { 'src/read.ts': [focus] },
    };
    const cases: Array<[string, Record<string, unknown>, Scenario]> = [
      ['file-only', { file: 'src/read.ts' }, files],
      ['file-missing-symbol', { file: 'src/read.ts' }, files],
      ['file-empty-symbol', { file: 'src/read.ts', symbol: '' }, files],
      ['file-whitespace-symbol', { file: 'src/read.ts', symbol: '   ' }, files],
      ['symbol-only', { symbol: 'focus' }, basic],
      ['symbol-file', { symbol: 'focus', file: 'focus.ts' }, basic],
      ['symbol-line', { symbol: 'focus', line: 4 }, basic],
      ['neither', {}, basic],
      ['non-string-symbol', { symbol: 42 }, basic],
      ['non-string-file', { symbol: 'focus', file: 42 }, basic],
      ['include-code-omitted', { symbol: 'focus' }, basic],
      ['include-code-string', { symbol: 'focus', includeCode: 'true' }, basic],
      ['include-code-true', { symbol: 'focus', includeCode: true }, basic],
      ['symbols-only-string', { file: 'src/read.ts', symbolsOnly: 'true' }, files],
      ['symbols-only-true', { file: 'src/read.ts', symbolsOnly: true }, files],
      ['offset-limit-floor', { file: 'src/read.ts', offset: 2.9, limit: 1.9 }, files],
      ['offset-limit-invalid', { file: 'src/read.ts', offset: '2', limit: 0 }, files],
    ];
    for (const [id, request, scenario] of cases) await capture(id, request, scenario);
  });

  it('captures bare, qualified, generated, and fuzzy lookup policy', async () => {
    const qualified = node('qualified', 'request', 'src/session.ts', 'Session.request', 11, 14);
    const scenarios: Array<[string, string, Scenario]> = [
      ['bare-all-exact', 'focus', { exact: { focus: [generated, focus] }, generated: [generated.filePath] }],
      ['bare-fuzzy-top', 'focusFile', { search: { focusFile: [focus, other] } }],
      ['qualified-dot', 'Session.request', { search: { 'Session.request': [qualified] } }],
      ['qualified-colon', 'Session::request', { search: { 'Session::request': [qualified] } }],
      ['qualified-slash', 'Session/request', { search: { 'Session/request': [qualified] } }],
      ['qualified-tail-retry', 'pkg.Session.request', { search: { 'pkg.Session.request': [], request: [qualified] } }],
      ['qualified-no-match', 'Other.request', { search: { 'Other.request': [qualified] } }],
      ['genuine-missing', 'definitelyMissing', {}],
    ];
    for (const [id, symbol, scenario] of scenarios) await capture(id, { symbol }, scenario);
  });

  it('captures file and line disambiguation', async () => {
    const scenario: Scenario = { exact: { focus: [focus, other] } };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['file-exact-hint', { symbol: 'focus', file: 'src/focus.ts' }],
      ['file-suffix-hint', { symbol: 'focus', file: 'focus.ts' }],
      ['file-substring-hint', { symbol: 'focus', file: 'other/foc' }],
      ['file-backslash-hint', { symbol: 'focus', file: 'src\\focus.ts' }],
      ['file-case-hint', { symbol: 'focus', file: 'SRC/FOCUS.TS' }],
      ['file-miss-ignored', { symbol: 'focus', file: 'missing.ts' }],
      ['line-containing', { symbol: 'focus', line: 25 }],
      ['line-nearest', { symbol: 'focus', line: 18 }],
      ['line-tie-first', { symbol: 'focus', line: 13 }],
      ['file-and-line', { symbol: 'focus', file: 'apps/other', line: 25 }],
    ];
    for (const [id, request] of cases) await capture(id, request, scenario);
    await capture(
      'line-containing-over-nearest',
      { symbol: 'focus', line: 90 },
      {
        exact: {
          focus: [
            node('wide', 'focus', 'src/wide.ts', 'Wide.focus', 1, 100),
            node('near', 'focus', 'src/near.ts', 'Near.focus', 89, 89),
          ],
        },
      },
    );
  });

  it('captures details, outlines, bodies, docstrings, and trails', async () => {
    const documented = { ...focus, signature: 'focus(): number', docstring: 'Short useful docs.' };
    const longDocs = { ...focus, docstring: 'd'.repeat(200) };
    const container = node('container', 'Container', 'src/container.ts', 'Container', 1, 20, 'class');
    const childB = { ...node('child-b', 'b', 'src/container.ts', 'Container.b', 8), signature: 'b(): void' };
    const childA = node('child-a', 'a', 'src/container.ts', 'Container.a', 3);
    const caller = node('caller', 'caller', 'src/caller.ts', 'caller', 7);
    const callee = node('callee', 'callee', 'src/callee.ts', 'callee', 9);
    const duplicate = node('duplicate', 'duplicate', 'src/duplicate.ts', 'duplicate', 10);
    const many = Array.from({ length: 14 }, (_, index) => node(`related-${index}`));
    const relations = many.map((item, index) => ({ node: item, edge: edge(`edge-${index}`) }));
    const dynamic: Relation = {
      node: callee,
      edge: edge('dynamic', { synthesizedBy: 'callback', via: 'register' }),
    };
    const cases: Array<[string, Record<string, unknown>, Scenario]> = [
      ['details-metadata', { symbol: 'focus' }, { exact: { focus: [documented] } }],
      ['details-short-doc', { symbol: 'focus' }, { exact: { focus: [documented] } }],
      ['details-long-doc-suppressed', { symbol: 'focus' }, { exact: { focus: [longDocs] } }],
      ['leaf-code-numbered', { symbol: 'focus', includeCode: true }, basic],
      ['container-outline', { symbol: 'Container', includeCode: true }, { exact: { Container: [container] }, children: { container: [childB, childA] } }],
      ['container-empty-fallback', { symbol: 'Container', includeCode: true }, { exact: { Container: [container] }, code: { container: 'class Container {}' } }],
      ['trail-none', { symbol: 'focus' }, basic],
      ['trail-caller', { symbol: 'focus' }, { exact: { focus: [focus] }, callers: { focus: [{ node: caller, edge: edge('caller') }] } }],
      ['trail-callee', { symbol: 'focus' }, { exact: { focus: [focus] }, callees: { focus: [{ node: callee, edge: edge('callee') }] } }],
      ['trail-both-dedup-self', { symbol: 'focus' }, { exact: { focus: [focus] }, callers: { focus: [{ node: duplicate, edge: edge('d1') }, { node: focus, edge: edge('self') }] }, callees: { focus: [{ node: duplicate, edge: edge('d2') }, dynamic] } }],
      ['trail-caller-cap', { symbol: 'focus' }, { exact: { focus: [focus] }, callers: { focus: relations } }],
      ['trail-callee-cap', { symbol: 'focus' }, { exact: { focus: [focus] }, callees: { focus: relations } }],
      ['trail-dynamic-label', { symbol: 'focus' }, { exact: { focus: [focus] }, callees: { focus: [dynamic] } }],
    ];
    for (const [id, request, scenario] of cases) await capture(id, request, scenario);
  });

  it('captures ambiguous result packing budgets and caps', async () => {
    const definitions = Array.from({ length: 45 }, (_, index) =>
      node(`def-${index}`, 'focus', `src/defs/${index}.ts`, `Scope${index}.focus`, index + 1));
    const smallCode = Object.fromEntries(definitions.map((item) => [item.id, `function focus${item.id}() {}`]));
    const largeCode = Object.fromEntries(definitions.map((item) => [item.id, 'x'.repeat(12_100)]));
    const cases: Array<[string, Record<string, unknown>, Scenario]> = [
      ['ambiguous-no-code', { symbol: 'focus' }, { exact: { focus: definitions.slice(0, 3) } }],
      ['ambiguous-small-code', { symbol: 'focus', includeCode: true }, { exact: { focus: definitions.slice(0, 3) }, code: smallCode }],
      ['ambiguous-body-budget', { symbol: 'focus', includeCode: true }, { exact: { focus: definitions.slice(0, 3) }, code: largeCode }],
      ['ambiguous-hard-cap', { symbol: 'focus', includeCode: true }, { exact: { focus: definitions.slice(0, 20) }, code: smallCode }],
      ['ambiguous-list-cap', { symbol: 'focus', includeCode: true }, { exact: { focus: definitions }, code: largeCode }],
      ['ambiguous-first-always', { symbol: 'focus', includeCode: true }, { exact: { focus: definitions.slice(0, 2) }, code: largeCode }],
    ];
    for (const [id, request, scenario] of cases) await capture(id, request, scenario);
  });

  it('captures file resolution, structural summaries, security, and pagination', async () => {
    const readFile = { path: 'src/read.ts', language: 'typescript', nodeCount: 1 };
    const otherRead = { path: 'apps/other/read.ts', language: 'typescript', nodeCount: 0 };
    const config = { path: 'config/app.properties', language: 'properties', nodeCount: 2 };
    const large = { path: 'src/large.ts', language: 'typescript', nodeCount: 0 };
    const missing = { path: 'src/missing.ts', language: 'typescript', nodeCount: 1 };
    const symbol = { ...focus, signature: 'focus(  value: string  ): number' };
    const manySymbols = Array.from({ length: 205 }, (_, index) => node(`symbol-${index}`, `symbol${index}`, 'src/read.ts', `symbol${index}`, index + 1));
    const base: Scenario = {
      files: [readFile, otherRead, config, large, missing],
      fileNodes: {
        'src/read.ts': [symbol],
        'config/app.properties': [node('api-key', 'api_key', 'config/app.properties')],
        'src/missing.ts': [focus],
      },
      dependents: { 'src/read.ts': Array.from({ length: 10 }, (_, index) => `src/use-${index}.ts`) },
    };
    const cases: Array<[string, Record<string, unknown>, Scenario]> = [
      ['file-exact', { file: 'src/read.ts' }, base],
      ['file-exact-priority', { file: 'src/read.ts' }, {
        ...base,
        files: [readFile, { path: 'apps/src/read.ts', language: 'typescript', nodeCount: 0 }],
      }],
      ['file-suffix-priority', { file: 'read.ts' }, {
        ...base,
        files: [readFile, { path: 'src/read.ts.generated', language: 'typescript', nodeCount: 0 }],
      }],
      ['file-basename-ambiguous', { file: 'read.ts' }, base],
      ['file-windows', { file: 'src\\read.ts' }, base],
      ['file-leading-dot', { file: './src/read.ts' }, base],
      ['file-leading-slash', { file: '/src/read.ts' }, base],
      ['file-case', { file: 'SRC/READ.TS' }, base],
      ['file-unique-substring', { file: 'config/app' }, base],
      ['file-no-match', { file: 'never.ts' }, base],
      ['file-empty-index', { file: 'read.ts' }, { files: [] }],
      ['symbols-only', { file: 'src/read.ts', symbolsOnly: true }, base],
      ['symbols-only-empty', { file: 'apps/other/read.ts', symbolsOnly: true }, base],
      ['symbols-only-cap', { file: 'src/read.ts', symbolsOnly: true }, { ...base, fileNodes: { ...base.fileNodes, 'src/read.ts': manySymbols } }],
      ['config-secret-safe', { file: 'config/app.properties' }, base],
      ['read-failure', { file: 'src/missing.ts' }, base],
      ['raw-trailing-newline', { file: 'src/read.ts' }, base],
      ['raw-offset-limit', { file: 'src/read.ts', offset: 2, limit: 1 }, base],
      ['raw-past-eof', { file: 'src/read.ts', offset: 99 }, base],
      ['raw-default-2000-cap', { file: 'src/large.ts' }, base],
      ['raw-char-budget', { file: 'src/stale-large.ts' }, { files: [{ path: 'src/stale-large.ts', language: 'typescript', nodeCount: 0 }] }],
    ];
    for (const [id, request, scenario] of cases) await capture(id, request, scenario);
  });

  it('captures stale rendering and config safety', async () => {
    const staleSmall = node('stale-small', 'current', 'src/stale-small.ts', 'current', 1, 1);
    const staleLarge = node('stale-large', 'large', 'src/stale-large.ts', 'large', 1, 1);
    const staleConfig = node('stale-config', 'api_key', 'config/app.properties', 'api_key', 1, 1, 'constant');
    staleConfig.language = 'properties';
    const cases: Array<[string, Record<string, unknown>, Scenario]> = [
      ['fresh-symbol', { symbol: 'current', includeCode: true }, { exact: { current: [staleSmall] }, code: { 'stale-small': 'export const indexed = 1;' } }],
      ['stale-small-current', { symbol: 'current', includeCode: true }, { exact: { current: [staleSmall] }, stale: true }],
      ['stale-large-omitted', { symbol: 'large', includeCode: true }, { exact: { large: [staleLarge] }, stale: true }],
      ['stale-config-safe', { symbol: 'api_key', includeCode: true }, { exact: { api_key: [staleConfig] }, stale: true }],
      ['stale-metadata-only', { symbol: 'current' }, { exact: { current: [staleSmall] }, stale: true }],
    ];
    for (const [id, request, scenario] of cases) await capture(id, request, scenario);
  });

  it('freezes exact representative OLD behavior', () => {
    expect(records).toHaveLength(81);
    const byId = (id: string): OracleEntry => records.find((entry) => entry.scenario_id === id)!;
    expect(text(byId('include-code-string'))).not.toContain('function focus()');
    expect(text(byId('include-code-true'))).toContain('3\tfunction focus()');
    expect(byId('bare-all-exact').calls.slice(0, 1)).toEqual(['exact:focus']);
    expect(text(byId('bare-all-exact'))).toContain('src/focus.ts');
    expect(text(byId('file-miss-ignored'))).toContain('2 definitions named "focus"');
    expect(text(byId('container-outline'))).toContain('**Members (2):**');
    expect(text(byId('trail-dynamic-label'))).toContain('[dynamic: callback via `register`]');
    expect(text(byId('ambiguous-hard-cap'))).toContain('Returning 16 in full');
    expect(text(byId('ambiguous-list-cap'))).toContain('**Other definitions**');
    expect(text(byId('symbols-only-cap'))).toContain('… +5 more');
    expect(text(byId('config-secret-safe'))).not.toContain('SUPER_SECRET_NODE_VALUE');
    expect(text(byId('raw-offset-limit'))).toContain('2\tbeta');
    expect(text(byId('raw-default-2000-cap'))).toContain('pass `offset`/`limit`');
    expect(text(byId('stale-small-current'))).toContain('full CURRENT source');
    expect(text(byId('stale-large-omitted'))).toContain('body is omitted rather than risk');
    expect(text(byId('stale-config-safe'))).not.toContain('SUPER_SECRET_NODE_VALUE');

    const expectedPath = process.env.AFYX_NODE_ORACLE_EXPECT;
    if (expectedPath) {
      const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8')) as { cases: OracleEntry[] };
      expect(JSON.parse(JSON.stringify(records))).toEqual(expected.cases);
    }
  });
});
