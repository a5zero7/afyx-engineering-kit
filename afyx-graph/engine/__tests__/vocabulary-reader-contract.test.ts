import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import type { Node } from '../src/types';

function node(id: string, name: string, kind: Node['kind'] = 'function'): Node {
  return {
    id,
    name,
    kind,
    language: 'typescript',
    filePath: `src/${id}.ts`,
    qualifiedName: `fixture::${name}`,
    startLine: 1,
    endLine: 2,
    startColumn: 0,
    endColumn: 8,
    updatedAt: 100,
  };
}

describe('persisted name-segment vocabulary reader contract', () => {
  let directory: string;
  let databasePath: string;
  let connection: DatabaseConnection;
  let queries: QueryBuilder;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-vocabulary-'));
    databasePath = path.join(directory, 'vocabulary.db');
    connection = DatabaseConnection.initialize(databasePath);
    queries = new QueryBuilder(connection.getDb());
  });

  afterAll(() => {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('reports empty and missing inputs without synthetic rows', () => {
    expect(queries.isNameSegmentVocabEmpty()).toBe(true);
    expect(queries.getSegmentCoOccurrence([], 2, 10)).toEqual([]);
    expect(queries.getSegmentNameCounts([])).toEqual(new Map());
    expect(queries.getSegmentNameCounts(['absent'])).toEqual(new Map());
    expect(queries.getNamesForSegment('absent', 10)).toEqual([]);
  });

  it('pages distinct segmentable names in stable name order', () => {
    queries.insertNodes([
      node('checkout-service', 'CheckoutService'),
      node('checkout-controller', 'CheckoutController', 'class'),
      node('order-machine', 'OrderStateMachine', 'class'),
      node('billing-services', 'BillingServicesService', 'class'),
      node('duplicate-a', 'SharedWorker'),
      node('duplicate-b', 'SharedWorker', 'method'),
      node('file-row', 'IgnoredFile', 'file'),
      node('import-row', 'ignored-package', 'import'),
    ]);

    expect(queries.isNameSegmentVocabEmpty()).toBe(false);
    expect(queries.getDistinctNodeNames(3, 0)).toEqual([
      'BillingServicesService',
      'CheckoutController',
      'CheckoutService',
    ]);
    expect(queries.getDistinctNodeNames(3, 3)).toEqual(['OrderStateMachine', 'SharedWorker']);
    expect(queries.getDistinctNodeNames(3, 6)).toEqual([]);
  });

  it('folds variants to prompt words and preserves coverage ordering and limits', () => {
    const variants = [
      { segment: 'checkout', word: 'checkout' },
      { segment: 'service', word: 'services' },
      { segment: 'services', word: 'services' },
      { segment: 'state', word: 'state' },
      { segment: 'machine', word: 'machine' },
    ];
    expect(queries.getSegmentCoOccurrence(variants, 2, 10)).toEqual([
      { name: 'CheckoutService', matches: 2 },
      { name: 'OrderStateMachine', matches: 2 },
    ]);
    expect(queries.getSegmentCoOccurrence(variants, 2, 1)).toEqual([
      { name: 'CheckoutService', matches: 2 },
    ]);
    expect(queries.getSegmentCoOccurrence(variants, 3, 10)).toEqual([]);
  });

  it('maps segment frequencies and shortest-name population without duplicates', () => {
    expect(queries.getSegmentNameCounts(['service', 'checkout', 'service', 'worker'])).toEqual(
      new Map([
        ['checkout', 2],
        ['service', 2],
        ['worker', 1],
      ]),
    );
    expect(queries.getNamesForSegment('checkout', 10)).toEqual([
      'CheckoutService',
      'CheckoutController',
    ]);
    expect(queries.getNamesForSegment('checkout', 1)).toEqual(['CheckoutService']);
    expect(queries.getNamesForSegment('checkout', 0)).toEqual([]);
  });

  it('returns the same vocabulary after reopening the database', () => {
    const before = {
      names: queries.getDistinctNodeNames(20, 0),
      counts: [...queries.getSegmentNameCounts(['checkout', 'service', 'worker'])],
      matches: queries.getSegmentCoOccurrence(
        [
          { segment: 'checkout', word: 'checkout' },
          { segment: 'service', word: 'service' },
        ],
        2,
        10,
      ),
    };
    connection.close();
    connection = DatabaseConnection.open(databasePath);
    queries = new QueryBuilder(connection.getDb());

    expect({
      names: queries.getDistinctNodeNames(20, 0),
      counts: [...queries.getSegmentNameCounts(['checkout', 'service', 'worker'])],
      matches: queries.getSegmentCoOccurrence(
        [
          { segment: 'checkout', word: 'checkout' },
          { segment: 'service', word: 'service' },
        ],
        2,
        10,
      ),
    }).toEqual(before);
  });
});
