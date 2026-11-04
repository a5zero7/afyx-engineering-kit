/**
 * Query builder for the knowledge graph database.
 *
 * A thin compatibility facade in front of two things: `GraphReader` (every read) and
 * `GraphWriter` (every write, Phase 3B.4A). Existing consumers call the same methods
 * with the same signatures; the implementation now lives in one focused module per
 * responsibility (see `graph-reader.ts` and its readers).
 */

import { GraphReader } from './graph-reader';
import { GraphWriter } from './graph-writer';
import { SqliteDatabase } from './sqlite-adapter';
import type {
  Edge, EdgeKind, FileRecord, GraphStats, Language, Node, NodeKind, SearchOptions, SearchResult, UnresolvedReference,
} from '../types';

export { DEPRIORITIZED_NAME_BONUS_SCALE } from './search-reader';

export class QueryBuilder {
  private reader: GraphReader;
  /** Every persisted write is delegated here. */
  private writer: GraphWriter;

  constructor(db: SqliteDatabase) {
    this.reader = new GraphReader(db);
    this.writer = new GraphWriter(db, {
      forgetNode: (id) => this.reader.nodes.forgetNode(id),
      forgetFile: (filePath) => this.reader.nodes.forgetByFile(filePath),
      forgetAll: () => this.reader.nodes.clearCache(),
    });
  }

  /**
   * Swap the underlying connection in place. Used by pool workers' connection recycling
   * (plan §7a.6, writes-under-readers): a long-lived read connection pins WAL checkpoint
   * progress, and the deep WAL that accumulates behind it taxes every main-thread B-tree
   * page operation (deletes measured 42.6s → 118.8s from 0 to 4 attached readers on
   * identical hardware). Workers therefore close and reopen their read-only connection at
   * the pool-idle boundary; everything above the connection — this QueryBuilder, the
   * resolver and its warm caches — survives, and only connection-derived state (prepared
   * statements) resets, re-preparing lazily on next use.
   */
  rebind(db: SqliteDatabase): void {
    this.reader.rebind(db);
    this.writer.rebind(db);
  }

  setProjectNameTokens(tokens: Set<string>): void { this.reader.search.setProjectNameTokens(tokens); }
  getProjectNameTokens(): Set<string> { return this.reader.search.getProjectNameTokens(); }
  setDeprioritizedPathMatcher(matcher: ((filePath: string) => boolean) | undefined): void { this.reader.search.setDeprioritizedPathMatcher(matcher); }
  getDeprioritizedPathMatcher(): ((filePath: string) => boolean) | undefined { return this.reader.search.getDeprioritizedPathMatcher(); }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  insertNode(node: Node): void { this.writer.nodes.insert(node); }
  insertNodes(nodes: Node[]): void { this.writer.nodes.insertMany(nodes); }

  /**
   * Store one file's whole extraction bundle — nodes, edges, unresolved refs, and the
   * file record — in a single transaction. Edges MUST already be endpoint-filtered by the
   * caller (the store path filters to the file's own inserted node ids).
   */
  storeFileBundle(bundle: { nodes: Node[]; edges: Edge[]; refs: UnresolvedReference[]; file: FileRecord }): void {
    this.writer.storeBundle(bundle);
  }

  updateNode(node: Node): void { this.writer.nodes.update(node); }
  deleteNode(id: string): void { this.writer.nodes.delete(id); }
  deleteNodesByFile(filePath: string): void { this.writer.nodes.deleteByFile(filePath); }

