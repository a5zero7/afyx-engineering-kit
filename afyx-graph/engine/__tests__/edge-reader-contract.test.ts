import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import type { Edge, Node } from '../src/types';

const node = (id: string): Node => ({
  id,
  kind: 'function',
  name: id,
  qualifiedName: id,
  filePath: `${id}.ts`,
  language: 'typescript',
  startLine: 1,
  endLine: 1,
  startColumn: 0,
  endColumn: 1,
  updatedAt: 1,
});

const identity = (edge: Edge): unknown[] => [
  edge.source,
  edge.target,
  edge.kind,
  edge.line ?? null,
  edge.column ?? null,
  edge.provenance ?? null,
  edge.metadata ?? null,
];

describe('edge identity and adjacency reader contract', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let query: QueryBuilder;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-edge-reader-'));
    connection = DatabaseConnection.initialize(path.join(directory, 'graph.db'));
    query = new QueryBuilder(connection.getDb());
    query.insertNodes(['A', 'B', 'C', 'D'].map(node));
    query.insertEdges([
      { source: 'A', target: 'B', kind: 'calls', line: 10, column: 2, provenance: 'exact', metadata: { channel: 'direct' } },
      { source: 'A', target: 'C', kind: 'references', line: 20, column: 4, provenance: 'heuristic' },
      { source: 'D', target: 'B', kind: 'calls', line: 30, column: 6, provenance: 'heuristic' },
      { source: 'C', target: 'A', kind: 'contains' },
    ]);
  });

  afterEach(() => {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('preserves complete mapped identity and natural result order', () => {
    expect(query.getOutgoingEdges('A').map(identity)).toEqual([
      ['A', 'B', 'calls', 10, 2, 'exact', { channel: 'direct' }],
      ['A', 'C', 'references', 20, 4, 'heuristic', null],
    ]);
    expect(query.getIncomingEdges('B').map(identity)).toEqual([
      ['A', 'B', 'calls', 10, 2, 'exact', { channel: 'direct' }],
      ['D', 'B', 'calls', 30, 6, 'heuristic', null],
    ]);
  });

  it('owns kind and provenance filters without changing direction', () => {
    expect(query.getOutgoingEdges('A', ['calls'], 'exact').map(identity)).toEqual([
      ['A', 'B', 'calls', 10, 2, 'exact', { channel: 'direct' }],
    ]);
    expect(query.getIncomingEdges('B', ['references'])).toEqual([]);
  });

  it('deduplicates repeated batch endpoints without expanding edge results', () => {
    expect(query.getOutgoingEdgesFrom(['A', 'A', 'D'], ['calls']).map(identity)).toEqual([
      ['A', 'B', 'calls', 10, 2, 'exact', { channel: 'direct' }],
      ['D', 'B', 'calls', 30, 6, 'heuristic', null],
    ]);
    expect(query.getIncomingEdgesTo(['B', 'B'], ['calls']).map(identity)).toHaveLength(2);
  });

  it('counts each persisted edge once and omits absent endpoint keys', () => {
    expect([...query.countOutgoingEdges(['A', 'A', 'D', 'missing'])]).toEqual([['A', 2], ['D', 1]]);
    expect([...query.countIncomingEdges(['B', 'B', 'C', 'missing'])]).toEqual([['B', 2], ['C', 1]]);
  });

  it('returns only connectivity whose two endpoints are in the selected set', () => {
    expect(query.findEdgesBetweenNodes(['A', 'B', 'D'], ['calls']).map(identity)).toEqual([
      ['A', 'B', 'calls', 10, 2, 'exact', { channel: 'direct' }],
      ['D', 'B', 'calls', 30, 6, 'heuristic', null],
    ]);
  });

  it('returns stable empty shapes for missing and empty inputs', () => {
    expect(query.getOutgoingEdges('missing')).toEqual([]);
    expect(query.getIncomingEdges('missing')).toEqual([]);
    expect(query.getOutgoingEdgesFrom([])).toEqual([]);
    expect(query.getIncomingEdgesTo([])).toEqual([]);
    expect(query.findEdgesBetweenNodes([])).toEqual([]);
    expect(query.countOutgoingEdges([])).toEqual(new Map());
    expect(query.countIncomingEdges([])).toEqual(new Map());
  });
});
