/**
 * The narrow read surface the graph core needs from persistence.
 *
 * Graph algorithms in this folder never see SQL, statements or caches — only these
 * lookups. `QueryBuilder` satisfies both interfaces structurally, so production wiring
 * is unchanged, and a small in-memory store is enough to exercise every algorithm.
 */

import type { Edge, EdgeKind, Node, NodeKind } from '../types';

/** Node and adjacency lookups: everything a walk over the relationship graph needs. */
export interface GraphReader {
  getNodeById(id: string): Node | null;
  /** Nodes for the ids that exist; unknown ids are simply absent from the map. */
  getNodesByIds(ids: readonly string[]): Map<string, Node>;
  /** Edges leaving a node, optionally restricted to the given relationship kinds. */
  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[]): Edge[];
  /** Edges entering a node, optionally restricted to the given relationship kinds. */
  getIncomingEdges(targetId: string, kinds?: EdgeKind[]): Edge[];
}

/** Whole-graph lookups used by file-level and catalogue queries. */
export interface GraphCatalog extends GraphReader {
  getNodesByFile(filePath: string): Node[];
  getNodesByKind(kind: NodeKind): Node[];
  getAllFiles(): ReadonlyArray<{ path: string }>;
  /** Files the given file's symbols reach through resolved cross-file edges. */
  getDependencyFilePaths(filePath: string): string[];
  /** Files whose symbols reach into the given file through resolved cross-file edges. */
  getDependentFilePaths(filePath: string): string[];
}

/** A node reached through an edge. */
export interface Reached {
  node: Node;
  edge: Edge;
}

/** An empty result for a start node that is not in the graph. */
export function emptyView(): { nodes: Map<string, Node>; edges: Edge[]; roots: string[] } {
  return { nodes: new Map(), edges: [], roots: [] };
}
