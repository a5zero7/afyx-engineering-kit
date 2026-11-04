/**
 * Private policy engine for the rich type-hierarchy query.
 *
 * This module owns bounded graph reads and result assembly. Public vocabulary stays in
 * `type-hierarchy.ts`, which is the stable facade used by the API and MCP surfaces.
 */

import type { Edge, EdgeKind, Node, NodeKind } from '../types';
import type {
  HierarchyEntry,
  HierarchyRelation,
  HierarchySource,
  OverrideMatch,
  TypeHierarchy,
} from './type-hierarchy';

export interface TypeHierarchyPolicy {
  eligibleKinds: ReadonlySet<NodeKind>;
  relationKinds: readonly EdgeKind[];
  overridableKinds: ReadonlySet<NodeKind>;
  ancestorDepth: number;
  descendantDepth: number;
  descendantRows: number;
  overrideAncestors: number;
  dispatchImplementers: number;
}

interface DescendantResult {
  entries: HierarchyEntry[];
  direct: number;
  implementers: number;
  bounded: boolean;
}

type Direction = 'parents' | 'children';

const relationOf = (edge: Edge): HierarchyRelation =>
  edge.kind === 'implements' ? 'implements' : 'extends';

const asEntry = (
  node: Node,
  depth: number,
  parentId: string,
  edge: Edge
): HierarchyEntry => ({
  node,
  depth,
  parentId,
  relation: relationOf(edge),
  edge,
  synthesized: edge.provenance === 'heuristic',
  hiddenSubtypes: 0,
});

/** Stable presentation order for rows discovered in one breadth-first layer. */
function present(entries: HierarchyEntry[]): void {
  entries.sort((left, right) => {
    const relation = Number(left.relation === 'implements') - Number(right.relation === 'implements');
    return relation ||
      left.node.name.localeCompare(right.node.name) ||
      left.node.filePath.localeCompare(right.node.filePath) ||
      left.node.startLine - right.node.startLine;
  });
}

class HierarchyQuery {
  constructor(
    private readonly source: HierarchySource,
    private readonly policy: TypeHierarchyPolicy
  ) {}

  execute(focus: Node, includeOverrides: boolean): TypeHierarchy | null {
    const ancestors = this.parentsOf(focus);
    const descendants = this.childrenOf(focus);
    if (ancestors.length === 0 && descendants.entries.length === 0) return null;

    return {
      focus,
      ancestors,
      descendants: descendants.entries,
      directSubtypes: descendants.direct,
      directImplementers: descendants.implementers,
      bounded: descendants.bounded,
      polymorphic: descendants.implementers >= this.policy.dispatchImplementers,
      overrides: includeOverrides ? this.overridesOf(focus, ancestors) : new Map(),
    };
  }

  private relations(ids: readonly string[], direction: Direction): Edge[] {
    try {
      const requested = [...this.policy.relationKinds];
      const found = direction === 'parents'
        ? this.source.getOutgoingEdgesFrom(ids, requested)
        : this.source.getIncomingEdgesTo(ids, requested);
      return found.filter((edge) => edge.kind === 'extends' || edge.kind === 'implements');
    } catch {
      return [];
    }
  }

  private parentsOf(focus: Node): HierarchyEntry[] {
    const result: HierarchyEntry[] = [];
    const discovered = new Set<string>([focus.id]);
    let current = [focus.id];

    for (let depth = 1; current.length > 0 && depth <= this.policy.ancestorDepth; depth++) {
      const links = this.relations(current, 'parents');
      if (links.length === 0) break;
      const nodes = this.source.getNodesByIds(links.map(({ target }) => target));
      const layer: HierarchyEntry[] = [];

      for (const link of links) {
        const node = nodes.get(link.target);
        if (!node || discovered.has(node.id)) continue;
        discovered.add(node.id);
        layer.push(asEntry(node, depth, link.source, link));
      }

      present(layer);
      result.push(...layer);
      current = layer.map(({ node }) => node.id);
    }
    return result;
  }

