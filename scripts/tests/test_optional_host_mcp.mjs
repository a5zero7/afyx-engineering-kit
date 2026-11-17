import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
