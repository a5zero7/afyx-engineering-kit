/** Persisted candidate retrieval for Search; ranking and query semantics stay in SearchReader. */

import type { Language, Node, NodeKind, SearchResult } from '../types';
import type { QuerySession } from './query-session';
import { rowToNode, type NodeRow } from './row-mappers';

type CandidateFilters = {
  kinds?: readonly NodeKind[];
  languages?: readonly Language[];
};

type ScoredNodeRow = NodeRow & { score: number };

const NODE_COLUMNS = [
  'id',
  'kind',
  'name',
  'qualified_name',
  'file_path',
  'language',
  'start_line',
  'end_line',
  'start_column',
  'end_column',
  'docstring',
  'signature',
  'visibility',
  'is_exported',
  'is_async',
  'is_static',
  'is_abstract',
  'decorators',
  'type_parameters',
  'return_type',
  'updated_at',
] as const;

const selectNodes = (qualifier = ''): string => NODE_COLUMNS.map((column) => `${qualifier}${column}`).join(', ');

function filterClause(filters: CandidateFilters, qualifier = ''): { sql: string; params: Array<NodeKind | Language> } {
  const predicates: string[] = [];
  const params: Array<NodeKind | Language> = [];
  if (filters.kinds && filters.kinds.length > 0) {
    predicates.push(`${qualifier}kind IN (${filters.kinds.map(() => '?').join(',')})`);
    params.push(...filters.kinds);
  }
  if (filters.languages && filters.languages.length > 0) {
    predicates.push(`${qualifier}language IN (${filters.languages.map(() => '?').join(',')})`);
    params.push(...filters.languages);
  }
  return { sql: predicates.length === 0 ? '' : ` AND ${predicates.join(' AND ')}`, params };
}

const decodeNodes = (rows: readonly NodeRow[]): Node[] => rows.map(rowToNode);

const decodeScored = (rows: readonly ScoredNodeRow[], score: (row: ScoredNodeRow) => number): SearchResult[] =>
  rows.map((row) => ({ node: rowToNode(row), score: score(row) }));

export class SearchCandidateReader {
  readonly ftsAvailable: boolean;

  constructor(private readonly session: QuerySession) {
    try {
      session.db.prepare('SELECT id FROM nodes_fts LIMIT 0').get();
      this.ftsAvailable = true;
    } catch {
      this.ftsAvailable = false;
    }
  }

  all(filters: CandidateFilters, limit: number): SearchResult[] {
    const filter = filterClause(filters);
    const sql = `SELECT ${selectNodes()} FROM nodes WHERE 1=1${filter.sql} ORDER BY name LIMIT ?`;
    const rows = this.session.db.prepare(sql).all(...filter.params, limit) as NodeRow[];
    return decodeNodes(rows).map((node) => ({ node, score: 1 }));
  }

  exactTerm(term: string, filters: CandidateFilters, limit: number): Node[] {
    const filter = filterClause(filters);
    const sql = `SELECT ${selectNodes()} FROM nodes WHERE lower(name) = lower(?)${filter.sql} LIMIT ?`;
    return decodeNodes(this.session.db.prepare(sql).all(term, ...filter.params, limit) as NodeRow[]);
  }

  exactSpelling(name: string, filters: CandidateFilters, limit: number): Node[] {
    const filter = filterClause(filters);
    const sql = `SELECT ${selectNodes()} FROM nodes WHERE name = ?${filter.sql} LIMIT ?`;
    return decodeNodes(this.session.db.prepare(sql).all(name, ...filter.params, limit) as NodeRow[]);
  }

  prefixText(query: string, filters: CandidateFilters, limit: number, offset: number): SearchResult[] {
    const expression = query
      .replace(/::/g, ' ')
      .replace(/['"*():^]/g, '')
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .filter((term) => !/^(AND|OR|NOT|NEAR)$/i.test(term))
      .map((term) => `"${term}"*`)
      .join(' OR ');
    if (!expression) return [];

    const filter = filterClause(filters, 'nodes.');
    const sql = `
      SELECT ${selectNodes('nodes.')}, bm25(nodes_fts, 0, 20, 5, 1, 2) AS score
        FROM nodes_fts
        JOIN nodes ON nodes_fts.id = nodes.id
       WHERE nodes_fts MATCH ?${filter.sql}
    ORDER BY score
       LIMIT ? OFFSET ?`;
    try {
      const rows = this.session.db.prepare(sql).all(expression, ...filter.params, limit, offset) as ScoredNodeRow[];
      return decodeScored(rows, (row) => Math.abs(row.score));
    } catch {
      return [];
    }
  }

  substringText(query: string, filters: CandidateFilters, limit: number, offset: number): SearchResult[] {
    const filter = filterClause(filters);
    const startsWith = `${query}%`;
    const contains = `%${query}%`;
    const sql = `
      SELECT ${selectNodes()},
             CASE
               WHEN name = ? THEN 1.0
               WHEN name LIKE ? THEN 0.9
               WHEN name LIKE ? THEN 0.8
               WHEN qualified_name LIKE ? THEN 0.7
               ELSE 0.5
             END AS score
        FROM nodes
       WHERE (name LIKE ? OR qualified_name LIKE ? OR name LIKE ?)${filter.sql}
    ORDER BY score DESC, length(name) ASC
       LIMIT ? OFFSET ?`;
    const params = [query, startsWith, contains, contains, contains, contains, startsWith, ...filter.params, limit, offset];
    const rows = this.session.db.prepare(sql).all(...params) as ScoredNodeRow[];
    return decodeScored(rows, (row) => row.score);
  }

  filesForExactName(name: string, kinds: readonly NodeKind[] | undefined, limit: number): string[] {
    const filter = filterClause({ kinds });
    const sql = `SELECT DISTINCT file_path FROM nodes WHERE lower(name) = lower(?)${filter.sql} LIMIT ?`;
    const rows = this.session.db.prepare(sql).all(name, ...filter.params, limit) as Array<{ file_path: string }>;
    return rows.map((row) => row.file_path);
  }

  exactName(name: string, filters: CandidateFilters, limit: number): SearchResult[] {
    return this.exactTerm(name, filters, limit).map((node) => ({ node, score: 1 }));
  }

  nameSubstring(
    substring: string,
    filters: CandidateFilters & { excludePrefix?: boolean },
    limit: number
  ): SearchResult[] {
    const filter = filterClause(filters);
    const prefixExclusion = filters.excludePrefix ? ' AND name NOT LIKE ?' : '';
    const sql = `SELECT ${selectNodes()}, 1.0 AS score FROM nodes WHERE name LIKE ?${prefixExclusion}${filter.sql} ORDER BY length(name) ASC LIMIT ?`;
    const params: Array<string | number> = [`%${substring}%`];
    if (filters.excludePrefix) params.push(`${substring}%`);
    params.push(...filter.params, limit);
    const rows = this.session.db.prepare(sql).all(...params) as ScoredNodeRow[];
    return decodeScored(rows, (row) => row.score);
  }
}
