import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import type { FileRecord, Node } from '../src/types';

const file = (filePath: string, overrides: Partial<FileRecord> = {}): FileRecord => ({
  path: filePath,
  contentHash: `hash:${filePath}`,
  language: 'typescript',
  size: 100,
  modifiedAt: 10,
  indexedAt: 100,
  nodeCount: 1,
  indexingLevel: 'structural',
  ...overrides,
});

const fileNode = (id: string, filePath: string): Node => ({
  id,
  kind: 'file',
  name: path.basename(filePath),
  qualifiedName: filePath,
  filePath,
  language: 'typescript',
  startLine: 1,
  endLine: 1,
  startColumn: 0,
  endColumn: 1,
  updatedAt: 1,
});

describe('persisted file catalog and index-state reader contract', () => {
  let directory: string;
  let dbPath: string;
  let connection: DatabaseConnection;
  let query: QueryBuilder;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-file-reader-'));
    dbPath = path.join(directory, 'graph.db');
    connection = DatabaseConnection.initialize(dbPath);
    query = new QueryBuilder(connection.getDb());
  });

  afterEach(() => {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('returns stable empty and missing shapes for a new index', () => {
    expect(query.getFileByPath('missing.ts')).toBeNull();
    expect(query.getAllFiles()).toEqual([]);
    expect(query.getAllFilePaths()).toEqual([]);
    expect(query.getLastIndexedAt()).toBeNull();
    expect(query.getIndexRevision()).toEqual({ lastIndexedAt: null, fileCount: 0 });
    expect(query.getFilesIndexedSince(0, 10)).toEqual({ paths: [], total: 0 });
    expect(query.countGeneratedFiles()).toBe(0);
  });

  it('preserves exact path identity, complete row mapping, and path order', () => {
    query.upsertFile(file('z-last.ts', { indexedAt: 200 }));
    query.upsertFile(file('SRC/Case.ts', {
      contentHash: 'case-hash',
      language: 'javascript',
      size: 42,
      modifiedAt: 15,
      indexedAt: 300,
      nodeCount: 7,
        indexingLevel: 'structural',
      generated: true,
      errors: [{ message: 'parse warning', filePath: 'SRC/Case.ts', severity: 'warning', code: 'parse_error' }],
    }));
    query.upsertFile(file('a-first.ts', { indexedAt: 100 }));

    expect(query.getFileByPath('src/case.ts')).toBeNull();
    expect(query.getFileByPath('SRC/Case.ts')).toEqual(file('SRC/Case.ts', {
      contentHash: 'case-hash',
      language: 'javascript',
      size: 42,
      modifiedAt: 15,
      indexedAt: 300,
      nodeCount: 7,
      generated: true,
      errors: [{ message: 'parse warning', filePath: 'SRC/Case.ts', severity: 'warning', code: 'parse_error' }],
    }));
    expect(query.getAllFilePaths()).toEqual(['SRC/Case.ts', 'a-first.ts', 'z-last.ts']);
    expect(query.getAllFiles().map((record) => record.path)).toEqual(['SRC/Case.ts', 'a-first.ts', 'z-last.ts']);
  });

    it('round-trips catalog indexing depth', () => {
      query.upsertFile(file('README.md', {
        language: 'markdown',
        nodeCount: 0,
        indexingLevel: 'metadata',
      }));

      expect(query.getFileByPath('README.md')?.indexingLevel).toBe('metadata');
      expect(query.getAllFiles().map((record) => [record.path, record.indexingLevel])).toEqual([
        ['README.md', 'metadata'],
      ]);
    });

  it('owns index revision, capped newest-first change lists, and hash staleness', () => {
    query.upsertFile(file('a.ts', { contentHash: 'same', indexedAt: 100 }));
    query.upsertFile(file('c.ts', { contentHash: 'old', indexedAt: 300 }));
    query.upsertFile(file('b.ts', { contentHash: 'old', indexedAt: 300 }));

    expect(query.getLastIndexedAt()).toBe(300);
    expect(query.getIndexRevision()).toEqual({ lastIndexedAt: 300, fileCount: 3 });
    expect(query.getFilesIndexedSince(99, 2)).toEqual({ paths: ['b.ts', 'c.ts'], total: 3 });
    expect(query.getFilesIndexedSince(300, 2)).toEqual({ paths: [], total: 0 });
    expect(query.getFilesIndexedSince(0, -1)).toEqual({ paths: [], total: 3 });
    expect(query.getStaleFiles(new Map([['a.ts', 'same'], ['b.ts', 'new'], ['not-indexed.ts', 'x']])).map((record) => record.path)).toEqual(['b.ts']);
  });

  it('keeps generated-state probes bounded and duplicate-safe', () => {
    query.upsertFile(file('generated.ts', { generated: true }));
    query.upsertFile(file('ordinary.ts', { generated: false }));

    expect([...query.getGeneratedPathsAmong(['generated.ts', 'generated.ts', 'ordinary.ts', 'missing.ts'])]).toEqual(['generated.ts']);
    expect(query.countGeneratedFiles()).toBe(1);
    const predicate = query.generatedPredicateFor(['generated.ts', 'ordinary.ts']);
    expect([predicate('generated.ts'), predicate('ordinary.ts'), predicate('unindexed.pb.go')]).toEqual([true, false, true]);
  });

  it('returns only file nodes related to requested persisted paths', () => {
    query.insertNodes([
      fileNode('file:a', 'a.ts'),
      fileNode('file:b', 'b.ts'),
      { ...fileNode('function:a', 'a.ts'), kind: 'function', name: 'run' },
    ]);
    expect(query.getFileNodes(['a.ts', 'missing.ts', 'a.ts']).map((node) => node.id)).toEqual(['file:a']);
    expect(query.getFileNodes([])).toEqual([]);
  });

  it('preserves file and index-state reads after reopening the database', () => {
    query.upsertFile(file('reopen.ts', { indexedAt: 777 }));
    connection.close();
    connection = DatabaseConnection.open(dbPath);
    query = new QueryBuilder(connection.getDb());

    expect(query.getFileByPath('reopen.ts')?.contentHash).toBe('hash:reopen.ts');
    expect(query.getIndexRevision()).toEqual({ lastIndexedAt: 777, fileCount: 1 });
  });
});
