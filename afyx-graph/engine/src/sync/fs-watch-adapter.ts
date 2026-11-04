/**
 * Filesystem Watch Adapter
 *
 * Owns raw `fs.watch` handles and nothing else: no debounce, no pending
 * state, no retry policy. Given a project root and a couple of callbacks, it
 * reports normalized project-relative path events and OS resource-exhaustion
 * conditions, using a per-platform strategy chosen to keep the open-
 * descriptor / kernel-watch cost BOUNDED rather than growing with the number
 * of files:
 *
 *   - macOS / Windows: a SINGLE recursive `fs.watch(root, {recursive:true})`.
 *     libuv maps this to one FSEvents stream (macOS) / one
 *     ReadDirectoryChangesW handle (Windows), so it costs O(1) descriptors no
 *     matter how large the tree. This is the fix for the macOS file-table
 *     exhaustion (#644 / #496 / #555 / #628): a per-file watcher held one
 *     open fd PER WATCHED FILE on macOS (tens of thousands of REG fds), which
 *     exhausted `kern.maxfiles` and crashed unrelated processes system-wide.
 *
 *   - Linux: recursive `fs.watch` is unsupported, so we watch each (non-
 *     ignored) DIRECTORY with one inotify watch — O(directories), NOT
 *     O(files). New directories are picked up dynamically and an overall
 *     watch cap bounds inotify usage on pathological monorepos (#579). A
 *     single inotify watch on a directory already reports create/modify/
 *     delete for its children, so per-file watches are never needed.
 *
 * No chokidar or other third-party watcher, and no native addon.
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizePath } from '../utils';
import { shouldIgnoreDir } from './watcher-scope';
import type { ScopeIgnore } from '../extraction';

/**
 * Upper bound on simultaneously-watched directories on the Linux per-directory
 * path. Each is one inotify watch; the kernel's `fs.inotify.max_user_watches`
 * is the hard limit (commonly 8k-128k). We stop adding watches past this and
 * log once — partial live-watch (with `afyx-graph sync` as the backstop) is far
 * better than exhausting the user's inotify budget and breaking watching
 * system-wide (#579). Tunable via AFYX_GRAPH_MAX_DIR_WATCHES.
 */
const DEFAULT_MAX_DIR_WATCHES = 50_000;

function maxDirWatches(): number {
  const raw = process.env.AFYX_GRAPH_MAX_DIR_WATCHES;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return DEFAULT_MAX_DIR_WATCHES;
}

/**
 * True when an error is OS watch/file-descriptor exhaustion (EMFILE/ENFILE).
 * Prefers the structured `err.code`; falls back to message matching ONLY when
 * no code is present (some platforms surface a bare Error from `fs.watch`).
 */
function isWatchResourceExhaustion(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  if (e?.code === 'EMFILE' || e?.code === 'ENFILE') return true;
  if (!e?.code && e?.message) {
    return /EMFILE|ENFILE|too many open files/i.test(e.message);
  }
  return false;
}

/**
 * True when an error is Linux inotify *watch-count* exhaustion. `fs.watch`
 * surfaces a hit `fs.inotify.max_user_watches` as ENOSPC ("no space" = no watch
 * descriptors left, NOT disk space). This only arises on the Linux
 * per-directory path; it is non-fatal (raise the limit and partial watching
 * keeps working), so it warns rather than degrading.
 */
function isInotifyWatchExhaustion(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOSPC';
}

/**
 * Native recursive `fs.watch` is only reliable on macOS and Windows; on Linux
 * (and AIX) it throws `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`. We branch on this
 * to pick the recursive vs per-directory strategy.
 */
export function supportsRecursiveWatch(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32';
}

/**
 * Indirection over `fs.watch` so tests can inject a fake that throws or emits
 * `EMFILE`/`ENFILE` deterministically (real watch-resource exhaustion can't be
 * provoked reliably, and `fs.watch` is a non-configurable property so it can't
 * be spied). Production always uses the real `fs.watch`.
 */
