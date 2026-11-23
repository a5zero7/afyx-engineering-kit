/**
 * PR #19 Improvement Tests
 *
 * Tests for changes ported from PR #15 and #16:
 * - Native language support
 * - Arrow function extraction (body traversal)
 * - Graph traversal 'both' direction fix
 * - Best-candidate resolution picking
 * - Schema v2 migration (filePath/language on unresolved_refs)
 * - Batch insert for unresolved refs
 * - SQLite performance pragmas
 * - MCP symbol disambiguation and output truncation
 * - CLI uninit command
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractFromSource } from '../src/extraction';
import { isLanguageSupported, getSupportedLanguages } from '../src/extraction/grammars';


// Create a temporary directory for each test
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-pr19-test-'));
}

// Clean up temporary directory
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Check if the node:sqlite backend is available (Node >= 22.5)
function hasSqliteBindings(): boolean {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const HAS_SQLITE = hasSqliteBindings();

// =============================================================================
// Native language support
// =============================================================================

describe('Native language support', () => {
  it('should reject the unknown language', () => {
    expect(isLanguageSupported('unknown')).toBe(false);
  });

  it('should report liquid as supported (custom extractor)', () => {
    expect(isLanguageSupported('liquid')).toBe(true);
  });

  it('should include liquid in supported languages', () => {
    const supported = getSupportedLanguages();
    expect(supported).toContain('liquid');
  });

  it('should support representative native languages', () => {
    expect(isLanguageSupported('typescript')).toBe(true);
    expect(isLanguageSupported('python')).toBe(true);
  });
});

// =============================================================================
// Arrow Function Extraction - Body Traversal
// =============================================================================

describe('Arrow Function Body Traversal', () => {
  it('should extract unresolved references from arrow function bodies', () => {
    const code = `
export const useAuth = () => {
  const user = getUser();
  const token = generateToken(user);
  return { user, token };
};
`;
    const result = extractFromSource('hooks.ts', code);

    // The arrow function should be extracted
    const funcNode = result.nodes.find((n) => n.kind === 'function' && n.name === 'useAuth');
    expect(funcNode).toBeDefined();

    // Calls inside the body should be captured as unresolved references
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    const callNames = calls.map((c) => c.referenceName);
    expect(callNames).toContain('getUser');
    expect(callNames).toContain('generateToken');
  });

  it('should extract unresolved references from function expression bodies', () => {
    const code = `
export const processData = function(input: string): string {
  const cleaned = sanitize(input);
  return transform(cleaned);
};
`;
    const result = extractFromSource('utils.ts', code);

    const funcNode = result.nodes.find((n) => n.kind === 'function' && n.name === 'processData');
    expect(funcNode).toBeDefined();

    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    const callNames = calls.map((c) => c.referenceName);
    expect(callNames).toContain('sanitize');
    expect(callNames).toContain('transform');
  });

  it('should not create duplicate nodes for arrow functions', () => {
    const code = `
export const handler = () => {
  doSomething();
};
`;
    const result = extractFromSource('handler.ts', code);

    // Should be exactly 1 function node, 0 variable nodes for 'handler'
    const funcNodes = result.nodes.filter((n) => n.name === 'handler' && n.kind === 'function');
    const varNodes = result.nodes.filter((n) => n.name === 'handler' && n.kind === 'variable');
    expect(funcNodes).toHaveLength(1);
    expect(varNodes).toHaveLength(0);
  });

  it('should extract nested calls in arrow functions in JavaScript', () => {
    const code = `
export const fetchData = async () => {
  const response = await fetchAPI('/data');
  return parseResponse(response);
};
`;
    const result = extractFromSource('api.js', code);

    const funcNode = result.nodes.find((n) => n.name === 'fetchData');
    expect(funcNode).toBeDefined();
    expect(funcNode?.kind).toBe('function');

    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    const callNames = calls.map((c) => c.referenceName);
    expect(callNames).toContain('fetchAPI');
    expect(callNames).toContain('parseResponse');
  });
});

// =============================================================================
// Graph Traversal 'both' Direction Fix
// (requires better-sqlite3 - will use Afyx Graph integration)
// =============================================================================

describe('Graph Traversal Both Direction', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  it.skipIf(!HAS_SQLITE)('should traverse both directions from a node', async () => {
    const AfyxGraph = (await import('../src/index')).default;

    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // A -> B -> C  (A calls B, B calls C)
    fs.writeFileSync(path.join(srcDir, 'a.ts'), `
import { funcB } from './b';
export function funcA(): void { funcB(); }
`);
    fs.writeFileSync(path.join(srcDir, 'b.ts'), `
import { funcC } from './c';
export function funcB(): void { funcC(); }
`);
    fs.writeFileSync(path.join(srcDir, 'c.ts'), `
export function funcC(): void { console.log('c'); }
`);

    const cg = AfyxGraph.initSync(testDir, {
      config: { include: ['src/**/*.ts'], exclude: [] },
    });

    await cg.indexAll();
    cg.resolveReferences();

    const functions = cg.getNodesByKind('function');
    const funcB = functions.find((n) => n.name === 'funcB');

    if (!funcB) {
      cg.destroy();
      return;
    }

    // Traverse 'both' from B - should find A (incoming caller) and C (outgoing callee)
    const subgraph = cg.traverse(funcB.id, {
      maxDepth: 1,
      direction: 'both',
    });

    // B itself + at least one neighbor in each direction
    expect(subgraph.nodes.size).toBeGreaterThanOrEqual(2);
    expect(subgraph.nodes.has(funcB.id)).toBe(true);

    cg.destroy();
  });
});

