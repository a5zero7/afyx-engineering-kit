import type { AfyxGraph } from '../../index';
import { badRequest } from './respond';
import { toNodeRef, type WireNodeRef } from './wire';

export const MAX_NODE_REFS = 60;

export interface WireNodeRefs {
  items: WireNodeRef[];
  missing: string[];
}

export function buildNodeRefs(cg: AfyxGraph, query: URLSearchParams): WireNodeRefs {
  const requestedIds = query.getAll('id').filter((value) => value.length > 0);
  if (requestedIds.length === 0) {
    throw badRequest(
      'No node ids were supplied.',
      'Pass repeated id parameters: /api/nodes?id=<id>&id=<id>.',
    );
  }
  if (requestedIds.length > MAX_NODE_REFS) {
    throw badRequest(`Too many ids (${requestedIds.length}); maximum is ${MAX_NODE_REFS}.`);
  }

  const dedupedIds = [...new Set(requestedIds)];
  const resolved = cg.getNodesByIds(dedupedIds);
  const items: WireNodeRef[] = [];
  const missing: string[] = [];

  for (const id of dedupedIds) {
    const match = resolved.get(id);
    if (match) {
      items.push(toNodeRef(match));
    } else {
      missing.push(id);
    }
  }

  return { items, missing };
}
