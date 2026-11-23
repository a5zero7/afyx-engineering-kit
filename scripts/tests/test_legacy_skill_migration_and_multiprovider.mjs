import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI_BIN = resolve(REPO_ROOT, 'bin', 'afyx-engineering-kit.mjs');

test('Multi-provider lifecycle with legacy skill auto-migration and foreign preservation', { timeout: 180_000 }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-alpha10-multiprovider-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  const skillsRoot = join(root, '.agents', 'skills');
  const codexHome = join(root, '.codex');
  const geminiHome = join(root, '.gemini');
  const claudeHome = join(root, '.claude');
  const backupRoot = join(root, '.afyx', 'backups');

  mkdirSync(skillsRoot, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(join(geminiHome, 'config'), { recursive: true });
  mkdirSync(join(geminiHome, 'antigravity'), { recursive: true });
  mkdirSync(claudeHome, { recursive: true });
  mkdirSync(join(root, '.vscode', 'extensions', 'anthropic.claude-code-1.0.0'), { recursive: true });

  // Pre-populate empty configs
  writeFileSync(join(codexHome, 'config.toml'), '# test codex config\n', 'utf8');
  writeFileSync(join(geminiHome, 'config', 'mcp_config.json'), '{"mcpServers":{}}\n', 'utf8');
  writeFileSync(join(claudeHome, '.claude.json'), '{"mcpServers":{}}\n', 'utf8');

  const legacyEfficientDir = join(skillsRoot, 'efficient-coding');
  const legacyOdooDir = join(skillsRoot, 'odoo-engineering');
  for (const [name, dest] of [['efficient-coding', legacyEfficientDir], ['odoo-engineering', legacyOdooDir]]) {
    cpSync(join(HERE, 'fixtures', 'legacy-' + name + '-1.1.0'), dest, { recursive: true });
  }

  // Pre-populate unrelated foreign skill (must NEVER be modified or deleted)
  const foreignDir = join(skillsRoot, '1password');
  mkdirSync(foreignDir, { recursive: true });
  const foreignContent = '---\nname: 1password\nversion: 8.10.0\ndescription: User 1password skill\n---\n# Private user configuration\n';
  writeFileSync(join(foreignDir, 'SKILL.md'), foreignContent, 'utf8');
  writeFileSync(join(foreignDir, 'private.key'), 'SECRET_DATA_DO_NOT_TOUCH\n', 'utf8');

  const profileEnv = {
    ...process.env,
    USERPROFILE: root,
    HOME: root,
    APPDATA: join(root, 'roaming'),
    LOCALAPPDATA: join(root, 'local'),
    CODEX_HOME: codexHome,
    AFYX_GEMINI_HOME: geminiHome,
    CLAUDE_CONFIG_DIR: claudeHome,
    CLAUDE_HOME: claudeHome,
    AFYX_BACKUP_ROOT: backupRoot,
    AFYX_INSTALL_ROOT: join(root, '.afyx'),
    AFYX_GRAPH_RUNTIME_ROOT: join(root, '.afyx', 'graph'),
    AFYX_CONTEXT_RUNTIME_ROOT: join(root, '.afyx', 'context'),
    AFYX_FORGE_RUNTIME_ROOT: join(root, '.afyx', 'forge'),
    AFYX_HOST_BRIDGE_RUNTIME_ROOT: join(root, '.afyx', 'host-bridge'),
    CI: '1',
    NO_COLOR: '1',
  };

  // 1. Install --preset full with multi-provider (NO --skip-provider-configuration)
  const installResult = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      'install',
      '--preset', 'full',
      '--provider', 'antigravity,claude,codex',
      '--no-build-fallback',
      '--non-interactive',
    ],
    {
      env: profileEnv,
      encoding: 'utf8',
      timeout: 120_000,
      cwd: REPO_ROOT,
    }
  );

  assert.equal(
    installResult.status,
    0,
    `install failed with code ${installResult.status}:\nSTDOUT:\n${installResult.stdout}\nSTDERR:\n${installResult.stderr}`
  );

  // Assert legacy skills are migrated & removed
  assert.equal(existsSync(legacyEfficientDir), false, 'legacy efficient-coding must be removed');
  assert.equal(existsSync(legacyOdooDir), false, 'legacy odoo-engineering must be removed');

  // Assert canonical skills installed
  const canonicalEfficient = join(skillsRoot, 'afyx-efficient-coding');
  const canonicalOdoo = join(skillsRoot, 'afyx-odoo-engineering');
  assert.equal(existsSync(canonicalEfficient), true, 'canonical afyx-efficient-coding must be installed');
  assert.equal(existsSync(canonicalOdoo), true, 'canonical afyx-odoo-engineering must be installed');
  assert.equal(existsSync(join(canonicalEfficient, '.afyx-install.json')), true, 'canonical marker must exist');
  assert.equal(existsSync(join(canonicalOdoo, '.afyx-install.json')), true, 'canonical marker must exist');

  // Assert foreign skill is 100% intact
  assert.equal(existsSync(join(foreignDir, 'SKILL.md')), true, 'foreign 1password skill must be preserved');
  assert.equal(existsSync(join(foreignDir, 'private.key')), true, 'foreign files must not be touched');

  // Assert verifiable backup exists
  assert.equal(existsSync(join(backupRoot, 'afyx-efficient-coding')), true, 'backup for efficient-coding must exist');
  assert.equal(existsSync(join(backupRoot, 'afyx-odoo-engineering')), true, 'backup for odoo-engineering must exist');

  // Assert companion skills materialized across all provider skill roots
  const companionRoots = [
    skillsRoot,
    join(codexHome, 'skills'),
    join(geminiHome, 'config', 'skills'),
    join(geminiHome, 'antigravity', 'skills'),
    join(geminiHome, 'antigravity-cli', 'skills'),
    join(claudeHome, 'skills'),
  ];
  for (const cRoot of companionRoots) {
    assert.equal(existsSync(join(cRoot, 'afyx-context', 'SKILL.md')), true, `afyx-context companion must exist in ${cRoot}`);
    assert.equal(existsSync(join(cRoot, 'afyx-forge', 'SKILL.md')), true, `afyx-forge companion must exist in ${cRoot}`);
  }

  // Assert 7/7 Usage Tracker runtime files installed
  const usageRuntimeFiles = [
    'CodexUsage.psm1',
    'codex-usage-stop.ps1',
    'codex-usage-watch.ps1',
    'codex-usage-doctor.ps1',
    'codex-usage-pricing.json',
    'codex-usage-present.ps1',
    'AfyxUsageIntelligence.psm1',
  ];
  for (const uFile of usageRuntimeFiles) {
    assert.equal(existsSync(join(codexHome, 'tools', uFile)), true, `Usage tracker runtime file ${uFile} must exist`);
  }

  // 2. Verify --preset full (NO --skip-provider-configuration)
  const verifyResult = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      'verify',
      '--preset', 'full',
      '--provider', 'antigravity,claude,codex',
    ],
    {
      env: profileEnv,
      encoding: 'utf8',
      timeout: 60_000,
      cwd: REPO_ROOT,
    }
  );

  assert.equal(
    verifyResult.status,
    0,
    `verify failed with code ${verifyResult.status}:\nSTDOUT:\n${verifyResult.stdout}\nSTDERR:\n${verifyResult.stderr}`
  );

  assert.match(verifyResult.stdout, /Afyx Efficient Coding/);
  assert.match(verifyResult.stdout, /Afyx Odoo Engineering/);
  assert.match(verifyResult.stdout, /Afyx Engineering Expert/);
  assert.match(verifyResult.stdout, /Afyx workflow MCP/);
  assert.match(verifyResult.stdout, /Core readiness/);

  // 3. Update
  const updateResult = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      'update',
      '--preset', 'full',
      '--provider', 'antigravity,claude,codex',
      '--skip-self-update',
      '--no-build-fallback',
      '--non-interactive',
    ],
    {
      env: profileEnv,
      encoding: 'utf8',
      timeout: 60_000,
      cwd: REPO_ROOT,
    }
  );

  assert.equal(
    updateResult.status,
    0,
    `update failed with code ${updateResult.status}:\nSTDOUT:\n${updateResult.stdout}\nSTDERR:\n${updateResult.stderr}`
  );

  // 4. Uninstall
  const uninstallResult = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      'uninstall',
      '--provider', 'antigravity,claude,codex',
      '--remove-provider-configuration',
      '--remove-afyx-graph',
      '--remove-afyx-context',
      '--remove-afyx-forge',
      '--non-interactive',
    ],
    {
      env: profileEnv,
      encoding: 'utf8',
      timeout: 60_000,
      cwd: REPO_ROOT,
    }
  );

  assert.equal(
    uninstallResult.status,
    0,
    `uninstall failed with code ${uninstallResult.status}:\nSTDOUT:\n${uninstallResult.stdout}\nSTDERR:\n${uninstallResult.stderr}`
  );

  // Foreign skill still preserved after uninstall
  assert.equal(existsSync(join(foreignDir, 'SKILL.md')), true, 'foreign 1password skill must still be intact after uninstall');
});

