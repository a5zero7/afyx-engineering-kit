import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import type { Edge, FileRecord, Node } from '../src/types';

function node(id: string, kind: Node['kind'], language: Node['language'], filePath: string): Node {
  return {
    id,
    kind,
    language,
    filePath,
    name: id,
    qualifiedName: `${filePath}::${id}`,
    startLine: 1,
    endLine: 2,
    startColumn: 0,
    endColumn: 8,
    updatedAt: 100,
  };
}

function file(pathname: string, language: FileRecord['language'], nodeCount: number): FileRecord {
  return {
    path: pathname,
    contentHash: `hash-${pathname}`,
    language,
    size: 100,
    modifiedAt: 90,
    indexedAt: 110,
    nodeCount,
  };
}

describe('persisted statistics and project metadata contract', () => {
  let directory: string;
  let databasePath: string;
  let connection: DatabaseConnection;
  let queries: QueryBuilder;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-stats-metadata-'));
    databasePath = path.join(directory, 'stats.db');
    connection = DatabaseConnection.initialize(databasePath);
    queries = new QueryBuilder(connection.getDb());
  });

  afterAll(() => {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('maps an empty database and absent metadata to explicit empty values', () => {
    expect(queries.getNodeAndEdgeCount()).toEqual({ nodes: 0, edges: 0 });
    const stats = queries.getStats();
    expect(stats).toMatchObject({
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
      nodesByKind: {},
      edgesByKind: {},
      filesByLanguage: {},
      dbSizeBytes: 0,
      walSizeBytes: 0,
    });
    expect(stats.lastUpdated).toBeGreaterThan(0);
    expect(queries.getMetadata('missing')).toBeNull();
    expect(queries.getAllMetadata()).toEqual({});
  });

  it('preserves totals and deterministic grouped distributions', () => {
    const nodes = [
      node('fn-a', 'function', 'typescript', 'src/a.ts'),
      node('fn-b', 'function', 'typescript', 'src/b.ts'),
      node('class-c', 'class', 'python', 'src/c.py'),
    ];
    const edges: Edge[] = [
      { source: 'fn-a', target: 'fn-b', kind: 'calls' },
      { source: 'fn-b', target: 'class-c', kind: 'calls' },
      { source: 'fn-a', target: 'class-c', kind: 'references' },
    ];
    queries.insertNodes(nodes);
    queries.insertEdges(edges);
    queries.upsertFile(file('src/a.ts', 'typescript', 1));
    queries.upsertFile(file('src/b.ts', 'typescript', 1));
    queries.upsertFile(file('src/c.py', 'python', 1));

    expect(queries.getNodeAndEdgeCount()).toEqual({ nodes: 3, edges: 3 });
    expect(queries.getStats()).toMatchObject({
      nodeCount: 3,
      edgeCount: 3,
      fileCount: 3,
      nodesByKind: { class: 1, function: 2 },
      edgesByKind: { calls: 2, references: 1 },
      filesByLanguage: { python: 1, typescript: 2 },
    });
  });

  it('preserves metadata values, insertion order, updates, and missing-key semantics', () => {
    queries.setMetadata('zeta', 'first');
    queries.setMetadata('alpha', 'second');
    queries.setMetadata('zeta', 'updated');

    expect(queries.getMetadata('zeta')).toBe('updated');
    expect(queries.getMetadata('alpha')).toBe('second');
    expect(queries.getMetadata('missing')).toBeNull();
    const metadata = queries.getAllMetadata();
    expect(metadata).toEqual({ zeta: 'updated', alpha: 'second' });
    expect(Object.keys(metadata)).toEqual(['zeta', 'alpha']);
  });

  it('returns the same logical values after reopening the database', () => {
    const before = {
      counts: queries.getNodeAndEdgeCount(),
      stats: queries.getStats(),
      metadata: queries.getAllMetadata(),
    };
    connection.close();
    connection = DatabaseConnection.open(databasePath);
    queries = new QueryBuilder(connection.getDb());
    const after = {
      counts: queries.getNodeAndEdgeCount(),
      stats: queries.getStats(),
      metadata: queries.getAllMetadata(),
    };

    expect(after.counts).toEqual(before.counts);
    expect({ ...after.stats, lastUpdated: 0 }).toEqual({ ...before.stats, lastUpdated: 0 });
    expect(after.metadata).toEqual(before.metadata);
    expect(Object.keys(after.metadata)).toEqual(Object.keys(before.metadata));
  });
});
