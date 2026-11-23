/**
 * AFYX Engineering Kit — Cross-Repository Dependency Graph
 *
 * Synthesizes deterministic, provenance-backed dependency relationships across
 * two or more independently rooted repositories within an authorized workspace.
 *
 * Design guarantees:
 * - Strict workspace authorization: unauthorized or external roots stay isolated.
 * - No false linking: identical package/symbol names without explicit dependency
 *   or import provenance never create cross-repo edges.
 * - Package-level declarations are distinguished from verified symbol-level links.
 * - Cycle-safe bounded traversal (A -> B -> C -> A terminates cleanly).
 * - Deterministic ordering and deduplication.
 * - Missing or ambiguous dependencies remain explicitly unresolved.
 */

import * as fs from 'fs';
import * as path from 'path';

export type CrossRepoEdgeKind =
  | 'package_dependency'
  | 'import_export'
  | 'symbol_reference'
  | 'api_schema_link';

export interface CrossRepoExportSymbol {
  name: string;
  filePath: string;
  kind?: string;
}

export interface CrossRepoImportRef {
  sourceFile: string;
  specifier: string;
  importedSymbols: string[];
  targetRepoId?: string;
}

export interface CrossRepoApiLink {
  sourceFile: string;
  endpointOrSchema: string;
  targetRepoId: string;
  targetFile: string;
  verifiedEvidence: boolean;
}

export interface AuthorizedRepoInput {
  repoId: string;
  rootPath: string;
  packageName?: string;
  declaredDependencies?: Record<string, string>;
  exportedSymbols?: CrossRepoExportSymbol[];
  imports?: CrossRepoImportRef[];
  apiLinks?: CrossRepoApiLink[];
}

export interface CrossRepoEdge {
  id: string;
  sourceRepoId: string;
  targetRepoId: string;
  kind: CrossRepoEdgeKind;
  sourceFile?: string;
  targetFile?: string;
  packageName?: string;
  symbolName?: string;
  provenance: {
    sourceRepoRoot: string;
    targetRepoRoot: string;
    declaredConstraint?: string;
    verifiedSymbol: boolean;
  };
}

export interface UnresolvedCrossRepoRef {
  sourceRepoId: string;
  specifier: string;
  symbolName?: string;
  sourceFile?: string;
  reason: 'missing_target' | 'ambiguous_target' | 'unauthorized_repo' | 'unverified_api_link';
}

export interface CrossRepoTraversalResult {
  startRepoId: string;
  reachableRepos: string[];
  edges: CrossRepoEdge[];
  cycleDetected: boolean;
  cyclePaths: string[][];
}

export interface CrossRepoDependencyGraph {
  repositories: ReadonlyMap<string, AuthorizedRepoInput>;
  edges: readonly CrossRepoEdge[];
  unresolved: readonly UnresolvedCrossRepoRef[];
  queryDependencies(repoId: string): CrossRepoEdge[];
  queryConsumers(repoId: string): CrossRepoEdge[];
  traverseDependencies(startRepoId: string, maxDepth?: number): CrossRepoTraversalResult;
}

const SKIP_DISCOVERY_DIRS = new Set([
  'node_modules',
  '.git',
  '.afyx-graph',
  'dist',
  'build',
  'out',
  'vendor',
  '.venv',
]);

/**
 * Normalize a filesystem path for deterministic provenance comparison.
 */
function normalizeRoot(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

/**
 * Safely read a repository's package.json metadata if present.
 */
export function readRepoPackageMetadata(rootPath: string): {
  packageName?: string;
  declaredDependencies: Record<string, string>;
} {
  const pkgPath = path.join(rootPath, 'package.json');
  try {
    if (!fs.existsSync(pkgPath)) {
      return { declaredDependencies: {} };
    }
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      name?: unknown;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
    };
    const declaredDependencies: Record<string, string> = {};
    for (const section of [parsed.dependencies, parsed.devDependencies, parsed.peerDependencies]) {
      if (!section || typeof section !== 'object') continue;
      for (const [dep, ver] of Object.entries(section)) {
        if (typeof ver === 'string' && !(dep in declaredDependencies)) {
          declaredDependencies[dep] = ver;
        }
      }
    }
    const packageName =
      typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined;
    return { packageName, declaredDependencies };
  } catch {
    return { declaredDependencies: {} };
  }
}

