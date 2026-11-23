/**
 * Runs the query contract's fixed operation matrix against a `QueryBuilder` opened on
 * the deterministic fixture (see `fixture.ts`) and returns exact, ordered results plus
 * digests for the larger ones.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../../src/db';
import { QueryBuilder } from '../../src/db/queries';
import type { Node } from '../../src/types';
import { buildFixture, type Fixture } from './fixture';

const digest = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 14);
const nodeIds = (nodes: Node[]): string[] => nodes.map((n) => n.id);
const nodeShape = (n: Node | null) => n && [n.id, n.kind, n.name, n.qualifiedName, n.filePath, n.language, n.startLine, n.isExported];
const edgeShape = (e: { source: string; target: string; kind: string; line?: number; column?: number; provenance?: string }) =>
  `${e.source}>${e.target}:${e.kind}@${e.line ?? '-'}:${e.column ?? '-'}${e.provenance ? `~${e.provenance}` : ''}`;

export function writeFixture(dir: string): { dbPath: string; fixture: Fixture } {
  const dbPath = path.join(dir, 'graph.db');
  const conn = DatabaseConnection.initialize(dbPath);
  const q = new QueryBuilder(conn.getDb());
  const fixture = buildFixture();
  q.insertNodes(fixture.nodes);
  q.insertEdges(fixture.edges);
  q.insertUnresolvedRefsBatch(fixture.refs);
  for (const f of fixture.files) q.upsertFile(f);
  conn.close();
  return { dbPath, fixture };
}

/** Open a fresh QueryBuilder over the fixture database (a fresh connection each time, like a real reader). */
function open(dbPath: string): { conn: DatabaseConnection; q: QueryBuilder } {
  const conn = DatabaseConnection.open(dbPath);
  return { conn, q: new QueryBuilder(conn.getDb()) };
}

