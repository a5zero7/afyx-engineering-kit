/**
 * Atomic, race-free lockfile creation — shared by the daemon lock
 * (`daemon.pid`) and the writer lock (`writer.pid`), which both need exactly
 * the same primitive: "create this file, with this content already in place,
 * such that at most one of many racing candidates ever succeeds, and nobody
 * can ever observe a momentarily-empty file."
 *
 * must-fix 1 (issue #411 review): the lockfile must appear in ONE atomic step,
 * already complete — never empty, even momentarily. A naive `O_EXCL` create
 * followed by a separate `writeSync` leaves a microsecond window where the file
 * exists but is empty; under concurrent daemon startup a third candidate could
 * read that empty file, decode it as invalid, and `unlink` the winner's lock —
 * two daemons (two watchers, two writers) result. The window was normally too
 * small to hit, but real startup latency (e.g. the file watcher's own init
 * cost) widened it enough to reproduce reliably.
 *
 * The fix writes the complete content to a private temp file, then hard-links
 * it into place: `link()` is atomic AND exclusive (EEXIST if the target
 * exists), so the target becomes visible in one step already containing the
 * full content. Whoever links first wins; everyone else gets EEXIST.
 *
 * Filesystems without hard links (#997): ExFAT/FAT external volumes and some
 * network mounts can't `link()` at all — it throws ENOTSUP/EPERM, which would
 * otherwise kill lock acquisition entirely. There we fall back to an O_EXCL
 * create: still exclusive ("first writer wins"), but the content is written
 * through the fd in a second step, so the empty-file window the link approach
 * removed is reopened — only on these filesystems, only for the microseconds
 * between create and write (far narrower than the original bug).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AtomicAcquireResult {
  acquired: boolean;
  /** Raw bytes found at the target when a race was lost; null if unreadable. */
  existingContents: string | null;
}

/**
 * Exclusive-create `targetPath` (`O_CREAT|O_EXCL`) and write `content` through
 * the same fd — the hard-link-free fallback. Returns true if this call created
 * it (won the race), false on EEXIST (another candidate already holds it). Any
 * other error propagates. Still exclusive, so "first writer wins" holds
 * exactly as the link path does; the only difference is the brief empty-file
 * window between create and write.
 */
export function acquireExclusiveFile(targetPath: string, content: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(targetPath, 'wx', 0o600); // O_CREAT | O_EXCL | O_WRONLY
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

/**
 * Atomically create `targetPath` with `content` already in place. See module
 * doc for the link-then-O_EXCL-fallback strategy. On success, the caller owns
 * the lock; on failure, `existingContents` carries whatever is now at
 * `targetPath` (the winner's record) for the caller to inspect.
 */
export function acquireAtomicLockfile(targetPath: string, content: string): AtomicAcquireResult {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.${process.pid}.tmp`;
  let acquired = false;
  try {
    fs.writeFileSync(tempPath, content, { mode: 0o600 });
    try {
      fs.linkSync(tempPath, targetPath); // atomic + exclusive; see module doc
      acquired = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lost the race — another candidate already holds it. Fall through to read.
      } else {
        // link() failed for a non-conflict reason — nearly always "this
        // filesystem has no hard links" (surfaces as a DIFFERENT errno per OS:
        // ENOTSUP macOS, EPERM Linux, EISDIR Windows, #997). The `tempPath`
        // write above already proved this directory is writable, so an
        // O_EXCL create is a valid atomic+exclusive substitute.
        acquired = acquireExclusiveFile(targetPath, content);
      }
    }
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* temp already gone */ }
  }

  if (acquired) return { acquired: true, existingContents: null };

  let existingContents: string | null = null;
  try {
    existingContents = fs.readFileSync(targetPath, 'utf8');
  } catch { /* unreadable — treat as no usable record */ }
  return { acquired: false, existingContents };
}
