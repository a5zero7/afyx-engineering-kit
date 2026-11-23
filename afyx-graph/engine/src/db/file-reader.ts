/**
 * Persisted file catalog and index-state reads.
 *
 * Paths are exact database identities here. Discovery owns conversion to the
 * repository-relative stored form; this reader never consults the filesystem or
 * applies a second normalization policy.
 */

import type { FileRecord, Node } from '../types';
import { isGeneratedFile } from '../extraction/generated-detection';
import { chunked, placeholders, QuerySession } from './query-session';
import { rowToFileRecord, rowToNode, type FileRow, type NodeRow } from './row-mappers';

const FILE_COLUMNS = 'path, content_hash, language, size, modified_at, indexed_at, node_count, indexing_level, errors, generated';

const FILE_QUERY = {
  byPath: `SELECT ${FILE_COLUMNS} FROM files WHERE path = ?`,
  population: `SELECT ${FILE_COLUMNS} FROM files ORDER BY path`,
  paths: 'SELECT path FROM files ORDER BY path',
  fileNodes: "SELECT * FROM nodes WHERE kind = 'file' AND file_path IN (SELECT value FROM json_each(?))",
  latestIndex: 'SELECT MAX(indexed_at) AS value FROM files',
  revision: 'SELECT MAX(indexed_at) AS value, COUNT(*) AS population FROM files',
  changesCount: 'SELECT COUNT(*) AS value FROM files WHERE indexed_at > ?',
  changes: 'SELECT path FROM files WHERE indexed_at > ? ORDER BY indexed_at DESC, path LIMIT ?',
  generatedCount: 'SELECT COUNT(*) AS value FROM files WHERE generated = 1',
} as const;

type PathRow = { path: string };
type ScalarRow = { value: number | null };

const decodeFiles = (rows: readonly FileRow[]): FileRecord[] => rows.map(rowToFileRecord);