export function computeQueryContract(dbPath: string, fixture: Fixture): Record<string, unknown> {
  const { conn, q } = open(dbPath);
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown, big = false): void => { out[key] = big ? digest(value) : value; };
  const attempt = (key: string, run: () => unknown, big = false): void => {
    try { put(key, run(), big); } catch (error) { out[key] = `throws: ${(error as Error).message}`; }
  };
  const id = (role: string): string => fixture.ids[role]!;

  // ---- Node identity ------------------------------------------------------------------
  put('node byId exists', nodeShape(q.getNodeById(id('runA'))));
  put('node byId missing', q.getNodeById('does-not-exist'));
  put('node byIds mixed', [...q.getNodesByIds([id('runA'), 'missing-1', id('fooB'), 'missing-2']).keys()].sort());
  put('node byIds empty', [...q.getNodesByIds([]).keys()]);
  put('node byIds duplicate', [...q.getNodesByIds([id('runA'), id('runA')]).keys()]);

  // ---- File-scoped and kind-scoped node reads -----------------------------------------
  put('nodes byFile a/Foo.ts', nodeIds(q.getNodesByFile('src/a/Foo.ts')));
  put('nodes byFile missing', nodeIds(q.getNodesByFile('src/does/not/exist.ts')));
  put('nodes byKind class', nodeIds(q.getNodesByKind('class')));
  put('nodes byKind route', nodeIds(q.getNodesByKind('route')));
  put('nodes byKind missing-kind', nodeIds(q.getNodesByKind('enum_member')));
  put('nodes iterateByKind function', [...q.iterateNodesByKind('function')].map((n) => n.id));
  put('nodes all count', q.getAllNodes().length);
  put('nodes distinct languages', [...q.getDistinctFileLanguages()].sort());
  put('nodes allNodeNames count', q.getAllNodeNames().length);
  put('nodes iterateNodeNames', [...q.iterateNodeNames()].sort());
  put('nodes namesByFiles', q.getNodeNamesByFiles(['src/a/Foo.ts', 'src/b/Foo.ts']).sort());
  put('nodes namePairsByFiles', [...q.getNodeNamePairsByFiles(['src/a/Foo.ts', 'src/b/Foo.ts'])].sort());

  // ---- Name lookup: exact, prefix, qualified, case-folded -----------------------------
  put('name exact run', nodeIds(q.getNodesByName('run')));
  put('name exact missing', nodeIds(q.getNodesByName('NoSuchName')));
  put('name prefix he', nodeIds(q.getNodesByNamePrefix('he', 50)));
  put('name prefix limited', nodeIds(q.getNodesByNamePrefix('fanIn', 3)));
  put('qualified exact a.Foo.run', nodeIds(q.getNodesByQualifiedNameExact('a.Foo.run')));
  put('qualified exact nested', nodeIds(q.getNodesByQualifiedNameExact('a.Foo.Bar.baz')));
  put('qualified exact missing', nodeIds(q.getNodesByQualifiedNameExact('nope')));
  put('lower name mixed case', nodeIds(q.getNodesByLowerName('HELPER')));
  put('lower name exact case', nodeIds(q.getNodesByLowerName('helper')));
  put('lower name punctuation', nodeIds(q.getNodesByLowerName('GET$VALUE')));

  // ---- Edge reads: direction, kind filtering, self edges, batch ----------------------
  put('edges outgoing runA', q.getOutgoingEdges(id('runA')).map(edgeShape));
  put('edges outgoing runA calls', q.getOutgoingEdges(id('runA'), ['calls']).map(edgeShape));
  put('edges outgoing runA calls,type_of', q.getOutgoingEdges(id('runA'), ['calls', 'type_of']).map(edgeShape));
  put('edges outgoing missing', q.getOutgoingEdges('missing').map(edgeShape));
  put('edges incoming helperA', q.getIncomingEdges(id('helperA')).map(edgeShape));
  put('edges incoming helperA calls', q.getIncomingEdges(id('helperA'), ['calls']).map(edgeShape));
  put('edges self runA navigates', q.getOutgoingEdges(id('runA'), ['navigates']).map(edgeShape));
  put('edges outgoingFrom multi', q.getOutgoingEdgesFrom([id('runA'), id('fooA')]).map(edgeShape).sort());
  put('edges outgoingFrom empty', q.getOutgoingEdgesFrom([]));
  put('edges incomingTo multi', q.getIncomingEdgesTo([id('helperA'), id('runB')]).map(edgeShape).sort());
  put('edges countIncoming', [...q.countIncomingEdges([id('helperA'), id('runA'), 'missing']).entries()].sort());
  put('edges countOutgoing', [...q.countOutgoingEdges([id('runA'), id('hub'), 'missing']).entries()].sort());
  put('edges between', q.findEdgesBetweenNodes([id('runA'), id('helperA'), id('fooA'), id('base')]).map(edgeShape).sort());
  put('edges between kinds', q.findEdgesBetweenNodes([id('runA'), id('fooA')], ['instantiates']).map(edgeShape));

  // ---- File reads ----------------------------------------------------------------------
  put('file byPath exists', q.getFileByPath('src/a/Foo.ts'));
  put('file byPath missing', q.getFileByPath('nope.ts'));
  put('files all count', q.getAllFiles().length);
  put('files allOrdered', q.getAllFiles().map((f) => f.path));
  put('files allPaths', q.getAllFilePaths());
  put('file nodes for paths', nodeIds(q.getFileNodes(['src/a/Foo.ts', 'src/b/Foo.ts', 'src/does/not/exist.ts'])));
  put('files lastIndexedAt', typeof q.getLastIndexedAt());
  put('files indexRevision', q.getIndexRevision());
  put('files indexedSince', q.getFilesIndexedSince(0, 5));
  put('files stale', q.getStaleFiles(new Map([['src/a/Foo.ts', 'different-hash'], ['src/b/Foo.ts', 'hash-src/b/Foo.ts']])).map((f) => f.path).sort());
  put('files generatedAmong', [...q.getGeneratedPathsAmong(['src/gen/proto.pb.go', 'src/normal/server.go'])].sort());
  put('files generatedPredicate', ['src/gen/proto.pb.go', 'src/normal/server.go', 'src/other/thing_test.go', 'src/unindexed/onlyByConvention.pb.go'].map(q.generatedPredicateFor(['src/gen/proto.pb.go', 'src/normal/server.go'])));
  put('files ambientAmong', [...q.getAmbientDeclarationPathsAmong(['src/types/ambient.d.ts', 'src/a/Foo.ts', 'src/a/util.ts'])].sort());
  put('files ambientPredicate', ['src/types/ambient.d.ts', 'src/a/Foo.ts'].map(q.ambientDeclarationPredicateFor(['src/types/ambient.d.ts', 'src/a/Foo.ts'])));
  put('files generatedCount', q.countGeneratedFiles());

  // ---- Unresolved references -----------------------------------------------------------
  put('refs byName found', q.getUnresolvedByName('externalLib.doThing').map((r) => [r.fromNodeId, r.referenceName, r.line]));
  put('refs byName missing', q.getUnresolvedByName('nope'));
  put('refs all count', q.getUnresolvedReferences().length);
  put('refs pendingCount', q.getUnresolvedReferencesCount());
  put('refs batch page1', q.getUnresolvedReferencesBatch(0, 2).map((r) => r.referenceName));
  put('refs batch page2', q.getUnresolvedReferencesBatch(2, 2).map((r) => r.referenceName));
  put('refs batchAfter default', q.getUnresolvedReferencesBatchAfter(0, 10).map((r) => r.referenceName));
  put('refs batchAfter prerequisites', q.getUnresolvedReferencesBatchAfter(0, 10, true).map((r) => r.referenceName));
  put('refs batchAfter dependents', q.getUnresolvedReferencesBatchAfter(0, 10, false).map((r) => r.referenceName));
  put('refs inFile', q.getUnresolvedReferencesInFile('src/a/Foo.ts').map((r) => r.referenceName));
  put('refs inFile limited', q.getUnresolvedReferencesInFile('src/a/Foo.ts', 1).map((r) => r.referenceName));
  put('refs from node', q.getUnresolvedReferencesFrom(id('runA')).map((r) => r.referenceName));
  put('refs byFiles', q.getUnresolvedReferencesByFiles(['src/a/Foo.ts', 'src/cycle/d.ts']).map((r) => r.referenceName).sort());
  put('refs unresolvedNamesAmong', [...q.getUnresolvedNamesAmong(['externalLib.doThing', 'doThing', 'helper', 'fn', 'nope'])].sort());
  put('refs retryableFailed', q.getRetryableFailedReferences(['helper', 'fn', 'nope']).map((r) => r.referenceName).sort());
  put('refs retryableFailed ceilingAtBoundary', q.getRetryableFailedReferences(['helper'], 1));

  // ---- Dependency / blast-radius --------------------------------------------------------
  put('unreferenced functions', nodeIds(q.getUnreferencedNodes(['function'], 200).map((r) => r.node)).sort());
  put('unreferenced none', q.getUnreferencedNodes([], 10));
  put('ambiguousReferencedNames', [...q.getAmbiguousReferencedNames(['run', 'helper', 'Foo', 'stepD'])].sort());
  put('languagesWithExports', [...q.getLanguagesWithExports(['typescript', 'go'])].sort());
  put('topDependedOn', q.getTopDependedOn(5));
  put('topCallingFiles', q.getTopCallingFiles(5));
  put('fileDependentCounts', q.getFileDependentCounts(['src/util/shared.ts', 'src/hub.ts']));
  put('fileReachCounts', q.getFileReachCounts(['src/hub.ts', 'src/util/shared.ts']));
  put('crossFileDependencyPairs', q.getCrossFileDependencyPairs(0).map((p) => `${p.source}>${p.target}`).sort());
  put('crossFileDependencyPairs highConfidence', q.getCrossFileDependencyPairs(0.99).map((p) => `${p.source}>${p.target}`).sort());
  put('dependentFilePaths', q.getDependentFilePaths('src/util/shared.ts').sort());
  put('dependencyFilePaths', q.getDependencyFilePaths('src/a/Foo.ts').sort());
  put('dependencyFilePaths cycle', q.getDependencyFilePaths('src/cycle/d.ts').sort());
  put('crossFileIncomingWithTarget', q.getCrossFileIncomingEdgesWithTarget('src/util/shared.ts').map((e) => [e.source, e.targetName, e.targetKind, e.sourceFilePath]).sort());
  attempt('aggregateModuleGraph', () => {
    const assignments = [...new Set(fixture.nodes.map((n) => n.filePath))].map((filePath) => ({ filePath, module: filePath.split('/').slice(0, 2).join('/') }));
    const result = q.aggregateModuleGraph(assignments, { kinds: ['calls', 'references', 'implements', 'extends'], minConfidence: 0, topPairsPerLink: 2, pairKinds: ['calls'] });
    return { links: result.links.map((l) => `${l.source}>${l.target}:${l.kind}=${l.count}/${l.declared}/${l.uncertain}`).sort(), pairs: result.pairs.map((p) => `${p.source}>${p.target}:${p.from}->${p.to}=${p.count}`).sort() };
  });

  // ---- Search: FTS/LIKE/fuzzy, exact-name hybrid, substring ----------------------------
  for (const [label, query] of [
    ['name', 'helper'], ['prefixLike', 'help'], ['camel', 'signIn'], ['ambiguous', 'run'], ['punct', 'get$Value'],
    ['unmatched', 'zzz_no_such_symbol_qqq'], ['typo', 'helpr'], ['fieldKind', 'kind:class Foo'], ['fieldPath', 'path:cycle'], ['empty', ''],
    ['fuzzyBoundary', 'aaaa'], ['likeOrder', 'Handler'],
  ] as const) {
    attempt(`search ${label}`, () => q.searchNodes(query, { limit: 10 }).map((r) => [r.node.id, Math.round(r.score * 100) / 100]));
  }
  put('search kindFilter', q.searchNodes('run', { kinds: ['method'], limit: 10 }).map((r) => r.node.id));
  put('search languageFilter', q.searchNodes('stepD', { languages: ['typescript'], limit: 10 }).map((r) => r.node.id));
  put('search offset', q.searchNodes('run', { limit: 3, offset: 3 }).map((r) => r.node.id));
  put('exactName single', q.findNodesByExactName(['helper']).map((r) => r.node.id).sort());
  put('exactName coLocated', q.findNodesByExactName(['run', 'scrapeLoop', 'midCommon'], { limit: 30 }).map((r) => r.node.id));
  put('exactName empty', q.findNodesByExactName([]));
  put('substring Loop', q.findNodesByNameSubstring('Loop').map((r) => r.node.id));
  put('substring excludePrefix', q.findNodesByNameSubstring('run', { excludePrefix: true }).map((r) => r.node.id));

  // ---- Routing / project shape -----------------------------------------------------------
  put('dominantFile', q.getDominantFile());
  put('topRouteFile', q.getTopRouteFile());
  attempt('resolutionEdgesByTargetName', () => q.getResolutionEdgesByTargetName(['helper']).map((e) => [e.source, e.target, e.provenance ?? null]).sort());
  attempt('routingManifest', () => {
    const manifest = q.getRoutingManifest(10);
    return manifest && { entries: manifest.entries.map((e) => [e.url, e.handler, e.handlerFile]), topHandlerFile: manifest.topHandlerFile, topHandlerFileCount: manifest.topHandlerFileCount, totalRoutes: manifest.totalRoutes };
  });

  // ---- Name-segment vocabulary reads ------------------------------------------------------
  put('vocab isEmpty (unbuilt)', q.isNameSegmentVocabEmpty());
  q.insertNameSegmentsBatch(q.getDistinctNodeNames(1000, 0));
  put('vocab isEmpty (built)', q.isNameSegmentVocabEmpty());
  put('vocab distinctNames page', q.getDistinctNodeNames(5, 0));
  put('vocab coOccurrence', q.getSegmentCoOccurrence([{ segment: 'run', word: 'run' }, { segment: 'helper', word: 'helper' }], 1, 10));
  put('vocab nameCounts', [...q.getSegmentNameCounts(['run', 'helper', 'foo']).entries()].sort());
  put('vocab namesForSegment', q.getNamesForSegment('helper', 10).sort());

  // ---- Statistics and metadata -----------------------------------------------------------
  put('nodeAndEdgeCount', q.getNodeAndEdgeCount());
  const stats = q.getStats();
  put('stats', { nodeCount: stats.nodeCount, edgeCount: stats.edgeCount, fileCount: stats.fileCount, nodesByKind: stats.nodesByKind, edgesByKind: stats.edgesByKind, filesByLanguage: stats.filesByLanguage });
  q.setMetadata('project_root', '/scratch');
  put('metadata get', q.getMetadata('project_root'));
  put('metadata missing', q.getMetadata('nope'));
  put('metadata all', q.getAllMetadata());

  conn.close();
  return out;
}

