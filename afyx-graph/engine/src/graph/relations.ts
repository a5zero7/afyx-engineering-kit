/**
 * Relationship walks over the code graph: who reaches a symbol, what a symbol reaches,
 * the call graph around it, its usages, its supertypes and its blast radius.
 *
 * Every walk here is an explicit-stack pre-order descent with a membership set, so
 * cycles terminate and depth costs heap, not call stack. Results list nodes in the
 * order the descent first meets them.
 */

import type { Edge, EdgeKind, Node, Subgraph } from '../types';
import { emptyView, type GraphReader, type Reached } from './graph-store';

/**
 * Edges that make one symbol a caller of another. `instantiates` counts: constructing a
 * class is calling its constructor, so callers of a class include its construction
 * sites, and callers/callees stay inverses of each other.
 */
const CALLING_KINDS: EdgeKind[] = ['calls', 'references', 'imports', 'instantiates', 'navigates'];

const SUBTYPING_KINDS: EdgeKind[] = ['extends', 'implements'];

/** Node kinds whose members are part of the symbol when asking who would be affected. */
const MEMBER_HOLDING_KINDS: ReadonlySet<string> = new Set([
  'class', 'interface', 'struct', 'union', 'trait', 'protocol', 'module', 'enum',
]);

type Side = 'incoming' | 'outgoing';

interface HopFrame {
  depth: number;
  edges: Edge[];
  found: Map<string, Node>;
  cursor: number;
}

/**
 * Nodes reached by repeatedly following calling edges from `startId` on one side.
 *
 * A node is marked as soon as it is met — including at the depth boundary, where it is
 * reported but not expanded — so it is reported once even when several edges lead to
 * it. The start node is never reported.
 */
function followCalls(store: GraphReader, startId: string, maxDepth: number, side: Side): Reached[] {
  const out: Reached[] = [];
  const met = new Set<string>();
  const endOf = (edge: Edge): string => (side === 'incoming' ? edge.source : edge.target);

  const open = (id: string, depth: number): HopFrame | null => {
    if (met.has(id)) return null;
    met.add(id);
    if (depth >= maxDepth) return null;
    const edges =
      side === 'incoming' ? store.getIncomingEdges(id, CALLING_KINDS) : store.getOutgoingEdges(id, CALLING_KINDS);
    if (edges.length === 0) return null;
    return { depth, edges, found: store.getNodesByIds(edges.map(endOf)), cursor: 0 };
  };

  const root = open(startId, 0);
  const stack: HopFrame[] = root ? [root] : [];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.cursor >= frame.edges.length) {
      stack.pop();
      continue;
    }
    const edge = frame.edges[frame.cursor++]!;
    const node = frame.found.get(endOf(edge));
    if (!node || met.has(node.id)) continue;
    out.push({ node, edge });
    const next = open(node.id, frame.depth + 1);
    if (next) stack.push(next);
  }
  return out;
}

/** Symbols that call, reference, import, instantiate or navigate to `nodeId`. */
export function callersOf(store: GraphReader, nodeId: string, maxDepth: number): Reached[] {
  return followCalls(store, nodeId, maxDepth, 'incoming');
}

/** Symbols that `nodeId` calls, references, imports, instantiates or navigates to. */
export function calleesOf(store: GraphReader, nodeId: string, maxDepth: number): Reached[] {
  return followCalls(store, nodeId, maxDepth, 'outgoing');
}

/** The focal node with its callers, then its callees, to `depth` in each direction. */
export function callGraphAround(store: GraphReader, nodeId: string, depth: number): Subgraph {
  const focal = store.getNodeById(nodeId);
  if (!focal) return emptyView();

  const nodes = new Map<string, Node>([[focal.id, focal]]);
  const edges: Edge[] = [];
  for (const { node, edge } of callersOf(store, nodeId, depth).concat(calleesOf(store, nodeId, depth))) {
    nodes.set(node.id, node);
    edges.push(edge);
  }
  return { nodes, edges, roots: [nodeId] };
}

/** Every edge into `nodeId`, with the node it comes from (edges whose source is gone are dropped). */
export function usagesOf(store: GraphReader, nodeId: string): Reached[] {
  const incoming = store.getIncomingEdges(nodeId);
  if (incoming.length === 0) return [];
  const sources = store.getNodesByIds(incoming.map((edge) => edge.source));
  const out: Reached[] = [];
  for (const edge of incoming) {
    const node = sources.get(edge.source);
    if (node) out.push({ node, edge });
  }
  return out;
}

