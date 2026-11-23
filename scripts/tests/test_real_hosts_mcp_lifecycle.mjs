import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { integrate as integrateCodex } from '../afyx-mcp-integration.mjs';
import {
  integrateAntigravity,
  inspectAntigravity,
} from '../afyx-provider-integration.mjs';
import {
  listProviderBackups,
  createConfigurationBackup,
  rollbackConfiguration,
  validateUnrelatedPreserved,
} from '../afyx-provider-backup.mjs';
import {
  discoverAfyxCapabilities,
  resolveAfyxCapabilityRoute,
  executeAfyxCapabilityRoute,
  SEVEN_REGISTERED_COMPONENT_IDS,
} from '../afyx-capability-orchestrator.mjs';
import { createInstalledHostAdapters } from '../afyx-host-adapters.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const GRAPH_ENTRY = resolve(REPO_ROOT, 'afyx-graph', 'engine', 'dist', 'bin', 'afyx-graph.js');

function resolveCodexExecutable() {
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(checkCmd, ['codex'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const lines = res.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (process.platform === 'win32') {
    return lines.find((l) => l.toLowerCase().endsWith('.cmd')) || lines[0];
  }
  return lines[0];
}

  function runCodexCli(codexExe, args, env = {}) {
  const isCmd = process.platform === 'win32' && codexExe.toLowerCase().endsWith('.cmd');
  if (isCmd) {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', `"${codexExe}"`, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(codexExe, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function createReadOnlyGraphFixture(parentDir) {
  const fixtureDir = join(parentDir, 'graph_fixture_' + randomBytes(4).toString('hex'));
  mkdirSync(join(fixtureDir, 'src'), { recursive: true });
  writeFileSync(
    join(fixtureDir, 'src', 'service.ts'),
    [
      'export function parseToken(raw: string) { return raw.trim(); }',
      'export class OrderService {',
      '  calculateTotal(qty: number, price: number) { return qty * price; }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };
  spawnSync('git', ['init', '-q'], { cwd: fixtureDir, env: gitEnv });
  spawnSync('git', ['add', '-A'], { cwd: fixtureDir, env: gitEnv });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'], { cwd: fixtureDir, env: gitEnv });

  const initRes = spawnSync(process.execPath, [GRAPH_ENTRY, 'init', '-y', fixtureDir], {
    cwd: fixtureDir,
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1' },
    encoding: 'utf8',
  });
  assert.equal(initRes.status, 0, `Graph fixture initialization failed: ${initRes.stderr || initRes.stdout}`);
  return fixtureDir;
}

async function runMcpClientSession(nodeExe, entryFile, args = ['serve', '--mcp'], fixtureDir = null) {
  return new Promise((res, rej) => {
    const clientCwd = fixtureDir || join(tmpdir(), 'afyx-mcp-session-' + randomBytes(4).toString('hex'));
    if (!fixtureDir) {
      mkdirSync(clientCwd, { recursive: true });
    }

    const launchArgs = entryFile ? [entryFile, ...args] : args;
    const child = spawn(nodeExe, launchArgs, {
      cwd: clientCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        AFYX_GRAPH_NO_DAEMON: '1',
        AFYX_GRAPH_NO_WATCH: '1',
        NO_COLOR: '1',
      },
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const responses = new Map();

    child.stderr.on('data', (d) => {
      stderrBuffer += d.toString('utf8');
    });

    child.stdout.on('data', (d) => {
      stdoutBuffer += d.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // retain partial line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id !== undefined) {
            responses.set(parsed.id, parsed);
          }
        } catch {
          // ignore non-json banner
        }
      }
    });

    child.on('error', rej);

    function sendRequest(id, method, params = {}) {
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      child.stdin.write(msg);
    }

    async function waitForResponse(id, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (responses.has(id)) return responses.get(id);
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`Timeout waiting for response id ${id}. Stderr: ${stderrBuffer}`);
    }

    async function execute() {
      // 1. initialize
      sendRequest(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'afyx-acceptance-test', version: '1.0.0' },
        rootUri: `file://${clientCwd.replace(/\\/g, '/')}`,
      });
      const initResp = await waitForResponse(1);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

      // 2. tools/list
      sendRequest(2, 'tools/list', {});
      const toolsResp = await waitForResponse(2);

      // 3. Real source-grounded tool call on the indexed fixture
      sendRequest(3, 'tools/call', {
        name: 'afyx_graph_explore',
        arguments: { query: 'OrderService' },
      });
      const callResp = await waitForResponse(3);

      child.stdin.end();
      child.kill();

      return {
        initResp,
        toolsResp,
        callResp,
      };
    }

    execute().then(res).catch(rej);
  });
}

