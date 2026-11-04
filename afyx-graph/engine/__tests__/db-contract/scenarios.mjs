/**
 * Deterministic persistence scenarios.
 *
 * Plain ESM taking the engine surface as an argument, so the SAME scenarios run
 *   - inside vitest against src/db (the persistence contract),
 *   - from scripts against a built dist/ (the old/new cross-engine matrix and the
 *     real-index write differential).
 *
 * `api` = { DatabaseConnection, QueryBuilder, createDatabase, migrations,
 *           removeDatabaseFiles, resolveWalHealBytes }
 *
 * Normalization (documented, applied only to wall-clock fields the engine stamps
 * itself): schema_versions.applied_at, project_metadata.updated_at and the
 * updated_at of the one node written WITHOUT an explicit updatedAt. Everything
 * else — ids, ordering, autoincrement counters, NULL vs '' — is compared exactly.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const NODE_KINDS = [
  'file', 'module', 'class', 'struct', 'interface', 'trait', 'protocol', 'function', 'method', 'property', 'field', 'variable',
  'constant', 'enum', 'enum_member', 'type_alias', 'namespace', 'parameter', 'import', 'export', 'route', 'component', 'union',
];
const EDGE_KINDS = [
  'contains', 'calls', 'imports', 'exports', 'extends', 'implements', 'references', 'type_of', 'returns', 'instantiates', 'overrides',
  'decorates', 'navigates',
];
const FIXED_TIME = 1_700_000_000_000;

function node(id, kind, name, filePath, extra = {}) {
  return {
    id, kind, name, qualifiedName: `${filePath}::${name}`, filePath, language: 'typescript', startLine: 1, endLine: 2, startColumn: 0,
    endColumn: 1, updatedAt: FIXED_TIME, ...extra,
  };
}
const edge = (source, target, kind, extra = {}) => ({ source, target, kind, ...extra });
const fileRecord = (p, extra = {}) => ({
  path: p, contentHash: `hash-${p}`, language: 'typescript', size: 100, modifiedAt: FIXED_TIME, indexedAt: FIXED_TIME + 5, nodeCount: 0, ...extra,
});
const ref = (fromNodeId, referenceName, referenceKind, line, extra = {}) => ({ fromNodeId, referenceName, referenceKind, line, column: 0, ...extra });

/** The deterministic fixture: every node/edge kind, nullable fields, duplicates, self edges, refs, metadata. */
export function fixtureData() {
  const kindNodes = NODE_KINDS.map((kind, i) => node(`k:${kind}`, kind, `Sym${i}_${kind}`, `src/kinds/${kind}.ts`, {
    startLine: i * 3 + 1, endLine: i * 3 + 2,
    ...(i % 2 === 0 ? { docstring: `doc ${kind}`, signature: `sig(${kind})`, visibility: 'public', isExported: true } : {}),
    ...(i % 3 === 0 ? { isAsync: true, isStatic: true, isAbstract: true } : {}),
    ...(i % 4 === 0 ? { decorators: ['@a', '@b'], typeParameters: ['T', 'U'], returnType: 'string' } : {}),
  }));
  const main = [
    node('m:file', 'file', 'main.ts', 'src/main.ts'),
    node('m:Service', 'class', 'Service', 'src/main.ts', { isExported: true, docstring: 'The service', startLine: 3, endLine: 30 }),
    node('m:run', 'method', 'run', 'src/main.ts', { startLine: 5, endLine: 9, signature: 'run(): void', visibility: 'public', returnType: 'void' }),
    node('m:stop', 'method', 'stop', 'src/main.ts', { startLine: 10, endLine: 12, isAsync: true }),
    node('m:Base', 'class', 'BaseService', 'src/main.ts', { startLine: 32, endLine: 40, isAbstract: true }),
    node('m:Runner', 'interface', 'Runner', 'src/main.ts', { startLine: 42, endLine: 44 }),
    node('u:file', 'file', 'util.ts', 'src/util.ts'),
    node('u:helper', 'function', 'helper', 'src/util.ts', { isExported: true, startLine: 1, endLine: 4 }),
    node('u:inner', 'function', 'inner', 'src/util.ts', { startLine: 6, endLine: 8 }),
    node('u:CONFIG', 'constant', 'CONFIG', 'src/util.ts', { startLine: 10, endLine: 10 }),
    // Unicode, quoting and camelCase names that exercise serialization and the name-segment vocabulary.
    node('u:unicode', 'function', 'ünïcödé_fn', 'src/util.ts', { docstring: "quote ' and \" and \\ and \n newline", startLine: 12, endLine: 13 }),
    node('u:camel', 'function', 'OrderStateMachine', 'src/util.ts', { startLine: 14, endLine: 15 }),
    node('u:import', 'import', 'external-pkg', 'src/util.ts', { startLine: 1, endLine: 1 }),
    // No qualifiedName / line info: defaults to the name and 0.
    { id: 'd:defaults', kind: 'function', name: 'defaults', filePath: 'src/defaults.ts', language: 'typescript', updatedAt: FIXED_TIME },
    // Written without updatedAt: the engine stamps the clock (normalized in dumps).
    { id: 'd:clock', kind: 'function', name: 'clock', filePath: 'src/defaults.ts', language: 'typescript' },
  ];
  const nodes = [...kindNodes, ...main];
  const edges = [
    edge('m:file', 'm:Service', 'contains'), edge('m:file', 'm:Base', 'contains'), edge('m:Service', 'm:run', 'contains'), edge('m:Service', 'm:stop', 'contains'),
    edge('m:Service', 'm:Base', 'extends', { line: 3, column: 0 }), edge('m:Service', 'm:Runner', 'implements', { line: 3, column: 0 }),
    edge('m:run', 'u:helper', 'calls', { line: 6, column: 4 }), edge('m:run', 'm:stop', 'calls', { line: 7, column: 4 }),
    edge('m:stop', 'm:run', 'calls', { line: 11, column: 4 }), edge('u:helper', 'u:inner', 'calls', { line: 2, column: 2 }),
    edge('u:helper', 'u:CONFIG', 'references', { line: 3, column: 2, provenance: 'tree-sitter' }),
    edge('m:run', 'u:helper', 'references', { line: 6, column: 4 }),
    edge('m:run', 'u:helper', 'calls', { line: 8, column: 4 }), edge('m:run', 'u:helper', 'calls', { line: 8, column: 9 }),
    edge('m:run', 'u:helper', 'calls', { line: 6, column: 4 }), // exact duplicate: dropped by OR IGNORE
    edge('m:run', 'm:run', 'calls', { line: 9, column: 1 }), // self edge
    edge('m:Base', 'm:Base', 'references'), // self edge, no coordinates
    edge('m:Base', 'm:Runner', 'implements', { provenance: 'heuristic', metadata: { synthesizedBy: 'go-implements', site: 'a.go:12' } }),
    edge('m:Base', 'm:Runner', 'implements', { provenance: 'scip' }), // same endpoints/kind, no coordinates: distinct by identity
    edge('m:Base', 'm:Runner', 'implements', { provenance: 'scip' }), // duplicate of the previous (NULL coordinates fold)
    edge('m:file', 'u:file', 'imports', { line: 1, column: 0 }), edge('u:file', 'u:import', 'contains'),
    edge('m:run', 'u:CONFIG', 'type_of', { line: 5, column: 0, metadata: { nested: { a: [1, 2, { b: null }] } } }),
    edge('m:run', 'm:Service', 'returns', { line: 5, column: 0 }), edge('m:run', 'm:Service', 'instantiates', { line: 6, column: 0 }),
    edge('m:run', 'u:file', 'navigates', { line: 6, column: 0 }),
    ...EDGE_KINDS.map((kind, i) => edge('k:class', 'k:interface', kind, { line: 100 + i, column: i })),
  ];
  const refs = [
    ref('m:run', 'externalFn', 'calls', 6), ref('m:run', 'externalFn', 'calls', 7), ref('m:stop', 'other.thing', 'references', 11, { candidates: ['a', 'b'] }),
    ref('u:helper', 'util.greet', 'calls', 2, { filePath: 'src/util.ts', language: 'typescript' }), ref('u:helper', 'mod::fn/2', 'calls', 3, { filePath: 'src/util.ts', language: 'erlang' }),
  ];
  const files = [
    fileRecord('src/main.ts', { nodeCount: 6 }), fileRecord('src/util.ts', { nodeCount: 8, generated: true, errors: [{ message: 'parse warning', line: 3 }] }),
    fileRecord('src/kinds/class.ts', { nodeCount: 1 }), fileRecord('src/defaults.ts', { nodeCount: 2, language: 'javascript' }),
  ];
  return { nodes, edges, refs, files };
}

