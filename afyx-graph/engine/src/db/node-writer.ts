/**
 * Persisted writes for `nodes`.
 *
 * Every write path lands here — single insert, bulk insert, update, delete by id or by
 * file — and shares one column mapping, so a node is serialized the same way however it
 * arrives: booleans as 0/1, JSON lists as text, absent optional fields as NULL and absent
 * position fields as 0.
 */

import type { Node } from '../types';
import { contributesToVocabulary, NameVocabulary } from './name-vocabulary';
import type { WriteSession } from './write-session';

const COLUMNS = [
  'id', 'kind', 'name', 'qualified_name', 'file_path', 'language', 'start_line', 'end_line', 'start_column', 'end_column',
  'docstring', 'signature', 'visibility', 'is_exported', 'is_async', 'is_static', 'is_abstract', 'decorators', 'type_parameters',
  'return_type', 'updated_at',
] as const;

const INSERT_HEAD = `INSERT OR REPLACE INTO nodes (${COLUMNS.join(', ')}) VALUES `;
const ROW_TUPLE = `(${COLUMNS.map(() => '?').join(',')})`;
const UPDATE_SQL = `UPDATE nodes SET ${COLUMNS.slice(1).map((column) => `${column} = ?`).join(', ')} WHERE id = ?`;

/** The fields without which a node cannot be stored; a node missing one is logged and skipped. */
function isStorable(node: Node): boolean {
  return Boolean(node.id && node.kind && node.name && node.filePath && node.language);
}

/** A node as its 21 column values, in `COLUMNS` order. */
function toRow(node: Node): unknown[] {
  return [
    node.id,
    node.kind,
    node.name,
    node.qualifiedName ?? node.name,
    node.filePath,
    node.language,
    node.startLine ?? 0,
    node.endLine ?? 0,
    node.startColumn ?? 0,
    node.endColumn ?? 0,
    node.docstring ?? null,
    node.signature ?? null,
    node.visibility ?? null,
    node.isExported ? 1 : 0,
    node.isAsync ? 1 : 0,
    node.isStatic ? 1 : 0,
    node.isAbstract ? 1 : 0,
    node.decorators ? JSON.stringify(node.decorators) : null,
    node.typeParameters ? JSON.stringify(node.typeParameters) : null,
    node.returnType ?? null,
    node.updatedAt ?? Date.now(),
  ];
}

/** What gets logged for a skipped node: just the fields that decided it. */
const identityOf = (node: Node) => ({ id: node.id, kind: node.kind, name: node.name, filePath: node.filePath, language: node.language });

export class NodeWriter {
  constructor(
    private readonly session: WriteSession,
    private readonly vocabulary: NameVocabulary
  ) {}

  /** Insert a node, replacing any row with the same id. A node missing a required field is logged and skipped. */
  insert(node: Node): void {
    if (!isStorable(node)) {
      console.error('[Afyx Graph] Skipping node with missing required fields:', identityOf(node));
      return;
    }
    // INSERT OR REPLACE may overwrite a node the read cache holds; drop it so the next read sees the new row.
    this.session.cache.forgetNode(node.id);
    this.session.statement(`${INSERT_HEAD}${ROW_TUPLE}`).run(...toRow(node));
    if (contributesToVocabulary(node.kind)) this.vocabulary.add(node.name);
  }

  /**
   * Insert many nodes in one transaction with the same per-row semantics as `insert`
   * (validation, cache invalidation, vocabulary), bound as multi-row statements.
   */
  insertMany(nodes: Node[]): void {
    this.session.transaction(() => {
      const rows: unknown[][] = [];
      const vocabularyRows: unknown[][] = [];
      for (const node of nodes) {
        if (!isStorable(node)) {
          console.error('[Afyx Graph] Skipping node with missing required fields:', identityOf(node));
          continue;
        }
        this.session.cache.forgetNode(node.id);
        rows.push(toRow(node));
        if (contributesToVocabulary(node.kind)) this.vocabulary.collect(node.name, vocabularyRows);
      }
      this.session.insertRows('insertNodes', INSERT_HEAD, ROW_TUPLE, rows);
      this.vocabulary.flush(vocabularyRows);
    });
  }

  /**
   * Overwrite every column of an existing node. Post-extract passes rename nodes through here
   * (NestJS route prefixing), and a renamed node's new name must reach the vocabulary like an
   * inserted one's (#1141) — the vocabulary insert is idempotent, so no name-changed check.
   */
  update(node: Node): void {
    this.session.cache.forgetNode(node.id);
    if (!isStorable(node)) {
      console.error('[Afyx Graph] Skipping node update with missing required fields:', node.id);
      return;
    }
    const [id, ...rest] = toRow(node);
    this.session.statement(UPDATE_SQL).run(...rest, id);
    if (contributesToVocabulary(node.kind)) this.vocabulary.add(node.name);
  }

  delete(id: string): void {
    this.session.cache.forgetNode(id);
    this.session.statement('DELETE FROM nodes WHERE id = ?').run(id);
  }

  deleteByFile(filePath: string): void {
    this.session.cache.forgetFile(filePath);
    this.session.statement('DELETE FROM nodes WHERE file_path = ?').run(filePath);
  }
}