test('Scenario B: Upgrade existing installation with unowned AFYX MCP adoption, missing companion backfill, and clean verification', { timeout: 180_000 }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-alpha11-upgrade-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  const skillsRoot = join(root, '.agents', 'skills');
  const codexHome = join(root, '.codex');
  const geminiHome = join(root, '.gemini');
  const claudeHome = join(root, '.claude');
  const backupRoot = join(root, '.afyx', 'backups');

  mkdirSync(skillsRoot, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(join(geminiHome, 'config'), { recursive: true });
  mkdirSync(join(geminiHome, 'antigravity'), { recursive: true });
  mkdirSync(claudeHome, { recursive: true });
  mkdirSync(join(root, '.vscode', 'extensions', 'anthropic.claude-code-1.0.0'), { recursive: true });

  // Pre-populate configs with unowned AFYX entries and foreign entries
  writeFileSync(
    join(codexHome, 'config.toml'),
    '# test codex config\n[mcp_servers.github]\ncommand = "gh"\nargs = ["mcp"]\n\n[mcp_servers.afyx_graph]\ncommand = "node"\nargs = ["/old/path/afyx-graph.js", "serve", "--mcp"]\n',
    'utf8'
  );
  writeFileSync(
    join(geminiHome, 'config', 'mcp_config.json'),
    JSON.stringify({
      mcpServers: {
        foreign_tool: { command: "custom_tool", args: ["serve"] },
        afyx_graph: { command: "node", args: ["/old/path/afyx-graph.js", "serve", "--mcp"] },
      },
    }, null, 2),
    'utf8'
  );
  // Pre-populate legacy Antigravity config
  writeFileSync(
    join(geminiHome, 'antigravity', 'mcp_config.json'),
    JSON.stringify({
      mcpServers: {
        afyx_graph: { command: "node", args: ["/very/old/path/afyx-graph.js", "serve", "--mcp"] },
      },
    }, null, 2),
    'utf8'
  );
  // Pre-populate Claude config
  writeFileSync(
    join(claudeHome, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        unrelated_server: { command: "echo", args: ["hello"] },
        afyx_graph: { command: "node", args: ["/old/path/afyx-graph.js", "serve", "--mcp"] },
      },
    }, null, 2),
    'utf8'
  );

  const profileEnv = {
    ...process.env,
    USERPROFILE: root,
    HOME: root,
    APPDATA: join(root, 'roaming'),
    LOCALAPPDATA: join(root, 'local'),
    CODEX_HOME: codexHome,
    AFYX_GEMINI_HOME: geminiHome,
    CLAUDE_CONFIG_DIR: claudeHome,
    CLAUDE_HOME: claudeHome,
    AFYX_BACKUP_ROOT: backupRoot,
    AFYX_INSTALL_ROOT: join(root, '.afyx'),
    AFYX_GRAPH_RUNTIME_ROOT: join(root, '.afyx', 'graph'),
    AFYX_CONTEXT_RUNTIME_ROOT: join(root, '.afyx', 'context'),
    AFYX_FORGE_RUNTIME_ROOT: join(root, '.afyx', 'forge'),
    AFYX_HOST_BRIDGE_RUNTIME_ROOT: join(root, '.afyx', 'host-bridge'),
    CI: '1',
    NO_COLOR: '1',
  };

  // 1. Run install --preset full to upgrade existing setup
  const installResult = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      'install',
      '--preset', 'full',
      '--provider', 'antigravity,claude,codex',
      '--no-build-fallback',
      '--non-interactive',
    ],
    {
      env: profileEnv,
      encoding: 'utf8',
      timeout: 120_000,
      cwd: REPO_ROOT,
    }
  );

  assert.equal(
    installResult.status,
    0,
    `install failed with code ${installResult.status}:\nSTDOUT:\n${installResult.stdout}\nSTDERR:\n${installResult.stderr}`
  );

  // Assert foreign entries are completely preserved
  const codexContent = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  assert.match(codexContent, /github/);
  const geminiDoc = JSON.parse(readFileSync(join(geminiHome, 'config', 'mcp_config.json'), 'utf8'));
  assert.ok(geminiDoc.mcpServers.foreign_tool, 'foreign_tool in gemini config must be preserved');
  assert.ok(geminiDoc.mcpServers.afyx_graph, 'afyx_graph in gemini config must be adopted and configured');
  const claudeDoc = JSON.parse(readFileSync(join(claudeHome, '.claude.json'), 'utf8'));
  assert.ok(claudeDoc.mcpServers.unrelated_server, 'unrelated_server in claude config must be preserved');
  assert.ok(claudeDoc.mcpServers.afyx_graph, 'afyx_graph in claude config must be adopted and configured');

  // Assert legacy antigravity duplicate was cleaned up
  if (existsSync(join(geminiHome, 'antigravity', 'mcp_config.json'))) {
    const legacyDoc = JSON.parse(readFileSync(join(geminiHome, 'antigravity', 'mcp_config.json'), 'utf8'));
    assert.equal(legacyDoc.mcpServers?.afyx_graph, undefined, 'legacy duplicate must be removed');
  }

  // Assert companions backfilled across all roots
  const companionRoots = [
    skillsRoot,
    join(codexHome, 'skills'),
    join(geminiHome, 'config', 'skills'),
    join(geminiHome, 'antigravity', 'skills'),
    join(geminiHome, 'antigravity-cli', 'skills'),
    join(claudeHome, 'skills'),
  ];
  for (const cRoot of companionRoots) {
    assert.equal(existsSync(join(cRoot, 'afyx-context', 'SKILL.md')), true, `afyx-context companion must exist in ${cRoot}`);
    assert.equal(existsSync(join(cRoot, 'afyx-forge', 'SKILL.md')), true, `afyx-forge companion must exist in ${cRoot}`);
  }

  // Assert 7/7 Usage Tracker runtime files installed
  const usageRuntimeFiles = [
    'CodexUsage.psm1',
    'codex-usage-stop.ps1',
    'codex-usage-watch.ps1',
    'codex-usage-doctor.ps1',
    'codex-usage-pricing.json',
    'codex-usage-present.ps1',
    'AfyxUsageIntelligence.psm1',
  ];
  for (const uFile of usageRuntimeFiles) {
    assert.equal(existsSync(join(codexHome, 'tools', uFile)), true, `Usage tracker runtime file ${uFile} must exist`);
  }

  // 2. Verify passes cleanly
  const verifyResult = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      'verify',
      '--preset', 'full',
      '--provider', 'antigravity,claude,codex',
    ],
    {
      env: profileEnv,
      encoding: 'utf8',
      timeout: 60_000,
      cwd: REPO_ROOT,
    }
  );

  assert.equal(
    verifyResult.status,
    0,
    `verify failed with code ${verifyResult.status}:\nSTDOUT:\n${verifyResult.stdout}\nSTDERR:\n${verifyResult.stderr}`
  );
  assert.match(verifyResult.stdout, /Core readiness/);
});

