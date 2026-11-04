/**
 * Persisted edge identity and adjacency reads.
 *
 * Direction is data in this module, not an inference made by callers: outgoing
 * reads bind `source`, incoming reads bind `target`, and connectivity binds both.
 * The database's natural row order remains part of the compatibility contract.
 */

import type { Edge, EdgeKind } from '../types';
import { chunked, placeholders, QuerySession } from './query-session';
import { rowToEdge, type EdgeRow } from './row-mappers';

const EDGE_PROJECTION = 'id, source, target, kind, metadata, line, col, provenance';

interface AdjacencyDirection {
  readonly endpoint: 'source' | 'target';
  readonly one: string;
}

const ADJACENCY = {
  outgoing: {
    endpoint: 'source',
    one: `SELECT ${EDGE_PROJECTION} FROM edges WHERE source = ?`,
  },
  incoming: {
    endpoint: 'target',
    one: `SELECT ${EDGE_PROJECTION} FROM edges WHERE target = ?`,
  },
} as const satisfies Record<'outgoing' | 'incoming', AdjacencyDirection>;

const CONNECTED_QUERY =
  `SELECT ${EDGE_PROJECTION} FROM edges ` +
  'WHERE source IN (SELECT value FROM json_each(?)) ' +
  'AND target IN (SELECT value FROM json_each(?))';

const decodeEdges = (rows: readonly EdgeRow[]): Edge[] => rows.map(rowToEdge);

function kindConstraint(kinds: readonly EdgeKind[] | undefined): string {
  return kinds?.length ? ` AND kind IN (${placeholders(kinds.length)})` : '';
}

export class EdgeReader {
  constructor(private readonly session: QuerySession) {}

  getOutgoingEdges(sourceId: string, kinds?: EdgeKind[], provenance?: string): Edge[] {
    const direction = ADJACENCY.outgoing;
    const unfiltered = !kinds?.length && !provenance;
    if (unfiltered) return this.fixed(direction.one, [sourceId]);

    const values: string[] = [sourceId, ...(kinds ?? [])];
    let query = direction.one + kindConstraint(kinds);
    if (provenance) {
      query += ' AND provenance = ?';
      values.push(provenance);
    }
    return this.dynamic(query, values);
  }

  getIncomingEdges(targetId: string, kinds?: EdgeKind[]): Edge[] {
    const direction = ADJACENCY.incoming;
    return kinds?.length
      ? this.dynamic(direction.one + kindConstraint(kinds), [targetId, ...kinds])
      : this.fixed(direction.one, [targetId]);
  }

  getOutgoingEdgesFrom(sourceIds: readonly string[], kinds?: EdgeKind[]): Edge[] {
    return this.many(ADJACENCY.outgoing, sourceIds, kinds);
  }

  getIncomingEdgesTo(targetIds: readonly string[], kinds?: EdgeKind[]): Edge[] {
    return this.many(ADJACENCY.incoming, targetIds, kinds);
  }

  countIncomingEdges(ids: readonly string[]): Map<string, number> {
    return this.count(ADJACENCY.incoming, ids);
  }

  countOutgoingEdges(ids: readonly string[]): Map<string, number> {
    return this.count(ADJACENCY.outgoing, ids);
  }

  findEdgesBetweenNodes(nodeIds: string[], kinds?: EdgeKind[]): Edge[] {
    if (nodeIds.length === 0) return [];
    const encodedIds = JSON.stringify(nodeIds);
    return this.dynamic(CONNECTED_QUERY + kindConstraint(kinds), [encodedIds, encodedIds, ...(kinds ?? [])]);
  }

  private fixed(query: string, values: readonly string[]): Edge[] {
    return decodeEdges(this.session.statement(query).all(...values) as EdgeRow[]);
  }

  private dynamic(query: string, values: readonly string[]): Edge[] {
    return decodeEdges(this.session.db.prepare(query).all(...values) as EdgeRow[]);
  }

  private many(direction: AdjacencyDirection, ids: readonly string[], kinds?: readonly EdgeKind[]): Edge[] {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];

    const edges: Edge[] = [];
    for (const group of chunked(uniqueIds)) {
      const query =
        `SELECT ${EDGE_PROJECTION} FROM edges WHERE ${direction.endpoint} IN (${placeholders(group.length)})` +
        kindConstraint(kinds);
      edges.push(...this.dynamic(query, [...group, ...(kinds ?? [])]));
    }
    return edges;
  }

  private count(direction: AdjacencyDirection, ids: readonly string[]): Map<string, number> {
    const totals = new Map<string, number>();
    const uniqueIds = [...new Set(ids)];
    for (const group of chunked(uniqueIds)) {
      const query =
        `SELECT ${direction.endpoint} AS endpoint, COUNT(*) AS total FROM edges ` +
        `WHERE ${direction.endpoint} IN (${placeholders(group.length)}) GROUP BY ${direction.endpoint}`;
      const rows = this.session.db.prepare(query).all(...group) as Array<{ endpoint: string; total: number }>;
      for (const row of rows) totals.set(row.endpoint, row.total);
    }
    return totals;
  }
}