describe('AFYX Native Provider MCP Lifecycle & Universal Interoperability Suite', () => {
  let tempRoot;
  let isolatedBackupRoot;

  test.beforeEach(() => {
    tempRoot = join(tmpdir(), 'afyx-provider-test-' + randomBytes(4).toString('hex'));
    isolatedBackupRoot = join(tempRoot, 'backups');
    mkdirSync(isolatedBackupRoot, { recursive: true });
    process.env.AFYX_BACKUP_ROOT = isolatedBackupRoot;
  });

  test.afterEach(() => {
    delete process.env.AFYX_BACKUP_ROOT;
    try {
      if (tempRoot && existsSync(tempRoot)) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  // ==========================================
  // CODEX NATIVE LIFECYCLE (P0)
  // ==========================================
  test('Codex P0: Native provider lifecycle with isolated CODEX_HOME and real Graph MCP execution', async (t) => {
    const codexExe = resolveCodexExecutable();
    if (!codexExe) {
      t.skip('Native Codex CLI not found on host');
      return;
    }

    const isolatedCodexHome = join(tempRoot, 'codex_home');
    mkdirSync(isolatedCodexHome, { recursive: true });
    const configPath = join(isolatedCodexHome, 'config.toml');

    const initialToml = [
      '# Operator custom preferences',
      'model = "gpt-4o"',
      'large_int = 9007199254740992',
      'float_val = 1.0',
      '',
      '[mcp_servers.preexisting_custom]',
      'url = "http://127.0.0.1:8080/mcp"',
      '',
      '[features]',
      'multi_agent = true',
      '',
    ].join('\n');
    writeFileSync(configPath, initialToml, 'utf8');

    // 1. Detection and Compatibility
    const verRes = runCodexCli(codexExe, ['--version']);
    assert.equal(verRes.status, 0, 'Codex CLI must respond to --version');
    assert.match(verRes.stdout, /codex-cli/i);

    // 2. Read-only discovery and installation planning (apply: false)
    const planResult = await integrateCodex({
      codex: codexExe,
      codexHome: isolatedCodexHome,
      node: process.execPath,
      entry: GRAPH_ENTRY,
      apply: false,
    });
    assert.equal(planResult.mcp, 'MCP_NOT_CONFIGURED');
    assert.equal(planResult.changed, false);
    assert.equal(readFileSync(configPath, 'utf8'), initialToml, 'Plan mode must not mutate config.toml');

    // 3. Persistent configuration backup before mutation & Native Registration
    const applyResult = await integrateCodex({
      codex: codexExe,
      codexHome: isolatedCodexHome,
      node: process.execPath,
      entry: GRAPH_ENTRY,
      apply: true,
    });
    if (applyResult.mcp !== 'MCP_REACHABLE') {
      console.error('applyResult diagnostic:', JSON.stringify(applyResult, null, 2));
    }
    assert.equal(applyResult.mcp, 'MCP_REACHABLE');
    assert.equal(applyResult.changed, true);

    // Verify backup retention in isolated backup root
    const backups = listProviderBackups('codex');
    assert.ok(backups.length >= 1, 'Backup must be recorded for codex');
    const bkp = backups[0];
    assert.ok(existsSync(bkp.backupPath), 'Backup file must exist on disk');
    assert.equal(readFileSync(bkp.backupPath, 'utf8'), initialToml, 'Backup must retain exact pre-modification bytes');

    // 4. Native MCP read-back via Codex CLI
    const getRes = runCodexCli(codexExe, ['mcp', 'get', 'afyx_graph'], { CODEX_HOME: isolatedCodexHome });
    assert.equal(getRes.status, 0, 'codex mcp get afyx_graph must succeed');
    const configuredToml = readFileSync(configPath, 'utf8');
    assert.ok(configuredToml.includes('afyx_graph'), 'config.toml must contain afyx_graph');

    // 5. Actual launch of the installed AFYX Graph MCP executable through registered command against read-only fixture
    const fixtureDir = createReadOnlyGraphFixture(tempRoot);
    const mcpSession = await runMcpClientSession(process.execPath, GRAPH_ENTRY, ['serve', '--mcp'], fixtureDir);
    assert.equal(mcpSession.initResp.result.serverInfo.name, 'afyx_graph');
    assert.ok(Array.isArray(mcpSession.toolsResp.result.tools));
    const toolNames = mcpSession.toolsResp.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('afyx_graph_explore'), `tools/list must include afyx_graph_explore, got: ${toolNames.join(', ')}`);

    // Strictly verify successful source-grounded tool execution: NEVER accept an error
    assert.equal(mcpSession.callResp.error, undefined, 'Tool call must not return JSON-RPC error');
    assert.notEqual(mcpSession.callResp.result?.isError, true, 'Tool call must not return application error');
    const contentText = mcpSession.callResp.result?.content?.map((c) => c.text || '').join('\n') || '';
    assert.ok(contentText.includes('OrderService'), `Tool call result must contain source-grounded symbol OrderService, got: ${contentText}`);

    // 6. Idempotent re-registration
    const reapplyResult = await integrateCodex({
      codex: codexExe,
      codexHome: isolatedCodexHome,
      node: process.execPath,
      entry: GRAPH_ENTRY,
      apply: true,
    });
    assert.equal(reapplyResult.mcp, 'MCP_REACHABLE');
    assert.equal(reapplyResult.changed, false, 'Re-registration without changes must be idempotent');

    // 7. Preservation of unrelated TOML keys and values
    const unrelatedCheck = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: Buffer.from(initialToml, 'utf8'),
      afterBytes: readFileSync(configPath),
      server: 'afyx_graph',
    });
    assert.equal(unrelatedCheck.preserved, true, 'Unrelated settings must be preserved under TOML normalization');

    // 8. Owned-entry uninstall
    const uninstallResult = await integrateCodex({
      codex: codexExe,
      codexHome: isolatedCodexHome,
      node: process.execPath,
      entry: GRAPH_ENTRY,
      uninstall: true,
      apply: true,
    });
    assert.equal(uninstallResult.mcp, 'MCP_NOT_CONFIGURED');
    assert.equal(uninstallResult.changed, true);

    const afterUninstallToml = readFileSync(configPath, 'utf8');
    assert.ok(!afterUninstallToml.includes('afyx_graph'), 'afyx_graph must be removed from config.toml');
    assert.ok(afterUninstallToml.includes('preexisting_custom'), 'preexisting_custom must remain');
    assert.ok(afterUninstallToml.includes('gpt-4o'), 'user model must remain');

    // 9. Rollback after simulated failure & 10. Concurrency protection
    const fakeBackup = createConfigurationBackup({
      provider: 'codex',
      configPath,
      operation: 'simulated-failure-test',
    });
    writeFileSync(configPath, 'external_concurrent_edit = true\n', 'utf8');
    const rollbackRes = rollbackConfiguration(fakeBackup, { reason: 'simulated error' });
    assert.equal(rollbackRes.restored, false, 'Rollback must refuse to overwrite concurrent external changes');
    assert.equal(rollbackRes.conflict, true);
  });

  // ==========================================
  // ANTIGRAVITY NATIVE LIFECYCLE (P1)
  // ==========================================
  test('Antigravity P1: Native provider lifecycle with global and workspace scope, explicit OFF, and read-back', async () => {
    const isolatedGeminiHome = join(tempRoot, 'gemini_home');
    const isolatedWorkspace = join(tempRoot, 'workspace');
    mkdirSync(join(isolatedGeminiHome, 'config'), { recursive: true });
    mkdirSync(join(isolatedWorkspace, '.agents'), { recursive: true });

    const globalConfigPath = join(isolatedGeminiHome, 'config', 'mcp_config.json');
    const initialGlobal = {
      user_preference: 'dark_mode',
      mcpServers: {
        user_foreign_tool: { command: 'node', args: ['other.js'] },
      },
    };
    writeFileSync(globalConfigPath, JSON.stringify(initialGlobal, null, 2), 'utf8');

    // 1. Global Scope: Plan mode
    const globalOptions = {
      scope: 'global',
      geminiHome: isolatedGeminiHome,
      node: process.execPath,
      entry: GRAPH_ENTRY,
      apply: false,
    };
    const globalPlan = await integrateAntigravity(globalOptions);
    assert.equal(globalPlan.status, 'DETECTED');
    assert.equal(globalPlan.changed, false);
    assert.equal(readFileSync(globalConfigPath, 'utf8'), JSON.stringify(initialGlobal, null, 2));

    // 2. Global Scope: Apply mode with Backup-First
    const globalApply = await integrateAntigravity({ ...globalOptions, apply: true });
    assert.equal(globalApply.status, 'CONFIGURED_RESTART_REQUIRED');
    assert.equal(globalApply.changed, true);

    const globalBackups = listProviderBackups('antigravity');
    assert.ok(globalBackups.length >= 1, 'Backup must be recorded for Antigravity');
    assert.ok(existsSync(globalBackups[0].backupPath));

    // 3. Provider MCP read-back and foreign entry preservation
    const afterGlobal = JSON.parse(readFileSync(globalConfigPath, 'utf8'));
    assert.equal(afterGlobal.user_preference, 'dark_mode');
    assert.ok(afterGlobal.mcpServers.user_foreign_tool, 'Foreign entry must be preserved');
    assert.ok(afterGlobal.mcpServers.afyx_graph, 'afyx_graph must be registered');

    // 4. Installed Graph MCP execution through the configured entry on read-only fixture
    const entryConfig = afterGlobal.mcpServers.afyx_graph;
    const agFixture = createReadOnlyGraphFixture(tempRoot);
    const antigravitySession = await runMcpClientSession(entryConfig.command, entryConfig.args[0], entryConfig.args.slice(1), agFixture);
    assert.equal(antigravitySession.initResp.result.serverInfo.name, 'afyx_graph');
    assert.ok(antigravitySession.toolsResp.result.tools.some((t) => t.name === 'afyx_graph_explore'));

    // Strictly verify successful source-grounded tool call for Antigravity:
    assert.equal(antigravitySession.callResp.error, undefined, 'Antigravity MCP tool call must not return JSON-RPC error');
    assert.notEqual(antigravitySession.callResp.result?.isError, true, 'Antigravity MCP tool call must not return application error');
    const agContentText = antigravitySession.callResp.result?.content?.map((c) => c.text || '').join('\n') || '';
    assert.ok(agContentText.includes('OrderService'), `Antigravity tool call result must contain source-grounded symbol OrderService, got: ${agContentText}`);

    // 5. Idempotent re-registration
    const reapplyGlobal = await integrateAntigravity({ ...globalOptions, apply: true });
    assert.equal(reapplyGlobal.changed, false, 'Re-apply without modification must not change file');

    // 6. Explicit user OFF (disabled: true)
    afterGlobal.mcpServers.afyx_graph.disabled = true;
    writeFileSync(globalConfigPath, JSON.stringify(afterGlobal, null, 2), 'utf8');

    const disabledInspection = inspectAntigravity(globalOptions);
    assert.equal(disabledInspection.state, 'MCP_DISABLED_OWNED');
    assert.equal(disabledInspection.owned, true);

    const tryApplyDisabled = await integrateAntigravity({ ...globalOptions, apply: true });
    assert.equal(tryApplyDisabled.status, 'BLOCKED');
    assert.equal(tryApplyDisabled.reason, 'EXPLICITLY_DISABLED');
    assert.equal(tryApplyDisabled.changed, false);

    // 7. Uninstall owned entry when disabled
    const uninstallGlobal = await integrateAntigravity({ ...globalOptions, apply: true, uninstall: true });
    assert.equal(uninstallGlobal.status, 'UNAVAILABLE');
    assert.equal(uninstallGlobal.changed, true);

    const finalGlobal = JSON.parse(readFileSync(globalConfigPath, 'utf8'));
    assert.equal(finalGlobal.mcpServers.afyx_graph, undefined, 'afyx_graph must be removed');
    assert.ok(finalGlobal.mcpServers.user_foreign_tool, 'Foreign tool must remain');

    // 8. Workspace Scope Handling
    const wsOptions = {
      scope: 'workspace',
      workspaceRoot: isolatedWorkspace,
      node: process.execPath,
      entry: GRAPH_ENTRY,
      apply: true,
    };
    const wsApply = await integrateAntigravity(wsOptions);
    assert.equal(wsApply.status, 'READY');
    assert.equal(wsApply.changed, true);

    const wsConfigPath = join(isolatedWorkspace, '.agents', 'mcp_config.json');
    assert.ok(existsSync(wsConfigPath), 'Workspace .agents/mcp_config.json must exist');
    const wsConfig = JSON.parse(readFileSync(wsConfigPath, 'utf8'));
    assert.ok(wsConfig.mcpServers.afyx_graph);

    const wsUninstall = await integrateAntigravity({ ...wsOptions, uninstall: true });
    assert.equal(wsUninstall.status, 'UNAVAILABLE');
    assert.equal(wsUninstall.changed, true);
  });

  // ==========================================
  // CODEX VS CODE L3 TEST SURFACE
  // ==========================================
  test('Codex VS Code Extension: Inspect L3 agent-mediated test surface availability', (t) => {
    const isWin = process.platform === 'win32';
    const checkCmd = isWin ? 'where.exe' : 'which';
    const hasCode = spawnSync(checkCmd, ['code'], { encoding: 'utf8' }).status === 0;
    if (!hasCode) {
      t.skip('VS Code is not installed on host — status: L3_NOT_TESTED');
      return;
    }

    const listRes = isWin
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', 'code.cmd', '--list-extensions', '--show-versions'], { encoding: 'utf8' })
      : spawnSync('code', ['--list-extensions', '--show-versions'], { encoding: 'utf8' });
    const lines = listRes.stdout ? listRes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];

    // Explicitly identify the installed openai.chatgpt extension providing Codex agent functionality
    const chatgptExt = lines.find((l) => l.toLowerCase().startsWith('openai.chatgpt@'));
    assert.ok(chatgptExt, 'openai.chatgpt extension (Codex coding agent) must be present in VS Code');

    // Codex audio extension is optional
    const audioExt = lines.find((l) => l.toLowerCase().startsWith('openai.codex-audio@'));

    // Distinguish:
    // 1. Extension presence: openai.chatgpt confirmed installed
    // 2. Running Codex backend: CLI 0.167.0 available; background app-server daemon socket is not running in background
    // 3. MCP registration: afyx_graph successfully registered in ~/.codex/config.toml
    // 4. Actual IDE-mediated tool execution: Extension UI is interactive webview only, exposing no headless automation surface
    // Unavailable GUI L3 surface must NOT be counted as executed PASS; mark as skipped/L3_NOT_VERIFIED
    t.skip('L3_NOT_VERIFIED: Interactive GUI session required; openai.chatgpt exposes no headless automation test surface');
  });

  // ==========================================
  // CLAUDE CODE (P2)
  // ==========================================
  test('Claude Code P2: Check host availability and report status honestly', (t) => {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    const checkRes = spawnSync(checkCmd, ['claude'], { encoding: 'utf8' });
    const isInstalled = checkRes.status === 0;

    if (!isInstalled) {
      t.skip('Claude Code is not installed on host — status: NOT TESTED (as designed)');
    } else {
      assert.ok(true, 'Claude Code is installed on host');
    }
  });

  // ==========================================
  // UNIVERSAL INTEROPERABILITY (AFYX-308/309)
  // ==========================================
  test('AFYX-308/309: Real representative interoperability across installed components', async () => {
    const PILOT_INSTALL_ROOT = 'D:/Project/afyx-alpha/afyx-305-exact-candidate/install-root';
    const PILOT_PROJECT_ROOT = 'D:/Project/afyx-alpha/afyx-305-exact-candidate/test-data/sample-project';
    const tempState = join(tempRoot, 'ctx-state');
    mkdirSync(tempState, { recursive: true });

    // 1. Simple known-file edit invokes ZERO Afyx runtime tools (directSourceFastPath)
    const directTask = {
      id: 'task-simple-edit',
      taskType: 'string-replacement',
      knownFile: true,
      exactKnownSource: true,
    };
    let calls = 0;
    const directResult = await executeAfyxCapabilityRoute({
      task: directTask,
      provider: 'codex',
      componentStates: Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, {
        installed: true, enabled: true, healthy: true, compatible: true, authorized: true,
      }])),
      adapters: Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, () => { calls += 1; return { status: 'SUCCESS' }; }])),
    });
    assert.equal(directResult.directSourceFastPath, true);
    assert.equal(directResult.executionStatus, 'DIRECT_SOURCE');
    assert.equal(directResult.metrics.executedCapabilities, 0);
    assert.equal(calls, 0);

    // 2. Real installed adapters for Odoo -> Graph -> Context handoff
    const pilotAdapters = createInstalledHostAdapters({
      installRoot: PILOT_INSTALL_ROOT,
      projectRoot: PILOT_PROJECT_ROOT,
      stateRoot: tempState,
    });

    const odooHandoff = await pilotAdapters['odoo-engineering']({
      targetComponentId: 'odoo-engineering',
      intent: 'Audit sale.order inheritance models in addons',
    });
    assert.equal(odooHandoff.status, 'SUCCESS');
    assert.ok(odooHandoff.followUpRequests?.some((r) => r.targetComponentId === 'afyx-graph'));

    const graphHandoff = await pilotAdapters['afyx-graph'](odooHandoff.followUpRequests[0]);
    assert.equal(graphHandoff.status, 'SUCCESS');
    assert.ok(graphHandoff.output?.includes('sale.order') || graphHandoff.evidence?.length > 0);

    const contextHandoff = await pilotAdapters['afyx-context']({
      targetComponentId: 'afyx-context',
      payload: 'sample graph evidence line\n'.repeat(1500),
    });
    assert.equal(contextHandoff.status, 'SUCCESS');
    assert.equal(contextHandoff.output?.mode, 'optimized');
    assert.ok(contextHandoff.output?.metrics?.reductionRatio > 0.5);

    // 3. Graceful degradation: missing component degrades to direct source
    const degradedResult = await executeAfyxCapabilityRoute({
      task: { id: 'task-impact', taskType: 'impact-analysis', needsRelationalEvidence: true },
      provider: 'codex',
      componentStates: {
        'efficient-coding': { installed: true, enabled: true, healthy: true, compatible: true, authorized: true },
      },
    });
    assert.equal(degradedResult.status, 'DEGRADED');
    assert.equal(degradedResult.executionStatus, 'NOT_RUN');
    assert.ok(degradedResult.degradations.some((d) => d.componentId === 'afyx-graph'));
    const graphDegradation = degradedResult.degradations.find((d) => d.componentId === 'afyx-graph');
    assert.equal(graphDegradation?.fallback, 'DIRECT_SOURCE');

    // 4. Explicit Context OFF (AFYX_CONTEXT_OPT_IN=0)
    const offAdapters = createInstalledHostAdapters({
      installRoot: PILOT_INSTALL_ROOT,
      projectRoot: PILOT_PROJECT_ROOT,
      stateRoot: tempState,
      environment: { AFYX_CONTEXT_OPT_IN: '0' },
    });
    const offRes = await offAdapters['afyx-context']({
      targetComponentId: 'afyx-context',
      payload: 'line\n'.repeat(500),
    });
    assert.equal(offRes.status, 'FAILED');
    assert.equal(offRes.reason, 'EXPLICITLY_DISABLED');

    // 5. Forge A8 Governance restriction: autonomous campaign blocked
    const autonomousRes = await pilotAdapters['afyx-forge']({
      targetComponentId: 'afyx-forge',
      taskType: 'autonomous-campaign',
      intent: 'Execute autonomous campaign',
    });
    assert.equal(autonomousRes.status, 'FAILED');
    assert.ok(autonomousRes.reason?.includes('FORGE_A8_REQUIRED'));
  });
});
