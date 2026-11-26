/**
 * Afyx Graph Utilities
 *
 * Common utility functions for memory management, concurrency, batching,
 * and security validation.
 *
 * @module utils
 *
 * @example
 * ```typescript
 * import { Mutex, processInBatches, MemoryMonitor, validatePathWithinRoot } from 'afyx-graph';
 *
 * // Use mutex for concurrent safety
 * const mutex = new Mutex();
 * await mutex.withLock(async () => {
 *   await performCriticalOperation();
 * });
 *
 * // Process items in batches to manage memory
 * const results = await processInBatches(items, 100, async (item) => {
 *   return await processItem(item);
 * });
 *
 * // Monitor memory usage
 * const monitor = new MemoryMonitor(512, (usage) => {
 *   console.warn(`Memory usage exceeded 512MB: ${usage / 1024 / 1024}MB`);
 * });
 * monitor.start();
 * ```
 */

import * as fs from 'fs';
import { randomBytes } from 'node:crypto';
import * as path from 'path';

// ============================================================
// SECURITY UTILITIES
// ============================================================

/**
 * Sensitive system directories that should never be used as project roots.
 * Checked on all platforms; non-applicable paths are harmlessly skipped.
 */
const SENSITIVE_PATHS = new Set([
  '/', '/etc', '/usr', '/bin', '/sbin', '/var', '/tmp', '/dev', '/proc', '/sys',
  '/root', '/boot', '/lib', '/lib64', '/opt',
  'c:\\', 'c:\\windows', 'c:\\windows\\system32',
]);

/**
 * Config "languages" whose nodes are pure key/value DATA lifted from a config
 * file (e.g. Spring `application.{yml,properties}`), not source code.
 */
export const CONFIG_LEAF_LANGUAGES: ReadonlySet<string> = new Set(['yaml', 'properties']);

/**
 * A config-leaf node is a single key lifted out of a pure config/data file —
 * `kind: 'constant'` in a {@link CONFIG_LEAF_LANGUAGES} language. Its on-disk
 * line is `key = <value>`, and that value is routinely a secret (DB password,
 * API key, JDBC URL with embedded creds). Afyx Graph must surface the KEY only
 * and never read/return the value, or it pushes secrets into agent context
 * unbidden — the value isn't needed for resolution, and an agent that genuinely
 * needs it can read the file directly. (#383)
 */
export function isConfigLeafNode(node: { kind: string; language?: string }): boolean {
  return node.kind === 'constant' && !!node.language && CONFIG_LEAF_LANGUAGES.has(node.language);
}

/**
 * Whether `child` is `parent` itself or sits underneath it. Case-insensitive on
 * Windows — NTFS is case-insensitive, and realpathSync can hand back a different
 * case than the lexical root, which would otherwise false-reject a valid file.
 */
