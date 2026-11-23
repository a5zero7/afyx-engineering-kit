/**
 * Index freshness — a cheap, read-only answer to "can I trust this index right now?".
 *
 * After every successful index/sync the engine records a tiny sidecar,
 * `<state-dir>/freshness.json`:
 *   { "schema_version": 1, "indexed_at": ISO-8601, "git_head": "<sha>"|null, "tracked_clean": true|false|null }
 *
 * `getFreshness` compares that record with the working tree using only local
 * git and never opens the database, so it is safe for doctors, status and
 * hooks.
 *
 *   MISSING  no database
 *   INVALID  database is not a SQLite file, or the sidecar is unreadable
 *   UNKNOWN  no sidecar yet, not a git working tree, or no recorded head
 *   STALE    HEAD moved, tracked files changed, or the index was built from uncommitted edits
 *   FRESH    same HEAD, clean tracked tree, and the index was built from a clean tree
 *
 * scripts/afyx-doctor.{ps1,sh} implement the same rules over the same file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getAfyxGraphDir, getDatabasePath } from './directory';

export type FreshnessState = 'MISSING' | 'FRESH' | 'STALE' | 'INVALID' | 'UNKNOWN';

export interface FreshnessReport {
  state: FreshnessState;
  detail: string;
}

export const FRESHNESS_FILE_NAME = 'freshness.json';
const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';
const SCHEMA_VERSION = 1;
const GIT_TIMEOUT_MS = 10_000;

interface FreshnessRecord {
  schema_version: number;
  indexed_at: string;
  git_head: string | null;
  tracked_clean: boolean | null;
}

function runGit(rootDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

function currentGitHead(rootDir: string): string | null {
  const out = runGit(rootDir, ['rev-parse', 'HEAD']);
  const trimmed = out?.trim();
  return trimmed || null;
}

/** True when no tracked file differs from HEAD; null when git cannot say. */
function isTrackedTreeClean(rootDir: string): boolean | null {
  const out = runGit(rootDir, ['status', '--porcelain', '--untracked-files=no']);
  return out === null ? null : out.trim().length === 0;
}

function isInsideGitTree(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, '.git'));
}

function freshnessSidecarPath(rootDir: string): string {
  return path.join(getAfyxGraphDir(rootDir), FRESHNESS_FILE_NAME);
}

function writeAtomically(targetPath: string, content: string): void {
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, targetPath);
}

/** Record what the index was just built from. Best effort: never throws, never fails an index. */
export function writeFreshness(rootDir: string): void {
  try {
    const afyxGraphDir = getAfyxGraphDir(rootDir);
    if (!fs.existsSync(afyxGraphDir)) return;

    const inGitTree = isInsideGitTree(rootDir);
    const record: FreshnessRecord = {
      schema_version: SCHEMA_VERSION,
      indexed_at: new Date().toISOString(),
      git_head: inGitTree ? currentGitHead(rootDir) : null,
      tracked_clean: inGitTree ? isTrackedTreeClean(rootDir) : null,
    };
    writeAtomically(freshnessSidecarPath(rootDir), JSON.stringify(record, null, 2) + '\n');
  } catch {
    /* freshness is advisory */
  }
}

function fileStartsWithSqliteHeader(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(SQLITE_HEADER_MAGIC.length);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    return bytesRead === header.length && header.toString('latin1') === SQLITE_HEADER_MAGIC;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function readSidecarRecord(sidecarPath: string): { record: Partial<FreshnessRecord> } | { error: FreshnessReport } {
  let raw: string;
  try {
    raw = fs.readFileSync(sidecarPath, 'utf-8');
  } catch {
    return { error: { state: 'UNKNOWN', detail: 'index metadata not recorded yet; run "afyx-graph sync"' } };
  }
  let parsed: Partial<FreshnessRecord>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: { state: 'INVALID', detail: 'freshness.json is not valid JSON' } };
  }
  if (!parsed || parsed.schema_version !== SCHEMA_VERSION) {
    return { error: { state: 'INVALID', detail: 'freshness.json has an unsupported schema' } };
  }
  return { record: parsed };
}

/** Read-only freshness verdict for a project root. */
export function getFreshness(rootDir: string): FreshnessReport {
  const dbPath = getDatabasePath(rootDir);
  if (!fs.existsSync(dbPath)) {
    return { state: 'MISSING', detail: 'no Afyx Graph database; run "afyx-graph init"' };
  }
  if (!fileStartsWithSqliteHeader(dbPath)) {
    return { state: 'INVALID', detail: 'database is not a SQLite file' };
  }

  const sidecarPath = freshnessSidecarPath(rootDir);
  if (!fs.existsSync(sidecarPath)) {
    return { state: 'UNKNOWN', detail: 'index metadata not recorded yet; run "afyx-graph sync"' };
  }
  const sidecar = readSidecarRecord(sidecarPath);
  if ('error' in sidecar) return sidecar.error;
  const meta = sidecar.record;

  if (!isInsideGitTree(rootDir)) {
    return { state: 'UNKNOWN', detail: 'not a git working tree; freshness cannot be proven cheaply' };
  }
  const recordedHead = typeof meta.git_head === 'string' ? meta.git_head : '';
  if (!recordedHead) return { state: 'UNKNOWN', detail: 'index metadata has no git head' };

  const currentHead = currentGitHead(rootDir);
  if (currentHead === null) return { state: 'UNKNOWN', detail: 'git could not report HEAD' };
  if (currentHead !== recordedHead) return { state: 'STALE', detail: 'git HEAD changed since the last index' };

  const treeIsCleanNow = isTrackedTreeClean(rootDir);
  if (treeIsCleanNow === null) return { state: 'UNKNOWN', detail: 'git could not report the working tree state' };
  if (!treeIsCleanNow) return { state: 'STALE', detail: 'tracked files changed since the last index' };
  if (meta.tracked_clean !== true) {
    return { state: 'STALE', detail: 'the index was built while tracked files had uncommitted changes' };
  }
  return { state: 'FRESH', detail: 'matches git HEAD with a clean tracked tree' };
}