/**
 * Discover authorized repositories from an explicit allowlist of repository paths
 * inside a workspace root, ignoring vendor, ignored, or unauthorized directories.
 */
export function loadAuthorizedRepositories(
  workspaceRoot: string,
  authorizedRepoPaths: readonly string[],
): AuthorizedRepoInput[] {
  const normalizedWorkspace = normalizeRoot(workspaceRoot);
  const repos: AuthorizedRepoInput[] = [];
  const seenRoots = new Set<string>();

  for (const relOrAbs of authorizedRepoPaths) {
    const absPath = path.isAbsolute(relOrAbs)
      ? path.resolve(relOrAbs)
      : path.resolve(workspaceRoot, relOrAbs);
    const norm = normalizeRoot(absPath);

    // Ensure repository stays within workspace root and is not in a skipped dir
    if (norm !== normalizedWorkspace && !norm.startsWith(normalizedWorkspace + '/')) {
      continue;
    }
    const segments = norm.split('/');
    if (segments.some((s) => SKIP_DISCOVERY_DIRS.has(s))) {
      continue;
    }
    if (seenRoots.has(norm) || !fs.existsSync(absPath)) {
      continue;
    }
    seenRoots.add(norm);

    const meta = readRepoPackageMetadata(absPath);
    const repoId = path.basename(absPath) || norm;
    repos.push({
      repoId,
      rootPath: norm,
      packageName: meta.packageName,
      declaredDependencies: meta.declaredDependencies,
    });
  }

  return repos.sort((a, b) => a.repoId.localeCompare(b.repoId));
}

function makeEdgeId(edge: Omit<CrossRepoEdge, 'id'>): string {
  return [
    edge.kind,
    edge.sourceRepoId,
    edge.targetRepoId,
    edge.packageName ?? '',
    edge.symbolName ?? '',
    edge.sourceFile ?? '',
    edge.targetFile ?? '',
  ].join('|');
}

function extractPackageSpecifierRoot(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0] ?? specifier;
}

/**
 * Build a deterministic, provenance-backed cross-repository dependency graph.
 */
