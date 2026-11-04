import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Graph from '../src';
import { DATABASE_FILE_NAME, STATE_DIR_NAME } from '../src/product';
import { createDirectory, getDatabasePath, isInitialized } from '../src/directory';
import { getDatabasePath as dbModuleGetDatabasePath } from '../src/db';
import { watchdogProgressPaths } from '../src/mcp/index';

let root: string;
const savedDir = process.env.AFYX_GRAPH_DIR;

beforeEach(() => {
  delete process.env.AFYX_GRAPH_DIR;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-paths-'));
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.AFYX_GRAPH_DIR;
  else process.env.AFYX_GRAPH_DIR = savedDir;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('canonical Afyx Graph state paths', () => {
  it('pins the canonical identity constants', () => {
    expect(STATE_DIR_NAME).toBe('.afyx-graph');
    expect(DATABASE_FILE_NAME).toBe('afyx-graph.db');
  });

  it('resolves the database through one shared helper', () => {
    const expected = path.join(root, '.afyx-graph', 'afyx-graph.db');
    expect(getDatabasePath(root)).toBe(expected);
    expect(dbModuleGetDatabasePath(root)).toBe(expected);
  });

  it('points the MCP liveness watchdog at the canonical database and its WAL', () => {
    const { progressPaths } = watchdogProgressPaths(root);
    const db = path.join(root, '.afyx-graph', 'afyx-graph.db');
    expect(progressPaths).toEqual([db, `${db}-wal`]);
    expect(watchdogProgressPaths(null)).toEqual({});
  });

  it('follows the AFYX_GRAPH_DIR override in every consumer', () => {
    process.env.AFYX_GRAPH_DIR = '.afyx-graph-win';
    const db = path.join(root, '.afyx-graph-win', 'afyx-graph.db');
    expect(getDatabasePath(root)).toBe(db);
    expect(watchdogProgressPaths(root).progressPaths).toEqual([db, `${db}-wal`]);
  });
});

describe('init guard', () => {
  it('rejects a second init once the canonical database exists', () => {
    createDirectory(root);
    fs.writeFileSync(getDatabasePath(root), '');
    expect(isInitialized(root)).toBe(true);
    expect(() => createDirectory(root)).toThrow(/already initialized/i);
  });

  it('allows init when only the state directory exists', () => {
    fs.mkdirSync(path.join(root, '.afyx-graph'));
    expect(isInitialized(root)).toBe(false);
    expect(() => createDirectory(root)).not.toThrow();
  });

  it('ignores state directories it does not own: never adopted, never modified', () => {
    const foreign = path.join(root, '.foreign-state');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'index.db'), 'foreign-bytes');
    expect(isInitialized(root)).toBe(false);
    expect(() => createDirectory(root)).not.toThrow();
    expect(fs.readFileSync(path.join(foreign, 'index.db'), 'utf8')).toBe('foreign-bytes');
    expect(fs.readdirSync(foreign)).toEqual(['index.db']);
  });

  it('rejects re-initialising a real project and creates only the canonical database file', () => {
    const cg = Graph.initSync(root);
    cg.close();
    const stateDir = path.join(root, '.afyx-graph');
    expect(fs.existsSync(path.join(stateDir, 'afyx-graph.db'))).toBe(true);
    expect(fs.readdirSync(stateDir).filter((name) => name.endsWith('.db'))).toEqual(['afyx-graph.db']);
    expect(() => Graph.initSync(root)).toThrow(/already initialized/i);
  });
});
