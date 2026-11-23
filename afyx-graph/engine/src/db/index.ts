/**
 * Database session.
 *
 * `DatabaseConnection` owns one open SQLite database for its whole life: creating it
 * and its schema, opening and migrating it, running transactions, repairing what a
 * killed process left behind, and closing it. What sits on top of it (writers, the query
 * layer) only ever sees `getDb()`.
 *
 * The pieces live beside it: `sqlite-adapter` (the driver), `connection-tuning`
 * (pragmas), `schema-script` (the DDL text), `migrations`, `bulk-windows` (index and
 * trigger windows around mass writes) and `wal-maintenance` (checkpoints and healing).
 */

import * as fs from 'fs';
import * as path from 'path';
import { SchemaVersion } from '../types';
import { getDatabasePath } from '../directory';
import { BulkWindows } from './bulk-windows';
import { WAL_HEAL_THRESHOLD_BYTES, resolveWalHealBytes, tuneConnection } from './connection-tuning';
import { CURRENT_SCHEMA_VERSION, getCurrentVersion, runMigrations } from './migrations';
import { splitSchema } from './schema-script';
import { SqliteBackend, SqliteDatabase, createDatabase } from './sqlite-adapter';
import { WalMaintenance, type CheckpointResult, type WalHealResult } from './wal-maintenance';

export { getDatabasePath };
export { SqliteDatabase, SqliteBackend } from './sqlite-adapter';
export { WAL_HEAL_THRESHOLD_BYTES, resolveWalHealBytes };

/**
 * `dev:ino` of a file, or null when it cannot be stat'd or the platform has no usable inode.
 * Windows reports null on purpose: its st_ino is unreliable across handle reopens, and the
 * hazard this feeds (a held file unlinked and replaced, #925) cannot occur there, since an
 * open file cannot be unlinked.
 */
