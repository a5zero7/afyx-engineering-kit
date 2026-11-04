/**
 * Whole-graph catalogue queries: pattern lookup by qualified name, unreferenced
 * symbols, and predicate-filtered subgraphs.
 */

import type { Edge, Node, NodeKind, Subgraph } from '../types';
import type { GraphCatalog } from './graph-store';

/** Kinds a qualified-name lookup considers, in the order results are grouped. */
const NAMED_KINDS: NodeKind[] = ['class', 'union', 'function', 'method', 'interface', 'type_alias', 'variable', 'constant'];

/** Kinds included when filtering the graph into a subgraph, in result order. */
const STRUCTURAL_KINDS: NodeKind[] = [
  'file', 'module', 'class', 'struct', 'union', 'interface', 'trait', 'function', 'method', 'variable', 'constant', 'enum', 'type_alias',
];

/** Kinds checked for being unreferenced when the caller names none. */
const DEFAULT_DEAD_KINDS: NodeKind[] = ['function', 'method', 'class'];

/** Characters that mean something in a regular expression but are literal in a glob. */
const REGEX_SPECIALS = new Set('.+^${}()|[]\\');

/** Compile a glob (`*` any run, `?` any one character) into an anchored regular expression. */
export function compileGlob(pattern: string): RegExp {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += REGEX_SPECIALS.has(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${source}$`);
}

/** Symbols whose qualified name matches the glob, grouped by kind in `NAMED_KINDS` order. */
export function matchQualifiedNames(catalog: GraphCatalog, pattern: string): Node[] {
  const matcher = compileGlob(pattern);
  const matches: Node[] = [];
  for (const kind of NAMED_KINDS) {
    for (const node of catalog.getNodesByKind(kind)) {
      if (matcher.test(node.qualifiedName)) matches.push(node);
    }
  }
  return matches;
}

/**
 * Non-exported symbols of the given kinds that nothing references. Containment does
 * not count as a reference; exported symbols are skipped since they may be used
 * outside the project.
 */
export function unreferencedSymbols(catalog: GraphCatalog, kinds?: NodeKind[]): Node[] {
  const unreferenced: Node[] = [];
  for (const kind of kinds || DEFAULT_DEAD_KINDS) {
    for (const node of catalog.getNodesByKind(kind)) {
      if (node.isExported) continue;
      if (catalog.getIncomingEdges(node.id).every((edge) => edge.kind === 'contains')) unreferenced.push(node);
    }
  }
  return unreferenced;
}

/** Structural nodes accepted by `keep`, and (optionally) the edges running between them. */
export function subgraphWhere(catalog: GraphCatalog, keep: (node: Node) => boolean, withEdges: boolean): Subgraph {
  const nodes = new Map<string, Node>();
  for (const kind of STRUCTURAL_KINDS) {
    for (const node of catalog.getNodesByKind(kind)) {
      if (keep(node)) nodes.set(node.id, node);
    }
  }

  const edges: Edge[] = [];
  if (withEdges) {
    for (const id of nodes.keys()) {
      for (const edge of catalog.getOutgoingEdges(id)) {
        if (nodes.has(edge.target)) edges.push(edge);
      }
    }
  }
  return { nodes, edges, roots: [] };
}