/** Run `fn` with console.error captured (the engine logs and skips malformed nodes). */
function captured(fn) {
  const calls = [];
  const original = console.error;
  console.error = (...args) => { calls.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try { return { result: fn(), logged: calls }; } finally { console.error = original; }
}

const tryRun = (fn) => {
  try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) }; }
};

/** Normalized logical dump of everything persisted, plus the reads the query layer serves from it. */
export function dumpDatabase(api, dbPath) {
  const conn = api.DatabaseConnection.open(dbPath);
  try {
    const db = conn.getDb();
    const q = new api.QueryBuilder(db);
    const all = (sql, ...params) => db.prepare(sql).all(...params).map((row) => ({ ...row }));
    const out = {};
    out.schema = all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'nodes\\_fts\\_%' ESCAPE '\\' ORDER BY type, name")
      .map((row) => ({ ...row, sql: row.sql ? row.sql.replace(/\s+/g, ' ').trim() : null }));
    out.userVersion = db.pragma('user_version', { simple: true });
    out.journalMode = conn.getJournalMode();
    out.schemaVersion = (({ version, description }) => ({ version, description }))(conn.getSchemaVersion());
    out.schemaVersions = all('SELECT version, description FROM schema_versions ORDER BY version');
    out.sequences = all('SELECT name, seq FROM sqlite_sequence ORDER BY name');
    const clock = (row) => (row.id === 'd:clock' ? { ...row, updated_at: 'NOW' } : row);
    out.nodes = all('SELECT * FROM nodes ORDER BY id').map(clock);
    out.edges = all('SELECT * FROM edges ORDER BY id');
    out.files = all('SELECT * FROM files ORDER BY path');
    out.refs = all('SELECT * FROM unresolved_refs ORDER BY id');
    out.metadata = all('SELECT key, value, updated_at FROM project_metadata ORDER BY key').map((row) => ({ ...row, updated_at: 'NOW' }));
    out.vocab = all('SELECT segment, name FROM name_segment_vocab ORDER BY segment, name');
    out.counts = Object.fromEntries(['nodes', 'edges', 'files', 'unresolved_refs', 'project_metadata', 'name_segment_vocab', 'schema_versions']
      .map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
    out.fts = conn.fts5Available
      ? ['service', 'helper', 'Sym0_file', 'clock', 'doc', 'ünïcödé_fn'].map((term) => [term, all('SELECT id FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY rank, id', `"${term.replace(/"/g, '')}"`).map((r) => r.id)])
      : 'no-fts5';
    out.fts5Available = conn.fts5Available;
    // What the query layer sees of the persisted data.
    const ids = out.nodes.map((n) => n.id);
    out.reads = {
      nodeById: ids.map((id) => q.getNodeById(id)).map((n) => (n && n.id === 'd:clock' ? { ...n, updatedAt: 'NOW' } : n)),
      nodesByIds: [...q.getNodesByIds(ids).keys()],
      byFile: ['src/main.ts', 'src/util.ts', 'src/defaults.ts', 'src/missing.ts'].map((f) => q.getNodesByFile(f).map((n) => n.id)),
      byKind: ['class', 'function', 'method', 'file', 'import'].map((k) => q.getNodesByKind(k).map((n) => n.id)),
      outgoing: ids.map((id) => q.getOutgoingEdges(id)), incoming: ids.map((id) => q.getIncomingEdges(id)),
      outgoingCalls: ids.map((id) => q.getOutgoingEdges(id, ['calls', 'references'])),
      incomingHeuristic: ids.map((id) => q.getIncomingEdges(id, ['implements'])),
      allFiles: q.getAllFiles(), file: q.getFileByPath('src/util.ts'), noFile: q.getFileByPath('nope.ts'),
      dependencies: ['src/main.ts', 'src/util.ts'].map((f) => q.getDependencyFilePaths(f)),
      dependents: ['src/main.ts', 'src/util.ts'].map((f) => q.getDependentFilePaths(f)),
      unresolved: q.getUnresolvedReferences(), unresolvedCount: q.getUnresolvedReferencesCount(), unresolvedByName: q.getUnresolvedByName('externalFn'),
      stats: (({ lastUpdated, dbSizeBytes, walSizeBytes, ...rest }) => rest)(q.getStats()), counts: q.getNodeAndEdgeCount(),
      metadata: Object.keys(q.getAllMetadata()).sort().map((k) => [k, q.getMetadata(k)]),
      revision: q.getIndexRevision(), lastIndexedAt: q.getLastIndexedAt(),
      vocabEmpty: q.isNameSegmentVocabEmpty(), distinctNames: q.getDistinctNodeNames(100, 0),
      searchAll: q.searchNodes('service').map((r) => r.node.id), searchHelper: q.searchNodes('helper').map((r) => r.node.id),
    };
    return out;
  } finally {
    conn.close();
  }
}

/** Write the fixture through every public write path. */
export function writeFixture(api, dbPath) {
  const conn = api.DatabaseConnection.initialize(dbPath);
  const q = new api.QueryBuilder(conn.getDb());
  const { nodes, edges, refs, files } = fixtureData();
  const log = [];

  // One file through the bulk bundle path, the rest through the individual paths.
  const byFile = (p) => nodes.filter((n) => n.filePath === p);
  const bundleNodes = byFile('src/main.ts');
  const inBundle = new Set(bundleNodes.map((n) => n.id));
  q.storeFileBundle({
    nodes: bundleNodes,
    edges: edges.filter((e) => inBundle.has(e.source) && inBundle.has(e.target)),
    refs: refs.filter((r) => r.fromNodeId === 'm:run' || r.fromNodeId === 'm:stop'),
    file: files[0],
  });
  const rest = nodes.filter((n) => !inBundle.has(n.id));
  const singleIds = new Set(['d:defaults', 'd:clock', 'k:file', 'k:module', 'u:unicode']);
  const single = rest.filter((n) => singleIds.has(n.id)); const batch = rest.filter((n) => !singleIds.has(n.id));
  for (const n of single) q.insertNode(n);
  q.insertNodes(batch);
  const done = new Set([...inBundle]);
  const remaining = edges.filter((e) => !(inBundle.has(e.source) && inBundle.has(e.target)));
  // Endpoint-filtered batch, then single inserts (one of which names a missing node).
  // Every fifth edge is written singly; the rest as one endpoint-filtered batch.
  q.insertEdges(remaining.filter((_, i) => i % 5 !== 0));
  for (const e of remaining.filter((_, i) => i % 5 === 0)) q.insertEdge(e);
  q.insertEdge(edge('m:stop', 'u:CONFIG', 'references', { line: 3, column: 7, provenance: 'scip', metadata: { via: 'single', list: [1, 'two'] } }));
  q.insertEdge(edge('m:stop', 'u:CONFIG', 'references', { line: 3, column: 7, provenance: 'heuristic' })); // duplicate identity: ignored
  q.insertEdges([edge('m:stop', 'u:inner', 'calls', { line: 20, column: 1 }), edge('m:stop', 'u:inner', 'calls', { line: 20, column: 1 })]); // duplicate inside one batch
  log.push(['insertEdge missing target', tryRun(() => q.insertEdge(edge('m:run', 'ghost', 'calls', { line: 1, column: 1 })))]);
  log.push(['insertEdges missing endpoint', tryRun(() => q.insertEdges([edge('ghost', 'm:run', 'calls', { line: 1, column: 1 }), edge('m:run', 'm:stop', 'references', { line: 50, column: 0 })]))]);
  q.insertUnresolvedRef(refs[2]);
  q.insertUnresolvedRefsBatch(refs.slice(3));
  for (const f of files.slice(1)) q.upsertFile(f);
  q.setMetadata('project_root', '/scratch/project');
  q.setMetadata('indexed_with', 'contract-fixture');
  q.setMetadata('project_root', '/scratch/project-2'); // overwrite
  log.push(['skips malformed node', captured(() => {
    q.insertNode({ id: '', kind: 'function', name: 'bad', filePath: 'x.ts', language: 'typescript' });
    q.insertNodes([{ id: 'bad2', kind: 'function', name: '', filePath: 'x.ts', language: 'typescript' }, node('ok:1', 'function', 'okNode', 'src/ok.ts')]);
    q.updateNode({ id: 'ok:1', kind: 'function', name: '', filePath: 'src/ok.ts', language: 'typescript' });
  }).logged.length]);
  done.clear();
  conn.close();
  return log;
}

/** Nine deterministic mutation scenarios applied to an existing database (write differential). */
export function mutationScenarios(api, dbPath) {
  const conn = api.DatabaseConnection.open(dbPath);
  const q = new api.QueryBuilder(conn.getDb());
  const steps = [];
  // After every step, a digest of everything persisted (wall-clock columns excluded), so a step's
  // effect is pinned even when a later step overwrites it.
  const tables = [
    ["SELECT * FROM nodes WHERE id != 'd:clock' ORDER BY id"], ['SELECT * FROM edges ORDER BY id'], ['SELECT * FROM files ORDER BY path'],
    ['SELECT * FROM unresolved_refs ORDER BY id'], ['SELECT key, value FROM project_metadata ORDER BY key'], ['SELECT * FROM name_segment_vocab ORDER BY segment, name'],
  ];
  const snapshot = () => digest(tables.map(([sql]) => conn.getDb().prepare(sql).all().map((row) => ({ ...row }))));
  const step = (name, fn) => { const r = tryRun(fn); steps.push([name, r.ok ? 'ok' : r.error, snapshot()]); };
  const T = FIXED_TIME + 1000;

  step('add file', () => {
    q.storeFileBundle({
      nodes: [node('n:file', 'file', 'added.ts', 'src/added.ts', { updatedAt: T }), node('n:fn', 'function', 'addedFn', 'src/added.ts', { updatedAt: T, startLine: 2, endLine: 4 })],
      edges: [edge('n:file', 'n:fn', 'contains')], refs: [ref('n:fn', 'unknownThing', 'calls', 3, { filePath: 'src/added.ts', language: 'typescript' })],
      file: fileRecord('src/added.ts', { nodeCount: 2, indexedAt: T }),
    });
  });
  step('replace file', () => {
    q.deleteFile('src/added.ts');
    q.storeFileBundle({
      nodes: [node('n:file', 'file', 'added.ts', 'src/added.ts', { updatedAt: T + 1 }), node('n:fn2', 'function', 'addedFnRenamed', 'src/added.ts', { updatedAt: T + 1, startLine: 2, endLine: 5 })],
      edges: [edge('n:file', 'n:fn2', 'contains'), edge('n:fn2', 'n:fn2', 'references', { line: 4, column: 2 })], refs: [],
      file: fileRecord('src/added.ts', { nodeCount: 2, indexedAt: T + 1, contentHash: 'rehash' }),
    });
  });
  step('upsert existing file', () => { q.upsertFile(fileRecord('src/main.ts', { contentHash: 'changed', indexedAt: T + 9, size: 999, nodeCount: 7, generated: true, errors: [{ message: 'again' }] })); });
  step('update nodes', () => {
    q.updateNode(node('m:run', 'method', 'runRenamed', 'src/main.ts', { updatedAt: T + 2, startLine: 5, endLine: 9, docstring: 'renamed', isExported: true }));
    q.updateNode(node('u:helper', 'function', 'helper', 'src/util.ts', { updatedAt: T + 2, decorators: ['@x'], typeParameters: ['K', 'V'], returnType: 'Map<K, V>', signature: 's', visibility: 'private', isStatic: true, isAbstract: true }));
    q.updateNode({ id: 'u:CONFIG', kind: 'constant', name: 'CONFIG', filePath: 'src/util.ts', language: 'typescript', updatedAt: T + 2 });
  });
  step('update edges', () => {
    q.deleteEdgesBySource('m:stop');
    q.insertEdges([edge('m:stop', 'u:helper', 'calls', { line: 12, column: 2 }), edge('m:stop', 'u:inner', 'references', { provenance: 'heuristic', metadata: { by: 'scenario' } })]);
  });
  step('delete and reinsert file data', () => {
    q.deleteNodesByFile('src/util.ts');
    q.insertNodes([node('u:file', 'file', 'util.ts', 'src/util.ts', { updatedAt: T + 3 }), node('u:helper', 'function', 'helper', 'src/util.ts', { updatedAt: T + 3, isExported: true })]);
    q.upsertFile(fileRecord('src/util.ts', { nodeCount: 2, indexedAt: T + 3, generated: false }));
  });
  step('metadata update', () => { q.setMetadata('project_root', '/scratch/updated'); q.setMetadata('scenario', 'metadata'); });
  step('transaction rollback', () => {
    try {
      conn.transaction(() => {
        q.insertNodes([node('r:1', 'function', 'rolledBack', 'src/rb.ts', { updatedAt: T + 4 })]);
        q.upsertFile(fileRecord('src/rb.ts', { indexedAt: T + 4 }));
        throw new Error('forced rollback');
      });
    } catch (error) {
      if (error.message !== 'forced rollback') throw error;
    }
  });
  step('transaction commit', () => {
    conn.transaction(() => {
      q.insertNodes([node('c:1', 'function', 'committed', 'src/cm.ts', { updatedAt: T + 5 })]);
      q.upsertFile(fileRecord('src/cm.ts', { indexedAt: T + 5, nodeCount: 1 }));
      q.setMetadata('scenario', 'committed');
    });
  });
  step('bundle atomicity', () => {
    q.storeFileBundle({
      nodes: [node('b:1', 'function', 'bundleOnly', 'src/bundle.ts', { updatedAt: T + 6 })], edges: [],
      refs: [ref('no-such-node', 'boom', 'calls', 1)], file: fileRecord('src/bundle.ts', { indexedAt: T + 6 }),
    });
  });
  step('resolution churn', () => {
    q.insertUnresolvedRefsBatch([ref('m:run', 'pkg.util.tail', 'calls', 20, { filePath: 'src/main.ts', language: 'typescript' }), ref('m:run', 'ns::name/3', 'calls', 21, { filePath: 'src/main.ts', language: 'erlang' })]);
    const pending = q.getUnresolvedReferences();
    const key = (r) => ({ fromNodeId: r.fromNodeId, referenceName: r.referenceName, referenceKind: r.referenceKind });
    q.markReferencesFailed(pending.filter((r) => ['util.greet', 'other.thing', 'pkg.util.tail'].includes(r.referenceName)).map(key));
    const rows = conn.getDb().prepare("SELECT id, reference_name FROM unresolved_refs WHERE reference_name IN ('mod::fn/2', 'ns::name/3')").all();
    q.markReferencesFailedByRowIds(rows.map((r) => ({ rowId: r.id, referenceName: r.reference_name })));
    q.deleteSpecificResolvedReferences(pending.filter((r) => r.referenceName === 'externalFn').slice(0, 1).map(key));
    q.deleteReferencesByRowIds(conn.getDb().prepare("SELECT id FROM unresolved_refs WHERE reference_name = 'externalFn'").all().map((r) => r.id));
  });
  step('replace resolution edges atomically', () => {
    const ids = conn.getDb().prepare("SELECT id FROM edges WHERE kind = 'calls' ORDER BY id LIMIT 2").all().map((r) => r.id);
    q.replaceResolutionEdgesWithUnresolvedRefs(ids, [ref('m:run', 'restored', 'calls', 1, { filePath: 'src/main.ts', language: 'typescript' }), ref('no-such-node', 'boom', 'calls', 1)]);
  });
  step('replace resolution edges', () => {
    const ids = conn.getDb().prepare("SELECT id FROM edges WHERE kind = 'calls' ORDER BY id LIMIT 1").all().map((r) => r.id);
    q.replaceResolutionEdgesWithUnresolvedRefs(ids, [ref('m:run', 'restoredOk', 'calls', 2, { filePath: 'src/main.ts', language: 'typescript' })]);
    q.deleteEdgesByIds(conn.getDb().prepare("SELECT id FROM edges WHERE kind = 'contains' ORDER BY id LIMIT 1").all().map((r) => r.id));
  });
  step('delete refs of one node', () => { q.deleteUnresolvedByNode('m:run'); });
  step('delete file cascade', () => { q.deleteFile('src/kinds/class.ts'); q.deleteNode('m:stop'); });
  conn.close();
  return steps;
}

/** Connection lifecycle and transaction behaviour, recorded as plain data. */
export function lifecycleRecord(api, dir) {
  const rec = {};
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'life', 'graph.db');

  // Create empty, initialize schema, reopen, close.
  const c1 = api.DatabaseConnection.initialize(p);
  rec.initialized = { open: c1.isOpen(), backend: c1.getBackend(), fts5: c1.fts5Available, journal: c1.getJournalMode(), path: path.basename(c1.getPath()), version: (({ version, description }) => ({ version, description }))(c1.getSchemaVersion()) };
  rec.emptySizePositive = c1.getSize() > 0;
  rec.walAutocheckpoint = c1.getWalAutocheckpoint();
  rec.pragmas = Object.fromEntries(['busy_timeout', 'foreign_keys', 'synchronous', 'cache_size', 'temp_store', 'mmap_size', 'journal_size_limit', 'journal_mode'].map((k) => [k, c1.getDb().pragma(k, { simple: true })]));
  c1.setWalAutocheckpoint(0); rec.walAutocheckpointDisabled = c1.getWalAutocheckpoint();
  c1.setWalAutocheckpoint(-5); rec.walAutocheckpointClamped = c1.getWalAutocheckpoint();
  c1.close();
  rec.afterClose = { open: c1.isOpen(), sidecars: ['-wal', '-shm'].map((s) => fs.existsSync(p + s)) };
  rec.doubleClose = tryRun(() => c1.close());
  rec.useAfterClose = tryRun(() => c1.getDb().prepare('SELECT 1').get()).ok;
  // Initializing over an existing database fails on the duplicate schema_versions row. Done on a
  // copy: the historical engine leaves the half-initialized connection open on that failure.
  const existing = path.join(dir, 'life-existing', 'graph.db');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.copyFileSync(p, existing);
  rec.initializeExisting = tryRun(() => { const c = api.DatabaseConnection.initialize(existing); c.close(); return 'initialized'; });
  const c2 = api.DatabaseConnection.open(p);
  rec.reopen = { open: c2.isOpen(), version: c2.getSchemaVersion().version, journal: c2.getJournalMode() };
  const q2 = new api.QueryBuilder(c2.getDb());
  q2.insertNode(node('life:1', 'function', 'lifeFn', 'src/life.ts'));
  c2.close();
  const c3 = api.DatabaseConnection.open(p);
  rec.persistedAcrossReopen = new api.QueryBuilder(c3.getDb()).getNodeById('life:1')?.name ?? null;

  // Transactions: commit value, rollback on throw with rethrow, nesting flattens.
  const db = c3.getDb();
  const q3 = new api.QueryBuilder(db);
  rec.txReturn = c3.transaction(() => { q3.insertNode(node('tx:1', 'function', 'txOne', 'src/tx.ts')); return 42; });
  rec.txRollback = tryRun(() => c3.transaction(() => { q3.insertNode(node('tx:2', 'function', 'txTwo', 'src/tx.ts')); throw new Error('boom'); }));
  rec.txRolledBackAbsent = q3.getNodeById('tx:2') === null;
  rec.txNested = tryRun(() => c3.transaction(() => {
    q3.insertNode(node('tx:3', 'function', 'txThree', 'src/tx.ts'));
    try { c3.transaction(() => { q3.insertNode(node('tx:4', 'function', 'txFour', 'src/tx.ts')); throw new Error('inner'); }); } catch { /* swallowed by the outer body */ }
    return 'outer-done';
  }));
  rec.txNestedPersisted = ['tx:3', 'tx:4'].map((id) => q3.getNodeById(id) !== null);
  rec.txNestedOuterFails = tryRun(() => c3.transaction(() => { c3.transaction(() => { q3.insertNode(node('tx:5', 'function', 'txFive', 'src/tx.ts')); }); throw new Error('outer'); }));
  rec.txNestedOuterFailsPersisted = q3.getNodeById('tx:5') !== null;
  rec.txReusableAfterFailure = tryRun(() => c3.transaction(() => 'ok')).ok;
  rec.txArgs = db.transaction((a, b) => a + b)(2, 3);

  // Bulk windows drop and recreate secondary indexes and triggers; a crashed window heals on open.
  const idx = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx\\_%' ESCAPE '\\' ORDER BY name").all().map((r) => r.name);
  const triggers = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((r) => r.name);
  rec.bulk = { indexes: idx(), triggers: triggers() };
  c3.beginBulkNodeLoad(); rec.bulk.triggersDropped = triggers();
  q3.insertNodes([node('bulk:1', 'function', 'bulkWindowFn', 'src/bulk.ts')]);
  rec.bulk.ftsDuringWindow = db.prepare('SELECT id FROM nodes_fts WHERE nodes_fts MATCH ?').all('bulkWindowFn').map((r) => r.id);
  c3.endBulkNodeLoad(); rec.bulk.triggersRestored = triggers();
  rec.bulk.ftsAfterWindow = db.prepare('SELECT id FROM nodes_fts WHERE nodes_fts MATCH ?').all('bulkWindowFn').map((r) => r.id);
  c3.beginBulkParseLoad(); rec.bulk.parseDropped = idx();
  c3.beginBulkRefLoad(); c3.beginBulkEdgeLoad();
  rec.bulk.identityKept = idx().includes('idx_edges_identity');
  c3.close();
  const c4 = api.DatabaseConnection.open(p);
  rec.bulk.healedIndexes = c4.getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx\\_%' ESCAPE '\\' ORDER BY name").all().map((r) => r.name);
  rec.bulk.healedTriggers = c4.getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((r) => r.name);
  c4.getDb().exec('DROP TRIGGER nodes_ai');
  c4.close();
  const c5 = api.DatabaseConnection.open(p);
  rec.bulk.triggerHealedOnOpen = c5.getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((r) => r.name);
  rec.ftsAfterHeal = c5.getDb().prepare('SELECT id FROM nodes_fts WHERE nodes_fts MATCH ?').all('lifeFn').map((r) => r.id);
  // clear() empties every table and the node cache.
  const cq = new api.QueryBuilder(c5.getDb());
  const fx = fixtureData();
  cq.insertNodes(fx.nodes.slice(0, 30)); cq.insertEdges(fx.edges.slice(0, 10)); cq.upsertFile(fx.files[0]); cq.insertUnresolvedRef(fx.refs[0]);
  cq.getNodeById('m:run');
  const tally = () => ({ ...c5.getDb().prepare('SELECT (SELECT COUNT(*) FROM nodes) n, (SELECT COUNT(*) FROM edges) e, (SELECT COUNT(*) FROM files) f, (SELECT COUNT(*) FROM unresolved_refs) r').get() });
  rec.clearBefore = tally();
  cq.clear();
  rec.clearAfter = tally();
  rec.clearCacheDropped = cq.getNodeById('m:run');
  rec.optimize = tryRun(() => { c5.optimize(); return 'ok'; }).ok;
  rec.walSizeNumber = typeof c5.getWalSizeBytes();
  rec.dbSizeNumber = c5.getDbFileSizeBytes() > 0;
  rec.replacedOnDisk = c5.isReplacedOnDisk();
  c5.close();

  // Sidecar cleanup and removal (including sidecars a killed process left behind).
  fs.writeFileSync(p + '-wal', 'stale'); fs.writeFileSync(p + '-shm', 'stale');
  api.removeDatabaseFiles(p);
  rec.removed = [p, p + '-wal', p + '-shm'].map((f) => fs.existsSync(f));
  rec.removeMissing = tryRun(() => { api.removeDatabaseFiles(p); return 'ok'; }).ok;

  // Errors.
  rec.openMissing = tryRun(() => api.DatabaseConnection.open(path.join(dir, 'life', 'none.db'))).error?.replace(dir, '<dir>').replace(/\\/g, '/');
  const bad = path.join(dir, 'life', 'garbage.db');
  fs.writeFileSync(bad, 'this is not a sqlite database at all'.repeat(40));
  rec.openGarbage = (() => { const r = tryRun(() => { const c = api.DatabaseConnection.open(bad); c.close(); }); return { threw: !r.ok, notADatabase: !r.ok && /not a database/i.test(r.error) }; })();
  rec.healWalBytes = [undefined, '', 'abc', '0', '-3', '2', '0.5', '1e2'].map((v) => api.resolveWalHealBytes(v));
  rec.nestedDirCreated = fs.existsSync(path.join(dir, 'life'));
  return rec;
}

