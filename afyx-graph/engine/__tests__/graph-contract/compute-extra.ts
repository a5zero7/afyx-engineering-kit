import * as crypto from 'node:crypto';
import { GraphTraverser, GraphQueryManager, buildTypeHierarchy, canHaveHierarchy, countImplementers } from '../../src/graph';
import { NODE_KINDS, type Edge, type EdgeKind, type Node, type NodeKind, type Subgraph } from '../../src/types';
import type { QueryBuilder } from '../../src/db/queries';
import { EXTRA_GLOBS, EXTRA_WORLDS, HIERARCHY_WORLDS } from './extra-worlds';
import { createFakeStore, type World } from './fake-store';

const digest = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 14);
const edgeText = (edge: Edge): string => `${edge.source}>${edge.target}:${edge.kind}@${edge.line ?? '-'}:${edge.column ?? '-'}${edge.provenance ? `~${edge.provenance}` : ''}`;
const shape = (graph: Subgraph) => ({ nodes: [...graph.nodes.keys()], edges: graph.edges.map(edgeText), roots: graph.roots });
const pairs = (list: Array<{ node: Node; edge: Edge }>) => list.map(({ node, edge }) => `${node.id}<${edgeText(edge)}`);
const ids = (nodes: Node[]) => nodes.map((node) => node.id);

/** The lookups the hierarchy module needs, over a fixed world; `failing` makes every edge read throw. */
export function hierarchySource(world: World, failing = false) {
  const byId = new Map(world.nodes.map((node) => [node.id, node]));
  const pick = (list: readonly string[], key: 'source' | 'target', kinds?: EdgeKind[]): Edge[] => {
    if (failing) throw new Error('store unavailable');
    const out: Edge[] = [];
    for (const id of new Set(list)) {
      for (const edge of world.edges) if (edge[key] === id && (!kinds || kinds.includes(edge.kind))) out.push({ ...edge });
    }
    return out;
  };
  return {
    getNodesByIds: (wanted: readonly string[]): Map<string, Node> => {
      const found = new Map<string, Node>();
      for (const id of wanted) { const node = byId.get(id); if (node) found.set(id, node); }
      return found;
    },
    getOutgoingEdgesFrom: (from: readonly string[], kinds?: EdgeKind[]) => pick(from, 'source', kinds),
    getIncomingEdgesTo: (to: readonly string[], kinds?: EdgeKind[]) => pick(to, 'target', kinds),
  };
}

const row = (entry: any) => [entry.node.id, entry.depth, entry.parentId, entry.relation, edgeText(entry.edge), entry.synthesized, entry.hiddenSubtypes];
const hierarchyText = (result: any) => result && {
  focus: result.focus.id, ancestors: result.ancestors.map(row), descendants: result.descendants.map(row), directSubtypes: result.directSubtypes,
  directImplementers: result.directImplementers, bounded: result.bounded, polymorphic: result.polymorphic, overrides: [...result.overrides.entries()],
};

export function computeExtraContract(): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [name, make] of Object.entries(EXTRA_WORLDS)) {
    const world = make();
    const store = createFakeStore(world) as unknown as QueryBuilder;
    const traverser = new GraphTraverser(store);
    const manager = new GraphQueryManager(store);
    const records: Record<string, unknown> = {};
    for (const node of world.nodes) {
      const id = node.id;
      for (const depth of [0, 1, 2, 5]) {
        records[`impact ${id} ${depth}`] = shape(traverser.getImpactRadius(id, depth));
        records[`callers ${id} ${depth}`] = pairs(traverser.getCallers(id, depth));
        records[`callees ${id} ${depth}`] = pairs(traverser.getCallees(id, depth));
      }
      records[`ancestors ${id}`] = ids(traverser.getAncestors(id));
      records[`children ${id}`] = ids(traverser.getChildren(id));
      records[`metrics ${id}`] = manager.getNodeMetrics(id);
      records[`bfs ${id}`] = shape(traverser.traverseBFS(id, { direction: 'both' }));
      records[`dfs ${id}`] = shape(traverser.traverseDFS(id, { direction: 'both' }));
      try {
        const context = manager.getContext(id);
        records[`context ${id}`] = { ancestors: ids(context.ancestors), children: ids(context.children), incoming: pairs(context.incomingRefs), outgoing: pairs(context.outgoingRefs) };
      } catch (error) { records[`context ${id}`] = String(error); }
    }
    for (const pattern of EXTRA_GLOBS) records[`qname ${pattern}`] = ids(manager.findByQualifiedName(pattern));
    records.deadCode = ids(manager.findDeadCode(['function', 'method', 'class', 'variable', 'constant']));
    out[name] = records;
  }

  for (const [name, make] of Object.entries(HIERARCHY_WORLDS)) {
    const world = make();
    const source = hierarchySource(world);
    const records: Record<string, unknown> = {};
    const put = (key: string, value: unknown): void => { records[key] = name === 'hWide' ? digest(value) : value; };
    for (const node of world.nodes) {
      if (name === 'hWide' && !['Base', 'Small', 'S000', 'S001', 'Grand0', 'Kid0'].includes(node.id)) continue;
      put(`hierarchy ${node.id}`, hierarchyText(buildTypeHierarchy(source as any, node)));
      put(`hierarchy-no-overrides ${node.id}`, hierarchyText(buildTypeHierarchy(source as any, node, { overrides: false })));
      records[`implementers ${node.id}`] = countImplementers(source as any, node.id);
    }
    if (name === 'hWide') {
      const full = buildTypeHierarchy(source as any, world.nodes[0]!)!;
      records.wideSummary = {
        rows: full.descendants.length, directSubtypes: full.directSubtypes, directImplementers: full.directImplementers, bounded: full.bounded,
        polymorphic: full.polymorphic, firstRows: full.descendants.slice(0, 5).map(row), lastRows: full.descendants.slice(-5).map(row),
        hidden: full.descendants.filter((entry) => entry.hiddenSubtypes > 0).map((entry) => [entry.node.id, entry.hiddenSubtypes]),
      };
    }
    out[name] = records;
  }

  // Store failures degrade to "no hierarchy" rather than throwing; only type-like kinds can have one.
  const chain = HIERARCHY_WORLDS.hChain!();
  const broken = hierarchySource(chain, true);
  out.misc = {
    'failing hierarchy': hierarchyText(buildTypeHierarchy(broken as any, chain.nodes[3]!)),
    'failing implementers': countImplementers(broken as any, 'C3'),
    'kinds table': Object.fromEntries((NODE_KINDS as readonly NodeKind[]).map((kind) => [kind, canHaveHierarchy({ kind } as Node)])),
    'function focus': hierarchyText(buildTypeHierarchy(hierarchySource(chain) as any, { ...chain.nodes[0]!, kind: 'function' })) ?? 'null',
  };
  return out;
}
