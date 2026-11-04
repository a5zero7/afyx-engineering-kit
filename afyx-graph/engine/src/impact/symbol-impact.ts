/**
 * Symbol impact across a definition group: `getImpactRadius` (Graph's own traversal,
 * `graph/relations.ts::impactOf`, untouched) answers "what depends on this ONE node,"
 * called once per node in a group of same-file overloads / same-symbol definitions and
 * merged into one blast radius — the CLI `impact` command and the MCP `afyx_graph_impact`
 * tool each did this merge inline, with two different (but each individually correct)
 * edge-collision tie-breaks; both are preserved exactly via `edgeDedup` rather than forced
 * to agree, since nothing requires the two surfaces to answer identically on a duplicate-
 * keyed edge (same source/target/kind, different call-site line/column) and forcing one
 * would silently change the other's observable output.
 */
import type { Edge, Node, Subgraph } from '../types';

export interface SymbolImpactHost {
  getImpactRadius(nodeId: string, maxDepth: number): Subgraph;
}

/**
 * Which edge survives when two impact calls report an edge with the same
 * `source->target:kind` key but different metadata (e.g. a different call-site line): the
 * CLI's original `Map.set` overwrote with each new occurrence (last one wins); the MCP
 * tool's original `Set`-guarded push kept only the first.
 */
export type EdgeDedupOrder = 'last-seen' | 'first-seen';

export interface MergedImpact {
  nodes: Map<string, Node>;
  edges: Edge[];
  roots: string[];
}

export function mergeSymbolImpact(
  host: SymbolImpactHost,
  definitionNodes: Node[],
  depth: number,
  edgeDedup: EdgeDedupOrder = 'last-seen'
): MergedImpact {
  const nodes = new Map<string, Node>();
  const roots = definitionNodes.map((n) => n.id);

  if (edgeDedup === 'last-seen') {
    const edgeByKey = new Map<string, Edge>();
    for (const target of definitionNodes) {
      const impact = host.getImpactRadius(target.id, depth);
      for (const [id, node] of impact.nodes) nodes.set(id, node);
      for (const edge of impact.edges) edgeByKey.set(`${edge.source}->${edge.target}:${edge.kind}`, edge);
    }
    return { nodes, edges: [...edgeByKey.values()], roots };
  }

  const edges: Edge[] = [];
  const seenKeys = new Set<string>();
  for (const target of definitionNodes) {
    const impact = host.getImpactRadius(target.id, depth);
    for (const [id, node] of impact.nodes) nodes.set(id, node);
    for (const edge of impact.edges) {
      const key = `${edge.source}->${edge.target}:${edge.kind}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        edges.push(edge);
      }
    }
  }
  return { nodes, edges, roots };
}
