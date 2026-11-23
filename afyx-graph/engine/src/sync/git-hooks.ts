/**
 * Git Sync Hooks
 *
 * When the live file watcher is disabled (e.g. WSL2 `/mnt/*` drives, see
 * watch-policy.ts), the index would otherwise go stale until the user runs
 * `afyx-graph sync` by hand. As an opt-in alternative, this installs git
 * hooks that refresh the index after the operations that change files on
 * disk: commit, merge (covers `git pull`), and checkout.
 *
 * The hooks run `afyx-graph sync` in the background so they never block git,
 * and are guarded by `command -v afyx-graph` so they no-op cleanly when the
 * CLI isn't on PATH. The snippet is delimited by marker comments so install
 * is idempotent and removal preserves any user-authored hook content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { usesExternalStateDir } from '../directory';

const HOOK_BLOCK_START = '# >>> afyx-graph sync hook >>>';
const HOOK_BLOCK_END = '# <<< afyx-graph sync hook <<<';

export type GitHookName = 'post-commit' | 'post-merge' | 'post-checkout';

/** Hooks installed by default: commit, merge (git pull), and checkout. */
export const DEFAULT_SYNC_HOOKS: readonly GitHookName[] = ['post-commit', 'post-merge', 'post-checkout'];

export interface GitHookResult {
  /** Hook names that were created or updated. */
  installed: GitHookName[];
  /** Resolved hooks directory, or null when not a git repo. */
  hooksDir: string | null;
  /** Reason nothing happened (e.g. not a git repository). */
  skipped?: string;
}

function runGit(projectRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 5000, // fail fast instead of hanging init/sync on a stuck git (#1139)
    }).trim();
  } catch {
    return null;
  }
}

/** Whether `projectRoot` is inside a git working tree. False if git isn't installed or the path isn't a repo. */
export function isGitRepo(projectRoot: string): boolean {
  return runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/** Resolve the git hooks directory, honoring `core.hooksPath` and worktrees. Null when not a repo. */
function resolveHooksDir(projectRoot: string): string | null {
  const out = runGit(projectRoot, ['rev-parse', '--git-path', 'hooks']);
  if (!out) return null;
  return path.isAbsolute(out) ? out : path.resolve(projectRoot, out);
}

function syncHookBody(): string {
  const lines = [
    HOOK_BLOCK_START,
    '# Keeps the Afyx Graph index fresh while the live file watcher is off',
    '# (e.g. WSL2 /mnt drives). Runs in the background so it never blocks git.',
    '# Managed by afyx-graph; remove with `afyx-graph uninit` or delete this block.',
    'if command -v afyx-graph >/dev/null 2>&1; then',
    '  ( afyx-graph sync >/dev/null 2>&1 & ) >/dev/null 2>&1',
    'fi',
    HOOK_BLOCK_END,
  ];
  return lines.join('\n');
}

/** Everything outside our marker block, with the block (and its marker lines) removed. */
function withoutSyncHookBlock(hookFileContent: string): string {
  const kept: string[] = [];
  let insideBlock = false;
  for (const rawLine of hookFileContent.split('\n')) {
    const line = rawLine.trim();
    if (line === HOOK_BLOCK_START) {
      insideBlock = true;
      continue;
    }
    if (line === HOOK_BLOCK_END) {
      insideBlock = false;
      continue;
    }
    if (!insideBlock) kept.push(rawLine);
  }
  return kept.join('\n');
}

/** Whether a hook body has no real content beyond a shebang / blank lines (i.e. only ever ours). */
function isOnlyShebangOrBlank(content: string): boolean {
  return content.split('\n').every((line) => {
    const trimmed = line.trim();
    return trimmed.length === 0 || trimmed.startsWith('#!');
  });
}

function makeExecutable(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    /* chmod is a no-op / unsupported on some platforms (e.g. Windows) */
  }
}

function readHookFileIfPresent(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

/**
 * Install (or update) the Afyx Graph sync hooks. Idempotent: re-running
 * replaces our marker block rather than duplicating it, and any user-authored
 * hook content is preserved.
 */
export function installGitSyncHook(
  projectRoot: string,
  hooks: readonly GitHookName[] = DEFAULT_SYNC_HOOKS,
): GitHookResult {
  if (usesExternalStateDir()) {
    return { installed: [], hooksDir: null, skipped: 'external-state mode does not modify source git hooks' };
  }
  const hooksDir = resolveHooksDir(projectRoot);
  if (!hooksDir) return { installed: [], hooksDir: null, skipped: 'not a git repository' };

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
  } catch {
    return { installed: [], hooksDir, skipped: 'could not access the git hooks directory' };
  }

  const block = syncHookBody();
  const installed: GitHookName[] = [];

  for (const hook of hooks) {
    const file = path.join(hooksDir, hook);
    const existing = readHookFileIfPresent(file);
    const userContent = existing !== null ? withoutSyncHookBlock(existing).replace(/\s*$/, '') : '';
    const content = userContent.length > 0 ? `${userContent}\n\n${block}\n` : `#!/bin/sh\n${block}\n`;

    fs.writeFileSync(file, content);
    makeExecutable(file);
    installed.push(hook);
  }

  return { installed, hooksDir };
}

/**
 * Remove the Afyx Graph sync hooks. Strips only the marker block; deletes the
 * hook file entirely when nothing but a shebang remains, otherwise rewrites
 * the user's content untouched.
 */
export function removeGitSyncHook(
  projectRoot: string,
  hooks: readonly GitHookName[] = DEFAULT_SYNC_HOOKS,
): GitHookResult {
  if (usesExternalStateDir()) {
    return { installed: [], hooksDir: null, skipped: 'external-state mode does not modify source git hooks' };
  }
  const hooksDir = resolveHooksDir(projectRoot);
  if (!hooksDir) return { installed: [], hooksDir: null, skipped: 'not a git repository' };

  const removed: GitHookName[] = [];

  for (const hook of hooks) {
    const file = path.join(hooksDir, hook);
    const original = readHookFileIfPresent(file);
    if (original === null || !original.includes(HOOK_BLOCK_START)) continue;

    const stripped = withoutSyncHookBlock(original);
    if (isOnlyShebangOrBlank(stripped)) {
      fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, `${stripped.replace(/\s*$/, '')}\n`);
      makeExecutable(file);
    }
    removed.push(hook);
  }

  return { installed: removed, hooksDir };
}

/** Whether any Afyx Graph sync hook is currently installed. */
export function isSyncHookInstalled(
  projectRoot: string,
  hooks: readonly GitHookName[] = DEFAULT_SYNC_HOOKS,
): boolean {
  const hooksDir = resolveHooksDir(projectRoot);
  if (!hooksDir) return false;
  return hooks.some((hook) => {
    const content = readHookFileIfPresent(path.join(hooksDir, hook));
    return content !== null && content.includes(HOOK_BLOCK_START);
  });
}