export function isInsideRoot(parent: string, child: string): boolean {
  let c = child;
  let p = parent;
  if (process.platform === 'win32') {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  const relative = path.relative(p, c);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

/**
 * The lexical half of {@link validatePathWithinRoot}, on its own.
 *
 * Returns the resolved absolute path when `filePath` stays inside
 * `projectRoot` after `../` segments are applied, or null when it escapes.
 * No filesystem access — for callers on a hot path that only need to refuse a
 * lexical escape, and for which the realpath half would be both unnecessary
 * and far too expensive (the existence probe in resolution's `fileExists`,
 * #1631: two `realpathSync` calls per probe made it ~70x slower).
 *
 * This is NOT a substitute for `validatePathWithinRoot` on any path whose
 * contents get served — those must keep the symlink-aware check (#527).
 */
export function lexicalPathWithinRoot(projectRoot: string, filePath: string): string | null {
  const resolved = path.resolve(projectRoot, filePath);
  return isInsideRoot(path.resolve(projectRoot), resolved) ? resolved : null;
}

/** Mask common single-line secret assignments while retaining source positions. */
export function redactSourceLiterals(text: string): string {
  const assignment = /((?:\b|["\x27])(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key)["\x27]?\s*[:=]\s*)(["\x27])((?:\\[^\r\n]|(?!\2)[^\\\r\n])*)\2/gi;
  return text.replace(assignment, (_match, prefix: string, quote: string, value: string) =>
    prefix + quote + '*'.repeat(value.length) + quote);
}

/** Resolve a path and require its canonical existing ancestor to stay inside the root. */
export function validatePathWithinRoot(projectRoot: string, filePath: string): string | null {
  const resolved = lexicalPathWithinRoot(projectRoot, filePath);
  if (resolved === null) return null;

  try {
    const root = path.resolve(projectRoot);
    const realRoot = fs.realpathSync(root);
    let ancestor = resolved;
    const missing: string[] = [];
    while (true) {
      try {
        const candidate = path.join(fs.realpathSync(ancestor), ...missing);
        return isInsideRoot(realRoot, candidate) ? candidate : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || ancestor === root) return null;
        // A dangling symlink is different from a missing path component.
        if (fs.lstatSync(ancestor, { throwIfNoEntry: false })) return null;
        missing.unshift(path.basename(ancestor));
        ancestor = path.dirname(ancestor);
      }
    }
  } catch {
    return null;
  }
}

/**
 * Validate that a path is a safe project root directory.
 *
 * Rejects sensitive system directories and ensures the path is
 * a real, existing directory. Used at MCP and API entry points
 * to prevent arbitrary directory access.
 *
 * @param dirPath - The path to validate
 * @returns An error message if invalid, or null if valid
 */
export function validateProjectPath(dirPath: string): string | null {
  const resolved = path.resolve(dirPath);

  const homeDir = require('os').homedir();
  const privateRoots = ['.ssh', '.gnupg', '.aws', '.config', '.codex', '.claude', '.gemini', '.afyx', '.agents']
    .map((dir) => path.join(homeDir, dir));
  const windowsRoot = process.platform === 'win32' ? process.env.SystemRoot ?? 'C:\\Windows' : null;
  const blocked = (target: string) => {
    const normalized = process.platform === 'win32' ? target.toLowerCase() : target;
    if (SENSITIVE_PATHS.has(normalized) || (windowsRoot && isInsideRoot(windowsRoot, target))) {
      return 'Refusing to operate on sensitive system directory: ' + target;
    }
    return privateRoots.some((root) => isInsideRoot(root, target))
      ? 'Refusing to operate on sensitive directory: ' + target
      : null;
  };
  const lexicalDenial = blocked(resolved);
  if (lexicalDenial) return lexicalDenial;

  try {
    const canonical = fs.realpathSync(resolved);
    const canonicalDenial = blocked(canonical);
    if (canonicalDenial) return canonicalDenial;
    if (!fs.statSync(canonical).isDirectory()) return 'Path is not a directory: ' + resolved;
  } catch {
    return 'Path does not exist or is not accessible: ' + resolved;
  }

  return null;
}

/**
 * Safely parse JSON with a fallback value.
 * Prevents crashes from corrupted database metadata.
 */
export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Clamp a numeric value to a range.
 * Used to enforce sane limits on MCP tool inputs.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a file path to use forward slashes.
 * Fixes Windows backslash paths so glob matching works consistently.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Cross-process file lock using a lock file with PID tracking.
 *
 * Prevents multiple processes (e.g., git hooks, CLI, MCP server) from
 * writing to the same database simultaneously.
 */
export class FileLock {
  private lockPath: string;
  private owner: string | null = null;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  private readOwner(): string {
    const fd = fs.openSync(this.lockPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 128) throw new Error('Unsafe lock record');
      const buffer = Buffer.alloc(129);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (size !== stat.size) throw new Error('Lock record changed');
      return buffer.subarray(0, size).toString('utf8').trim();
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Acquire exclusively. Only confirmed dead owners are eligible for recovery. */
  acquire(): void {
    const owner = String(process.pid) + ' ' + randomBytes(16).toString('hex');
    const blocked = () => new Error('Afyx Graph database is locked by another process or has an unverified owner. Run afyx-graph unlock to inspect stale locks.');
    const create = () => {
      fs.writeFileSync(this.lockPath, owner, { flag: 'wx', mode: 0o600 });
      this.owner = owner;
    };
    try {
      create();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const claim = this.lockPath + '.recovery';
    let claimFd: number | undefined;
    try {
      claimFd = fs.openSync(claim, 'wx', 0o600);
      const before = this.readOwner();
      const match = /^([1-9][0-9]{0,9})(?: [a-f0-9]{32})?$/.exec(before);
      const pid = Number(match?.[1]);
      if (!match || pid > 0x7fffffff) throw blocked();
      try {
        process.kill(pid, 0);
        throw blocked();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw blocked();
      }
      if (this.readOwner() !== before) throw blocked();
      fs.unlinkSync(this.lockPath);
      create();
    } catch {
      throw blocked();
    } finally {
      if (claimFd !== undefined) {
        fs.closeSync(claimFd);
        fs.unlinkSync(claim);
      }
    }
  }

  /** Release only the receipt created by this instance. */
  release(): void {
    if (this.owner === null) return;
    try {
      if (this.readOwner() === this.owner) fs.unlinkSync(this.lockPath);
    } catch {
      // No matching regular lock remains to release.
    } finally {
      this.owner = null;
    }
  }

  /**
   * Execute a function while holding the lock
   */
  withLock<T>(fn: () => T): T {
    this.acquire();
    try {
      return fn();
    } finally {
      this.release();
    }
  }

  /**
   * Execute an async function while holding the lock
   */
  async withLockAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if a process is still running
   */

}

/**
 * Process items in batches to manage memory
 *
 * @param items - Array of items to process
 * @param batchSize - Number of items per batch
 * @param processor - Function to process each item
 * @param onBatchComplete - Optional callback after each batch
 * @returns Array of results
 */
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>,
  onBatchComplete?: (completed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));
    const batchResults = await Promise.all(
      batch.map((item, idx) => processor(item, i + idx))
    );
    results.push(...batchResults);

    if (onBatchComplete) {
      onBatchComplete(Math.min(i + batchSize, items.length), items.length);
    }

    // Allow GC between batches
    if (global.gc) {
      global.gc();
    }
  }

  return results;
}

/**
 * Simple mutex lock for preventing concurrent operations
 */
export class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * Acquire the lock
   *
   * @returns A release function to call when done
   */
  async acquire(): Promise<() => void> {
    while (this.locked) {
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    this.locked = true;

    return () => {
      this.locked = false;
      const next = this.waitQueue.shift();
      if (next) {
        next();
      }
    };
  }

  /**
   * Execute a function while holding the lock
   */
  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if the lock is currently held
   */
  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Chunked file reader for large files
 *
 * Reads a file in chunks to avoid loading entire file into memory.
 */
export async function* readFileInChunks(
  filePath: string,
  chunkSize: number = 64 * 1024
): AsyncGenerator<string, void, undefined> {
  const fs = await import('fs');

  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(chunkSize);

  try {
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
      yield buffer.toString('utf-8', 0, bytesRead);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Debounce a function
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle a function
 *
 * @param fn - Function to throttle
 * @param limit - Minimum time between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limit - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Estimate memory usage of an object (rough approximation)
 *
 * @param obj - Object to measure
 * @returns Approximate size in bytes
 */
export function estimateSize(obj: unknown): number {
  const seen = new WeakSet();

  function sizeOf(value: unknown): number {
    if (value === null || value === undefined) {
      return 0;
    }

    switch (typeof value) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return 2 * (value as string).length;
      case 'object':
        if (seen.has(value as object)) {
          return 0;
        }
        seen.add(value as object);

        if (Array.isArray(value)) {
          return value.reduce((acc: number, item) => acc + sizeOf(item), 0);
        }

        return Object.entries(value as object).reduce(
          (acc, [key, val]) => acc + sizeOf(key) + sizeOf(val),
          0
        );
      default:
        return 0;
    }
  }

  return sizeOf(obj);
}

/**
 * Memory monitor for tracking usage during operations
 */
export class MemoryMonitor {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private peakUsage = 0;
  private threshold: number;
  private onThresholdExceeded?: (usage: number) => void;

  constructor(
    thresholdMB: number = 500,
    onThresholdExceeded?: (usage: number) => void
  ) {
    this.threshold = thresholdMB * 1024 * 1024;
    this.onThresholdExceeded = onThresholdExceeded;
  }

  /**
   * Start monitoring memory usage
   */
  start(intervalMs: number = 1000): void {
    this.stop();
    this.peakUsage = 0;

    this.checkInterval = setInterval(() => {
      const usage = process.memoryUsage().heapUsed;
      if (usage > this.peakUsage) {
        this.peakUsage = usage;
      }
      if (usage > this.threshold && this.onThresholdExceeded) {
        this.onThresholdExceeded(usage);
      }
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get peak memory usage in bytes
   */
  getPeakUsage(): number {
    return this.peakUsage;
  }

  /**
   * Get current memory usage in bytes
   */
  getCurrentUsage(): number {
    return process.memoryUsage().heapUsed;
  }
}