interface SupertypeFrame {
  edges: Edge[];
  found: Map<string, Node>;
  cursor: number;
}

/**
 * The type hierarchy view of a node: the node and the types it extends or implements,
 * transitively, nearest first.
 *
 * The view has never included subtypes: the subtype pass of the original hierarchy
 * query shared its membership set with the supertype pass and so could not start. That
 * behaviour is kept as-is; the full up-and-down hierarchy lives in `type-hierarchy.ts`.
 */
export function typeViewOf(store: GraphReader, nodeId: string): Subgraph {
  const focal = store.getNodeById(nodeId);
  if (!focal) return emptyView();

  const nodes = new Map<string, Node>([[focal.id, focal]]);
  const edges: Edge[] = [];
  const opened = new Set<string>();

  const open = (id: string): SupertypeFrame | null => {
    if (opened.has(id)) return null;
    opened.add(id);
    const upward = store.getOutgoingEdges(id, SUBTYPING_KINDS);
    if (upward.length === 0) return null;
    return { edges: upward, found: store.getNodesByIds(upward.map((edge) => edge.target)), cursor: 0 };
  };

  const root = open(nodeId);
  const stack: SupertypeFrame[] = root ? [root] : [];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.cursor >= frame.edges.length) {
      stack.pop();
      continue;
    }
    const edge = frame.edges[frame.cursor++]!;
    const parent = frame.found.get(edge.target);
    if (!parent || nodes.has(parent.id)) continue;
    nodes.set(parent.id, parent);
    edges.push(edge);
    const next = open(parent.id);
    if (next) stack.push(next);
  }
  return { nodes, edges, roots: [nodeId] };
}

interface ReachFrame {
  depth: number;
  members: Array<{ edge: Edge; member: Node | undefined }>;
  dependents: Array<{ edge: Edge; dependent: Node | undefined }>;
  nextMember: number;
  nextDependent: number;
}

/**
 * Everything that could be affected by changing `nodeId`: the nodes that depend on it,
 * transitively, up to `maxDepth` hops.
 *
 * Members of a class-like node count as part of it, so their dependents are included at
 * the same depth. Containment is never followed upward — a container holds its members
 * but does not depend on them — and every dependency edge is recorded, including a
 * second edge into a node that was already collected.
 */
export function impactOf(store: GraphReader, nodeId: string, maxDepth: number): Subgraph {
  const focal = store.getNodeById(nodeId);
  if (!focal) return emptyView();

  const nodes = new Map<string, Node>([[focal.id, focal]]);
  const edges: Edge[] = [];
  const met = new Set<string>();

  const open = (node: Node, depth: number): ReachFrame | null => {
    if (met.has(node.id)) return null;
    met.add(node.id);
    if (depth >= maxDepth) return null;

    let members: ReachFrame['members'] = [];
    if (MEMBER_HOLDING_KINDS.has(node.kind)) {
      const contained = store.getOutgoingEdges(node.id, ['contains']);
      if (contained.length > 0) {
        const found = store.getNodesByIds(contained.map((edge) => edge.target));
        members = contained.map((edge) => ({ edge, member: found.get(edge.target) }));
      }
    }

    let dependents: ReachFrame['dependents'] = [];
    const incoming = store.getIncomingEdges(node.id).filter((edge) => edge.kind !== 'contains');
    if (incoming.length > 0) {
      const found = store.getNodesByIds(incoming.map((edge) => edge.source));
      dependents = incoming.map((edge) => ({ edge, dependent: found.get(edge.source) }));
    }
    return { depth, members, dependents, nextMember: 0, nextDependent: 0 };
  };

  const root = open(focal, 0);
  const stack: ReachFrame[] = root ? [root] : [];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.nextMember < frame.members.length) {
      const { edge, member } = frame.members[frame.nextMember++]!;
      if (member && !met.has(member.id)) {
        nodes.set(member.id, member);
        edges.push(edge);
        // A member is part of the same symbol, so it is explored at the same depth.
        const next = open(member, frame.depth);
        if (next) stack.push(next);
      }
    } else if (frame.nextDependent < frame.dependents.length) {
      const { edge, dependent } = frame.dependents[frame.nextDependent++]!;
      if (!dependent) continue;
      edges.push(edge);
      if (!met.has(dependent.id)) {
        nodes.set(dependent.id, dependent);
        const next = open(dependent, frame.depth + 1);
        if (next) stack.push(next);
      }
    } else {
      stack.pop();
    }
  }
  return { nodes, edges, roots: [nodeId] };
}
