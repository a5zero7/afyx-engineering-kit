import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import type { Node } from '../src/types';

function node(id: string, name: string, kind: Node['kind'], language: Node['language'], filePath: string): Node {
  return {
    id,
    name,
    kind,
    language,
    filePath,
    qualifiedName: `${filePath}::${name}`,
    startLine: 3,
    endLine: 7,
    startColumn: 1,
    endColumn: 9,
    signature: `${name}()`,
    docstring: `documentation for ${name}`,
    updatedAt: 1234,
  };
}

const CORPUS: Node[] = [
  node('exact-a', 'HandleRequest', 'function', 'typescript', 'src/server/router.ts'),
  node('exact-b', 'handleRequest', 'method', 'typescript', 'src/server/legacy.ts'),
  node('mid-name', 'signInWithGoogle', 'function', 'typescript', 'src/auth/google.ts'),
  node('short-mid', 'goWith', 'function', 'typescript', 'src/auth/short.ts'),
  node('prefix-name', 'signInDirect', 'method', 'python', 'src/auth/direct.py'),
  node('fuzzy-name', 'getUser', 'function', 'typescript', 'src/users/get-user.ts'),
  node('other-language', 'loadData', 'function', 'python', 'src/data/load.py'),
  node('other-kind', 'loadData', 'class', 'typescript', 'src/data/load.ts'),
  node('substring-prefix', 'RequestFactory', 'class', 'typescript', 'src/http/factory.ts'),
];

function ids(results: ReturnType<QueryBuilder['searchNodes']>): string[] {
  return results.map(({ node: result }) => result.id);
}

describe('persisted Search candidate contract', () => {
  let directory: string;
  let databasePath: string;
  let connection: DatabaseConnection;
  let queries: QueryBuilder;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-search-db-'));
    databasePath = path.join(directory, 'search.db');
    connection = DatabaseConnection.initialize(databasePath);
    queries = new QueryBuilder(connection.getDb());
    queries.insertNodes(CORPUS);
  });

  afterAll(() => {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('preserves exact, prefix, substring, and fuzzy candidate identities', () => {
    expect(ids(queries.searchNodes('HANDLEREQUEST', { limit: 10 }))).toEqual(['exact-a', 'exact-b']);
    expect(ids(queries.searchNodes('signIn', { limit: 10 }))).toEqual(['prefix-name', 'mid-name']);
    const substringOnly = queries.searchNodes('With', { limit: 10 });
    expect(ids(substringOnly)).toEqual(['short-mid', 'mid-name']);
    expect(substringOnly[1]!.node.filePath).toBe('src/auth/google.ts');
    expect(ids(queries.searchNodes('getUssr', { limit: 10 }))).toEqual(['fuzzy-name']);
    expect(queries.searchNodes('not-present', { limit: 10 })).toEqual([]);
  });

  it('preserves kind/language filters, bounds, and decoded row fields', () => {
    const filtered = queries.searchNodes('loadData', {
      kinds: ['function'],
      languages: ['python'],
      limit: 1,
    });
    expect(ids(filtered)).toEqual(['other-language']);
    expect(filtered[0]!.node).toMatchObject({
      id: 'other-language',
      kind: 'function',
      language: 'python',
      filePath: 'src/data/load.py',
      startLine: 3,
      endLine: 7,
      signature: 'loadData()',
    });
    expect(ids(queries.searchNodes('HandleRequest', { kinds: ['function'], languages: ['typescript'], limit: 10 }))).toEqual([
      'exact-a',
    ]);
    expect(ids(queries.searchNodes('kind:function lang:typescript', { limit: 2 }))).toHaveLength(2);
  });

  it('preserves exact-name multi-query deduplication and substring ordering', () => {
    expect(ids(queries.findNodesByExactName(['handleRequest', 'loadData', 'handleRequest'], { limit: 10 }))).toEqual([
      'exact-a',
      'exact-b',
      'other-language',
      'other-kind',
    ]);
    expect(ids(queries.findNodesByNameSubstring('Request', { excludePrefix: true, limit: 10 }))).toEqual([
      'exact-a',
      'exact-b',
    ]);
    expect(queries.findNodesByExactName([])).toEqual([]);
    expect(queries.findNodesByNameSubstring('absent')).toEqual([]);
  });

  it('preserves deterministic candidates across database reopen', () => {
    const before = ids(queries.searchNodes('signIn', { limit: 10 }));
    connection.close();
    connection = DatabaseConnection.open(databasePath);
    queries = new QueryBuilder(connection.getDb());
    expect(ids(queries.searchNodes('signIn', { limit: 10 }))).toEqual(before);
  });
});
