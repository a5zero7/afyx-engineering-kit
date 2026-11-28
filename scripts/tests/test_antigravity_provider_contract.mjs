import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  inspectAntigravity,
  inspectHistoricalAntigravityWorkspace,
  integrateAntigravity,
  migrateHistoricalAntigravityWorkspace,
  providerAdapters,
  runProviderLifecycle,
} from '../afyx-provider-integration.mjs';
import { resolveMcpProjectRoot } from '../afyx-host-bridge.mjs';
import { installHostBridge } from '../afyx-host-bridge-lifecycle.mjs';
import { PACKAGE_ROOT, subprocessEnvironment } from '../afyx-npm-installer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..');
const HOST_BRIDGE = resolve(SCRIPTS, 'afyx-host-bridge.mjs');

function makeFakeServer(entryPath, toolName = 'afyx_graph_explore') {
  mkdirSync(dirname(entryPath), { recursive: true });
  writeFileSync(
    entryPath,
    [
      "const readline = require('node:readline');",
      'const rl = readline.createInterface({ input: process.stdin });',
      'rl.on("line", (line) => {',
      '  const msg = JSON.parse(line);',
      '  if (msg.id === 1) console.log(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1.0.0" } } }));',
      `  if (msg.id === 2) console.log(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: ${JSON.stringify(toolName)} }] } }));`,
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
}

function makeFixture(t) {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'afyx-ag-contract-'));
  const backupRoot = join(root, 'backups');
  mkdirSync(backupRoot, { recursive: true });
  const prevBackup = process.env.AFYX_BACKUP_ROOT;
  process.env.AFYX_BACKUP_ROOT = backupRoot;
  t.after(() => {
    if (prevBackup === undefined) delete process.env.AFYX_BACKUP_ROOT;
    else process.env.AFYX_BACKUP_ROOT = prevBackup;
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });
  const geminiHome = join(root, 'gemini');
  const workspaceRoot = join(root, 'workspace-a');
  const workspaceB = join(root, 'workspace-b');
  const installRoot = join(root, 'install');
  const entry = join(installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(workspaceB, { recursive: true });
  makeFakeServer(entry);
  return { root, backupRoot, geminiHome, workspaceRoot, workspaceB, installRoot, entry };
}

test('1. Antigravity global MCP registration targets ~/.gemini/config/mcp_config.json and is idempotent', async (t) => {
  const fx = makeFixture(t);
  const globalConfig = join(fx.geminiHome, 'config', 'mcp_config.json');
  mkdirSync(dirname(globalConfig), { recursive: true });
  const initial = { theme: 'midnight', mcpServers: { third_party: { command: 'python', args: ['srv.py'] } } };
  writeFileSync(globalConfig, JSON.stringify(initial, null, 2), 'utf8');

  const opts = {
    providers: ['antigravity'],
    scope: 'global',
    geminiHome: fx.geminiHome,
    workspaceRoot: fx.workspaceRoot,
    node: process.execPath,
    entry: fx.entry,
    apply: true,
  };

  const first = await runProviderLifecycle(opts);
  assert.equal(first.status, 'CONFIGURED_RESTART_REQUIRED');
  assert.equal(first.providers[0].changed, true);
  assert.equal(first.providers[0].configPath, resolve(globalConfig));

  const doc = JSON.parse(readFileSync(globalConfig, 'utf8'));
  assert.equal(doc.theme, 'midnight');
  assert.deepEqual(doc.mcpServers.third_party, initial.mcpServers.third_party);
  assert.ok(doc.mcpServers.afyx_graph);
  assert.deepEqual(doc.mcpServers.afyx_graph.args.slice(1), ['serve', '--mcp']);

  const second = await runProviderLifecycle(opts);
  assert.equal(second.status, 'CONFIGURED_RESTART_REQUIRED');
  assert.equal(second.providers[0].changed, false);
});

test('2. Antigravity workspace MCP registration is rejected with PROVIDER_SCOPE_UNSUPPORTED, zero writes, and no silent global redirect', async (t) => {
  const fx = makeFixture(t);
  const wsConfig = join(fx.workspaceRoot, '.agents', 'mcp_config.json');
  const globalConfig = join(fx.geminiHome, 'config', 'mcp_config.json');

  const direct = await integrateAntigravity({
    scope: 'workspace',
    workspaceRoot: fx.workspaceRoot,
    geminiHome: fx.geminiHome,
    node: process.execPath,
    entry: fx.entry,
    apply: true,
  });
  assert.equal(direct.status, 'INCOMPATIBLE');
  assert.equal(direct.reason, 'PROVIDER_SCOPE_UNSUPPORTED');
  assert.equal(direct.changed, false);
  assert.equal(existsSync(wsConfig), false);
  assert.equal(existsSync(globalConfig), false);

  const lifecycle = await runProviderLifecycle({
    providers: ['antigravity'],
    scope: 'workspace',
    workspaceRoot: fx.workspaceRoot,
    geminiHome: fx.geminiHome,
    node: process.execPath,
    entry: fx.entry,
    apply: true,
  });
  assert.equal(lifecycle.status, 'BLOCKED');
  assert.equal(lifecycle.providers[0].status, 'INCOMPATIBLE');
  assert.equal(lifecycle.providers[0].reason, 'PROVIDER_SCOPE_UNSUPPORTED');
  assert.equal(lifecycle.providers[0].changed, false);
  assert.equal(existsSync(wsConfig), false);
  assert.equal(existsSync(globalConfig), false);
});

test('3. Historical AFYX-owned .agents/mcp_config.json: inspect, explicit migrate, and uninstall preserve foreign entries and block foreign targets', async (t) => {
  const fx = makeFixture(t);
  const wsConfig = join(fx.workspaceRoot, '.agents', 'mcp_config.json');
  const wsOwnership = `${wsConfig}.afyx-ownership.json`;
  mkdirSync(dirname(wsConfig), { recursive: true });
  const ownedEntry = { command: process.execPath, args: [fx.entry, 'serve', '--mcp'] };
  writeFileSync(
    wsConfig,
    JSON.stringify({
      keepSetting: true,
      mcpServers: {
        foreign_mcp: { command: 'foreign-bin', args: ['--serve'] },
        afyx_graph: ownedEntry,
      },
    }, null, 2),
    'utf8',
  );
  writeFileSync(
    wsOwnership,
    JSON.stringify({
      schemaVersion: 1,
      entries: {
        afyx_graph: { provider: 'antigravity', configPath: resolve(wsConfig), entry: ownedEntry },
      },
    }, null, 2),
    'utf8',
  );

  // Inspection detects historical owned workspace MCP without mutating it
  const hist = inspectHistoricalAntigravityWorkspace({ workspaceRoot: fx.workspaceRoot });
  assert.equal(hist.state, 'HISTORICAL_OWNED');
  assert.equal(hist.owned, true);
  assert.equal(hist.hasForeignEntries, true);

  const globalInspect = inspectAntigravity({
    scope: 'global',
    geminiHome: fx.geminiHome,
    workspaceRoot: fx.workspaceRoot,
    node: process.execPath,
    entry: fx.entry,
  });
  assert.equal(globalInspect.historicalWorkspace.state, 'HISTORICAL_OWNED');

  // Explicit migration registers global and removes ONLY owned workspace entry while preserving foreign_mcp
  const migrated = await migrateHistoricalAntigravityWorkspace({
    geminiHome: fx.geminiHome,
    workspaceRoot: fx.workspaceRoot,
    node: process.execPath,
    entry: fx.entry,
    apply: true,
  });
  assert.equal(migrated.status, 'CONFIGURED_RESTART_REQUIRED');
  assert.equal(migrated.changed, true);
  assert.equal(migrated.historicalWorkspace.state, 'HISTORICAL_MIGRATED');

  const globalDoc = JSON.parse(readFileSync(join(fx.geminiHome, 'config', 'mcp_config.json'), 'utf8'));
  assert.ok(globalDoc.mcpServers.afyx_graph);

  const wsDocAfter = JSON.parse(readFileSync(wsConfig, 'utf8'));
  assert.equal(wsDocAfter.keepSetting, true);
  assert.deepEqual(wsDocAfter.mcpServers.foreign_mcp, { command: 'foreign-bin', args: ['--serve'] });
  assert.equal(wsDocAfter.mcpServers.afyx_graph, undefined);
  assert.equal(existsSync(wsOwnership), false);

  // Foreign entry with name afyx_graph in historical .agents/mcp_config.json MUST be blocked and preserved
  const foreignWs = { mcpServers: { afyx_graph: { command: 'python', args: ['custom_graph.py'] } } };
  writeFileSync(wsConfig, JSON.stringify(foreignWs, null, 2), 'utf8');
  const foreignHist = inspectHistoricalAntigravityWorkspace({ workspaceRoot: fx.workspaceRoot });
  assert.equal(foreignHist.state, 'HISTORICAL_FOREIGN');
  assert.equal(foreignHist.owned, false);

  const blockedMigrate = await migrateHistoricalAntigravityWorkspace({
    geminiHome: fx.geminiHome,
    workspaceRoot: fx.workspaceRoot,
    node: process.execPath,
    entry: fx.entry,
    apply: true,
  });
  assert.equal(blockedMigrate.status, 'BLOCKED');
  assert.equal(blockedMigrate.reason, 'FOREIGN_ENTRY');
  assert.deepEqual(JSON.parse(readFileSync(wsConfig, 'utf8')), foreignWs);
});

test('4. Historical workspace uninstall via scope=workspace safely removes owned entry and preserves foreign entries', async (t) => {
  const fx = makeFixture(t);
  const wsConfig = join(fx.workspaceRoot, '.agents', 'mcp_config.json');
  const wsOwnership = `${wsConfig}.afyx-ownership.json`;
  mkdirSync(dirname(wsConfig), { recursive: true });
  const ownedEntry = { command: process.execPath, args: [fx.entry, 'serve', '--mcp'] };
  writeFileSync(
    wsConfig,
    JSON.stringify({ mcpServers: { foreign: { command: 'x' }, afyx_graph: ownedEntry } }, null, 2),
    'utf8',
  );
  writeFileSync(
    wsOwnership,
    JSON.stringify({
      schemaVersion: 1,
      entries: { afyx_graph: { provider: 'antigravity', configPath: resolve(wsConfig), entry: ownedEntry } },
    }, null, 2),
    'utf8',
  );

  const uninstalled = await runProviderLifecycle({
    providers: ['antigravity'],
    scope: 'workspace',
    workspaceRoot: fx.workspaceRoot,
    geminiHome: fx.geminiHome,
    node: process.execPath,
    entry: fx.entry,
    uninstall: true,
    apply: true,
  });
  assert.equal(uninstalled.status, 'READY');
  assert.equal(uninstalled.providers[0].changed, true);
  assert.deepEqual(JSON.parse(readFileSync(wsConfig, 'utf8')), { mcpServers: { foreign: { command: 'x' } } });
});

test('5. Global MCP project isolation: afyx_workflow omits stale --project-root, resolves active workspace dynamically, and fails closed without project context', async (t) => {
  const fx = makeFixture(t);
  const bridgeRoot = join(fx.installRoot, 'host-bridge');
  const installed = installHostBridge({ sourceRoot: SCRIPTS, runtimeRoot: bridgeRoot, sourceRevision: 'iso-test' });
  assert.equal(installed.status, 'READY');

  const applied = await runProviderLifecycle({
    providers: ['antigravity'],
    scope: 'global',
    geminiHome: fx.geminiHome,
    workspaceRoot: fx.workspaceRoot,
    node: process.execPath,
    entry: installed.entry,
    server: 'afyx_workflow',
    mode: 'workflow',
    installRoot: fx.installRoot,
    authorize: 'afyx-graph,afyx-context',
    tool: 'afyx_workflow',
    apply: true,
  });
  assert.equal(applied.status, 'CONFIGURED_RESTART_REQUIRED');
  const globalConfig = JSON.parse(readFileSync(join(fx.geminiHome, 'config', 'mcp_config.json'), 'utf8'));
  const workflowArgs = globalConfig.mcpServers.afyx_workflow.args;
  assert.equal(workflowArgs.includes('--project-root'), false, 'global afyx_workflow must not hardcode --project-root');

  // Direct unit check on resolveMcpProjectRoot
  assert.equal(
    resolveMcpProjectRoot({ clientRoot: fx.workspaceB, cwd: fx.workspaceRoot, installRoot: fx.installRoot }),
    resolve(fx.workspaceB),
  );
  assert.equal(
    resolveMcpProjectRoot({ cwd: fx.workspaceRoot, installRoot: fx.installRoot }),
    resolve(fx.workspaceRoot),
  );
  assert.throws(
    () => resolveMcpProjectRoot({ cwd: homedir(), installRoot: fx.installRoot }),
    /PROJECT_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () => resolveMcpProjectRoot({ cwd: tmpdir(), installRoot: fx.installRoot }),
    /PROJECT_CONTEXT_REQUIRED/,
  );
  assert.throws(
    () => resolveMcpProjectRoot({ cwd: fx.installRoot, installRoot: fx.installRoot }),
    /PROJECT_CONTEXT_REQUIRED/,
  );

  // Live stdio MCP check: launch global afyx_workflow without --project-root in homedir() -> fails closed; with rootUri -> resolves Workspace B!
  async function callWorkflowMcp({ cwd, rootUri }) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [
        HOST_BRIDGE, 'serve', '--mcp',
        '--install-root', fx.installRoot,
        '--provider', 'antigravity',
        '--authorize', 'afyx-graph,afyx-context',
      ], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, AFYX_PROJECT_ROOT: '' },
      });
      let buf = '';
      const responses = new Map();
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        rejectPromise(new Error('MCP call timed out'));
      }, 10000);
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id !== undefined) responses.set(parsed.id, parsed);
          } catch {}
        }
        if (responses.has(1) && !responses.has(2)) {
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'afyx_workflow',
              arguments: {
                projectRoot: fx.workspaceRoot, // untrusted model arg must be ignored!
                task: { taskType: 'string-replacement', exactKnownSource: true, path: 'a.js' },
              },
            },
          }) + '\n');
        }
        if (responses.has(2)) {
          clearTimeout(timer);
          try { child.stdin.end(); child.kill(); } catch {}
          resolvePromise(responses.get(2));
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        rejectPromise(err);
      });
      const initParams = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } };
      if (rootUri) initParams.rootUri = rootUri;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initParams }) + '\n');
    });
  }

  const noContextResp = await callWorkflowMcp({ cwd: homedir(), rootUri: null });
  assert.ok(noContextResp.error, 'Global MCP launched in unscoped homedir without rootUri must fail closed');
  assert.match(noContextResp.error.message, /PROJECT_CONTEXT_REQUIRED/);

  const wsBResp = await callWorkflowMcp({ cwd: homedir(), rootUri: pathToFileURL(fx.workspaceB).href });
  assert.equal(wsBResp.error, undefined);
  assert.equal(wsBResp.result.structuredContent.host.projectRoot, resolve(fx.workspaceB));
});

