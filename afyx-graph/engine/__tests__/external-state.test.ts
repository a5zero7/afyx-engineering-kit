import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AfyxGraph } from '../src';
import {
  EXTERNAL_STATE_DIR_ENV,
  STATE_OWNER_FILE_NAME,
  getAfyxGraphDir,
  getDatabasePath,
} from '../src/directory';
import { getDaemonPidPath, getDaemonSocketCandidates } from '../src/mcp/daemon-paths';
import { deregisterDaemon, getRegistryDir, listDaemons, registerDaemon } from '../src/mcp/daemon-registry';
import { watchdogProgressPaths } from '../src/mcp';
import { resolveServerRoot } from '../src/directory';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    env: {
      ...process.env,
      AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1',
      AFYX_GRAPH_NO_DAEMON: '1',
      AFYX_GRAPH_NO_WATCH: '1',
      DO_NOT_TRACK: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function treeDigest(root: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      hash.update(relative + '\0');
      if (entry.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

describe('external Afyx Graph state', () => {
  const savedExternal = process.env[EXTERNAL_STATE_DIR_ENV];
  const savedLegacy = process.env.AFYX_GRAPH_DIR;
  let base: string;
  let source: string;
  let state: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-external-state-')));
    source = path.join(base, 'source');
    state = path.join(base, 'state');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'service.ts'), 'export function alpha(): number { return 1; }\n');
    process.env[EXTERNAL_STATE_DIR_ENV] = state;
    delete process.env.AFYX_GRAPH_DIR;
  });

  afterEach(() => {
    if (savedExternal === undefined) delete process.env[EXTERNAL_STATE_DIR_ENV];
    else process.env[EXTERNAL_STATE_DIR_ENV] = savedExternal;
    if (savedLegacy === undefined) delete process.env.AFYX_GRAPH_DIR;
    else process.env.AFYX_GRAPH_DIR = savedLegacy;
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('indexes and reopens with a byte-identical source tree and all state external', async () => {
    const before = treeDigest(source);
    const graph = await AfyxGraph.init(source, { index: true });
    try {
      expect(graph.searchNodes('alpha').length).toBeGreaterThan(0);
      expect(getAfyxGraphDir(source)).toBe(state);
      expect(fs.existsSync(getDatabasePath(source))).toBe(true);
      expect(fs.existsSync(path.join(state, STATE_OWNER_FILE_NAME))).toBe(true);
      expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
      expect(treeDigest(source)).toBe(before);
    } finally {
      graph.close();
    }

    const reopened = AfyxGraph.openSync(source);
    try {
      expect(reopened.searchNodes('alpha').length).toBeGreaterThan(0);
      expect(treeDigest(source)).toBe(before);
    } finally {
      reopened.close();
    }
  });

  it('supports sync and from-scratch recovery without moving state into the source', async () => {
    const graph = await AfyxGraph.init(source, { index: true });
    fs.writeFileSync(path.join(source, 'service.ts'), 'export function beta(): number { return 2; }\n');
    await graph.sync();
    expect(graph.searchNodes('beta').length).toBeGreaterThan(0);
    graph.close();

    const recovered = await AfyxGraph.recreate(source);
    try {
      await recovered.indexAll();
      expect(recovered.searchNodes('beta').length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
    } finally {
      recovered.close();
    }
  });

  it('keeps a watcher-disabled Git corpus and its hooks byte-identical across CLI init, repeat, installer init, and uninit', () => {
    const gitInit = spawnSync('git', ['init', '-q'], {
      cwd: source,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(gitInit.status, gitInit.stderr).toBe(0);

    const hooksResult = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: source,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(hooksResult.status, hooksResult.stderr).toBe(0);
    const hooksDir = path.resolve(source, hooksResult.stdout.trim());
    const sourceBeforeInit = treeDigest(source);
    const hooksBeforeInit = treeDigest(hooksDir);

    const first = runCli(['init', '--yes'], source);
    expect(first.status, first.stdout + first.stderr).toBe(0);
    expect(first.stdout).toContain('External-state mode does not modify source Git hooks');
    expect(treeDigest(source)).toBe(sourceBeforeInit);
    expect(treeDigest(hooksDir)).toBe(hooksBeforeInit);
    expect(fs.existsSync(path.join(state, 'afyx-graph.db'))).toBe(true);
    expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);

    const repeated = runCli(['init', '--yes'], source);
    expect(repeated.status, repeated.stdout + repeated.stderr).toBe(0);
    expect(repeated.stdout).toContain('Already initialized');
    expect(repeated.stdout).toContain('External-state mode does not modify source Git hooks');
    expect(treeDigest(source)).toBe(sourceBeforeInit);
    expect(treeDigest(hooksDir)).toBe(hooksBeforeInit);

    const installerInit = runCli(['install', '--yes', '--target', 'none', '--init'], source);
    expect(installerInit.status, installerInit.stdout + installerInit.stderr).toBe(0);
    expect(installerInit.stdout).toContain('Already initialized');
    expect(installerInit.stdout).toContain('External-state mode does not modify source Git hooks');
    expect(treeDigest(source)).toBe(sourceBeforeInit);
    expect(treeDigest(hooksDir)).toBe(hooksBeforeInit);

    // A pre-existing managed-looking hook must also survive external-state
    // uninit byte-for-byte; the command owns only the bound state directory.
    const sentinelHook = path.join(hooksDir, 'post-commit');
    fs.writeFileSync(
      sentinelHook,
      '#!/bin/sh\n# >>> afyx-graph sync hook >>>\necho keep-me\n# <<< afyx-graph sync hook <<<\n',
    );
    const sourceBeforeUninit = treeDigest(source);
    const hooksBeforeUninit = treeDigest(hooksDir);

    const uninit = runCli(['uninit', '--force'], source);
    expect(uninit.status, uninit.stdout + uninit.stderr).toBe(0);
    expect(treeDigest(source)).toBe(sourceBeforeUninit);
    expect(treeDigest(hooksDir)).toBe(hooksBeforeUninit);
    expect(fs.existsSync(state)).toBe(false);
    expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
  });

  it('binds one external state directory to exactly one canonical corpus', () => {
    const graph = AfyxGraph.initSync(source);
    graph.close();
    const other = path.join(base, 'other-source');
    fs.mkdirSync(other);

    expect(AfyxGraph.isInitialized(other)).toBe(false);
    expect(() => AfyxGraph.openSync(other)).toThrow(/not initialized/i);
    expect(() => AfyxGraph.initSync(other)).toThrow(/different project root/i);
    expect(fs.existsSync(path.join(other, '.afyx-graph'))).toBe(false);
  });

  it.each([
    ['relative', 'relative-state'],
    ['inside corpus', 'INSIDE'],
    ['corpus ancestor', 'ANCESTOR'],
  ])('fails closed for an unsafe %s path without falling back', (_name, configured) => {
    process.env[EXTERNAL_STATE_DIR_ENV] = configured === 'INSIDE'
      ? path.join(source, 'state')
      : configured === 'ANCESTOR'
        ? base
        : configured;

    expect(() => AfyxGraph.initSync(source)).toThrow(/absolute path|overlap/i);
    expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
  });

  it('rejects non-empty, unbound and corrupted external state', () => {
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'foreign.bin'), 'do-not-touch');
    expect(() => AfyxGraph.initSync(source)).toThrow(/non-empty.*binding/i);
    expect(fs.readFileSync(path.join(state, 'foreign.bin'), 'utf8')).toBe('do-not-touch');

    fs.rmSync(path.join(state, 'foreign.bin'));
    fs.writeFileSync(path.join(state, STATE_OWNER_FILE_NAME), '{not json');
    expect(() => AfyxGraph.initSync(source)).toThrow(/owner record is invalid/i);
    expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
  });

  it('fails closed when the destination cannot be created', () => {
    const blockingFile = path.join(base, 'not-a-directory');
    fs.writeFileSync(blockingFile, 'keep');
    process.env[EXTERNAL_STATE_DIR_ENV] = path.join(blockingFile, 'state');
    expect(() => AfyxGraph.initSync(source)).toThrow();
    expect(fs.readFileSync(blockingFile, 'utf8')).toBe('keep');
    expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
  });

  it('rejects an external-state symlink or junction when the platform permits creating one', () => {
    const target = path.join(base, 'state-target');
    fs.mkdirSync(target);
    try {
      fs.symlinkSync(target, state, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return; // creation itself is unavailable in this test environment
    }
    expect(() => AfyxGraph.initSync(source)).toThrow(/alias|reparse|symbolic link/i);
    expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
  });

  it('keeps daemon discovery and filesystem socket paths inside external state', () => {
    const graph = AfyxGraph.initSync(source);
    graph.close();
    expect(getRegistryDir()).toBe(path.join(state, 'daemons'));
    expect(getDaemonPidPath(source)).toBe(path.join(state, 'daemon.pid'));
    expect(watchdogProgressPaths(source).progressPaths).toEqual([
      path.join(state, 'afyx-graph.db'),
      path.join(state, 'afyx-graph.db-wal'),
    ]);
    if (process.platform !== 'win32') {
      expect(getDaemonSocketCandidates(source)).toEqual([path.join(state, 'daemon.sock')]);
    }

    registerDaemon({
      root: fs.realpathSync(source),
      pid: process.pid,
      version: 'test',
      socketPath: getDaemonSocketCandidates(source)[0]!,
      startedAt: 1,
    });
    expect(listDaemons({ prune: false })).toHaveLength(1);
    expect(fs.readdirSync(path.join(state, 'daemons'))).toHaveLength(1);
    deregisterDaemon(source);
    expect(listDaemons({ prune: false })).toEqual([]);
  });

  it('lets MCP root discovery resolve the corpus while state remains external', () => {
    fs.mkdirSync(path.join(source, 'nested'));
    const graph = AfyxGraph.initSync(source);
    graph.close();
    expect(resolveServerRoot(path.join(source, 'nested')).root).toBe(fs.realpathSync(source));
    expect(fs.existsSync(path.join(source, '.afyx-graph'))).toBe(false);
  });

  it('preserves AFYX_GRAPH_DIR behavior when external state is not configured', () => {
    delete process.env[EXTERNAL_STATE_DIR_ENV];
    process.env.AFYX_GRAPH_DIR = '.afyx-graph-win';
    const graph = AfyxGraph.initSync(source);
    try {
      expect(getAfyxGraphDir(source)).toBe(path.join(source, '.afyx-graph-win'));
      expect(fs.existsSync(path.join(source, '.afyx-graph-win', 'afyx-graph.db'))).toBe(true);
    } finally {
      graph.close();
    }
  });
});
