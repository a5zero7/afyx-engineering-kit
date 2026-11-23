/**
 * Tests for the CI/scripting fields `afyx-graph status --json` exposes (issue
 * #329): the `version`, `indexPath`, and `lastIndexed` fields, plus the
 * matching `AfyxGraph.getLastIndexedAt()` library method.
 *
 * The CLI itself is exercised end-to-end against the built binary so the JSON
 * field names survive future refactors of the underlying plumbing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AfyxGraph } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
).version as string;

function runStatusJson(cwd: string): Record<string, unknown> {
  const stdout = execFileSync(process.execPath, [BIN, 'status', '--json'], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // JSON mode prints exactly one line to stdout; be defensive about any stray
  // leading output by parsing the last non-empty line.
  const line = stdout.trim().split('\n').filter(Boolean).pop()!;
  return JSON.parse(line);
}

function runStatusText(cwd: string): string {
  return execFileSync(process.execPath, [BIN, 'status'], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('afyx-graph status --json — CI fields (#329)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-status-json-'));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('getLastIndexedAt() is null before indexing and a recent ms timestamp after', async () => {
    const cg = AfyxGraph.initSync(tempDir);
    expect(cg.getLastIndexedAt()).toBeNull();

    fs.writeFileSync(path.join(tempDir, 'a.ts'), 'export const x = 1;\n');
    const before = Date.now();
    await cg.indexAll();
    const after = Date.now();

    const last = cg.getLastIndexedAt();
    expect(last).not.toBeNull();
    expect(typeof last).toBe('number');
    expect(last!).toBeGreaterThanOrEqual(before - 1000);
    expect(last!).toBeLessThanOrEqual(after + 1000);
    cg.close();
  });

  it('status --json on an UNINITIALIZED project reports version + indexPath + lastIndexed:null', () => {
    const out = runStatusJson(tempDir);
    expect(out.initialized).toBe(false);
    expect(out.version).toBe(PKG_VERSION);
    expect(typeof out.indexPath).toBe('string');
    expect(out.indexPath as string).toContain('.afyx-graph');
    expect(out.lastIndexed).toBeNull();
  });

  it('status --json on an INDEXED project reports version + indexPath + a round-trippable lastIndexed', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.ts'), 'export const x = 1;\n');
    const before = Date.now();
    const cg = AfyxGraph.initSync(tempDir);
    await cg.indexAll();
    const after = Date.now();
    cg.close();

    const out = runStatusJson(tempDir);
    expect(out.initialized).toBe(true);
    expect(out.version).toBe(PKG_VERSION);
    expect(out.indexPath as string).toContain('.afyx-graph');
    expect(typeof out.lastIndexed).toBe('string');
    // ISO string that round-trips back into the index window.
    const ms = Date.parse(out.lastIndexed as string);
    expect(ms).toBeGreaterThanOrEqual(before - 1000);
    expect(ms).toBeLessThanOrEqual(after + 1000);
  });
});

describe('index completeness marker (index_state)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-index-state-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('a clean full index stamps state=complete with reconciled counts', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.ts'), 'export function f(): number { return 1; }\n');
    fs.writeFileSync(path.join(tempDir, 'b.ts'), 'import { f } from "./a";\nexport const y = f();\n');
    fs.writeFileSync(path.join(tempDir, 'notes.unsupported'), 'not source\n');
    const cg = AfyxGraph.initSync(tempDir);
    const result = await cg.indexAll();

    // The scan's ground truth is reported and fully accounted for.
    expect(result.filesDiscovered).toBeDefined();
    expect(result.filesIndexed + result.filesSkipped + result.filesErrored).toBe(
      result.filesDiscovered
    );
    expect(result.errors.filter((e) => e.code === 'index_partial')).toHaveLength(0);
    expect(cg.getIndexState()).toBe('complete');
    cg.close();

    const out = runStatusJson(tempDir);
    expect((out.index as Record<string, unknown>).state).toBe('complete');
    expect((out.index as any).accounting).toEqual({
      discovered: 3,
      eligible: 2,
      indexed: 2,
        metadataIndexed: 0,
        contentIndexed: 0,
        structurallyIndexed: 2,
      skipped: 0,
      unsupported: 1,
      failed: 0,
      ignored: null,
      retry: { attemptedFiles: 0, recoveredFiles: 0, failedFiles: 0 },
      skippedReasons: {},
      unsupportedExtensions: [{ ext: '.unsupported', count: 1 }],
      completedAt: expect.any(Number),
      timings: {
        scanMs: expect.any(Number),
        parseStoreMs: expect.any(Number),
        resolutionLinkMs: expect.any(Number),
        maintenanceMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    });
    expect((out.health as any).gitFreshness.state).toBe('UNKNOWN');
    expect((out.health as any).pendingChanges).toMatchObject({ state: 'CURRENT', count: 0, source: 'filesystem-scan' });
    expect((out.health as any).extraction.state).toBe('complete');
    expect((out.health as any).watcher.state).toBe('DISABLED');
  });

  it('persists aggregate size skip reasons without exposing skipped file paths', async () => {
    fs.writeFileSync(path.join(tempDir, 'small.ts'), 'export const ok = true;\n');
    fs.writeFileSync(path.join(tempDir, 'large.ts'), `export const tooLarge = "${'x'.repeat(1024 * 1024)}";\n`);
    const cg = AfyxGraph.initSync(tempDir);
    await cg.indexAll();
    const accounting = cg.getIndexAccounting();
    cg.close();

    expect(accounting).not.toBeNull();
    expect(accounting!.skipped).toBe(1);
    expect(accounting!.skippedReasons).toEqual({ size_exceeded: 1 });
    expect(JSON.stringify(accounting)).not.toContain('large.ts');

    const text = runStatusText(tempDir);
    expect(text).toContain('Index Health:');
    expect(text).toContain('Git snapshot:       UNKNOWN');
    expect(text).toContain('Filesystem/content: CURRENT (0 pending)');
    expect(text).toContain('Extraction:         COMPLETE');
    expect(text).toContain('Skipped reasons:    size_exceeded=1');
    expect(text).toContain('Last full timing:');
    expect(text).not.toContain('Index is up to date');
  });

  it('a run killed mid-index leaves state=indexing, and status --json surfaces it', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.ts'), 'export const x = 1;\n');
    const cg = AfyxGraph.initSync(tempDir);
    await cg.indexAll();
    cg.close();

    // Simulate a kill between the start-marker write and completion: the
    // marker a dead process leaves behind is exactly 'indexing'. Written
    // straight into the DB — the process that died can't have cleaned it up.
    // (require, not import: vite tries to bundle a dynamic import specifier.)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(tempDir, '.afyx-graph', 'afyx-graph.db'));
    db.prepare(
      "INSERT INTO project_metadata (key, value, updated_at) VALUES ('index_state', 'indexing', 0) " +
        "ON CONFLICT(key) DO UPDATE SET value = 'indexing'"
    ).run();
    db.close();

    const out = runStatusJson(tempDir);
    expect((out.index as Record<string, unknown>).state).toBe('indexing');

    const reopened = await AfyxGraph.open(tempDir);
    expect(reopened.getIndexState()).toBe('indexing');
    reopened.close();
  });
});
