/**
 * Foundation Tests
 *
 * Tests for the Afyx Graph foundation layer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AfyxGraph } from '../src';
import { Node, Edge } from '../src/types';
import { isInitialized, getAfyxGraphDir, validateDirectory, afyxGraphDirName, isAfyxGraphDataDir } from '../src/directory';
import { DatabaseConnection, getDatabasePath, removeDatabaseFiles } from '../src/db';
import { CURRENT_SCHEMA_VERSION } from '../src/db/migrations';

// Create a temporary directory for each test
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-test-'));
}

// Clean up temporary directory
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Normalize a PRAGMA read across return shapes (array | object | scalar). */
function pragmaValue(raw: unknown, key: string): unknown {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (row !== null && typeof row === 'object') return (row as Record<string, unknown>)[key];
  return row;
}

describe('Afyx Graph Foundation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Initialization', () => {
    it('should initialize a new project', () => {
      const cg = AfyxGraph.initSync(tempDir);

      expect(AfyxGraph.isInitialized(tempDir)).toBe(true);
      expect(fs.existsSync(getAfyxGraphDir(tempDir))).toBe(true);
      expect(fs.existsSync(getDatabasePath(tempDir))).toBe(true);

      cg.close();
    });

    it('should create .gitignore in .Afyx Graph directory', () => {
      const cg = AfyxGraph.initSync(tempDir);

      const gitignorePath = path.join(getAfyxGraphDir(tempDir), '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      // Ignore everything in .afyx-graph/ except this file itself, so transient
      // files (db, daemon.pid, sockets, logs) never show up in git. (#492, #484)
      expect(content).toContain('*');
      expect(content).toContain('!.gitignore');

      cg.close();
    });

    it('should throw if already initialized', () => {
      const cg = AfyxGraph.initSync(tempDir);
      cg.close();

      expect(() => AfyxGraph.initSync(tempDir)).toThrow(/already initialized/i);
    });
  });

  describe('Opening Projects', () => {
    it('should open an existing project', () => {
      // First initialize
      const cg1 = AfyxGraph.initSync(tempDir);
      cg1.close();

      // Then open
      const cg2 = AfyxGraph.openSync(tempDir);
      expect(cg2.getProjectRoot()).toBe(path.resolve(tempDir));
      cg2.close();
    });

    it('should throw if not initialized', () => {
      expect(() => AfyxGraph.openSync(tempDir)).toThrow(/not initialized/i);
    });
  });

  describe('Static Methods', () => {
    it('isInitialized should return false for new directory', () => {
      expect(AfyxGraph.isInitialized(tempDir)).toBe(false);
    });

    it('isInitialized should return true after init', () => {
      const cg = AfyxGraph.initSync(tempDir);
      expect(AfyxGraph.isInitialized(tempDir)).toBe(true);
      cg.close();
    });
  });

  describe('Database', () => {
    it('should create database with correct schema', () => {
      const cg = AfyxGraph.initSync(tempDir);

      // Check that we can get stats (requires tables to exist)
      const stats = cg.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.fileCount).toBe(0);

      cg.close();
    });

    it('restores every secondary index after a crash inside bulk parse load (#1556)', () => {
      const dbPath = getDatabasePath(tempDir);
      const first = DatabaseConnection.initialize(dbPath);
      const before = (first.getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .all() as Array<{ name: string }>).map((r) => r.name);
      first.beginBulkParseLoad();
      first.close();

      const reopened = DatabaseConnection.open(dbPath);
      const after = (reopened.getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .all() as Array<{ name: string }>).map((r) => r.name);
      reopened.close();

      expect(after).toEqual(before);
    });

    it('skips secondary-index DDL when the schema is already healthy', () => {
      const dbPath = getDatabasePath(tempDir);
      const connection = DatabaseConnection.initialize(dbPath);
      const db = connection.getDb();
      const originalExec = db.exec.bind(db);
      let execCalls = 0;
      db.exec = (sql: string) => {
        execCalls++;
        originalExec(sql);
      };

      (connection as any).healBulkSecondaryIndexes();
      connection.close();

      expect(execCalls).toBe(0);
    });

    it('should return correct database size', () => {
      const cg = AfyxGraph.initSync(tempDir);
      const stats = cg.getStats();

      // Database should have some size (at least the schema)
      expect(stats.dbSizeBytes).toBeGreaterThan(0);

      cg.close();
    });

    it('should support optimize operation', () => {
      const cg = AfyxGraph.initSync(tempDir);

      // Should not throw
      expect(() => cg.optimize()).not.toThrow();

      cg.close();
    });

    it('should support clear operation', () => {
      const cg = AfyxGraph.initSync(tempDir);

      // Should not throw
      expect(() => cg.clear()).not.toThrow();

      const stats = cg.getStats();
      expect(stats.nodeCount).toBe(0);

      cg.close();
    });
  });

  // recreate() backs `afyx-graph index`: it discards the existing DB and returns
  // a fresh, empty instance rather than DELETE-clearing in place — the path that
  // recovers a poisoned/oversized prior index without wedging (#1067).
  describe('Recreate (#1067)', () => {
    it('returns a fresh, empty, usable instance', async () => {
      const cg = AfyxGraph.initSync(tempDir);
      // Give the DB some content so "empty afterwards" is meaningful.
      fs.writeFileSync(path.join(tempDir, 'a.ts'), 'export function f() { return 1; }\n');
      await cg.indexAll();
      expect(cg.getStats().nodeCount).toBeGreaterThan(0);
      cg.close();

      const fresh = await AfyxGraph.recreate(tempDir);
      try {
        // Empty graph, but a working instance: re-indexing repopulates it.
        expect(fresh.getStats().nodeCount).toBe(0);
        const result = await fresh.indexAll();
        expect(result.success).toBe(true);
        expect(fresh.getStats().nodeCount).toBeGreaterThan(0);
      } finally {
        fresh.close();
      }
    });

    it('discards the old database file rather than emptying it in place', async () => {
      const cg = AfyxGraph.initSync(tempDir);
      await cg.indexAll();
      cg.close();

      // Stamp a sentinel into the existing DB header. PRAGMA user_version is
      // untouched by DELETE, so an in-place clear() would preserve it — but a
      // from-scratch recreate cannot. (An inode-equality check is unreliable:
      // ext4/overlayfs recycle the inode number after unlink+recreate, so a
      // "new inode" assertion false-fails on Linux while passing on macOS.)
      const dbPath = getDatabasePath(tempDir);
      const stamp = DatabaseConnection.open(dbPath);
      stamp.getDb().pragma('user_version = 4242');
      stamp.close();

      const fresh = await AfyxGraph.recreate(tempDir);
      fresh.close();

      // The file exists, and the sentinel is gone — proof the old DB was
      // discarded and rebuilt, not row-DELETE'd in place (the path that wedged
      // on a poisoned graph, #1067).
      expect(fs.existsSync(dbPath)).toBe(true);
      const check = DatabaseConnection.open(dbPath);
      const userVersion = pragmaValue(check.getDb().pragma('user_version'), 'user_version');
      check.close();
      expect(Number(userVersion)).not.toBe(4242);
    });

    it('throws a clear error when the project is not initialized', async () => {
      await expect(AfyxGraph.recreate(tempDir)).rejects.toThrow(/not initialized/i);
    });
  });

  describe('removeDatabaseFiles (#1067)', () => {
    it('deletes the database and its -wal/-shm sidecars', () => {
      const cg = AfyxGraph.initSync(tempDir);
      cg.close();
      const dbPath = getDatabasePath(tempDir);
      // Materialise the WAL sidecars so we can prove they're cleaned up too.
      fs.writeFileSync(dbPath + '-wal', 'x');
      fs.writeFileSync(dbPath + '-shm', 'x');
      expect(fs.existsSync(dbPath)).toBe(true);

      removeDatabaseFiles(dbPath);

      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(dbPath + '-wal')).toBe(false);
      expect(fs.existsSync(dbPath + '-shm')).toBe(false);
    });

    it('is a no-op (does not throw) when the files are already gone', () => {
      const dbPath = getDatabasePath(tempDir);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(() => removeDatabaseFiles(dbPath)).not.toThrow();
    });
  });

  describe('Directory Management', () => {
    it('should validate directory structure', () => {
      const cg = AfyxGraph.initSync(tempDir);
      cg.close();

      const validation = validateDirectory(tempDir);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid directory', () => {
      const validation = validateDirectory(tempDir);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('upgrades a stale pre-wildcard .gitignore in place (issue #788)', () => {
      const cg = AfyxGraph.initSync(tempDir);
      cg.close();

      const gitignorePath = path.join(getAfyxGraphDir(tempDir), '.gitignore');
      // A .gitignore written by an older version (<= 0.9.9): an explicit
      // allowlist that never ignored daemon.pid, so the daemon's runtime
      // pidfile got committed.
      const staleV099 =
        '# Afyx Graph data files\n' +
        '# These are local to each machine and should not be committed\n\n' +
        '# Database\n*.db\n*.db-wal\n*.db-shm\n\n' +
        '# Cache\ncache/\n\n# Logs\n*.log\n\n# Hook markers\n.dirty\n';
      fs.writeFileSync(gitignorePath, staleV099, 'utf-8');

      // Opening the project runs validateDirectory, which self-heals.
      const cg2 = AfyxGraph.openSync(tempDir);
      cg2.close();

      const upgraded = fs.readFileSync(gitignorePath, 'utf-8');
      expect(upgraded).toContain('\n*\n'); // wildcard ignores everything…
      expect(upgraded).toContain('!.gitignore'); // …except this file
      expect(upgraded).not.toContain('.dirty'); // old explicit list is gone
    });

    it('leaves a user-customized .afyx-graph/.gitignore untouched', () => {
      const cg = AfyxGraph.initSync(tempDir);
      cg.close();

      const gitignorePath = path.join(getAfyxGraphDir(tempDir), '.gitignore');
      // No Afyx Graph header → user-authored → must not be rewritten.
      const custom = '# my own rules\n*.db\n!keep-this.json\n';
      fs.writeFileSync(gitignorePath, custom, 'utf-8');

      const cg2 = AfyxGraph.openSync(tempDir);
      cg2.close();

      expect(fs.readFileSync(gitignorePath, 'utf-8')).toBe(custom);
    });
  });

  describe('Uninitialize', () => {
    it('should remove .Afyx Graph directory', () => {
      const cg = AfyxGraph.initSync(tempDir);

      cg.uninitialize();

      expect(fs.existsSync(getAfyxGraphDir(tempDir))).toBe(false);
      expect(AfyxGraph.isInitialized(tempDir)).toBe(false);
    });
  });

  describe('Close/Destroy', () => {
    it('should close database but keep .Afyx Graph directory', () => {
      const cg = AfyxGraph.initSync(tempDir);

      cg.destroy(); // destroy is alias for close

      expect(fs.existsSync(getAfyxGraphDir(tempDir))).toBe(true);
      expect(AfyxGraph.isInitialized(tempDir)).toBe(true);
    });
  });

  describe('Graph Query Methods', () => {
    it('should throw "Node not found" for non-existent nodes', () => {
      const cg = AfyxGraph.initSync(tempDir);

      // getContext throws for non-existent nodes
      expect(() => cg.getContext('non-existent')).toThrow(/not found/i);

      cg.close();
    });

    it('should return empty results for non-existent nodes', () => {
      const cg = AfyxGraph.initSync(tempDir);

      // These methods return empty results instead of throwing
      const traverseResult = cg.traverse('non-existent');
      expect(traverseResult.nodes.size).toBe(0);

      const callGraph = cg.getCallGraph('non-existent');
      expect(callGraph.nodes.size).toBe(0);

      const typeHierarchy = cg.getTypeHierarchy('non-existent');
      expect(typeHierarchy.nodes.size).toBe(0);

      const usages = cg.findUsages('non-existent');
      expect(usages.length).toBe(0);

      cg.close();
    });

  });
});