  getNodeById(id: string): Node | null { return this.reader.nodes.getNodeById(id); }
  getNodesByIds(ids: readonly string[]): Map<string, Node> { return this.reader.nodes.getNodesByIds(ids); }
  clearCache(): void { this.reader.nodes.clearCache(); }
  getNodesByFile(filePath: string): Node[] { return this.reader.nodes.getNodesByFile(filePath); }
  getNodesByKind(kind: NodeKind): Node[] { return this.reader.nodes.getNodesByKind(kind); }
  iterateNodesByKind(kind: NodeKind): IterableIterator<Node> { return this.reader.nodes.iterateNodesByKind(kind); }
  getAllNodes(): Node[] { return this.reader.nodes.getAllNodes(); }
  iterateNodesByLanguageWithDecorator(language: Language, decorator: string): IterableIterator<Node> {
    return this.reader.nodes.iterateNodesByLanguageWithDecorator(language, decorator);
  }
  getDistinctFileLanguages(): Set<string> { return this.reader.nodes.getDistinctFileLanguages(); }
  getNodesByName(name: string): Node[] { return this.reader.nodes.getNodesByName(name); }
  getNodesByNamePrefix(prefix: string, limit = 20): Node[] { return this.reader.nodes.getNodesByNamePrefix(prefix, limit); }
  getNodesByQualifiedNameExact(qualifiedName: string): Node[] { return this.reader.nodes.getNodesByQualifiedNameExact(qualifiedName); }
  getNodesByLowerName(name: string): Node[] { return this.reader.nodes.getNodesByLowerName(name); }
  getAllNodeNames(): string[] { return this.reader.nodes.getAllNodeNames(); }
  iterateNodeNames(): IterableIterator<string> { return this.reader.nodes.iterateNodeNames(); }
  getNodeNamesByFiles(filePaths: string[]): string[] { return this.reader.nodes.getNodeNamesByFiles(filePaths); }
  getNodeNamePairsByFiles(filePaths: string[]): Set<string> { return this.reader.nodes.getNodeNamePairsByFiles(filePaths); }

  // ===========================================================================
  // Name-segment vocabulary (prompt-hook graph-derived gate)
  // ===========================================================================

  clearNameSegmentVocab(): void { this.writer.vocabulary.clear(); }
  isNameSegmentVocabEmpty(): boolean { return this.reader.vocabulary.isNameSegmentVocabEmpty(); }
  getDistinctNodeNames(limit: number, offset: number): string[] { return this.reader.vocabulary.getDistinctNodeNames(limit, offset); }
  insertNameSegmentsBatch(names: string[]): void { this.writer.vocabulary.addAll(names); }
  getSegmentCoOccurrence(variants: Array<{ segment: string; word: string }>, minWords: number, limit: number): Array<{ name: string; matches: number }> {
    return this.reader.vocabulary.getSegmentCoOccurrence(variants, minWords, limit);
  }
  getSegmentNameCounts(segments: string[]): Map<string, number> { return this.reader.vocabulary.getSegmentNameCounts(segments); }
  getNamesForSegment(segment: string, limit: number): string[] { return this.reader.vocabulary.getNamesForSegment(segment, limit); }

  // ===========================================================================
  // Search
  // ===========================================================================

  searchNodes(query: string, options: SearchOptions = {}): SearchResult[] { return this.reader.search.searchNodes(query, options); }
  findNodesByExactName(names: string[], options: SearchOptions = {}): SearchResult[] { return this.reader.search.findNodesByExactName(names, options); }
  findNodesByNameSubstring(substring: string, options: SearchOptions & { excludePrefix?: boolean } = {}): SearchResult[] {
    return this.reader.search.findNodesByNameSubstring(substring, options);
  }

  // ===========================================================================
  // Routing / project shape
  // ===========================================================================

  getDominantFile(): { filePath: string; edgeCount: number; nextEdgeCount: number } | null { return this.reader.routing.getDominantFile(); }
  getTopRouteFile(): { filePath: string; routeCount: number; totalRoutes: number } | null { return this.reader.routing.getTopRouteFile(); }
  getRoutingManifest(limit = 40): ReturnType<GraphReader['routing']['getRoutingManifest']> { return this.reader.routing.getRoutingManifest(limit); }

  // ===========================================================================
  // Edge Operations
  // ===========================================================================

