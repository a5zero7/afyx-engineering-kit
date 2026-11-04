#!/usr/bin/env node
/**
 * Micro-benchmark for the read side of the persistence layer: `QueryBuilder`'s node,
 * edge, name, file, reference, dependency, routing and search reads.
 *
 * Builds the same seeded synthetic graph `scripts/benchmark-db.mjs` writes, opens it
 * with the built library, and times the reads the graph, context and search layers lean
 * on hardest: point and batch node lookups (cold and cache-warm), name/kind/file scans,
 * edge fan-in/fan-out, dependency lookups, unresolved-reference batches, and every search
 * mode (FTS, LIKE fallback, exact-name hybrid, routing manifest). Every case reports its
 * result/row count and a digest of the ordered result, so a fast-but-wrong (or empty)
 * read cannot pass for a speed-up.
 *
 * usage: node scripts/benchmark-db-query.mjs [--files N] [--rounds R] [--dist dir] [--out file.json]
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
const FILES = Number(arg('files', 160));
const ROUNDS = Number(arg('rounds', 9));
const OUT = arg('out', null);
const distRoot = path.resolve(arg('dist', 'dist'));
if (!fs.existsSync(path.join(distRoot, 'db', 'index.js'))) throw new Error('dist/ is not built: run `npm run build:clean` first');

const require = createRequire(path.join(distRoot, 'x.js'));
const { DatabaseConnection } = require(path.join(distRoot, 'db', 'index.js'));
const { QueryBuilder } = require(path.join(distRoot, 'db', 'queries.js'));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// ---- the same seeded dataset benchmark-db.mjs writes, built here directly against QueryBuilder ----
const PER_FILE = 30;
const KINDS = ['function', 'method', 'class', 'variable', 'interface'];
function buildData() {
  const random = seeded(20260927);
  const files = [];
  const nodes = [];
  const edges = [];
  const refs = [];
  for (let f = 0; f < FILES; f++) {
    const filePath = `src/pkg${f % 12}/file${f}.ts`;
    files.push({ path: filePath, contentHash: `hash${f}`, language: 'typescript', size: 1000 + f, modifiedAt: 1_700_000_000_000 + f, indexedAt: 1_700_000_100_000 + f, nodeCount: PER_FILE + 1 });
    const fileId = `f${f}:file`;
    nodes.push({ id: fileId, kind: 'file', name: `file${f}.ts`, qualifiedName: filePath, filePath, language: 'typescript', startLine: 1, endLine: 200, startColumn: 0, endColumn: 0, updatedAt: 1_700_000_000_000 });
    for (let n = 0; n < PER_FILE; n++) {
      const kind = KINDS[n % KINDS.length];
      const id = `f${f}:n${n}`;
      nodes.push({
        id, kind, name: `symbol${f}_${n}`, qualifiedName: `${filePath}::symbol${f}_${n}`, filePath, language: 'typescript', startLine: n * 5 + 2, endLine: n * 5 + 6,
        startColumn: 0, endColumn: 1, docstring: n % 3 === 0 ? `Documentation for symbol ${f}_${n}` : undefined, signature: kind === 'function' ? `(a: number) => number` : undefined,
        isExported: n % 4 === 0, visibility: n % 2 ? 'public' : undefined, updatedAt: 1_700_000_000_000,
      });
      edges.push({ source: fileId, target: id, kind: 'contains' });
      const calls = 1 + Math.floor(random() * 3);
      for (let c = 0; c < calls; c++) {
        const otherFile = Math.floor(random() * FILES);
        const target = `f${otherFile}:n${Math.floor(random() * PER_FILE)}`;
        edges.push({ source: id, target, kind: c % 2 ? 'references' : 'calls', line: n * 5 + 3 + c, column: c });
      }
      if (n % 7 === 0) refs.push({ fromNodeId: id, referenceName: `external${n}`, referenceKind: 'calls', line: n * 5 + 3, column: 2, filePath, language: 'typescript' });
    }
  }
  const known = new Set(nodes.map((node) => node.id));
  return { files, nodes, edges: edges.filter((e) => known.has(e.source) && known.has(e.target)), refs };
}
const DATA = buildData();
const ids = DATA.nodes.map((n) => n.id);
const filePaths = DATA.files.map((f) => f.path);
const allNames = [...new Set(DATA.nodes.map((n) => n.name))];
// Bounded samples for the per-name loops below: the point is realistic query shapes,
// not an exhaustive scan of every distinct name in a 4800-node synthetic project.
const names = allNames.slice(0, 200);
const searchNames = allNames.slice(0, 60);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-dbquery-'));
const dbPath = path.join(root, 'graph.db');
const conn = DatabaseConnection.initialize(dbPath);
const q = new QueryBuilder(conn.getDb());
q.insertNodes(DATA.nodes);
q.insertEdges(DATA.edges);
q.insertUnresolvedRefsBatch(DATA.refs);
for (const file of DATA.files) q.upsertFile(file);
q.insertNameSegmentsBatch(q.getDistinctNodeNames(100000, 0));

// ---- cases ----------------------------------------------------------------------------------------
const CASES = [
  { name: 'getNodeById_cold', ops: 500, run: () => { let n = 0; for (let i = 0; i < 500; i++) { q.clearCache(); if (q.getNodeById(ids[i % ids.length])) n++; } return n; } },
  { name: 'getNodeById_warm', ops: 2000, run: () => { let n = 0; for (let i = 0; i < 2000; i++) if (q.getNodeById(ids[i % 50])) n++; return n; } },
  { name: 'getNodesByIds_small', ops: 20, run: () => { let n = 0; for (let i = 0; i < 20; i++) n += q.getNodesByIds(ids.slice(i * 5, i * 5 + 5)).size; return n; } },
  { name: 'getNodesByIds_large', ops: 8, run: () => { let n = 0; for (let i = 0; i < 8; i++) n += q.getNodesByIds(ids.slice(0, 400)).size; return n; } },
  { name: 'getNodesByFile', ops: filePaths.length, run: () => { let n = 0; for (const p of filePaths) n += q.getNodesByFile(p).length; return n; } },
  { name: 'getNodesByKind', ops: KINDS.length, run: () => { let n = 0; for (const k of KINDS) n += q.getNodesByKind(k).length; return n; } },
  { name: 'getNodesByName', ops: names.length, run: () => { let n = 0; for (const nm of names) n += q.getNodesByName(nm).length; return n; } },
  { name: 'getNodesByNamePrefix', ops: 60, run: () => { let n = 0; for (let i = 0; i < 60; i++) n += q.getNodesByNamePrefix(`symbol${i % 12}_`, 20).length; return n; } },
  { name: 'getNodesByLowerName', ops: 60, run: () => { let n = 0; for (let i = 0; i < 60; i++) n += q.getNodesByLowerName(names[i % names.length].toUpperCase()).length; return n; } },
  { name: 'getOutgoingEdges', ops: 500, run: () => { let n = 0; for (let i = 0; i < 500; i++) n += q.getOutgoingEdges(ids[i % ids.length]).length; return n; } },
  { name: 'getIncomingEdges', ops: 500, run: () => { let n = 0; for (let i = 0; i < 500; i++) n += q.getIncomingEdges(ids[i % ids.length], ['calls', 'references']).length; return n; } },
  { name: 'getOutgoingEdgesFrom_batch', ops: 10, run: () => { let n = 0; for (let i = 0; i < 10; i++) n += q.getOutgoingEdgesFrom(ids.slice(i * 40, i * 40 + 40)).length; return n; } },
  { name: 'getDependencyFilePaths', ops: filePaths.length, run: () => { let n = 0; for (const p of filePaths) n += q.getDependencyFilePaths(p).length; return n; } },
  { name: 'getDependentFilePaths', ops: filePaths.length, run: () => { let n = 0; for (const p of filePaths) n += q.getDependentFilePaths(p).length; return n; } },
  { name: 'getUnresolvedReferencesBatch', ops: 10, run: () => { let n = 0; for (let i = 0; i < 10; i++) n += q.getUnresolvedReferencesBatch(i * 20, 20).length; return n; } },
  { name: 'getAllFiles', ops: 5, run: () => { let n = 0; for (let i = 0; i < 5; i++) n += q.getAllFiles().length; return n; } },
  { name: 'searchNodes_fts', ops: searchNames.length, run: () => { let n = 0; for (const nm of searchNames) n += q.searchNodes(nm.slice(0, 6), { limit: 10 }).length; return n; } },
  { name: 'searchNodes_fallback', ops: 60, run: () => { let n = 0; for (let i = 0; i < 60; i++) n += q.searchNodes(`ymbol${i % 12}`, { limit: 10 }).length; return n; } },
];

function contentOf(run) {
  const value = run();
  return { rows: typeof value === 'number' ? value : Array.isArray(value) ? value.length : 0, digest: digest(value) };
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

conn.close();
try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* scratch */ }

const report = { generated_by: 'scripts/benchmark-db-query.mjs', node: process.version, files: FILES, rounds: ROUNDS, project: { nodes: DATA.nodes.length, edges: DATA.edges.length, files: DATA.files.length }, cases: results };
const text = JSON.stringify(report, null, 2);
console.log(text);
if (OUT) fs.writeFileSync(OUT, text + '\n');
