/**
 * Graph traversal facade.
 *
 * `GraphTraverser` is the object the rest of the engine holds. It owns no algorithm of
 * its own: each operation is a thin call into a focused module, so the traversal
 * policies (frontier walks, relationship walks, routes, containment) can be read and
 * tested one at a time.
 */

import type { Edge, EdgeKind, Node, Subgraph, TraversalOptions } from '../types';
import { containersAbove, membersOf } from './containment';
import { breadthFirst, depthFirst } from './frontier-walk';
import type { GraphReader, Reached } from './graph-store';
import { calleesOf, callersOf, callGraphAround, impactOf, typeViewOf, usagesOf } from './relations';
import { shortestRoute } from './route';

export class GraphTraverser {
  private readonly store: GraphReader;

  constructor(store: GraphReader) {
    this.store = store;
  }

  /** Breadth-first walk from `startId`; see `frontier-walk.ts` for the budget and dedup rules. */
  traverseBFS(startId: string, options: TraversalOptions = {}): Subgraph {
    return breadthFirst(this.store, startId, options);
  }

  /** Depth-first walk from `startId`. */
  traverseDFS(startId: string, options: TraversalOptions = {}): Subgraph {
    return depthFirst(this.store, startId, options);
  }

  /** Symbols that call (or reference, import, instantiate, navigate to) `nodeId`, to `maxDepth` hops. */
  getCallers(nodeId: string, maxDepth: number = 1): Reached[] {
    return callersOf(this.store, nodeId, maxDepth);
  }

  /** Symbols `nodeId` calls (or references, imports, instantiates, navigates to), to `maxDepth` hops. */
  getCallees(nodeId: string, maxDepth: number = 1): Reached[] {
    return calleesOf(this.store, nodeId, maxDepth);
  }

  /** The node together with its callers and callees to `depth` hops each way. */
  getCallGraph(nodeId: string, depth: number = 2): Subgraph {
    return callGraphAround(this.store, nodeId, depth);
  }

  /** The node and the types above it in the `extends`/`implements` hierarchy. */
  getTypeHierarchy(nodeId: string): Subgraph {
    return typeViewOf(this.store, nodeId);
  }

  /** Every edge into `nodeId` with the node it comes from. */
  findUsages(nodeId: string): Reached[] {
    return usagesOf(this.store, nodeId);
  }

  /** Nodes that could be affected by changing `nodeId`, to `maxDepth` hops. */
  getImpactRadius(nodeId: string, maxDepth: number = 3): Subgraph {
    return impactOf(this.store, nodeId, maxDepth);
  }

  /** Fewest-edges route along outgoing edges (of `edgeKinds`, when given), or null. */
  findPath(
    fromId: string,
    toId: string,
    edgeKinds: EdgeKind[] = []
  ): Array<{ node: Node; edge: Edge | null }> | null {
    return shortestRoute(this.store, fromId, toId, edgeKinds);
  }

  /** Containers above a node, nearest first. */
  getAncestors(nodeId: string): Node[] {
    return containersAbove(this.store, nodeId);
  }

  /** Members directly contained by a node. */
  getChildren(nodeId: string): Node[] {
    return membersOf(this.store, nodeId);
  }
}
