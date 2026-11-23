import { describe, expect, it } from 'vitest';
import { computeAffectedTests } from '../src/impact/affected-tests';
import { isTestPath } from '../src/search/test-paths';

function host(edges: Array<[dependent: string, dependency: string]>) {
  const dependents = new Map<string, string[]>();
  for (const [dependent, dependency] of edges) {
    const list = dependents.get(dependency) ?? [];
    list.push(dependent);
    dependents.set(dependency, list);
  }
  return { getFileDependents: (filePath: string) => dependents.get(filePath) ?? [] };
}

describe('affected tests through test-support files', () => {
  it('propagates through a multi-hop helper chain to the executable test', () => {
    const graph = host([
      ['project/__tests__/helpers/shared-helper.ts', 'src/production.ts'],
      ['project/__tests__/helpers/nested/helper-b.ts', 'project/__tests__/helpers/shared-helper.ts'],
      ['project/__tests__/feature.test.ts', 'project/__tests__/helpers/nested/helper-b.ts'],
      ['project/__tests__/unrelated.test.ts', 'src/unrelated.ts'],
    ]);

    // The shared search contract deliberately recognises every file under __tests__.
    // Affected-tests may report those reachable support files, but must not stop there.
    expect(isTestPath('project/__tests__/helpers/shared-helper.ts')).toBe(true);
    expect(computeAffectedTests(graph, ['src/production.ts'], { maxDepth: 3 })).toEqual({
      affectedTests: [
        'project/__tests__/feature.test.ts',
        'project/__tests__/helpers/nested/helper-b.ts',
        'project/__tests__/helpers/shared-helper.ts',
      ],
      totalDependentsTraversed: 3,
    });
  });

  it('preserves hop-based depth boundaries while traversing helpers', () => {
    const graph = host([
      ['project/__tests__/helpers/helper-a.ts', 'src/production.ts'],
      ['project/__tests__/helpers/helper-b.ts', 'project/__tests__/helpers/helper-a.ts'],
      ['project/__tests__/feature.test.ts', 'project/__tests__/helpers/helper-b.ts'],
    ]);

    expect(computeAffectedTests(graph, ['src/production.ts'], { maxDepth: 2 }).affectedTests)
      .toEqual(['project/__tests__/helpers/helper-a.ts', 'project/__tests__/helpers/helper-b.ts']);
    expect(computeAffectedTests(graph, ['src/production.ts'], { maxDepth: 3 }).affectedTests)
      .toContain('project/__tests__/feature.test.ts');
  });

  it('remains cycle-safe and deduplicates a test reached through two helpers', () => {
    const graph = host([
      ['project/__tests__/helpers/a.ts', 'src/production.ts'],
      ['project/__tests__/helpers/b.ts', 'src/production.ts'],
      ['project/__tests__/helpers/a.ts', 'project/__tests__/helpers/b.ts'],
      ['project/__tests__/helpers/b.ts', 'project/__tests__/helpers/a.ts'],
      ['project/__tests__/feature.test.ts', 'project/__tests__/helpers/a.ts'],
      ['project/__tests__/feature.test.ts', 'project/__tests__/helpers/b.ts'],
    ]);

    const result = computeAffectedTests(graph, ['src/production.ts'], { maxDepth: 20 });
    expect(result.affectedTests.filter((file) => file === 'project/__tests__/feature.test.ts')).toHaveLength(1);
    expect(result.totalDependentsTraversed).toBe(3);
  });

  it('preserves explicit test filenames as terminals', () => {
    const graph = host([
      ['project/__tests__/base.test.ts', 'src/production.ts'],
      ['project/__tests__/derived.test.ts', 'project/__tests__/base.test.ts'],
    ]);

    expect(computeAffectedTests(graph, ['src/production.ts'], { maxDepth: 5 })).toEqual({
      affectedTests: ['project/__tests__/base.test.ts'],
      totalDependentsTraversed: 1,
    });
  });

  it('pins the graph-contract helper paths that exposed the real regression', () => {
    const source = 'afyx-graph/engine/src/graph/traversal.ts';
    const graph = host([
      ['afyx-graph/engine/__tests__/graph-contract/compute.ts', source],
      ['afyx-graph/engine/__tests__/graph-contract/compute-extra.ts', source],
      ['afyx-graph/engine/__tests__/graph-contract.test.ts', 'afyx-graph/engine/__tests__/graph-contract/compute.ts'],
      ['afyx-graph/engine/__tests__/graph-contract-extra.test.ts', 'afyx-graph/engine/__tests__/graph-contract/compute-extra.ts'],
    ]);

    const result = computeAffectedTests(graph, [source], { maxDepth: 5 });
    expect(result.affectedTests).toEqual(expect.arrayContaining([
      'afyx-graph/engine/__tests__/graph-contract.test.ts',
      'afyx-graph/engine/__tests__/graph-contract-extra.test.ts',
    ]));
  });
});
