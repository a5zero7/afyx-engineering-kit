/**
 * Read model for unresolved references and the resolved edges that may need to
 * return to that queue after an incremental change.
 */

import type { Edge, Language, UnresolvedReference } from '../types';
import { chunked, placeholders, QuerySession } from './query-session';
import { rowToEdge, rowToUnresolvedRef, type EdgeRow, type UnresolvedRefRow } from './row-mappers';

const REFERENCE_COLUMNS = [
  'id', 'from_node_id', 'reference_name', 'reference_kind', 'line', 'col',
  'candidates', 'file_path', 'language', 'status', 'name_tail',
].join(', ');

const selectReferences = (where = ''): string =>
  `SELECT ${REFERENCE_COLUMNS} FROM unresolved_refs${where ? ` ${where}` : ''}`;

const FIXED_QUERY = {
  all: selectReferences(),
  byName: selectReferences('WHERE reference_name = ?'),
  bySource: selectReferences('WHERE from_node_id = ?'),
  pendingCount: "SELECT COUNT(*) AS count FROM unresolved_refs WHERE status = 'pending'",
  pendingPage: selectReferences("WHERE status = 'pending' ORDER BY rowid LIMIT ? OFFSET ?"),
  inFile: selectReferences('WHERE file_path = ? ORDER BY line, col LIMIT ?'),
} as const;

const PREREQUISITE_KINDS = "('imports', 'extends', 'implements')";

type ResolutionEdge = Edge & {
  edgeId: number;
  sourceFilePath: string;
  sourceLanguage: Language;
};

function decodeReferences(rows: readonly UnresolvedRefRow[]): UnresolvedReference[] {
  return rows.map(rowToUnresolvedRef);
}

function uniqueNonEmpty(values: Iterable<string>): string[] {
  return [...new Set(values)].filter((value) => value.length > 0);
}

export class ReferenceReader {
  constructor(private readonly session: QuerySession) {}

  private read(sql: string, params: readonly unknown[] = []): UnresolvedReference[] {
    return decodeReferences(this.session.statement(sql).all(...params) as UnresolvedRefRow[]);
  }

  /** Preserve input chunk boundaries while accumulating an unbounded logical result. */
  private readReferenceChunks(values: readonly string[], whereForSize: (size: number) => string): UnresolvedReference[] {
    const found: UnresolvedReference[] = [];
    for (const part of chunked(values)) {
      const sql = selectReferences(whereForSize(part.length));
      const rows = this.session.listStatement(sql, part.length).all(...part) as UnresolvedRefRow[];
      for (const row of rows) found.push(rowToUnresolvedRef(row));
    }
    return found;
  }

  /** Keep only names whose matching population does not exceed the retry safety ceiling. */
  private namesWithinCeiling(
    names: readonly string[],
    ceiling: number,
    countQuery: (size: number) => string
  ): string[] {
    const accepted: string[] = [];
    for (const part of chunked(names)) {
      const counts = this.session.db.prepare(countQuery(part.length)).all(...part) as Array<{ name: string; count: number }>;
      for (const row of counts) {
        if (row.count <= ceiling) accepted.push(row.name);
      }
    }
    return accepted;
  }

  getUnresolvedByName(name: string): UnresolvedReference[] {
    return this.read(FIXED_QUERY.byName, [name]);
  }

  getUnresolvedReferences(): UnresolvedReference[] {
    return this.read(FIXED_QUERY.all);
  }

  /** Failed rows are retry candidates, not pending work. */
  getUnresolvedReferencesCount(): number {
    const row = this.session.statement(FIXED_QUERY.pendingCount).get() as { count: number };
    return row.count;
  }

  /** Stable row-id enumeration is required by the pipelined OFFSET resolver. */
  getUnresolvedReferencesBatch(offset: number, limit: number): UnresolvedReference[] {
    return this.read(FIXED_QUERY.pendingPage, [limit, offset]);
  }

