/**
 * The deterministic project the query contract is measured against.
 *
 * One realistic-shaped codebase covering: same-name symbols in several files, qualified
 * names (including nested ones and mixed case), punctuation in names, every relationship
 * kind (contains/calls/imports/extends/implements/references/type_of/instantiates/
 * navigates), pending and failed unresolved references, generated and ordinary files, a
 * file-dependency cycle, wide fan-in and fan-out, test-like and route-like files, and a
 * name common enough (15 files) to exercise the "distinctive vs common" search logic.
 */
import type { Node, Edge, UnresolvedReference, FileRecord } from '../../src/types';

export const T = 1_695_000_000_000;

let counter = 0;
function node(kind: Node['kind'], name: string, filePath: string, extra: Partial<Node> = {}): Node {
  counter += 1;
  return {
    id: `${filePath}::${name}#${counter}`, kind, name, qualifiedName: extra.qualifiedName ?? `${filePath}::${name}`, filePath,
    language: extra.language ?? 'typescript', startLine: extra.startLine ?? counter, endLine: extra.endLine ?? (extra.startLine ?? counter) + 1,
    startColumn: 0, endColumn: 1, updatedAt: T, ...extra,
  };
}
const edge = (source: string, target: string, kind: Edge['kind'], extra: Partial<Edge> = {}): Edge => ({ source, target, kind, ...extra });
const ref = (fromNodeId: string, referenceName: string, referenceKind: Edge['kind'], line: number, extra: Partial<UnresolvedReference> = {}): UnresolvedReference => ({
  fromNodeId, referenceName, referenceKind, line, column: 0, filePath: 'src/unknown.ts', language: 'typescript', ...extra,
});
const file = (path: string, extra: Partial<FileRecord> = {}): FileRecord => ({
  path, contentHash: `hash-${path}`, language: 'typescript', size: 200, modifiedAt: T, indexedAt: T + 1, nodeCount: 0, ...extra,
});

export interface Fixture {
  nodes: Node[];
  edges: Edge[];
  refs: UnresolvedReference[];
  files: FileRecord[];
  /** Ids callers can address by role, so the contract doesn't hardcode positional ids. */
  ids: Record<string, string>;
}