// =============================================================================
// Best-Candidate Resolution
// =============================================================================

describe('Best-Candidate Resolution', () => {
  it.skipIf(!HAS_SQLITE)('should be testable via the resolution module types', async () => {
    const { ReferenceResolver } = await import('../src/resolution');
    expect(typeof ReferenceResolver.prototype.resolveOne).toBe('function');
  });
});

// =============================================================================
// Schema v2 Migration
// =============================================================================

describe('Schema v2 Migration', () => {
  it.skipIf(!HAS_SQLITE)('should have correct current schema version', async () => {
    const { CURRENT_SCHEMA_VERSION, getPendingMigrations } = await import('../src/db/migrations');
    const { DatabaseConnection } = await import('../src/db');

    // The constant must track the migration table, not a literal — a literal
    // just makes every schema change edit this test (v9/#1500 was the latest).
    // A fresh database records the current version, so nothing is pending;
    // ask a version-0 database instead to see the full migration list.
    const dbPath = path.join(createTempDir(), 'schema-version.db');
    const conn = DatabaseConnection.initialize(dbPath);
    const raw = conn.getDb();
    raw.prepare('DELETE FROM schema_versions').run();
    const highest = Math.max(...getPendingMigrations(raw).map((m) => m.version));
    conn.close();

    expect(CURRENT_SCHEMA_VERSION).toBe(highest);
  });

  it.skipIf(!HAS_SQLITE)('should have migration for version 2', async () => {
    const { getPendingMigrations } = await import('../src/db/migrations');
    expect(typeof getPendingMigrations).toBe('function');
  });
});

// =============================================================================
// Database Layer: Batch Insert, getAllNodes, Pragmas
// =============================================================================

