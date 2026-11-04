/**
 * Synthetic graphs for the graph contract. Node ids are names; every edge carries the
 * kind, and call-site edges carry line/column so parallel edges can be told apart.
 */
import { GraphWorld, type World } from './fake-store';

const fn = (g: GraphWorld, names: string[], file = 'src/main.ts') => names.map((name) => g.node('function', name, file));

/** A → B → C → D */
function linear(): World {
  const g = new GraphWorld();
  fn(g, ['A', 'B', 'C', 'D']);
  g.edge('A', 'B', 'calls', 1, 0); g.edge('B', 'C', 'calls', 2, 0); g.edge('C', 'D', 'calls', 3, 0);
  return g.world();
}

/** A → B, A → C, B → D, C → D */
function diamond(): World {
  const g = new GraphWorld();
  fn(g, ['A', 'B', 'C', 'D']);
  g.edge('A', 'B', 'calls', 1, 0); g.edge('A', 'C', 'calls', 2, 0); g.edge('B', 'D', 'calls', 3, 0); g.edge('C', 'D', 'calls', 4, 0);
  return g.world();
}

/** A → B → C → A */
function cycle(): World {
  const g = new GraphWorld();
  fn(g, ['A', 'B', 'C']);
  g.edge('A', 'B', 'calls', 1, 0); g.edge('B', 'C', 'calls', 2, 0); g.edge('C', 'A', 'calls', 3, 0);
  return g.world();
}

/** A → A, plus a neighbour and an edge to an id that does not exist */
function selfEdge(): World {
  const g = new GraphWorld();
  fn(g, ['A', 'B']);
  g.edge('A', 'A', 'calls', 1, 0); g.edge('A', 'B', 'calls', 2, 0); g.edge('B', 'A', 'references', 3, 0);
  g.edge('A', 'GHOST', 'calls', 4, 0); g.edge('GHOST', 'B', 'calls', 5, 0);
  return g.world();
}

/** A → B and C → D */
function disconnected(): World {
  const g = new GraphWorld();
  fn(g, ['A', 'B', 'C', 'D']);
  g.edge('A', 'B', 'calls', 1, 0); g.edge('C', 'D', 'calls', 2, 0);
  return g.world();
}

/** A hub called by many and calling many. */
function hub(): World {
  const g = new GraphWorld();
  g.node('function', 'center');
  const spokes = Array.from({ length: 30 }, (_, i) => `s${i}`);
  spokes.forEach((name) => g.node('function', name));
  spokes.forEach((name, i) => { if (i % 2 === 0) g.edge(name, 'center', 'calls', i + 1, 0); else g.edge('center', name, 'calls', i + 1, 0); });
  g.edge('s0', 's1', 'references', 99, 4);
  return g.world();
}

/** The same logical edge repeated, and calls on different lines. */
function duplicates(): World {
  const g = new GraphWorld();
  fn(g, ['A', 'B', 'C']);
  g.edge('A', 'B', 'calls', 10, 2); g.edge('A', 'B', 'calls', 10, 2); g.edge('A', 'B', 'calls', 11, 2); g.edge('A', 'B', 'calls', 10, 5);
  g.edge('B', 'C', 'calls'); g.edge('B', 'C', 'calls');
  g.edge('A', 'C', 'calls', 20, 0); g.edge('A', 'C', 'calls', 20, 0);
  return g.world();
}

/** The same source and target related in several ways. */
function multiRelation(): World {
  const g = new GraphWorld();
  fn(g, ['A', 'B']);
  g.node('class', 'K');
  g.edge('A', 'B', 'calls', 1, 0); g.edge('A', 'B', 'references', 1, 0); g.edge('A', 'B', 'imports', 1, 0); g.edge('A', 'B', 'navigates', 1, 0);
  g.edge('A', 'K', 'instantiates', 2, 0); g.edge('A', 'K', 'calls', 2, 0); g.edge('B', 'K', 'type_of', 3, 0);
  return g.world();
}

/** base ├ childA, childB └ grandChild */
function inheritance(): World {
  const g = new GraphWorld();
  ['base', 'childA', 'childB', 'grandChild', 'unrelated'].forEach((name) => g.node('class', name));
  g.edge('childA', 'base', 'extends'); g.edge('childB', 'base', 'extends'); g.edge('grandChild', 'childB', 'extends');
  return g.world();
}

/** A class extending a base and implementing two interfaces, one of which extends another; a diamond of interfaces. */
function multiParent(): World {
  const g = new GraphWorld();
  ['Base', 'Impl', 'Sub'].forEach((name) => g.node('class', name));
  ['IReader', 'IWriter', 'IStream', 'IClosable'].forEach((name) => g.node('interface', name));
  g.edge('Impl', 'Base', 'extends'); g.edge('Impl', 'IReader', 'implements'); g.edge('Impl', 'IWriter', 'implements');
  g.edge('IStream', 'IReader', 'extends'); g.edge('IStream', 'IWriter', 'extends'); g.edge('IReader', 'IClosable', 'extends'); g.edge('IWriter', 'IClosable', 'extends');
  g.edge('Sub', 'Impl', 'extends'); g.edge('Sub', 'IStream', 'implements');
  g.edge('Base', 'Sub', 'extends');
  return g.world();
}

