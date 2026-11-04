/**
 * The shared state every reader queries through: one connection, one place that
 * prepares and reuses statements. When the connection is swapped (`rebind`, for pool
 * workers recycling their read connection — see `WriteSession`), every prepared
 * statement is dropped; readers re-prepare lazily on next use, and nothing else about
 * them resets.
 */

import { SQLITE_PARAM_CHUNK_SIZE } from './sql-limits';
import type { SqliteDatabase, SqliteStatement } from './sqlite-adapter';

export class QuerySession {
  private handle: SqliteDatabase;
  private readonly statements = new Map<string, SqliteStatement>();

  constructor(db: SqliteDatabase) {
    this.handle = db;
  }

  get db(): SqliteDatabase {
    return this.handle;
  }

  rebind(db: SqliteDatabase): void {
    this.handle = db;
    this.statements.clear();
  }

  /** The prepared statement for `sql`, prepared on first use and reused after. */
  statement(sql: string): SqliteStatement {
    let prepared = this.statements.get(sql);
    if (!prepared) {
      prepared = this.handle.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }

  /** A statement for an `IN (...)` list of `size` placeholders: cached at the full chunk size, prepared ad hoc for a trailing partial chunk. */
  listStatement(sql: string, size: number): SqliteStatement {
    return size === SQLITE_PARAM_CHUNK_SIZE ? this.statement(sql) : this.handle.prepare(sql);
  }
}

/** `?,?,?` for `count` bound values — the IN-list shape every chunked reader needs. */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(',');
}

/** Split `items` into chunks no larger than the SQLite bound-parameter limit. */
export function* chunked<T>(items: readonly T[]): IterableIterator<T[]> {
  for (let start = 0; start < items.length; start += SQLITE_PARAM_CHUNK_SIZE) {
    yield items.slice(start, start + SQLITE_PARAM_CHUNK_SIZE) as T[];
  }
}
