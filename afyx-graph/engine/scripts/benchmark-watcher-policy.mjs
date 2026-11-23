#!/usr/bin/env node
/**
 * Micro-benchmark for the Sync/Watcher deterministic policy layer (dist/sync):
 * event normalization, debounce/coalescing, and pending-set bookkeeping,
 * entirely decoupled from real OS filesystem event delivery (which is noisy
 * and platform-dependent — see benchmark.mjs's query-latency section for the
 * integrated, real-watcher timings instead). Reports medians over repeated
 * timed rounds plus a digest of the pending-set outcome for correctness
 * cross-checking against OLD/NEW builds.
 *
 * usage: node scripts/benchmark-watcher-policy.mjs [--rounds R] [--out file.json]
 * Requires a built dist/ (npm run build:clean).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const ROUNDS = Number(arg('rounds', 15));
const OUT = arg('out', null);
const dist = path.resolve('dist', 'sync');
if (!fs.existsSync(dist)) throw new Error('dist/ is not built: run `npm run build:clean` first');

process.env.NODE_ENV = 'test'; // FileWatcher's test-runtime registry gate; harmless outside vitest
const { FileWatcher, __emitWatchEventForTests } = await import(pathToFileURL(path.join(dist, 'watcher.js')).href);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value) => Math.round(value * 1000) / 1000;

async function timeCase(setup, iterations = ROUNDS) {
  const samples = [];
  let lastDigestInput = null;
  for (let i = 0; i < iterations; i++) {
    const { run, digestInput } = await setup();
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
    lastDigestInput = digestInput ? await digestInput() : null;
  }
  const digest = lastDigestInput
    ? createHash('sha256').update(JSON.stringify(lastDigestInput)).digest('hex').slice(0, 12)
    : null;
  return { median_ms: round(median(samples)), digest };
}

function makeWatcher(syncFn, opts = {}) {
  const root = `synthetic-root-${Math.random()}`;
  const w = new FileWatcher(root, syncFn, { inertForTests: true, debounceMs: 100_000, ...opts });
  w.start();
  return { root, w };
}

const CASES = {};

CASES.single_event = () => timeCase(async () => {
  const syncFn = async () => ({ filesChanged: 1, durationMs: 0 });
  const { root, w } = makeWatcher(syncFn);
  return {
    run: () => { __emitWatchEventForTests(root, 'src/a.ts'); w.stop(); },
    digestInput: () => [w.getPendingFiles().length],
  };
});

CASES.duplicate_event_folding = () => timeCase(async () => {
  const syncFn = async () => ({ filesChanged: 1, durationMs: 0 });
  const { root, w } = makeWatcher(syncFn);
  return {
    run: () => {
      for (let i = 0; i < 50; i++) __emitWatchEventForTests(root, 'src/a.ts');
      w.stop();
    },
    digestInput: () => [w.getPendingFiles().length],
  };
});

for (const n of [100, 1000]) {
  CASES[`${n}_event_coalescing`] = () => timeCase(async () => {
    const syncFn = async () => ({ filesChanged: n, durationMs: 0 });
    const { root, w } = makeWatcher(syncFn);
    return {
      run: () => {
        for (let i = 0; i < n; i++) __emitWatchEventForTests(root, `src/f${i}.ts`);
        w.stop();
      },
      digestInput: () => [w.getPendingFiles().length],
    };
  }, n >= 1000 ? Math.min(ROUNDS, 5) : ROUNDS);
}

CASES.mixed_add_change_many_paths = () => timeCase(async () => {
  const syncFn = async () => ({ filesChanged: 1, durationMs: 0 });
  const { root, w } = makeWatcher(syncFn);
  return {
    run: () => {
      for (let i = 0; i < 200; i++) __emitWatchEventForTests(root, `src/f${i % 60}.ts`);
      w.stop();
    },
    digestInput: () => [w.getPendingFiles().length],
  };
});

CASES.pending_prune_after_success = () => timeCase(async () => {
  let resolveSync;
  const gate = new Promise((r) => (resolveSync = r));
  const syncFn = async () => { await gate; return { filesChanged: 1, durationMs: 0 }; };
  const { root, w } = makeWatcher(syncFn, { debounceMs: 20 });
  __emitWatchEventForTests(root, 'src/a.ts');
  await new Promise((r) => setTimeout(r, 60));
  return {
    run: async () => {
      resolveSync();
      await new Promise((r) => setTimeout(r, 30));
      w.stop();
    },
    digestInput: () => [w.getPendingFiles().length],
  };
});

const results = {};
for (const [name, fn] of Object.entries(CASES)) {
  results[name] = await fn();
}

const report = {
  generated_by: 'scripts/benchmark-watcher-policy.mjs',
  node: process.version,
  rounds: ROUNDS,
  cases: results,
};
const text = JSON.stringify(report, null, 2);
console.log(text);
if (OUT) fs.writeFileSync(OUT, text + '\n');
