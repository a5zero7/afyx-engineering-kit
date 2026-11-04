/**
 * Git Worktree Awareness
 *
 * An Afyx Graph index lives in a `.afyx-graph/` directory and is resolved by
 * walking up parent directories to the nearest one. That walk is unaware of
 * git worktrees: when a worktree is created *inside* the main checkout (e.g.
 * some tools place them under `.gitignore`d paths like
 * `.claude/worktrees/<name>/`), a command run from the worktree walks up and
 * silently resolves the MAIN checkout's index.
 *
 * Every query then returns results from the main tree's code — usually a
 * different branch — rather than the worktree the user is actually editing.
 * Symbols added or changed only in the worktree are invisible. This module
 * detects that "borrowed index" situation so callers can warn about it.
 * Detection is best-effort: when git is unavailable or the path isn't a repo,
 * it reports "no mismatch" and callers carry on unchanged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** Bounded like every git call here: a daemon's main event loop would otherwise trip the 60s liveness watchdog (#1139). */
const GIT_CALL_TIMEOUT_MS = 5000;

function runGit(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: GIT_CALL_TIMEOUT_MS,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Resolve symlinks and Windows 8.3 aliases where possible so tmp/realpath quirks don't break equality. */
function resolveRealPath(candidate: string): string {
  try {
    const resolved = path.resolve(candidate);
    if (process.platform === 'win32' && typeof fs.realpathSync.native === 'function') {
      try {
        return fs.realpathSync.native(resolved);
      } catch {
        // best effort fallback
      }
    }
    return fs.realpathSync(resolved);
  } catch {
    return path.resolve(candidate);
  }
}

/**
 * Absolute, symlink-resolved toplevel of the git working tree that `dir`
 * belongs to, or null when `dir` isn't inside a git repo (or git is missing).
 * The main checkout and each linked worktree report their own distinct
 * directory, which is exactly the distinction this module relies on.
 */
export function gitWorktreeRoot(dir: string): string | null {
  const toplevel = runGit(dir, ['rev-parse', '--show-toplevel']);
  return toplevel ? resolveRealPath(toplevel) : null;
}

/**
 * Absolute, symlink-resolved git **common** directory for `dir` — the shared
 * `.git` that all worktrees of one repository point at. Linked worktrees of
 * the same repo report the SAME common dir; a submodule or embedded clone is
 * a DIFFERENT repository and reports its own. That distinction is what
 * separates a genuine "borrowed worktree" from a nested repo the parent
 * index already covers. Null when not a repo.
 */
export function gitCommonDir(dir: string): string | null {
  const commonDir = runGit(dir, ['rev-parse', '--git-common-dir']);
  if (!commonDir) return null;
  // `--git-common-dir` is relative to cwd unless already absolute.
  const absolute = path.isAbsolute(commonDir) ? commonDir : path.resolve(dir, commonDir);
  return resolveRealPath(absolute);
}

export interface WorktreeIndexMismatch {
  /** The git working tree the command was run from. */
  worktreeRoot: string;
  /** The (different) working tree whose `.afyx-graph` index is being used. */
  indexRoot: string;
}

/** Two repos share history but are distinguishable if their common dirs differ. */
function isDifferentRepository(worktreeRoot: string, indexRoot: string): boolean {
  const worktreeCommon = gitCommonDir(worktreeRoot);
  const indexCommon = gitCommonDir(indexRoot);
  return Boolean(worktreeCommon && indexCommon && worktreeCommon !== indexCommon);
}

/**
 * Detect when `startPath` lives in one git working tree but the resolved
 * Afyx Graph index (`indexRoot`) belongs to a *different* working tree.
 *
 * Returns null — nothing to warn about — when: `startPath` isn't in a git
 * repo (or git is unavailable); the index already lives in `startPath`'s own
 * working tree; `indexRoot` isn't itself a working-tree root (an unrelated
 * parent dir that merely happens to contain a `.afyx-graph/`), which keeps
 * non-git and monorepo-subdir layouts from producing false warnings; or the
 * two roots belong to a DIFFERENT repository (a submodule / embedded clone
 * the index already covers, #1031, #1033) — indexing a super-repo descends
 * into those, so the parent index's premise ("symbols here are missing") is
 * false there, and its advice would needlessly fragment the workspace index.
 */
export function detectWorktreeIndexMismatch(
  startPath: string,
  indexRoot: string,
): WorktreeIndexMismatch | null {
  const worktreeRoot = gitWorktreeRoot(startPath);
  if (!worktreeRoot) return null;

  const resolvedIndexRoot = resolveRealPath(indexRoot);
  if (worktreeRoot === resolvedIndexRoot) return null;
  if (gitWorktreeRoot(resolvedIndexRoot) !== resolvedIndexRoot) return null;
  if (isDifferentRepository(worktreeRoot, resolvedIndexRoot)) return null;

  return { worktreeRoot, indexRoot: resolvedIndexRoot };
}

/** One-line-per-fact warning describing a detected mismatch. */
export function worktreeMismatchWarning(mismatch: WorktreeIndexMismatch): string {
  return (
    `This Afyx Graph index belongs to a different git working tree.\n` +
    `  Running in: ${mismatch.worktreeRoot}\n` +
    `  Index from: ${mismatch.indexRoot}\n` +
    `Results reflect that tree's code (often a different branch), not this worktree — ` +
    `symbols changed only here are missing. Run "afyx-graph init -i" in this worktree ` +
    `for a worktree-local index.`
  );
}

/**
 * Compact, single-line variant for prefixing a tool's result. Read tools
 * return their answer inline, so the heads-up has to ride on the same
 * payload the agent is already reading — a multi-line block would bury it.
 */
export function worktreeMismatchNotice(mismatch: WorktreeIndexMismatch): string {
  return (
    `⚠ Afyx Graph results below come from a different git worktree (${mismatch.indexRoot}), ` +
    `not where you're working (${mismatch.worktreeRoot}) — they may reflect another branch, ` +
    `and symbols changed only here are missing. Run "afyx-graph init -i" here for a ` +
    `worktree-local index.`
  );
}
