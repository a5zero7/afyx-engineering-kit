import { describe, expect, it } from 'vitest';
import type { Edge, EdgeKind, Node, NodeKind } from '../src/types';
import {
  buildTypeHierarchy,
  canHaveHierarchy,
  countImplementers,
  DISPATCH_MIN_IMPLEMENTERS,
  HIERARCHY_KINDS,
  MAX_ANCESTOR_DEPTH,
  MAX_DESCENDANT_DEPTH,
  MAX_DESCENDANTS,
  type HierarchySource,
} from '../src/graph/type-hierarchy';

const node = (id: string, kind: NodeKind = 'class', filePath = `src/${id}.ts`, startLine = 1): Node => ({
  id,
  kind,
  name: id,
  qualifiedName: id,
  filePath,
  startLine,
  endLine: startLine,
  startColumn: 0,
  endColumn: 1,
  language: 'typescript',
});

const edge = (
  source: string,
  target: string,
  kind: EdgeKind = 'extends',
  extra: Partial<Edge> = {}
): Edge => ({ source, target, kind, ...extra });

class World implements HierarchySource {
  readonly nodes = new Map<string, Node>();
  readonly edges: Edge[] = [];
  reads = { incoming: 0, outgoing: 0, nodes: 0, requested: 0, examined: 0 };
  failIncoming = false;
  failOutgoing = false;

  addNode(value: Node): Node {
    this.nodes.set(value.id, value);
    return value;
  }

  addEdge(value: Edge): void {
    this.edges.push(value);
  }

  getNodesByIds(ids: readonly string[]): Map<string, Node> {
    this.reads.nodes++;
    this.reads.requested += ids.length;
    return new Map(ids.flatMap((id) => {
      const value = this.nodes.get(id);
      return value ? [[id, value] as const] : [];
    }));
  }

  getOutgoingEdgesFrom(ids: readonly string[], kinds?: EdgeKind[]): Edge[] {
    if (this.failOutgoing) throw new Error('outgoing failed');
    this.reads.outgoing++;
    const selected = new Set(ids);
    const allowed = kinds ? new Set(kinds) : null;
    const result = this.edges.filter((value) => selected.has(value.source) && (!allowed || allowed.has(value.kind)));
    this.reads.examined += result.length;
    return result;
  }

  getIncomingEdgesTo(ids: readonly string[], kinds?: EdgeKind[]): Edge[] {
    if (this.failIncoming) throw new Error('incoming failed');
    this.reads.incoming++;
    const selected = new Set(ids);
    const allowed = kinds ? new Set(kinds) : null;
    const result = this.edges.filter((value) => selected.has(value.target) && (!allowed || allowed.has(value.kind)));
    this.reads.examined += result.length;
    return result;
  }
}

function chain(length: number): { world: World; focus: Node } {
  const world = new World();
  const focus = world.addNode(node('T0'));
  for (let index = 1; index <= length; index++) {
    world.addNode(node(`T${index}`));
    world.addEdge(edge(`T${index - 1}`, `T${index}`));
  }
  return { world, focus };
}

function fan(count: number, kind: EdgeKind = 'implements'): { world: World; focus: Node } {
  const world = new World();
  const focus = world.addNode(node('Root', 'interface'));
  for (let index = 0; index < count; index++) {
    const child = world.addNode(node(`Child${String(index).padStart(3, '0')}`));
    world.addEdge(edge(child.id, focus.id, kind));
  }
  return { world, focus };
}

