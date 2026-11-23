import type { Edge, Node } from '../types';

/**
 * Public caller/callee presentations should not turn module containers or an
 * unresolved receiver captured as a function value into executable callers.
 * The underlying graph retains both edges for usages, compatibility, and
 * impact analysis; only the source-grounded relationship view is filtered.
 */
export function isSourceGroundedRelationship(value: { node: Node; edge: Edge }): boolean {
  if (value.edge.kind === 'imports' || value.node.kind === 'file') return false;
  if (value.edge.kind === 'references' && value.edge.metadata?.fnRef === true) return false;
  return true;
}