/** Older-schema databases reopen and migrate, keeping data. */
export function migrationRecord(api, dir) {
  const rec = {};
  const p = path.join(dir, 'migr', 'old.db');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const c = api.DatabaseConnection.initialize(p);
  const db = c.getDb();
  const q = new api.QueryBuilder(db);
  const { nodes } = fixtureData();
  q.insertNodes(nodes.slice(0, 30));
  // Simulate a pre-v6 database: no identity index, duplicate edge rows, recorded version 5.
  db.exec('DROP INDEX idx_edges_identity');
  for (const [s, t, k, l] of [['m:run', 'm:stop', 'calls', 7], ['m:run', 'm:stop', 'calls', 7], ['m:run', 'm:stop', 'calls', null], ['m:run', 'm:stop', 'calls', null]]) {
    db.prepare('INSERT INTO edges (source, target, kind, line, col) VALUES (?, ?, ?, ?, NULL)').run(s, t, k, l);
  }
  db.exec("INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (5, 1, 'simulated')");
  db.exec('DELETE FROM schema_versions WHERE version > 5');
  rec.versionBefore = c.getSchemaVersion().version;
  rec.pending = api.migrations.getPendingMigrations(db).map((m) => m.version);
  rec.needs = api.migrations.needsMigration(db);
  c.close();
  const c2 = api.DatabaseConnection.open(p);
  const db2 = c2.getDb();
  rec.versionAfter = c2.getSchemaVersion().version;
  rec.history = api.migrations.getMigrationHistory(db2).map((h) => [h.version, h.description]);
  rec.edgesAfterDedup = db2.prepare('SELECT source, target, kind, line, col FROM edges ORDER BY id').all().map((r) => ({ ...r }));
  rec.identityIndex = db2.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_edges_identity'").get()?.sql.replace(/\s+/g, ' ');
  rec.nodesKept = db2.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  rec.needsAfter = api.migrations.needsMigration(db2);
  rec.currentVersion = api.migrations.CURRENT_SCHEMA_VERSION;
  // Version probes on an empty or missing version table.
  const probe = api.createDatabase(path.join(dir, 'migr', 'probe.db')).db;
  rec.versionNoTable = api.migrations.getCurrentVersion(probe);
  probe.exec('CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT)');
  rec.versionEmpty = api.migrations.getCurrentVersion(probe);
  probe.close();
  // Re-running from an older recorded version is idempotent for the guarded migrations.
  db2.exec('DELETE FROM schema_versions WHERE version >= 8');
  c2.close();
  const c3 = api.DatabaseConnection.open(p);
  rec.rerun = c3.getDb().prepare('SELECT version FROM schema_versions ORDER BY version').all().map((r) => r.version);
  c3.close();

  // A version-2 database: no lower(name) index, no return_type column, the narrow edge indexes still present.
  const p2 = path.join(dir, 'migr', 'v2.db');
  const d = api.DatabaseConnection.initialize(p2);
  const ddb = d.getDb();
  new api.QueryBuilder(ddb).insertNodes(nodes.slice(0, 5));
  ddb.exec('DROP INDEX idx_nodes_lower_name; ALTER TABLE nodes DROP COLUMN return_type; CREATE INDEX idx_edges_source ON edges(source); CREATE INDEX idx_edges_target ON edges(target);');
  ddb.exec("INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (2, 1, 'simulated')");
  ddb.exec('DELETE FROM schema_versions WHERE version > 2');
  rec.v2Pending = api.migrations.getPendingMigrations(ddb).map((m) => m.version);
  d.close();
  const d2 = api.DatabaseConnection.open(p2);
  const list = (sql) => d2.getDb().prepare(sql).all().map((r) => ({ ...r }));
  rec.v2Indexes = list("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND (name LIKE 'idx%nodes%' OR name LIKE 'idx%edges%') ORDER BY name").map((r) => ({ name: r.name, sql: r.sql && r.sql.replace(/\s+/g, ' ') }));
  rec.v2Columns = list('PRAGMA table_info(nodes)').map((r) => r.name);
  rec.v2Version = d2.getSchemaVersion().version;
  rec.v2Nodes = d2.getDb().prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  d2.close();
  return rec;
}

