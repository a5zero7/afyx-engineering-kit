import type { Edge, Node } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { MaybeYield } from './cooperative-yield';
import type { ResolvedRef, ResolutionResult, UnresolvedRef } from './types';

const PERSIST_CHUNK = 1_000;

export interface ResolvedCleanup {
  rowIds: number[];
  legacyKeys: Array<{
    fromNodeId: string;
    referenceName: string;
    referenceKind: UnresolvedRef['referenceKind'];
  }>;
}

export interface FailedCleanup {
  byRowId: Array<{ rowId: number; referenceName: string }>;
  legacyKeys: Array<{
    fromNodeId: string;
    referenceName: string;
    referenceKind: UnresolvedRef['referenceKind'];
  }>;
}

export function resolvedCleanup(refs: readonly ResolvedRef[]): ResolvedCleanup {
  const rowIds: number[] = [];
  const legacyKeys: ResolvedCleanup['legacyKeys'] = [];
  for (const ref of refs) {
    if (ref.original.rowId != null) rowIds.push(ref.original.rowId);
    else {
      legacyKeys.push({
        fromNodeId: ref.original.fromNodeId,
        referenceName: ref.original.referenceName,
        referenceKind: ref.original.referenceKind,
      });
    }
  }
  return { rowIds, legacyKeys };
}

export function failedCleanup(refs: readonly UnresolvedRef[]): FailedCleanup {
  const byRowId: FailedCleanup['byRowId'] = [];
  const legacyKeys: FailedCleanup['legacyKeys'] = [];
  for (const ref of refs) {
    if (ref.rowId != null) byRowId.push({ rowId: ref.rowId, referenceName: ref.referenceName });
    else {
      legacyKeys.push({
        fromNodeId: ref.fromNodeId,
        referenceName: ref.referenceName,
        referenceKind: ref.referenceKind,
      });
    }
  }
  return { byRowId, legacyKeys };
}

/**
 * Durable admission boundary for resolution decisions.
 * Candidate selection and worker scheduling stay in ReferenceResolver; this
 * seam converts accepted decisions into graph facts and settles their queue
 * rows through the sole writer connection.
 */
export class ResolutionAdmission {
  constructor(private readonly queries: QueryBuilder) {}

  createEdges(resolved: readonly ResolvedRef[]): Edge[] {
    return resolved.flatMap((ref) => {
      let kind: Edge['kind'] =
        ref.edgeKind ??
        (ref.original.referenceKind === 'function_ref'
          ? 'references'
          : ref.original.referenceKind);

      if (kind === 'extends') {
        const target = this.queries.getNodeById(ref.targetNodeId);
        if (target && (target.kind === 'interface' || target.kind === 'protocol')) {
          const source = this.queries.getNodeById(ref.original.fromNodeId);
          if (source && source.kind !== 'interface' && source.kind !== 'protocol') {
            kind = 'implements';
          }
        }
      }

      if (kind === 'calls') {
        const target = this.queries.getNodeById(ref.targetNodeId);
        if (target && isConstructable(target)) kind = 'instantiates';
      }

      const targets = [
        { targetNodeId: ref.targetNodeId, metadata: ref.metadata },
        ...(ref.alsoTargets ?? []),
      ];
      return targets.map((target) => ({
        source: ref.original.fromNodeId,
        target: target.targetNodeId,
        kind,
        line: ref.original.line,
        column: ref.original.column,
        metadata: {
          ...(target.metadata ?? {}),
          confidence: ref.confidence,
          resolvedBy: ref.resolvedBy,
          refName: ref.original.referenceName,
          ...(ref.original.referenceKind !== kind
            ? { refKind: ref.original.referenceKind }
            : {}),
          ...(ref.original.referenceKind === 'function_ref' ? { fnRef: true } : {}),
        },
      }));
    });
  }

  admit(result: ResolutionResult, failures: readonly UnresolvedRef[]): number {
    const edges = this.createEdges(result.resolved);
    if (edges.length > 0) this.queries.insertEdges(edges);

    if (result.resolved.length > 0) {
      const resolved = resolvedCleanup(result.resolved);
      this.queries.deleteReferencesByRowIds(resolved.rowIds);
      this.queries.deleteSpecificResolvedReferences(resolved.legacyKeys);
    }

    if (failures.length > 0) {
      const failed = failedCleanup(failures);
      this.queries.markReferencesFailedByRowIds(failed.byRowId);
      this.queries.markReferencesFailed(failed.legacyKeys);
    }
    return edges.length;
  }

  async admitYielding(
    result: ResolutionResult,
    failures: readonly UnresolvedRef[],
    maybeYield: MaybeYield,
  ): Promise<number> {
    const edges = this.createEdges(result.resolved);
    for (let offset = 0; offset < edges.length; offset += PERSIST_CHUNK) {
      this.queries.insertEdges(edges.slice(offset, offset + PERSIST_CHUNK));
      await maybeYield();
    }

    const resolved = resolvedCleanup(result.resolved);
    for (let offset = 0; offset < resolved.rowIds.length; offset += PERSIST_CHUNK) {
      this.queries.deleteReferencesByRowIds(resolved.rowIds.slice(offset, offset + PERSIST_CHUNK));
      await maybeYield();
    }
    for (let offset = 0; offset < resolved.legacyKeys.length; offset += PERSIST_CHUNK) {
      this.queries.deleteSpecificResolvedReferences(resolved.legacyKeys.slice(offset, offset + PERSIST_CHUNK));
      await maybeYield();
    }

    const failed = failedCleanup(failures);
    for (let offset = 0; offset < failed.byRowId.length; offset += PERSIST_CHUNK) {
      this.queries.markReferencesFailedByRowIds(failed.byRowId.slice(offset, offset + PERSIST_CHUNK));
      await maybeYield();
    }
    for (let offset = 0; offset < failed.legacyKeys.length; offset += PERSIST_CHUNK) {
      this.queries.markReferencesFailed(failed.legacyKeys.slice(offset, offset + PERSIST_CHUNK));
      await maybeYield();
    }
    return edges.length;
  }
}

function isConstructable(node: Node): boolean {
  return node.kind === 'class' || node.kind === 'struct' || node.kind === 'union';
}
