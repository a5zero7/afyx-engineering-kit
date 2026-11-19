import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  buildCrossRepoDependencyGraph,
  loadAuthorizedRepositories,
} from '../src/resolution/cross-repo';

describe('Cross-Repository Dependency Graph (B1.1 / AFYX-193)', () => {
  const tempDirs: string[] = [];

  function makeTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-cross-repo-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('1. resolves valid package, import/export, and symbol dependencies between two repositories', () => {
    const graph = buildCrossRepoDependencyGraph([
      {
        repoId: 'web-app',
        rootPath: '/ws/web-app',
        packageName: '@acme/web-app',
        declaredDependencies: { '@acme/core-lib': '^1.0.0' },
        imports: [
          {
            sourceFile: 'src/app.ts',
            specifier: '@acme/core-lib',
            importedSymbols: ['formatCurrency'],
          },
        ],
      },
      {
        repoId: 'core-lib',
        rootPath: '/ws/core-lib',
        packageName: '@acme/core-lib',
        exportedSymbols: [
          { name: 'formatCurrency', filePath: 'src/currency.ts', kind: 'function' },
        ],
      },
    ]);

    const deps = graph.queryDependencies('web-app');
    expect(deps.map((d) => d.kind)).toEqual([
      'import_export',
      'package_dependency',
      'symbol_reference',
    ]);
    const symEdge = deps.find((d) => d.kind === 'symbol_reference')!;
    expect(symEdge.targetRepoId).toBe('core-lib');
    expect(symEdge.targetFile).toBe('src/currency.ts');
    expect(symEdge.provenance.verifiedSymbol).toBe(true);
    expect(symEdge.provenance.declaredConstraint).toBe('^1.0.0');

    expect(graph.queryConsumers('core-lib')).toHaveLength(3);
    expect(graph.unresolved).toHaveLength(0);
  });

  it('2. traverses transitive dependencies across three repositories', () => {
    const graph = buildCrossRepoDependencyGraph([
      {
        repoId: 'frontend',
        rootPath: '/ws/frontend',
        packageName: '@acme/frontend',
        declaredDependencies: { '@acme/sdk': '^2.0.0' },
      },
      {
        repoId: 'sdk',
        rootPath: '/ws/sdk',
        packageName: '@acme/sdk',
        declaredDependencies: { '@acme/shared': '^1.2.0' },
      },
      {
        repoId: 'shared',
        rootPath: '/ws/shared',
        packageName: '@acme/shared',
      },
    ]);

    const traversal = graph.traverseDependencies('frontend');
    expect(traversal.reachableRepos).toEqual(['sdk', 'shared']);
    expect(traversal.cycleDetected).toBe(false);
    expect(traversal.edges).toHaveLength(2);
  });

  it('3. keeps unrelated or unauthorized repositories strictly isolated', () => {
    const ws = makeTempWorkspace();
    const repoA = path.join(ws, 'repo-a');
    const repoB = path.join(ws, 'repo-b');
    const vendorRepo = path.join(ws, 'vendor', 'secret-repo');
    const outsideRepo = makeTempWorkspace();

    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });
    fs.mkdirSync(vendorRepo, { recursive: true });

    fs.writeFileSync(
      path.join(repoA, 'package.json'),
      JSON.stringify({ name: '@acme/a', dependencies: { '@acme/outside': '1.0.0' } }),
    );
    fs.writeFileSync(
      path.join(repoB, 'package.json'),
      JSON.stringify({ name: '@acme/b' }),
    );
    fs.writeFileSync(
      path.join(vendorRepo, 'package.json'),
      JSON.stringify({ name: '@acme/vendor' }),
    );
    fs.writeFileSync(
      path.join(outsideRepo, 'package.json'),
      JSON.stringify({ name: '@acme/outside' }),
    );

    const discovered = loadAuthorizedRepositories(ws, [
      'repo-a',
      'repo-b',
      'vendor/secret-repo', // should be skipped because inside vendor/
      outsideRepo, // should be skipped because outside workspaceRoot
    ]);

    expect(discovered.map((r) => r.repoId)).toEqual(['repo-a', 'repo-b']);

    const graph = buildCrossRepoDependencyGraph(discovered);
    expect(graph.edges).toHaveLength(0);
    expect(graph.queryDependencies('repo-a')).toHaveLength(0);
  });

  it('4. prevents false linking when different repos share package/symbol names without dependency declaration', () => {
    const graph = buildCrossRepoDependencyGraph([
      {
        repoId: 'app-one',
        rootPath: '/ws/app-one',
        packageName: '@acme/app-one',
        // Does NOT declare @acme/utils in declaredDependencies!
        imports: [
          {
            sourceFile: 'src/index.ts',
            specifier: '@acme/utils',
            importedSymbols: ['helper'],
          },
        ],
      },
      {
        repoId: 'utils-repo',
        rootPath: '/ws/utils-repo',
        packageName: '@acme/utils',
        exportedSymbols: [{ name: 'helper', filePath: 'src/helper.ts' }],
      },
    ]);

    expect(graph.edges).toHaveLength(0);
    expect(graph.unresolved).toHaveLength(1);
    expect(graph.unresolved[0]?.reason).toBe('missing_target');
  });

  it('5. handles cyclic cross-repository dependencies safely with bounded traversal', () => {
    const graph = buildCrossRepoDependencyGraph([
      {
        repoId: 'repo-a',
        rootPath: '/ws/a',
        packageName: '@acme/a',
        declaredDependencies: { '@acme/b': '1.0.0' },
      },
      {
        repoId: 'repo-b',
        rootPath: '/ws/b',
        packageName: '@acme/b',
        declaredDependencies: { '@acme/c': '1.0.0' },
      },
      {
        repoId: 'repo-c',
        rootPath: '/ws/c',
        packageName: '@acme/c',
        declaredDependencies: { '@acme/a': '1.0.0' },
      },
    ]);

    const traversal = graph.traverseDependencies('repo-a');
    expect(traversal.cycleDetected).toBe(true);
    expect(traversal.cyclePaths).toEqual([['repo-a', 'repo-b', 'repo-c', 'repo-a']]);
    expect(traversal.reachableRepos).toEqual(['repo-b', 'repo-c']);
  });

  it('6. leaves missing or unverified API/schema links unresolved instead of fabricating edges', () => {
    const graph = buildCrossRepoDependencyGraph([
      {
        repoId: 'client',
        rootPath: '/ws/client',
        packageName: '@acme/client',
        declaredDependencies: { '@acme/server': '1.0.0' },
        imports: [
          {
            sourceFile: 'src/api.ts',
            specifier: '@acme/server',
            importedSymbols: ['nonExistentSymbol'],
          },
        ],
        apiLinks: [
          {
            sourceFile: 'src/api.ts',
            endpointOrSchema: '/v1/orders',
            targetRepoId: 'server',
            targetFile: 'src/routes/orders.ts',
            verifiedEvidence: false,
          },
          {
            sourceFile: 'src/api.ts',
            endpointOrSchema: '/v1/users',
            targetRepoId: 'server',
            targetFile: 'src/routes/users.ts',
            verifiedEvidence: true,
          },
        ],
      },
      {
        repoId: 'server',
        rootPath: '/ws/server',
        packageName: '@acme/server',
        exportedSymbols: [{ name: 'realHandler', filePath: 'src/handler.ts' }],
      },
    ]);

    // Only verified API link + package_dependency + import_export exist; unverified link & missing symbol stay unresolved
    const apiEdges = graph.edges.filter((e) => e.kind === 'api_schema_link');
    expect(apiEdges).toHaveLength(1);
    expect(apiEdges[0]?.symbolName).toBe('/v1/users');

    expect(graph.unresolved.map((u) => u.reason).sort()).toEqual([
      'missing_target',
      'unverified_api_link',
    ]);
  });

  it('7. preserves single-repository relative imports without creating spurious cross-repo edges', () => {
    const graph = buildCrossRepoDependencyGraph([
      {
        repoId: 'solo-repo',
        rootPath: '/ws/solo',
        packageName: '@acme/solo',
        imports: [
          {
            sourceFile: 'src/index.ts',
            specifier: './local-helper',
            importedSymbols: ['doWork'],
          },
        ],
      },
    ]);

    expect(graph.edges).toHaveLength(0);
    expect(graph.unresolved).toHaveLength(0);
  });

  it('8. produces identical deterministic output across repeated invocations', () => {
    const inputs = [
      {
        repoId: 'z-consumer',
        rootPath: '/ws/z',
        packageName: '@acme/z',
        declaredDependencies: { '@acme/a': '1.0.0' },
      },
      {
        repoId: 'a-provider',
        rootPath: '/ws/a',
        packageName: '@acme/a',
      },
    ];

    const run1 = buildCrossRepoDependencyGraph(inputs);
    const run2 = buildCrossRepoDependencyGraph([...inputs].reverse());

    expect(run1.edges).toEqual(run2.edges);
    expect(run1.unresolved).toEqual(run2.unresolved);
  });
});
