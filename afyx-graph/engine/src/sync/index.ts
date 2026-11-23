/**
 * AFYX Graph Engine - Synchronization Subsystem Entrypoint
 *
 * Coordinates file system change detection, debounced index synchronization,
 * platform watch policies (such as WSL/virtualized mount handling), Git hooks,
 * and multi-worktree index alignment.
 */

export { FileWatcher, type WatchOptions, type PendingFile, LockUnavailableError } from './watcher';
export { watchDisabledReason, detectWsl } from './watch-policy';

export {
  installGitSyncHook,
  removeGitSyncHook,
  isSyncHookInstalled,
  isGitRepo,
  DEFAULT_SYNC_HOOKS,
  type GitHookName,
  type GitHookResult,
} from './git-hooks';

export {
  gitWorktreeRoot,
  detectWorktreeIndexMismatch,
  worktreeMismatchWarning,
  worktreeMismatchNotice,
  type WorktreeIndexMismatch,
} from './worktree';