/** Several files with converging and diverging dependency paths, and one cycle. */
function fileDeps(): World {
  const g = new GraphWorld();
  const a = g.node('function', 'a', 'src/a.ts'); const b = g.node('function', 'b', 'src/b.ts'); const c = g.node('function', 'c', 'src/c.ts');
  const d = g.node('function', 'd', 'src/d.ts'); const e = g.node('function', 'e', 'src/e.ts'); const f = g.node('function', 'f', 'src/f.ts');
  g.node('function', 'a2', 'src/a.ts', { isExported: true }); g.node('class', 'A3', 'src/a.ts', { isExported: true });
  g.node('function', 'orphan', 'src/orphan.ts');
  g.edge(a.id, b.id, 'calls', 1, 0); g.edge(a.id, c.id, 'references', 2, 0); g.edge(b.id, d.id, 'calls', 3, 0); g.edge(c.id, d.id, 'calls', 4, 0);
  g.edge(d.id, e.id, 'imports', 5, 0); g.edge(e.id, f.id, 'calls', 6, 0); g.edge(f.id, d.id, 'calls', 7, 0); g.edge('a2', b.id, 'instantiates', 8, 0);
  g.edge(a.id, 'a2', 'calls', 9, 0);
  return g.world();
}

/** Containment plus every relation kind: file → class → members, with calls, hierarchy, dependencies, types and imports. */
function mixed(): World {
  const g = new GraphWorld();
  g.node('file', 'main.ts', 'src/main.ts'); g.node('file', 'util.ts', 'src/util.ts');
  g.node('class', 'Service', 'src/main.ts', { isExported: true }); g.node('class', 'BaseService', 'src/main.ts'); g.node('interface', 'Runner', 'src/main.ts');
  g.node('method', 'run', 'src/main.ts'); g.node('method', 'start', 'src/main.ts'); g.node('method', 'stop', 'src/main.ts');
  g.node('function', 'helper', 'src/util.ts', { isExported: true }); g.node('function', 'internal', 'src/util.ts'); g.node('function', 'unusedFn', 'src/util.ts');
  g.node('variable', 'CONFIG', 'src/util.ts'); g.node('type_alias', 'Options', 'src/util.ts'); g.node('import', 'helperImport', 'src/main.ts');
  g.edge('main.ts', 'Service', 'contains'); g.edge('main.ts', 'BaseService', 'contains'); g.edge('main.ts', 'Runner', 'contains'); g.edge('main.ts', 'helperImport', 'contains');
  g.edge('Service', 'run', 'contains'); g.edge('Service', 'start', 'contains'); g.edge('Service', 'stop', 'contains');
  g.edge('util.ts', 'helper', 'contains'); g.edge('util.ts', 'internal', 'contains'); g.edge('util.ts', 'unusedFn', 'contains'); g.edge('util.ts', 'CONFIG', 'contains'); g.edge('util.ts', 'Options', 'contains');
  g.edge('Service', 'BaseService', 'extends', 3, 0); g.edge('Service', 'Runner', 'implements', 3, 0);
  g.edge('run', 'start', 'calls', 10, 4); g.edge('run', 'helper', 'calls', 11, 4); g.edge('start', 'stop', 'calls', 12, 4); g.edge('stop', 'run', 'calls', 13, 4);
  g.edge('helper', 'internal', 'calls', 5, 2); g.edge('helper', 'CONFIG', 'references', 6, 2); g.edge('run', 'Options', 'type_of', 10, 9); g.edge('start', 'Options', 'returns', 12, 9);
  g.edge('main.ts', 'util.ts', 'imports', 1, 0); g.edge('helperImport', 'helper', 'imports', 1, 9); g.edge('Service', 'Service', 'references', 20, 0);
  g.edge('run', 'Service', 'instantiates', 14, 4); g.edge('run', 'run', 'navigates', 15, 4);
  return g.world();
}

/** Each relation kind alone into one target, a child with two containers, a node whose returns edge precedes its type_of edge, and a root-level file. */
function relationKinds(): World {
  const g = new GraphWorld();
  fn(g, ['Q', 'viaCalls', 'viaNav', 'viaImports', 'viaInst', 'viaRefs', 'viaType', 'typed']);
  g.node('class', 'T1'); g.node('class', 'T2');
  g.node('file', 'F1', 'src/one.ts'); g.node('file', 'F2', 'src/two.ts'); g.node('method', 'shared', 'src/one.ts');
  g.node('function', 'rootFn', 'root.ts');
  g.edge('viaCalls', 'Q', 'calls', 1, 0); g.edge('viaNav', 'Q', 'navigates', 2, 0); g.edge('viaImports', 'Q', 'imports', 3, 0);
  g.edge('viaInst', 'Q', 'instantiates', 4, 0); g.edge('viaRefs', 'Q', 'references', 5, 0); g.edge('viaType', 'Q', 'type_of', 6, 0);
  g.edge('Q', 'viaCalls', 'calls', 7, 0); g.edge('Q', 'viaNav', 'navigates', 8, 0); g.edge('Q', 'viaImports', 'imports', 9, 0);
  g.edge('Q', 'viaInst', 'instantiates', 10, 0); g.edge('Q', 'viaRefs', 'references', 11, 0); g.edge('Q', 'viaType', 'type_of', 12, 0);
  g.edge('typed', 'T1', 'returns', 13, 0); g.edge('typed', 'T2', 'type_of', 14, 0); g.edge('typed', 'T1', 'type_of', 15, 0);
  g.edge('F1', 'shared', 'contains'); g.edge('F2', 'shared', 'contains'); g.edge('rootFn', 'Q', 'calls', 16, 0);
  return g.world();
}

export const GRAPH_WORLDS: Record<string, () => World> = {
  linear, diamond, cycle, selfEdge, disconnected, hub, duplicates, multiRelation, inheritance, multiParent, fileDeps, mixed, relationKinds,
  empty: () => ({ nodes: [], edges: [] }),
};

/** Worlds small enough to record in full; the rest are recorded as digests plus counts. */
export const READABLE_WORLDS = new Set(['linear', 'diamond', 'cycle', 'selfEdge', 'disconnected', 'duplicates', 'multiRelation', 'inheritance', 'multiParent', 'fileDeps', 'relationKinds']);
