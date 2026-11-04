/**
 * The file-level view of the graph: directory layout and file dependency cycles.
 */

import type { GraphCatalog } from './graph-store';

/** Files grouped by containing directory; a file with no directory part lives in `.`. */
export function directoryLayout(catalog: GraphCatalog): Map<string, string[]> {
  const layout = new Map<string, string[]>();
  for (const { path } of catalog.getAllFiles()) {
    const directory = path.split('/').slice(0, -1).join('/') || '.';
    const members = layout.get(directory);
    if (members) members.push(path);
    else layout.set(directory, [path]);
  }
  return layout;
}

interface DependencyFrame {
  file: string;
  dependencies: string[];
  cursor: number;
}

/**
 * Cycles among file dependencies.
 *
 * A depth-first search over `getDependencyFilePaths`, starting from each file in
 * catalogue order. Whenever a dependency is already on the current search path, the
 * slice of the path from that file down to the file that depends on it is one cycle.
 * Files are explored once, so a cycle is reported from the first file that reaches it.
 */
/** The one-hop file-dependents lookup a transitive walk needs, however it's obtained. */
export interface FileDependentsSource {
  getFileDependents(filePath: string): string[];
}

export interface FileDependentsWalkOptions {
  /** Hop count following file-dependency edges; a seed file itself is hop 0. */
  maxDepth: number;
  /**
   * A discovered file for which this returns true is recorded in `stopped` but not
   * expanded further — its own dependents are never visited. Generic on purpose: any
   * caller-supplied predicate works (test-file classification, a vendor/generated-path
   * check, or none at all to expand every discovered file up to `maxDepth`).
   */
  stopAt?: (filePath: string) => boolean;
}

export interface FileDependentsWalkResult {
  /** Every distinct file discovered as a (possibly transitive) dependent of any seed. */
  reached: Set<string>;
  /** The subset of `reached` — plus any seed itself — for which `stopAt` held. */
  stopped: Set<string>;
}

/**
 * Breadth-first walk over file-level dependents (one-hop lookups via `source.
 * getFileDependents`), from every file in `seeds`, one independent search per seed — a
 * dependent reachable from two different seeds is still recorded once (`reached`/
 * `stopped` are shared, deduping sets) but is walked again from each seed that reaches
 * it, since a seed's own reachable set is not known to be a subset of another seed's
 * until both are explored.
 *
 * Deterministic and cycle-safe: `visited` (per seed) guarantees a node is expanded at
 * most once, so cyclic file dependencies terminate instead of looping, and results
 * appear in strict BFS order (every hop-N file is discovered before any hop-N+1 file).
 * A file matching `stopAt` is recorded but never expanded past — a chain of two such
 * files only ever reports the first one reached.
 */
export function walkFileDependents(
  source: FileDependentsSource,
  seeds: string[],
  options: FileDependentsWalkOptions
): FileDependentsWalkResult {
  const { maxDepth, stopAt } = options;
  const reached = new Set<string>();
  const stopped = new Set<string>();

  for (const seed of seeds) {
    if (stopAt?.(seed)) {
      stopped.add(seed);
      continue;
    }

    const queue: Array<{ file: string; depth: number }> = [{ file: seed, depth: 0 }];
    const visited = new Set<string>([seed]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      for (const dep of source.getFileDependents(current.file)) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        reached.add(dep);

        if (stopAt?.(dep)) {
          stopped.add(dep);
        } else {
          queue.push({ file: dep, depth: current.depth + 1 });
        }
      }
    }
  }

  return { reached, stopped };
}

export function dependencyCycles(catalog: GraphCatalog): string[][] {
  const cycles: string[][] = [];
  const explored = new Set<string>();
  const trail: string[] = [];
  const onTrail = new Set<string>();
  const stack: DependencyFrame[] = [];

  const enter = (file: string): void => {
    explored.add(file);
    trail.push(file);
    onTrail.add(file);
    stack.push({ file, dependencies: catalog.getDependencyFilePaths(file), cursor: 0 });
  };

  for (const { path: root } of catalog.getAllFiles()) {
    if (explored.has(root)) continue;
    enter(root);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.cursor >= frame.dependencies.length) {
        onTrail.delete(frame.file);
        trail.pop();
        stack.pop();
        continue;
      }
      const dependency = frame.dependencies[frame.cursor++]!;
      if (onTrail.has(dependency)) {
        cycles.push(trail.slice(trail.indexOf(dependency)));
      } else if (!explored.has(dependency)) {
        enter(dependency);
      }
    }
  }
  return cycles;
}
