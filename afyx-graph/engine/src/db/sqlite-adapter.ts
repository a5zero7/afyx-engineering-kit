/**
 * SQLite adapter.
 *
 * The storage engine is Node's built-in `node:sqlite`. This module puts a small,
 * storage-agnostic surface in front of it — statements, pragmas, transactions,
 * idempotent close — so nothing above it depends on the driver's own API shape.
 *
 * Afyx Graph requires external Node >= 22.5, where `node:sqlite` provides real SQLite
 * with WAL and FTS5. There is no native build step and no fallback backend.
 */

export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
  /**
   * Yield rows one at a time instead of materializing the whole result. Unbounded
   * scans (every function node of a dense project) use this so memory stays flat in
   * the row count — see #610, where `all()` on such a scan ran the heap out.
   */
  iterate(...params: any[]): IterableIterator<any>;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): any;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
  readonly open: boolean;
}

/**
 * The backend serving a connection. There is exactly one today; the name stays a type so
 * status output and per-connection reporting keep a stable shape.
 */
export type SqliteBackend = 'node-sqlite';

/** Bind a driver statement to the engine's statement shape. */
function wrapStatement(native: any): SqliteStatement {
  const normalizeRun = (params: any[]): { changes: number; lastInsertRowid: number | bigint } => {
    const outcome = native.run(...params);
    return {
      changes: Number(outcome?.changes ?? 0),
      lastInsertRowid: outcome?.lastInsertRowid ?? 0,
    };
  };
  return {
    run: (...params: any[]) => normalizeRun(params),
    get: (...params: any[]) => native.get(...params),
    all: (...params: any[]) => native.all(...params),
    iterate: (...params: any[]) => native.iterate(...params),
  };
}

/**
 * Adapter over `node:sqlite`'s `DatabaseSync`.
 *
 * `node:sqlite` already speaks positional and `@named` parameters and every pragma, so
 * statements pass straight through; the adapter adds only what the driver leaves out —
 * a pragma helper, transactions that flatten when nested, an `open` flag, and a close
 * that may be called more than once.
 */
class NodeSqliteAdapter implements SqliteDatabase {
  private readonly native: any;
  /** How many `transaction()` bodies are currently running on this connection. */
  private transactionDepth = 0;

  constructor(dbPath: string, opts?: { readOnly?: boolean }) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    // The driver rejects an explicit `undefined` options argument, so only pass one when needed.
    const args: [string, ...object[]] = opts?.readOnly ? [dbPath, { readOnly: true }] : [dbPath];
    this.native = new DatabaseSync(...args);
  }

  get open(): boolean {
    return this.native.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    return wrapStatement(this.native.prepare(sql));
  }

  exec(sql: string): void {
    this.native.exec(sql);
  }

  /**
   * `"name = value"` applies the pragma and returns nothing; a bare `"name"` reads it —
   * the row object by default, just the single column with `{ simple: true }`.
   */
  pragma(str: string, options?: { simple?: boolean }): any {
    const text = str.trim();
    if (text.includes('=')) {
      this.native.exec(`PRAGMA ${text}`);
      return;
    }
    const row = this.native.prepare(`PRAGMA ${text}`).get();
    if (options?.simple) return row && typeof row === 'object' ? Object.values(row)[0] : row;
    return row;
  }

  /**
   * Wrap `fn` so each call runs as one transaction. A call made while another
   * transaction is running joins it — there is no nested rollback granularity, and no
   * caller has ever relied on any (`BEGIN` inside a transaction would simply throw).
   */
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return (...args: any[]): T => this.withTransaction(() => fn(...args));
  }

  private withTransaction<T>(operation: () => T): T {
    const ownsBoundary = this.transactionDepth === 0;
    if (ownsBoundary) this.native.exec('BEGIN');
    this.transactionDepth += 1;
    try {
      const result = operation();
      if (ownsBoundary) this.native.exec('COMMIT');
      return result;
    } catch (error) {
      if (ownsBoundary) this.native.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  /** `DatabaseSync.close()` throws when already closed; callers close defensively, so it must not. */
  close(): void {
    if (this.native.isOpen) this.native.close();
  }
}

/**
 * Open a database file with `node:sqlite`.
 *
 * The backend is returned with the handle so each `DatabaseConnection` reports its own:
 * MCP can hold several project databases in one process, and a process-wide value
 * would race.
 */
export function createDatabase(dbPath: string, opts?: { readOnly?: boolean }): { db: SqliteDatabase; backend: SqliteBackend } {
  try {
    return { db: new NodeSqliteAdapter(dbPath, opts), backend: 'node-sqlite' };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Failed to open SQLite via the built-in node:sqlite module.\n' +
      'Afyx Graph requires node:sqlite (Node.js 22.5+). Install or select a supported\n' +
      'external Node.js runtime, then retry.\n' +
      `Underlying error: ${cause}`
    );
  }
}
