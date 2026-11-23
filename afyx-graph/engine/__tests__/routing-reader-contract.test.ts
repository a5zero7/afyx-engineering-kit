import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import type { Edge, FileRecord, Node, NodeKind } from '../src/types';

function node(id: string, kind: NodeKind, filePath: string, startLine = 1, name = id): Node {
  return {
    id,
    kind,
    name,
    qualifiedName: `${filePath}::${name}`,
    filePath,
    language: 'typescript',
    startLine,
    endLine: startLine,
    startColumn: 0,
    endColumn: 1,
    updatedAt: 1,
  };
}

function edge(source: string, target: string, line: number, kind: Edge['kind'] = 'calls'): Edge {
  return { source, target, kind, line, column: 0 };
}

function file(filePath: string, generated = false): FileRecord {
  return {
    path: filePath,
    contentHash: `hash:${filePath}`,
    language: 'typescript',
    size: 100,
    modifiedAt: 1,
    indexedAt: 1,
    nodeCount: 1,
    generated,
  };
}

function denseFile(filePath: string, prefix: string, edgeCount: number): { nodes: Node[]; edges: Edge[] } {
  const source = node(`${prefix}:source`, 'function', filePath, 1, 'source');
  const targets = Array.from({ length: edgeCount }, (_, index) =>
    node(`${prefix}:target:${index}`, 'function', filePath, index + 2, `target${index}`)
  );
  return {
    nodes: [source, ...targets],
    edges: targets.map((target, index) => edge(source.id, target.id, index + 1)),
  };
}

describe('persisted routing read-model contract', () => {
  let directory: string;
  let dbPath: string;
  let connection: DatabaseConnection;
  let query: QueryBuilder;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-routing-reader-'));
    dbPath = path.join(directory, 'graph.db');
    connection = DatabaseConnection.initialize(dbPath);
    query = new QueryBuilder(connection.getDb());
  });

  afterEach(() => {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('selects the dominant production file and retains runner-up evidence', () => {
    const primary = denseFile('src/core.ts', 'primary', 25);
    const secondary = denseFile('src/worker.ts', 'secondary', 21);
    const testOnly = denseFile('src/__tests__/huge.test.ts', 'test', 35);
    const generated = denseFile('src/vendor/runtime.ts', 'generated', 40);
    query.insertNodes([...primary.nodes, ...secondary.nodes, ...testOnly.nodes, ...generated.nodes]);
    query.insertEdges([...primary.edges, ...secondary.edges, ...testOnly.edges, ...generated.edges]);
    query.upsertFile(file('src/vendor/runtime.ts', true));

    expect(query.getDominantFile()).toEqual({ filePath: 'src/core.ts', edgeCount: 25, nextEdgeCount: 21 });
  });

  it('owns route concentration, low-value filtering, thresholds, and null fallback', () => {
    const routes = (filePath: string, prefix: string, count: number): Node[] =>
      Array.from({ length: count }, (_, index) => node(`${prefix}:${index}`, 'route', filePath, index + 1, `GET /${prefix}/${index}`));
    query.insertNodes([
      ...routes('src/routes/api.ts', 'api', 4),
      ...routes('src/routes/misc.ts', 'misc', 2),
      ...routes('src/__tests__/routes.ts', 'test', 12),
      ...routes('src/vendor/routes.ts', 'generated', 15),
    ]);
    query.upsertFile(file('src/vendor/routes.ts', true));

    expect(query.getTopRouteFile()).toEqual({ filePath: 'src/routes/api.ts', routeCount: 4, totalRoutes: 6 });

    const emptyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-routing-empty-'));
    const emptyConnection = DatabaseConnection.initialize(path.join(emptyDirectory, 'graph.db'));
    try {
      const emptyQuery = new QueryBuilder(emptyConnection.getDb());
      expect(emptyQuery.getDominantFile()).toBeNull();
      expect(emptyQuery.getTopRouteFile()).toBeNull();
      expect(emptyQuery.getRoutingManifest()).toBeNull();
    } finally {
      emptyConnection.close();
      fs.rmSync(emptyDirectory, { recursive: true, force: true });
    }
  });

  it('maps an ordered route manifest, preserves multiple targets, and applies stable tie precedence', () => {
    const routes = [
      node('route:a', 'route', 'src/routes/a.ts', 10, 'GET /a'),
      node('route:b', 'route', 'src/routes/a.ts', 20, 'POST /b'),
      node('route:c', 'route', 'src/routes/b.ts', 5, 'GET /c'),
      node('route:d', 'route', 'src/routes/b.ts', 15, 'GET /d'),
      node('route:test', 'route', 'src/routes/test.ts', 30, 'GET /test'),
      node('route:generated', 'route', 'src/routes/generated.ts', 40, 'GET /generated'),
    ];
    const handlers = [
      node('handler:a1', 'function', 'src/handlers/a.ts', 11, 'handleA1'),
      node('handler:a2', 'method', 'src/handlers/a.ts', 12, 'handleA2'),
      node('handler:b1', 'class', 'src/handlers/b.ts', 21, 'HandleB1'),
      node('handler:b2', 'constant', 'src/handlers/b.ts', 22, 'handleB2'),
      node('handler:c', 'variable', 'src/handlers/c.ts', 31, 'handleC'),
      node('handler:test', 'function', 'src/handlers/__tests__/handler.test.ts', 1, 'testHandler'),
      node('handler:generated', 'function', 'src/vendor/handler.ts', 1, 'generatedHandler'),
    ];
    query.insertNodes([...routes, ...handlers]);
    query.insertEdges([
      edge('route:a', 'handler:a1', 1, 'references'),
      edge('route:a', 'handler:a2', 2),
      edge('route:b', 'handler:b1', 3, 'references'),
      edge('route:c', 'handler:b2', 4),
      edge('route:d', 'handler:c', 5, 'references'),
      edge('route:test', 'handler:test', 6, 'references'),
      edge('route:generated', 'handler:generated', 7, 'references'),
    ]);
    query.upsertFile(file('src/vendor/handler.ts', true));

    const manifest = query.getRoutingManifest(20);
    expect(manifest).not.toBeNull();
    expect(manifest?.entries.map((entry) => entry.routeId)).toEqual([
      'route:a', 'route:a', 'route:b', 'route:c', 'route:d',
    ]);
    expect(manifest?.entries.filter((entry) => entry.routeId === 'route:a').map((entry) => entry.handler).sort()).toEqual([
      'handleA1', 'handleA2',
    ]);
    expect(manifest?.entries.at(-1)).toEqual({
      url: 'GET /d',
      handler: 'handleC',
      handlerFile: 'src/handlers/c.ts',
      handlerLine: 31,
      handlerKind: 'variable',
      routeId: 'route:d',
      routeFile: 'src/routes/b.ts',
      routeLine: 15,
    });
    expect(manifest?.topHandlerFile).toBe('src/handlers/a.ts');
    expect(manifest?.topHandlerFileCount).toBe(2);
    expect(manifest?.totalRoutes).toBe(5);
    expect(query.getRoutingManifest(2)).toBeNull();
  });

  it('preserves routing reads after reopening the accepted schema', () => {
    const routes = Array.from({ length: 3 }, (_, index) =>
      node(`route:${index}`, 'route', 'src/routes.ts', index + 1, `GET /${index}`)
    );
    query.insertNodes(routes);
    connection.close();
    connection = DatabaseConnection.open(dbPath);
    query = new QueryBuilder(connection.getDb());
    expect(query.getTopRouteFile()).toEqual({ filePath: 'src/routes.ts', routeCount: 3, totalRoutes: 3 });
  });
});
