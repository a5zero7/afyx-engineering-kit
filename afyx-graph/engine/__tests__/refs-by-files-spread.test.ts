/**
 * getUnresolvedReferencesByFiles must survive dense result sets (#1558).
 *
 * The input file-path list is chunked under SQLite's parameter limit, but the
 * ROWS a chunk returns are unbounded — and appending them with
 * `rows.push(...chunkRows)` passes every row as a call argument, so a dense
 * chunk (a recovery sync re-indexing many files at once, e.g. the #1541
 * self-heal) exceeded V8's argument limit and killed the whole sync with
 * "Maximum call stack size exceeded" after the store phase, leaving every
 * re-indexed file's references unresolved. Reproduced for real on a
 * cpython-stdlib-sized heal (919 files, 234k refs). The append is now a loop;
 * this pins it with a result set well past V8's argument ceiling (~124k).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { AfyxGraph } from '../src';
import type { DatabaseConnection } from '../src/db';
import type { UnresolvedReference } from '../src/types';

describe('unresolved-ref loads with dense result sets (#1558)', () => {
  let dir: string;
  let cg: AfyxGraph;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-spread-'));
    fs.writeFileSync(path.join(dir, 'anchor.py'), 'def anchor():\n    return 1\n');
    cg = await AfyxGraph.init(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    cg.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns 200k pending refs from few files without exhausting the call stack', () => {
    const { queries, db } = cg as unknown as {
      db: DatabaseConnection;
      queries: {
        insertUnresolvedRefsBatch(refs: UnresolvedReference[]): void;
        getUnresolvedReferencesByFiles(paths: string[]): UnresolvedReference[];
        getUnresolvedReferencesCount(): number;
      };
    };

    const FILES = 200;
    const TOTAL = 200_000;
    const paths: string[] = Array.from({ length: FILES }, (_, i) => `src/f${i}.py`);
    // unresolved_refs.from_node_id is FK-constrained — anchor on a real node.
    const anchorId = cg.getNodesInFile('anchor.py')[0]!.id;

    const started = performance.now();
    const cpuBefore = process.cpuUsage();
    const ioBefore = process.resourceUsage();
    // Population is one fixture operation, not ten durability scenarios. Nested
    // batch calls retain their real FK checks and bounded SQL parameter chunks,
    // while one commit avoids repeated WAL checkpoints on Windows CI storage.
    db.transaction(() => {
      const batch: UnresolvedReference[] = [];
      for (let i = 0; i < TOTAL; i++) {
        batch.push({
          fromNodeId: anchorId,
          referenceName: `ref_${i}`,
          referenceKind: 'call',
          line: (i % 1000) + 1,
          column: 0,
          filePath: paths[i % FILES]!,
          language: 'python',
        });
        if (batch.length === 20_000) {
          queries.insertUnresolvedRefsBatch(batch);
          batch.length = 0;
        }
      }
      if (batch.length > 0) queries.insertUnresolvedRefsBatch(batch);
    });
    const inserted = performance.now();

    // All 200 paths fit in ONE SQLite parameter chunk, so a single query
    // returns all 200k rows — the exact shape that blew the argument limit.
    const rows = queries.getUnresolvedReferencesByFiles(paths);
    const queried = performance.now();
    if (process.env.CI || process.env.AFYX_GRAPH_STRESS_METRICS) {
      const cpu = process.cpuUsage(cpuBefore);
      const usage = process.resourceUsage();
      console.info('[refs-200k]', JSON.stringify({ node: process.version,
        insertMs: inserted - started, queryMs: queried - inserted,
        cpuMs: (cpu.user + cpu.system) / 1000, rssBytes: process.memoryUsage().rss,
        processPeakRssBytes: usage.maxRSS * 1024,
        readOps: usage.fsRead - ioBefore.fsRead, writeOps: usage.fsWrite - ioBefore.fsWrite }));
    }
    expect(rows.length).toBe(TOTAL);
    expect(new Set(rows.map((row) => row.referenceName)).size).toBe(TOTAL);
    expect(new Set(rows.map((row) => row.filePath)).size).toBe(FILES);
    expect(db.getDb().pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => queries.insertUnresolvedRefsBatch([{
      fromNodeId: 'missing-node', referenceName: 'invalid', referenceKind: 'call', line: 1, column: 0,
    }])).toThrow(/FOREIGN KEY/i);
    expect(queries.getUnresolvedReferencesCount()).toBe(TOTAL);
  }, 30_000);
});