/** The adapter surface: statements, pragma, read-only, iterate, transaction depth. */
export function adapterRecord(api, dir) {
  const rec = {};
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'adapter.db');
  const { db, backend } = api.createDatabase(p);
  rec.backend = backend;
  rec.open = db.open;
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b INTEGER)');
  const ins = db.prepare('INSERT INTO t (a, b) VALUES (@a, @b)');
  const r1 = ins.run({ a: 'x', b: 1 });
  const r2 = db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run('y', 2);
  rec.run = [{ changes: r1.changes, id: Number(r1.lastInsertRowid) }, { changes: r2.changes, id: Number(r2.lastInsertRowid) }];
  rec.updateChanges = db.prepare('UPDATE t SET b = b + 1').run().changes;
  rec.getRow = { ...db.prepare('SELECT * FROM t WHERE id = ?').get(1) };
  rec.getMissing = db.prepare('SELECT * FROM t WHERE id = ?').get(99) === undefined;
  rec.all = db.prepare('SELECT * FROM t ORDER BY id').all().map((r) => ({ ...r }));
  rec.iterate = [...db.prepare('SELECT a FROM t ORDER BY id').iterate()].map((r) => r.a);
  rec.pragmaWrite = db.pragma('cache_size = -2000');
  rec.pragmaRead = db.pragma('cache_size');
  rec.pragmaSimple = db.pragma('cache_size', { simple: true });
  rec.pragmaJournal = db.pragma('journal_mode');
  rec.txValue = db.transaction((x) => x * 2)(21);
  rec.txRollback = tryRun(() => db.transaction(() => { db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run('z', 3); throw new Error('nope'); })());
  rec.afterRollback = db.prepare('SELECT COUNT(*) AS n FROM t').get().n;
  rec.txNestedFlat = db.transaction(() => db.transaction(() => db.transaction(() => 'deep')())())();
  rec.txAfterError = tryRun(() => db.transaction(() => { db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run('w', 4); return 'fine'; })()).ok;
  rec.sqlError = tryRun(() => db.prepare('SELECT * FROM missing_table').all()).ok;
  db.close();
  rec.closedOpen = db.open;
  rec.closeAgain = tryRun(() => db.close()).ok;
  const ro = api.createDatabase(p, { readOnly: true });
  rec.readOnlyRead = ro.db.prepare('SELECT COUNT(*) AS n FROM t').get().n;
  rec.readOnlyWrite = tryRun(() => ro.db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run('q', 1)).ok;
  ro.db.close();
  return rec;
}