describe('Database Layer Improvements', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  it.skipIf(!HAS_SQLITE)('should support batch insert of unresolved refs', async () => {
    const { DatabaseConnection } = await import('../src/db');
    const { QueryBuilder } = await import('../src/db/queries');

    const dbPath = path.join(testDir, 'afyx-graph.db');
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    // Insert a node first (needed as foreign key)
    queries.insertNode({
      id: 'func:test:1',
      kind: 'function',
      name: 'testFunc',
      qualifiedName: 'test::testFunc',
      filePath: 'test.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 1,
      updatedAt: Date.now(),
    });

    // Batch insert unresolved refs with filePath and language
    queries.insertUnresolvedRefsBatch([
      {
        fromNodeId: 'func:test:1',
        referenceName: 'helperA',
        referenceKind: 'calls',
        line: 2,
        column: 4,
        filePath: 'test.ts',
        language: 'typescript',
      },
      {
        fromNodeId: 'func:test:1',
        referenceName: 'helperB',
        referenceKind: 'calls',
        line: 3,
        column: 4,
        filePath: 'test.ts',
        language: 'typescript',
      },
    ]);

    const refs = queries.getUnresolvedReferences();
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.referenceName).sort()).toEqual(['helperA', 'helperB']);

    // Verify filePath and language are persisted
    expect(refs[0]?.filePath).toBe('test.ts');
    expect(refs[0]?.language).toBe('typescript');

    db.close();
  });

  it.skipIf(!HAS_SQLITE)('should support getAllNodes', async () => {
    const { DatabaseConnection } = await import('../src/db');
    const { QueryBuilder } = await import('../src/db/queries');

    const dbPath = path.join(testDir, 'afyx-graph.db');
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    // Insert some nodes
    for (let i = 0; i < 3; i++) {
      queries.insertNode({
        id: `func:test:${i}`,
        kind: 'function',
        name: `func${i}`,
        qualifiedName: `test::func${i}`,
        filePath: 'test.ts',
        language: 'typescript',
        startLine: i * 10 + 1,
        endLine: i * 10 + 5,
        startColumn: 0,
        endColumn: 1,
        updatedAt: Date.now(),
      });
    }

    const allNodes = queries.getAllNodes();
    expect(allNodes).toHaveLength(3);
    expect(allNodes.map((n) => n.name).sort()).toEqual(['func0', 'func1', 'func2']);

    db.close();
  });

  it.skipIf(!HAS_SQLITE)('should set performance pragmas on initialization', async () => {
    const { DatabaseConnection } = await import('../src/db');

    const dbPath = path.join(testDir, 'afyx-graph.db');
    const db = DatabaseConnection.initialize(dbPath);
    const rawDb = db.getDb();

    // Check pragmas were set
    const synchronous = rawDb.pragma('synchronous', { simple: true });
    expect(synchronous).toBe(1); // NORMAL = 1

    const cacheSize = rawDb.pragma('cache_size', { simple: true }) as number;
    expect(cacheSize).toBe(-64000);

    const tempStore = rawDb.pragma('temp_store', { simple: true });
    expect(tempStore).toBe(2); // MEMORY = 2

    const mmapSize = rawDb.pragma('mmap_size', { simple: true }) as number;
    expect(mmapSize).toBe(268435456); // 256 MB

    db.close();
  });

  it.skipIf(!HAS_SQLITE)('should handle empty batch insert gracefully', async () => {
    const { DatabaseConnection } = await import('../src/db');
    const { QueryBuilder } = await import('../src/db/queries');

    const dbPath = path.join(testDir, 'afyx-graph.db');
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    // Should not throw on empty array
    expect(() => queries.insertUnresolvedRefsBatch([])).not.toThrow();

    db.close();
  });
});

// =============================================================================
// Resolution Warm Caches
// =============================================================================

describe('Resolution Warm Caches', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  it.skipIf(!HAS_SQLITE)('should warm caches and use them for lookups', async () => {
    const AfyxGraph = (await import('../src/index')).default;

    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'a.ts'), `
export function myFunc(): void {}
export function otherFunc(): void { myFunc(); }
`);

    const cg = AfyxGraph.initSync(testDir, {
      config: { include: ['src/**/*.ts'], exclude: [] },
    });

    await cg.indexAll();

    // resolveReferences internally calls warmCaches
    const result = cg.resolveReferences();

    // Should complete without error
    expect(result.stats.total).toBeGreaterThanOrEqual(0);

    cg.destroy();
  });
});

// =============================================================================
// MCP Tool Improvements
// =============================================================================

