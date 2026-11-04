/**
 * Shortest route between two nodes along outgoing edges.
 */

import type { Edge, EdgeKind, Node } from '../types';
import type { GraphReader } from './graph-store';

/** One stop on a route: the node, and the edge used to arrive (absent at the origin). */
export interface RouteStop {
  node: Node;
  edge: Edge | null;
}

interface Arrival {
  node: Node;
  edge: Edge | null;
  previous: number;
}

/**
 * Breadth-first search from `fromId` to `toId`, following only `kinds` when given.
 *
 * Returns the route with the fewest edges; among equal routes, the one that reaches the
 * target first in adjacency order. Arrivals are stored as a parent-linked list, so a
 * route is assembled once at the end instead of being copied at every step. `null`
 * when either node is missing or the target is unreachable.
 */
export function shortestRoute(
  store: GraphReader,
  fromId: string,
  toId: string,
  kinds: EdgeKind[] = []
): RouteStop[] | null {
  const origin = store.getNodeById(fromId);
  const goal = store.getNodeById(toId);
  if (!origin || !goal) return null;

  const arrivals: Arrival[] = [{ node: origin, edge: null, previous: -1 }];
  const claimed = new Set<string>([fromId]);
  const only = kinds.length > 0 ? kinds : undefined;

  for (let head = 0; head < arrivals.length; head++) {
    const here = arrivals[head]!;
    if (here.node.id === toId) return assemble(arrivals, head);

    const outgoing = store.getOutgoingEdges(here.node.id, only);
    if (outgoing.length === 0) continue;
    const unclaimed = outgoing.map((edge) => edge.target).filter((id) => !claimed.has(id));
    const found = unclaimed.length > 0 ? store.getNodesByIds(unclaimed) : new Map<string, Node>();

    for (const edge of outgoing) {
      if (claimed.has(edge.target)) continue;
      const node = found.get(edge.target);
      if (!node) continue;
      claimed.add(edge.target);
      arrivals.push({ node, edge, previous: head });
    }
  }
  return null;
}

function assemble(arrivals: Arrival[], last: number): RouteStop[] {
  const stops: RouteStop[] = [];
  for (let at = last; at >= 0; at = arrivals[at]!.previous) {
    stops.push({ node: arrivals[at]!.node, edge: arrivals[at]!.edge });
  }
  return stops.reverse();
}
