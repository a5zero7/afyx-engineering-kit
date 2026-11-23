import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import AfyxGraph, { getFreshness } from '../src';
import { FRESHNESS_FILE_NAME } from '../src/freshness';
import { getAfyxGraphDir, getDatabasePath } from '../src/directory';

let root: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commitAll(message: string): void {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

async function indexProject(): Promise<void> {
  const cg = await AfyxGraph.init(root);
  await cg.indexAll();
  cg.close();
}

function sidecar(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(getAfyxGraphDir(root), FRESHNESS_FILE_NAME), 'utf8'));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-freshness-'));
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* Windows may hold handles briefly */ }
});

describe('index freshness', () => {
  it('is MISSING before any index exists', () => {
    expect(getFreshness(root).state).toBe('MISSING');
  });

  describe('in a git working tree', () => {
    beforeEach(() => {
      git('init', '-q');
      write('src/a.ts', 'export function a() { return 1; }\n');
      commitAll('init');
    });

    it('records the sidecar after a full index and reports FRESH', async () => {
      await indexProject();
      const record = sidecar();
      expect(record.schema_version).toBe(1);
      expect(record.git_head).toBe(git('rev-parse', 'HEAD'));
      expect(record.tracked_clean).toBe(true);
      expect(typeof record.indexed_at).toBe('string');
      expect(getFreshness(root)).toEqual({ state: 'FRESH', detail: 'matches git HEAD with a clean tracked tree' });
    });

    it('becomes STALE when a tracked file changes, and never modifies the index', async () => {
      await indexProject();
      const before = fs.statSync(getDatabasePath(root)).mtimeMs;
      write('src/a.ts', 'export function a() { return 2; }\n');
      expect(getFreshness(root).state).toBe('STALE');
      expect(fs.statSync(getDatabasePath(root)).mtimeMs).toBe(before);
    });

    it('becomes STALE when HEAD moves, and FRESH again after a sync', async () => {
      await indexProject();
      write('src/b.ts', 'export function b() { return 1; }\n');
      commitAll('add b');
      expect(getFreshness(root)).toEqual({ state: 'STALE', detail: 'git HEAD changed since the last index' });

      const cg = await AfyxGraph.open(root);
      await cg.sync();
      cg.close();
      expect(sidecar().git_head).toBe(git('rev-parse', 'HEAD'));
      expect(getFreshness(root).state).toBe('FRESH');
    }, 30_000);

    it('is STALE when the index was built from uncommitted tracked edits', async () => {
      write('src/a.ts', 'export function a() { return 3; }\n');
      await indexProject();
      expect(sidecar().tracked_clean).toBe(false);
      commitAll('commit the edit');
      // Clean tree and same HEAD is not enough: the sidecar was recorded from a dirty tree.
      const cg = await AfyxGraph.open(root);
      cg.close();
      expect(getFreshness(root).state).toBe('STALE');
    }, 30_000);

    it('is UNKNOWN when the sidecar has not been recorded, INVALID when it is unreadable', async () => {
      await indexProject();
      const meta = path.join(getAfyxGraphDir(root), FRESHNESS_FILE_NAME);
      fs.unlinkSync(meta);
      expect(getFreshness(root).state).toBe('UNKNOWN');
      fs.writeFileSync(meta, '{not json');
      expect(getFreshness(root).state).toBe('INVALID');
      fs.writeFileSync(meta, JSON.stringify({ schema_version: 99 }));
      expect(getFreshness(root).state).toBe('INVALID');
    });

    it('is INVALID when the database is not a SQLite file', async () => {
      await indexProject();
      fs.writeFileSync(getDatabasePath(root), 'definitely not sqlite');
      expect(getFreshness(root).state).toBe('INVALID');
    });
  });

  it('is UNKNOWN outside a git working tree (freshness cannot be proven cheaply)', async () => {
    write('src/a.ts', 'export function a() { return 1; }\n');
    await indexProject();
    expect(sidecar().git_head).toBeNull();
    expect(getFreshness(root).state).toBe('UNKNOWN');
  });
});
