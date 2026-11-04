/**
 * Budget policies applied to an expanded context, in order:
 *
 *   1. node limit        keep entry points and their neighbours first, then fill in discovery order
 *   2. per-file cap      no single file may take more than a fifth of the budget
 *   3. non-production    tests, examples, fixtures and the like take at most 15%, unless the query is about tests
 *   4. edge recovery     re-discover relationships among the survivors that expansion missed
 *
 * Every policy is deterministic: ties keep discovery order.
 */

import type { Edge, EdgeKind, Node } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { Request } from './request';
import type { ContextGraph } from './expansion';

const FILE_SHARE = 0.2;
const MIN_PER_FILE = 5;
const NON_PRODUCTION_SHARE = 0.15;
const MIN_NON_PRODUCTION = 3;

/** Higher survives a per-file cut: entry points, then type definitions, then callables, then data. */
const KIND_WEIGHT: ReadonlyMap<string, number> = new Map([
  ['class', 3], ['interface', 3], ['struct', 3], ['trait', 3], ['protocol', 3], ['enum', 3],
  ['method', 1], ['function', 1],
]);
const ENTRY_WEIGHT = 10;

/** Relationships worth recovering between already-selected nodes. */
const RECOVERED_KINDS: EdgeKind[] = ['calls', 'extends', 'implements', 'references', 'overrides', 'navigates'];

/** Entry points, then everything one hop from the growing set (a single pass in edge order). */
function priorityOrder(graph: ContextGraph): Set<string> {
  const priority = new Set(graph.roots);
  for (const edge of graph.edges) {
    if (priority.has(edge.source)) priority.add(edge.target);
    if (priority.has(edge.target)) priority.add(edge.source);
  }
  return priority;
}

function limitNodes(graph: ContextGraph, maxNodes: number): Map<string, Node> {
  if (graph.nodes.size <= maxNodes) return graph.nodes;
  const kept = new Map<string, Node>();
  for (const id of priorityOrder(graph)) {
    const node = graph.nodes.get(id);
    if (node && kept.size < maxNodes) kept.set(id, node);
  }
  for (const [id, node] of graph.nodes) {
    if (kept.size >= maxNodes) break;
    if (!kept.has(id)) kept.set(id, node);
  }
  return kept;
}

function capPerFile(nodes: Map<string, Node>, roots: ReadonlySet<string>, maxNodes: number): void {
  const cap = Math.max(MIN_PER_FILE, Math.ceil(maxNodes * FILE_SHARE));
  const idsByFile = new Map<string, string[]>();
  for (const [id, node] of nodes) {
    const ids = idsByFile.get(node.filePath);
    if (ids) ids.push(id);
    else idsByFile.set(node.filePath, [id]);
  }
  const weight = (id: string): number => (roots.has(id) ? ENTRY_WEIGHT : 0) + (KIND_WEIGHT.get(nodes.get(id)!.kind) ?? 0);
  for (const ids of idsByFile.values()) {
    if (ids.length <= cap) continue;
    ids.sort((a, b) => weight(b) - weight(a));
    for (const id of ids.slice(cap)) nodes.delete(id);
  }
}

function capNonProduction(req: Request, nodes: Map<string, Node>, roots: string[], maxNodes: number): void {
  if (req.mentionsTests) return;
  const cap = Math.max(MIN_NON_PRODUCTION, Math.ceil(maxNodes * NON_PRODUCTION_SHARE));
  const nonProduction = [...nodes].filter(([, node]) => req.isTestFile(node.filePath)).map(([id]) => id);
  if (nonProduction.length <= cap) return;
  for (const id of nonProduction.slice(cap)) {
    nodes.delete(id);
    // A demoted test file must not keep anchoring the result as an entry point.
    const at = roots.indexOf(id);
    if (at !== -1) roots.splice(at, 1);
  }
}

/**
 * Applies the policies and returns the final nodes and edges. Expansion around many
 * entry points leaves most selected nodes disconnected, so relationships among the
 * survivors are recovered from storage at the end.
 */
export function applyBudgets(graph: ContextGraph, req: Request, queries: QueryBuilder): { nodes: Map<string, Node>; edges: Edge[] } {
  const { maxNodes } = req.settings;
  const nodes = limitNodes(graph, maxNodes);
  const rootSet = new Set(graph.roots);
  capPerFile(nodes, rootSet, maxNodes);
  capNonProduction(req, nodes, graph.roots, maxNodes);

  const edges = graph.edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target));
  const known = new Set(edges.map((edge) => `${edge.source}\u0000${edge.target}\u0000${edge.kind}`));
  for (const edge of queries.findEdgesBetweenNodes([...nodes.keys()], RECOVERED_KINDS)) {
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
    if (known.has(key)) continue;
    known.add(key);
    edges.push(edge);
  }
  return { nodes, edges };
}