test('Alpha.12 surgical TOML isolates owned statements and preserves unrelated bytes', async () => {
  const { editCodexToml } = await import('../afyx-mcp-integration.mjs');
  const foreignHead = [
    '\uFEFF# fixture – byte-preserved',
    'notes = """',
    '[mcp_servers.afyx_graph]',
    '"""',
    '[mcp_servers.node_repl]',
    'command = "node"',
    '[mcp_servers.node_repl.args]',
    'mode = "persistent"',
    '',
  ].join('\r\n');
  const owned = ['[mcp_servers."afyx_graph"]', 'command = "old"', 'args = ["old"]',
    '[mcp_servers.afyx_graph.env]', 'OLD = "value"', ''].join('\r\n');
  const foreignTail = ['# retained', '[mcp_servers.github]', 'command = "foreign"', ''].join('\r\n');
  const transport = { node: 'C:\\Program Files\\node.exe', args: ['C:\\Afyx\\afyx-graph.js', 'serve', '--mcp'] };
  const next = editCodexToml(Buffer.from(foreignHead + owned + foreignTail), 'afyx_graph', transport, true);
  const removed = editCodexToml(next, 'afyx_graph', null, true).toString();
  assert.ok(removed.startsWith(foreignHead));
  assert.ok(removed.includes(foreignTail));
  assert.doesNotMatch(removed, /OLD = "value"|command = "old"/);
  assert.throws(() => editCodexToml(Buffer.from(owned + owned), 'afyx_graph', transport, true));
  assert.throws(() => editCodexToml(Buffer.from('mcp_servers.afyx_graph.command = "foreign"\n'), 'afyx_graph', transport, true));
  assert.throws(() => editCodexToml(Buffer.from([0xff]), 'afyx_graph', transport, false));
  const lf = Buffer.from('[mcp_servers.foreign]\ncommand = "node"\n');
  assert.ok(editCodexToml(lf, 'afyx_graph', transport, false).subarray(0, lf.length).equals(lf));
});

