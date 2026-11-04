/**
 * Walk requests: how a caller's traversal options become a concrete plan, and how a
 * direction turns into the edges to follow from a node.
 */

import type { Edge, EdgeKind, Node, TraversalOptions } from '../types';
import type { GraphReader } from './graph-store';

/** A traversal request with every knob resolved. */
export type WalkRequest = Required<TraversalOptions>;

const BASELINE_REQUEST: WalkRequest = {
  maxDepth: Infinity,
  edgeKinds: [],
  nodeKinds: [],
  direction: 'outgoing',
  limit: 1000,
  includeStart: true,
};

/**
 * Resolve options over the baseline.
 *
 * A key the caller passes explicitly as `undefined` replaces the baseline value rather
 * than falling back to it, and the walks compare against such values as-is. Callers
 * depend on this (for example `limit: undefined` yields just the start node), so the
 * merge is a plain overlay.
 */
export function resolveWalkRequest(options: TraversalOptions = {}): WalkRequest {
  return Object.assign({}, BASELINE_REQUEST, options);
}

/** Relationship-kind filter as the store expects it: absent when nothing is restricted. */
function restrictKinds(kinds: EdgeKind[] | undefined): EdgeKind[] | undefined {
  return kinds && kinds.length > 0 ? kinds : undefined;
}

/**
 * Edges to follow from a node. `outgoing` and `incoming` are single lookups; anything
 * else means both, listing the node's outgoing edges before its incoming ones.
 */
export function edgesAround(
  store: GraphReader,
  nodeId: string,
  direction: WalkRequest['direction'],
  kinds: EdgeKind[] | undefined
): Edge[] {
  const only = restrictKinds(kinds);
  if (direction === 'outgoing') return store.getOutgoingEdges(nodeId, only);
  if (direction === 'incoming') return store.getIncomingEdges(nodeId, only);
  const leaving = store.getOutgoingEdges(nodeId, only);
  const entering = store.getIncomingEdges(nodeId, only);
  return leaving.concat(entering);
}

/** The endpoint of an edge that is not `from` (the target, for a self edge). */
export function farEnd(edge: Edge, from: string): string {
  return edge.source === from ? edge.target : edge.source;
}

/** Whether a node kind passes the request's node-kind filter (an empty filter passes all). */
export function passesKindFilter(request: WalkRequest, node: Node): boolean {
  const wanted = request.nodeKinds;
  return !(wanted && wanted.length > 0) || wanted.includes(node.kind);
}

/** Two edges are the same edge when endpoint, kind and call-site position all agree. */
export function edgeIdentity(edge: Edge): string {
  return [edge.source, edge.target, edge.kind, edge.line ?? -1, edge.column ?? -1].join('|');
}