/** Read → write → read: a cached row must never survive the write that changed or removed it. */
export function computeCacheContract(dbPath: string): Record<string, unknown> {
  const { conn, q } = open(dbPath);
  const out: Record<string, unknown> = {};
  const name = (id: string): string | null => q.getNodeById(id)?.name ?? null;

  const real = q.getNodesByName('run').find((n) => n.filePath === 'src/a/Foo.ts')!.id;
  name(real); // warm the cache
  q.updateNode({ ...q.getNodeById(real)!, name: 'runRenamed' });
  out['after update'] = name(real);

  const fileNode = q.getNodesByFile('src/b/Foo.ts')[0]!;
  name(fileNode.id);
  q.deleteNodesByFile('src/b/Foo.ts');
  out['after deleteByFile'] = name(fileNode.id);
  out['after deleteByFile byIds'] = [...q.getNodesByIds([fileNode.id]).keys()];

  const anId = q.getNodesByFile('src/a/util.ts')[0]!.id;
  name(anId);
  q.deleteNode(anId);
  out['after deleteNode'] = name(anId);

  const clearedId = q.getNodesByFile('src/hub.ts')[0]!.id;
  name(clearedId);
  q.clear();
  out['after clear'] = name(clearedId);
  out['after clear stats'] = q.getNodeAndEdgeCount();
  conn.close();
  return out;
}
