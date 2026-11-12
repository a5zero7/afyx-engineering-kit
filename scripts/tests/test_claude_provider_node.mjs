import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const moduleUrl = new URL('../afyx-claude-integration.mjs', import.meta.url).href;

describe('Claude Code Provider Integration (Node.js)', () => {
  let tempRoot;
  let mockBinDir;
  let mockClaudeScript;
  let fakeServerScript;
  let mockClaudeCmd;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'afyx-claude-test-'));
    mockBinDir = join(tempRoot, 'bin');
    mkdirSync(mockBinDir, { recursive: true });

    fakeServerScript = join(tempRoot, 'fake-server.js');
    writeFileSync(
      fakeServerScript,
      `const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'afyx_graph', version: '1.0.0' } } }));
    } else if (msg.id === 2) {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'afyx_graph_explore' }, { name: 'afyx_workflow' }] } }));
    }
  } catch (e) {}
});\n`,
      'utf8'
    );

    mockClaudeScript = join(tempRoot, 'mock-claude.js');
    writeFileSync(
      mockClaudeScript,
      `const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const args = process.argv.slice(2);
const overridden = Object.hasOwn(process.env, 'CLAUDE_CONFIG_DIR');
const configDir = overridden ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
const userConfig = overridden ? path.join(configDir, '.claude.json') : path.join(os.homedir(), '.claude.json');
const projectConfig = path.join(process.cwd(), '.mcp.json');

const read = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const write = (file, val) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(val, null, 2) + '\\n'); };
const scope = () => { const idx = args.indexOf('--scope'); return idx >= 0 ? args[idx + 1] : 'user'; };
const fileFor = (val) => val === 'project' ? projectConfig : userConfig;

if (args[0] !== 'mcp') { process.exit(1); }
if (args[1] === 'get') {
  const name = args[2];
  const u = read(userConfig); const p = read(projectConfig);
  if (p.mcpServers && p.mcpServers[name]) {
    console.log(JSON.stringify({ name, scope: 'project', entry: p.mcpServers[name] }));
    process.exit(0);
  }
  if (u.mcpServers && u.mcpServers[name]) {
    console.log(JSON.stringify({ name, scope: 'user', entry: u.mcpServers[name] }));
    process.exit(0);
  }
  process.exit(1);
}
if (args[1] === 'add-json') {
  const name = args[2];
  const entry = JSON.parse(args[3]);
  const f = fileFor(scope());
  const doc = read(f);
  doc.mcpServers = doc.mcpServers || {};
  doc.mcpServers[name] = entry;
  write(f, doc);
  console.log('Added');
  process.exit(0);
}
if (args[1] === 'remove') {
  const name = args[2];
  const f = fileFor(scope());
  const doc = read(f);
  if (doc.mcpServers && doc.mcpServers[name]) {
    delete doc.mcpServers[name];
    if (Object.keys(doc.mcpServers).length === 0) delete doc.mcpServers;
    write(f, doc);
  }
  console.log('Removed');
  process.exit(0);
}
process.exit(1);\n`,
      'utf8'
    );

    if (process.platform === 'win32') {
      mockClaudeCmd = join(mockBinDir, 'claude.cmd');
      writeFileSync(mockClaudeCmd, `@node "${mockClaudeScript}" %*\r\n`, 'utf8');
    } else {
      mockClaudeCmd = join(mockBinDir, 'claude');
      writeFileSync(mockClaudeCmd, `#!/bin/sh\nexec node "${mockClaudeScript}" "$@"\n`, { mode: 0o755 });
    }
  });

  afterEach(() => {
    if (tempRoot && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('performs complete Claude Code lifecycle: inspect, plan, register, verify, uninstall', async () => {
    const { integrateClaude, inspectClaude } = await import(moduleUrl);

    const claudeConfigDir = join(tempRoot, 'claude-profile');
    const workspaceRoot = join(tempRoot, 'workspace');
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });

    const baseOptions = {
      claude: mockClaudeCmd,
      claudeConfigDir,
      workspaceRoot,
      node: process.execPath,
      entry: fakeServerScript,
      scope: 'global',
      server: 'afyx_graph',
      tool: 'afyx_graph_explore',
    };

    // 1. Initial inspect -> NOT_CONFIGURED
    const initialInspect = inspectClaude(baseOptions);
    assert.equal(initialInspect.state, 'MCP_NOT_CONFIGURED');
    assert.equal(initialInspect.owned, false);

    // 2. Plan (apply: false)
    const planResult = await integrateClaude({ ...baseOptions, apply: false });
    assert.equal(planResult.status, 'DETECTED');
    assert.equal(planResult.action, 'CREATE');
    assert.equal(planResult.changed, false);

    // 3. Register (apply: true)
    const registerResult = await integrateClaude({ ...baseOptions, apply: true });
    assert.equal(registerResult.status, 'READY');
    assert.equal(registerResult.changed, true);

    // 4. Verify idempotency
    const verifyResult = await integrateClaude({ ...baseOptions, operation: 'verify' });
    assert.equal(verifyResult.status, 'READY');

    // 5. Read back inspect -> MCP_CONFIGURED, owned
    const postInspect = inspectClaude(baseOptions);
    assert.equal(postInspect.state, 'MCP_CONFIGURED');
    assert.equal(postInspect.owned, true);

    // 6. Uninstall
    const uninstallResult = await integrateClaude({ ...baseOptions, uninstall: true, apply: true });
    assert.equal(uninstallResult.status, 'UNAVAILABLE');
    assert.equal(uninstallResult.changed, true);

    // 7. Verify post-uninstall state
    const finalInspect = inspectClaude(baseOptions);
    assert.equal(finalInspect.state, 'MCP_NOT_CONFIGURED');
    assert.equal(finalInspect.owned, false);
  });

  it('supports project/workspace scope (.mcp.json) configuration and rollback', async () => {
    const { integrateClaude, inspectClaude } = await import(moduleUrl);

    const claudeConfigDir = join(tempRoot, 'claude-profile');
    const workspaceRoot = join(tempRoot, 'workspace');
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });

    const workspaceOptions = {
      claude: mockClaudeCmd,
      claudeConfigDir,
      workspaceRoot,
      node: process.execPath,
      entry: fakeServerScript,
      scope: 'workspace',
      server: 'afyx_graph',
      tool: 'afyx_graph_explore',
    };

    // Register at workspace scope
    const regResult = await integrateClaude({ ...workspaceOptions, apply: true });
    assert.equal(regResult.status, 'READY');
    assert.equal(regResult.nativeScope, 'project');

    // Check .mcp.json exists in workspaceRoot
    const mcpJson = join(workspaceRoot, '.mcp.json');
    assert.ok(existsSync(mcpJson));
    const doc = JSON.parse(readFileSync(mcpJson, 'utf8'));
    assert.ok(doc.mcpServers?.afyx_graph);

    // Clean up via uninstall
    const unResult = await integrateClaude({ ...workspaceOptions, uninstall: true, apply: true });
    assert.equal(unResult.status, 'UNAVAILABLE');
    assert.equal(unResult.changed, true);

    const afterDoc = JSON.parse(readFileSync(mcpJson, 'utf8'));
    assert.equal(afterDoc.mcpServers?.afyx_graph, undefined);
  });

  it('supports extension-only mode: standalone CLI absent, direct transactional MCP update, probe verify, and uninstall', async () => {
    const { integrateClaude, inspectClaude } = await import(moduleUrl);

    const claudeConfigDir = join(tempRoot, 'claude-ext-profile');
    const workspaceRoot = join(tempRoot, 'workspace-ext');
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });

    // Note: claude is undefined/omitted -> extension-only direct transactional mode
    const extOptions = {
      claudeConfigDir,
      workspaceRoot,
      node: process.execPath,
      entry: fakeServerScript,
      scope: 'global',
      server: 'afyx_graph',
      tool: 'afyx_graph_explore',
      extensionOnly: true,
    };

    // 1. Inspect without CLI
    const inspect1 = inspectClaude(extOptions);
    assert.equal(inspect1.state, 'MCP_NOT_CONFIGURED');
    assert.equal(inspect1.owned, false);

    // 2. Register in extension-only mode
    const regResult = await integrateClaude({ ...extOptions, apply: true });
    assert.equal(regResult.status, 'READY');
    assert.equal(regResult.changed, true);
    assert.match(regResult.detail, /Extension-only MCP configuration verified/);

    // 3. Inspect read-back
    const inspect2 = inspectClaude(extOptions);
    assert.equal(inspect2.state, 'MCP_CONFIGURED');
    assert.equal(inspect2.owned, true);

    // 4. Verify probe without CLI
    const verifyResult = await integrateClaude({ ...extOptions, operation: 'verify' });
    assert.equal(verifyResult.status, 'READY');
    assert.match(verifyResult.detail, /Extension-only MCP configuration verified/);

    // 5. Reinstall/Update in extension-only mode (idempotent when already configured)
    const updateResult = await integrateClaude({ ...extOptions, apply: true });
    assert.equal(updateResult.status, 'READY');

    // 6. Uninstall in extension-only mode
    const unResult = await integrateClaude({ ...extOptions, uninstall: true, apply: true });
    assert.equal(unResult.status, 'UNAVAILABLE');
    assert.equal(unResult.changed, true);

    // Post-uninstall inspect
    const inspect3 = inspectClaude(extOptions);
    assert.equal(inspect3.state, 'MCP_NOT_CONFIGURED');
  });

  it('preserves foreign MCP servers and blocks unowned entries in extension-only mode', async () => {
    const { integrateClaude, inspectClaude } = await import(moduleUrl);

    const claudeConfigDir = join(tempRoot, 'claude-foreign-profile');
    const workspaceRoot = join(tempRoot, 'workspace-foreign');
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });

    const globalConfigFile = join(claudeConfigDir, '.claude.json');
    // Pre-populate with unrelated foreign MCP server
    writeFileSync(
      globalConfigFile,
      JSON.stringify({
        customSetting: 'preserve-me',
        mcpServers: {
          sqlite_viewer: {
            command: 'sqlite-server',
            args: ['--db', 'app.db'],
          },
        },
      }, null, 2),
      'utf8'
    );

    const extOptions = {
      claudeConfigDir,
      workspaceRoot,
      node: process.execPath,
      entry: fakeServerScript,
      scope: 'global',
      server: 'afyx_graph',
      tool: 'afyx_graph_explore',
      extensionOnly: true,
    };

    // 1. Register AFYX
    const regResult = await integrateClaude({ ...extOptions, apply: true });
    assert.equal(regResult.status, 'READY');

    // Verify foreign setting and server are intact
    const docAfter = JSON.parse(readFileSync(globalConfigFile, 'utf8'));
    assert.equal(docAfter.customSetting, 'preserve-me');
    assert.deepEqual(docAfter.mcpServers.sqlite_viewer, {
      command: 'sqlite-server',
      args: ['--db', 'app.db'],
    });
    assert.ok(docAfter.mcpServers.afyx_graph);

    // 2. Uninstall AFYX
    const unResult = await integrateClaude({ ...extOptions, uninstall: true, apply: true });
    assert.equal(unResult.status, 'UNAVAILABLE');

    // Verify foreign setting and server remain after uninstall
    const docFinal = JSON.parse(readFileSync(globalConfigFile, 'utf8'));
    assert.equal(docFinal.customSetting, 'preserve-me');
    assert.deepEqual(docFinal.mcpServers.sqlite_viewer, {
      command: 'sqlite-server',
      args: ['--db', 'app.db'],
    });
    assert.equal(docFinal.mcpServers.afyx_graph, undefined);

    // 3. Test unowned foreign conflict
    writeFileSync(
      globalConfigFile,
      JSON.stringify({
        mcpServers: {
          afyx_graph: { command: 'foreign-binary', args: [] },
        },
      }, null, 2),
      'utf8'
    );
    const inspectForeign = inspectClaude(extOptions);
    assert.equal(inspectForeign.state, 'MCP_BLOCKED');
    const blockedResult = await integrateClaude({ ...extOptions, apply: true });
    assert.equal(blockedResult.status, 'BLOCKED');
    assert.equal(blockedResult.reason, 'FOREIGN_ENTRY');
  });

  it('fails closed on malformed configuration file', async () => {
    const { integrateClaude } = await import(moduleUrl);

    const claudeConfigDir = join(tempRoot, 'claude-malformed-profile');
    const workspaceRoot = join(tempRoot, 'workspace-malformed');
    mkdirSync(claudeConfigDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });

    const globalConfigFile = join(claudeConfigDir, '.claude.json');
    writeFileSync(globalConfigFile, '{ malformed json: not valid', 'utf8');

    const extOptions = {
      claudeConfigDir,
      workspaceRoot,
      node: process.execPath,
      entry: fakeServerScript,
      scope: 'global',
      server: 'afyx_graph',
      tool: 'afyx_graph_explore',
      extensionOnly: true,
    };

    const result = await integrateClaude({ ...extOptions, apply: true });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reason, 'INSPECTION_FAILED');
  });
});
