/**
 * Bulk-load windows.
 *
 * A full index writes every row once and reads none until resolution, so maintaining
 * secondary indexes and the FTS triggers row by row is pure overhead. A window drops
 * them for the duration of a mass write and rebuilds them once at the end (measured:
 * 2.8 s → 1.1 s inserting a 224k-edge resolution set, ~0.3 s to recreate).
 *
 * Every window must be closed by its matching `end*` (callers use try/finally). A crash
 * inside one is repaired by the next open: `healTriggers` / `healIndexes` recreate
 * whatever is missing, straight from the schema script. Primary keys and UNIQUE
 * constraints are never dropped — upserts and OR-IGNORE dedup conflict on them.
 */

import type { SqliteDatabase } from './sqlite-adapter';
import { ftsTriggerDdl, indexDdl, type IndexPurpose } from './schema-script';

/** Triggers that keep `nodes_fts` in step with `nodes`. */
const FTS_TRIGGERS = ['nodes_ai', 'nodes_ad', 'nodes_au'] as const;

/**
 * Non-unique indexes maintained per row during parsing: the store phase is dominated
 * by B-tree maintenance, not statement overhead, so a fresh index drops them all and
 * rebuilds each in one scan afterwards. Fresh-init only — an incremental index deletes
 * per-file rows mid-phase and needs the file_path indexes.
 */
const PARSE_INDEXES = [
  'idx_nodes_kind', 'idx_nodes_name', 'idx_nodes_qualified_name', 'idx_nodes_file_path', 'idx_nodes_language', 'idx_nodes_file_line',
  'idx_nodes_lower_name', 'idx_unresolved_from_node', 'idx_unresolved_name', 'idx_unresolved_file_path', 'idx_unresolved_from_name',
  'idx_unresolved_status', 'idx_unresolved_failed_tail', 'idx_files_language', 'idx_files_modified_at',
] as const;

/**
 * unresolved_refs indexes the batched resolution loop never reads: it pages pending
 * refs by keyset (status index + primary key), deletes by id and parks failures with an
 * UPDATE, and each per-batch DELETE would maintain all of these. They are rebuilt at the
 * end, when only the surviving failed refs remain and recreation is nearly free.
 */
const REF_INDEXES = [
  'idx_unresolved_from_node', 'idx_unresolved_name', 'idx_unresolved_file_path', 'idx_unresolved_from_name', 'idx_unresolved_failed_tail',
] as const;

/**
 * The non-unique edge indexes. `idx_edges_identity` stays: INSERT OR IGNORE dedups on it
 * (#1034) and its leftmost column is `source`, so source-keyed reads made mid-window
 * still use an index. Target- and kind-keyed reads only happen after the window closes.
 */
const EDGE_INDEXES = ['idx_edges_kind', 'idx_edges_source_kind', 'idx_edges_target_kind', 'idx_edges_provenance'] as const;

/** Let the event loop turn between statements. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class BulkWindows {
  constructor(
    private readonly db: SqliteDatabase,
    /** Without FTS5 there are no triggers to manage. */
    private readonly ftsAvailable: boolean
  ) {}

  private dropIndexes(names: readonly string[]): void {
    for (const name of names) this.db.exec(`DROP INDEX IF EXISTS ${name}`);
  }

  /**
   * Recreate indexes one statement at a time with a yield between them. Each build is a
   * synchronous scan of a whole table (~20 s per edge index at Linux-kernel scale), and
   * running them back to back would stall the loop past the liveness watchdog's 60 s
   * window and get a finished index killed (#850).
   */
  private async rebuildIndexes(names: readonly string[], purpose: IndexPurpose): Promise<void> {
    for (const name of names) {
      this.db.exec(indexDdl(name, purpose));
      await yieldToLoop();
    }
  }

  /** Drop the per-row FTS triggers so mass node inserts skip tokenizing each row. */
  beginNodeLoad(): void {
    if (!this.ftsAvailable) return;
    for (const trigger of FTS_TRIGGERS) this.db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  }

  /**
   * Rebuild `nodes_fts` from `nodes` in one pass and restore the triggers. The window is
   * database-wide (triggers are schema objects), which is safe because the rebuild
   * captures any row anyone wrote while it was open.
   */
  endNodeLoad(): void {
    if (!this.ftsAvailable) return;
    this.db.exec(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`);
    this.restoreTriggers();
  }

  beginParseLoad(): void {
    this.dropIndexes(PARSE_INDEXES);
    this.beginEdgeLoad();
  }

  /** Also rebuilds the edge indexes, so paths that skip the resolution window still end with a complete schema. */
  async endParseLoad(): Promise<void> {
    await this.rebuildIndexes(PARSE_INDEXES, 'parse');
    await this.endEdgeLoad();
  }

  beginRefLoad(): void {
    this.dropIndexes(REF_INDEXES);
  }

  async endRefLoad(): Promise<void> {
    await this.rebuildIndexes(REF_INDEXES, 'ref');
  }

  beginEdgeLoad(): void {
    this.dropIndexes(EDGE_INDEXES);
  }

  async endEdgeLoad(): Promise<void> {
    await this.rebuildIndexes(EDGE_INDEXES, 'edge');
  }

  /** Repair a node-load window that never closed: missing triggers mean a stale FTS index. */
  healTriggers(): void {
    if (!this.ftsAvailable) return;
    const present = this.db
      .prepare(`SELECT count(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name IN ('nodes_ai','nodes_ad','nodes_au')`)
      .get() as { c: number } | undefined;
    if ((present?.c ?? 0) >= FTS_TRIGGERS.length) return;
    this.endNodeLoad();
  }

  /** Recreate every secondary index a killed parse, ref or edge window may have left dropped. */
  healIndexes(): void {
    const names = [...new Set<string>([...PARSE_INDEXES, ...REF_INDEXES, ...EDGE_INDEXES])];
    const present = this.db
      .prepare(`SELECT count(*) AS c FROM sqlite_master WHERE type = 'index' AND name IN (${names.map(() => '?').join(',')})`)
      .get(...names) as { c: number } | undefined;
    if ((present?.c ?? 0) >= names.length) return;
    for (const name of names) this.db.exec(indexDdl(name, 'recovery'));
  }

  private restoreTriggers(): void {
    for (const ddl of ftsTriggerDdl(FTS_TRIGGERS.length)) this.db.exec(ddl);
  }
}
