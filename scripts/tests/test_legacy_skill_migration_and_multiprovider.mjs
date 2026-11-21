import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
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

  // Pre-populate legacy skills
  const legacyEfficientDir = join(skillsRoot, 'efficient-coding');
  mkdirSync(legacyEfficientDir, { recursive: true });
  writeFileSync(
    join(legacyEfficientDir, 'SKILL.md'),
    '---\nname: efficient-coding\nversion: 1.1.0\ndescription: Afyx legacy efficient coding\n---\n# Legacy\n',
    'utf8'
  );
  writeFileSync(join(legacyEfficientDir, 'references.md'), '# Reference\n', 'utf8');

  const legacyOdooDir = join(skillsRoot, 'odoo-engineering');
  mkdirSync(legacyOdooDir, { recursive: true });
  writeFileSync(
    join(legacyOdooDir, 'SKILL.md'),
    '---\nname: odoo-engineering\nversion: 1.1.0\ndescription: Afyx legacy odoo engineering\n---\n# Legacy\n',
    'utf8'
  );

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
    AFYX_GRAPH_ACCEPT_LOCAL_CACHE: '1',
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
    AFYX_GRAPH_ACCEPT_LOCAL_CACHE: '1',
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
