import { createHash } from 'crypto';
import * as fs from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { executeStatusTool } from '../src/mcp/status-tool';
import { ToolHandler } from '../src/mcp/tools';

type Stats = {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  dbSizeBytes: number;
  nodesByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
};

type PendingFile = { path: string; lastSeenMs: number; indexing?: boolean };

type Scenario = {
  id: string;
  stats?: Partial<Stats>;
  journalMode?: string | undefined;
  pendingReferences?: number;
  watcherDegraded?: boolean;
  degradedReason?: string | null;
  pendingFiles?: PendingFile[];
  worktreeMismatch?: { worktreeRoot: string; indexRoot: string } | null;
};

type OracleEntry = {
  scenario_id: string;
  calls: string[];
  now_ms: number;
  result: unknown;
  serialized_bytes: number;
  sha256: string;
};

const NOW = 2_000_000;
const baseStats: Stats = {
  fileCount: 3,
  nodeCount: 5,
  edgeCount: 7,
  dbSizeBytes: 2 * 1024 * 1024,
  nodesByKind: { function: 3, class: 2 },
  filesByLanguage: { typescript: 2, python: 1 },
};

const scenarios: Scenario[] = [
  { id: 'empty', stats: { fileCount: 0, nodeCount: 0, edgeCount: 0, dbSizeBytes: 0, nodesByKind: {}, filesByLanguage: {} } },
  { id: 'normal' },
  { id: 'db-zero', stats: { dbSizeBytes: 0 } },
  { id: 'db-small', stats: { dbSizeBytes: 1 } },
  { id: 'db-round-down', stats: { dbSizeBytes: 1.234 * 1024 * 1024 } },
  { id: 'db-round-up', stats: { dbSizeBytes: 1.236 * 1024 * 1024 } },
  { id: 'counts', stats: { fileCount: 11, nodeCount: 22, edgeCount: 33 } },
  { id: 'journal-wal', journalMode: 'wal' },
  { id: 'journal-delete', journalMode: 'delete' },
  { id: 'journal-memory', journalMode: 'memory' },
  { id: 'journal-empty', journalMode: '' },
  { id: 'journal-undefined', journalMode: undefined },
  { id: 'refs-zero', pendingReferences: 0 },
  { id: 'refs-negative', pendingReferences: -1 },
  { id: 'refs-one', pendingReferences: 1 },
  { id: 'refs-many', pendingReferences: 17 },
  { id: 'kind-one', stats: { nodesByKind: { function: 1 } } },
  { id: 'kind-many', stats: { nodesByKind: { class: 2, function: 3, method: 4 } } },
  { id: 'kind-zero-omitted', stats: { nodesByKind: { function: 2, class: 0 } } },
  { id: 'kind-negative-omitted', stats: { nodesByKind: { function: 2, class: -1 } } },
  { id: 'kind-order', stats: { nodesByKind: { zeta: 1, alpha: 2, middle: 3 } } },
  { id: 'language-one', stats: { filesByLanguage: { rust: 1 } } },
  { id: 'language-many', stats: { filesByLanguage: { python: 2, typescript: 3, rust: 4 } } },
  { id: 'language-zero-omitted', stats: { filesByLanguage: { python: 2, rust: 0 } } },
  { id: 'language-negative-omitted', stats: { filesByLanguage: { python: 2, rust: -1 } } },
  { id: 'language-order', stats: { filesByLanguage: { zeta: 1, alpha: 2, middle: 3 } } },
  { id: 'watcher-healthy' },
  { id: 'watcher-degraded-reason', watcherDegraded: true, degradedReason: 'watch limit exhausted' },
  { id: 'watcher-degraded-fallback', watcherDegraded: true, degradedReason: null },
  { id: 'pending-none', pendingFiles: [] },
  { id: 'pending-one', pendingFiles: [{ path: 'src/a.ts', lastSeenMs: NOW - 25 }] },
  { id: 'pending-indexing', pendingFiles: [{ path: 'src/a.ts', lastSeenMs: NOW - 40, indexing: true }] },
  { id: 'pending-several', pendingFiles: [
    { path: 'src/a.ts', lastSeenMs: NOW - 5 },
    { path: 'src/b.ts', lastSeenMs: NOW - 10, indexing: true },
  ] },
  { id: 'pending-order', pendingFiles: [
    { path: 'z.ts', lastSeenMs: NOW - 1 },
    { path: 'a.ts', lastSeenMs: NOW - 2 },
    { path: 'm.ts', lastSeenMs: NOW - 3 },
  ] },
  { id: 'pending-age-zero', pendingFiles: [{ path: 'src/a.ts', lastSeenMs: NOW }] },
  { id: 'pending-age-positive', pendingFiles: [{ path: 'src/a.ts', lastSeenMs: NOW - 1234 }] },
  { id: 'pending-future-clamped', pendingFiles: [{ path: 'src/a.ts', lastSeenMs: NOW + 500 }] },
  { id: 'mismatch-none', worktreeMismatch: null },
  { id: 'mismatch', worktreeMismatch: { worktreeRoot: 'C:/repo/worktree', indexRoot: 'C:/repo/main' } },
  { id: 'all-optionals', journalMode: 'delete', pendingReferences: 4, watcherDegraded: true, degradedReason: 'watch stopped', pendingFiles: [{ path: 'src/live.ts', lastSeenMs: NOW - 77, indexing: true }], worktreeMismatch: { worktreeRoot: 'C:/repo/worktree', indexRoot: 'C:/repo/main' } },
  { id: 'long-unbounded', stats: {
    nodesByKind: Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`kind-${index}-${'x'.repeat(20)}`, index + 1])),
    filesByLanguage: Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`language-${index}-${'y'.repeat(20)}`, index + 1])),
  } },
];