describe('Database Connection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should initialize new database', () => {
    const dbPath = path.join(tempDir, 'test.db');
    const db = DatabaseConnection.initialize(dbPath);

    expect(db.isOpen()).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);

    db.close();
  });

  it('should get schema version', () => {
    const dbPath = path.join(tempDir, 'test.db');
    const db = DatabaseConnection.initialize(dbPath);

    const version = db.getSchemaVersion();
    expect(version).not.toBeNull();
    // A freshly initialized database records the current version outright
    // (schema.sql already contains every migration's end state).
    expect(version?.version).toBe(CURRENT_SCHEMA_VERSION);

    db.close();
  });

  it('should support transactions', () => {
    const dbPath = path.join(tempDir, 'test.db');
    const db = DatabaseConnection.initialize(dbPath);

    const result = db.transaction(() => {
      return 42;
    });

    expect(result).toBe(42);

    db.close();
  });

  it('should throw when opening non-existent database', () => {
    const dbPath = path.join(tempDir, 'nonexistent.db');

    expect(() => DatabaseConnection.open(dbPath)).toThrow(/not found/i);
  });
});

describe('Query Builder', () => {
  let tempDir: string;
  let cg: AfyxGraph;

  beforeEach(() => {
    tempDir = createTempDir();
    cg = AfyxGraph.initSync(tempDir);
  });

  afterEach(() => {
    cg.close();
    cleanupTempDir(tempDir);
  });

  it('should return null for non-existent node', () => {
    const node = cg.getNode('nonexistent');
    expect(node).toBeNull();
  });

  it('should return empty array for nodes in non-existent file', () => {
    const nodes = cg.getNodesInFile('nonexistent.ts');
    expect(nodes).toEqual([]);
  });

  it('should return empty array for edges from non-existent node', () => {
    const edges = cg.getOutgoingEdges('nonexistent');
    expect(edges).toEqual([]);
  });

  it('should return null for non-existent file', () => {
    const file = cg.getFile('nonexistent.ts');
    expect(file).toBeNull();
  });

  it('should return empty array for files when none tracked', () => {
    const files = cg.getFiles();
    expect(files).toEqual([]);
  });
});

