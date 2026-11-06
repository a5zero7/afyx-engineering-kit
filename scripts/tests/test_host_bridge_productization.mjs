import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  installHostBridge, uninstallHostBridge, verifyHostBridge,
} from '../afyx-host-bridge-lifecycle.mjs';
import { runProviderLifecycle } from '../afyx-provider-integration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'afyx-host-product-'));
  return {
    root,
    runtimeRoot: join(root, 'install', 'host-bridge'),
    installRoot: join(root, 'install'),
    workspaceRoot: join(root, 'workspace'),
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }),
  };
}

function providerOptions(fx) {
  const verified = verifyHostBridge(fx.runtimeRoot);
  return {
    providers: ['antigravity'], scope: 'workspace', workspaceRoot: fx.workspaceRoot,
    geminiHome: join(fx.root, 'gemini'), codexHome: join(fx.root, 'codex'),
    node: process.execPath, entry: verified.entry, server: 'afyx_workflow', mode: 'workflow',
    installRoot: fx.installRoot, authorize: 'afyx-graph,afyx-context', tool: 'afyx_workflow',
  };
}

test('host bridge lifecycle installs, verifies, updates and uninstalls owned bundle', () => {
  const fx = fixture();
  try {
    const installed = installHostBridge({ sourceRoot: SCRIPTS, runtimeRoot: fx.runtimeRoot, sourceRevision: 'test-rev-1' });
    assert.equal(installed.status, 'READY');
    assert.equal(verifyHostBridge(fx.runtimeRoot).sourceRevision, 'test-rev-1');

    const updated = installHostBridge({ sourceRoot: SCRIPTS, runtimeRoot: fx.runtimeRoot, sourceRevision: 'test-rev-2' });
    assert.equal(updated.status, 'READY');
    assert.equal(verifyHostBridge(fx.runtimeRoot).sourceRevision, 'test-rev-2');

    const removed = uninstallHostBridge(fx.runtimeRoot);
    assert.equal(removed.status, 'NOT_INSTALLED');
    assert.equal(existsSync(fx.runtimeRoot), false);
  } finally {
    fx.cleanup();
  }
});

test('host bridge lifecycle rejects foreign runtime and detects content drift', () => {
  const fx = fixture();
  try {
    mkdirSync(fx.runtimeRoot, { recursive: true });
    writeFileSync(join(fx.runtimeRoot, 'foreign.txt'), 'owner-data', 'utf8');
    assert.throws(
      () => installHostBridge({ sourceRoot: SCRIPTS, runtimeRoot: fx.runtimeRoot }),
      /HOST_BRIDGE_FOREIGN_RUNTIME/,
    );
    assert.equal(readFileSync(join(fx.runtimeRoot, 'foreign.txt'), 'utf8'), 'owner-data');

    rmSync(fx.runtimeRoot, { recursive: true, force: true });
    installHostBridge({ sourceRoot: SCRIPTS, runtimeRoot: fx.runtimeRoot });
    writeFileSync(join(fx.runtimeRoot, 'current', 'afyx-host-bridge.mjs'), 'tampered', 'utf8');
    assert.deepEqual(
      { status: verifyHostBridge(fx.runtimeRoot).status, reason: verifyHostBridge(fx.runtimeRoot).reason },
      { status: 'BROKEN', reason: 'INTEGRITY_MISMATCH' },
    );
    assert.throws(() => uninstallHostBridge(fx.runtimeRoot), /HOST_BRIDGE_UNINSTALL_REFUSED/);
  } finally {
    fx.cleanup();
  }
});

test('workspace provider lifecycle owns only afyx_workflow and preserves foreign entries', async () => {
  const fx = fixture();
  try {
    mkdirSync(fx.workspaceRoot, { recursive: true });
    installHostBridge({ sourceRoot: SCRIPTS, runtimeRoot: fx.runtimeRoot, sourceRevision: 'provider-test' });
    const config = join(fx.workspaceRoot, '.agents', 'mcp_config.json');
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({ mcpServers: { foreign: { command: 'foreign-tool' } }, keep: true }), 'utf8');

    const applied = await runProviderLifecycle({ ...providerOptions(fx), apply: true });
    assert.equal(applied.status, 'READY');
    const document = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(document.keep, true);
    assert.deepEqual(document.mcpServers.foreign, { command: 'foreign-tool' });
    const workflow = document.mcpServers.afyx_workflow;
    assert.ok(workflow);
    assert.equal(workflow.args.includes('--project-root'), true);
    assert.equal(workflow.args.includes('--authorize'), true);
    assert.equal(workflow.args.includes('afyx-graph,afyx-context'), true);

    const removed = await runProviderLifecycle({ ...providerOptions(fx), apply: true, uninstall: true });
    assert.equal(removed.status, 'READY');
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), {
      mcpServers: { foreign: { command: 'foreign-tool' } }, keep: true,
    });
  } finally {
    fx.cleanup();
  }
});

test('model arguments cannot replace trusted workflow roots, provider or authorization', async () => {
  const fx = fixture();
  try {
    mkdirSync(fx.workspaceRoot, { recursive: true });
    installHostBridge({ sourceRoot: SCRIPTS, runtimeRoot: fx.runtimeRoot });
    const applied = await runProviderLifecycle({ ...providerOptions(fx), apply: true });
    assert.equal(applied.status, 'READY');
    const config = JSON.parse(readFileSync(join(fx.workspaceRoot, '.agents', 'mcp_config.json'), 'utf8'));
    const args = config.mcpServers.afyx_workflow.args;
    assert.equal(args[args.indexOf('--provider') + 1], 'antigravity');
    assert.equal(args[args.indexOf('--project-root') + 1], resolve(fx.workspaceRoot));
    assert.equal(args[args.indexOf('--install-root') + 1], resolve(fx.installRoot));
    assert.equal(args[args.indexOf('--authorize') + 1], 'afyx-graph,afyx-context');
  } finally {
    fx.cleanup();
  }
});
