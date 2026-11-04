#!/usr/bin/env node
/**
 * Afyx Graph CLI + MCP smoke test (zero-model, deterministic, local).
 *
 * Runs the built CLI end to end on a tiny throwaway project and speaks the MCP
 * stdio protocol to `serve --mcp`. It proves the canonical identity is the only
 * identity and that every functional handler is reachable:
 *   CLI:  --version, help, init, status --json, query, explore, impact, files
 *   MCP:  initialize, tools/list, and one tools/call per afyx_graph_* handler
 *
 * Usage: node scripts/smoke-cli-mcp.mjs [--bin dist/bin/afyx-graph.js]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const binIndex = process.argv.indexOf('--bin');
const bin = path.resolve(binIndex > -1 ? process.argv[binIndex + 1] : 'dist/bin/afyx-graph.js');
assert.ok(fs.existsSync(bin), `CLI not built: ${bin}`);

// Neutral fragments: the forbidden identity is never spelled out in the tree.
const FOREIGN_IDENTITY = new RegExp(['code', 'graph'].join(''), 'i');

const env = {
  ...process.env,
  AFYX_GRAPH_NO_DAEMON: '1',
  AFYX_GRAPH_NO_WATCH: '1',
  AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1',
  NO_COLOR: '1',
};

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-smoke-'));
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, 'src', 'parser.ts'), 'export function parseToken(raw: string) { return raw.trim(); }\n');
fs.writeFileSync(
  path.join(project, 'src', 'service.ts'),
  "import { parseToken } from './parser';\nexport class BaseService { authenticate(raw: string) { return parseToken(raw); } }\nexport class ApiService extends BaseService {}\n",
);

// A committed git working tree, so index freshness can be proven end to end.
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'smoke']]) {
  const r = spawnSync('git', args, { cwd: project, env: gitEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
}

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ok  ${name}`);
}

function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: project, env, encoding: 'utf8', timeout: 120_000, ...options });
  assert.equal(result.status, 0, `afyx-graph ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}

class McpClient {
  constructor(extraEnv = {}) {
    this.child = spawn(process.execPath, [bin, 'serve', '--mcp'], { cwd: project, env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
    let buffer = '';
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const waiter = this.pending.get(message.id);
        if (waiter) { this.pending.delete(message.id); waiter(message); }
      }
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8'); });
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out. stderr: ${this.stderr.slice(-400)}`)), 90_000);
      this.pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

try {
  console.log('CLI');
  const version = cli(['--version']).trim();
  assert.match(version, /^\d+\.\d+\.\d+/, `unexpected --version output: ${version}`);
  ok(`--version (${version})`);

  const help = cli(['help']);
  assert.match(help, /^Usage: afyx-graph /m, 'help usage line must name the afyx-graph CLI');
  assert.doesNotMatch(help, FOREIGN_IDENTITY, 'help mentions a foreign identity');
  ok('help (canonical identity only)');

  const entriesBeforeInit = new Set(fs.readdirSync(project));
  cli(['init', '-y', project]);
  const stateDir = path.join(project, '.afyx-graph');
  assert.ok(fs.existsSync(path.join(stateDir, 'afyx-graph.db')), 'init did not create .afyx-graph/afyx-graph.db');
  assert.deepEqual(fs.readdirSync(project).filter((entry) => !entriesBeforeInit.has(entry)), ['.afyx-graph'], 'init must add only the .afyx-graph state directory');
  assert.deepEqual(fs.readdirSync(stateDir).filter((entry) => entry.endsWith('.db')), ['afyx-graph.db'], 'the state directory must hold exactly one database');
  ok('init creates only .afyx-graph/afyx-graph.db');

  const status = JSON.parse(cli(['status', '--json', project]));
  assert.equal(status.initialized, true);
  assert.ok(status.fileCount >= 2 && status.nodeCount > 0, 'status reports an empty index');
  ok(`status --json (${status.fileCount} files, ${status.nodeCount} nodes)`);
  assert.equal(status.freshness.state, 'FRESH', `expected FRESH after init in a clean git tree, got ${JSON.stringify(status.freshness)}`);
  fs.appendFileSync(path.join(project, 'src', 'parser.ts'), '// edited after indexing\n');
  const stale = JSON.parse(cli(['status', '--json', project]));
  assert.equal(stale.freshness.state, 'STALE', `expected STALE after a tracked edit, got ${JSON.stringify(stale.freshness)}`);
  fs.writeFileSync(path.join(project, 'src', 'parser.ts'), 'export function parseToken(raw: string) { return raw.trim(); }\n');
  ok('freshness: FRESH after init, STALE after a tracked edit');

  assert.match(cli(['query', 'parseToken', '--path', project]), /parseToken/);
  ok('query');
  assert.match(cli(['explore', 'authenticate', 'parseToken', '--path', project]), /parseToken/);
  ok('explore');
  assert.match(cli(['impact', 'parseToken', '--path', project]), /authenticate|service/i);
  ok('impact');
  assert.match(cli(['files', '--path', project]), /service\.ts/);
  ok('files');

  console.log('MCP');
  const initializeParams = {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'afyx-smoke', version: '0.0.0' },
    rootUri: `file://${project.replace(/\\/g, '/')}`,
  };

  // Default exposure: one primary tool, canonical names only.
  const defaults = new McpClient();
  try {
    const init = await defaults.request('initialize', initializeParams);
    assert.equal(init.result.serverInfo.name, 'afyx_graph', 'MCP server name must be afyx_graph');
    assert.doesNotMatch(JSON.stringify(init.result), FOREIGN_IDENTITY, 'initialize payload mentions a foreign identity');
    ok(`initialize (server ${init.result.serverInfo.name} ${init.result.serverInfo.version})`);
    defaults.notify('notifications/initialized', {});
    const listed = await defaults.request('tools/list', {});
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ['afyx_graph_inventory', 'afyx_graph_explore'], `default tools/list changed: ${names}`);
    assert.doesNotMatch(JSON.stringify(listed.result), FOREIGN_IDENTITY, 'tool definitions mention a foreign identity');
    ok('tools/list default exposure (inventory + explore)');
  } finally {
    defaults.close();
  }

  // Full handler inventory through the AFYX_GRAPH_MCP_TOOLS allowlist.
  const client = new McpClient({ AFYX_GRAPH_MCP_TOOLS: 'explore,search,node,callers,callees,impact,files,status' });
  try {
    await client.request('initialize', initializeParams);
    client.notify('notifications/initialized', {});
    const listed = await client.request('tools/list', {});
    const names = listed.result.tools.map((tool) => tool.name);
    assert.ok(names.every((name) => name.startsWith('afyx_graph_')), `non-canonical tool names: ${names}`);
    for (const core of ['afyx_graph_explore', 'afyx_graph_search', 'afyx_graph_node']) assert.ok(names.includes(core), `${core} missing from tools/list`);
    ok(`tools/list with allowlist (${names.length} tools, all afyx_graph_*)`);

    const calls = {
      afyx_graph_search: { query: 'parseToken' },
      afyx_graph_explore: { query: 'authenticate parseToken' },
      afyx_graph_node: { symbol: 'parseToken', includeCode: true },
      afyx_graph_callers: { symbol: 'parseToken' },
      afyx_graph_callees: { symbol: 'authenticate' },
      afyx_graph_impact: { symbol: 'parseToken' },
      afyx_graph_files: {},
      afyx_graph_status: {},
    };
    for (const [name, args] of Object.entries(calls)) {
      const response = await client.request('tools/call', { name, arguments: args });
      assert.ok(!response.error, `${name}: JSON-RPC error ${JSON.stringify(response.error)}`);
      assert.ok(!response.result.isError, `${name}: ${JSON.stringify(response.result.content)}`);
      const text = response.result.content.map((part) => part.text ?? '').join('\n');
      assert.ok(text.length > 0, `${name}: empty response`);
      assert.doesNotMatch(text, FOREIGN_IDENTITY, `${name}: response mentions a foreign identity`);
      ok(name);
    }

    for (const unregistered of ['search', 'afyx_graph_unregistered_tool']) {
      const rejected = await client.request('tools/call', { name: unregistered, arguments: { query: 'parseToken' } });
      assert.ok(rejected.error || rejected.result?.isError, `only registered afyx_graph_* tools may be called (${unregistered} was accepted)`);
    }
    ok('unregistered tool names are rejected');
  } finally {
    client.close();
  }
  console.log(`Afyx Graph CLI + MCP smoke: PASS (${passed} checks)`);
} finally {
  try { fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may keep handles briefly */ }
}
