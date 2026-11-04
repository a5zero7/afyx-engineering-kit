/**
 * Watcher Scope Classification
 *
 * Pure classification of a project-relative POSIX path against the watcher's
 * current scope: is it always-ignored (the tool's own data dir, `.git/`),
 * does it redefine scope itself (`afyx-graph.json`, `.gitignore`,
 * `.git/info/exclude`, a nested `.gitignore` inside current scope), is it in
 * scope for the ignore matcher, is it a source file the indexer would extract.
 *
 * No filesystem watching, timers, or pending-state here — this module only
 * answers "what kind of event is this", given the current `ScopeIgnore`
 * matcher. The matcher itself (`buildScopeIgnore`) and the source-file /
 * extension-override checks (`isSourceFile`, `loadExtensionOverrides`) are
 * Extraction's pure helpers, reused as-is (see Phase 3B.6's boundary note:
 * Sync must not reimplement Extraction's scope logic, only classify against
 * it).
 */

import { isSourceFile, type ScopeIgnore } from '../extraction';
import { loadExtensionOverrides, PROJECT_CONFIG_FILENAME } from '../project-config';
import { isAfyxGraphDataDir } from '../directory';

export type ScopeClassification =
  | { kind: 'always-ignored' }
  | { kind: 'scope-refresh' }
  | { kind: 'ignored-by-matcher' }
  | { kind: 'non-source'; existsCheck: true }
  | { kind: 'source-change' };

/** Our own data dir(s) and `.git/` are always ignored, regardless of `.gitignore`. */
export function isAlwaysIgnoredPath(rel: string): boolean {
  const top = rel.split('/')[0] ?? rel;
  return isAfyxGraphDataDir(top) || rel === '.git' || rel.startsWith('.git/');
}

/**
 * Classify a normalized, non-empty, in-tree relative path. Mirrors the exact
 * OLD precedence (frozen by the Phase 3B.6 characterization contract):
 *
 *  1. `.git/info/exclude` is let through for scope-refresh despite `.git/`
 *     otherwise being always-ignored (it feeds the scope matcher itself).
 *  2. everything else under an always-ignored path is dropped.
 *  3. the two root files the matcher is DERIVED from (`afyx-graph.json`,
 *     root `.gitignore`) are scope-refresh triggers even if some other rule
 *     would otherwise hide them.
 *  4. the ignore matcher itself.
 *  5. a NESTED `.gitignore` (checked after the matcher on purpose, so package
 *     `.gitignore`s under an already-ignored `node_modules/` never trigger a
 *     rebuild) is a scope-refresh trigger.
 *  6. non-source extensions fall to the caller's own "maybe a removed
 *     directory" handling.
 *  7. anything else is a real source-file change.
 */
export function classify(rel: string, ignoreMatcher: ScopeIgnore | null, projectRoot: string): ScopeClassification {
  if (rel === '.git/info/exclude') return { kind: 'scope-refresh' };
  if (isAlwaysIgnoredPath(rel)) return { kind: 'always-ignored' };
  if (rel === PROJECT_CONFIG_FILENAME || rel === '.gitignore') return { kind: 'scope-refresh' };
  if (ignoreMatcher && ignoreMatcher.ignores(rel)) return { kind: 'ignored-by-matcher' };
  if (rel.endsWith('/.gitignore')) return { kind: 'scope-refresh' };
  if (!isSourceFile(rel, loadExtensionOverrides(projectRoot))) return { kind: 'non-source', existsCheck: true };
  return { kind: 'source-change' };
}

/** True for a directory that should not be watched at all (Linux per-directory walk). */
export function shouldIgnoreDir(rel: string, ignoreMatcher: ScopeIgnore | null): boolean {
  if (!rel || rel === '.' || rel.startsWith('..')) return false; // root / outside
  if (isAlwaysIgnoredPath(rel)) return true;
  if (!ignoreMatcher) return false;
  return ignoreMatcher.ignores(rel + '/');
}
