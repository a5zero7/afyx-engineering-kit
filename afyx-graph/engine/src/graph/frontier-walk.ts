/**
 * Frontier walks: breadth-first and depth-first exploration from one node.
 *
 * Both are bounded (depth and node budget), cycle-safe, and deterministic for a given
 * store: the order results appear in follows adjacency order, never a hash or timer.
 * The depth-first walk keeps its own explicit stack, so a long chain costs heap rather
 * than call-stack depth.
 */

import type { Edge, Node, Subgraph, TraversalOptions } from '../types';
import { emptyView, type GraphReader } from './graph-store';
import { edgeIdentity, edgesAround, farEnd, passesKindFilter, resolveWalkRequest } from './walk-request';

/** Structural links are explored ahead of everything else; ties keep adjacency order. */
function structuralFirst(edges: Edge[]): Edge[] {
  const containment: Edge[] = [];
  const calls: Edge[] = [];
  const rest: Edge[] = [];
  for (const edge of edges) {
    (edge.kind === 'contains' ? containment : edge.kind === 'calls' ? calls : rest).push(edge);
  }
  return containment.concat(calls, rest);
}

/**
 * Breadth-first walk.
 *
 * Every node is scheduled at most once, so a target reachable through several edges is
 * expanded once while each distinct edge (endpoints, kind, call site) is still
 * recorded exactly once. The node budget is enforced when a node is added, so one
 * high-degree node cannot overshoot it.
 */
export function breadthFirst(store: GraphReader, startId: string, options: TraversalOptions = {}): Subgraph {
  const request = resolveWalkRequest(options);
  const start = store.getNodeById(startId);
  if (!start) return emptyView();

  const reached = new Map<string, Node>();
  const recorded: Edge[] = [];
  const scheduled = new Set<string>([start.id]);
  const recordedEdges = new Set<string>();
  const line: Array<{ node: Node; depth: number }> = [{ node: start, depth: 0 }];
  if (request.includeStart) reached.set(start.id, start);

  for (let head = 0; head < line.length && reached.size < request.limit; head++) {
    const { node, depth } = line[head]!;
    if (depth >= request.maxDepth) continue;

    const adjacent = structuralFirst(edgesAround(store, node.id, request.direction, request.edgeKinds));

    // One lookup for every neighbour not yet scheduled; scheduled ones are already known.
    const unseen = adjacent.map((edge) => farEnd(edge, node.id)).filter((id) => !scheduled.has(id));
    const fetched = unseen.length > 0 ? store.getNodesByIds(unseen) : new Map<string, Node>();

    for (const edge of adjacent) {
      const neighbourId = farEnd(edge, node.id);
      const neighbour = fetched.get(neighbourId) ?? reached.get(neighbourId);
      if (!neighbour || !passesKindFilter(request, neighbour)) continue;

      if (!scheduled.has(neighbourId)) {
        if (reached.size >= request.limit) continue;
        scheduled.add(neighbourId);
        reached.set(neighbour.id, neighbour);
        line.push({ node: neighbour, depth: depth + 1 });
      }

      const identity = edgeIdentity(edge);
      if (!recordedEdges.has(identity)) {
        recordedEdges.add(identity);
        recorded.push(edge);
      }
    }
  }

  return { nodes: reached, edges: recorded, roots: [startId] };
}

interface DescentFrame {
  node: Node;
  depth: number;
  adjacent: Edge[];
  neighbours: Map<string, Node>;
  cursor: number;
}

/**
 * Depth-first walk.
 *
 * A node is expanded at most once. Unlike the breadth-first walk, every edge followed
 * into a node is recorded (parallel edges included), and a node that sits at the depth
 * boundary may be reported again through another path because it is never expanded.
 */
export function depthFirst(store: GraphReader, startId: string, options: TraversalOptions = {}): Subgraph {
  const request = resolveWalkRequest(options);
  const start = store.getNodeById(startId);
  if (!start) return emptyView();

  const reached = new Map<string, Node>();
  const recorded: Edge[] = [];
  const expanded = new Set<string>();
  if (request.includeStart) reached.set(start.id, start);

  const descend = (node: Node, depth: number): DescentFrame | null => {
    if (expanded.has(node.id) || reached.size >= request.limit || depth >= request.maxDepth) return null;
    expanded.add(node.id);
    const adjacent = edgesAround(store, node.id, request.direction, request.edgeKinds);
    const unseen = adjacent.map((edge) => farEnd(edge, node.id)).filter((id) => !expanded.has(id));
    const neighbours = unseen.length > 0 ? store.getNodesByIds(unseen) : new Map<string, Node>();
    return { node, depth, adjacent, neighbours, cursor: 0 };
  };

  const first = descend(start, 0);
  const stack: DescentFrame[] = first ? [first] : [];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.cursor >= frame.adjacent.length || reached.size >= request.limit) {
      stack.pop();
      continue;
    }

    const edge = frame.adjacent[frame.cursor++]!;
    const neighbourId = farEnd(edge, frame.node.id);
    if (expanded.has(neighbourId)) continue;
    const neighbour = frame.neighbours.get(neighbourId);
    if (!neighbour || !passesKindFilter(request, neighbour)) continue;

    reached.set(neighbour.id, neighbour);
    recorded.push(edge);
    const next = descend(neighbour, frame.depth + 1);
    if (next) stack.push(next);
  }

  return { nodes: reached, edges: recorded, roots: [startId] };
}
