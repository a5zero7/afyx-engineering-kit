/**
 * Synthetic source tree covering every graph/file shape Phase 3B.5's impact/affected
 * contract needs: linear chains, diamonds, cycles, disconnected components, a fan-in/
 * fan-out hub, multi-relation edges (calls + extends between the same two files), file
 * dependency fan-in/fan-out, and every test-mapping shape (direct test, multiple tests,
 * nested transitive source/test, and a source graph with no test at all).
 *
 * Written as real TypeScript and indexed through the actual extractor/resolver (neither
 * of which this phase touches) — the same pattern `cli-affected-test-conventions.test.ts`
 * already uses — so the contract is driven by real call/import/extends edges, not a
 * hand-built DB fixture that could silently diverge from what extraction actually produces.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

function w(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

export function writeFixture(dir: string): void {
  // ---- LINEAR: a -> b -> c -> d ------------------------------------------------------
  w(dir, 'src/linear/d.ts', `export function linearD(): number { return 4; }\n`);
  w(dir, 'src/linear/c.ts', `import { linearD } from './d';\nexport function linearC(): number { return linearD(); }\n`);
  w(dir, 'src/linear/b.ts', `import { linearC } from './c';\nexport function linearB(): number { return linearC(); }\n`);
  w(dir, 'src/linear/a.ts', `import { linearB } from './b';\nexport function linearA(): number { return linearB(); }\n`);

  // ---- DIAMOND: a -> b, a -> c, b -> d, c -> d ----------------------------------------
  w(dir, 'src/diamond/d.ts', `export function diamondD(): number { return 4; }\n`);
  w(dir, 'src/diamond/b.ts', `import { diamondD } from './d';\nexport function diamondB(): number { return diamondD(); }\n`);
  w(dir, 'src/diamond/c.ts', `import { diamondD } from './d';\nexport function diamondC(): number { return diamondD(); }\n`);
  w(dir, 'src/diamond/a.ts', `import { diamondB } from './b';\nimport { diamondC } from './c';\nexport function diamondA(): number { return diamondB() + diamondC(); }\n`);

  // ---- CYCLE: a -> b -> c -> a ---------------------------------------------------------
  w(dir, 'src/cycle/a.ts', `import { cycleB } from './b';\nexport function cycleA(): number { return cycleB(); }\n`);
  w(dir, 'src/cycle/b.ts', `import { cycleC } from './c';\nexport function cycleB(): number { return cycleC(); }\n`);
  w(dir, 'src/cycle/c.ts', `import { cycleA } from './a';\nexport function cycleC(x = 0): number { return x > 0 ? cycleA() : 0; }\n`);

  // ---- DISCONNECTED: x -> y, and separately p -> q -------------------------------------
  w(dir, 'src/disc/y.ts', `export function discY(): number { return 1; }\n`);
  w(dir, 'src/disc/x.ts', `import { discY } from './y';\nexport function discX(): number { return discY(); }\n`);
  w(dir, 'src/disc/q.ts', `export function discQ(): number { return 2; }\n`);
  w(dir, 'src/disc/p.ts', `import { discQ } from './q';\nexport function discP(): number { return discQ(); }\n`);

  // ---- HUB: 5 callers -> hub -> 3 callees ---------------------------------------------
  w(dir, 'src/hub/callee1.ts', `export function hubCallee1(): number { return 1; }\n`);
  w(dir, 'src/hub/callee2.ts', `export function hubCallee2(): number { return 2; }\n`);
  w(dir, 'src/hub/callee3.ts', `export function hubCallee3(): number { return 3; }\n`);
  w(dir, 'src/hub/hub.ts', [
    `import { hubCallee1 } from './callee1';`,
    `import { hubCallee2 } from './callee2';`,
    `import { hubCallee3 } from './callee3';`,
    `export function hubCentral(): number { return hubCallee1() + hubCallee2() + hubCallee3(); }`,
    ``,
  ].join('\n'));
  for (let i = 1; i <= 5; i++) {
    w(dir, `src/hub/caller${i}.ts`, `import { hubCentral } from './hub';\nexport function hubCaller${i}(): number { return hubCentral(); }\n`);
  }

  // ---- MULTI-RELATION: Derived extends Base AND calls a Base static method ------------
  w(dir, 'src/multirel/base.ts', [
    `export class MultiRelBase {`,
    `  static helper(): number { return 1; }`,
    `}`,
    ``,
  ].join('\n'));
  w(dir, 'src/multirel/derived.ts', [
    `import { MultiRelBase } from './base';`,
    `export class MultiRelDerived extends MultiRelBase {`,
    `  use(): number { return MultiRelBase.helper(); }`,
    `}`,
    ``,
  ].join('\n'));

  // ---- FILE FAN-IN: 5 files depend on one target file ----------------------------------
  w(dir, 'src/fanin/target.ts', `export function faninTarget(): number { return 0; }\n`);
  for (let i = 1; i <= 5; i++) {
    w(dir, `src/fanin/user${i}.ts`, `import { faninTarget } from './target';\nexport function faninUser${i}(): number { return faninTarget(); }\n`);
  }

  // ---- FILE FAN-OUT: one file depends on 5 files ---------------------------------------
  for (let i = 1; i <= 5; i++) {
    w(dir, `src/fanout/dep${i}.ts`, `export function fanoutDep${i}(): number { return ${i}; }\n`);
  }
  w(dir, 'src/fanout/hubfile.ts', [
    ...[1, 2, 3, 4, 5].map((i) => `import { fanoutDep${i} } from './dep${i}';`),
    `export function fanoutRoot(): number { return ${[1, 2, 3, 4, 5].map((i) => `fanoutDep${i}()`).join(' + ')}; }`,
    ``,
  ].join('\n'));

  // ---- TEST MAPPING: source -> helper, with one test depending on helper --------------
  w(dir, 'src/testmap/helper.ts', `export function testmapHelper(): number { return 1; }\n`);
  w(dir, 'src/testmap/source.ts', `import { testmapHelper } from './helper';\nexport function testmapSource(): number { return testmapHelper(); }\n`);
  w(dir, 'src/testmap/source.test.ts', `import { testmapHelper } from './helper';\ntest('uses helper', () => { testmapHelper(); });\n`);

  // ---- MULTIPLE TESTS: source -> helper <- test A, test B ------------------------------
  w(dir, 'src/multitest/helper.ts', `export function multitestHelper(): number { return 1; }\n`);
  w(dir, 'src/multitest/source.ts', `import { multitestHelper } from './helper';\nexport function multitestSource(): number { return multitestHelper(); }\n`);
  w(dir, 'src/multitest/a.test.ts', `import { multitestHelper } from './helper';\ntest('a uses helper', () => { multitestHelper(); });\n`);
  w(dir, 'src/multitest/b.test.ts', `import { multitestHelper } from './helper';\ntest('b uses helper', () => { multitestHelper(); });\n`);

  // ---- NESTED SOURCE/TEST: deep1 -> deep2 -> deep3, deep3 has a direct test,
  //      and deep1 has its own direct test too (a direct AND a transitive test path) -----
  w(dir, 'src/nested/deep3.ts', `export function nestedDeep3(): number { return 3; }\n`);
  w(dir, 'src/nested/deep2.ts', `import { nestedDeep3 } from './deep3';\nexport function nestedDeep2(): number { return nestedDeep3(); }\n`);
  w(dir, 'src/nested/deep1.ts', `import { nestedDeep2 } from './deep2';\nexport function nestedDeep1(): number { return nestedDeep2(); }\n`);
  w(dir, 'src/nested/deep3.test.ts', `import { nestedDeep3 } from './deep3';\ntest('deep3 direct', () => { nestedDeep3(); });\n`);
  w(dir, 'src/nested/deep1.test.ts', `import { nestedDeep1 } from './deep1';\ntest('deep1 direct', () => { nestedDeep1(); });\n`);

  // ---- AMBIGUOUS: two unrelated definitions share the same bare name, in different files,
  //      each with its own distinct caller — exercises the multi-definition-group merge path
  //      (#764) rather than the single-definition path every other world above exercises. ---
  w(dir, 'src/ambiguous/one.ts', `export function ambiguousShared(): number { return 1; }\n`);
  w(dir, 'src/ambiguous/two.ts', `export function ambiguousShared(): number { return 2; }\n`);
  w(dir, 'src/ambiguous/callerOne.ts', `import { ambiguousShared } from './one';\nexport function ambiguousCallerOne(): number { return ambiguousShared(); }\n`);
  w(dir, 'src/ambiguous/callerTwo.ts', `import { ambiguousShared } from './two';\nexport function ambiguousCallerTwo(): number { return ambiguousShared(); }\n`);

  // ---- FILE-LEVEL DIAMOND WITH DEPTH-SENSITIVE CONVERGENCE ----------------------------
  // root has two dependents at hop 1 (shortcut, longway1); shortcut reaches
  // convergeTarget directly (hop 2), while longway1 -> longway2 -> convergeTarget takes
  // an extra hop (hop 3). A shortest-path-correct BFS visits convergeTarget at hop 2 (via
  // shortcut) regardless of which depth-1 sibling is dequeued first, since ALL depth-1
  // nodes are exhausted before any depth-2 node is expanded — so at maxDepth=3,
  // convergeTarget (hop 2 < 3) is still expanded and its own dependent (a test file) is
  // discovered. A traversal that explores depth-first instead (LIFO) can reach
  // convergeTarget via the LONGER path first, recording hop 3, which then fails the
  // `hop < maxDepth` check and never discovers that same test dependent — the two
  // traversal orders diverge in their FINAL RESULT SET here, not merely in the order
  // results are reported (the existing worlds above are all trees, where BFS vs DFS
  // never changes which nodes are found — only the order, which the CLI's `.sort()`
  // already masks).
  // File names are deliberately ordered (a... before z...) so `getFileDependents(root)`
  // returns the shortcut before the long-way entry point regardless of the DB's own row
  // order — the DB imposes no ORDER BY, but in practice returns rows in roughly path/
  // insertion order, and a shift()-based BFS must reach convergeTarget by the shorter
  // path REGARDLESS of that order (draining every depth-1 sibling before touching
  // anything a sibling's own expansion pushes), whereas a pop()-based traversal explores
  // whichever depth-1 sibling was pushed LAST — the long path here — first, and does so
  // deep enough to record convergeTarget only at the longer distance.
  w(dir, 'src/filediamond/root.ts', `export function filediamondRoot(): number { return 0; }\n`);
  w(dir, 'src/filediamond/ashortcut.ts', `import { filediamondRoot } from './root';\nexport function filediamondShortcut(): number { return filediamondRoot(); }\n`);
  w(dir, 'src/filediamond/zlongway1.ts', `import { filediamondRoot } from './root';\nexport function filediamondLongway1(): number { return filediamondRoot(); }\n`);
  w(dir, 'src/filediamond/zlongway2.ts', `import { filediamondLongway1 } from './zlongway1';\nexport function filediamondLongway2(): number { return filediamondLongway1(); }\n`);
  w(dir, 'src/filediamond/convergeTarget.ts', [
    `import { filediamondShortcut } from './ashortcut';`,
    `import { filediamondLongway2 } from './zlongway2';`,
    `export function filediamondConverge(): number { return filediamondShortcut() + filediamondLongway2(); }`,
    ``,
  ].join('\n'));
  w(dir, 'src/filediamond/convergeTarget.test.ts', `import { filediamondConverge } from './convergeTarget';\ntest('converge', () => { filediamondConverge(); });\n`);

  // ---- TEST-CHAIN: a test file that is itself depended on by another test file --------
  // Distinguishes "a test dependent is terminal" (correct: traversal stops there) from "a
  // test dependent still gets expanded" (the two BFS mutations that only manifest when a
  // test file has a further dependent of its own — every other test-mapping world above
  // has test files as true leaves, so this is the only place that difference is visible).
  w(dir, 'src/testchain/base.ts', `export function testchainBase(): number { return 1; }\n`);
  w(dir, 'src/testchain/base.test.ts', [
    `import { testchainBase } from './base';`,
    `export function testchainBaseTestHelper(): number { return testchainBase(); }`,
    `test('base direct', () => { testchainBaseTestHelper(); });`,
    ``,
  ].join('\n'));
  w(dir, 'src/testchain/derived.test.ts', `import { testchainBaseTestHelper } from './base.test';\ntest('derived via base.test', () => { testchainBaseTestHelper(); });\n`);

  // ---- DEEP CHAIN: 15 dependency hops, to exercise depth clamping at [1,10] for real ---
  // (every other world above saturates well under 10 hops, so an unclamped depth and a
  // depth of 10 would look identical there — this is the one world long enough to tell).
  w(dir, 'src/deepchain/n0.ts', `export function deepchainN0(): number { return 0; }\n`);
  for (let i = 1; i <= 15; i++) {
    w(dir, `src/deepchain/n${i}.ts`, `import { deepchainN${i - 1} } from './n${i - 1}';\nexport function deepchainN${i}(): number { return deepchainN${i - 1}(); }\n`);
  }

  // ---- DUPLICATE CALL SITES: one caller calls the same target twice, producing two real
  //      edges with the identical source->target:kind key (different call-site lines) —
  //      the only way to genuinely exercise the edge-collision dedup tie-break in the
  //      symbol-impact merge, since every other world above has at most one edge per key.
  w(dir, 'src/dupcall/target.ts', `export function dupcallTarget(): number { return 1; }\n`);
  w(dir, 'src/dupcall/caller.ts', [
    `import { dupcallTarget } from './target';`,
    `export function dupcallCaller(): number {`,
    `  const a = dupcallTarget();`,
    `  const b = dupcallTarget();`,
    `  return a + b;`,
    `}`,
    ``,
  ].join('\n'));

  // ---- NO TEST PATH: a small impacted source graph with zero tests anywhere ------------
  w(dir, 'src/notest/leaf.ts', `export function notestLeaf(): number { return 1; }\n`);
  w(dir, 'src/notest/mid.ts', `import { notestLeaf } from './leaf';\nexport function notestMid(): number { return notestLeaf(); }\n`);
  w(dir, 'src/notest/top.ts', `import { notestMid } from './mid';\nexport function notestTop(): number { return notestMid(); }\n`);
}