function makeGraph(scenario: Scenario, calls: string[], root = 'C:/project') {
  const stats: Stats = {
    ...baseStats,
    ...scenario.stats,
    nodesByKind: scenario.stats?.nodesByKind ?? baseStats.nodesByKind,
    filesByLanguage: scenario.stats?.filesByLanguage ?? baseStats.filesByLanguage,
  };
  const record = <T>(name: string, value: T) => () => {
    calls.push(name);
    return value;
  };
  return {
    getProjectRoot: record('getProjectRoot', root),
    getStats: record('getStats', stats),
    getIndexState: record('getIndexState', 'complete'),
    getIndexAccounting: record('getIndexAccounting', null),
    getIndexBuildInfo: record('getIndexBuildInfo', { version: '1.0.0', extractionVersion: 28 }),
    isIndexStale: record('isIndexStale', false),
    getJournalMode: record('getJournalMode', scenario.journalMode ?? (scenario.id === 'journal-undefined' ? undefined : 'wal')),
    getPendingReferenceCount: record('getPendingReferenceCount', scenario.pendingReferences ?? 0),
    isWatching: record('isWatching', !(scenario.watcherDegraded ?? false)),
    isWatcherDegraded: record('isWatcherDegraded', scenario.watcherDegraded ?? false),
    getWatcherDegradedReason: record('getWatcherDegradedReason', scenario.degradedReason ?? null),
    getPendingFiles: record('getPendingFiles', scenario.pendingFiles ?? []),
  };
}