/** How many transactions each public write starts when called on its own: the atomic boundaries. */
export function transactionCounts(api, dir) {
  const p = path.join(dir, 'tx-counts', 'graph.db');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const conn = api.DatabaseConnection.initialize(p);
  const db = conn.getDb();
  const q = new api.QueryBuilder(db);
  const { nodes, edges, refs, files } = fixtureData();
  q.insertNodes(nodes.slice(0, 30));
  q.insertEdges(edges.filter((e) => nodes.slice(0, 30).some((n) => n.id === e.source) && nodes.slice(0, 30).some((n) => n.id === e.target)).slice(0, 4));
  q.insertUnresolvedRefsBatch(refs.slice(0, 3));
  q.upsertFile(files[0]);
  let count = 0;
  const original = db.transaction.bind(db);
  db.transaction = (fn) => { count++; return original(fn); };
  const counts = {};
  const measure = (name, fn) => { count = 0; try { fn(); } catch { /* counted anyway */ } counts[name] = count; };
  const N = (id) => node(id, 'function', id, 'src/tx.ts');
  const key = (r) => ({ fromNodeId: r.fromNodeId, referenceName: r.referenceName, referenceKind: r.referenceKind });
  measure('insertNode', () => q.insertNode(N('t1')));
  measure('insertNodes', () => q.insertNodes([N('t2'), N('t3')]));
  measure('insertNodes empty', () => q.insertNodes([]));
  measure('updateNode', () => q.updateNode(N('t1')));
  measure('deleteNode', () => q.deleteNode('t3'));
  measure('deleteNodesByFile', () => q.deleteNodesByFile('src/nothing.ts'));
  measure('insertEdge', () => q.insertEdge(edge('t1', 't2', 'calls', { line: 1, column: 0 })));
  measure('insertEdges', () => q.insertEdges([edge('t2', 't1', 'calls', { line: 2, column: 0 })]));
  measure('insertEdges empty', () => q.insertEdges([]));
  measure('deleteEdgesBySource', () => q.deleteEdgesBySource('t1'));
  measure('deleteEdgesByIds', () => q.deleteEdgesByIds([1, 2, 3]));
  measure('deleteEdgesByIds empty', () => q.deleteEdgesByIds([]));
  measure('upsertFile', () => q.upsertFile(fileRecord('src/tx.ts')));
  measure('deleteFile', () => q.deleteFile('src/tx.ts'));
  measure('insertUnresolvedRef', () => q.insertUnresolvedRef(ref('t1', 'x', 'calls', 1)));
  measure('insertUnresolvedRefsBatch', () => q.insertUnresolvedRefsBatch([ref('t1', 'y', 'calls', 2)]));
  measure('insertUnresolvedRefsBatch empty', () => q.insertUnresolvedRefsBatch([]));
  measure('deleteUnresolvedByNode', () => q.deleteUnresolvedByNode('t1'));
  measure('deleteResolvedReferences', () => q.deleteResolvedReferences(['t1', 't2']));
  measure('deleteSpecificResolvedReferences', () => q.deleteSpecificResolvedReferences([key(ref('t1', 'x', 'calls', 1))]));
  measure('deleteReferencesByRowIds', () => q.deleteReferencesByRowIds([1, 2]));
  measure('markReferencesFailed', () => q.markReferencesFailed([key(ref('t1', 'x', 'calls', 1))]));
  measure('markReferencesFailedByRowIds', () => q.markReferencesFailedByRowIds([{ rowId: 1, referenceName: 'x' }]));
  measure('replaceResolutionEdges', () => q.replaceResolutionEdgesWithUnresolvedRefs([1], [ref('t1', 'z', 'calls', 3)]));
  measure('storeFileBundle', () => q.storeFileBundle({ nodes: [N('t4')], edges: [], refs: [ref('t4', 'w', 'calls', 1)], file: fileRecord('src/tx4.ts') }));
  measure('insertNameSegmentsBatch', () => q.insertNameSegmentsBatch(['someName', 'otherName']));
  measure('clearNameSegmentVocab', () => q.clearNameSegmentVocab());
  measure('setMetadata', () => q.setMetadata('k', 'v'));
  measure('clear', () => q.clear());
  measure('connection.transaction', () => conn.transaction(() => 1));
  db.transaction = original;
  conn.close();
  return counts;
}

