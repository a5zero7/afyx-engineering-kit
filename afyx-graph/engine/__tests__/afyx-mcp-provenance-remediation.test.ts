import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { describeSynthesizedEdge } from '../src/mcp/dynamic-edge-notes';
import { snapshotParentProcessId } from '../src/mcp/early-ppid';
import { DiskDriftMonitor } from '../src/mcp/freshness-notices';
import { ToolHandler, tools } from '../src/mcp/tools';
import { ProgressSilencePolicy, watchdogChildSource } from '../src/mcp/watchdog-policy';
import type { Edge } from '../src/types';

function makeHeuristicEdge(
  synthesizedBy: string,
  extra: Record<string, unknown> = {},
): Edge {
  return {
    id: 1,
    sourceId: 10,
    targetId: 20,
    kind: 'calls',
    line: 12,
    provenance: 'heuristic',
    metadata: { synthesizedBy, ...extra },
  };
}

describe('AFYX native MCP provenance remediation behavior', () => {
  it('captures a valid parent PID in early-ppid snapshot', () => {
    const ppid = snapshotParentProcessId();
    expect(Number.isInteger(ppid)).toBe(true);
    expect(ppid).toBeGreaterThan(0);
    expect(ppid).toBe(process.ppid);
  });

  it('formats dynamic dispatch edges via table-driven formatter and generic fallback', () => {
    expect(describeSynthesizedEdge(null)).toBeNull();
    expect(
      describeSynthesizedEdge({
        id: 1,
        sourceId: 1,
        targetId: 2,
        kind: 'calls',
        line: 1,
        provenance: 'ast',
      }),
    ).toBeNull();

    const cb = describeSynthesizedEdge(
      makeHeuristicEdge('callback', { via: 'onSave', field: 'handler', registeredAt: 'app.ts:14' }),
    );
    expect(cb?.label).toContain('`onSave`');
    expect(cb?.label).toContain('.handler');
    expect(cb?.compact).toBe('dynamic: callback via `onSave` @app.ts:14');

    const custom = describeSynthesizedEdge(
      makeHeuristicEdge('redux-thunk', { registeredAt: 'store.ts:9' }),
    );
    expect(custom?.compact).toBe('dynamic: redux thunk @store.ts:9');
    expect(custom?.label).toBe('redux thunk (dynamic dispatch)');
  });

  it('emits watchdog child source without legacy upstream issue tags and tracks silence policy', () => {
    const childSrc = watchdogChildSource();
    expect(childSrc).toContain('[Afyx Graph]');
    expect(childSrc).not.toContain('#850');

    const policy = new ProgressSilencePolicy(1000, 5000, '1:10', 0);
    expect(policy.deadline(1000, '1:10')).toBe('terminate-stalled');
    expect(policy.deadline(1500, '2:20')).toBe('defer');
    expect(policy.deadline(6500, '3:30')).toBe('terminate-hard-cap');
  });

  it('tracks on-disk drift via DiskDriftMonitor stat+hash comparison', () => {
    const root = mkdtempSync(join(tmpdir(), 'afyx-drift-test-'));
    try {
      const targetFile = join(root, 'sample.ts');
      const initial = 'export const v = 1;\n';
      writeFileSync(targetFile, initial, 'utf-8');
      const initialHash = createHash('sha256').update(initial).digest('hex');

      const fakeGraph = {
        getProjectRoot: () => root,
        getFile: () => ({
          path: 'sample.ts',
          size: Buffer.byteLength(initial),
          modifiedAt: Date.now() + 60_000,
          contentHash: initialHash,
        }),
      } as never;

      const monitor = new DiskDriftMonitor(5_000);
      // Matching content hash even on mtime mismatch does not report drift.
      expect(monitor.isDrifted(fakeGraph, 'sample.ts', initial)).toBe(false);

      monitor.clear();
      writeFileSync(targetFile, 'export const v = 2;\n', 'utf-8');
      expect(monitor.isDrifted(fakeGraph, 'sample.ts')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates tool inputs cleanly and meets dispatch latency baseline', async () => {
    const handler = new ToolHandler(null);
    const bad = await handler.execute('afyx_graph_search', { query: '' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toContain('query must be a non-empty string');

    const startedAt = performance.now();
    for (let i = 0; i < 200; i++) {
      await handler.execute('afyx_graph_search', { query: 'x'.repeat(10_001) });
    }
    const elapsedMs = performance.now() - startedAt;
    expect(elapsedMs).toBeLessThan(2000);
    expect(tools).toHaveLength(9);
  });
});
