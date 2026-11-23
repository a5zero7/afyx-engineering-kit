/**
 * `graph/file-graph.ts::walkFileDependents` — the generic BFS over file-level dependents
 * Phase 3B.5's architectural closure extracted out of `src/impact` so Graph, not Impact,
 * owns traversal mechanics. Pins BFS ordering, depth boundaries, cycle safety, dedup,
 * seed inclusion/exclusion and multi-seed behavior against a fake `FileDependentsSource`
 * (fast, deterministic, no extraction/DB needed) covering the required graph shapes.
 */
import { describe, expect, it } from 'vitest';
import { walkFileDependents, type FileDependentsSource } from '../src/graph/file-graph';

function fakeSource(edges: Array<[string, string]>): FileDependentsSource {
  // edges are [dependent, dependency] pairs, matching getFileDependents(dependency) -> [dependent, ...]
  const byDependency = new Map<string, string[]>();
  for (const [dependent, dependency] of edges) {
    const list = byDependency.get(dependency) ?? [];
    list.push(dependent);
    byDependency.set(dependency, list);
  }
  return { getFileDependents: (filePath) => byDependency.get(filePath) ?? [] };
}

describe('walkFileDependents', () => {
  it('LINEAR: a <- b <- c <- d, full transitive reach at sufficient depth', () => {
    const source = fakeSource([['b', 'a'], ['c', 'b'], ['d', 'c']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 3 });
    expect(result.reached).toEqual(new Set(['b', 'c', 'd']));
    expect(result.stopped).toEqual(new Set());
  });

  it('LINEAR: depth 0 reaches nothing (seed itself is hop 0, never expanded)', () => {
    const source = fakeSource([['b', 'a'], ['c', 'b'], ['d', 'c']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 0 });
    expect(result.reached).toEqual(new Set());
  });

  it('LINEAR: depth 1 reaches only the direct dependent', () => {
    const source = fakeSource([['b', 'a'], ['c', 'b'], ['d', 'c']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 1 });
    expect(result.reached).toEqual(new Set(['b']));
  });

  it('LINEAR: depth 2 reaches two hops', () => {
    const source = fakeSource([['b', 'a'], ['c', 'b'], ['d', 'c']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 2 });
    expect(result.reached).toEqual(new Set(['b', 'c']));
  });

  it('LINEAR: the seed itself is never included in `reached`', () => {
    const source = fakeSource([['b', 'a']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 5 });
    expect(result.reached.has('a')).toBe(false);
  });

  it('DIAMOND: a <- b, a <- c, b <- d, c <- d — d is deduped, reached exactly once', () => {
    const source = fakeSource([['b', 'a'], ['c', 'a'], ['d', 'b'], ['d', 'c']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 2 });
    expect(result.reached).toEqual(new Set(['b', 'c', 'd']));
  });

  it('DIAMOND: BFS ordering — every hop-1 file is reachable before any hop-2 file is discovered', () => {
    // Verified indirectly: at maxDepth=1 only the two hop-1 siblings are reached, never d
    // (which requires a hop-2 expansion) — proves depth is tracked per-node, not globally.
    const source = fakeSource([['b', 'a'], ['c', 'a'], ['d', 'b'], ['d', 'c']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 1 });
    expect(result.reached).toEqual(new Set(['b', 'c']));
  });

  it('CYCLE: a <- b <- c <- a terminates instead of looping, at any sufficient depth', () => {
    const source = fakeSource([['b', 'a'], ['c', 'b'], ['a', 'c']]);
    const result = walkFileDependents(source, ['a'], { maxDepth: 100 });
    expect(result.reached).toEqual(new Set(['b', 'c']));
  });

  it('CYCLE: depth 1 and depth 2 differ correctly even inside a cycle', () => {
    const source = fakeSource([['b', 'a'], ['c', 'b'], ['a', 'c']]);
    expect(walkFileDependents(source, ['a'], { maxDepth: 1 }).reached).toEqual(new Set(['b']));
    expect(walkFileDependents(source, ['a'], { maxDepth: 2 }).reached).toEqual(new Set(['b', 'c']));
  });

  it('DISCONNECTED: unreachable components never appear in the result', () => {
    const source = fakeSource([['y', 'x'], ['q', 'p']]);
    const result = walkFileDependents(source, ['x'], { maxDepth: 10 });
    expect(result.reached).toEqual(new Set(['y']));
  });

  it('FAN-IN: many files depend on one target — a single seed at the target reaches them all at depth 1', () => {
    const source = fakeSource([['u1', 't'], ['u2', 't'], ['u3', 't'], ['u4', 't'], ['u5', 't']]);
    const result = walkFileDependents(source, ['t'], { maxDepth: 1 });
    expect(result.reached).toEqual(new Set(['u1', 'u2', 'u3', 'u4', 'u5']));
  });

  it('FAN-OUT: one file affects many at depth 1, each of which affects further files at depth 2', () => {
    const source = fakeSource([
      ['m1', 'root'], ['m2', 'root'], ['m3', 'root'],
      ['l1', 'm1'], ['l2', 'm2'], ['l3', 'm3'],
    ]);
    const d1 = walkFileDependents(source, ['root'], { maxDepth: 1 });
    expect(d1.reached).toEqual(new Set(['m1', 'm2', 'm3']));
    const d2 = walkFileDependents(source, ['root'], { maxDepth: 2 });
    expect(d2.reached).toEqual(new Set(['m1', 'm2', 'm3', 'l1', 'l2', 'l3']));
  });

  it('BFS ordering matters beyond a tree: shortest-path-first discovery reaches a node the long path alone would miss at the depth boundary', () => {
    // root has two depth-1 dependents: shortcut (reaches convergeTarget at hop 2) and
    // longway1 -> longway2 (reaches the SAME convergeTarget at hop 3). A correct BFS
    // drains every depth-1 file before touching any depth-2 file, so convergeTarget is
    // ALWAYS first recorded via the shorter path (hop 2), regardless of push order —
    // and since maxDepth=3, a hop-2 node is still expandable (2 < 3), so its own
    // dependent (deeperChild) is discovered. A depth-first order can instead reach
    // convergeTarget via the longer path first (hop 3), which then fails the
    // `hop < maxDepth` check and never discovers deeperChild — a real divergence in the
    // FINAL RESULT SET, not merely in reporting order (unlike every tree-shaped world
    // above, where BFS vs DFS never changes which nodes are found).
    const source = fakeSource([
      ['shortcut', 'root'],
      ['longway1', 'root'],
      ['longway2', 'longway1'],
      ['convergeTarget', 'shortcut'],
      ['convergeTarget', 'longway2'],
      ['deeperChild', 'convergeTarget'],
    ]);
    const result = walkFileDependents(source, ['root'], { maxDepth: 3 });
    expect(result.reached).toEqual(new Set(['shortcut', 'longway1', 'longway2', 'convergeTarget', 'deeperChild']));
  });

  it('MULTI-SEED: two independent seeds union their reachable sets, deduped', () => {
    const source = fakeSource([['shared', 'seedA'], ['shared', 'seedB'], ['onlyA', 'seedA'], ['onlyB', 'seedB']]);
    const result = walkFileDependents(source, ['seedA', 'seedB'], { maxDepth: 1 });
    expect(result.reached).toEqual(new Set(['shared', 'onlyA', 'onlyB']));
  });

  it('stopAt: a file matching the predicate is recorded in `stopped` but never expanded past', () => {
    const source = fakeSource([['mid', 'root'], ['leafPastStop', 'mid'], ['stopHere', 'mid']]);
    const result = walkFileDependents(source, ['root'], { maxDepth: 5, stopAt: (f) => f === 'stopHere' });
    expect(result.stopped).toEqual(new Set(['stopHere']));
    expect(result.reached.has('stopHere')).toBe(true);
    // stopHere's own dependents (none scripted here, but the point is it was never queried
    // for expansion) — verified precisely by the terminal-chain case below.
  });

  it('stopAt: a seed itself matching the predicate is recorded in `stopped`, not expanded', () => {
    const source = fakeSource([['neverSeen', 'seed']]);
    const result = walkFileDependents(source, ['seed'], { maxDepth: 5, stopAt: (f) => f === 'seed' });
    expect(result.stopped).toEqual(new Set(['seed']));
    expect(result.reached.has('neverSeen')).toBe(false);
  });

  it('stopAt: a chain of two terminals only reports the first one reached', () => {
    const source = fakeSource([['firstStop', 'root'], ['secondStop', 'firstStop']]);
    const result = walkFileDependents(source, ['root'], { maxDepth: 5, stopAt: (f) => f.endsWith('Stop') });
    expect(result.stopped).toEqual(new Set(['firstStop']));
    expect(result.reached).toEqual(new Set(['firstStop']));
  });

  it('an empty seed list reaches nothing', () => {
    const source = fakeSource([['b', 'a']]);
    const result = walkFileDependents(source, [], { maxDepth: 5 });
    expect(result.reached).toEqual(new Set());
    expect(result.stopped).toEqual(new Set());
  });

  it('a seed with no dependents at all reaches nothing, no error', () => {
    const source = fakeSource([]);
    const result = walkFileDependents(source, ['lonely'], { maxDepth: 5 });
    expect(result.reached).toEqual(new Set());
  });
});