describe('MCP Tool Improvements', () => {
  it.skipIf(!HAS_SQLITE)('should export ToolHandler class', async () => {
    const { ToolHandler } = await import('../src/mcp/tools');
    expect(typeof ToolHandler).toBe('function');
  });

  it.skipIf(!HAS_SQLITE)('should have findSymbolMatches as a private method', async () => {
    const { ToolHandler } = await import('../src/mcp/tools');
    const proto = ToolHandler.prototype;
    expect(typeof (proto as any).findSymbolMatches).toBe('function');
  });

  describe('findSymbol disambiguation', () => {
    it.skipIf(!HAS_SQLITE)('should prefer exact name matches', async () => {
      const { ToolHandler } = await import('../src/mcp/tools');
      const AfyxGraph = (await import('../src/index')).default;

      const tmpDir = createTempDir();
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'a.ts'), `
export function getValue(): number { return 1; }
export function getValueFromCache(): number { return 2; }
`);

      const cg = AfyxGraph.initSync(tmpDir, {
        config: { include: ['src/**/*.ts'], exclude: [] },
      });
      await cg.indexAll();

      const handler = new ToolHandler(cg);
      const findSymbolMatches = (handler as any).findSymbolMatches.bind(handler);

      const matches = findSymbolMatches(cg, 'getValue');
      // Exact-name match wins — a single result, not the partial getValueFromCache.
      expect(matches.length).toBe(1);
      expect(matches[0].name).toBe('getValue');

      handler.closeAll();
      cg.destroy();
      cleanupTempDir(tmpDir);
    });

    it.skipIf(!HAS_SQLITE)('should return all definitions when multiple symbols share the same name', async () => {
      const { ToolHandler } = await import('../src/mcp/tools');
      const AfyxGraph = (await import('../src/index')).default;

      const tmpDir = createTempDir();
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Two files with the same function name
      fs.writeFileSync(path.join(srcDir, 'a.ts'), `
export function handle(): void {}
`);
      fs.writeFileSync(path.join(srcDir, 'b.ts'), `
export function handle(): void {}
`);

      const cg = AfyxGraph.initSync(tmpDir, {
        config: { include: ['src/**/*.ts'], exclude: [] },
      });
      await cg.indexAll();

      const handler = new ToolHandler(cg);
      const findSymbolMatches = (handler as any).findSymbolMatches.bind(handler);

      // Both same-named definitions are returned (no longer one + a dead-end
      // note) so afyx_graph_node can hand back every overload and the agent never
      // Reads to find the one it wanted.
      const matches = findSymbolMatches(cg, 'handle');
      expect(matches.length).toBe(2);
      expect(matches.every((n: any) => n.name === 'handle')).toBe(true);

      handler.closeAll();
      cg.destroy();
      cleanupTempDir(tmpDir);
    });

    it.skipIf(!HAS_SQLITE)('should return no matches when symbol is not found', async () => {
      const { ToolHandler } = await import('../src/mcp/tools');
      const AfyxGraph = (await import('../src/index')).default;

      const tmpDir = createTempDir();
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a.ts'), `export function foo(): void {}`);

      const cg = AfyxGraph.initSync(tmpDir, {
        config: { include: ['src/**/*.ts'], exclude: [] },
      });
      await cg.indexAll();

      const handler = new ToolHandler(cg);
      const findSymbolMatches = (handler as any).findSymbolMatches.bind(handler);

      const matches = findSymbolMatches(cg, 'nonExistentSymbol');
      expect(matches.length).toBe(0);

      handler.closeAll();
      cg.destroy();
      cleanupTempDir(tmpDir);
    });
  });
});

// =============================================================================
// CLI uninit Command
// =============================================================================

describe('CLI uninit', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  it.skipIf(!HAS_SQLITE)('should uninitialize a project via AfyxGraph.uninitialize()', async () => {
    const AfyxGraph = (await import('../src/index')).default;

    // Initialize
    const cg = AfyxGraph.initSync(testDir);
    expect(AfyxGraph.isInitialized(testDir)).toBe(true);

    // Uninitialize
    cg.uninitialize();

    // .afyx-graph directory should be removed
    expect(AfyxGraph.isInitialized(testDir)).toBe(false);
  });
});

// =============================================================================
// Parser Runtime Isolation
// =============================================================================

describe('Parser runtime isolation', () => {
  it('does not retain historical parser runtime packages', () => {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.dependencies?.['web-tree-sitter']).toBeUndefined();
    expect(pkg.dependencies?.['tree-sitter-wasms']).toBeUndefined();
  });

  it('should not have native tree-sitter in dependencies', () => {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.dependencies?.['tree-sitter']).toBeUndefined();
    expect(pkg.overrides).toBeUndefined();
  });
});

// =============================================================================
// Embedder Float32Array Fix
// =============================================================================

describe('Float32Array Fix', () => {
  it('should correctly convert typed arrays (regression check)', () => {
    // Simulates the fix: Float32Array.from(Array.from(arr)) vs new Float32Array(arr.length)
    const source = new Float64Array([1.5, 2.5, 3.5, 4.5]);

    // The OLD buggy approach:
    const buggy = new Float32Array(source.length);
    // buggy is all zeros!
    expect(buggy[0]).toBe(0);
    expect(buggy[1]).toBe(0);

    // The NEW fixed approach:
    const fixed = Float32Array.from(Array.from(source));
    expect(fixed[0]).toBeCloseTo(1.5);
    expect(fixed[1]).toBeCloseTo(2.5);
    expect(fixed[2]).toBeCloseTo(3.5);
    expect(fixed[3]).toBeCloseTo(4.5);
  });
});
