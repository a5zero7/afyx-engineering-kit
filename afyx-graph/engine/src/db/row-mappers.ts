/**
 * Row decoding: SQLite's snake_case columns into the domain shapes the rest of the
 * engine uses. Every reader shares these so a column's meaning is decided in one place.
 */

import type { Edge, EdgeKind, FileIndexingLevel, FileRecord, Language, Node, NodeKind, UnresolvedReference } from '../types';
import { safeJsonParse } from '../utils';

export interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  return_type: string | null;
  updated_at: number;
}

export interface EdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
}

export interface FileRow {
  path: string;
  content_hash: string;
  language: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  node_count: number;
  /** Absent only on a stale pre-v10 prepared statement. */
  indexing_level?: string | null;
  errors: string | null;
  /** Absent on pre-v9 rows read through a stale prepared statement. */
  generated?: number | null;
}

export interface UnresolvedRefRow {
  id: number;
  from_node_id: string;
  reference_name: string;
  reference_kind: string;
  line: number;
  col: number;
  candidates: string | null;
  file_path: string;
  language: string;
  status: string;
  name_tail: string;
}

const present = <T>(value: T | null): T | undefined => value ?? undefined;
const enabled = (value: number): boolean => value === 1;

function decodedJson<T>(value: string | null): T | undefined {
  return value === null ? undefined : safeJsonParse(value, undefined);
}

export function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    kind: row.kind as NodeKind,
    name: row.name,
    qualifiedName: row.qualified_name,
    filePath: row.file_path,
    language: row.language as Language,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    docstring: present(row.docstring),
    signature: present(row.signature),
    visibility: row.visibility as Node['visibility'],
    isExported: enabled(row.is_exported),
    isAsync: enabled(row.is_async),
    isStatic: enabled(row.is_static),
    isAbstract: enabled(row.is_abstract),
    decorators: decodedJson(row.decorators),
    typeParameters: decodedJson(row.type_parameters),
    returnType: present(row.return_type),
    updatedAt: row.updated_at,
  };
}

export function rowToEdge(row: EdgeRow): Edge {
  return {
    source: row.source,
    target: row.target,
    kind: row.kind as EdgeKind,
    metadata: decodedJson(row.metadata),
    line: present(row.line),
    column: present(row.col),
    provenance: row.provenance as Edge['provenance'],
  };
}

export function rowToFileRecord(row: FileRow): FileRecord {
  const indexingLevel = row.indexing_level === 'metadata' || row.indexing_level === 'content'
    ? row.indexing_level
    : 'structural';
  return {
    path: row.path,
    contentHash: row.content_hash,
    language: row.language as Language,
    size: row.size,
    modifiedAt: row.modified_at,
    indexedAt: row.indexed_at,
    nodeCount: row.node_count,
    indexingLevel: indexingLevel as FileIndexingLevel,
    errors: decodedJson(row.errors),
    generated: enabled(row.generated ?? 0),
  };
}

export function rowToUnresolvedRef(row: UnresolvedRefRow): UnresolvedReference {
  return {
    fromNodeId: row.from_node_id,
    referenceName: row.reference_name,
    referenceKind: row.reference_kind as EdgeKind,
    line: row.line,
    column: row.col,
    candidates: decodedJson(row.candidates),
    filePath: row.file_path,
    language: row.language as Language,
    rowId: row.id,
  };
}
