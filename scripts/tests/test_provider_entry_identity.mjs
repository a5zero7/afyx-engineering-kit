import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classifyEntry } from '../afyx-mcp-integration.mjs';
import { inspectAntigravity, providerAdapters } from '../afyx-provider-integration.mjs';

test('Claude extension-only discovery negotiates v1 without claiming real host execution', () => {
  const adapter = providerAdapters.claude;
  for (const options of [{ extensionOnly: true }, { claudeExtension: true }]) {
    const discovery = adapter.discover(options);
    assert.equal(discovery.contract, 'ProviderCapability/v1');
    assert.equal(discovery.status, 'UNVERIFIED');
    assert.equal(discovery.host.evidence, 'CALLER');
    assert.equal(discovery.host.command, 'extension');
    assert.equal(discovery.host.version, null);
    assert.equal(discovery.host.runtimeVerified, false);
    assert.equal(discovery.acceptance, 'NOT_RUN');
    assert.equal(discovery.mutationAuthorized, false);
    assert.equal(adapter.negotiate([{ capability: 'mcp' }], options).status, 'SUPPORTED');
    assert.equal(adapter.negotiate([{ capability: 'mcp', verification: 'RUNTIME' }], options).status, 'UNVERIFIED');
    assert.equal(adapter.negotiate([{ capability: 'not-registered' }], options).status, 'BLOCKED');
  }
  assert.equal(adapter.discover({ extensionOnly: true,
    host: { detected: false, evidence: 'FILESYSTEM' } }).status, 'BLOCKED');
});

test('Codex explicit MCP arguments retain literal identity', () => {
  const expected = { node: process.execPath, args: [join(tmpdir(), 'afyx-workflow.mjs'), 'serve', '--mcp'] };
  const classify = (args) => classifyEntry({ transport: { type: 'stdio', command: expected.node, args } }, expected);
  assert.equal(classify(expected.args), 'MCP_CONFIGURED');
  for (const args of [[expected.args[0], './serve', '--mcp'], [expected.args[0], 'serve', './--mcp'],
    [expected.args[0], 'SERVE', '--MCP'], [expected.args[0], { command: 'serve' }, '--mcp']]) {
    assert.equal(classify(args), 'MCP_BLOCKED');
  }
});

test('Codex POSIX MCP paths remain case sensitive', { skip: process.platform === 'win32' }, () => {
  const expected = { node: '/opt/node', args: ['/opt/AFYX/bridge.mjs', 'serve', '--mcp'] };
  assert.equal(classifyEntry({ transport: { type: 'stdio', command: expected.node,
    args: ['/opt/afyx/bridge.mjs', 'serve', '--mcp'] } }, expected), 'MCP_BLOCKED');
});

for (const scope of ['global', 'workspace']) {
  test(`Antigravity ${scope} rejects foreign literal arguments without mutation`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'afyx-provider-identity-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const options = { scope, geminiHome: join(root, 'gemini'), workspaceRoot: join(root, 'workspace'),
      node: process.execPath, entry: join(root, 'bridge.mjs') };
    const directory = scope === 'global' ? join(options.geminiHome, 'config') : join(options.workspaceRoot, '.agents');
    mkdirSync(directory, { recursive: true });
    const config = join(directory, 'mcp_config.json');
    const variants = [[options.entry, './serve', '--mcp'], [options.entry, 'serve', './--mcp'],
      [options.entry, 'serve', { flag: '--mcp' }]];
    if (process.platform === 'win32') variants.push([options.entry, 'SERVE', '--MCP']);
    for (const args of variants) {
      writeFileSync(config, JSON.stringify({ theme: 'owner', mcpServers: {
        afyx_graph: { command: options.node, args }, foreign: { command: 'other', args: [] } } }));
      const before = readFileSync(config);
      assert.equal(inspectAntigravity(options).state, 'MCP_BLOCKED');
      const result = await providerAdapters.antigravity.verify(options);
      assert.equal(result.status, 'BLOCKED');
      assert.deepEqual(readFileSync(config), before);
    }
    writeFileSync(config, JSON.stringify({ mcpServers: { afyx_graph: {
      command: options.node, args: [options.entry, 'serve', '--mcp'] } } }));
    assert.equal(inspectAntigravity(options).state, 'MCP_CONFIGURED_UNOWNED');
  });
}