async function capture(scenario: Scenario): Promise<OracleEntry> {
  const calls: string[] = [];
  const graph = makeGraph(scenario, calls);
  const handler = new ToolHandler(graph as never) as unknown as Record<string, unknown>;
  handler.worktreeMismatchFor = (() => scenario.worktreeMismatch ?? null) as unknown;
  const result = await (handler.handleStatus as (args: Record<string, unknown>) => Promise<unknown>)({});
  const serialized = JSON.stringify(result);
  return {
    scenario_id: scenario.id,
    calls,
    now_ms: NOW,
    result,
    serialized_bytes: Buffer.byteLength(serialized),
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
}

describe('MCP Status adapter ground truth', () => {
  it('freezes the complete OLD presentation matrix', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const records: OracleEntry[] = [];
    for (const scenario of scenarios) records.push(await capture(scenario));

    const byId = (id: string) => records.find((entry) => entry.scenario_id === id)!;
    const text = (id: string) => (byId(id).result as { content: Array<{ text: string }> }).content[0]!.text;

    expect(records).toHaveLength(41);
    expect(text('empty')).toContain('**Database size:** 0.00 MB');
    expect(text('db-small')).toContain('**Database size:** 0.00 MB');
    expect(text('db-round-down')).toContain('**Database size:** 1.23 MB');
    expect(text('db-round-up')).toContain('**Database size:** 1.24 MB');
    expect(text('counts')).toContain('**Files indexed:** 11\n**Total nodes:** 22\n**Total edges:** 33');
    expect(text('normal')).toContain('**Backend:** node:sqlite (Node built-in) — full WAL + FTS5');
    expect(text('journal-wal')).toContain('**Journal mode:** wal (concurrent reads safe)');
    expect(text('journal-delete')).toContain('**Journal mode:** ⚠ delete — WAL not active');
    expect(text('journal-memory')).toContain('**Journal mode:** ⚠ memory — WAL not active');
    expect(text('journal-empty')).toContain('**Journal mode:** ⚠ unknown — WAL not active');
    expect(text('journal-undefined')).toContain('**Journal mode:** ⚠ unknown — WAL not active');
    expect(text('refs-zero')).not.toContain('Pending resolution');
    expect(text('refs-negative')).not.toContain('Pending resolution');
    expect(text('refs-one')).toContain('**Pending resolution:** ⚠ 1 references');
    expect(text('refs-many')).toContain('**Pending resolution:** ⚠ 17 references');
    expect(text('kind-zero-omitted')).not.toContain('- class: 0');
    expect(text('kind-negative-omitted')).not.toContain('- class: -1');
    expect(text('kind-order').indexOf('- zeta: 1')).toBeLessThan(text('kind-order').indexOf('- alpha: 2'));
    expect(text('language-zero-omitted')).not.toContain('- rust: 0');
    expect(text('language-negative-omitted')).not.toContain('- rust: -1');
    expect(text('language-order').indexOf('- zeta: 1')).toBeLessThan(text('language-order').indexOf('- alpha: 2'));
    expect(text('watcher-healthy')).not.toContain('Auto-sync disabled');
    expect(text('watcher-degraded-reason')).toContain('- watch limit exhausted');
    expect(text('watcher-degraded-reason')).toContain('- The index is frozen; Read files directly for current content.');
    expect(text('watcher-degraded-fallback')).toContain('- live file watching stopped');
    expect(text('pending-none')).not.toContain('Pending sync');
    expect(text('pending-one')).toContain('- src/a.ts (edited 25ms ago, pending sync)');
    expect(text('pending-indexing')).toContain('- src/a.ts (edited 40ms ago, indexing in progress)');
    expect(text('pending-order').indexOf('- z.ts')).toBeLessThan(text('pending-order').indexOf('- a.ts'));
    expect(text('pending-age-positive')).toContain('edited 1234ms ago');
    expect(text('pending-future-clamped')).toContain('edited 0ms ago');
    expect(text('mismatch')).toContain('> ⚠ This Afyx Graph index belongs to a different git working tree.\n>   Running in: C:/repo/worktree');
    expect(text('long-unbounded')).not.toContain('output truncated');
    expect(text('long-unbounded').length).toBeGreaterThan(15_000);
    expect((byId('normal').result as { isError?: boolean }).isError).toBeUndefined();

    const outputPath = process.env.AFYX_STATUS_ORACLE_OUT;
    if (outputPath) fs.writeFileSync(outputPath, JSON.stringify({
      phase: process.env.AFYX_STATUS_ORACLE_PHASE ?? 'NEW',
      cases: records,
    }, null, 2));
  });

  it('prefers the watched default for an explicit path resolving to the same project', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const defaultGraph = makeGraph({ id: 'default', pendingFiles: [{ path: 'watched.ts', lastSeenMs: NOW - 5 }] }, [], 'C:/same');
    const reopenedGraph = makeGraph({ id: 'reopened' }, [], 'C:/same');
    const handler = new ToolHandler(defaultGraph as never) as unknown as Record<string, unknown>;
    handler.getAfyxGraph = (() => reopenedGraph) as unknown;
    handler.worktreeMismatchFor = (() => null) as unknown;

    const result = await (handler.handleStatus as (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>)({ projectPath: 'C:/same' });
    expect(result.content[0]!.text).toContain('watched.ts');
  });

  it('keeps a different explicit project isolated from the watched default', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const defaultGraph = makeGraph({ id: 'default', watcherDegraded: true, degradedReason: 'default-only', pendingFiles: [{ path: 'default.ts', lastSeenMs: NOW }] }, [], 'C:/default');
    const otherGraph = makeGraph({ id: 'other', pendingFiles: [{ path: 'other.ts', lastSeenMs: NOW }] }, [], 'C:/other');
    const handler = new ToolHandler(defaultGraph as never) as unknown as Record<string, unknown>;
    handler.getAfyxGraph = (() => otherGraph) as unknown;
    handler.worktreeMismatchFor = (() => null) as unknown;

    const result = await (handler.handleStatus as (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>)({ projectPath: 'C:/other' });
    expect(result.content[0]!.text).toContain('other.ts');
    expect(result.content[0]!.text).not.toContain('default.ts');
    expect(result.content[0]!.text).not.toContain('default-only');
  });

  it('executes Status on the main thread without QueryPool or automatic wrappers', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const graph = makeGraph({ id: 'dispatch' }, []);
    const handler = new ToolHandler(graph as never) as unknown as Record<string, unknown>;
    const poolRun = vi.fn(() => { throw new Error('Status entered QueryPool'); });
    handler.queryPool = { healthy: true, ready: true, run: poolRun } as unknown;
    handler.worktreeMismatchFor = (() => null) as unknown;
    handler.withWorktreeNotice = (() => { throw new Error('Status entered compact worktree wrapper'); }) as unknown;
    handler.withStalenessNotice = (() => { throw new Error('Status entered staleness wrapper'); }) as unknown;

    const result = await (handler.execute as (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>)('afyx_graph_status', {});
    expect(result.content[0]!.text).toContain('**Afyx Graph Status**');
    expect(poolRun).not.toHaveBeenCalled();
  });
});

