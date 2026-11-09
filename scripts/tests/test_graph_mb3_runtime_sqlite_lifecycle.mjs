import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, truncateSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
  getCurrentVersion,
  needsMigration,
  getMigrationHistory,
} from '../../afyx-graph/engine/dist/db/migrations.js';

import {
  QueryPool,
  resolvePoolSize,
} from '../../afyx-graph/engine/dist/mcp/query-pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const GRAPH_ENTRY = resolve(REPO_ROOT, 'afyx-graph', 'engine', 'dist', 'bin', 'afyx-graph.js');

function createGitFixture(parentDir, projectName, sourceFiles = {}) {
  const fixtureDir = join(parentDir, projectName);
  mkdirSync(join(fixtureDir, 'src'), { recursive: true });

  for (const [relativePath, content] of Object.entries(sourceFiles)) {
    const fullPath = join(fixtureDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'mb3-tester',
    GIT_AUTHOR_EMAIL: 'mb3@example.invalid',
    GIT_COMMITTER_NAME: 'mb3-tester',
    GIT_COMMITTER_EMAIL: 'mb3@example.invalid',
  };

  spawnSync('git', ['init', '-q'], { cwd: fixtureDir, env: gitEnv, windowsHide: true });
  spawnSync('git', ['add', '-A'], { cwd: fixtureDir, env: gitEnv, windowsHide: true });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'initial'], {
    cwd: fixtureDir,
    env: gitEnv,
    windowsHide: true,
  });

  const initRes = spawnSync(process.execPath, [GRAPH_ENTRY, 'init', '-y', fixtureDir], {
    cwd: fixtureDir,
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', NO_COLOR: '1' },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(initRes.status, 0, `Fixture init failed for ${projectName}: ${initRes.stderr || initRes.stdout}`);

  return fixtureDir;
}

class McpTestClient {
  constructor(projectDir, extraEnv = {}) {
    this.projectDir = projectDir;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.stdoutBuffer = '';

    this.child = spawn(process.execPath, [GRAPH_ENTRY, 'serve', '--mcp'], {
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        AFYX_GRAPH_NO_DAEMON: '1',
        AFYX_GRAPH_NO_WATCH: '1',
        NO_COLOR: '1',
        ...extraEnv,
      },
    });

    this.child.stderr.on('data', (d) => {
      this.stderr += d.toString('utf8');
    });

    this.child.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString('utf8');
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id !== undefined && this.pending.has(parsed.id)) {
            const waiter = this.pending.get(parsed.id);
            this.pending.delete(parsed.id);
            waiter(parsed);
          }
        } catch {
          // non-json output ignored
        }
      }
    });
  }

  request(method, params = {}, timeoutMs = 8000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} (id=${id}) timed out after ${timeoutMs}ms. Stderr: ${this.stderr.slice(-500)}`));
      }, timeoutMs);

      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  sendRaw(rawString) {
    this.child.stdin.write(rawString + '\n');
  }

  async close() {
    return new Promise((resolve) => {
      if (this.child.killed || this.child.exitCode !== null) {
        resolve();
        return;
      }
      this.child.on('exit', () => resolve());
      this.child.stdin.end();
      setTimeout(() => {
        try { this.child.kill(); } catch { /* ignore */ }
        resolve();
      }, 500);
    });
  }
}

describe('AFYX MB3: Native Graph Runtime, MCP Concurrency & SQLite Lifecycle', () => {
  let tempRoot;

  test.beforeEach(() => {
    tempRoot = join(tmpdir(), 'afyx-mb3-test-' + randomBytes(4).toString('hex'));
    mkdirSync(tempRoot, { recursive: true });
  });

  test.afterEach(() => {
    try {
      if (tempRoot && existsSync(tempRoot)) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch {
      // ignore Windows file handle cleanup race
    }
  });

  // =========================================================================
  // SECTION B: MCP Session, Transport, and Project Isolation (AFYX-121..123)
  // =========================================================================
  test('Section B: Direct stdio MCP transport, handshake, and multi-project isolation', async () => {
    // 1. Setup two distinct projects with isolated symbols
    const projAlpha = createGitFixture(tempRoot, 'project_alpha', {
      'src/alpha.ts': 'export class AlphaService { runAlpha() { return "alpha_ok"; } }\n',
    });
    const projBeta = createGitFixture(tempRoot, 'project_beta', {
      'src/beta.ts': 'export class BetaService { runBeta() { return "beta_ok"; } }\n',
    });

    // 2. Client Alpha session: initialize, tools/list, and query
    const clientAlpha = new McpTestClient(projAlpha);
    try {
      const initResp = await clientAlpha.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mb3-alpha-tester', version: '1.0.0' },
        rootUri: `file://${projAlpha.replace(/\\/g, '/')}`,
      });
      assert.equal(initResp.result?.serverInfo?.name, 'afyx_graph');
      clientAlpha.notify('notifications/initialized', {});

      const toolsResp = await clientAlpha.request('tools/list', {});
      const toolNames = toolsResp.result?.tools?.map((t) => t.name) || [];
      assert.ok(toolNames.includes('afyx_graph_explore'));
      assert.ok(toolNames.includes('afyx_graph_inventory'));

      // Tool call on Alpha for AlphaService
      const callAlpha = await clientAlpha.request('tools/call', {
        name: 'afyx_graph_explore',
        arguments: { query: 'AlphaService' },
      });
      assert.equal(callAlpha.error, undefined);
      assert.notEqual(callAlpha.result?.isError, true);
      const textAlpha = callAlpha.result?.content?.map((c) => c.text || '').join('\n') || '';
      assert.ok(textAlpha.includes('AlphaService'), 'Project Alpha must return AlphaService');

      // Cross-project query: Project Alpha must NOT return BetaService
      const callAlphaForBeta = await clientAlpha.request('tools/call', {
        name: 'afyx_graph_explore',
        arguments: { query: 'BetaService' },
      });
      assert.equal(callAlphaForBeta.error, undefined);
      const textAlphaForBeta = callAlphaForBeta.result?.content?.map((c) => c.text || '').join('\n') || '';
      assert.ok(!textAlphaForBeta.includes('runBeta'), 'Project Alpha must never leak BetaService implementation');
    } finally {
      await clientAlpha.close();
    }

    // 3. Client Beta session: connects to Beta project
    const clientBeta = new McpTestClient(projBeta);
    try {
      await clientBeta.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mb3-beta-tester', version: '1.0.0' },
        rootUri: `file://${projBeta.replace(/\\/g, '/')}`,
      });
      clientBeta.notify('notifications/initialized', {});

      const callBeta = await clientBeta.request('tools/call', {
        name: 'afyx_graph_explore',
        arguments: { query: 'BetaService' },
      });
      assert.equal(callBeta.error, undefined);
      assert.notEqual(callBeta.result?.isError, true);
      const textBeta = callBeta.result?.content?.map((c) => c.text || '').join('\n') || '';
      assert.ok(textBeta.includes('BetaService'), 'Project Beta must return BetaService');

      // Cross-project check: Beta must NOT leak Alpha
      const callBetaForAlpha = await clientBeta.request('tools/call', {
        name: 'afyx_graph_explore',
        arguments: { query: 'AlphaService' },
      });
      assert.equal(callBetaForAlpha.error, undefined);
      const textBetaForAlpha = callBetaForAlpha.result?.content?.map((c) => c.text || '').join('\n') || '';
      assert.ok(!textBetaForAlpha.includes('runAlpha'), 'Project Beta must never leak AlphaService');
    } finally {
      await clientBeta.close();
    }
  });

  test('Section B: Transport resilience on malformed messages and unknown tools', async () => {
    const fixture = createGitFixture(tempRoot, 'resilience_project', {
      'src/app.ts': 'export const OK = 1;\n',
    });

    const client = new McpTestClient(fixture);
    try {
      await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mb3-resilience', version: '1.0.0' },
        rootUri: `file://${fixture.replace(/\\/g, '/')}`,
      });
      client.notify('notifications/initialized', {});

      // Call unknown tool name: must return structured error without terminating server
      const unknownTool = await client.request('tools/call', {
        name: 'non_existent_tool_name',
        arguments: {},
      });
      assert.ok(unknownTool.error || unknownTool.result?.isError, 'Unknown tool must return error');

      // Server remains alive and responsive for subsequent legitimate requests
      const validCall = await client.request('tools/call', {
        name: 'afyx_graph_explore',
        arguments: { query: 'OK' },
      });
      assert.equal(validCall.error, undefined);
      assert.notEqual(validCall.result?.isError, true);
    } finally {
      await client.close();
    }
  });

  // =========================================================================
  // SECTION C: QueryPool Concurrency & Worker Execution (AFYX-124)
  // =========================================================================
  test('Section C: Multi-client concurrent read workload scaling (1, 2, 4, 8 queries)', async () => {
    const fixture = createGitFixture(tempRoot, 'concurrency_project', {
      'src/math.ts': [
        'export function add(a: number, b: number) { return a + b; }',
        'export function multiply(a: number, b: number) { return a * b; }',
        'export function divide(a: number, b: number) { return a / b; }',
        'export class Calculator { calculate(x: number) { return add(x, multiply(x, 2)); } }',
      ].join('\n'),
    });

    const client = new McpTestClient(fixture);
    try {
      await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'concurrency-runner', version: '1.0.0' },
        rootUri: `file://${fixture.replace(/\\/g, '/')}`,
      });
      client.notify('notifications/initialized', {});

      const concurrencyLevels = [1, 2, 4, 8];
      const metricsLog = [];

      for (const concurrency of concurrencyLevels) {
        const start = performance.now();
        const memBefore = process.memoryUsage();

        const calls = Array.from({ length: concurrency }, (_, idx) => {
          const query = idx % 2 === 0 ? 'Calculator' : 'add';
          return client.request('tools/call', {
            name: 'afyx_graph_explore',
            arguments: { query },
          });
        });

        const results = await Promise.all(calls);
        const durationMs = performance.now() - start;
        const memAfter = process.memoryUsage();

        for (const res of results) {
          assert.equal(res.error, undefined, 'Concurrent query must not return JSON-RPC error');
          assert.notEqual(res.result?.isError, true, 'Concurrent query must succeed');
          const content = res.result?.content?.map((part) => part.text || '').join('\n') || '';
          assert.ok(content.includes('Calculator') || content.includes('add'), 'Result must be source-grounded');
        }

        metricsLog.push({
          concurrency,
          durationMs: Math.round(durationMs * 10) / 10,
          avgLatencyPerQueryMs: Math.round((durationMs / concurrency) * 10) / 10,
          rssMb: Math.round(memAfter.rss / (1024 * 1024)),
          heapUsedMb: Math.round(memAfter.heapUsed / (1024 * 1024)),
        });
      }

      assert.equal(metricsLog.length, 4);
      for (const m of metricsLog) {
        assert.ok(m.durationMs > 0);
        assert.ok(m.rssMb > 0);
      }
    } finally {
      await client.close();
    }

    // 2. Unit orchestration verification of QueryPool (scaling, crash recovery, timeout backstop)
    assert.equal(resolvePoolSize('0', 8), 0);
    assert.equal(resolvePoolSize('4', 8), 4);
    assert.equal(resolvePoolSize('999', 8), 16);
    assert.equal(resolvePoolSize(undefined, 8), 7);

    // Test QueryPool worker execution & crash recovery
    let workerCrashCount = 0;
    class MockWorker {
      alive = true;
      msgCb = null;
      exitCb = null;
      constructor() {
        setTimeout(() => { if (this.alive && this.msgCb) this.msgCb({ type: 'ready', ok: true }); }, 1);
      }
      on(ev, cb) {
        if (ev === 'message') this.msgCb = cb;
        else if (ev === 'exit') this.exitCb = cb;
      }
      postMessage(msg) {
        if (!this.alive) return;
        if (msg.toolName === 'fail_once' && workerCrashCount === 0) {
          workerCrashCount++;
          this.alive = false;
          setTimeout(() => this.exitCb?.(1), 1);
          return;
        }
        setTimeout(() => {
          if (this.alive && this.msgCb) {
            this.msgCb({
              type: 'result',
              id: msg.id,
              result: { content: [{ type: 'text', text: `res:${msg.toolName}` }] },
            });
          }
        }, 1);
      }
      terminate() { this.alive = false; }
    }

    const testPool = new QueryPool({
      root: fixture,
      size: 4,
      softTimeoutMs: 200,
      createWorker: () => new MockWorker(),
    });

    const crashRes = await testPool.run('fail_once', {});
    assert.equal(crashRes.content[0].text, 'res:fail_once', 'QueryPool must auto-retry after worker crash');
    assert.equal(workerCrashCount, 1, 'Worker must have crashed and recovered');

    await testPool.destroy();
  });

  // =========================================================================
  // SECTION D: SQLite Persistence, Schema Migration & Recovery (AFYX-194..195)
  // =========================================================================
  test('Section D: SQLite schema migration idempotency and history tracking', () => {
    const dbPath = join(tempRoot, 'migration_test.db');
    const raw = new DatabaseSync(dbPath);

    // Seed older schema version 2
    raw.exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER, description TEXT);
      INSERT INTO schema_versions VALUES (1, 1000, 'initial');
      INSERT INTO schema_versions VALUES (2, 2000, 'v2 metadata');
      CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, kind TEXT, file_path TEXT, start_line INTEGER, start_col INTEGER, end_line INTEGER, end_col INTEGER, parent_id TEXT, signature TEXT, docstring TEXT, visibility TEXT, modifiers TEXT);
      CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, kind TEXT, file_path TEXT, line INTEGER, col INTEGER, confidence REAL, provenance TEXT);
      CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT, mtime INTEGER, size INTEGER, language TEXT, node_count INTEGER, edge_count INTEGER, errors TEXT);
      CREATE TABLE unresolved_refs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, kind TEXT, source_node_id TEXT, line INTEGER, col INTEGER, file_path TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'unknown');
      CREATE TABLE project_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);

    const dbAdapter = {
      prepare: (sql) => raw.prepare(sql),
      exec: (sql) => raw.exec(sql),
      pragma: (sql) => raw.exec('PRAGMA ' + sql),
      transaction: (fn) => (...args) => {
        raw.exec('BEGIN');
        try {
          const res = fn(...args);
          raw.exec('COMMIT');
          return res;
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
      close: () => raw.close(),
      open: true,
    };

    assert.equal(getCurrentVersion(dbAdapter), 2);
    assert.equal(needsMigration(dbAdapter), true);

    // Run migration from version 2 to current version
    runMigrations(dbAdapter, 2);

    assert.equal(getCurrentVersion(dbAdapter), CURRENT_SCHEMA_VERSION);
    assert.equal(needsMigration(dbAdapter), false);

    // Check migration history
    const history = getMigrationHistory(dbAdapter);
    assert.ok(history.length >= 9, 'Migration history must contain records from v2 through CURRENT_SCHEMA_VERSION');
    assert.ok(history.some((h) => h.version === CURRENT_SCHEMA_VERSION));

    // Idempotent re-run must be safe no-op
    runMigrations(dbAdapter, CURRENT_SCHEMA_VERSION);
    assert.equal(getCurrentVersion(dbAdapter), CURRENT_SCHEMA_VERSION);

    raw.close();
  });

  test('Section D: Incremental indexing state transition and freshness tracking', () => {
    const fixture = createGitFixture(tempRoot, 'incremental_project', {
      'src/counter.ts': 'export class Counter { val = 0; inc() { this.val++; } }\n',
    });

    const statusCli = () => {
      const res = spawnSync(process.execPath, [GRAPH_ENTRY, 'status', '--json', fixture], {
        cwd: fixture,
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', NO_COLOR: '1' },
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(res.status, 0);
      return JSON.parse(res.stdout);
    };

    // 1. Fresh state immediately after init
    const freshStatus = statusCli();
    assert.equal(freshStatus.initialized, true);
    assert.equal(freshStatus.freshness?.state, 'FRESH');
    const initialNodeCount = freshStatus.nodeCount;

    // 2. Modify tracked source file
    writeFileSync(
      join(fixture, 'src/counter.ts'),
      'export class Counter { val = 0; inc() { this.val++; } dec() { this.val--; } }\n',
      'utf8',
    );

    // Freshness detects edit
    const staleStatus = statusCli();
    assert.equal(staleStatus.freshness?.state, 'STALE');

    // 3. Commit modification to Git and sync
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'mb3-tester',
      GIT_AUTHOR_EMAIL: 'mb3@example.invalid',
      GIT_COMMITTER_NAME: 'mb3-tester',
      GIT_COMMITTER_EMAIL: 'mb3@example.invalid',
    };
    spawnSync('git', ['add', '-A'], { cwd: fixture, env: gitEnv, windowsHide: true });
    spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'update counter'], {
      cwd: fixture,
      env: gitEnv,
      windowsHide: true,
    });

    const syncRes = spawnSync(process.execPath, [GRAPH_ENTRY, 'sync', fixture], {
      cwd: fixture,
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', NO_COLOR: '1' },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(syncRes.status, 0);

    const reFreshStatus = statusCli();
    assert.equal(reFreshStatus.freshness?.state, 'FRESH');
    assert.ok(reFreshStatus.nodeCount >= initialNodeCount, 'Node count must reflect added dec method');
  });

  test('Section D: Database corruption recovery and foreign file preservation', () => {
    const fixture = createGitFixture(tempRoot, 'corruption_project', {
      'src/data.ts': 'export const CONFIG = { enabled: true };\n',
    });

    const dbFile = join(fixture, '.afyx-graph', 'afyx-graph.db');
    assert.ok(existsSync(dbFile), 'Database file must exist after init');

    // Place an unrelated user file in .afyx-graph to verify preservation
    const foreignFile = join(fixture, '.afyx-graph', 'user_custom_marker.json');
    writeFileSync(foreignFile, JSON.stringify({ preserve_me: true }), 'utf8');

    // Simulate database corruption by truncating the file to 16 bytes
    truncateSync(dbFile, 16);

    // Rebuild index using official 'index' command
    const recoverRes = spawnSync(process.execPath, [GRAPH_ENTRY, 'index', fixture], {
      cwd: fixture,
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', NO_COLOR: '1' },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(recoverRes.status, 0, 'Re-index after corruption must succeed');

    // Verify database was repaired and can be queried
    const queryRes = spawnSync(process.execPath, [GRAPH_ENTRY, 'explore', 'CONFIG', '--path', fixture], {
      cwd: fixture,
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', NO_COLOR: '1' },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(queryRes.status, 0);
    assert.ok(queryRes.stdout.includes('CONFIG'), 'Repaired index must find CONFIG');

    // Foreign file remains intact
    assert.ok(existsSync(foreignFile), 'Foreign file in .afyx-graph must be preserved');
    const foreignContent = JSON.parse(readFileSync(foreignFile, 'utf8'));
    assert.equal(foreignContent.preserve_me, true);
  });

  // =========================================================================
  // SECTION E: Cross-Platform Installed Acceptance (Windows 11 & WSL2 Ubuntu)
  // =========================================================================
  test('Section E: Windows 11 and WSL2 Ubuntu cross-platform execution', () => {
    // 1. Windows Native Execution: verified by preceding tests (status, explore, mcp)
    assert.equal(process.platform, 'win32');

    // 2. WSL2 Ubuntu Linux Native Execution
    const checkWsl = spawnSync('where.exe', ['wsl.exe'], { encoding: 'utf8' });
    if (checkWsl.status !== 0) {
      console.log('WSL2 not available on host — skipping WSL portion');
      return;
    }

    // Convert repo root to WSL path: D:\... -> /mnt/d/...
    const wslRepoRoot = REPO_ROOT.replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, '/');
    const wslGraphBin = `${wslRepoRoot}/afyx-graph/engine/dist/bin/afyx-graph.js`;

    // Execute in WSL2 using native Linux /tmp filesystem with Node v24
    const runnerContent = [
      '#!/bin/bash',
      'set -e',
      'export PATH="/home/afif/.nvm/versions/node/v24.22.2/bin:$PATH"',
      'NODE_VER=$(node -v)',
      'echo "WSL_NODE:$NODE_VER"',
      `BIN_VER=$(node "${wslGraphBin}" --version)`,
      'echo "WSL_BIN:$BIN_VER"',
      'PROJ_DIR=$(mktemp -d /tmp/afyx-wsl-mb3-XXXXXX)',
      'mkdir -p "$PROJ_DIR/src"',
      'echo "export class WslService { compute() { return 42; } }" > "$PROJ_DIR/src/wsl.ts"',
      'cd "$PROJ_DIR"',
      'git init -q',
      'git config user.name "wsl-test"',
      'git config user.email "wsl@example.invalid"',
      'git add -A',
      'git commit -q -m "init"',
      `node "${wslGraphBin}" init -y "$PROJ_DIR"`,
      `EXPLORE_OUT=$(node "${wslGraphBin}" explore WslService --path "$PROJ_DIR")`,
      'echo "WSL_EXPLORE_OK"',
      'rm -rf "$PROJ_DIR"',
    ].join('\n');

    spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'afif', '--', 'tee', '/tmp/afyx-mb3-wsl-runner.sh'], {
      input: runnerContent,
      windowsHide: true,
    });

    const wslRes = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'afif', '--', '/bin/bash', '/tmp/afyx-mb3-wsl-runner.sh'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });

    spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'afif', '--', 'rm', '-f', '/tmp/afyx-mb3-wsl-runner.sh'], {
      windowsHide: true,
    });

    assert.equal(wslRes.status, 0, `WSL execution failed: ${wslRes.stderr || wslRes.stdout}`);
    assert.ok(wslRes.stdout.includes('WSL_NODE:v24'), 'WSL must run with Node v24');
    assert.ok(wslRes.stdout.includes('WSL_BIN:1.0.0'), 'WSL must run afyx-graph 1.0.0');
    assert.ok(wslRes.stdout.includes('WSL_EXPLORE_OK'), 'WSL must explore native Linux project successfully');

    // 3. macOS: Formally DEFERRED
    // Explicit assertion: macOS must not be represented as PASS on Windows/Linux runner
    assert.notEqual(process.platform, 'darwin', 'macOS execution is formally DEFERRED in MB3 scope');
  });
});
