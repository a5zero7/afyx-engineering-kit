import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const graphEntry = resolve(process.env.AFYX_GRAPH_TEST_ENTRY || 'afyx-graph/engine/dist/bin/afyx-graph.js');
const timeoutMs = 12_000;

function run(executable, args, cwd, env) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}: ${result.stderr || result.stdout}`);
}

test('IDE_MCP_CLIENT_SIMULATION_PASS: installed Graph MCP handles discovery and read-only evidence', { timeout: 45_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'afyx-mb81-mcp-'));
  let child;
  try {
    mkdirSync(join(fixture, 'src'));
    writeFileSync(join(fixture, 'src', 'service.ts'),
      'export class OrderService { calculateTotal(qty: number, price: number) { return qty * price; } }\n');
    const env = { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1', NO_COLOR: '1' };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'AFYX_GRAPH_STATE_DIR']) delete env[key];
    const gitEnv = { ...env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
    run('git', ['init', '-q'], fixture, gitEnv);
    run('git', ['add', '-A'], fixture, gitEnv);
    run('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'], fixture, gitEnv);
    run(process.execPath, [graphEntry, 'init', '-y', fixture], fixture, env);

    child = spawn(process.execPath, [graphEntry, 'serve', '--mcp'],
      { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let protocolError;
    const pending = new Map();
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      let end;
      while ((end = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, end).trim();
        stdout = stdout.slice(end + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { protocolError = new Error(`Non-JSON MCP stdout: ${line.slice(0, 120)}`); continue; }
        if (message.jsonrpc !== '2.0') { protocolError = new Error('Invalid JSON-RPC envelope on stdout'); continue; }
        if (message.id !== undefined) {
          const waiter = pending.get(message.id);
          if (!waiter) { protocolError = new Error(`Unexpected response ID ${message.id}`); continue; }
          pending.delete(message.id);
          waiter(message);
        }
      }
    });
    const request = async (id, method, params) => {
      assert.equal(protocolError, undefined);
      const response = new Promise((resolveResponse, rejectResponse) => {
        const timer = setTimeout(() => { pending.delete(id); rejectResponse(new Error(`MCP timeout on ${method}: ${stderr}`)); }, timeoutMs);
        pending.set(id, (message) => { clearTimeout(timer); resolveResponse(message); });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      const message = await response;
      assert.equal(protocolError, undefined);
      assert.equal(message.id, id);
      return message;
    };

    const initialized = await request(1, 'initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'afyx-mb81-mock-ide', version: '1' },
      rootUri: pathToFileURL(fixture).href,
    });
    assert.equal(initialized.result?.serverInfo?.name, 'afyx_graph');
    assert.ok(initialized.result?.capabilities && typeof initialized.result.capabilities === 'object');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);

    const listed = await request(2, 'tools/list', {});
    const tools = listed.result?.tools;
    assert.ok(Array.isArray(tools) && tools.length > 0);
    assert.ok(tools.every((tool) => tool.name.startsWith('afyx_graph_') && tool.inputSchema));
    assert.ok(tools.some((tool) => tool.name === 'afyx_graph_explore'));

    const explored = await request(3, 'tools/call', { name: 'afyx_graph_explore', arguments: { query: 'OrderService' } });
    assert.equal(explored.error, undefined);
    assert.notEqual(explored.result?.isError, true);
    assert.match(JSON.stringify(explored.result?.content), /OrderService/);

    const refused = await request(4, 'tools/call', { name: 'foreign_tool', arguments: {} });
    assert.ok(refused.error || refused.result?.isError, 'Unregistered tool must be rejected');
    assert.equal(protocolError, undefined, 'MCP stdout must contain protocol JSON only');
  } finally {
    if (child) {
      child.stdin.end();
      child.kill();
      await Promise.race([new Promise((resolveClose) => child.once('close', resolveClose)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000))]);
      assert.equal(child.exitCode === null && child.signalCode === null, false, 'MCP child must terminate');
    }
    assert.equal(dirname(resolve(fixture)), resolve(tmpdir()), 'Disposable fixture must remain directly under OS temp');
    rmSync(fixture, { recursive: true, force: true });
  }
});