describe('Afyx-native Status seam', () => {
  it('renders the exact healthy contract through narrow source capabilities', () => {
    const calls: string[] = [];
    const result = executeStatusTool(makeGraph({ id: 'healthy' }, calls) as never, { nowMs: NOW });

    expect(calls).toEqual([
      'getStats',
      'getPendingFiles',
      'getProjectRoot',
      'isWatching',
      'isWatcherDegraded',
      'getIndexBuildInfo',
      'getIndexState',
      'getIndexAccounting',
      'isIndexStale',
      'getPendingReferenceCount',
      'getJournalMode',
    ]);
    expect(result).toEqual({ content: [{ type: 'text', text:
      '**Afyx Graph Status**\n\n' +
      '**Files indexed:** 3\n' +
      '**Total nodes:** 5\n' +
      '**Total edges:** 7\n' +
      '**Database size:** 2.00 MB\n' +
      '**Backend:** node:sqlite (Node built-in) — full WAL + FTS5\n' +
      '\n**Index Health:**\n' +
      '- Git freshness: MISSING — no Afyx Graph database; run "afyx-graph init"\n' +
      '- Filesystem/content: CURRENT (0 pending)\n' +
      '- Extraction: COMPLETE\n' +
      // The fixture is built with extraction v28, while the current runtime
      // is v29; the version comparison must remain visible to operators.
      '- Extraction version: 28/29\n' +
      '- Pending references: 0\n' +
      '- Watcher: ENABLED\n' +
      '- Last full index accounting: unavailable\n' +
      '**Journal mode:** wal (concurrent reads safe)\n\n' +
      '**Nodes by Kind:**\n' +
      '- function: 3\n' +
      '- class: 2\n\n' +
      '**Languages:**\n' +
      '- typescript: 2\n' +
      '- python: 1',
    }] });
  });

  it('renders optional health facts with a deterministic clock', () => {
    const graph = makeGraph({
      id: 'optional',
      journalMode: 'delete',
      pendingReferences: 2,
      watcherDegraded: true,
      degradedReason: null,
      pendingFiles: [
        { path: 'src/a.ts', lastSeenMs: NOW - 10 },
        { path: 'src/b.ts', lastSeenMs: NOW + 10, indexing: true },
      ],
    }, []);
    const result = executeStatusTool(graph as never, {
      nowMs: NOW,
      worktreeWarning: 'line one\nline two',
    });
    const text = result.content[0]!.text;

    expect(text).toContain('> ⚠ line one\n> line two');
    expect(text).toContain('**Journal mode:** ⚠ delete — WAL not active');
    expect(text).toContain('**Pending resolution:** ⚠ 2 references');
    expect(text).toContain('- live file watching stopped');
    expect(text).toContain('- src/a.ts (edited 10ms ago, pending sync)');
    expect(text).toContain('- src/b.ts (edited 0ms ago, indexing in progress)');
  });

  it('does not apply the shared 15k output bound', () => {
    const graph = makeGraph(scenarios.find((scenario) => scenario.id === 'long-unbounded')!, []);
    const text = executeStatusTool(graph as never, { nowMs: NOW }).content[0]!.text;
    expect(text.length).toBeGreaterThan(15_000);
    expect(text).not.toContain('output truncated');
  });
});