// Two environments that share one working tree (Windows-native + WSL) must not
// share one `.afyx-graph/`. AFYX_GRAPH_DIR overrides the data directory name so
// each side keeps its own index in the same tree (issue #636).
describe('AFYX_GRAPH_DIR override (#636)', () => {
  const saved = process.env.AFYX_GRAPH_DIR;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-dirname-'));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AFYX_GRAPH_DIR;
    else process.env.AFYX_GRAPH_DIR = saved;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('afyxGraphDirName()', () => {
    it('defaults to .afyx-graph when unset', () => {
      delete process.env.AFYX_GRAPH_DIR;
      expect(afyxGraphDirName()).toBe('.afyx-graph');
    });

    it('honors a valid override', () => {
      process.env.AFYX_GRAPH_DIR = '.afyx-graph-win';
      expect(afyxGraphDirName()).toBe('.afyx-graph-win');
    });

    // Anything that isn't a plain segment could escape the project root or
    // clobber it, so it's ignored in favor of the default.
    it.each(['foo/bar', 'a\\b', '..', '../x', '.', '/abs/path', '   ', ''])(
      'falls back to .afyx-graph for invalid value %j',
      (bad) => {
        process.env.AFYX_GRAPH_DIR = bad;
        expect(afyxGraphDirName()).toBe('.afyx-graph');
      }
    );
  });

  describe('isAfyxGraphDataDir()', () => {
    it('matches the default, the active override, and .afyx-graph-* siblings', () => {
      process.env.AFYX_GRAPH_DIR = '.afyx-graph-win';
      expect(isAfyxGraphDataDir('.afyx-graph')).toBe(true);       // the other env's dir
      expect(isAfyxGraphDataDir('.afyx-graph-win')).toBe(true);   // active override
      expect(isAfyxGraphDataDir('.afyx-graph-wsl')).toBe(true);   // any sibling
    });

    it('does not match unrelated directories', () => {
      delete process.env.AFYX_GRAPH_DIR;
      for (const name of ['src', 'node_modules', '.git', 'afyx-graph', '.afyx-graphextra']) {
        expect(isAfyxGraphDataDir(name)).toBe(false);
      }
    });
  });

  it('init writes the index under the overridden directory, not .afyx-graph', () => {
    process.env.AFYX_GRAPH_DIR = '.afyx-graph-win';
    const cg = AfyxGraph.initSync(tempDir);
    try {
      expect(fs.existsSync(path.join(tempDir, '.afyx-graph-win', 'afyx-graph.db'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.afyx-graph'))).toBe(false);
      expect(getAfyxGraphDir(tempDir)).toBe(path.join(tempDir, '.afyx-graph-win'));
      expect(AfyxGraph.isInitialized(tempDir)).toBe(true);
    } finally {
      cg.close();
    }
  });

  it('two index dirs coexist in one tree and the override side skips the sibling', async () => {
    // WSL side: default `.afyx-graph`, with a source file.
    delete process.env.AFYX_GRAPH_DIR;
    fs.writeFileSync(path.join(tempDir, 'app.ts'), 'export function onlyReal() {}\n');
    const wsl = await AfyxGraph.init(tempDir, { index: true });
    wsl.close();

    // Windows side: override dir, same tree. Plant a decoy source file INSIDE
    // the WSL data dir — the override-side index must not pick it up.
    process.env.AFYX_GRAPH_DIR = '.afyx-graph-win';
    fs.writeFileSync(path.join(tempDir, '.afyx-graph', 'decoy.ts'), 'export function decoyLeak() {}\n');
    const win = await AfyxGraph.init(tempDir, { index: true });
    try {
      expect(fs.existsSync(path.join(tempDir, '.afyx-graph', 'afyx-graph.db'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.afyx-graph-win', 'afyx-graph.db'))).toBe(true);
      expect(win.searchNodes('onlyReal').length).toBeGreaterThan(0);
      expect(win.searchNodes('decoyLeak')).toEqual([]); // sibling data dir not indexed
    } finally {
      win.close();
    }
  });
});
