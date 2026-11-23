/**
 * Growing a context from its entry points.
 *
 * `ContextGraph` accumulates nodes and edges with set-backed deduplication (edges are
 * identified by source, target and kind) while preserving insertion order, which the
 * budget stage later relies on. Expansion happens in two passes: type hierarchies of
 * type-like entry points (so supertypes and subtypes always appear), then a bounded
 * breadth-first neighborhood around every entry point.
 */

import type { Edge, Node, NodeKind, SearchResult, Subgraph } from '../types';
import type { Backend } from './request';
import type { FindSettings } from './settings';

const TYPE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(['class', 'interface', 'struct', 'union', 'trait', 'protocol']);
const HIERARCHY_SHARE = 4;

/** Unambiguous edge identity: ids never contain a NUL. */
const edgeKey = (edge: Edge): string => `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;

export class ContextGraph {
  readonly nodes = new Map<string, Node>();
  readonly roots: string[] = [];
  private edgeList: Edge[] = [];
  private readonly edgeKeys = new Set<string>();

  get edges(): Edge[] {
    return this.edgeList;
  }

  addRoot(node: Node): void {
    this.nodes.set(node.id, node);
    this.roots.push(node.id);
  }

  /** True when the node was new. */
  addNode(node: Node): boolean {
    if (this.nodes.has(node.id)) return false;
    this.nodes.set(node.id, node);
    return true;
  }

  /** True when the edge was new. */
  addEdge(edge: Edge): boolean {
    const key = edgeKey(edge);
    if (this.edgeKeys.has(key)) return false;
    this.edgeKeys.add(key);
    this.edgeList.push(edge);
    return true;
  }

  replaceEdges(edges: Edge[]): void {
    this.edgeList = edges;
    this.edgeKeys.clear();
    for (const edge of edges) this.edgeKeys.add(edgeKey(edge));
  }

  hasEdge(edge: Edge): boolean {
    return this.edgeKeys.has(edgeKey(edge));
  }

  toSubgraph(confidence: 'high' | 'low'): Subgraph {
    return { nodes: this.nodes, edges: this.edgeList, roots: this.roots, confidence };
  }
}

/**
 * Breadth-first search spends its per-entry budget on contained members before it
 * reaches extends/implements neighbours, so hierarchies get a dedicated pass with a
 * budget of a quarter of the node limit: first the hierarchy of each type entry
 * point, then the hierarchy of the parents just found, which surfaces siblings.
 */
export function expandHierarchies(graph: ContextGraph, entries: readonly SearchResult[], settings: FindSettings, backend: Backend): void {
  const budget = Math.ceil(settings.maxNodes / HIERARCHY_SHARE);
  let added = 0;

  for (const { node } of entries) {
    if (added >= budget) break;
    if (!TYPE_KINDS.has(node.kind)) continue;
    const hierarchy = backend.traverser.getTypeHierarchy(node.id);
    for (const member of hierarchy.nodes.values()) {
      if (graph.addNode(member)) added++;
    }
    for (const edge of hierarchy.edges) graph.addEdge(edge);
  }
  if (added === 0) return;

  const rootIds = new Set(graph.roots);
  const parents = [...graph.nodes.values()].filter((candidate) => TYPE_KINDS.has(candidate.kind) && !rootIds.has(candidate.id));
  for (const parent of parents) {
    if (added >= budget) break;
    const family = backend.traverser.getTypeHierarchy(parent.id);
    for (const member of family.nodes.values()) {
      if (added < budget && graph.addNode(member)) added++;
    }
    for (const edge of family.edges) {
      if (graph.nodes.has(edge.source) && graph.nodes.has(edge.target)) graph.addEdge(edge);
    }
  }
}

/** Each entry point gets an equal share of the node budget for its own neighbourhood. */
export function expandNeighborhoods(graph: ContextGraph, entries: readonly SearchResult[], settings: FindSettings, backend: Backend): void {
  const share = Math.ceil(settings.maxNodes / Math.max(1, entries.length));
  const edgeKinds = settings.edgeKinds && settings.edgeKinds.length > 0 ? settings.edgeKinds : undefined;
  const nodeKinds = settings.nodeKinds && settings.nodeKinds.length > 0 ? settings.nodeKinds : undefined;
  for (const { node } of entries) {
    const around = backend.traverser.traverseBFS(node.id, { maxDepth: settings.traversalDepth, edgeKinds, nodeKinds, direction: 'both', limit: share });
    for (const neighbor of around.nodes.values()) graph.addNode(neighbor);
    for (const edge of around.edges) graph.addEdge(edge);
  }
}
