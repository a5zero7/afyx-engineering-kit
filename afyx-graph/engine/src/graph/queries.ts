/**
 * Graph query manager.
 *
 * Whole-node and whole-graph questions asked of the code graph: everything known about
 * a symbol, file dependencies, exported symbols, name patterns, layout, cycles, metrics,
 * unreferenced code and filtered subgraphs. Each answer is assembled from the focused
 * modules beside it; the manager itself holds only the store and a traverser.
 */

import type { Context, Edge, EdgeKind, Node, NodeKind, Subgraph } from '../types';
import { matchQualifiedNames, subgraphWhere, unreferencedSymbols } from './catalog';
import { dependencyCycles, directoryLayout } from './file-graph';
import type { GraphCatalog, Reached } from './graph-store';
import { GraphTraverser } from './traversal';

/** Pair each edge with the node at its `end`, skipping edges whose node no longer exists. */
function attachNodes(catalog: GraphCatalog, edges: Edge[], end: 'source' | 'target'): Reached[] {
  if (edges.length === 0) return [];
  const found = catalog.getNodesByIds(edges.map((edge) => edge[end]));
  const attached: Reached[] = [];
  for (const edge of edges) {
    const node = found.get(edge[end]);
    if (node) attached.push({ node, edge });
  }
  return attached;
}

export class GraphQueryManager {
  private readonly catalog: GraphCatalog;
  private readonly traverser: GraphTraverser;

  constructor(catalog: GraphCatalog) {
    this.catalog = catalog;
    this.traverser = new GraphTraverser(catalog);
  }

  /**
   * Everything known about one node: its containers and members, the references into
   * and out of it (containment excluded — it is already in `ancestors`/`children`),
   * the types it is annotated with, and the imports of its file.
   *
   * @throws Error when the node does not exist
   */
  getContext(nodeId: string): Context {
    const focal = this.catalog.getNodeById(nodeId);
    if (!focal) throw new Error(`Node not found: ${nodeId}`);

    const ancestors = this.traverser.getAncestors(nodeId);
    const children = this.traverser.getChildren(nodeId);

    const notContainment = (edge: Edge): boolean => edge.kind !== 'contains';
    const incomingRefs = attachNodes(this.catalog, this.catalog.getIncomingEdges(nodeId).filter(notContainment), 'source');
    const outgoingRefs = attachNodes(this.catalog, this.catalog.getOutgoingEdges(nodeId).filter(notContainment), 'target');

    // Annotation targets, `type_of` before `returns`, each type listed once.
    const types = new Map<string, Node>();
    for (const kind of ['type_of', 'returns'] as EdgeKind[]) {
      for (const { node } of attachNodes(this.catalog, this.catalog.getOutgoingEdges(nodeId, [kind]), 'target')) {
        if (!types.has(node.id)) types.set(node.id, node);
      }
    }

    const file = ancestors.find((ancestor) => ancestor.kind === 'file');
    const imports = file
      ? attachNodes(this.catalog, this.catalog.getOutgoingEdges(file.id, ['imports']), 'target').map(({ node }) => node)
      : [];

    return { focal, ancestors, children, incomingRefs, outgoingRefs, types: [...types.values()], imports };
  }

  /**
   * Files this file depends on. Cross-file dependencies live in the resolved symbol
   * edges (calls, references, instantiates, extends, ...), not in `imports`, which
   * only link a file to its own import declarations; the store projects that graph.
   */
  getFileDependencies(filePath: string): string[] {
    return this.catalog.getDependencyFilePaths(filePath);
  }

  /** Files that depend on this file, by the same resolved symbol edges. */
  getFileDependents(filePath: string): string[] {
    return this.catalog.getDependentFilePaths(filePath);
  }

  /** Symbols a file exports. */
  getExportedSymbols(filePath: string): Node[] {
    return this.catalog.getNodesByFile(filePath).filter((node) => node.isExported);
  }

  /** Symbols whose qualified name matches a glob (`*` and `?` wildcards). */
  findByQualifiedName(pattern: string): Node[] {
    return matchQualifiedNames(this.catalog, pattern);
  }

  /** Files grouped by directory. */
  getModuleStructure(): Map<string, string[]> {
    return directoryLayout(this.catalog);
  }

  /** Cycles among file dependencies, each as the ordered list of files in the cycle. */
  findCircularDependencies(): string[][] {
    return dependencyCycles(this.catalog);
  }

  /** Edge counts, child count and containment depth of a node. */
  getNodeMetrics(nodeId: string): {
    incomingEdgeCount: number;
    outgoingEdgeCount: number;
    callCount: number;
    callerCount: number;
    childCount: number;
    depth: number;
  } {
    const incoming = this.catalog.getIncomingEdges(nodeId);
    const outgoing = this.catalog.getOutgoingEdges(nodeId);
    const count = (edges: Edge[], kind: EdgeKind): number => edges.filter((edge) => edge.kind === kind).length;

    return {
      incomingEdgeCount: incoming.length,
      outgoingEdgeCount: outgoing.length,
      callCount: count(outgoing, 'calls'),
      callerCount: count(incoming, 'calls'),
      childCount: count(outgoing, 'contains'),
      depth: this.traverser.getAncestors(nodeId).length,
    };
  }

  /** Non-exported symbols (functions, methods and classes unless `kinds` says otherwise) nothing references. */
  findDeadCode(kinds?: NodeKind[]): Node[] {
    return unreferencedSymbols(this.catalog, kinds);
  }

  /** Nodes accepted by `filter`, with the edges between them unless `includeEdges` is false. */
  getFilteredSubgraph(filter: (node: Node) => boolean, includeEdges: boolean = true): Subgraph {
    return subgraphWhere(this.catalog, filter, includeEdges);
  }

  /** The traverser this manager uses, for direct traversal operations. */
  getTraverser(): GraphTraverser {
    return this.traverser;
  }
}
