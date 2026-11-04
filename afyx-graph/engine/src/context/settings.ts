/**
 * Option defaults for context requests.
 *
 * The defaults favour small answers: few entry points, shallow expansion, a handful
 * of short code blocks. Callers override individual fields; an explicitly passed
 * `undefined` replaces the default (spread semantics), which is how a caller asks
 * for the structured `TaskContext` instead of rendered text (`format: undefined`).
 */

import type { BuildContextOptions, FindRelevantContextOptions, NodeKind } from '../types';

export const BUILD_DEFAULTS: Required<BuildContextOptions> = {
  maxNodes: 20,
  maxCodeBlocks: 5,
  maxCodeBlockSize: 1500,
  includeCode: true,
  format: 'markdown',
  searchLimit: 3,
  traversalDepth: 1,
  minScore: 0.3,
};

/** Kinds that say how code works; imports and exports only say that something exists. */
export const HIGH_VALUE_KINDS: readonly NodeKind[] = [
  'function', 'method', 'class', 'interface', 'type_alias', 'struct', 'union', 'trait',
  'component', 'route', 'variable', 'constant', 'enum', 'module', 'namespace',
];

export const FIND_DEFAULTS: Required<FindRelevantContextOptions> = {
  searchLimit: 3,
  traversalDepth: 1,
  maxNodes: 20,
  minScore: 0.3,
  edgeKinds: [],
  nodeKinds: [...HIGH_VALUE_KINDS],
  seedNames: [],
};

export type FindSettings = Required<FindRelevantContextOptions>;
export type BuildSettings = Required<BuildContextOptions>;

export const resolveFindSettings = (options: FindRelevantContextOptions): FindSettings => ({ ...FIND_DEFAULTS, ...options });
export const resolveBuildSettings = (options: BuildContextOptions): BuildSettings => ({ ...BUILD_DEFAULTS, ...options });