test('6. Windows installer rejects Antigravity workspace MCP before any mutation, but preserves workspace-only skills with -SkipGraphMcp and global skills under ~/.gemini/config/skills', { skip: process.platform !== 'win32' }, (t) => {
  const fx = makeFixture(t);
  const fakeBin = join(fx.root, 'fake-bin');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'agy.cmd'), '@echo agy 1.0.0\r\n@exit /b 0\r\n', 'utf8');

  const env = {
    ...process.env,
    USERPROFILE: fx.root,
    HOME: fx.root,
    AFYX_GEMINI_HOME: fx.geminiHome,
    AFYX_INSTALL_ROOT: fx.installRoot,
    AFYX_GRAPH_RUNTIME_ROOT: join(fx.installRoot, 'graph'),
    AFYX_CONTEXT_RUNTIME_ROOT: join(fx.installRoot, 'context'),
    AFYX_FORGE_RUNTIME_ROOT: join(fx.installRoot, 'forge'),
    AFYX_HOST_BRIDGE_RUNTIME_ROOT: join(fx.installRoot, 'host-bridge'),
    AFYX_BACKUP_ROOT: fx.backupRoot,
    CI: '1',
    NO_COLOR: '1',
  };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
  env[pathKey] = `${fakeBin};${env[pathKey]}`;

  // 6a. Workspace MCP request MUST fail closed with PROVIDER_SCOPE_UNSUPPORTED and ZERO partial skill/config writes
  const rejected = spawnSync('pwsh', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(PACKAGE_ROOT, 'install.ps1'),
    '-Preset', 'minimal', '-Provider', 'antigravity', '-ProviderScope', 'workspace',
    '-WorkspaceRoot', fx.workspaceRoot, '-GeminiHome', fx.geminiHome, '-Confirm:$false',
  ], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: subprocessEnvironment('pwsh', env) });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr + rejected.stdout, /PROVIDER_SCOPE_UNSUPPORTED/);
  assert.equal(existsSync(join(fx.workspaceRoot, '.agents', 'mcp_config.json')), false);
  assert.equal(existsSync(join(fx.workspaceRoot, '.agents', 'skills', 'afyx-efficient-coding')), false, 'must not install partial skills when workspace MCP is rejected');
  assert.equal(existsSync(join(fx.geminiHome, 'config', 'mcp_config.json')), false, 'must not silently redirect to global');

  // 6b. Workspace-only skills with -SkipGraphMcp succeeds cleanly with ZERO MCP writes
  const wsSkills = spawnSync('pwsh', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(PACKAGE_ROOT, 'install.ps1'),
    '-Preset', 'minimal', '-Provider', 'antigravity', '-ProviderScope', 'workspace',
    '-WorkspaceRoot', fx.workspaceRoot, '-GeminiHome', fx.geminiHome, '-SkipGraphMcp', '-Confirm:$false',
  ], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: subprocessEnvironment('pwsh', env) });
  assert.equal(wsSkills.status, 0, wsSkills.stdout + wsSkills.stderr);
  assert.equal(existsSync(join(fx.workspaceRoot, '.agents', 'skills', 'afyx-efficient-coding', 'SKILL.md')), true);
  assert.equal(existsSync(join(fx.workspaceRoot, '.agents', 'mcp_config.json')), false);
  assert.equal(existsSync(join(fx.geminiHome, 'config', 'mcp_config.json')), false);

  // 6c. Global Antigravity skill projection targets ~/.gemini/config/skills/
  const globalSkills = spawnSync('pwsh', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(PACKAGE_ROOT, 'install.ps1'),
    '-Preset', 'minimal', '-Provider', 'antigravity', '-ProviderScope', 'global',
    '-WorkspaceRoot', fx.workspaceRoot, '-GeminiHome', fx.geminiHome, '-SkipGraphMcp', '-Confirm:$false',
  ], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: subprocessEnvironment('pwsh', env) });
  assert.equal(globalSkills.status, 0, globalSkills.stdout + globalSkills.stderr);
  assert.equal(existsSync(join(fx.geminiHome, 'config', 'skills', 'afyx-efficient-coding', 'SKILL.md')), true);
});

test('7. Capability contract keeps Codex global-only, Antigravity global MCP + workspace skills, and Claude global+workspace unchanged', () => {
  const codex = providerAdapters.codex.discover();
  const antigravity = providerAdapters.antigravity.discover();
  const claude = providerAdapters.claude.discover();

  assert.deepEqual(codex.scopes.mcp, ['global']);
  assert.deepEqual(antigravity.scopes.mcp, ['global']);
  assert.deepEqual(antigravity.scopes.skills, ['ide-global', 'cli-global', 'workspace']);
  assert.deepEqual(claude.scopes.mcp, ['global', 'workspace']);
});
