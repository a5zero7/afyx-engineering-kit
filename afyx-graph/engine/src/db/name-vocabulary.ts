/**
 * The name-segment vocabulary: the `name_segment_vocab` rows that turn prose words into
 * candidate symbol names for the prompt hook's graph-derived gate.
 *
 * Rows ride the same write path and transaction as the nodes they describe, so the
 * vocabulary can never run ahead of them. Deleting a node deliberately leaves its rows
 * behind — they are proposals, re-verified against `nodes` before use, and a full index
 * clears the table first. File nodes are excluded (a file's basename repeats the symbols
 * inside it and double-counts every concept, defeating the singleton-vs-cluster rarity
 * statistics), and so are import nodes (#1144), which are named after module specifiers and
 * can never surface as a definition.
 */

import { splitIdentifierSegments } from '../search/identifier-segments';
import type { WriteSession } from './write-session';

const INSERT_HEAD = 'INSERT OR IGNORE INTO name_segment_vocab (segment, name) VALUES ';
const INSERT_TUPLE = '(?,?)';

/** Names remembered per session; bounded so a pathological repository cannot grow it forever. */
const MAX_REMEMBERED_NAMES = 65536;

/** Whether a node of this kind contributes its name to the vocabulary. */
export function contributesToVocabulary(kind: string): boolean {
  return kind !== 'file' && kind !== 'import';
}

export class NameVocabulary {
  /**
   * Names whose segments were already written this session. Purely a fast path that skips
   * re-splitting the same name across files ("get", "render", …); the OR IGNORE insert is
   * the correctness backstop. Survives a connection swap on purpose.
   */
  private readonly remembered = new Set<string>();

  constructor(private readonly session: WriteSession) {}

  /** Append the `(segment, name)` rows this name still needs to `out`, and remember it. */
  collect(name: string, out: unknown[][]): void {
    if (this.remembered.has(name)) return;
    if (this.remembered.size >= MAX_REMEMBERED_NAMES) this.remembered.clear();
    this.remembered.add(name);
    for (const segment of splitIdentifierSegments(name)) out.push([segment, name]);
  }

  /** Write rows collected by `collect`. */
  flush(rows: unknown[][]): void {
    this.session.insertRows('insertNameSegments', INSERT_HEAD, INSERT_TUPLE, rows);
  }

  /** Write one name's segments. Idempotent. */
  add(name: string): void {
    const rows: unknown[][] = [];
    this.collect(name, rows);
    this.flush(rows);
  }

  /** Write the segments of many names in one transaction (the vocabulary heal path). */
  addAll(names: string[]): void {
    this.session.transaction(() => {
      const rows: unknown[][] = [];
      for (const name of names) this.collect(name, rows);
      this.flush(rows);
    });
  }

  /** Empty the table and forget which names were written; the node writes repopulate it. */
  clear(): void {
    this.session.db.exec('DELETE FROM name_segment_vocab');
    this.remembered.clear();
  }
}
