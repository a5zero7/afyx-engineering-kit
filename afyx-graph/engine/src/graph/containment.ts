/**
 * Containment: the parent chain above a node and the members directly below it.
 */

import type { Node } from '../types';
import type { GraphReader } from './graph-store';

/**
 * Containers above `nodeId`, nearest first, ending at the outermost one.
 *
 * Only the first `contains` edge into a node is followed (a node normally has a single
 * container), and the climb stops if it ever loops back on itself.
 */
export function containersAbove(store: GraphReader, nodeId: string): Node[] {
  const chain: Node[] = [];
  const climbed = new Set<string>();

  for (let current = nodeId; !climbed.has(current); ) {
    climbed.add(current);
    const holder = store.getIncomingEdges(current, ['contains'])[0];
    const parent = holder ? store.getNodeById(holder.source) : null;
    if (!parent) break;
    chain.push(parent);
    current = parent.id;
  }
  return chain;
}

/** Members directly contained by `nodeId`, in edge order (members that no longer exist are skipped). */
export function membersOf(store: GraphReader, nodeId: string): Node[] {
  const held = store.getOutgoingEdges(nodeId, ['contains']);
  if (held.length === 0) return [];
  const found = store.getNodesByIds(held.map((edge) => edge.target));
  const members: Node[] = [];
  for (const edge of held) {
    const member = found.get(edge.target);
    if (member) members.push(member);
  }
  return members;
}
