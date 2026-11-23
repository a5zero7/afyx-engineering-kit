import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installHostBridge, uninstallHostBridge } from '../afyx-host-bridge-lifecycle.mjs';

async function client(entry, args) {
  const child = spawn(process.execPath, [entry, 'serve', '--mcp', ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const waiting = new Map(); let id = 0, diagnostics = '';
  child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-4000); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const value = JSON.parse(line); const item = waiting.get(value.id);
    if (item) { clearTimeout(item.timer); waiting.delete(value.id); item.resolve(value); }
  });
  return {
    rpc(method, params) { return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error(`MCP timeout: ${diagnostics}`)); }, 8000);
      waiting.set(requestId, { resolve, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    }); },
    async close() {
      child.stdin.end();
      if (child.exitCode !== null) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error('MCP cleanup timeout')); }, 8000);
        child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`MCP exit ${code}: ${diagnostics}`)); });
      });
    },
  };
}

test('installed bridge preserves workflow and lazily exposes only host-authorized document tools', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-installed-optional-'));
  const runtimeRoot = join(root, 'runtime'); let active;
  try {
    const installed = installHostBridge({ sourceRoot: resolve('scripts'), runtimeRoot, sourceRevision: 'mb18-fixture' });
    assert.equal(installed.status, 'READY');
    writeFileSync(join(root, 'facts.json'), '{"name":"installed-conversion-proof"}');
    active = await client(installed.entry, ['--project-root', root]);
    const base = await active.rpc('tools/list', {});
    assert.deepEqual(base.result.tools.map((tool) => tool.name), ['afyx_workflow', 'afyx_capabilities']);
    const denied = await active.rpc('tools/call', { name: 'afyx_document', arguments: { action: 'convert_document', path: 'facts.json', enabled: true } });
    assert.equal(denied.result.isError, true);
    await active.close(); active = undefined;
    active = await client(installed.entry, ['--project-root', root, '--capabilities', 'document']);
    const enabled = await active.rpc('tools/list', {});
    assert.deepEqual(enabled.result.tools.map((tool) => tool.name), ['afyx_workflow', 'afyx_capabilities', 'afyx_document']);
    const discovery = await active.rpc('tools/call', { name: 'afyx_capabilities', arguments: { intent: 'source-code' } });
    assert.deepEqual(discovery.result.structuredContent.capabilities, []);
    const converted = await active.rpc('tools/call', { name: 'afyx_document', arguments: { action: 'convert_document', path: 'facts.json' } });
    assert.equal(converted.result.structuredContent.status, 'SUCCEEDED');
    assert.match(converted.result.structuredContent.markdown, /installed-conversion-proof/);
    assert.equal(converted.result.structuredContent.contentTrust, 'untrusted-data');
    await active.close(); active = undefined;
    assert.equal(uninstallHostBridge(runtimeRoot).status, 'NOT_INSTALLED');
  } finally { if (active) await active.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
});

test('installed MCP executable starts through an ancestor alias instead of silently importing as a library', () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-mcp-entry-alias-'));
  try {
    const runtimeRoot = join(root, 'runtime');
    installHostBridge({ sourceRoot: resolve('scripts'), runtimeRoot, sourceRevision: 'alias-fixture' });
    symlinkSync(runtimeRoot, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const messages = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }];
    const result = spawnSync(process.execPath, [join(root, 'alias', 'current', 'afyx-host-bridge.mjs'), 'serve', '--mcp', '--project-root', root],
      { encoding: 'utf8', input: messages.map((message) => JSON.stringify(message)).join('\n') + '\n', timeout: 5000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(responses.map((message) => message.id), [1, 2]);
    assert.equal(responses[1].result.tools[0].name, 'afyx_workflow');
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
});
