import type {
  Edge,
  ExtractionResult,
  FileRecord,
  Language,
  Node,
  ReferenceKind,
  UnresolvedReference,
} from '../types';
import type { QueryBuilder } from '../db/queries';
import type { MaybeYield } from '../resolution/cooperative-yield';
import { detectGeneratedFile } from './generated-detection';
import { hashContent } from './content-hash';
import { isFileLevelOnlyLanguage } from './grammars';
import { finalizeStoreBundle, type StoreBundle } from './store-writer';

const STORE_CHUNK = 2_000;

export interface ExtractionFileStat {
  size: number;
  mtimeMs: number;
}

type RecoverableIncomingEdge = Edge & {
  targetKind: string;
  targetName: string;
  sourceFilePath: string;
  sourceLanguage: Language;
};

type RecoverableResolutionEdge = Edge & {
  edgeId: number;
  sourceFilePath: string;
  sourceLanguage: Language;
};

/**
 * Reconstruct the extraction-to-resolution contract carried by a resolved edge.
 * Edges without the original reference stamp cannot be recovered safely.
 */
export function recoverUnresolvedReference(
  edge: Edge & { sourceFilePath: string; sourceLanguage: Language },
): UnresolvedReference | null {
  const refName = edge.metadata?.refName;
  if (typeof refName !== 'string' || refName.length === 0) return null;
  const refKind =
    typeof edge.metadata?.refKind === 'string'
      ? (edge.metadata.refKind as ReferenceKind)
      : edge.kind;
  return {
    fromNodeId: edge.source,
    referenceName: refName,
    referenceKind: refKind,
    line: edge.line ?? 0,
    column: edge.column ?? 0,
    filePath: edge.sourceFilePath,
    language: edge.sourceLanguage,
  };
}

/**
 * Single-writer admission boundary for extraction facts.
 *
 * Discovery and parsing stay outside this class. It validates one completed
 * extraction result, writes it in deterministic chunks, and preserves the
 * references needed for incremental re-resolution when definitions move.
 */
export class ExtractionAdmission {
  constructor(private readonly queries: QueryBuilder) {}

  /** Remove only pre-v10/in-memory incomplete rows lacking an explicit catalog contract. */
  healIncompleteFiles(): void {
    for (const file of this.queries.getAllFiles()) {
      if (
        file.nodeCount === 0 &&
        file.indexingLevel === undefined &&
        !isFileLevelOnlyLanguage(file.language) &&
        (file.errors === undefined || file.errors.length === 0)
      ) {
        this.queries.deleteFile(file.path);
      }
    }
  }

  fileRecord(
    filePath: string,
    content: string,
    language: Language,
    stats: ExtractionFileStat,
    nodeCount: number,
    errors: ExtractionResult['errors'],
  ): FileRecord {
    return {
      path: filePath,
      contentHash: hashContent(content),
      language,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      indexedAt: Date.now(),
      nodeCount,
      indexingLevel: isFileLevelOnlyLanguage(language) ? 'metadata' : 'structural',
      errors: errors.length > 0 ? errors : undefined,
      generated: !isFileLevelOnlyLanguage(language) && detectGeneratedFile(filePath, content),
    };
  }

  freshBundle(
    filePath: string,
    content: string,
    language: Language,
    stats: ExtractionFileStat,
    result: ExtractionResult,
  ): StoreBundle {
    return finalizeStoreBundle(
      result,
      filePath,
      language,
      this.fileRecord(filePath, content, language, stats, result.nodes.length, result.errors),
    );
  }

  async admit(
    filePath: string,
    content: string,
    language: Language,
    stats: ExtractionFileStat,
    result: ExtractionResult,
    onYield?: MaybeYield,
  ): Promise<void> {
    const contentHash = hashContent(content);
    const existing = this.queries.getFileByPath(filePath);

    if (existing && existing.contentHash === contentHash) {
      const marker = existing.nodeCount === 0 && (existing.errors?.length ?? 0) > 0;
      if (!marker || result.nodes.length === 0) return;
    }

    const incoming = existing
      ? (this.queries.getCrossFileIncomingEdgesWithTarget(filePath) as RecoverableIncomingEdge[])
      : [];
    if (existing) this.queries.deleteFile(filePath);

    const file = this.fileRecord(
      filePath,
      content,
      language,
      stats,
      result.nodes.length,
      result.errors,
    );
    const bundle = finalizeStoreBundle(result, filePath, language, file);
    const fitsOneChunk =
      bundle.nodes.length <= STORE_CHUNK &&
      bundle.edges.length <= STORE_CHUNK &&
      bundle.refs.length <= STORE_CHUNK;

    if (fitsOneChunk) {
      this.queries.storeFileBundle(bundle);
      this.reattachIncoming(incoming, bundle.nodes);
      return;
    }

    for (let offset = 0; offset < bundle.nodes.length; offset += STORE_CHUNK) {
      this.queries.insertNodes(bundle.nodes.slice(offset, offset + STORE_CHUNK));
      await onYield?.();
    }
    for (let offset = 0; offset < bundle.edges.length; offset += STORE_CHUNK) {
      this.queries.insertEdges(bundle.edges.slice(offset, offset + STORE_CHUNK));
      await onYield?.();
    }

    this.reattachIncoming(incoming, bundle.nodes);

    for (let offset = 0; offset < bundle.refs.length; offset += STORE_CHUNK) {
      this.queries.insertUnresolvedRefsBatch(bundle.refs.slice(offset, offset + STORE_CHUNK));
      await onYield?.();
    }
    this.queries.upsertFile(file);
  }

  /** Re-open edges whose answer may change after a definition-set delta. */
  reopenAffectedResolutionEdges(
    changedDefinitions: readonly string[],
    changedFilePaths: readonly string[],
  ): number {
    if (changedDefinitions.length === 0) return 0;
    const alreadyFresh = new Set(changedFilePaths);
    const candidates = this.queries.getResolutionEdgesByTargetName(
      [...changedDefinitions],
    ) as RecoverableResolutionEdge[];
    const edgeIds: number[] = [];
    const references: UnresolvedReference[] = [];

    for (const edge of candidates) {
      if (alreadyFresh.has(edge.sourceFilePath)) continue;
      const reference = recoverUnresolvedReference(edge);
      if (!reference) continue;
      edgeIds.push(edge.edgeId);
      references.push(reference);
    }
    if (references.length === 0) return 0;
    this.queries.replaceResolutionEdgesWithUnresolvedRefs(edgeIds, references);
    return references.length;
  }

  private reattachIncoming(edges: RecoverableIncomingEdge[], nodes: Node[]): void {
    if (edges.length === 0) return;
    const targetByIdentity = new Map<string, string>();
    for (const node of nodes) targetByIdentity.set(`${node.kind}\0${node.name}`, node.id);

    const reinserted: Edge[] = [];
    const unresolved: UnresolvedReference[] = [];
    for (const edge of edges) {
      const target = targetByIdentity.get(`${edge.targetKind}\0${edge.targetName}`);
      if (target) {
        reinserted.push({
          source: edge.source,
          target,
          kind: edge.kind,
          metadata: edge.metadata,
          line: edge.line,
          column: edge.column,
          provenance: edge.provenance,
        });
      } else {
        const reference = recoverUnresolvedReference(edge);
        if (reference) unresolved.push(reference);
      }
    }
    if (reinserted.length > 0) this.queries.insertEdges(reinserted);
    if (unresolved.length > 0) this.queries.insertUnresolvedRefsBatch(unresolved);
  }
}
