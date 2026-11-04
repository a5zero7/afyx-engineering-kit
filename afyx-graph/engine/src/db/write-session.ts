/**
 * The shared state every persisted write goes through.
 *
 * A `WriteSession` is bound to one database handle. It owns the prepared-statement cache
 * (statements are keyed by their SQL text and reused), the multi-row insert machinery, and
 * the transaction entry point. When the underlying connection is swapped — pool workers
 * recycle their read connections to stop a long-lived reader pinning WAL checkpoints —
 * `rebind` drops everything derived from the old handle; nothing else about the session
 * changes.
 */

import { SQLITE_PARAM_CHUNK_SIZE } from './sql-limits';
import type { SqliteDatabase, SqliteStatement } from './sqlite-adapter';

/**
 * Callbacks into whoever caches decoded rows. A write that changes or removes a node
 * must make the cache forget it, or the next read would serve the previous version.
 */
export interface RowCacheHooks {
  forgetNode(id: string): void;
  forgetFile(filePath: string): void;
  forgetAll(): void;
}

/**
 * Row counts a multi-row INSERT is built for. N rows decompose greedily into these fixed
 * sizes, so each size's statement is prepared once and reused: one `run()` then binds a
 * whole chunk, which is where per-call overhead lives. Rows go out in input order within
 * and across chunks, so rowid assignment — and with it resolution's insertion-order
 * disambiguation — is identical to inserting one row at a time.
 */
const CHUNK_ROWS: readonly number[] = [128, 32, 8, 1];

export class WriteSession {
  private handle: SqliteDatabase;
  private readonly statements = new Map<string, SqliteStatement>();
  private readonly chunkStatements = new Map<string, SqliteStatement>();

  constructor(
    db: SqliteDatabase,
    readonly cache: RowCacheHooks
  ) {
    this.handle = db;
  }

  get db(): SqliteDatabase {
    return this.handle;
  }

  /** Point the session at a new connection; prepared statements belong to the old one. */
  rebind(db: SqliteDatabase): void {
    this.handle = db;
    this.statements.clear();
    this.chunkStatements.clear();
  }

  /** The prepared statement for `sql`, prepared on first use. */
  statement(sql: string): SqliteStatement {
    let prepared = this.statements.get(sql);
    if (!prepared) {
      prepared = this.handle.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }

  /**
   * A statement for an `IN (...)` list of `size` placeholders. Full-size chunks are reused;
   * the trailing partial chunk is prepared for the one call, so odd sizes never pile up in the cache.
   */
  listStatement(sql: string, size: number): SqliteStatement {
    return size === SQLITE_PARAM_CHUNK_SIZE ? this.statement(sql) : this.handle.prepare(sql);
  }

  /** Run `body` in one transaction (joining an enclosing one). */
  transaction<T>(body: () => T): T {
    return this.handle.transaction(body)();
  }

  /**
   * Insert `rows` with statements of the form `head + (tuple,)*n`, using the fewest, largest
   * chunks. `kind` names the statement family in the cache; each row must match `tuple`'s arity.
   */
  insertRows(kind: string, head: string, tuple: string, rows: unknown[][]): void {
    let done = 0;
    for (const size of CHUNK_ROWS) {
      while (rows.length - done >= size) {
        const key = `${kind}:${size}`;
        let statement = this.chunkStatements.get(key);
        if (!statement) {
          statement = this.handle.prepare(head + new Array(size).fill(tuple).join(','));
          this.chunkStatements.set(key, statement);
        }
        if (size === 1) {
          statement.run(...rows[done]!);
        } else {
          const bound: unknown[] = [];
          for (let offset = 0; offset < size; offset++) bound.push(...rows[done + offset]!);
          statement.run(...bound);
        }
        done += size;
      }
    }
  }
}
