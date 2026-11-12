import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverProviderInventory, formatProviderInventory, selectableProviderIds } from '../afyx-provider-inventory.mjs';

const inspect = (probe, platform = 'win32') => discoverProviderInventory({
  platform, env: { PATH: '' }, home: '/disposable', probe,
});
const byId = (inventory, id) => inventory.find((item) => item.id === id);

test('supported providers are alphabetic and unavailable products are honest', () => {
  const inventory = inspect({ commands: {}, extensions: [], desktops: {}, files: [] });
  assert.deepEqual(inventory.map((item) => item.name), ['Antigravity', 'Claude Code', 'Codex']);
  assert.ok(inventory.every((item) => item.supported && !item.installed));
  assert.ok(formatProviderInventory(inventory).includes('  - Unavailable'));
});

test('CLI only, extension only, CLI plus extension, and all supported surfaces', () => {
  const inventory = inspect({
    commands: { agy: 'C:/bin/agy.cmd', claude: 'C:/bin/claude.cmd', codex: 'C:/bin/codex.cmd' },
    desktops: { antigravity: ['C:/apps/Antigravity.exe'] }, files: ['C:/apps/Antigravity.exe'],
    extensions: [
      { id: 'anthropic.claude-code', path: 'C:/ext/claude', version: '1.2.3' },
      { id: 'openai.chatgpt', path: 'C:/ext/codex', version: '2.3.4' },
    ],
  });
  assert.deepEqual(byId(inventory, 'antigravity').products.map((item) => item.type), ['CLI', 'IDE/Desktop']);
  assert.deepEqual(byId(inventory, 'claude').products.map((item) => item.type), ['CLI', 'VS Code Extension']);
  assert.deepEqual(byId(inventory, 'codex').products.map((item) => item.type), ['CLI', 'VS Code Extension']);
  assert.equal(byId(inventory, 'codex').products[1].version, '2.3.4');
  assert.deepEqual(selectableProviderIds(inventory), ['antigravity', 'claude', 'codex']);
  assert.ok(inventory.flatMap((item) => item.products).every((item) => item.configuration === 'NOT_VERIFIED'));

  const extensionOnly = inspect({ commands: {}, desktops: {}, extensions: [
    { id: 'anthropic.claude-code', path: 'C:/ext/claude', version: '1' },
  ] });
  assert.deepEqual(byId(extensionOnly, 'claude').products.map((item) => item.type), ['VS Code Extension']);
  assert.equal(byId(extensionOnly, 'codex').installed, false);
  assert.deepEqual(selectableProviderIds(extensionOnly), ['claude']);
  const cliOnly = inspect({ commands: { codex: 'C:/bin/codex.cmd' }, desktops: {}, extensions: [] });
  assert.deepEqual(byId(cliOnly, 'codex').products.map((item) => item.type), ['CLI']);
  assert.deepEqual(selectableProviderIds(cliOnly), ['codex']);
});

test('aliases and duplicate extension paths are deduplicated', () => {
  const inventory = inspect({ commands: { agy: 'C:/bin/agy.cmd', antigravity: 'C:/bin/antigravity.cmd' },
    desktops: {}, extensions: [
      { id: 'openai.chatgpt', path: 'C:/ext/chatgpt', version: '1' },
      { id: 'openai.chatgpt', path: 'C:/ext/chatgpt', version: '1' },
    ] });
  assert.equal(byId(inventory, 'antigravity').products.length, 1);
  assert.equal(byId(inventory, 'codex').products.length, 1);
});

test('unsupported providers appear only when detected and never gain MCP configuration', () => {
  const probe = { commands: { cursor: 'C:/bin/cursor.cmd', opencode: 'C:/bin/opencode.cmd' },
    desktops: {}, extensions: [] };
  const before = structuredClone(probe);
  const inventory = inspect(probe);
  assert.deepEqual(inventory.map((item) => item.name).slice(-2), ['Cursor', 'OpenCode']);
  assert.ok(inventory.filter((item) => !item.supported).every((item) =>
    item.status === 'COMING SOON' && item.products.every((product) => !product.mcp)));
  assert.match(formatProviderInventory(inventory).join('\n'), /OTHER DETECTED\n  - Cursor · COMING SOON\n  - OpenCode · COMING SOON/);
  assert.deepEqual(probe, before);
  assert.deepEqual(selectableProviderIds(inventory), []);
});

test('long paths never enter default dashboard lines', () => {
  const path = `C:/private/${'long'.repeat(100)}/codex.cmd`;
  const inventory = inspect({ commands: { codex: path }, desktops: {}, extensions: [] });
  assert.equal(byId(inventory, 'codex').products[0].path, path);
  assert.ok(formatProviderInventory(inventory).every((line) => !line.includes('C:/')));
});

test('WSL inventory rejects Windows executable paths and accepts Linux-local hosts', () => {
  const inventory = inspect({ commands: { codex: '/mnt/c/bin/codex.exe', claude: '/usr/local/bin/claude' },
    desktops: {}, extensions: [] }, 'linux');
  assert.equal(byId(inventory, 'codex').installed, false);
  assert.equal(byId(inventory, 'claude').installed, true);
});
