/**
 * Node identity and lookup reads. This module owns query selection and the bounded
 * identity cache; row decoding remains the shared responsibility of `row-mappers`.
 */

import type { Language, Node, NodeKind } from '../types';
import { chunked, placeholders, QuerySession } from './query-session';
import { rowToNode, type NodeRow } from './row-mappers';

const NODE_CACHE_CAPACITY = 1000;

const NODE_QUERY = Object.freeze({
  byId: 'SELECT * FROM nodes WHERE id = ?',
  byFile: 'SELECT * FROM nodes WHERE file_path = ? ORDER BY start_line',
  byKind: 'SELECT * FROM nodes WHERE kind = ?',
  all: 'SELECT * FROM nodes',
  byLanguageDecorator: "SELECT * FROM nodes WHERE language = ? AND decorators LIKE '%' || ? || '%'",
  fileLanguages: 'SELECT DISTINCT language FROM files',
  byName: 'SELECT * FROM nodes WHERE name = ? ORDER BY file_path, start_line',
  byNamePrefix: 'SELECT * FROM nodes WHERE name >= ? AND name < ? ORDER BY name LIMIT ?',
  byQualifiedName: 'SELECT * FROM nodes WHERE qualified_name = ?',
  byFoldedName: 'SELECT * FROM nodes WHERE lower(name) = lower(?)',
  allNames: 'SELECT DISTINCT name FROM nodes',
});

function nodesFrom(rows: readonly NodeRow[]): Node[] {
  return rows.map(rowToNode);
}

function nodesByIdsQuery(size: number): string {
  return `SELECT * FROM nodes WHERE id IN (${placeholders(size)})`;
}

function namesByFilesQuery(size: number): string {
  return `SELECT DISTINCT name FROM nodes WHERE file_path IN (${placeholders(size)})`;
}

function namePairsByFilesQuery(size: number): string {
  return `SELECT DISTINCT file_path, name FROM nodes WHERE file_path IN (${placeholders(size)})`;
}

/** A small LRU of decoded identities. Mutation hooks invalidate entries explicitly. */
class NodeIdentityCache {
  private readonly entries = new Map<string, Node>();

  read(id: string): Node | undefined {
    const node = this.entries.get(id);
    if (node === undefined) return undefined;
    this.entries.delete(id);
    this.entries.set(id, node);
    return node;
  }

  remember(node: Node): void {
    if (this.entries.size >= NODE_CACHE_CAPACITY) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(node.id, node);
  }

  drop(id: string): void {
    this.entries.delete(id);
  }

  dropFile(filePath: string): void {
    for (const [id, node] of this.entries) {
      if (node.filePath === filePath) this.entries.delete(id);
    }
  }

  reset(): void {
    this.entries.clear();
  }
}

export class NodeReader {
  private readonly identities = new NodeIdentityCache();

  constructor(private readonly session: QuerySession) {}

  private fixed(sql: string, params: readonly unknown[] = []): Node[] {
    return nodesFrom(this.session.statement(sql).all(...params) as NodeRow[]);
  }

  private *stream(sql: string, params: readonly unknown[] = []): IterableIterator<Node> {
    const statement = this.session.db.prepare(sql);
    for (const row of statement.iterate(...params)) yield rowToNode(row as NodeRow);
  }

  /** Called by writer hooks after one identity changes or disappears. */
  forgetNode(id: string): void {
    this.identities.drop(id);
  }

  /** Called by writer hooks after all rows for one file are replaced. */
  forgetByFile(filePath: string): void {
    this.identities.dropFile(filePath);
  }

  clearCache(): void {
    this.identities.reset();
  }

  getNodeById(id: string): Node | null {
    const cached = this.identities.read(id);
    if (cached !== undefined) return cached;

    const row = this.session.statement(NODE_QUERY.byId).get(id) as NodeRow | undefined;
    if (row === undefined) return null;
    const node = rowToNode(row);
    this.identities.remember(node);
    return node;
  }

