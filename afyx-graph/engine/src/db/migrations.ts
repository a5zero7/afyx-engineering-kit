/**
 * Schema versioning and migrations.
 *
 * Version 1 is `schema.sql`. A brand-new database is created from the current script and
 * stamped with `CURRENT_SCHEMA_VERSION`; an older file is brought forward by applying
 * every later migration, each in its own transaction together with the row that records it.
 *
 * A migration's `description` is stored in `schema_versions`, so the wording below is part
 * of the persisted format, as is the SQL: it must keep producing the schema `schema.sql`
 * produces.
 */

import { SqliteDatabase } from './sqlite-adapter';

/** The schema version this build writes and expects. */
export const CURRENT_SCHEMA_VERSION = 10;

/** One schema step from `version - 1` to `version`. */
interface Migration {
  version: number;
  description: string;
  up: (db: SqliteDatabase) => void;
}

function sqlMigration(version: number, description: string, sql: string): Migration {
  return { version, description, up: (db) => db.exec(sql) };
}

/** Column names of a table, for migrations that must be safe to re-run. */
function columnsOf(db: SqliteDatabase, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

const MIGRATIONS: Migration[] = [
  sqlMigration(
    2,
    'Add project metadata, provenance tracking, and unresolved ref context',
    `
        CREATE TABLE IF NOT EXISTS project_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        ALTER TABLE unresolved_refs ADD COLUMN file_path TEXT NOT NULL DEFAULT '';
        ALTER TABLE unresolved_refs ADD COLUMN language TEXT NOT NULL DEFAULT 'unknown';
        ALTER TABLE edges ADD COLUMN provenance TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path);
        CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);
      `
  ),
  sqlMigration(3, 'Add lower(name) expression index for memory-efficient case-insensitive lookups',
    'CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));'),
  sqlMigration(4, 'Drop redundant idx_edges_source / idx_edges_target (covered by source_kind / target_kind composites)',
    'DROP INDEX IF EXISTS idx_edges_source; DROP INDEX IF EXISTS idx_edges_target;'),
  sqlMigration(5, 'Add nodes.return_type — normalized return/result type for receiver-type inference (C++ singletons/factories, #645)',
    'ALTER TABLE nodes ADD COLUMN return_type TEXT;'),
  sqlMigration(
    6,
    'Dedup duplicate edge rows and add a UNIQUE identity index so INSERT OR IGNORE actually dedups (#1034)',
    `
        DELETE FROM edges
        WHERE id NOT IN (
          SELECT MIN(id) FROM edges
          GROUP BY source, target, kind, IFNULL(line, -1), IFNULL(col, -1)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_identity
          ON edges(source, target, kind, IFNULL(line, -1), IFNULL(col, -1));
      `
  ),
  sqlMigration(
    7,
    'Add name_segment_vocab — prose-word → symbol-name lookup for the prompt hook’s graph-derived gate',
    `
        CREATE TABLE IF NOT EXISTS name_segment_vocab (
          segment TEXT NOT NULL,
          name TEXT NOT NULL,
          PRIMARY KEY (segment, name)
        ) WITHOUT ROWID;
      `
  ),
  {
    version: 8,
    description: 'Track attempted-but-unresolvable refs as status=failed so sync can retry them when a changed file adds a matching symbol (#1240)',
    up: (db) => {
      // DDL only, no backfill: rows are queried by name_tail only once they carry
      // status='failed', and both columns are written together when a ref is marked failed.
      // Legacy rows stay 'pending'; the #1187 sweep grinds them down on the next sync. The tail
      // index is partial because on a healthy index only the failed set is worth indexing.
      // ALTER TABLE has no IF NOT EXISTS, so each column is guarded: a database built from the
      // current schema.sql already has both. Keep in lockstep with schema.sql.
      const existing = columnsOf(db, 'unresolved_refs');
      if (!existing.has('status')) db.exec("ALTER TABLE unresolved_refs ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
      if (!existing.has('name_tail')) db.exec("ALTER TABLE unresolved_refs ADD COLUMN name_tail TEXT NOT NULL DEFAULT ''");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_unresolved_status ON unresolved_refs(status);
        CREATE INDEX IF NOT EXISTS idx_unresolved_failed_tail ON unresolved_refs(name_tail) WHERE status = 'failed';
      `);
    },
  },
  {
    version: 9,
    description: 'Add files.generated — index-time content-header generated-file detection for ranking (#1500)',
    up: (db) => {
      // DDL only and NO backfill: the flag comes from file CONTENT, which the files table
      // (a hash, not the bytes) cannot supply. Migrated rows stay 0 until a full index
      // re-extracts them, and every reader unions the flag with the path-only check, so an
      // un-backfilled database keeps its old behavior; `sync` heals it file by file. Guarded
      // like v8 because a database built from the current schema.sql already has the column.
      if (!columnsOf(db, 'files').has('generated')) {
        db.exec('ALTER TABLE files ADD COLUMN generated INTEGER NOT NULL DEFAULT 0');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_files_generated ON files(path) WHERE generated = 1');
    },
  },
  {
    version: 10,
    description: 'Add files.indexing_level for metadata/content/structural catalog depth',
    up: (db) => {
      if (!columnsOf(db, 'files').has('indexing_level')) {
        // v9 could leave successful-looking zero-node rows that were only
        // incomplete extraction markers (#1541). Remove those once before the
        // explicit v10 catalog contract makes zero-node structural files valid.
        db.exec("DELETE FROM files WHERE node_count = 0 AND language NOT IN ('yaml', 'twig', 'properties') AND (errors IS NULL OR errors = '[]')");
        db.exec("ALTER TABLE files ADD COLUMN indexing_level TEXT NOT NULL DEFAULT 'structural' CHECK (indexing_level IN ('metadata', 'content', 'structural'))");
      }
      db.exec("UPDATE files SET indexing_level = 'metadata' WHERE language IN ('yaml', 'twig', 'properties') AND node_count = 0");
    },
  },
];

/** The highest applied schema version, or 0 when the version table is missing or empty. */
export function getCurrentVersion(db: SqliteDatabase): number {
  try {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_versions').get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0; // the table does not exist yet
  }
}

/** Migrations newer than `version`, oldest first. */
function migrationsAfter(version: number): Migration[] {
  return MIGRATIONS.filter((migration) => migration.version > version).sort((a, b) => a.version - b.version);
}

/** Apply every migration newer than `fromVersion`, each in its own transaction with its history row. */
export function runMigrations(db: SqliteDatabase, fromVersion: number): void {
  for (const migration of migrationsAfter(fromVersion)) {
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)')
        .run(migration.version, Date.now(), migration.description);
    })();
  }
}

/** Whether the database is behind `CURRENT_SCHEMA_VERSION`. */
export function needsMigration(db: SqliteDatabase): boolean {
  return getCurrentVersion(db) < CURRENT_SCHEMA_VERSION;
}

/** The migrations `runMigrations` would apply to this database, oldest first. */
export function getPendingMigrations(db: SqliteDatabase): Migration[] {
  return migrationsAfter(getCurrentVersion(db));
}

/** Applied migrations as recorded in the database, oldest first. */
export function getMigrationHistory(
  db: SqliteDatabase
): Array<{ version: number; appliedAt: number; description: string | null }> {
  const rows = db
    .prepare('SELECT version, applied_at, description FROM schema_versions ORDER BY version')
    .all() as Array<{ version: number; applied_at: number; description: string | null }>;
  return rows.map((row) => ({ version: row.version, appliedAt: row.applied_at, description: row.description }));
}
