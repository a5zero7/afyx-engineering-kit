/**
 * The write side of the graph database.
 *
 * `GraphWriter` is what `QueryBuilder` delegates every persisted write to. It composes the
 * per-table writers over one `WriteSession` and adds the operations that span tables and must
 * be atomic: storing a whole file's extraction, replacing resolution edges with the refs they
 * came from, and clearing everything.
 */

import type { Edge, FileRecord, Node, UnresolvedReference } from '../types';
import { EdgeWriter } from './edge-writer';
import { FileWriter } from './file-writer';
import { NameVocabulary } from './name-vocabulary';
import { NodeWriter } from './node-writer';
import { RefWriter, type RefKey } from './ref-writer';
import type { SqliteDatabase } from './sqlite-adapter';
import { WriteSession, type RowCacheHooks } from './write-session';

/** Everything one file's extraction produced. */
export interface FileBundle {
  nodes: Node[];
  edges: Edge[];
  refs: UnresolvedReference[];
  file: FileRecord;
}

export class GraphWriter {
  private readonly session: WriteSession;
  readonly nodes: NodeWriter;
  readonly edges: EdgeWriter;
  readonly files: FileWriter;
  readonly refs: RefWriter;
  readonly vocabulary: NameVocabulary;

  constructor(db: SqliteDatabase, cache: RowCacheHooks) {
    this.session = new WriteSession(db, cache);
    this.vocabulary = new NameVocabulary(this.session);
    this.nodes = new NodeWriter(this.session, this.vocabulary);
    this.edges = new EdgeWriter(this.session);
    this.files = new FileWriter(this.session, this.nodes);
    this.refs = new RefWriter(this.session);
  }

  /** Follow the query layer onto a new connection: prepared statements reset, session state (the vocabulary memory) stays. */
  rebind(db: SqliteDatabase): void {
    this.session.rebind(db);
  }

  /**
   * Store one file's whole extraction — nodes, edges, refs and the file record — in a single
   * transaction, so the bulk index pays one commit per file rather than one per table. Callers
   * still store in file order and rows keep input order. The edges must already be limited to
   * the file's own nodes, which is why the existence lookup `EdgeWriter.insertMany` pays is skipped.
   */
  storeBundle(bundle: FileBundle): void {
    this.session.transaction(() => {
      this.nodes.insertMany(bundle.nodes);
      if (bundle.edges.length > 0) this.edges.insertTrusted(bundle.edges);
      if (bundle.refs.length > 0) this.refs.insertBatch(bundle.refs);
      this.files.upsert(bundle.file);
    });
  }

  /**
   * Swap resolution edges back for the unresolved refs they were resolved from, atomically:
   * if inserting the refs fails, the edge deletion rolls back with it. Returns the edges removed.
   */
  replaceResolutionEdges(edgeIds: number[], refs: UnresolvedReference[]): number {
    return this.session.transaction(() => {
      const removed = this.edges.deleteByIds(edgeIds);
      this.refs.insertBatch(refs);
      return removed;
    });
  }

  /** Set a project metadata value, stamping the write time. */
  setMetadata(key: string, value: string): void {
    this.session.db
      .prepare('INSERT INTO project_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, value, Date.now());
  }

  /** Empty every graph table in one transaction. The name vocabulary is not touched: a full index clears it separately. */
  clear(): void {
    this.session.cache.forgetAll();
    this.session.transaction(() => {
      for (const table of ['unresolved_refs', 'edges', 'nodes', 'files']) this.session.db.exec(`DELETE FROM ${table}`);
    });
  }
}

export type { RefKey };