type WatchFn = typeof fs.watch;
let watchImpl: WatchFn = fs.watch;

/** @internal Test-only seam to inject a fake fs.watch implementation. */
export function setFsWatchImplForTests(fn: WatchFn | null): void {
  watchImpl = fn ?? fs.watch;
}

/** Close a watcher handle, swallowing "already closed" — the caller never needs to distinguish. */
function closeQuietly(watcher: fs.FSWatcher): void {
  try {
    watcher.close();
  } catch {
    /* already closed */
  }
}

export interface FsWatchAdapterCallbacks {
  /** A normalized, project-relative POSIX path saw a raw filesystem event (or was found pre-existing under a newly-appeared directory). */
  onPathEvent(rel: string): void;
  /** EMFILE/ENFILE: the whole watcher must degrade permanently. */
  onExhaustion(context: Record<string, unknown>): void;
  /** Linux ENOSPC: non-fatal, warn once, keep existing watches, stop adding new ones. */
  onInotifyLimitReached(context: Record<string, unknown>): void;
  /** The watcher's own directory-watch cap was hit (informational only). */
  onDirCapReached(cap: number): void;
  /** A non-exhaustion watcher error (e.g. the recursive watcher itself errored for an unrelated reason). */
  onWarn(message: string, context: Record<string, unknown>): void;
  /** Current scope matcher, consulted live so a mid-session scope refresh applies immediately. */
  getIgnoreMatcher(): ScopeIgnore | null;
}

export class FsWatchAdapter {
  private recursiveWatcher: fs.FSWatcher | null = null;
  private readonly dirWatchers = new Map<string, fs.FSWatcher>();
  private dirCapWarned = false;
  private inotifyLimitWarned = false;
  private stopped = false;

  constructor(
    private readonly projectRoot: string,
    private readonly callbacks: FsWatchAdapterCallbacks,
  ) {}

  get watchedDirCount(): number {
    return this.dirWatchers.size;
  }

  get isDegradedByInotifyLimit(): boolean {
    return this.inotifyLimitWarned;
  }

  /** Throws on setup failure (caller decides exhaustion vs quiet-stop handling). May instead call onExhaustion synchronously and return with nothing installed. */
  start(): void {
    this.stopped = false;
    this.dirCapWarned = false;
    this.inotifyLimitWarned = false;
    if (supportsRecursiveWatch()) {
      this.startRecursive();
    } else {
      this.startPerDirectory();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.recursiveWatcher) {
      closeQuietly(this.recursiveWatcher);
      this.recursiveWatcher = null;
    }
    for (const w of this.dirWatchers.values()) closeQuietly(w);
    this.dirWatchers.clear();
    this.dirCapWarned = false;
    this.inotifyLimitWarned = false;
  }

  get isActive(): boolean {
    return (this.recursiveWatcher !== null || this.dirWatchers.size > 0) && !this.stopped;
  }

  /**
   * macOS/Windows: one recursive watcher for the whole tree. O(1) descriptors.
   * `filename` arrives relative to the project root (with subdirectories), so
   * it maps straight to a project-relative path.
   */
  private startRecursive(): void {
    this.recursiveWatcher = watchImpl(
      this.projectRoot,
      { recursive: true, persistent: true },
      (_event, filename) => {
        if (this.stopped || filename == null) return;
        this.callbacks.onPathEvent(normalizePath(String(filename)));
      }
    );
    this.recursiveWatcher.on('error', (err: unknown) => {
      if (isWatchResourceExhaustion(err)) {
        this.callbacks.onExhaustion({ error: String(err) });
        return;
      }
      this.callbacks.onWarn('File watcher error', { error: String(err) });
    });
  }

  /**
   * Linux: walk the (non-ignored) tree and watch each directory. One inotify
   * watch per directory reports create/modify/delete for that directory's
   * direct children, so we never watch individual files.
   */
  private startPerDirectory(): void {
    this.watchTree(this.projectRoot, /* markExisting */ false);
  }