  insertEdge(edge: Edge): void { this.writer.edges.insert(edge); }
  insertEdges(edges: Edge[]): void { this.writer.edges.insertMany(edges); }
  deleteEdgesBySource(sourceId: string): void { this.writer.edges.deleteBySource(sourceId); }

  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: string): Edge[] { return this.reader.edges.getOutgoingEdges(sourceId, kinds, provenance); }
  getIncomingEdges(targetId: string, kinds?: EdgeKind[]): Edge[] { return this.reader.edges.getIncomingEdges(targetId, kinds); }
  getOutgoingEdgesFrom(sourceIds: readonly string[], kinds?: EdgeKind[]): Edge[] { return this.reader.edges.getOutgoingEdgesFrom(sourceIds, kinds); }
  countIncomingEdges(ids: readonly string[]): Map<string, number> { return this.reader.edges.countIncomingEdges(ids); }
  getIncomingEdgesTo(targetIds: readonly string[], kinds?: EdgeKind[]): Edge[] { return this.reader.edges.getIncomingEdgesTo(targetIds, kinds); }
  countOutgoingEdges(ids: readonly string[]): Map<string, number> { return this.reader.edges.countOutgoingEdges(ids); }
  findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): Edge[] { return this.reader.edges.findEdgesBetweenNodes(nodeIds, kinds); }

  // ===========================================================================
  // Dependency / blast-radius
  // ===========================================================================

  getUnreferencedNodes(kinds: readonly string[], limit: number): Array<{ node: Node; generated: boolean }> {
    return this.reader.dependencies.getUnreferencedNodes(kinds, limit);
  }
  getUnresolvedNamesAmong(names: Iterable<string>): Set<string> { return this.reader.refs.getUnresolvedNamesAmong(names); }
  getAmbiguousReferencedNames(names: Iterable<string>): Set<string> { return this.reader.dependencies.getAmbiguousReferencedNames(names); }
  getLanguagesWithExports(languages: Iterable<string>): Set<string> { return this.reader.dependencies.getLanguagesWithExports(languages); }
  getTopDependedOn(limit: number): Array<{ nodeId: string; dependents: number }> { return this.reader.dependencies.getTopDependedOn(limit); }
  getTopCallingFiles(limit: number): Array<{ nodeId: string; filePath: string; calls: number; reaches: number; score: number }> {
    return this.reader.dependencies.getTopCallingFiles(limit);
  }
  getFileDependentCounts(filePaths: string[]): Array<{ filePath: string; dependents: number }> { return this.reader.dependencies.getFileDependentCounts(filePaths); }
  getFileReachCounts(filePaths: string[]): Array<{ filePath: string; reaches: number; refs: number }> { return this.reader.dependencies.getFileReachCounts(filePaths); }
  getFileNodes(filePaths: string[]): Node[] { return this.reader.files.getFileNodes(filePaths); }
  aggregateModuleGraph(
    assignments: ReadonlyArray<{ filePath: string; module: string }>,
    options: { kinds: readonly EdgeKind[]; minConfidence: number; topPairsPerLink: number; pairKinds: readonly EdgeKind[] }
  ): ReturnType<GraphReader['dependencies']['aggregateModuleGraph']> {
    return this.reader.dependencies.aggregateModuleGraph(assignments, options);
  }
  getCrossFileDependencyPairs(minConfidence: number): Array<{ source: string; target: string }> { return this.reader.dependencies.getCrossFileDependencyPairs(minConfidence); }
  getUnresolvedReferencesInFile(filePath: string, limit = 5000): UnresolvedReference[] { return this.reader.refs.getUnresolvedReferencesInFile(filePath, limit); }
  getUnresolvedReferencesFrom(fromNodeId: string): UnresolvedReference[] { return this.reader.refs.getUnresolvedReferencesFrom(fromNodeId); }
  getDependentFilePaths(filePath: string): string[] { return this.reader.dependencies.getDependentFilePaths(filePath); }
  getDependencyFilePaths(filePath: string): string[] { return this.reader.dependencies.getDependencyFilePaths(filePath); }
  getCrossFileIncomingEdgesWithTarget(filePath: string): ReturnType<GraphReader['dependencies']['getCrossFileIncomingEdgesWithTarget']> {
    return this.reader.dependencies.getCrossFileIncomingEdgesWithTarget(filePath);
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  upsertFile(file: FileRecord): void { this.writer.files.upsert(file); }
  getGeneratedPathsAmong(filePaths: Iterable<string>): Set<string> { return this.reader.files.getGeneratedPathsAmong(filePaths); }
  generatedPredicateFor(filePaths: Iterable<string>): (filePath: string) => boolean { return this.reader.files.generatedPredicateFor(filePaths); }
  getAmbientDeclarationPathsAmong(filePaths: Iterable<string>): Set<string> { return this.reader.files.getAmbientDeclarationPathsAmong(filePaths); }
  ambientDeclarationPredicateFor(filePaths: Iterable<string>): (filePath: string) => boolean { return this.reader.files.ambientDeclarationPredicateFor(filePaths); }
  countGeneratedFiles(): number { return this.reader.files.countGeneratedFiles(); }
  deleteFile(filePath: string): void { this.writer.files.delete(filePath); }
  getFileByPath(filePath: string): FileRecord | null { return this.reader.files.getFileByPath(filePath); }
  getAllFiles(): FileRecord[] { return this.reader.files.getAllFiles(); }
  getLastIndexedAt(): number | null { return this.reader.files.getLastIndexedAt(); }
  getIndexRevision(): { lastIndexedAt: number | null; fileCount: number } { return this.reader.files.getIndexRevision(); }
  getFilesIndexedSince(since: number, limit: number): { paths: string[]; total: number } { return this.reader.files.getFilesIndexedSince(since, limit); }
  getStaleFiles(currentHashes: Map<string, string>): FileRecord[] { return this.reader.files.getStaleFiles(currentHashes); }
  getAllFilePaths(): string[] { return this.reader.files.getAllFilePaths(); }

  // ===========================================================================
  // Unresolved References
  // ===========================================================================

  insertUnresolvedRef(ref: UnresolvedReference): void { this.writer.refs.insert(ref); }
  insertUnresolvedRefsBatch(refs: UnresolvedReference[]): void { this.writer.refs.insertBatch(refs); }
  deleteUnresolvedByNode(nodeId: string): void { this.writer.refs.deleteByNode(nodeId); }
  getUnresolvedByName(name: string): UnresolvedReference[] { return this.reader.refs.getUnresolvedByName(name); }
  getUnresolvedReferences(): UnresolvedReference[] { return this.reader.refs.getUnresolvedReferences(); }
  getUnresolvedReferencesCount(): number { return this.reader.refs.getUnresolvedReferencesCount(); }
  getUnresolvedReferencesBatch(offset: number, limit: number): UnresolvedReference[] { return this.reader.refs.getUnresolvedReferencesBatch(offset, limit); }
  getUnresolvedReferencesBatchAfter(afterRowId: number, limit: number, prerequisites?: boolean): UnresolvedReference[] {
    return this.reader.refs.getUnresolvedReferencesBatchAfter(afterRowId, limit, prerequisites);
  }
  getUnresolvedReferencesByFiles(filePaths: string[]): UnresolvedReference[] { return this.reader.refs.getUnresolvedReferencesByFiles(filePaths); }
  clearUnresolvedReferences(): void { this.writer.refs.clear(); }
  deleteResolvedReferences(fromNodeIds: string[]): void { this.writer.refs.deleteByNodes(fromNodeIds); }
  deleteSpecificResolvedReferences(refs: Array<{ fromNodeId: string; referenceName: string; referenceKind: string }>): number {
    return this.writer.refs.deleteSpecific(refs);
  }
  deleteReferencesByRowIds(rowIds: number[]): number { return this.writer.refs.deleteByRowIds(rowIds); }
  markReferencesFailed(refs: Array<{ fromNodeId: string; referenceName: string; referenceKind: string }>): number { return this.writer.refs.markFailed(refs); }
  markReferencesFailedByRowIds(refs: Array<{ rowId: number; referenceName: string }>): number { return this.writer.refs.markFailedByRowIds(refs); }
  getRetryableFailedReferences(names: string[], perNameCeiling = 500): UnresolvedReference[] { return this.reader.refs.getRetryableFailedReferences(names, perNameCeiling); }
  getResolutionEdgesByTargetName(names: string[], perNameCeiling = 500): ReturnType<GraphReader['refs']['getResolutionEdgesByTargetName']> {
    return this.reader.refs.getResolutionEdgesByTargetName(names, perNameCeiling);
  }
  deleteEdgesByIds(edgeIds: number[]): number { return this.writer.edges.deleteByIds(edgeIds); }
  replaceResolutionEdgesWithUnresolvedRefs(edgeIds: number[], refs: UnresolvedReference[]): number {
    return this.writer.replaceResolutionEdges(edgeIds, refs);
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  getNodeAndEdgeCount(): { nodes: number; edges: number } { return this.reader.stats.getNodeAndEdgeCount(); }
  getStats(): GraphStats { return this.reader.stats.getStats(); }

  // ===========================================================================
  // Project Metadata
  // ===========================================================================

  getMetadata(key: string): string | null { return this.reader.stats.getMetadata(key); }
  setMetadata(key: string, value: string): void { this.writer.setMetadata(key, value); }
  getAllMetadata(): Record<string, string> { return this.reader.stats.getAllMetadata(); }

  clear(): void { this.writer.clear(); }
}
