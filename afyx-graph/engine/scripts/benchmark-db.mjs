#!/usr/bin/env node
/**
 * Micro-benchmark for the persistence core.
 *
 * Builds seeded synthetic graph data (files → nodes → edges, unresolved refs), writes it to
 * scratch SQLite databases with the built library, and times the persistence operations the
 * indexer and the query layer depend on: opening / initializing / reopening, batched and single
 * node and edge writes, file bundles, updates, replace-file cycles, point and batch reads,
 * dependency lookups, and transaction commit / rollback. Every case reports its operation
 * count, timing (median over rounds, microseconds per operation) and a digest of the rows the
 * database ended up holding, so fast-but-wrong (or empty) work cannot pass for a speed-up.
 *
 * usage: node scripts/benchmark-db.mjs [--files N] [--rounds R] [--dist dir] [--out file.json]
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
const ROUNDS = Number(arg('rounds', 7));
const OUT = arg('out', null);
const distRoot = path.resolve(arg('dist', 'dist'));
if (!fs.existsSync(path.join(distRoot, 'db', 'index.js'))) throw new Error('dist/ is not built: run `npm run build:clean` first');

process.env.AFYX_GRAPH_NO_WATCH = '1';
process.env.AFYX_GRAPH_NO_DAEMON = '1';
const require = createRequire(path.join(distRoot, 'x.js'));
const { DatabaseConnection, removeDatabaseFiles } = require(path.join(distRoot, 'db', 'index.js'));
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

// ---- deterministic data -------------------------------------------------------------------------
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
const byFile = new Map();
for (const node of DATA.nodes) (byFile.get(node.filePath) ?? byFile.set(node.filePath, []).get(node.filePath)).push(node);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-dbbench-'));
let counter = 0;
const freshPath = () => path.join(root, `db${counter++}`, 'graph.db');
function populated() {
  const p = freshPath();
  const conn = DatabaseConnection.initialize(p);
  const q = new QueryBuilder(conn.getDb());
  q.insertNodes(DATA.nodes);
  q.insertEdges(DATA.edges);
  q.insertUnresolvedRefsBatch(DATA.refs);
  for (const file of DATA.files) q.upsertFile(file);
  return { p, conn, q };
}
function contentDigest(conn) {
  const db = conn.getDb();
  const one = (sql) => db.prepare(sql).get();
  return digest([
    one('SELECT COUNT(*) n, COUNT(DISTINCT id) d FROM nodes'), one('SELECT COUNT(*) n FROM edges'), one('SELECT COUNT(*) n FROM files'), one('SELECT COUNT(*) n FROM unresolved_refs'),
    db.prepare('SELECT id, kind, name, file_path, start_line, is_exported, updated_at FROM nodes ORDER BY id').all().length,
    db.prepare('SELECT source, target, kind, line, col FROM edges ORDER BY source, target, kind, line, col').all().map((r) => `${r.source}>${r.target}:${r.kind}:${r.line}:${r.col}`),
    db.prepare('SELECT path, content_hash, indexed_at FROM files ORDER BY path').all().map((r) => `${r.path}:${r.content_hash}:${r.indexed_at}`),
  ]);
}

// ---- cases ----------------------------------------------------------------------------------------
// Each case: prepare() builds untimed state and returns { run, ops, result }; run() is timed once per round.
const ids = DATA.nodes.map((n) => n.id);
const CASES = [
  { name: 'init_empty_database', prepare: () => { const p = freshPath(); return { ops: 1, run: () => DatabaseConnection.initialize(p).close(), result: () => { const c = DatabaseConnection.open(p); const d = digest(c.getDb().prepare("SELECT type, name FROM sqlite_master ORDER BY type, name").all().map((r) => `${r.type}:${r.name}`)); c.close(); return { rows: 0, digest: d }; } }; } },
  { name: 'open_existing_database', prepare: () => { const s = populated(); s.conn.close(); let last; return { ops: 20, run: () => { for (let i = 0; i < 20; i++) { const c = DatabaseConnection.open(s.p); last = c.getSchemaVersion().version; c.close(); } }, result: () => ({ rows: DATA.nodes.length, digest: digest(last) }) }; } },
  { name: 'reopen_after_close', prepare: () => { const s = populated(); return { ops: 20, run: () => { let c = s.conn; for (let i = 0; i < 20; i++) { c.close(); c = DatabaseConnection.open(s.p); new QueryBuilder(c.getDb()).getNodeById(ids[i]); } c.close(); }, result: () => ({ rows: DATA.nodes.length, digest: digest(ids.slice(0, 20)) }) }; } },
  { name: 'insert_nodes_batch', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); return { ops: DATA.nodes.length, run: () => q.insertNodes(DATA.nodes), result: () => ({ rows: DATA.nodes.length, digest: contentDigest(c) }), close: () => c.close() }; } },
  { name: 'insert_nodes_single', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); const sample = DATA.nodes.slice(0, 1500); return { ops: sample.length, run: () => { for (const n of sample) q.insertNode(n); }, result: () => ({ rows: sample.length, digest: contentDigest(c) }), close: () => c.close() }; } },
  { name: 'insert_edges_batch', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); q.insertNodes(DATA.nodes); return { ops: DATA.edges.length, run: () => q.insertEdges(DATA.edges), result: () => ({ rows: DATA.edges.length, digest: contentDigest(c) }), close: () => c.close() }; } },
  { name: 'insert_edges_single', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); q.insertNodes(DATA.nodes); const sample = DATA.edges.slice(0, 3000); return { ops: sample.length, run: () => { for (const e of sample) q.insertEdge(e); }, result: () => ({ rows: sample.length, digest: contentDigest(c) }), close: () => c.close() }; } },
  { name: 'store_file_bundles', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); const bundles = DATA.files.map((file) => { const nodes = byFile.get(file.path); const own = new Set(nodes.map((n) => n.id)); return { nodes, edges: DATA.edges.filter((e) => own.has(e.source) && own.has(e.target)), refs: DATA.refs.filter((r) => own.has(r.fromNodeId)), file }; }); return { ops: bundles.length, run: () => { for (const b of bundles) q.storeFileBundle(b); }, result: () => ({ rows: bundles.length, digest: contentDigest(c) }), close: () => c.close() }; } },
  { name: 'upsert_files', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); const files = []; for (let r = 0; r < 12; r++) for (const f of DATA.files) files.push({ ...f, indexedAt: f.indexedAt + r }); return { ops: files.length, run: () => { for (const f of files) q.upsertFile(f); }, result: () => ({ rows: files.length, digest: contentDigest(c) }), close: () => c.close() }; } },
  { name: 'update_nodes', prepare: () => { const s = populated(); const sample = DATA.nodes.slice(0, 2000).map((n) => ({ ...n, docstring: `${n.docstring ?? ''} updated`, updatedAt: n.updatedAt + 1 })); return { ops: sample.length, run: () => { for (const n of sample) s.q.updateNode(n); }, result: () => ({ rows: sample.length, digest: contentDigest(s.conn) }), close: () => s.conn.close() }; } },
  { name: 'replace_file_data', prepare: () => { const s = populated(); const targets = DATA.files.slice(0, 40); return { ops: targets.length, run: () => { for (const file of targets) { const nodes = byFile.get(file.path); const own = new Set(nodes.map((n) => n.id)); s.q.deleteFile(file.path); s.q.storeFileBundle({ nodes, edges: DATA.edges.filter((e) => own.has(e.source) && own.has(e.target)).slice(0, 200), refs: [], file: { ...file, indexedAt: file.indexedAt + 1 } }); } }, result: () => ({ rows: targets.length, digest: contentDigest(s.conn) }), close: () => s.conn.close() }; } },
  { name: 'get_node_by_id', prepare: () => { const s = populated(); let hits = 0; return { ops: ids.length, run: () => { for (const id of ids) if (s.q.getNodeById(id)) hits++; }, result: () => ({ rows: hits, digest: digest(hits) }), close: () => s.conn.close() }; } },
  { name: 'get_nodes_by_ids', prepare: () => { const s = populated(); let total = 0; const chunks = []; for (let i = 0; i < ids.length; i += 250) chunks.push(ids.slice(i, i + 250)); return { ops: chunks.length, run: () => { for (const chunk of chunks) total += s.q.getNodesByIds(chunk).size; }, result: () => ({ rows: total, digest: digest(total) }), close: () => s.conn.close() }; } },
  { name: 'nodes_by_file', prepare: () => { const s = populated(); let total = 0; return { ops: DATA.files.length, run: () => { for (const f of DATA.files) total += s.q.getNodesByFile(f.path).length; }, result: () => ({ rows: total, digest: digest(total) }), close: () => s.conn.close() }; } },
  { name: 'outgoing_edges', prepare: () => { const s = populated(); const sample = ids.filter((_, i) => i % 2 === 0); let total = 0; return { ops: sample.length, run: () => { for (const id of sample) total += s.q.getOutgoingEdges(id).length; }, result: () => ({ rows: total, digest: digest(total) }), close: () => s.conn.close() }; } },
  { name: 'incoming_edges', prepare: () => { const s = populated(); const sample = ids.filter((_, i) => i % 2 === 0); let total = 0; return { ops: sample.length, run: () => { for (const id of sample) total += s.q.getIncomingEdges(id, ['calls', 'references']).length; }, result: () => ({ rows: total, digest: digest(total) }), close: () => s.conn.close() }; } },
  { name: 'dependency_lookup', prepare: () => { const s = populated(); let total = 0; return { ops: DATA.files.length * 2, run: () => { for (const f of DATA.files) total += s.q.getDependencyFilePaths(f.path).length + s.q.getDependentFilePaths(f.path).length; }, result: () => ({ rows: total, digest: digest(total) }), close: () => s.conn.close() }; } },
  { name: 'transaction_commit', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); const groups = []; for (let i = 0; i < 200; i++) groups.push(DATA.nodes.slice(i * 10, i * 10 + 10)); return { ops: groups.length, run: () => { for (const g of groups) c.transaction(() => q.insertNodes(g)); }, result: () => ({ rows: groups.length * 10, digest: contentDigest(c) }), close: () => c.close() }; } },
  { name: 'transaction_rollback', prepare: () => { const c = DatabaseConnection.initialize(freshPath()); const q = new QueryBuilder(c.getDb()); const groups = []; for (let i = 0; i < 200; i++) groups.push(DATA.nodes.slice(i * 10, i * 10 + 10)); let aborted = 0; return { ops: groups.length, run: () => { for (const g of groups) { try { c.transaction(() => { q.insertNodes(g); throw new Error('abort'); }); } catch { aborted++; } } }, result: () => ({ rows: aborted, digest: `${aborted}:${contentDigest(c)}` }), close: () => c.close() }; } },
];

const results = {};
for (const { name, prepare } of CASES) {
  const samples = [];
  let last;
  for (let round = -1; round < ROUNDS; round++) {
    const state = prepare();
    const start = performance.now();
    state.run();
    const elapsed = performance.now() - start;
    if (round >= 0) samples.push((elapsed * 1000) / state.ops);
    last = { ops: state.ops, ...state.result() };
    state.close?.();
  }
  results[name] = { median_us_per_op: Math.round(median(samples) * 100) / 100, spread_us: Math.round((Math.max(...samples) - Math.min(...samples)) * 100) / 100, ops: last.ops, rows: last.rows, digest: last.digest };
}

const sizeProbe = populated();
const dbSizeBytes = sizeProbe.conn.getSize();
const totals = { nodes: DATA.nodes.length, edges: DATA.edges.length, files: DATA.files.length, refs: DATA.refs.length, contentDigest: contentDigest(sizeProbe.conn) };
sizeProbe.conn.close();
const sidecars = ['-wal', '-shm'].map((s) => fs.existsSync(sizeProbe.p + s));
try { removeDatabaseFiles(sizeProbe.p); } catch { /* reported by the sidecar check */ }
try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* scratch */ }

const report = { generated_by: 'scripts/benchmark-db.mjs', node: process.version, files: FILES, rounds: ROUNDS, project: totals, populated_db_bytes: dbSizeBytes, sidecars_after_close: sidecars, cases: results };
const text = JSON.stringify(report, null, 2);
console.log(text);
if (OUT) fs.writeFileSync(OUT, text + '\n');
