/**
 * Transitive file-dependency impact: Impact's policy layer over Graph's own generic
 * file-dependents walk (`graph/file-graph.ts::walkFileDependents`) — this module owns no
 * traversal queue, visited set or depth propagation of its own; it only names the result
 * the way Impact/Affected callers expect (`allDependents`/`terminals` instead of Graph's
 * generic `reached`/`stopped`).
 */
import { walkFileDependents, type FileDependentsSource } from '../graph/file-graph';

export type FileImpactHost = FileDependentsSource;

export interface TransitiveFileImpactOptions {
  /** Hop count following file-dependency edges; a starting file itself is hop 0. */
  maxDepth: number;
  /**
   * A discovered file for which this returns true is recorded but not expanded further —
   * its own dependents are never visited. Omit to expand every discovered file up to
   * `maxDepth`.
   */
  isTerminal?: (filePath: string) => boolean;
}

export interface TransitiveFileImpactResult {
  /** Every distinct file discovered as a (possibly transitive) dependent of any start file. */
  allDependents: Set<string>;
  /** The subset of `allDependents` — plus any start file itself — for which `isTerminal` held. */
  terminals: Set<string>;
}

export function transitiveFileImpact(
  host: FileImpactHost,
  startFiles: string[],
  options: TransitiveFileImpactOptions
): TransitiveFileImpactResult {
  const { reached, stopped } = walkFileDependents(host, startFiles, {
    maxDepth: options.maxDepth,
    stopAt: options.isTerminal,
  });
  return { allDependents: reached, terminals: stopped };
}