  /**
   * Add an inotify watch for `dir` and recurse into its non-ignored
   * subdirectories. When `markExisting` is true (a directory that appeared
   * AFTER startup), the source files already inside it are reported as
   * events — this closes the `mkdir + write` race where files created before
   * the new directory's watch is installed would otherwise be missed until
   * the next full sync. The initial startup walk passes false (the engine's
   * catch-up sync owns the baseline).
   */
  private watchTree(dir: string, markExisting: boolean): void {
    // A degrade mid-walk (exhaustion on an earlier directory) or the ENOSPC
    // latch means every further add would fail too — bail so recursion
    // unwinds without adding more watches.
    if (this.stopped || this.inotifyLimitWarned) return;
    if (this.dirWatchers.has(dir)) return;
    if (this.dirWatchers.size >= maxDirWatches()) {
      if (!this.dirCapWarned) {
        this.dirCapWarned = true;
        this.callbacks.onDirCapReached(maxDirWatches());
      }
      return;
    }

    let w: fs.FSWatcher;
    try {
      w = watchImpl(dir, { persistent: true }, (_event, filename) => this.handleDirEvent(dir, filename));
    } catch (err) {
      // EMFILE/ENFILE means the PROCESS is out of descriptors — every further
      // directory would fail too, so degrade the whole watcher rather than
      // limping along with a partial watch set.
      if (isWatchResourceExhaustion(err)) {
        this.callbacks.onExhaustion({ error: String(err), dir });
      } else if (isInotifyWatchExhaustion(err)) {
        this.warnInotifyLimit({ error: String(err), dir });
      }
      // ENOENT / EACCES on a single directory stays non-fatal: skip it quietly.
      return;
    }
    w.on('error', (err: unknown) => {
      if (isWatchResourceExhaustion(err)) {
        this.callbacks.onExhaustion({ error: String(err), dir });
        return;
      }
      if (isInotifyWatchExhaustion(err)) {
        this.warnInotifyLimit({ error: String(err), dir });
      }
      this.unwatchDir(dir);
    });
    this.dirWatchers.set(dir, w);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = normalizePath(path.relative(this.projectRoot, child));
        if (shouldIgnoreDir(rel, this.callbacks.getIgnoreMatcher())) continue;
        this.watchTree(child, markExisting);
      } else if (markExisting && entry.isFile()) {
        this.callbacks.onPathEvent(normalizePath(path.relative(this.projectRoot, child)));
      }
    }
  }

  /**
   * Linux per-directory event handler. `filename` is relative to `dir`. A new
   * sub-directory is picked up by extending the watch tree; everything else is
   * routed through the shared change callback.
   */
  private handleDirEvent(dir: string, filename: string | Buffer | null): void {
    if (this.stopped || filename == null) return;
    const full = path.join(dir, String(filename));

    // A newly-created directory needs its own watch (recursive isn't available
    // on Linux). statSync is cheap and these events are rare relative to file
    // edits. If the path vanished (rapid create/delete) the stat throws and we
    // fall through to the change callback, which no-ops on a non-source path.
    try {
      if (fs.statSync(full).isDirectory()) {
        const rel = normalizePath(path.relative(this.projectRoot, full));
        if (!shouldIgnoreDir(rel, this.callbacks.getIgnoreMatcher())) this.watchTree(full, /* markExisting */ true);
        return;
      }
    } catch {
      // deleted/inaccessible — treat as a normal change below
    }

    this.callbacks.onPathEvent(normalizePath(path.relative(this.projectRoot, full)));
  }

  /** Close and forget the watch for a directory that errored/was removed. */
  private unwatchDir(dir: string): void {
    const w = this.dirWatchers.get(dir);
    if (w) {
      closeQuietly(w);
      this.dirWatchers.delete(dir);
    }
  }

  private warnInotifyLimit(context: Record<string, unknown>): void {
    if (this.inotifyLimitWarned) return;
    this.inotifyLimitWarned = true;
    this.callbacks.onInotifyLimitReached({ watchedDirs: this.dirWatchers.size, ...context });
  }
}