/** The read cache must never serve a row a write has changed or removed. */
export function cacheRecord(api, dir) {
  const p = path.join(dir, 'cache', 'graph.db');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const conn = api.DatabaseConnection.initialize(p);
  const q = new api.QueryBuilder(conn.getDb());
  const rec = {};
  const name = (id) => q.getNodeById(id)?.name ?? null;
  q.insertNodes([node('c1', 'function', 'first', 'src/c.ts'), node('c2', 'function', 'second', 'src/c.ts'), node('c3', 'function', 'third', 'src/d.ts'), node('c4', 'function', 'fourth', 'src/d.ts')]);
  ['c1', 'c2', 'c3', 'c4'].forEach((id) => name(id)); // warm the cache
  q.updateNode(node('c1', 'function', 'first-updated', 'src/c.ts'));
  rec.afterUpdate = name('c1');
  q.insertNode(node('c2', 'function', 'second-replaced', 'src/c.ts'));
  rec.afterReplaceOne = name('c2');
  q.insertNodes([node('c3', 'function', 'third-replaced', 'src/d.ts')]);
  rec.afterReplaceMany = name('c3');
  q.deleteNode('c1');
  rec.afterDelete = name('c1');
  q.deleteNodesByFile('src/c.ts');
  rec.afterDeleteFile = [name('c2'), name('c3')];
  q.updateNode({ id: 'c4', kind: 'function', name: '', filePath: 'src/d.ts', language: 'typescript' }); // rejected, but the cache entry is dropped
  rec.afterRejectedUpdate = name('c4');
  q.storeFileBundle({ nodes: [node('c5', 'function', 'bundled', 'src/e.ts')], edges: [], refs: [], file: fileRecord('src/e.ts') });
  name('c5');
  q.deleteFile('src/e.ts');
  rec.afterDeleteFileRecord = name('c5');
  name('c3'); name('c4');
  q.clear();
  rec.afterClear = [name('c3'), name('c4')];
  rec.byIdsAfterClear = [...q.getNodesByIds(['c3', 'c4']).keys()];
  conn.close();
  return rec;
}