  /**
   * Keyset enumeration avoids repeatedly scanning failed rows. A phase may select
   * prerequisite reference kinds or their complement while retaining row-id order.
   */
  getUnresolvedReferencesBatchAfter(afterRowId: number, limit: number, prerequisites?: boolean): UnresolvedReference[] {
    let phase = '';
    if (prerequisites !== undefined) {
      phase = ` AND reference_kind ${prerequisites ? 'IN' : 'NOT IN'} ${PREREQUISITE_KINDS}`;
    }
    const sql = selectReferences(`WHERE status = 'pending' AND id > ?${phase} ORDER BY id LIMIT ?`);
    return this.read(sql, [afterRowId, limit]);
  }

  /** A bounded, source-ordered view used by file diagnostics and resolution evidence. */
  getUnresolvedReferencesInFile(filePath: string, limit = 5000): UnresolvedReference[] {
    return this.read(FIXED_QUERY.inFile, [filePath, limit]);
  }

  getUnresolvedReferencesFrom(fromNodeId: string): UnresolvedReference[] {
    return this.read(FIXED_QUERY.bySource, [fromNodeId]);
  }

  /** Read pending references for every requested file without imposing a result cap. */
  getUnresolvedReferencesByFiles(filePaths: string[]): UnresolvedReference[] {
    if (filePaths.length === 0) return [];
    return this.readReferenceChunks(
      filePaths,
      (size) => `WHERE status = 'pending' AND file_path IN (${placeholders(size)})`
    );
  }

  /** Match both the recorded reference and its terminal name segment. */
  getUnresolvedNamesAmong(names: Iterable<string>): Set<string> {
    const candidates = uniqueNonEmpty(names);
    const found = new Set<string>();
    for (const part of chunked(candidates)) {
      const marks = placeholders(part.length);
      const rows = this.session.db.prepare(`
        SELECT DISTINCT reference_name AS name FROM unresolved_refs WHERE reference_name IN (${marks})
        UNION
        SELECT DISTINCT name_tail AS name FROM unresolved_refs WHERE name_tail IN (${marks})
      `).all(...part, ...part) as Array<{ name: string }>;
      for (const row of rows) found.add(row.name);
    }
    return found;
  }

  /** Failed references worth retrying after a matching definition appears. */
  getRetryableFailedReferences(names: string[], perNameCeiling = 500): UnresolvedReference[] {
    if (names.length === 0) return [];
    const retryNames = this.namesWithinCeiling(names, perNameCeiling, (size) => `
      SELECT name_tail AS name, COUNT(*) AS count
        FROM unresolved_refs
       WHERE status = 'failed' AND name_tail IN (${placeholders(size)})
    GROUP BY name_tail`);
    if (retryNames.length === 0) return [];
    return this.readReferenceChunks(
      retryNames,
      (size) => `WHERE status = 'failed' AND name_tail IN (${placeholders(size)})`
    );
  }

  /** Non-heuristic resolved edges eligible for incremental reconciliation. */
  getResolutionEdgesByTargetName(names: string[], perNameCeiling = 500): ResolutionEdge[] {
    if (names.length === 0) return [];
    const acceptedNames = this.namesWithinCeiling(names, perNameCeiling, (size) => `
      SELECT tgt.name AS name, COUNT(*) AS count
        FROM edges e
        JOIN nodes tgt ON tgt.id = e.target
       WHERE tgt.name IN (${placeholders(size)})
         AND (e.provenance IS NULL OR e.provenance != 'heuristic')
    GROUP BY tgt.name`);
    if (acceptedNames.length === 0) return [];

    const result: ResolutionEdge[] = [];
    for (const part of chunked(acceptedNames)) {
      const rows = this.session.db.prepare(`
        SELECT e.*, src.file_path AS source_file_path, src.language AS source_language
          FROM edges e
          JOIN nodes tgt ON tgt.id = e.target
          JOIN nodes src ON src.id = e.source
         WHERE tgt.name IN (${placeholders(part.length)})
           AND (e.provenance IS NULL OR e.provenance != 'heuristic')
      `).all(...part) as Array<EdgeRow & { source_file_path: string; source_language: Language }>;
      for (const row of rows) {
        result.push({
          ...rowToEdge(row),
          edgeId: row.id,
          sourceFilePath: row.source_file_path,
          sourceLanguage: row.source_language,
        });
      }
    }
    return result;
  }
}
