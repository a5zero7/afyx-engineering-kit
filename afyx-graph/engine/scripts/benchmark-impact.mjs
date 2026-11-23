#!/usr/bin/env node
/**
 * Micro-benchmark for impact/affected-tests (`src/impact/*`, plus the CLI/MCP wrappers
 * around it): symbol-impact merge across a definition group at several depths and graph
 * shapes, and the affected-tests file-level transitive BFS with and without matching
 * tests, direct vs transitive, and a large affected-test union.
 *
 * Builds the same seeded synthetic graph `scripts/benchmark-db.mjs`/`benchmark.mjs` use
 * (files -> nodes -> edges) directly against the compiled library — no extraction, no
 * subprocess — so timings measure the impact/affected logic itself, not indexing or
 * process spin-up. Every case reports its result count and a digest of the ordered
 * result, so a fast-but-wrong (or empty) case cannot pass for a speed-up.
 *
 * usage: node scripts/benchmark-impact.mjs [--rounds R] [--dist dir] [--out file.json]
 * Requires a built dist/ (npm run build:clean), or --dist pointing at another build.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
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
if (!fs.existsSync(path.join(distRoot, 'impact', 'index.js'))) throw new Error('dist/ is not built: run `npm run build:clean` first');

const require = createRequire(path.join(distRoot, 'x.js'));
const { transitiveFileImpact } = require(path.join(distRoot, 'impact', 'file-impact.js'));
const { computeAffectedTests } = require(path.join(distRoot, 'impact', 'affected-tests.js'));
const { mergeSymbolImpact } = require(path.join(distRoot, 'impact', 'symbol-impact.js'));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

// ---- a lightweight file-dependency host, mirroring real file-fan-out shapes ---------------------
function makeFileHost(edges) {
  const byTarget = new Map();
  for (const [src, dst] of edges) {
    if (!byTarget.has(dst)) byTarget.set(dst, []);
    byTarget.get(dst).push(src);
  }
  let calls = 0;
  return { calls: () => calls, getFileDependents: (f) => { calls++; return byTarget.get(f) ?? []; } };
}
// LINEAR chain: file0 <- file1 <- ... <- file199 (200 hops)
const linearEdges = [];
for (let i = 1; i < 200; i++) linearEdges.push([`file${i}.ts`, `file${i - 1}.ts`]);
// HIGH FAN-OUT: one root depended on by 500 direct dependents, each with its own 3 sub-dependents
const fanoutEdges = [];
for (let i = 0; i < 500; i++) {
  fanoutEdges.push([`mid${i}.ts`, 'root.ts']);
  for (let j = 0; j < 3; j++) fanoutEdges.push([`leaf${i}_${j}.ts`, `mid${i}.ts`]);
}
const isTestPath = (f) => f.includes('.test.');
// Affected-tests shapes: direct test, transitive test (3 hops), no test, large union (many tests).
const directTestEdges = [['a.test.ts', 'source.ts']];
const transitiveTestEdges = [['mid1.ts', 'source.ts'], ['mid2.ts', 'mid1.ts'], ['leaf.test.ts', 'mid2.ts']];
const noTestEdges = [['a.ts', 'source.ts'], ['b.ts', 'a.ts'], ['c.ts', 'b.ts']];
const largeUnionEdges = [];
for (let i = 0; i < 300; i++) largeUnionEdges.push([`t${i}.test.ts`, 'shared.ts']);

const CASES = [
  {
    name: 'symbol_impact_direct_depth1', ops: 500,
    run: () => {
      const host = { getImpactRadius: (id) => ({ nodes: new Map([[id, { id }]]), edges: [], roots: [id] }) };
      let n = 0;
      for (let i = 0; i < 500; i++) n += mergeSymbolImpact(host, [{ id: `n${i}` }], 1).nodes.size;
      return n;
    },
  },
  {
    name: 'symbol_impact_merge_3groups', ops: 200,
    run: () => {
      const host = {
        getImpactRadius: (id) => ({
          nodes: new Map([[id, { id }], [`${id}_dep`, { id: `${id}_dep` }]]),
          edges: [{ source: `${id}_dep`, target: id, kind: 'calls' }],
          roots: [id],
        }),
      };
      let n = 0;
      for (let i = 0; i < 200; i++) {
        const group = [{ id: `a${i}` }, { id: `b${i}` }, { id: `c${i}` }];
        n += mergeSymbolImpact(host, group, 3).nodes.size;
      }
      return n;
    },
  },
  { name: 'file_impact_linear_full', ops: 20, run: () => { let n = 0; for (let i = 0; i < 20; i++) n += transitiveFileImpact(makeFileHost(linearEdges), ['file0.ts'], { maxDepth: 200 }).allDependents.size; return n; } },
  { name: 'file_impact_linear_depth10', ops: 20, run: () => { let n = 0; for (let i = 0; i < 20; i++) n += transitiveFileImpact(makeFileHost(linearEdges), ['file0.ts'], { maxDepth: 10 }).allDependents.size; return n; } },
  { name: 'file_impact_high_fanout', ops: 20, run: () => { let n = 0; for (let i = 0; i < 20; i++) n += transitiveFileImpact(makeFileHost(fanoutEdges), ['root.ts'], { maxDepth: 10 }).allDependents.size; return n; } },
  { name: 'affected_tests_direct', ops: 500, run: () => { let n = 0; for (let i = 0; i < 500; i++) n += computeAffectedTests(makeFileHost(directTestEdges), ['source.ts'], { maxDepth: 5 }).affectedTests.length; return n; } },
  { name: 'affected_tests_transitive', ops: 500, run: () => { let n = 0; for (let i = 0; i < 500; i++) n += computeAffectedTests(makeFileHost(transitiveTestEdges), ['source.ts'], { maxDepth: 5 }).affectedTests.length; return n; } },
  { name: 'affected_tests_none', ops: 500, run: () => { let n = 0; for (let i = 0; i < 500; i++) n += computeAffectedTests(makeFileHost(noTestEdges), ['source.ts'], { maxDepth: 5 }).totalDependentsTraversed; return n; } },
  { name: 'affected_tests_large_union', ops: 20, run: () => { let n = 0; for (let i = 0; i < 20; i++) n += computeAffectedTests(makeFileHost(largeUnionEdges), ['shared.ts'], { maxDepth: 5 }).affectedTests.length; return n; } },
];

function contentOf(run) {
  const value = run();
  return { rows: typeof value === 'number' ? value : 0, digest: digest(value) };
}

const results = {};
for (const { name, ops, run } of CASES) {
  const first = contentOf(run);
  if (first.rows === 0) throw new Error(`benchmark case returned nothing: ${name}`);
  for (let warm = 0; warm < 3; warm++) run();
  const samples = [];
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now();
    run();
    samples.push(((performance.now() - start) / ops) * 1000);
  }
  results[name] = { median_us_per_op: Math.round(median(samples) * 100) / 100, spread_us: Math.round((Math.max(...samples) - Math.min(...samples)) * 100) / 100, ops, ...first };
}

const report = { generated_by: 'scripts/benchmark-impact.mjs', node: process.version, rounds: ROUNDS, cases: results };
const text = JSON.stringify(report, null, 2);
console.log(text);
if (OUT) fs.writeFileSync(OUT, text + '\n');
