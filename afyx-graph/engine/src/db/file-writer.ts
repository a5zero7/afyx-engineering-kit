/**
 * Persisted writes for `files`: one row per tracked source file, holding the content hash
 * and index bookkeeping the sync logic compares against.
 */

import type { FileRecord } from '../types';
import type { NodeWriter } from './node-writer';
import type { WriteSession } from './write-session';

const UPSERT_SQL = `
  INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, indexing_level, errors, generated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET
    content_hash = excluded.content_hash,
    language = excluded.language,
    size = excluded.size,
    modified_at = excluded.modified_at,
    indexed_at = excluded.indexed_at,
    node_count = excluded.node_count,
    indexing_level = excluded.indexing_level,
    errors = excluded.errors,
    generated = excluded.generated
`;

export class FileWriter {
  constructor(
    private readonly session: WriteSession,
    private readonly nodes: NodeWriter
  ) {}

  /**
   * Insert a file record or update the existing one. Every column is rewritten, the
   * `generated` flag included: a file that loses its banner in an edit must lose the flag on
   * the next sync rather than keep a stale 1.
   */
  upsert(file: FileRecord): void {
    this.session.statement(UPSERT_SQL).run(
      file.path,
      file.contentHash,
      file.language,
      file.size,
      file.modifiedAt,
      file.indexedAt,
      file.nodeCount,
      file.indexingLevel ?? 'structural',
      file.errors ? JSON.stringify(file.errors) : null,
      file.generated ? 1 : 0
    );
  }

  /** Remove a file's record and, with it, its nodes (edges and refs follow by cascade) atomically. */
  delete(filePath: string): void {
    this.session.transaction(() => {
      this.nodes.deleteByFile(filePath);
      this.session.statement('DELETE FROM files WHERE path = ?').run(filePath);
    });
  }
}