export function buildCrossRepoDependencyGraph(
  inputs: readonly AuthorizedRepoInput[],
): CrossRepoDependencyGraph {
  const repoMap = new Map<string, AuthorizedRepoInput>();
  const packageOwners = new Map<string, AuthorizedRepoInput[]>();

  // Deterministic ordering of inputs
  const sortedInputs = [...inputs].sort((a, b) => a.repoId.localeCompare(b.repoId));

  for (const raw of sortedInputs) {
    const normRoot = normalizeRoot(raw.rootPath);
    const meta = readRepoPackageMetadata(raw.rootPath);
    const repo: AuthorizedRepoInput = {
      ...raw,
      rootPath: normRoot,
      packageName: raw.packageName ?? meta.packageName,
      declaredDependencies: {
        ...meta.declaredDependencies,
        ...(raw.declaredDependencies ?? {}),
      },
      exportedSymbols: [...(raw.exportedSymbols ?? [])],
      imports: [...(raw.imports ?? [])],
      apiLinks: [...(raw.apiLinks ?? [])],
    };

    repoMap.set(repo.repoId, repo);

    if (repo.packageName) {
      const owners = packageOwners.get(repo.packageName) ?? [];
      owners.push(repo);
      packageOwners.set(repo.packageName, owners);
    }
  }

  const edgeMap = new Map<string, CrossRepoEdge>();
  const unresolvedList: UnresolvedCrossRepoRef[] = [];

  const addEdge = (draft: Omit<CrossRepoEdge, 'id'>) => {
    const id = makeEdgeId(draft);
    if (!edgeMap.has(id)) {
      edgeMap.set(id, { ...draft, id });
    }
  };

  for (const sourceRepo of sortedInputs) {
    const repo = repoMap.get(sourceRepo.repoId)!;
    const declaredDeps = repo.declaredDependencies ?? {};

    // 1. Package-level dependencies
    for (const [depName, constraint] of Object.entries(declaredDeps).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const owners = packageOwners.get(depName);
      if (!owners || owners.length === 0) {
        // External npm/third-party dependency not owned by workspace repos — do not fabricate
        continue;
      }
      if (owners.length > 1) {
        // Ambiguous package ownership across multiple repos — never guess
        unresolvedList.push({
          sourceRepoId: repo.repoId,
          specifier: depName,
          reason: 'ambiguous_target',
        });
        continue;
      }
      const targetRepo = owners[0]!;
      if (targetRepo.repoId === repo.repoId) continue;

      addEdge({
        sourceRepoId: repo.repoId,
        targetRepoId: targetRepo.repoId,
        kind: 'package_dependency',
        packageName: depName,
        provenance: {
          sourceRepoRoot: repo.rootPath,
          targetRepoRoot: targetRepo.rootPath,
          declaredConstraint: constraint,
          verifiedSymbol: false,
        },
      });
    }

    // 2. Import / export & verified symbol references
    for (const imp of repo.imports ?? []) {
      if (imp.specifier.startsWith('.') || imp.specifier.startsWith('/')) {
        continue; // Single-repo relative import
      }
      const pkgRoot = extractPackageSpecifierRoot(imp.specifier);

      // Determine authorized target repo
      let targetRepo: AuthorizedRepoInput | undefined;
      if (imp.targetRepoId) {
        targetRepo = repoMap.get(imp.targetRepoId);
        if (!targetRepo) {
          unresolvedList.push({
            sourceRepoId: repo.repoId,
            specifier: imp.specifier,
            sourceFile: imp.sourceFile,
            reason: 'unauthorized_repo',
          });
          continue;
        }
      } else {
        // Must have a declared dependency or unambiguous package owner
        const hasDeclaredDep = pkgRoot in declaredDeps;
        const owners = packageOwners.get(pkgRoot) ?? [];
        if (owners.length === 0) {
          unresolvedList.push({
            sourceRepoId: repo.repoId,
            specifier: imp.specifier,
            sourceFile: imp.sourceFile,
            reason: 'missing_target',
          });
          continue;
        }
        if (owners.length > 1 && !hasDeclaredDep) {
          unresolvedList.push({
            sourceRepoId: repo.repoId,
            specifier: imp.specifier,
            sourceFile: imp.sourceFile,
            reason: 'ambiguous_target',
          });
          continue;
        }
        if (owners.length > 1) {
          unresolvedList.push({
            sourceRepoId: repo.repoId,
            specifier: imp.specifier,
            sourceFile: imp.sourceFile,
            reason: 'ambiguous_target',
          });
          continue;
        }
        targetRepo = owners[0]!;
        // Prevent false linking when same package name exists without declared dependency
        if (!hasDeclaredDep) {
          unresolvedList.push({
            sourceRepoId: repo.repoId,
            specifier: imp.specifier,
            sourceFile: imp.sourceFile,
            reason: 'missing_target',
          });
          continue;
        }
      }

      if (targetRepo.repoId === repo.repoId) continue;

      // Record import_export edge
      addEdge({
        sourceRepoId: repo.repoId,
        targetRepoId: targetRepo.repoId,
        kind: 'import_export',
        sourceFile: imp.sourceFile,
        packageName: pkgRoot,
        provenance: {
          sourceRepoRoot: repo.rootPath,
          targetRepoRoot: targetRepo.rootPath,
          declaredConstraint: declaredDeps[pkgRoot],
          verifiedSymbol: false,
        },
      });

      // Verify exported symbols
      const exportedByName = new Map<string, CrossRepoExportSymbol[]>();
      for (const sym of targetRepo.exportedSymbols ?? []) {
        const list = exportedByName.get(sym.name) ?? [];
        list.push(sym);
        exportedByName.set(sym.name, list);
      }

      for (const symName of imp.importedSymbols) {
        const matches = exportedByName.get(symName);
        if (!matches || matches.length === 0) {
          unresolvedList.push({
            sourceRepoId: repo.repoId,
            specifier: imp.specifier,
            symbolName: symName,
            sourceFile: imp.sourceFile,
            reason: 'missing_target',
          });
          continue;
        }
        if (matches.length > 1) {
          unresolvedList.push({
            sourceRepoId: repo.repoId,
            specifier: imp.specifier,
            symbolName: symName,
            sourceFile: imp.sourceFile,
            reason: 'ambiguous_target',
          });
          continue;
        }
        const match = matches[0]!;
        addEdge({
          sourceRepoId: repo.repoId,
          targetRepoId: targetRepo.repoId,
          kind: 'symbol_reference',
          sourceFile: imp.sourceFile,
          targetFile: match.filePath,
          packageName: pkgRoot,
          symbolName: symName,
          provenance: {
            sourceRepoRoot: repo.rootPath,
            targetRepoRoot: targetRepo.rootPath,
            declaredConstraint: declaredDeps[pkgRoot],
            verifiedSymbol: true,
          },
        });
      }
    }

    // 3. Explicit API / Schema Links (only with verified evidence)
    for (const apiLink of repo.apiLinks ?? []) {
      const targetRepo = repoMap.get(apiLink.targetRepoId);
      if (!targetRepo) {
        unresolvedList.push({
          sourceRepoId: repo.repoId,
          specifier: apiLink.endpointOrSchema,
          sourceFile: apiLink.sourceFile,
          reason: 'unauthorized_repo',
        });
        continue;
      }
      if (!apiLink.verifiedEvidence) {
        unresolvedList.push({
          sourceRepoId: repo.repoId,
          specifier: apiLink.endpointOrSchema,
          sourceFile: apiLink.sourceFile,
          reason: 'unverified_api_link',
        });
        continue;
      }
      addEdge({
        sourceRepoId: repo.repoId,
        targetRepoId: targetRepo.repoId,
        kind: 'api_schema_link',
        sourceFile: apiLink.sourceFile,
        targetFile: apiLink.targetFile,
        symbolName: apiLink.endpointOrSchema,
        provenance: {
          sourceRepoRoot: repo.rootPath,
          targetRepoRoot: targetRepo.rootPath,
          verifiedSymbol: true,
        },
      });
    }
  }

  const edges = [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const unresolved = [...unresolvedList].sort((a, b) =>
    `${a.sourceRepoId}|${a.specifier}|${a.symbolName ?? ''}`.localeCompare(
      `${b.sourceRepoId}|${b.specifier}|${b.symbolName ?? ''}`,
    ),
  );

  const queryDependencies = (repoId: string): CrossRepoEdge[] =>
    edges.filter((e) => e.sourceRepoId === repoId);

  const queryConsumers = (repoId: string): CrossRepoEdge[] =>
    edges.filter((e) => e.targetRepoId === repoId);

  const traverseDependencies = (
    startRepoId: string,
    maxDepth = 16,
  ): CrossRepoTraversalResult => {
    const reachable = new Set<string>();
    const collectedEdges = new Map<string, CrossRepoEdge>();
    const cyclePaths: string[][] = [];
    let cycleDetected = false;

    const dfs = (currentId: string, depth: number, stack: string[]) => {
      if (depth >= maxDepth) return;
      const outEdges = queryDependencies(currentId);
      for (const edge of outEdges) {
        collectedEdges.set(edge.id, edge);
        const nextId = edge.targetRepoId;
        if (stack.includes(nextId)) {
          cycleDetected = true;
          const idx = stack.indexOf(nextId);
          cyclePaths.push([...stack.slice(idx), nextId]);
          continue;
        }
        if (!reachable.has(nextId)) {
          reachable.add(nextId);
          dfs(nextId, depth + 1, [...stack, nextId]);
        }
      }
    };

    if (repoMap.has(startRepoId)) {
      dfs(startRepoId, 0, [startRepoId]);
    }

    return {
      startRepoId,
      reachableRepos: [...reachable].sort(),
      edges: [...collectedEdges.values()].sort((a, b) => a.id.localeCompare(b.id)),
      cycleDetected,
      cyclePaths,
    };
  };

  return {
    repositories: repoMap,
    edges,
    unresolved,
    queryDependencies,
    queryConsumers,
    traverseDependencies,
  };
}
