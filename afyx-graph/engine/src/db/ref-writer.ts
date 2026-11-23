/**
 * Persisted writes for `unresolved_refs`.
 *
 * Lifecycle of a row: extraction inserts it `pending`; a completed resolution pass either
 * deletes it (resolved) or marks it `failed` — kept, with the last segment of its name in
 * `name_tail`, so a later sync can retry it when a changed file introduces a symbol that could
 * satisfy it (#1240). Rows follow their `from_node` by cascade, so re-extracting or deleting
 * a file clears its stale refs in any status.
 */

import type { UnresolvedReference } from '../types';
import { placeholders, SQLITE_PARAM_CHUNK_SIZE } from './sql-limits';
import type { WriteSession } from './write-session';

const INSERT_HEAD = 'INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language) VALUES ';
const ROW_TUPLE = '(?,?,?,?,?,?,?,?)';

/** The columns of a reference; a missing file path is '' and a missing language 'unknown'. */
function toRow(ref: UnresolvedReference): unknown[] {
  return [
    ref.fromNodeId,
    ref.referenceName,
    ref.referenceKind,
    ref.line,
    ref.column,
    ref.candidates ? JSON.stringify(ref.candidates) : null,
    ref.filePath ?? '',
    ref.language ?? 'unknown',
  ];
}

/**
 * The trailing segment of a (possibly dotted or qualified) reference name — the part a new
 * symbol's plain name could match: `util.greet` → `greet`, `mod::fn` → `fn`. Erlang refs
 * carry a written arity (`f/1`, #1610) that a plain function name lacks, so it is dropped first.
 */
export function referenceNameTail(referenceName: string): string {
  const stem = referenceName.replace(/\/\d{1,3}$/, '') || referenceName;
  const cut = Math.max(stem.lastIndexOf('.'), stem.lastIndexOf(':'));
  return cut >= 0 ? stem.slice(cut + 1) : stem;
}

/** Identity of a reference row as extraction wrote it. */
export interface RefKey {
  fromNodeId: string;
  referenceName: string;
  referenceKind: string;
}

export class RefWriter {
  constructor(private readonly session: WriteSession) {}

  insert(ref: UnresolvedReference): void {
    this.session.statement(`${INSERT_HEAD}${ROW_TUPLE}`).run(...toRow(ref));
  }

  insertBatch(refs: UnresolvedReference[]): void {
    if (refs.length === 0) return;
    this.session.transaction(() => {
      this.session.insertRows('insertUnresolvedRefs', INSERT_HEAD, ROW_TUPLE, refs.map(toRow));
    });
  }

  deleteByNode(nodeId: string): void {
    this.session.statement('DELETE FROM unresolved_refs WHERE from_node_id = ?').run(nodeId);
  }

  clear(): void {
    this.session.db.exec('DELETE FROM unresolved_refs');
  }

  /**
   * Delete every ref of the given nodes. Chunked under the parameter limit because this is
   * public API and a library caller may pass more ids than SQLITE_MAX_VARIABLE_NUMBER (32766)
   * allows (#540, #1001). Each chunk commits on its own.
   */
  deleteByNodes(fromNodeIds: string[]): void {
    for (let start = 0; start < fromNodeIds.length; start += SQLITE_PARAM_CHUNK_SIZE) {
      const chunk = fromNodeIds.slice(start, start + SQLITE_PARAM_CHUNK_SIZE);
      this.session.db.prepare(`DELETE FROM unresolved_refs WHERE from_node_id IN (${placeholders(chunk.length)})`).run(...chunk);
    }
  }

  /**
   * Delete exactly the refs that were resolved, matched by (node, name, kind). Returns the
   * rows removed — the batched resolution loop's non-progress guard keys on it (§7a.2).
   */
  deleteSpecific(refs: RefKey[]): number {
    if (refs.length === 0) return 0;
    const statement = this.session.db.prepare('DELETE FROM unresolved_refs WHERE from_node_id = ? AND reference_name = ? AND reference_kind = ?');
    let removed = 0;
    this.session.transaction(() => {
      for (const ref of refs) removed += statement.run(ref.fromNodeId, ref.referenceName, ref.referenceKind).changes;
    });
    return removed;
  }

  /**
   * Delete refs by row id — the precise cleanup for refs a resolution pass actually processed.
   * The key-tuple variant also removes SIBLING rows (the same caller calling the same callee at
   * other lines) that a later batch has not attempted yet, silently losing their edges when a
   * batch boundary splits a caller's call sites (#1269). One transaction for all chunks: a
   * commit per chunk is measurable on 100k+-ref persists.
   */
  deleteByRowIds(rowIds: number[]): number {
    if (rowIds.length === 0) return 0;
    let removed = 0;
    this.session.transaction(() => {
      for (let start = 0; start < rowIds.length; start += SQLITE_PARAM_CHUNK_SIZE) {
        const chunk = rowIds.slice(start, start + SQLITE_PARAM_CHUNK_SIZE);
        removed += this.session.listStatement(`DELETE FROM unresolved_refs WHERE id IN (${placeholders(chunk.length)})`, chunk.length).run(...chunk).changes;
      }
    });
    return removed;
  }

  /**
   * Park refs a completed pass could not resolve as `failed` instead of deleting them.
   * Failed rows are invisible to the pending count and batch readers, so drain loops and the
   * #1187 orphan sweep still terminate, yet stay queryable by `name_tail`. The tail is
   * rewritten here, so rows inserted before migration v8 get theirs the first time they are attempted.
   */
  markFailed(refs: RefKey[]): number {
    if (refs.length === 0) return 0;
    const statement = this.session.db.prepare(
      "UPDATE unresolved_refs SET status = 'failed', name_tail = ? WHERE from_node_id = ? AND reference_name = ? AND reference_kind = ?"
    );
    let changed = 0;
    this.session.transaction(() => {
      for (const ref of refs) changed += statement.run(referenceNameTail(ref.referenceName), ref.fromNodeId, ref.referenceName, ref.referenceKind).changes;
    });
    return changed;
  }

  /** `markFailed` by row id, for the same reason as `deleteByRowIds`: a sibling row must not inherit this row's failure (#1269). */
  markFailedByRowIds(refs: Array<{ rowId: number; referenceName: string }>): number {
    if (refs.length === 0) return 0;
    const statement = this.session.db.prepare("UPDATE unresolved_refs SET status = 'failed', name_tail = ? WHERE id = ?");
    let changed = 0;
    this.session.transaction(() => {
      for (const ref of refs) changed += statement.run(referenceNameTail(ref.referenceName), ref.rowId).changes;
    });
    return changed;
  }
}
