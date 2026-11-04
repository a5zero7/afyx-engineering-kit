/**
 * Type hierarchy: the supertypes above a type, the subtypes below it, and how many
 * implementations a call through it can reach.
 *
 * The viewer's hierarchy block, `afyx_graph_explore`'s interface-dispatch boundary and
 * `afyx_graph_node`'s relation chips all need the same answer, so it is derived here
 * once and each surface only renders it.
 *
 * Everything is query-time and read-only, built from the `extends` / `implements` edges
 * the graph holds. The one derived fact — which members redeclare an ancestor's — is a
 * by-name match along a chain the graph already links, reported as a match rather than
 * as an edge (no extractor emits an `overrides` edge).
 *
 * Downward walks matter more than upward ones: ancestors are written in the file being
 * read, while implementations can live anywhere. Synthesized links (for example Go's
 * implicit interface satisfaction) carry their provenance so callers can draw them
 * differently.
 */

import type { Edge, EdgeKind, Node, NodeKind } from '../types';
import {
  countDirectHierarchyChildren,
  evaluateTypeHierarchy,
  type TypeHierarchyPolicy,
} from './type-hierarchy-policy';

/** The two edge kinds that make a type hierarchy. */
export const HIERARCHY_EDGE_KINDS: readonly EdgeKind[] = ['extends', 'implements'];

/**
 * Node kinds that can sit in a type hierarchy. `type_alias` is included because an
 * aliased type with subtypes is a real hierarchy however it was spelled, and `enum`
 * because Java, Kotlin and Swift enums implement interfaces.
 */
export const HIERARCHY_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'class', 'interface', 'struct', 'trait', 'protocol', 'enum', 'type_alias', 'union',
]);

/** Member kinds an override can be declared on. */
const OVERRIDABLE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(['method', 'function', 'property', 'field']);

/** Levels walked upward; a longer chain is a generated-code artefact. */
export const MAX_ANCESTOR_DEPTH = 8;

/** Levels walked downward. Depth only — the fan itself is capped separately. */
export const MAX_DESCENDANT_DEPTH = 6;

/**
 * Subtypes returned over the whole downward walk. When it bites, `bounded` says so, so a
 * fan that stopped early never reads as a complete answer.
 */
export const MAX_DESCENDANTS = 400;

/** Ancestors whose members are read when matching overrides. */
const MAX_OVERRIDE_ANCESTORS = 12;

/**
 * Implementations at or above which a call through the type cannot be resolved
 * statically — the threshold `afyx_graph_explore` uses to announce a dispatch boundary.
 */
export const DISPATCH_MIN_IMPLEMENTERS = 8;

/** How a subtype is tied to the type above it. */
export type HierarchyRelation = 'extends' | 'implements';

/** One type in the tree, and the single edge that puts it there. */
export interface HierarchyEntry {
  node: Node;
  /** Steps from the focus. 1 = declared directly on the focus (either way). */
  depth: number;
  /** The entry one step nearer the focus (the focus's own id at depth 1). */
  parentId: string;
  relation: HierarchyRelation;
  /** The edge, oriented subtype → supertype as the code declares it. */
  edge: Edge;
  /** The edge was synthesized rather than parsed. */
  synthesized: boolean;
  /** Direct subtypes this entry has that are not in the returned set. */
  hiddenSubtypes: number;
}

/** A member of the focus that redeclares a member of one of its ancestors. */
export interface OverrideMatch {
  /** The member on the focus. */
  memberId: string;
  /** The member it redeclares. */
  baseId: string;
  /** The ancestor type that declares `baseId`. */
  baseTypeId: string;
  baseTypeName: string;
  /** How the focus reaches that ancestor — `implements` reads as "satisfies". */
  relation: HierarchyRelation;
}

/** What is above a type, what is below it, and what a call through it reaches. */
export interface TypeHierarchy {
  focus: Node;
  /** Supertypes, nearest first, the focus's own parents leading. */
  ancestors: HierarchyEntry[];
  /** Subtypes, level by level, so depth 1 is complete before depth 2 begins. */
  descendants: HierarchyEntry[];
  /** True number of direct subtypes, whatever `descendants` was capped to. */
  directSubtypes: number;
  /** Of `directSubtypes`, the ones tied by `implements`. */
  directImplementers: number;
  /** The downward walk hit `MAX_DESCENDANTS` or `MAX_DESCENDANT_DEPTH`. */
  bounded: boolean;
  /** A call through this type dispatches at runtime (`directImplementers >= DISPATCH_MIN_IMPLEMENTERS`). */
  polymorphic: boolean;
  /** Members of the focus that redeclare an ancestor's, keyed by member id. */
  overrides: Map<string, OverrideMatch>;
}

/** The lookups the hierarchy walk needs; the engine facade provides all of them. */
export interface HierarchySource {
  getNodesByIds(ids: readonly string[]): Map<string, Node>;
  getOutgoingEdgesFrom(nodeIds: readonly string[], kinds?: EdgeKind[]): Edge[];
  getIncomingEdgesTo(nodeIds: readonly string[], kinds?: EdgeKind[]): Edge[];
}

const TYPE_HIERARCHY_POLICY: TypeHierarchyPolicy = {
  eligibleKinds: HIERARCHY_KINDS,
  relationKinds: HIERARCHY_EDGE_KINDS,
  overridableKinds: OVERRIDABLE_KINDS,
  ancestorDepth: MAX_ANCESTOR_DEPTH,
  descendantDepth: MAX_DESCENDANT_DEPTH,
  descendantRows: MAX_DESCENDANTS,
  overrideAncestors: MAX_OVERRIDE_ANCESTORS,
  dispatchImplementers: DISPATCH_MIN_IMPLEMENTERS,
};

/** Whether a node could have a hierarchy at all — a cheap gate before doing any work. */
export function canHaveHierarchy(node: Node): boolean {
  return HIERARCHY_KINDS.has(node.kind);
}

/**
 * The whole hierarchy of one type: one batched edge read per level in each direction
 * plus one batched member read, never a read per node.
 *
 * Returns `null` when the node cannot have a hierarchy or has no `extends`/`implements`
 * edge in either direction, so callers can gate on the result.
 */
export function buildTypeHierarchy(
  source: HierarchySource,
  focus: Node,
  options: { overrides?: boolean } = {}
): TypeHierarchy | null {
  if (!canHaveHierarchy(focus)) return null;
  return evaluateTypeHierarchy(source, focus, TYPE_HIERARCHY_POLICY, options.overrides !== false);
}

/**
 * How many distinct types extend or implement this one — the number
 * `afyx_graph_explore` prints for a dispatch boundary and the viewer's fan draws.
 * Distinct types, not edges: one class tied by both `extends` and a synthesized
 * `implements` is one implementation.
 */
export function countImplementers(source: HierarchySource, typeId: string): number {
  return countDirectHierarchyChildren(source, typeId, TYPE_HIERARCHY_POLICY);
}