  /** Missing IDs are absent from the returned map; consumers retain their own order. */
  getNodesByIds(ids: readonly string[]): Map<string, Node> {
    const result = new Map<string, Node>();
    const pending: string[] = [];

    for (const id of ids) {
      const cached = this.identities.read(id);
      if (cached === undefined) pending.push(id);
      else result.set(id, cached);
    }

    for (const idsChunk of chunked(pending)) {
      const sql = nodesByIdsQuery(idsChunk.length);
      const rows = this.session.listStatement(sql, idsChunk.length).all(...idsChunk) as NodeRow[];
      for (const node of nodesFrom(rows)) {
        result.set(node.id, node);
        this.identities.remember(node);
      }
    }
    return result;
  }

  /** Every node in a file, in source order. */
  getNodesByFile(filePath: string): Node[] {
    return this.fixed(NODE_QUERY.byFile, [filePath]);
  }

  getNodesByKind(kind: NodeKind): Node[] {
    return this.fixed(NODE_QUERY.byKind, [kind]);
  }

  /** Streaming scan keeps memory bounded for symbol-dense node kinds. */
  iterateNodesByKind(kind: NodeKind): IterableIterator<Node> {
    return this.stream(NODE_QUERY.byKind, [kind]);
  }

  getAllNodes(): Node[] {
    return this.fixed(NODE_QUERY.all);
  }

  /** SQL narrows candidates; consumers still exact-check the decoded decorator list. */
  iterateNodesByLanguageWithDecorator(language: Language, decorator: string): IterableIterator<Node> {
    return this.stream(NODE_QUERY.byLanguageDecorator, [language, `"${decorator}"`]);
  }

  getDistinctFileLanguages(): Set<string> {
    const rows = this.session.statement(NODE_QUERY.fileLanguages).all() as Array<{ language: string }>;
    return new Set(rows.map(({ language }) => language));
  }

  /** Stable source identity order is load-bearing for ambiguous resolution candidates. */
  getNodesByName(name: string): Node[] {
    return this.fixed(NODE_QUERY.byName, [name]);
  }

  /** Range bounds retain use of the name index under SQLite's default LIKE behavior. */
  getNodesByNamePrefix(prefix: string, limit = 20): Node[] {
    return this.fixed(NODE_QUERY.byNamePrefix, [prefix, `${prefix}￿`, limit]);
  }

  getNodesByQualifiedNameExact(qualifiedName: string): Node[] {
    return this.fixed(NODE_QUERY.byQualifiedName, [qualifiedName]);
  }

  /** SQLite performs both case folds so its collation semantics remain authoritative. */
  getNodesByLowerName(name: string): Node[] {
    return this.fixed(NODE_QUERY.byFoldedName, [name]);
  }

  getAllNodeNames(): string[] {
    const rows = this.session.statement(NODE_QUERY.allNames).all() as Array<{ name: string }>;
    return rows.map(({ name }) => name);
  }

  *iterateNodeNames(): IterableIterator<string> {
    for (const row of this.session.db.prepare(NODE_QUERY.allNames).iterate()) {
      yield (row as { name: string }).name;
    }
  }

  getNodeNamesByFiles(filePaths: string[]): string[] {
    const names = new Set<string>();
    for (const pathsChunk of chunked(filePaths)) {
      const sql = namesByFilesQuery(pathsChunk.length);
      const rows = this.session.listStatement(sql, pathsChunk.length).all(...pathsChunk) as Array<{ name: string }>;
      for (const { name } of rows) names.add(name);
    }
    return [...names];
  }

  /** File-qualified names make a moved definition one removal plus one addition. */
  getNodeNamePairsByFiles(filePaths: string[]): Set<string> {
    const pairs = new Set<string>();
    for (const pathsChunk of chunked(filePaths)) {
      const sql = namePairsByFilesQuery(pathsChunk.length);
      const rows = this.session.listStatement(sql, pathsChunk.length).all(...pathsChunk) as Array<{ file_path: string; name: string }>;
      for (const row of rows) pairs.add(`${row.file_path}\0${row.name}`);
    }
    return pairs;
  }
}