function inodeOf(file: string): string | null {
  if (process.platform === 'win32') return null;
  try {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

/** Size of a file in bytes, or 0 when it cannot be read. */
function sizeOnDisk(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Create every schema object. Without FTS5 the full-text section is skipped and the rest still created (#1532). */
function createSchema(db: SqliteDatabase): boolean {
  const { head, fts, tail } = splitSchema();
  if (fts === null) {
    db.exec(head);
    return true;
  }
  db.exec(head);
  let ftsAvailable = true;
  try {
    db.exec(fts);
  } catch (err: any) {
    ftsAvailable = false;
    console.warn(
      `[afyx-graph] FTS5 not available in this Node.js build (${err?.message ?? String(err)}). ` +
      `Search will fall back to LIKE + fuzzy matching. ` +
      `For full-text search, use a Node.js build with FTS5 enabled.`
    );
  }
  db.exec(tail);
  return ftsAvailable;
}

/** One open database and everything that manages it. */
export class DatabaseConnection {
  private readonly db: SqliteDatabase;
  private readonly dbPath: string;
  private readonly backend: SqliteBackend;
  private readonly windows: BulkWindows;
  private readonly wal: WalMaintenance;
  /**
   * `dev:ino` of the file at open time. If a different inode later sits at the same path
   * — a worktree removed and re-added, or `.afyx-graph/` deleted and re-initialized under
   * a long-lived server — this handle points at an unlinked file that can never see new
   * writes (#925). See `isReplacedOnDisk`.
   */
  private readonly openedInode: string | null;

  /** Whether this Node build has FTS5; without it search falls back to LIKE plus fuzzy matching (#1532). */
  readonly fts5Available: boolean;

  private constructor(db: SqliteDatabase, dbPath: string, backend: SqliteBackend, fts5Available: boolean) {
    this.db = db;
    this.dbPath = dbPath;
    this.backend = backend;
    this.fts5Available = fts5Available;
    this.openedInode = inodeOf(dbPath);
    this.windows = new BulkWindows(db, fts5Available);
    this.wal = new WalMaintenance(db, dbPath);
  }

  /** Create a database (and its parent directory) with the current schema. */
  static initialize(dbPath: string): DatabaseConnection {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const { db, backend } = createDatabase(dbPath);
    try {
      tuneConnection(db);
      const fts5Available = createSchema(db);

      // A fresh schema already contains every migration; record that so open() does not re-apply them.
      if (getCurrentVersion(db) < CURRENT_SCHEMA_VERSION) {
        db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)')
          .run(CURRENT_SCHEMA_VERSION, Date.now(), 'Initial schema includes all migrations');
      }
      return new DatabaseConnection(db, dbPath, backend, fts5Available);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** Open an existing database, migrating it forward and repairing interrupted bulk windows. */
  static open(dbPath: string): DatabaseConnection {
    if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

    const { db, backend } = createDatabase(dbPath);
    let conn: DatabaseConnection;
    try {
      tuneConnection(db);

      let fts5Available = true;
      try {
        db.exec('SELECT * FROM nodes_fts LIMIT 0');
      } catch {
        fts5Available = false;
      }

      conn = new DatabaseConnection(db, dbPath, backend, fts5Available);
      const version = getCurrentVersion(db);
      if (version < CURRENT_SCHEMA_VERSION) runMigrations(db, version);

      // A crash between a begin*Load and its end*Load leaves triggers or indexes missing.
      conn.healBulkNodeLoad();
      conn.healBulkSecondaryIndexes();
    } catch (error) {
      db.close();
      throw error;
    }

    // Fire and forget: one stat when healthy, an off-thread checkpoint when a killed session left a huge WAL (#1431).
    void conn.wal.healOversized();
    return conn;
  }

  // ---- bulk windows -----------------------------------------------------------------------------

  /** Drop the FTS triggers for a mass node insert. Pair with `endBulkNodeLoad` (try/finally). */
  beginBulkNodeLoad(): void { this.windows.beginNodeLoad(); }
  /** Rebuild the FTS index in one pass and restore the triggers. */
  endBulkNodeLoad(): void { this.windows.endNodeLoad(); }
  /** Fresh-init only: drop every parse-lane secondary index and the non-unique edge indexes. */
  beginBulkParseLoad(): void { this.windows.beginParseLoad(); }
  endBulkParseLoad(): Promise<void> { return this.windows.endParseLoad(); }
  /** Drop the unresolved_refs indexes the batched resolution loop does not read. */
  beginBulkRefLoad(): void { this.windows.beginRefLoad(); }
  endBulkRefLoad(): Promise<void> { return this.windows.endRefLoad(); }
  /** Drop the non-unique edge indexes for a mass edge insert. */
  beginBulkEdgeLoad(): void { this.windows.beginEdgeLoad(); }
  endBulkEdgeLoad(): Promise<void> { return this.windows.endEdgeLoad(); }

  /** Repair triggers a killed node-load window left dropped (also reachable by name from tests). */
  private healBulkNodeLoad(): void { this.windows.healTriggers(); }
  /** Repair indexes a killed parse, ref or edge window left dropped. */
  private healBulkSecondaryIndexes(): void { this.windows.healIndexes(); }

  // ---- accessors --------------------------------------------------------------------------------

  /** The underlying database handle. */
  getDb(): SqliteDatabase {
    return this.db;
  }

  /** The backend serving this connection (per connection: MCP may hold several projects open at once). */
  getBackend(): SqliteBackend {
    return this.backend;
  }

  getPath(): string {
    return this.dbPath;
  }

  /**
   * The journal mode actually in effect. SQLite silently keeps the previous mode when WAL
   * cannot be enabled (network or virtualized mounts, WSL2 `/mnt`), so this can differ from
   * what `tuneConnection` asked for. `afyx-graph status` shows it so a "database is locked"
   * report can be triaged: `wal` means readers never block on a writer (#238).
   */
  getJournalMode(): string {
    const raw = this.db.pragma('journal_mode');
    const row = Array.isArray(raw) ? raw[0] : raw;
    const mode = row && typeof row === 'object' ? (row as Record<string, unknown>).journal_mode : row;
    return String(mode ?? '').toLowerCase();
  }

  /** The newest applied schema version, or null for an empty version table. */
  getSchemaVersion(): SchemaVersion | null {
    const row = this.db
      .prepare('SELECT version, applied_at, description FROM schema_versions ORDER BY version DESC LIMIT 1')
      .get() as { version: number; applied_at: number; description: string | null } | undefined;
    if (!row) return null;
    return { version: row.version, appliedAt: row.applied_at, description: row.description ?? undefined };
  }

  /** Run `fn` in a transaction: commit on return, roll back and rethrow on throw. Nested calls join the outer one. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---- sizes and WAL ----------------------------------------------------------------------------

  /** Main database file size in bytes. */
  getSize(): number {
    return fs.statSync(this.dbPath).size;
  }

  /** `-wal` sidecar size in bytes; 0 when it does not exist. */
  getWalSizeBytes(): number {
    return this.wal.walSizeBytes();
  }

  /** Main file size in bytes (0 for in-memory or unknown); the WAL valve scales its caps with it. */
  getDbFileSizeBytes(): number {
    return !this.dbPath || this.dbPath === ':memory:' ? 0 : sizeOnDisk(this.dbPath);
  }

  /** Current `wal_autocheckpoint` interval in pages (0 = disabled). */
  getWalAutocheckpoint(): number {
    const pages = Number(this.db.pragma('wal_autocheckpoint', { simple: true }));
    return Number.isFinite(pages) ? pages : 0;
  }

  /**
   * Set `wal_autocheckpoint` (pages; 0 disables). Bulk indexing defers checkpoints: the
   * default 1000-page auto-checkpoint rewrites hot B-tree and FTS pages into the main file
   * over and over — ~95% of all disk I/O in a bulk index, the difference between 45 s and
   * 19+ minutes on HDD-class storage (#1231). A `WalCheckpointValve` bounds growth meanwhile.
   */
  setWalAutocheckpoint(pages: number): void {
    this.db.pragma(`wal_autocheckpoint = ${Math.max(0, Math.floor(pages))}`);
  }

  /**
   * Passive checkpoint on a worker connection. PASSIVE never blocks the writer; the worker
   * keeps the main thread (and the watchdog heartbeat) turning however long the backfill
   * takes. The result says whether the ENTIRE log was folded back, which the WAL valve needs
   * because a WAL file never shrinks on its own: after the first wrap, raw size says nothing
   * about the un-backfilled backlog. Null on any failure.
   */
  checkpointWalPassive(): Promise<CheckpointResult | null> {
    return this.wal.checkpoint('PASSIVE');
  }

  /**
   * Truncating checkpoint: on success the WAL file is chopped to zero. The valve calls it at a
   * parked barrier (writer parked, pool drained, backfill complete) where no reader can hold
   * a mark; the worker's short busy timeout turns a racing reader into a no-op (`busy = 1`)
   * rather than a stall.
   */
  checkpointWalTruncate(): Promise<CheckpointResult | null> {
    return this.wal.checkpoint('TRUNCATE');
  }

  /** Shrink a leftover oversized WAL now (`open` also does this in the background). */
  healOversizedWal(): Promise<WalHealResult> {
    return this.wal.healOversized();
  }

  // ---- maintenance ------------------------------------------------------------------------------

  /** Reclaim space and refresh planner statistics. Blocking; not for hot paths. */
  optimize(): void {
    this.db.exec('VACUUM');
    this.db.exec('ANALYZE');
  }

  /** Post-write upkeep (`PRAGMA optimize` + passive checkpoint), off the main thread; best effort. */
  runMaintenance(): Promise<void> {
    return this.wal.run();
  }

  // ---- lifecycle --------------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }

  isOpen(): boolean {
    return this.db.open;
  }

  /**
   * True when the file at our path has been REPLACED since we opened it: another inode now
   * lives there, so the descriptor we hold reads a dead file forever (#925). False when the
   * inode is unchanged, when the file is momentarily absent (mid-recreate), or when the
   * platform reports no usable inode (Windows).
   */
  isReplacedOnDisk(): boolean {
    if (this.openedInode === null) return false;
    const current = inodeOf(this.dbPath);
    return current !== null && current !== this.openedInode;
  }
}

/** SQLite's WAL-mode sidecar files, discarded together with the database. */
const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

/**
 * Delete a database file and its WAL sidecars.
 *
 * A FULL re-index discards the old database this way instead of opening it and deleting
 * every row: on a large or poisoned index (one scanned an ignored gitlink corpus into ~1.6M
 * nodes with a multi-GB WAL, #1065) the per-row FTS delete-trigger churn blocks the main
 * thread long enough to trip the watchdog before indexing starts (#1067). Unlinking is O(1)
 * whatever the size, and reclaims the bloated WAL's disk.
 *
 * POSIX removes the entry even while another process still holds the file open; that holder
 * recovers through `reopenIfReplaced` (#925). On Windows a live holder can make the unlink
 * fail with EBUSY/EPERM, which is thrown for the caller to surface. Sidecars are best effort:
 * SQLite recreates them on the next open, so a leftover one is harmless.
 */
export function removeDatabaseFiles(dbPath: string): void {
  fs.rmSync(dbPath, { force: true });
  for (const suffix of SIDECAR_SUFFIXES) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {
      // held or locked: harmless
    }
  }
}