describe('Afyx rich type-hierarchy policy contract', () => {
  it('freezes the complete eligibility kind table', () => {
    const accepted: NodeKind[] = ['class', 'interface', 'struct', 'trait', 'protocol', 'enum', 'type_alias', 'union'];
    expect([...HIERARCHY_KINDS]).toEqual(accepted);
    for (const kind of accepted) expect(canHaveHierarchy(node(kind, kind))).toBe(true);
    for (const kind of ['function', 'method', 'property', 'field', 'variable', 'constant'] as NodeKind[]) {
      expect(canHaveHierarchy(node(kind, kind))).toBe(false);
    }
  });

  it.each([7, 8, 9])('bounds an ancestor chain of %i links at eight levels', (links) => {
    const { world, focus } = chain(links);
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.ancestors).toHaveLength(Math.min(links, MAX_ANCESTOR_DEPTH));
    expect(result.ancestors.map(({ depth }) => depth)).toEqual(
      Array.from({ length: Math.min(links, MAX_ANCESTOR_DEPTH) }, (_, index) => index + 1)
    );
  });

  it.each([5, 6, 7])('bounds a descendant chain of %i links at six levels', (links) => {
    const { world, focus } = chain(links);
    // Reverse the chain so T0 is the supertype.
    world.edges.splice(0, world.edges.length, ...world.edges.map((value) => edge(value.target, value.source)));
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.descendants).toHaveLength(Math.min(links, MAX_DESCENDANT_DEPTH));
    expect(result.bounded).toBe(links > MAX_DESCENDANT_DEPTH);
    if (links > MAX_DESCENDANT_DEPTH) {
      expect(result.descendants.at(-1)?.hiddenSubtypes).toBe(1);
    }
  });

  it.each([399, 400, 401])('keeps true direct counts at a %i-wide fan', (count) => {
    const { world, focus } = fan(count);
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.descendants).toHaveLength(Math.min(count, MAX_DESCENDANTS));
    expect(result.directSubtypes).toBe(count);
    expect(result.directImplementers).toBe(count);
    expect(result.bounded).toBe(count > MAX_DESCENDANTS);
  });

  it('does not inflate direct or hidden counts for duplicate edges beyond the row cap', () => {
    const { world, focus } = fan(MAX_DESCENDANTS + 1);
    world.addEdge(edge('Child400', focus.id, 'implements', { provenance: 'heuristic' }));
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.directSubtypes).toBe(MAX_DESCENDANTS + 1);
    expect(result.directImplementers).toBe(MAX_DESCENDANTS + 1);
    expect(countImplementers(world, focus.id)).toBe(MAX_DESCENDANTS + 1);
  });

  it.each([7, 8, 9])('switches polymorphic dispatch exactly at eight for %i implementers', (count) => {
    const { world, focus } = fan(count);
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.directImplementers).toBe(count);
    expect(result.polymorphic).toBe(count >= DISPATCH_MIN_IMPLEMENTERS);
    expect(countImplementers(world, focus.id)).toBe(count);
  });

  it('orders each level by relation, name, file and line', () => {
    const world = new World();
    const focus = world.addNode(node('Focus'));
    for (const value of [
      node('Zulu', 'interface'),
      node('AlphaZ', 'class', 'z.ts', 3),
      node('AlphaA2', 'class', 'a.ts', 2),
      node('AlphaA1', 'class', 'a.ts', 1),
    ]) world.addNode(value);
    // Equal names exercise the secondary keys without relying on insertion order.
    world.nodes.get('AlphaZ')!.name = 'Alpha';
    world.nodes.get('AlphaA2')!.name = 'Alpha';
    world.nodes.get('AlphaA1')!.name = 'Alpha';
    world.addEdge(edge(focus.id, 'Zulu', 'implements'));
    world.addEdge(edge(focus.id, 'AlphaZ'));
    world.addEdge(edge(focus.id, 'AlphaA2'));
    world.addEdge(edge(focus.id, 'AlphaA1'));
    expect(buildTypeHierarchy(world, focus)!.ancestors.map(({ node: value }) => value.id)).toEqual([
      'AlphaA1', 'AlphaA2', 'AlphaZ', 'Zulu',
    ]);
  });

  it.each([
    [['implements', 'extends'], 'extends', false],
    [['extends', 'implements'], 'extends', true],
    [['implements', 'implements'], 'implements', true],
    [['extends', 'extends'], 'extends', true],
  ] as const)('deduplicates relation order %j with extends precedence', (kinds, relation, synthesized) => {
    const world = new World();
    const focus = world.addNode(node('Root'));
    world.addNode(node('Child'));
    world.addEdge(edge('Child', focus.id, kinds[0], { provenance: 'heuristic' }));
    world.addEdge(edge('Child', focus.id, kinds[1]));
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.descendants).toHaveLength(1);
    expect(result.descendants[0]!.relation).toBe(relation);
    expect(result.descendants[0]!.synthesized).toBe(synthesized);
    expect(result.directSubtypes).toBe(1);
  });

  it('terminates cycles, drops missing nodes and preserves parent identity', () => {
    const world = new World();
    const focus = world.addNode(node('A'));
    world.addNode(node('B'));
    world.addNode(node('C'));
    world.addEdge(edge('A', 'B'));
    world.addEdge(edge('B', 'C'));
    world.addEdge(edge('C', 'A'));
    world.addEdge(edge('A', 'missing'));
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.ancestors.map(({ node: value }) => value.id)).toEqual(['B', 'C']);
    expect(result.ancestors.map(({ parentId }) => parentId)).toEqual(['A', 'B']);
  });

  it('degrades hierarchy reads and implementer counts without broadening thrown node reads', () => {
    const { world, focus } = fan(1);
    world.failIncoming = true;
    expect(buildTypeHierarchy(world, focus)).toBeNull();
    expect(countImplementers(world, focus.id)).toBe(0);
    world.failIncoming = false;
    world.failOutgoing = true;
    expect(buildTypeHierarchy(world, focus)?.descendants).toHaveLength(1);
  });

  it.each([11, 12, 13])('caps override lookup at twelve ancestors for declaration %i', (ownerDepth) => {
    const { world, focus } = chain(13);
    const own = world.addNode(node('own', 'method', 'focus.ts', 10));
    own.name = 'run';
    const inherited = world.addNode(node('base', 'method', 'base.ts', 10));
    inherited.name = 'run';
    world.addEdge(edge(focus.id, own.id, 'contains'));
    world.addEdge(edge(`T${ownerDepth}`, inherited.id, 'contains'));
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.overrides.has(own.id)).toBe(ownerDepth <= 8);
    // The hierarchy itself is capped at eight, so the separate 12-member cap cannot
    // currently become the tighter bound. This documents the equivalent bound.
  });

  it('matches only overridable member kinds by name and nearest established ancestor', () => {
    const world = new World();
    const focus = world.addNode(node('Focus'));
    world.addNode(node('Near'));
    world.addNode(node('Far'));
    world.addEdge(edge('Focus', 'Near'));
    world.addEdge(edge('Near', 'Far'));
    for (const [index, kind] of (['method', 'function', 'property', 'field', 'variable', 'constant'] as NodeKind[]).entries()) {
      const own = world.addNode(node(`own-${kind}`, kind, 'focus.ts', index + 1));
      own.name = kind;
      const near = world.addNode(node(`near-${kind}`, kind, 'near.ts', index + 1));
      near.name = kind;
      const far = world.addNode(node(`far-${kind}`, kind, 'far.ts', index + 1));
      far.name = kind;
      world.addEdge(edge('Focus', own.id, 'contains'));
      world.addEdge(edge('Near', near.id, 'contains'));
      world.addEdge(edge('Far', far.id, 'contains'));
    }
    const result = buildTypeHierarchy(world, focus)!;
    expect([...result.overrides.keys()]).toEqual(['own-method', 'own-function', 'own-property', 'own-field']);
    expect([...result.overrides.values()].every(({ baseTypeId }) => baseTypeId === 'Near')).toBe(true);
    expect(buildTypeHierarchy(world, focus, { overrides: false })!.overrides.size).toBe(0);
  });

  it('uses one batched relation read per visited level rather than one read per node', () => {
    const { world, focus } = fan(399);
    const result = buildTypeHierarchy(world, focus)!;
    expect(result.descendants).toHaveLength(399);
    expect(world.reads.incoming).toBe(2);
    expect(world.reads.outgoing).toBe(1);
    expect(world.reads.nodes).toBe(1);
  });
});