function interfaceMemberProbe(nodeAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM edges membership JOIN nodes owner ON owner.id = membership.source
     WHERE membership.target = ${nodeAlias}.id
       AND membership.kind = 'contains'
       AND owner.kind = 'interface'
  )`;
}

function ambientSummaryQuery(width: number): string {
  const interfaceMember = interfaceMemberProbe('node');
  return `
    SELECT node.file_path AS path,
           SUM(CASE WHEN node.kind NOT IN ('file','import','export','parameter')
                     AND NOT ${interfaceMember} THEN 1 ELSE 0 END) AS declarations,
           SUM(CASE WHEN node.kind IN ('interface','type_alias','enum','enum_member','namespace')
                    THEN 1 ELSE 0 END) AS typeDeclarations
      FROM nodes node
     WHERE node.file_path IN (${placeholders(width)})
  GROUP BY node.file_path
  `;
}

function ambientBehaviorQuery(width: number): string {
  return `
    SELECT DISTINCT source.file_path AS path
      FROM edges relation JOIN nodes source ON source.id = relation.source
     WHERE relation.kind IN ('calls','instantiates')
       AND source.file_path IN (${placeholders(width)})
       AND NOT ${interfaceMemberProbe('source')}
  `;
}

function ambientInboundQuery(width: number): string {
  return `
    SELECT DISTINCT target.file_path AS path
      FROM edges relation
      JOIN nodes target ON target.id = relation.target
      JOIN nodes source ON source.id = relation.source
     WHERE target.file_path IN (${placeholders(width)})
       AND source.file_path <> target.file_path
       AND NOT ${interfaceMemberProbe('target')}
  `;
}

export class FileReader {
  constructor(private readonly session: QuerySession) {}

  getFileByPath(filePath: string): FileRecord | null {
    const row = this.session.statement(FILE_QUERY.byPath).get(filePath) as FileRow | undefined;
    return row === undefined ? null : rowToFileRecord(row);
  }

  getAllFiles(): FileRecord[] {
    return decodeFiles(this.session.statement(FILE_QUERY.population).all() as FileRow[]);
  }

  getAllFilePaths(): string[] {
    return (this.session.statement(FILE_QUERY.paths).all() as PathRow[]).map(({ path }) => path);
  }

  getFileNodes(filePaths: string[]): Node[] {
    if (filePaths.length === 0) return [];
    const rows = this.session.statement(FILE_QUERY.fileNodes).all(JSON.stringify(filePaths)) as NodeRow[];
    return rows.map(rowToNode);
  }

  getLastIndexedAt(): number | null {
    return (this.session.statement(FILE_QUERY.latestIndex).get() as ScalarRow | undefined)?.value ?? null;
  }

  getIndexRevision(): { lastIndexedAt: number | null; fileCount: number } {
    const row = this.session.statement(FILE_QUERY.revision).get() as
      | { value: number | null; population: number }
      | undefined;
    return { lastIndexedAt: row?.value ?? null, fileCount: row?.population ?? 0 };
  }

  getFilesIndexedSince(since: number, limit: number): { paths: string[]; total: number } {
    const total = (this.session.statement(FILE_QUERY.changesCount).get(since) as ScalarRow | undefined)?.value;
    const paths = (this.session.statement(FILE_QUERY.changes).all(since, Math.max(0, limit)) as PathRow[])
      .map(({ path }) => path);
    return { paths, total: total ?? paths.length };
  }

  getStaleFiles(currentHashes: Map<string, string>): FileRecord[] {
    return this.getAllFiles().filter((record) => {
      const observed = currentHashes.get(record.path);
      return observed !== undefined && observed !== record.contentHash;
    });
  }

  getGeneratedPathsAmong(filePaths: Iterable<string>): Set<string> {
    return this.collectStoredPaths(filePaths, (width) =>
      `SELECT path FROM files WHERE generated = 1 AND path IN (${placeholders(width)})`
    );
  }

  generatedPredicateFor(filePaths: Iterable<string>): (filePath: string) => boolean {
    const indexedGenerated = this.getGeneratedPathsAmong(filePaths);
    return (filePath: string) => indexedGenerated.has(filePath) || isGeneratedFile(filePath);
  }

  getAmbientDeclarationPathsAmong(filePaths: Iterable<string>): Set<string> {
    const ambient = new Set<string>();
    for (const group of chunked([...new Set(filePaths)])) {
      const summaries = this.session.db.prepare(ambientSummaryQuery(group.length)).all(...group) as Array<{
        path: string;
        declarations: number;
        typeDeclarations: number;
      }>;
      const candidates = new Set(
        summaries
          .filter(({ declarations, typeDeclarations }) => declarations > 0 && declarations === typeDeclarations)
          .map(({ path }) => path)
      );
      this.removeMatching(candidates, ambientBehaviorQuery);
      this.removeMatching(candidates, ambientInboundQuery);
      for (const filePath of candidates) ambient.add(filePath);
    }
    return ambient;
  }

  ambientDeclarationPredicateFor(filePaths: Iterable<string>): (filePath: string) => boolean {
    const ambient = this.getAmbientDeclarationPathsAmong(filePaths);
    return (filePath: string) => ambient.has(filePath);
  }

  countGeneratedFiles(): number {
    return (this.session.statement(FILE_QUERY.generatedCount).get() as ScalarRow | undefined)?.value ?? 0;
  }

  private collectStoredPaths(filePaths: Iterable<string>, queryFor: (width: number) => string): Set<string> {
    const found = new Set<string>();
    for (const group of chunked([...new Set(filePaths)])) {
      const query = queryFor(group.length);
      const rows = this.session.listStatement(query, group.length).all(...group) as PathRow[];
      for (const row of rows) found.add(row.path);
    }
    return found;
  }

  private removeMatching(candidates: Set<string>, queryFor: (width: number) => string): void {
    if (candidates.size === 0) return;
    const paths = [...candidates];
    const rows = this.session.db.prepare(queryFor(paths.length)).all(...paths) as PathRow[];
    for (const row of rows) candidates.delete(row.path);
  }
}