  private childrenOf(focus: Node): DescendantResult {
    const entries: HierarchyEntry[] = [];
    const entriesById = new Map<string, HierarchyEntry>();
    const discovered = new Set<string>([focus.id]);
    let current = [focus.id];
    let direct = 0;
    let implementers = 0;
    let bounded = false;

    for (let depth = 1; current.length > 0 && depth <= this.policy.descendantDepth; depth++) {
      const links = this.relations(current, 'children');
      if (links.length === 0) break;
      const nodes = this.source.getNodesByIds(links.map(({ source }) => source));
      const layer = new Map<string, HierarchyEntry>();
      const hiddenByParent = new Map<string, Set<string>>();

      for (const link of links) {
        const node = nodes.get(link.source);
        if (!node || discovered.has(node.id)) continue;

        const existing = layer.get(node.id);
        if (existing) {
          if (existing.relation === 'implements' && link.kind === 'extends') {
            existing.relation = 'extends';
            existing.edge = link;
            existing.synthesized = link.provenance === 'heuristic';
          }
          continue;
        }

        // Even when the row budget is exhausted, remember this identity. This keeps the
        // true direct count and hidden count immune to duplicate edges beyond the cap.
        const hidden = hiddenByParent.get(link.target);
        if (hidden?.has(node.id)) continue;

        if (depth === 1) {
          direct++;
          if (link.kind === 'implements') implementers++;
        }

        if (entries.length + layer.size >= this.policy.descendantRows) {
          bounded = true;
          const ids = hidden ?? new Set<string>();
          ids.add(node.id);
          hiddenByParent.set(link.target, ids);
          continue;
        }
        layer.set(node.id, asEntry(node, depth, link.target, link));
      }

      const ordered = [...layer.values()];
      present(ordered);
      for (const entry of ordered) {
        discovered.add(entry.node.id);
        entries.push(entry);
        entriesById.set(entry.node.id, entry);
      }
      for (const [parentId, hidden] of hiddenByParent) {
        const parent = entriesById.get(parentId);
        if (parent) parent.hiddenSubtypes += hidden.size;
      }
      if (bounded) break;

      current = ordered.map(({ node }) => node.id);
      if (depth === this.policy.descendantDepth && current.length > 0) {
        const hiddenByParentAtDepth = new Map<string, Set<string>>();
        for (const link of this.relations(current, 'children')) {
          if (discovered.has(link.source)) continue;
          bounded = true;
          const ids = hiddenByParentAtDepth.get(link.target) ?? new Set<string>();
          ids.add(link.source);
          hiddenByParentAtDepth.set(link.target, ids);
        }
        for (const [parentId, hidden] of hiddenByParentAtDepth) {
          const parent = entriesById.get(parentId);
          if (parent) parent.hiddenSubtypes += hidden.size;
        }
      }
    }
    return { entries, direct, implementers, bounded };
  }

  private overridesOf(
    focus: Node,
    ancestors: readonly HierarchyEntry[]
  ): Map<string, OverrideMatch> {
    const matches = new Map<string, OverrideMatch>();
    if (ancestors.length === 0) return matches;

    const own = this.membersOf([focus.id]);
    if (own.length === 0) return matches;
    const owners = ancestors.slice(0, this.policy.overrideAncestors);
    const inherited = this.membersOf(owners.map(({ node }) => node.id));
    if (inherited.length === 0) return matches;

    const hierarchyByOwner = new Map(owners.map((entry) => [entry.node.id, entry] as const));
    const nearestByName = new Map<string, { member: Node; ownerId: string }>();
    for (const candidate of inherited) {
      if (!nearestByName.has(candidate.member.name)) {
        nearestByName.set(candidate.member.name, candidate);
      }
    }

    for (const { member } of own) {
      if (!this.policy.overridableKinds.has(member.kind)) continue;
      const base = nearestByName.get(member.name);
      if (!base || base.member.id === member.id) continue;
      const owner = hierarchyByOwner.get(base.ownerId);
      if (!owner) continue;
      matches.set(member.id, {
        memberId: member.id,
        baseId: base.member.id,
        baseTypeId: owner.node.id,
        baseTypeName: owner.node.name,
        relation: owner.relation,
      });
    }
    return matches;
  }

  private membersOf(containerIds: readonly string[]): Array<{ member: Node; ownerId: string }> {
    if (containerIds.length === 0) return [];
    let links: Edge[];
    try {
      links = this.source.getOutgoingEdgesFrom(containerIds, ['contains']);
    } catch {
      return [];
    }
    if (links.length === 0) return [];

    const nodes = this.source.getNodesByIds(links.map(({ target }) => target));
    const ownerOrder = new Map(containerIds.map((id, index) => [id, index] as const));
    return links
      .flatMap((link) => {
        const member = nodes.get(link.target);
        return member ? [{ member, ownerId: link.source }] : [];
      })
      .sort((left, right) =>
        (ownerOrder.get(left.ownerId) ?? 0) - (ownerOrder.get(right.ownerId) ?? 0) ||
        left.member.startLine - right.member.startLine
      );
  }
}

export function evaluateTypeHierarchy(
  source: HierarchySource,
  focus: Node,
  policy: TypeHierarchyPolicy,
  includeOverrides: boolean
): TypeHierarchy | null {
  return new HierarchyQuery(source, policy).execute(focus, includeOverrides);
}

export function countDirectHierarchyChildren(
  source: HierarchySource,
  typeId: string,
  policy: Pick<TypeHierarchyPolicy, 'relationKinds'>
): number {
  try {
    const links = source.getIncomingEdgesTo([typeId], [...policy.relationKinds]);
    return new Set(links.map(({ source: childId }) => childId)).size;
  } catch {
    return 0;
  }
}
