/**
 * Persisted writes for `edges`.
 *
 * An edge is unique by (source, target, kind, line, column), with missing coordinates
 * folded so coordinate-less edges dedup too (`idx_edges_identity`); every insert is
 * `OR IGNORE`, so an edge written twice is stored once.
 */

import type { Edge } from '../types';
import { placeholders, SQLITE_PARAM_CHUNK_SIZE } from './sql-limits';
import type { WriteSession } from './write-session';

const INSERT_HEAD = 'INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance) VALUES ';
const ROW_TUPLE = '(?,?,?,?,?,?,?)';

/** An edge as its seven column values; metadata is stored as JSON text, missing values as NULL. */
function toRow(edge: Edge): unknown[] {
  return [
    edge.source,
    edge.target,
    edge.kind,
    edge.metadata ? JSON.stringify(edge.metadata) : null,
    edge.line ?? null,
    edge.column ?? null,
    edge.provenance ?? null,
  ];
}

export class EdgeWriter {
  constructor(private readonly session: WriteSession) {}

  /** Insert one edge. Both endpoints must exist (the foreign keys are enforced). */
  insert(edge: Edge): void {
    this.session.statement(`${INSERT_HEAD}${ROW_TUPLE}`).run(...toRow(edge));
  }

  /**
   * Insert many edges in one transaction, silently dropping any whose source or target is
   * not (or no longer) a stored node — one existence lookup for all endpoints.
   */
  insertMany(edges: Edge[]): void {
    if (edges.length === 0) return;
    this.session.transaction(() => {
      const endpoints = new Set<string>();
      for (const edge of edges) {
        endpoints.add(edge.source);
        endpoints.add(edge.target);
      }
      const stored = this.storedNodeIds([...endpoints]);
      const rows = edges.filter((edge) => stored.has(edge.source) && stored.has(edge.target)).map(toRow);
      this.session.insertRows('insertEdges', INSERT_HEAD, ROW_TUPLE, rows);
    });
  }

  /** Insert edges whose endpoints the caller already guarantees exist, skipping the existence lookup. */
  insertTrusted(edges: Edge[]): void {
    this.session.insertRows('insertEdges', INSERT_HEAD, ROW_TUPLE, edges.map(toRow));
  }

  deleteBySource(sourceId: string): void {
    this.session.statement('DELETE FROM edges WHERE source = ?').run(sourceId);
  }

  /** Delete edges by primary key in one transaction; returns the rows removed. */
  deleteByIds(edgeIds: number[]): number {
    if (edgeIds.length === 0) return 0;
    let removed = 0;
    this.session.transaction(() => {
      for (let start = 0; start < edgeIds.length; start += SQLITE_PARAM_CHUNK_SIZE) {
        const chunk = edgeIds.slice(start, start + SQLITE_PARAM_CHUNK_SIZE);
        removed += this.session.listStatement(`DELETE FROM edges WHERE id IN (${placeholders(chunk.length)})`, chunk.length).run(...chunk).changes;
      }
    });
    return removed;
  }

  /** Which of `ids` are stored nodes. */
  private storedNodeIds(ids: readonly string[]): Set<string> {
    const stored = new Set<string>();
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = unique.slice(start, start + SQLITE_PARAM_CHUNK_SIZE);
      const rows = this.session.listStatement(`SELECT id FROM nodes WHERE id IN (${placeholders(chunk.length)})`, chunk.length).all(...chunk) as { id: string }[];
      for (const row of rows) stored.add(row.id);
    }
    return stored;
  }
}