/** Bulk windows and WAL upkeep, which are asynchronous. */
export async function asyncRecord(api, dir) {
  const p = path.join(dir, 'async', 'graph.db');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const conn = api.DatabaseConnection.initialize(p);
  const db = conn.getDb();
  const names = (type) => db.prepare(`SELECT name FROM sqlite_master WHERE type = '${type}' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`).all().map((r) => r.name);
  const rec = { initial: names('index') };
  conn.beginBulkParseLoad();
  rec.parseWindow = names('index');
  await conn.endBulkParseLoad();
  rec.afterParse = names('index');
  conn.beginBulkRefLoad();
  rec.refWindow = names('index');
  await conn.endBulkRefLoad();
  rec.afterRef = names('index');
  conn.beginBulkEdgeLoad();
  rec.edgeWindow = names('index');
  await conn.endBulkEdgeLoad();
  rec.afterEdge = names('index');
  rec.schemaIntact = (({ sql }) => sql)(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_files_generated'").get());
  const passive = await conn.checkpointWalPassive();
  const truncate = await conn.checkpointWalTruncate();
  rec.checkpointShapes = [passive, truncate].map((r) => (r === null ? null : ['busy', 'log', 'checkpointed'].map((k) => typeof r[k])));
  rec.maintenance = await conn.runMaintenance().then(() => 'done');
  rec.heal = await conn.healOversizedWal().then((r) => ({ healed: r.healed, sameSize: r.beforeBytes === r.afterBytes }));
  conn.close();
  return rec;
}

/** Everything the contract compares, in one deterministic structure. */
export function computeDbContract(api, dir) {
  const out = {};
  const fixturePath = path.join(dir, 'fixture', 'graph.db');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  out.fixtureLog = writeFixture(api, fixturePath);
  out.fixture = dumpDatabase(api, fixturePath);
  out.fixtureSidecarsAfterClose = ['-wal', '-shm'].map((s) => fs.existsSync(fixturePath + s));
  const mutPath = path.join(dir, 'mutated.db');
  fs.copyFileSync(fixturePath, mutPath);
  out.mutationSteps = mutationScenarios(api, mutPath);
  out.mutated = dumpDatabase(api, mutPath);
  out.lifecycle = lifecycleRecord(api, dir);
  out.migration = migrationRecord(api, dir);
  out.adapter = adapterRecord(api, dir);
  out.transactions = transactionCounts(api, dir);
  out.cache = cacheRecord(api, dir);
  return out;
}

/** Rows written by different write paths must be indistinguishable (bundle vs individual). */
export function pathEquivalence(api, dir) {
  const { nodes, edges, refs, files } = fixtureData();
  const main = nodes.filter((n) => n.filePath === 'src/main.ts');
  const ids = new Set(main.map((n) => n.id));
  const inFile = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const pa = path.join(dir, 'eq-a.db'); const pb = path.join(dir, 'eq-b.db');
  const ca = api.DatabaseConnection.initialize(pa); const qa = new api.QueryBuilder(ca.getDb());
  qa.storeFileBundle({ nodes: main, edges: inFile, refs: refs.slice(0, 2), file: files[0] }); ca.close();
  const cb = api.DatabaseConnection.initialize(pb); const qb = new api.QueryBuilder(cb.getDb());
  for (const n of main) qb.insertNode(n);
  qb.insertEdges(inFile); for (const r of refs.slice(0, 2)) qb.insertUnresolvedRef(r); qb.upsertFile(files[0]); cb.close();
  const a = dumpDatabase(api, pa); const b = dumpDatabase(api, pb);
  return { same: digest([a.nodes, a.edges, a.files, a.refs, a.vocab]) === digest([b.nodes, b.edges, b.files, b.refs, b.vocab]), digest: digest([a.nodes, a.edges, a.files, a.refs, a.vocab]) };
}
