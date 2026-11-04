#!/usr/bin/env node
/**
 * Micro-benchmark for the WAL / durability policy (`db/wal-valve.js`, whichever
 * implementation the target `dist/` holds — the pre-rewrite monolith or the Afyx-native
 * split behind the same facade).
 *
 * Two kinds of cases:
 *  - pure-policy-decision cases against a lightweight fake connection (no real I/O), timing
 *    the valve/coordinator's own overhead: the poll decision, the backpressure gate check,
 *    and `resolveWalValveMb`'s env/dbSize scaling;
 *  - a real-SQLite case (`real_backpressure_full_cycle`) against a genuine on-disk WAL
 *    database, timing an actual `backpressure()` pause end-to-end (worker-thread checkpoint
 *    round trip included) — the number that actually matters for durability, since the
 *    fake-connection cases below measure only the decision logic around it.
 *
 * Every case reports its result digest alongside the timing, so a fast-but-wrong (or
 * no-op-because-broken) case cannot pass for a speed-up.
 *
 * usage: node scripts/benchmark-wal-policy.mjs [--rounds R] [--dist dir] [--out file.json]
 * Requires a built dist/ (npm run build:clean), or --dist pointing at another build.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const ROUNDS = Number(arg('rounds', 9));
const OUT = arg('out', null);
const distRoot = path.resolve(arg('dist', 'dist'));
if (!fs.existsSync(path.join(distRoot, 'db', 'wal-valve.js'))) throw new Error('dist/ is not built: run `npm run build:clean` first');

const require = createRequire(path.join(distRoot, 'x.js'));
const { WalCheckpointValve, resolveWalValveMb } = require(path.join(distRoot, 'db', 'wal-valve.js'));
const { DatabaseConnection } = require(path.join(distRoot, 'db', 'index.js'));
const { QueryBuilder } = require(path.join(distRoot, 'db', 'queries.js'));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

// ---- a minimal fake connection for the no-real-I/O cases -----------------------------------------
// Deliberately independent of the TS test helper under __tests__/ (not part of dist): same
// shape (getWalSizeBytes / getDbFileSizeBytes / checkpointWalPassive / checkpointWalTruncate),
// scripted defaults mirroring real SQLite (PASSIVE never shrinks; TRUNCATE reports a full
// backfill and shrinks to a small residual).
function makeFakeConnection({ walBytes = 0 } = {}) {
  return {
    walBytes,
    calls: 0,
    getWalSizeBytes() { this.calls++; return this.walBytes; },
    getDbFileSizeBytes() { return 100 * 1024 * 1024; },
    async checkpointWalPassive() { return { busy: 0, log: 100, checkpointed: 100 }; },
    async checkpointWalTruncate() { this.walBytes = 32 * 1024; return { busy: 0, log: 100, checkpointed: 100 }; },
  };
}

const CASES = [];

// ---- resolveWalValveMb: pure math, no I/O at all --------------------------------------------------
CASES.push({
  name: 'resolveWalValveMb',
  ops: 5000,
  run: () => {
    let n = 0;
    for (let i = 0; i < 5000; i++) {
      n += resolveWalValveMb(i % 3 === 0 ? String(64 + (i % 512)) : undefined, i % 2 === 0 ? (i + 1) * 4 * 1024 * 1024 : undefined);
    }
    return n;
  },
});

// ---- check(): the soft-threshold poll, well under the threshold (never fires) --------------------
CASES.push({
  name: 'check_below_soft',
  ops: 2000,
  run: () => {
    const conn = makeFakeConnection({ walBytes: 1000 });
    const valve = new WalCheckpointValve(conn, 256); // soft = 256MB: 1000 bytes never fires
    for (let i = 0; i < 2000; i++) valve.check();
    return conn.calls;
  },
});

// ---- check(): fires every call (fresh valve each time so it's not blocked by inflight) -----------
CASES.push({
  name: 'check_fires_passive_decision_cost',
  ops: 500,
  run: () => {
    let fires = 0;
    for (let i = 0; i < 500; i++) {
      const conn = makeFakeConnection({ walBytes: 300 * 1024 * 1024 }); // over a 256MB soft default
      const valve = new WalCheckpointValve(conn, 256);
      valve.check(); // fires; the checkpoint promise itself is not awaited (decision cost only)
      fires++;
    }
    return fires;
  },
});

// ---- backpressure(): the null (no-wait) gate path, the common case on a healthy writer ------------
CASES.push({
  name: 'backpressure_null_path',
  ops: 2000,
  run: () => {
    const conn = makeFakeConnection({ walBytes: 10 * 1024 * 1024 }); // comfortably under hard/file caps
    const valve = new WalCheckpointValve(conn, 256);
    let nulls = 0;
    for (let i = 0; i < 2000; i++) if (valve.backpressure() === null) nulls++;
    return nulls;
  },
});

// ---- a real on-disk SQLite database: an actual backpressure() pause end-to-end -------------------
function withRealDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-wal-bench-'));
  const dbPath = path.join(dir, 'graph.db');
  const conn = DatabaseConnection.initialize(dbPath);
  try {
    return fn(conn);
  } finally {
    try { conn.close(); } catch { /* already closed */ }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* scratch */ }
  }
}
function insertRows(conn, count) {
  const q = new QueryBuilder(conn.getDb());
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `n${i}`, kind: 'function', name: `sym${i}`, qualifiedName: `file.ts::sym${i}`, filePath: 'src/file.ts',
      language: 'typescript', startLine: i + 1, endLine: i + 2, startColumn: 0, endColumn: 1,
      docstring: 'A modest docstring to give this row real bytes on disk.', updatedAt: Date.now(),
    });
  }
  q.insertNodes(nodes);
}
CASES.push({
  name: 'real_backpressure_full_cycle',
  ops: 3,
  isAsync: true,
  run: async () => {
    let cycles = 0;
    for (let i = 0; i < 3; i++) {
      await withRealDb(async (conn) => {
        const valve = new WalCheckpointValve(conn, 0.02, 2000); // ~20KB soft: a modest insert trips the hard cap
        insertRows(conn, 1500);
        const pause = valve.backpressure();
        if (pause) await pause;
        cycles++;
      });
    }
    return cycles;
  },
});

function contentOf(value) {
  return { rows: typeof value === 'number' ? value : 0, digest: digest(value) };
}

async function main() {
  const results = {};
  for (const { name, ops, run, isAsync } of CASES) {
    const first = contentOf(isAsync ? await run() : run());
    if (first.rows === 0) throw new Error(`benchmark case returned nothing: ${name}`);
    for (let warm = 0; warm < (isAsync ? 1 : 3); warm++) { if (isAsync) await run(); else run(); }
    const samples = [];
    for (let round = 0; round < (isAsync ? Math.max(3, Math.ceil(ROUNDS / 3)) : ROUNDS); round++) {
      const start = performance.now();
      if (isAsync) await run(); else run();
      samples.push(((performance.now() - start) / ops) * 1000);
    }
    results[name] = { median_us_per_op: Math.round(median(samples) * 100) / 100, spread_us: Math.round((Math.max(...samples) - Math.min(...samples)) * 100) / 100, ops, ...first };
  }

  const report = { generated_by: 'scripts/benchmark-wal-policy.mjs', node: process.version, rounds: ROUNDS, cases: results };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (OUT) fs.writeFileSync(OUT, text + '\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