test('Alpha.12 Codex native accepts registration and preserves valid foreign TOML', {
  skip: !process.env.AFYX_TEST_CODEX,
}, async (t) => {
  const { integrate } = await import('../afyx-mcp-integration.mjs');
  const root = mkdtempSync(join(tmpdir(), 'afyx-alpha12-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previousBackup = process.env.AFYX_BACKUP_ROOT;
  process.env.AFYX_BACKUP_ROOT = join(root, 'backups');
  t.after(() => {
    if (previousBackup === undefined) delete process.env.AFYX_BACKUP_ROOT;
    else process.env.AFYX_BACKUP_ROOT = previousBackup;
  });
  const config = join(root, 'config.toml');
  const original = Buffer.from([
    '\uFEFF# preserve foreign config',
    'notes = """',
    '[mcp_servers.afyx_graph]',
    '"""',
    '[profiles.nested]',
    'model = "gpt-5"',
    '[mcp_servers.node_repl]',
    'command = "node"',
    'args = ["server.js"]',
    '',
  ].join('\r\n'));
  writeFileSync(config, original);
  const entry = join(root, 'fixture.mjs');
  writeFileSync(entry, [
    "import { createInterface } from 'node:readline';",
    "createInterface({ input: process.stdin }).on('line', (line) => {",
    "  const m = JSON.parse(line);",
    "  if (m.id === undefined) return;",
    "  const result = m.method === 'initialize' ? { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } } : { tools: [{ name: 'afyx_graph_explore' }] };",
    "  console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));",
    "});",
  ].join('\n'));
  const options = { codexHome: root, codex: process.env.AFYX_TEST_CODEX, node: process.execPath,
    entry, args: [entry], apply: true };
  const applied = await integrate(options);
  assert.equal(applied.mcp, 'MCP_REACHABLE', JSON.stringify(applied));
  const first = readFileSync(config);
  assert.ok(first.subarray(0, original.length).equals(original));
  assert.equal((await integrate(options)).changed, false);
  assert.deepEqual(readFileSync(config), first);
  assert.equal((await integrate({ ...options, uninstall: true })).mcp, 'MCP_NOT_CONFIGURED');
  assert.ok(readFileSync(config).subarray(0, original.length).equals(original));

  const { runProviderLifecycle } = await import('../afyx-provider-integration.mjs');
  const validBatch = await runProviderLifecycle({
    ...options,
    scope: 'global',
    providers: ['codex', 'antigravity', 'claude'],
    geminiHome: join(root, 'gemini-valid'),
    claudeConfigDir: join(root, 'claude-valid'),
    claudeExtension: true,
    workspaceRoot: root,
  });
  assert.notEqual(validBatch.status, 'BLOCKED', JSON.stringify(validBatch));
  assert.equal(validBatch.providers[0].status, 'READY', JSON.stringify(validBatch.providers[0]));
  assert.equal(validBatch.providers[1].status, 'CONFIGURED_RESTART_REQUIRED', JSON.stringify(validBatch.providers[1]));
  assert.equal(validBatch.providers[2].status, 'READY', JSON.stringify(validBatch.providers[2]));
  assert.ok(readFileSync(config).subarray(0, original.length).equals(original));

  const incompatible = Buffer.from('[mcp_servers.node_repl]\r\ncommand = "node"\r\n\r\n[mcp_servers.node_repl.args]\r\nmode = "persistent"\r\n');
  writeFileSync(config, incompatible);
  const batch = await runProviderLifecycle({
    ...options,
    scope: 'global',
    providers: ['codex', 'antigravity', 'claude'],
    geminiHome: join(root, 'gemini'),
    claudeConfigDir: join(root, 'claude'),
    claudeExtension: true,
    workspaceRoot: root,
  });
  assert.equal(batch.status, 'BLOCKED');
  assert.equal(batch.providers[0].status, 'BLOCKED');
  assert.equal(batch.providers[0].reason, 'CODEX_FOREIGN_CONFIG_INCOMPATIBLE', JSON.stringify(batch.providers[0]));
  assert.equal(batch.providers[1].status, 'CONFIGURED_RESTART_REQUIRED', JSON.stringify(batch.providers[1]));
  assert.equal(batch.providers[2].status, 'READY', JSON.stringify(batch.providers[2]));
  assert.deepEqual(readFileSync(config), incompatible);
});
