/**
 * Regression coverage for issue #874: `afyx-graph index` produced 0 nodes / 0
 * edges while `afyx-graph init` worked, and appeared to wipe the graph.
 *
 * Root cause: `index` ran a full extraction against the already-populated DB
 * without clearing it first. Every file's content hash still matched, so the
 * orchestrator skipped re-inserting all of them, and the run reported its delta
 * (after - before = 0) as "0 nodes, 0 edges". The fix makes `index` a true full
 * rebuild — clear, then re-index — so it produces the same complete result as a
 * fresh `init`.
 *
 * Exercised end-to-end against the built binary so the CLI wiring (not just the
 * library) is covered.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AfyxGraph } from '../src';
import { DatabaseConnection } from '../src/db';
import {
  releaseWriterLockClaim,
  tryAcquireFullReindexWriterLock,
} from '../src/mcp/writer-lock';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

/** Normalize a PRAGMA read across return shapes (array | object | scalar). */
function pragmaValue(raw: unknown, key: string): unknown {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (row !== null && typeof row === 'object') return (row as Record<string, unknown>)[key];
  return row;
}

function runAfyxGraph(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runAfyxGraphResult(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function digest(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function graphCounts(dir: string): { nodes: number; edges: number } {
  const cg = AfyxGraph.openSync(dir);
  try {
    const stats = cg.getStats();
    return { nodes: stats.nodeCount, edges: stats.edgeCount };
  } finally {
    cg.close();
  }
}

describe('afyx-graph index — full re-index keeps the graph populated (#874)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-index-cmd-'));
    // A couple of files with a call edge so there is a non-trivial graph to
    // (fail to) reproduce.
    fs.writeFileSync(
      path.join(tempDir, 'a.ts'),
      `export function greet(name: string) { return hello(name); }\n` +
        `export function hello(n: string) { return 'hi ' + n; }\n`,
    );
    fs.writeFileSync(
      path.join(tempDir, 'b.ts'),
      `import { greet } from './a';\nexport function main() { return greet('world'); }\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reproduces init\'s node/edge counts instead of emptying the index', () => {
    runAfyxGraph(['init'], tempDir);
    const afterInit = graphCounts(tempDir);
    expect(afterInit.nodes).toBeGreaterThan(0);
    expect(afterInit.edges).toBeGreaterThan(0);

    const out = runAfyxGraph(['index'], tempDir);
    const afterIndex = graphCounts(tempDir);

    // The graph is still fully populated — `index` rebuilt it, it did not wipe it.
    expect(afterIndex.nodes).toBe(afterInit.nodes);
    expect(afterIndex.edges).toBe(afterInit.edges);

    // ...and the CLI reported the real counts, never the misleading "0 nodes".
    expect(out).not.toMatch(/\b0 nodes, 0 edges\b/);
    expect(out).toMatch(new RegExp(`\\b${afterInit.nodes} nodes\\b`));
  });

  it('is idempotent: a second index does not grow the graph', () => {
    runAfyxGraph(['init'], tempDir);
    runAfyxGraph(['index'], tempDir);
    const first = graphCounts(tempDir);
    runAfyxGraph(['index'], tempDir);
    const second = graphCounts(tempDir);

    // A clean rebuild each time — no duplicate (re-resolved) edges accumulating
    // across runs (the C# "+18 edges" symptom in the report).
    expect(second.nodes).toBe(first.nodes);
    expect(second.edges).toBe(first.edges);
  });

  it('--quiet path also rebuilds a populated graph', () => {
    runAfyxGraph(['init'], tempDir);
    const afterInit = graphCounts(tempDir);

    runAfyxGraph(['index', '--quiet'], tempDir);
    const afterIndex = graphCounts(tempDir);

    expect(afterIndex.nodes).toBe(afterInit.nodes);
    expect(afterIndex.edges).toBe(afterInit.edges);
  });

  it('refuses a live writer before mutating the database or sidecars, then succeeds after release', () => {
    runAfyxGraph(['init'], tempDir);
    const db = path.join(tempDir, '.afyx-graph', 'afyx-graph.db');
    const wal = `${db}-wal`;
    const shm = `${db}-shm`;
    fs.writeFileSync(wal, 'wal-sentinel');
    fs.writeFileSync(shm, 'shm-sentinel');
    const before = new Map([db, wal, shm].map((file) => [file, digest(file)]));

    const claim = tryAcquireFullReindexWriterLock(tempDir);
    expect(claim.kind).toBe('acquired');
    try {
      const refused = runAfyxGraphResult(['index', '--quiet'], tempDir);
      expect(refused.status).toBe(1);
      expect(refused.output).toMatch(/writer lock held/i);
      for (const [file, hash] of before) expect(digest(file)).toBe(hash);
    } finally {
      if (claim.kind === 'acquired') releaseWriterLockClaim(tempDir, claim.info);
    }

    expect(runAfyxGraphResult(['index', '--quiet'], tempDir).status).toBe(0);
    expect(graphCounts(tempDir).nodes).toBeGreaterThan(0);
  });

  it('allows at most one of two simultaneous destructive rebuilds to enter', async () => {
    for (let i = 0; i < 300; i++) {
      fs.writeFileSync(path.join(tempDir, `race-${i}.ts`), `export function race${i}() { return ${i}; }\n`);
    }
    runAfyxGraph(['init'], tempDir);

    const launch = () => new Promise<{ status: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, 'index', '--quiet'], {
        cwd: tempDir,
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout!.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
      child.stderr!.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
      child.once('error', reject);
      child.once('exit', (status) => resolve({ status, output }));
    });

    const attempts = await Promise.all([launch(), launch()]);
    expect(attempts.map((item) => item.status).sort()).toEqual([0, 1]);
    expect(attempts.filter((item) => /writer lock held/i.test(item.output))).toHaveLength(1);
    expect(graphCounts(tempDir).nodes).toBeGreaterThan(0);
  }, 30_000);
});

/**
 * Regression coverage for issue #1067: a full re-index must RECOVER an existing
 * oversized/stale index from earlier versions, not wedge on it.
 *
 * Root cause: `index` opened the old database and DELETE-d every row to clear
 * it. With FTS triggers firing per deleted node, a pre-fix poisoned graph (an
 * ignored gitlink corpus scanned into ~1.6M nodes + a multi-GB WAL, #1065) took
 * well over the 60s liveness-watchdog window to clear, so the process was
 * SIGKILLed before scanning even began and the bad state could never be rebuilt
 * away. The fix discards (unlinks) the database files and re-initializes a fresh
 * one — O(1) regardless of size — so `index` recovers any prior state.
 */
describe('afyx-graph index — recovers a stale/oversized prior index (#1067)', () => {
  let tempDir: string;
  const dbPath = (dir: string) => path.join(dir, '.afyx-graph', 'afyx-graph.db');

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-index-recover-'));
    fs.writeFileSync(
      path.join(tempDir, 'a.ts'),
      `export function greet(name: string) { return hello(name); }\n` +
        `export function hello(n: string) { return 'hi ' + n; }\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rebuilds to the current disk state, discarding content for files that no longer exist', () => {
    // Stand in for the "old graph indexed an ignored corpus" shape: index a tree
    // that also has a junk/ directory, then delete junk/ from disk so the DB now
    // carries stale nodes for paths that should no longer be indexed.
    const junkDir = path.join(tempDir, 'junk');
    fs.mkdirSync(junkDir);
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(path.join(junkDir, `j${i}.ts`), `export function j${i}() { return ${i}; }\n`);
    }
    runAfyxGraph(['init'], tempDir);
    const withJunk = graphCounts(tempDir);

    // Remove the corpus from disk. The DB still holds its nodes — the stale,
    // oversized prior state #1067 is about.
    fs.rmSync(junkDir, { recursive: true, force: true });

    runAfyxGraph(['index'], tempDir);
    const recovered = graphCounts(tempDir);

    // The rebuild reflects only what's on disk now — the junk nodes are gone…
    expect(recovered.nodes).toBeLessThan(withJunk.nodes);

    // …and the result is identical to a fresh init of the same (now-smaller) tree.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-index-fresh-'));
    try {
      fs.copyFileSync(path.join(tempDir, 'a.ts'), path.join(fresh, 'a.ts'));
      runAfyxGraph(['init'], fresh);
      const freshCounts = graphCounts(fresh);
      expect(recovered.nodes).toBe(freshCounts.nodes);
      expect(recovered.edges).toBe(freshCounts.edges);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  // The fix rebuilds a fresh DB rather than DELETE-ing rows in place. Prove it
  // with a header sentinel: PRAGMA user_version survives an in-place clear but
  // not a from-scratch recreate. (An inode check is unreliable — ext4/overlayfs
  // recycle the inode number after unlink+recreate.)
  it('rebuilds a fresh database rather than clearing the old one in place', () => {
    runAfyxGraph(['init'], tempDir);

    const stamp = DatabaseConnection.open(dbPath(tempDir));
    stamp.getDb().pragma('user_version = 4242');
    stamp.close();

    runAfyxGraph(['index'], tempDir);

    const check = DatabaseConnection.open(dbPath(tempDir));
    const userVersion = pragmaValue(check.getDb().pragma('user_version'), 'user_version');
    check.close();

    // Sentinel gone → `index` discarded the old DB and rebuilt it, the path that
    // avoids the per-row FTS delete wedge on a poisoned graph (#1067).
    expect(Number(userVersion)).not.toBe(4242);

    // …and the graph is intact afterwards.
    const counts = graphCounts(tempDir);
    expect(counts.nodes).toBeGreaterThan(0);
    expect(counts.edges).toBeGreaterThan(0);
  });

  it('recovers a corrupt database through the documented full-index command', () => {
    runAfyxGraph(['init'], tempDir);
    fs.writeFileSync(dbPath(tempDir), 'not a sqlite database');

    // `index` must discard the unreadable database before opening it. This is
    // the bounded recovery path for a corrupt disposable index; source files
    // remain authoritative and untouched.
    runAfyxGraph(['index'], tempDir);

    const counts = graphCounts(tempDir);
    expect(counts.nodes).toBeGreaterThan(0);
    expect(counts.edges).toBeGreaterThan(0);
  });
});