export function buildFixture(): Fixture {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const refs: UnresolvedReference[] = [];
  const files: FileRecord[] = [];
  const ids: Record<string, string> = {};
  const add = (n: Node, role?: string): Node => { nodes.push(n); if (role) ids[role] = n.id; return n; };

  // ---- same-name symbols across files, and qualified/nested/mixed-case/punctuation names
  const fooA = add(node('class', 'Foo', 'src/a/Foo.ts', { isExported: true, qualifiedName: 'a.Foo' }), 'fooA');
  const fooB = add(node('class', 'Foo', 'src/b/Foo.ts', { isExported: true, qualifiedName: 'b.Foo' }), 'fooB');
  const runA = add(node('method', 'run', 'src/a/Foo.ts', { qualifiedName: 'a.Foo.run', signature: 'run(): void' }), 'runA');
  const runB = add(node('method', 'run', 'src/b/Foo.ts', { qualifiedName: 'b.Foo.run' }), 'runB');
  const helperA = add(node('function', 'helper', 'src/a/util.ts', { isExported: true, qualifiedName: 'a.util.helper' }), 'helperA');
  const helperC = add(node('function', 'helper', 'src/c/util.ts', { isExported: true, qualifiedName: 'c.util.helper' }), 'helperC');
  const helperUpper = add(node('function', 'Helper', 'src/a/util.ts', { qualifiedName: 'a.util.Helper' }), 'helperUpper');
  add(node('function', 'user.name', 'src/a/util.ts', { qualifiedName: 'a.util."user.name"' }));
  add(node('function', 'get$Value', 'src/a/util.ts'));
  add(node('constant', 'X_Y_Z', 'src/a/util.ts'));
  add(node('function', '_leading', 'src/a/util.ts'));
  const nestedDeep = add(node('method', 'baz', 'src/a/Foo.ts', { qualifiedName: 'a.Foo.Bar.baz' }), 'nestedDeep');

  // ---- base/interface for extends/implements, and a returns/type_of/instantiates/navigates spread
  const base = add(node('class', 'BaseService', 'src/a/Foo.ts', { qualifiedName: 'a.BaseService' }), 'base');
  const iface = add(node('interface', 'IRunnable', 'src/a/Foo.ts', { qualifiedName: 'a.IRunnable' }), 'iface');
  const configType = add(node('type_alias', 'Config', 'src/a/util.ts'), 'configType');

  // ---- containment
  edges.push(edge(fooA.id, runA.id, 'contains'), edge(fooA.id, nestedDeep.id, 'contains'), edge(fooB.id, runB.id, 'contains'));

  // ---- extends / implements
  edges.push(edge(fooA.id, base.id, 'extends', { line: 3, column: 0 }), edge(fooA.id, iface.id, 'implements', { line: 3, column: 20 }));

  // ---- calls (cross-file, resolved), references, type_of, instantiates, navigates
  edges.push(
    edge(runA.id, helperA.id, 'calls', { line: 5, column: 4 }),
    edge(runA.id, runB.id, 'calls', { line: 6, column: 4 }), // cross-file, cross-class
    edge(runA.id, configType.id, 'type_of', { line: 7, column: 2 }),
    edge(runA.id, fooA.id, 'instantiates', { line: 8, column: 2 }),
    edge(runA.id, runA.id, 'navigates', { line: 9, column: 2 }), // self edge
    edge(helperUpper.id, helperA.id, 'references', { line: 1, column: 0 }),
  );

  // ---- an `imports` edge (same-file, per this schema) plus the resolved cross-file edge it stands for
  const fileA = add(node('file', 'Foo.ts', 'src/a/Foo.ts'), 'fileA');
  const fileB = add(node('file', 'Foo.ts', 'src/b/Foo.ts'), 'fileB');
  const importNode = add(node('import', 'helper', 'src/b/Foo.ts', { qualifiedName: 'src/b/Foo.ts::helper' }));
  edges.push(edge(fooB.id, importNode.id, 'contains'), edge(fileB.id, importNode.id, 'imports', { line: 1, column: 0 }));
  edges.push(edge(runB.id, helperA.id, 'calls', { line: 4, column: 4 })); // the resolved effect of that import

  // ---- a 3-file dependency cycle: d -> e -> f -> d
  const dFn = add(node('function', 'stepD', 'src/cycle/d.ts', { isExported: true }), 'dFn');
  const eFn = add(node('function', 'stepE', 'src/cycle/e.ts', { isExported: true }), 'eFn');
  const fFn = add(node('function', 'stepF', 'src/cycle/f.ts', { isExported: true }), 'fFn');
  edges.push(edge(dFn.id, eFn.id, 'calls', { line: 1, column: 0 }), edge(eFn.id, fFn.id, 'calls', { line: 1, column: 0 }), edge(fFn.id, dFn.id, 'calls', { line: 1, column: 0 }));

  // ---- wide fan-in (shared.ts) and fan-out (hub.ts)
  const shared = add(node('function', 'shared', 'src/util/shared.ts', { isExported: true }), 'shared');
  const fanInCallers: string[] = [];
  for (let i = 0; i < 12; i++) {
    const caller = add(node('function', `fanIn${i}`, `src/fanin/f${i}.ts`, { isExported: true }));
    edges.push(edge(caller.id, shared.id, 'calls', { line: 1, column: 0 }));
    fanInCallers.push(caller.id);
  }
  const hub = add(node('function', 'hub', 'src/hub.ts', { isExported: true }), 'hub');
  for (let i = 0; i < 10; i++) {
    const target = add(node('function', `fanOut${i}`, `src/fanout/f${i}.ts`, { isExported: true }));
    edges.push(edge(hub.id, target.id, 'calls', { line: i + 1, column: 0 }));
  }

  // ---- a name common enough (15 files) to exercise "distinctive vs common"
  const commonRunSites: string[] = [];
  for (let i = 0; i < 15; i++) {
    const n = add(node('function', 'run', `src/common/c${i}.ts`));
    commonRunSites.push(n.id);
  }
  // one file with BOTH the common name and a rare, co-locatable name
  const scrapeLoop = add(node('function', 'scrapeLoop', 'src/common/c0.ts'), 'scrapeLoop');
  void scrapeLoop;
  // a name in exactly 5 files (between the <3 and <10 thresholds a distinctive-name rule
  // might use): present in c0..c4, one of which also holds a 'run' site, so a boost keyed
  // on "distinctive" co-location is only visible there under a <10 rule, not under a <3 one.
  for (let i = 0; i < 5; i++) add(node('function', 'midCommon', `src/common/c${i}.ts`));

  // ---- unresolved references: pending and failed, plain and dotted/tailed
  refs.push(
    ref(runA.id, 'externalLib.doThing', 'calls', 10, { filePath: 'src/a/Foo.ts', candidates: ['externalLib'] }),
    ref(runA.id, 'unresolvedFn', 'calls', 11, { filePath: 'src/a/Foo.ts' }),
    ref(helperA.id, 'thirdParty.helper', 'calls', 2, { filePath: 'src/a/util.ts', status: 'failed', name_tail: 'helper' } as any),
    ref(dFn.id, 'mod::fn/2', 'calls', 3, { filePath: 'src/cycle/d.ts', language: 'erlang', status: 'failed', name_tail: 'fn' } as any),
  );

  // a second, non-heuristic edge into `helper`'s name so `getResolutionEdgesByTargetName`
  // has something real alongside the synthesized one it must exclude.
  edges.push(edge(dFn.id, helperA.id, 'references', { line: 50, column: 0 }));
  // a synthesized (heuristic) edge into a `helper`-named node: excluded from resolution
  // rebinding because it carries no reference name to resurrect from.
  edges.push(edge(fFn.id, helperC.id, 'references', { line: 51, column: 0, provenance: 'heuristic' }));

  // ---- fuzzy-fallback distance boundary: a short (<=4-char) query with one candidate at
  // edit distance 1 (should match) and one at distance 2 (should not, at the tightened cap).
  add(node('function', 'aaab', 'src/fuzzy/short.ts'), 'fuzzyDist1');
  add(node('function', 'aabb', 'src/fuzzy/short.ts'), 'fuzzyDist2');

  // ---- LIKE-fallback ordering: none of these tokens start with "handler" (so FTS's
  // prefix search finds nothing and the LIKE path actually runs), at four different
  // (score tier, name length) combinations so a swap of the ORDER BY's two keys is visible.
  add(node('function', 'zzHandlerQ', 'src/like/a.ts'), 'likeA'); // contains, len 10
  add(node('function', 'loginHandlerAlias', 'src/like/b.ts'), 'likeB'); // contains, len 17
  add(node('function', 'doStuffQ', 'src/like/c.ts', { qualifiedName: 'mod.Handler.doStuffQ' }), 'likeC'); // qualified-only, len 8

  // ---- generated vs ordinary files
  const genFn = add(node('function', 'GeneratedStub', 'src/gen/proto.pb.go', { language: 'go' }), 'genFn');
  for (let i = 0; i < 25; i++) edges.push(edge(genFn.id, add(node('function', `gs${i}`, 'src/gen/proto.pb.go', { language: 'go' })).id, 'calls', { line: i + 1, column: 0 }));
  add(node('function', 'RealHandler', 'src/normal/server.go', { language: 'go' }), 'realHandler');

  // ---- an ambient-declaration-shaped file: only interface/type_alias, nothing depends on it.
  // Its interface has one member (a method signature): transparent to the ambient rule, so
  // the file must stay flagged even though 'method' is not itself a type-level kind.
  const ambientIface = add(node('interface', 'AmbientShim', 'src/types/ambient.d.ts'), 'ambientIface');
  add(node('type_alias', 'AmbientAlias', 'src/types/ambient.d.ts'));
  const ambientMember = add(node('method', 'doIt', 'src/types/ambient.d.ts'));
  edges.push(edge(ambientIface.id, ambientMember.id, 'contains'));

  // ---- a test-like file (excluded from dominant/route detection, still queryable)
  const testFn = add(node('function', 'itWorks', 'src/__tests__/foo.test.ts'), 'testFn');
  edges.push(edge(testFn.id, testFn.id, 'calls', { line: 1, column: 0 }));

  // ---- route-like nodes for routing reads.
  // routeUsers' handler is test-like, so `getRoutingManifest` filters it out: 2 of the 3
  // route rows survive, pinning the "fewer than 3 survive → null" floor exactly at its edge.
  const loginHandler = add(node('function', 'loginHandler', 'src/handlers/auth.ts', { isExported: true }), 'loginHandler');
  const logoutHandler = add(node('function', 'logoutHandler', 'src/handlers/auth.ts', { isExported: true }));
  const testHandler = add(node('function', 'testHandler', 'src/handlers/__tests__/authTest.ts', { isExported: true }));
  const routeLogin = add(node('route', 'POST /login', 'src/routes/api.ts'));
  const routeLogout = add(node('route', 'POST /logout', 'src/routes/api.ts'));
  const routeUsers = add(node('route', 'GET /users', 'src/routes/api.ts'));
  // A fourth route in the same file with no handler edge at all: it counts toward
  // `getTopRouteFile`'s per-file total (which only groups by file_path) without adding
  // a fourth entry to `getRoutingManifest` (which requires a route → handler edge).
  add(node('route', 'DELETE /account', 'src/routes/api.ts'));
  edges.push(
    edge(routeLogin.id, loginHandler.id, 'references', { line: 1, column: 0 }),
    edge(routeLogout.id, logoutHandler.id, 'calls', { line: 2, column: 0 }),
    edge(routeUsers.id, testHandler.id, 'references', { line: 3, column: 0 }),
  );

  // Five more route-holding files, none as concentrated as api.ts: `getTopRouteFile`'s
  // concentration floor (the top file's share must clear 30%) is what decides the answer
  // here — api.ts is still the single busiest file (4 routes, unique max), but its 4-of-14
  // share (28.6%) falls just below the floor, so the answer is null.
  for (let i = 0; i < 5; i++) {
    add(node('route', `MISC /a${i}`, `src/routes/other${i}.ts`));
    add(node('route', `MISC /b${i}`, `src/routes/other${i}.ts`));
  }

  // ---- file records (nodeCount left at 0; not asserted by the contract)
  const filePaths = new Set(nodes.map((n) => n.filePath));
  for (const path of filePaths) {
    files.push(file(path, {
      language: path.endsWith('.go') ? 'go' : path.endsWith('.d.ts') ? 'typescript' : 'typescript',
      generated: path === 'src/gen/proto.pb.go',
    }));
  }

  ids.commonRunSites = JSON.stringify(commonRunSites);
  ids.fanInCallers = JSON.stringify(fanInCallers);
  const known = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => known.has(e.source) && known.has(e.target)), refs, files, ids };
}
