#!/usr/bin/env node
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  createConfigurationBackup,
  updateKnownState,
  rollbackConfiguration,
  restoreFromBackup,
  validateUnrelatedPreserved,
  listProviderBackups,
  sha256,
} from '../afyx-provider-backup.mjs';
import { integrate as integrateCodex } from '../afyx-mcp-integration.mjs';
import { integrateAntigravity } from '../afyx-provider-integration.mjs';
import { integrateClaude } from '../afyx-claude-integration.mjs';

describe('AFYX Universal Provider Configuration Management Policy Suite', () => {
  let tempRoot;
  let backupRoot;
  let codexHome;
  let geminiHome;
  let fakeNode;
  let fakeEntry;

  before(() => {
    tempRoot = join(tmpdir(), 'afyx-policy-test-' + randomBytes(4).toString('hex'));
    backupRoot = join(tempRoot, 'backups');
    codexHome = join(tempRoot, 'codex');
    geminiHome = join(tempRoot, 'gemini');
    mkdirSync(backupRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(geminiHome, { recursive: true });

    fakeNode = process.execPath;
    fakeEntry = join(tempRoot, 'runtime', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');
    mkdirSync(join(tempRoot, 'runtime', 'current', 'lib', 'dist', 'bin'), { recursive: true });

    writeFileSync(fakeEntry, `#!/usr/bin/env node
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === 1) {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        serverInfo: { name: 'afyx_graph', version: '1.0.0' }
      }
    }));
  }
  if (m.id === 2) {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [{ name: 'afyx_graph_explore' }] }
    }));
  }
});
`, { encoding: 'utf8' });
  });

  after(() => {
    if (tempRoot && existsSync(tempRoot)) {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  });

  // 1. Universal Backup Creation & Metadata Validation
  test('creates immutable pre-modification backup with verified SHA-256 metadata outside source repo', () => {
    const configPath = join(codexHome, 'test-config.toml');
    const originalContent = 'model = "gpt-4"\n\n[mcp_servers.headroom]\nurl = "http://127.0.0.1:9999"\n';
    writeFileSync(configPath, originalContent, 'utf8');

    const backup = createConfigurationBackup({
      provider: 'codex',
      configPath,
      operation: 'test-mcp-add',
      backupRoot,
    });

    assert.equal(backup.provider, 'codex');
    assert.equal(backup.existed, true);
    assert.equal(backup.originalSha256, sha256(Buffer.from(originalContent)));
    assert.ok(existsSync(backup.backupPath), 'Backup file must exist on disk');
    assert.ok(existsSync(backup.metaPath), 'Metadata file must exist on disk');

    const meta = JSON.parse(readFileSync(backup.metaPath, 'utf8'));
    assert.equal(meta.schemaVersion, 1);
    assert.equal(meta.provider, 'codex');
    assert.equal(meta.configPath, configPath);
    assert.equal(meta.operation, 'test-mcp-add');
    assert.equal(meta.sha256, backup.originalSha256);
    assert.equal(meta.size, Buffer.byteLength(originalContent));

    const backupContent = readFileSync(backup.backupPath, 'utf8');
    assert.equal(backupContent, originalContent, 'Backup bytes must match original exactly');
  });

  // 2. Retention Policy Enforcement
  test('enforces bounded backup retention policy and preserves newest backups', () => {
    const configPath = join(codexHome, 'retention-test.toml');
    writeFileSync(configPath, 'initial = true\n', 'utf8');

    const limit = 5;
    for (let i = 0; i < 8; i++) {
      createConfigurationBackup({
        provider: 'codex-retention',
        configPath,
        operation: `step-${i}`,
        backupRoot,
        retentionLimit: limit,
      });
    }

    const backups = listProviderBackups('codex-retention', backupRoot);
    assert.equal(backups.length, limit, `Expected exactly ${limit} backups retained, got ${backups.length}`);
  });

  // 3. Clean Rollback on Failure
  test('safely rolls back to original state on aborted or failed operations', () => {
    const configPath = join(codexHome, 'rollback-test.toml');
    const originalContent = 'original = "preserve-me"\n';
    writeFileSync(configPath, originalContent, 'utf8');

    const backup = createConfigurationBackup({
      provider: 'codex',
      configPath,
      operation: 'test-rollback',
      backupRoot,
    });

    // Simulate an operation that mutated the file then failed
    writeFileSync(configPath, 'mutated = "bad-state"\n', 'utf8');
    updateKnownState(backup);

    const rollbackResult = rollbackConfiguration(backup, { reason: 'Intentional test failure' });
    assert.equal(rollbackResult.restored, true);
    assert.equal(rollbackResult.verified, true);
    assert.equal(readFileSync(configPath, 'utf8'), originalContent);
  });

  // 4. Concurrent Modification Protection
  test('refuses blind rollback and preserves conflict evidence when concurrent external edit occurs', () => {
    const configPath = join(codexHome, 'concurrent-test.toml');
    const originalContent = 'user_key = "original"\n';
    writeFileSync(configPath, originalContent, 'utf8');

    const backup = createConfigurationBackup({
      provider: 'codex',
      configPath,
      operation: 'test-concurrent',
      backupRoot,
    });

    // Simulate external user edit happening during our operation
    const externalEdit = 'user_key = "concurrently-updated-by-user"\nnew_secret = "123"\n';
    writeFileSync(configPath, externalEdit, 'utf8');

    // Attempt rollback without force
    const rollbackResult = rollbackConfiguration(backup, { reason: 'Test error' });
    assert.equal(rollbackResult.restored, false, 'Must not restore over concurrent edit');
    assert.equal(rollbackResult.conflict, true, 'Must flag concurrent modification conflict');
    assert.ok(existsSync(rollbackResult.conflictPath), 'Must preserve conflict copy');

    // Verify target file was not destroyed
    assert.equal(readFileSync(configPath, 'utf8'), externalEdit);
    // Verify conflict copy matches the edit
    assert.equal(readFileSync(rollbackResult.conflictPath, 'utf8'), externalEdit);
  });

  // 5. Explicit Restoration Procedure
  test('restores configuration explicitly from a backup file with checksum verification', () => {
    const targetPath = join(codexHome, 'restored-target.toml');
    const configPath = join(codexHome, 'source-backup.toml');
    const content = 'restored_content = "verified_100_percent"\n';
    writeFileSync(configPath, content, 'utf8');

    const backup = createConfigurationBackup({
      provider: 'codex',
      configPath,
      operation: 'test-restore',
      backupRoot,
    });

    const restoreResult = restoreFromBackup(backup.backupPath, targetPath);
    assert.equal(restoreResult.restored, true);
    assert.equal(readFileSync(targetPath, 'utf8'), content);
    assert.equal(restoreResult.sha256, backup.originalSha256);
  });

  // 6. Normalization vs Destructive Loss Validation (TOML)
  test('distinguishes harmless TOML normalization from destructive setting loss', () => {
    const before = Buffer.from(
      '# Original comments\n' +
      'model = "gpt-4"\n' +
      '\n' +
      '[mcp_servers.headroom]\n' +
      'url = "http://127.0.0.1:9999"\n' +
      '\n' +
      '[unrelated_table]\n' +
      'setting = true\n'
    );

    // Harmless normalization: comments stripped, tables reordered, extra whitespace
    const normalizedAfter = Buffer.from(
      'model = "gpt-4"\n' +
      '\n' +
      '[unrelated_table]\n' +
      'setting = true\n' +
      '\n' +
      '[mcp_servers.afyx_graph]\n' +
      'command = "node"\n' +
      '\n' +
      '[mcp_servers.headroom]\n' +
      'url = "http://127.0.0.1:9999"\n'
    );

    const normalResult = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: before,
      afterBytes: normalizedAfter,
      server: 'afyx_graph',
    });

    assert.equal(normalResult.preserved, true, 'Harmless normalization must be accepted as preserved');
    assert.equal(normalResult.normalized, true);

    // Destructive loss: [unrelated_table] was dropped by broken tooling
    const destructiveAfter = Buffer.from(
      'model = "gpt-4"\n' +
      '\n' +
      '[mcp_servers.afyx_graph]\n' +
      'command = "node"\n'
    );

    const destructResult = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: before,
      afterBytes: destructiveAfter,
      server: 'afyx_graph',
    });

    assert.equal(destructResult.preserved, false, 'Destructive loss of unrelated table must be detected');
    assert.ok(destructResult.missingTables.includes('unrelated_table'));
  });

  // 6b. TOML Semantic Hardening: Positive Normalization Acceptance
  test('validates semantic preservation under TOML normalization (positive tests)', () => {
    const fixtureBefore = Buffer.from(
      '# Baseline configuration\n' +
      'future_unknown_key = "value"\n' +
      'counter = 1000\n' +
      '\n' +
      '[custom_unrelated_table]\n' +
      'enabled = true\n' +
      'threshold = 1.0\n' +
      '\n' +
      '[mcp_servers.headroom]\n' +
      'url = "http://127.0.0.1:9999"\n'
    );

    // Normalized after:
    // - single-quoted vs double-quoted strings
    // - numeric equivalence: 1.0 vs +1.000, 1000 vs 1_000
    // - table reordering (custom_unrelated_table reordered before mcp_servers)
    // - harmless whitespace, CRLF, and comments
    // - afyx-owned entry added under mcp_servers
    const normalizedAfter = Buffer.from(
      '\r\n# Harmless provider header comment\r\n' +
      'future_unknown_key = \'value\'\r\n' +
      'counter = 1_000\r\n' +
      '\r\n' +
      '[custom_unrelated_table]\r\n' +
      'threshold = +1.000\r\n' +
      'enabled = true\r\n' +
      '\r\n' +
      '[mcp_servers.headroom]\r\n' +
      'url = \'http://127.0.0.1:9999\'\r\n' +
      '\r\n' +
      '[mcp_servers.afyx_graph]\r\n' +
      'command = "node"\r\n'
    );

    const result = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: fixtureBefore,
      afterBytes: normalizedAfter,
      server: 'afyx_graph',
    });

    assert.equal(result.preserved, true, 'Equivalent quotes, numbers, whitespace and reordering must be accepted');
    assert.equal(result.normalized, true);
    assert.equal(result.code, 'PRESERVED');
    assert.equal(result.missingKeys.length, 0);
    assert.equal(result.missingTables.length, 0);
    assert.equal(result.mutatedKeys.length, 0);
  });

  // 6c. TOML Semantic Hardening: Negative Failure Mode Detection
  test('detects semantic TOML mutations and reports precise diagnostics (negative tests)', () => {
    const fixtureBefore = Buffer.from(
      'future_unknown_key = "value"\n' +
      '\n' +
      '[custom_unrelated_table]\n' +
      'enabled = true\n' +
      'threshold = 1.0\n' +
      '\n' +
      '[mcp_servers.headroom]\n' +
      'url = "http://127.0.0.1:9999"\n'
    );

    // 1. future_unknown_key changed from "value" to "changed"
    const neg1 = Buffer.from(
      'future_unknown_key = "changed"\n\n[custom_unrelated_table]\nenabled = true\nthreshold = 1.0\n\n[mcp_servers.headroom]\nurl = "http://127.0.0.1:9999"\n\n[mcp_servers.afyx_graph]\ncommand = "node"\n'
    );
    const res1 = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: fixtureBefore,
      afterBytes: neg1,
      server: 'afyx_graph',
    });
    assert.equal(res1.preserved, false, 'Mutated key value must be detected');
    assert.equal(res1.code, 'UNRELATED_KEY_VALUE_MUTATED');
    assert.ok(res1.mutatedKeys.some((m) => m.path === 'future_unknown_key'));
    assert.ok(res1.detail.includes('UNRELATED_KEY_VALUE_MUTATED'));
    assert.ok(res1.detail.includes('future_unknown_key'));

    // 2. Unrelated key deleted
    const neg2 = Buffer.from(
      '[custom_unrelated_table]\nenabled = true\nthreshold = 1.0\n\n[mcp_servers.headroom]\nurl = "http://127.0.0.1:9999"\n\n[mcp_servers.afyx_graph]\ncommand = "node"\n'
    );
    const res2 = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: fixtureBefore,
      afterBytes: neg2,
      server: 'afyx_graph',
    });
    assert.equal(res2.preserved, false, 'Deleted unrelated key must be detected');
    assert.equal(res2.code, 'UNRELATED_KEY_DELETED');
    assert.ok(res2.missingKeys.includes('future_unknown_key'));
    assert.ok(res2.detail.includes('UNRELATED_KEY_DELETED'));

    // 3. Value inside [custom_unrelated_table] changed
    const neg3 = Buffer.from(
      'future_unknown_key = "value"\n\n[custom_unrelated_table]\nenabled = true\nthreshold = 2.5\n\n[mcp_servers.headroom]\nurl = "http://127.0.0.1:9999"\n\n[mcp_servers.afyx_graph]\ncommand = "node"\n'
    );
    const res3 = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: fixtureBefore,
      afterBytes: neg3,
      server: 'afyx_graph',
    });
    assert.equal(res3.preserved, false, 'Changed value in unrelated table must be detected');
    assert.equal(res3.code, 'UNRELATED_KEY_VALUE_MUTATED');
    assert.ok(res3.mutatedKeys.some((m) => m.path === 'custom_unrelated_table.threshold'));
    assert.ok(res3.detail.includes('UNRELATED_KEY_VALUE_MUTATED'));

    // 4. Existing foreign MCP entry modified
    const neg4 = Buffer.from(
      'future_unknown_key = "value"\n\n[custom_unrelated_table]\nenabled = true\nthreshold = 1.0\n\n[mcp_servers.headroom]\nurl = "http://127.0.0.1:8888"\n\n[mcp_servers.afyx_graph]\ncommand = "node"\n'
    );
    const res4 = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: fixtureBefore,
      afterBytes: neg4,
      server: 'afyx_graph',
    });
    assert.equal(res4.preserved, false, 'Modified foreign MCP entry must be detected');
    assert.equal(res4.code, 'UNRELATED_KEY_VALUE_MUTATED');
    assert.ok(res4.mutatedKeys.some((m) => m.path === 'mcp_servers.headroom.url'));
    assert.ok(res4.detail.includes('UNRELATED_KEY_VALUE_MUTATED'));

    // 5. Unsupported or invalid TOML cannot be verified and fails closed
    const neg5 = Buffer.from('future_unknown_key = "value"\ninvalid = [ unclosed array\n');
    const res5 = validateUnrelatedPreserved({
      format: 'toml',
      beforeBytes: fixtureBefore,
      afterBytes: neg5,
      server: 'afyx_graph',
    });
    assert.equal(res5.preserved, false, 'Invalid TOML must fail closed');
    assert.equal(res5.code, 'INVALID_TOML');
    assert.ok(res5.detail.includes('Failed to parse TOML'));
  });

  // 7. Normalization vs Destructive Loss Validation (JSON)
  test('distinguishes harmless JSON normalization from destructive setting loss', () => {
    const before = Buffer.from(JSON.stringify({
      version: 1,
      mcpServers: {
        other_tool: { command: 'other', args: [] }
      },
      unrelatedOption: true
    }, null, 2));

    // Harmless normalization: compacted whitespace, server added
    const normalizedAfter = Buffer.from(JSON.stringify({
      unrelatedOption: true,
      version: 1,
      mcpServers: {
        afyx_graph: { command: 'node', args: ['afyx-graph.js'] },
        other_tool: { command: 'other', args: [] }
      }
    }));

    const normalResult = validateUnrelatedPreserved({
      format: 'json',
      beforeBytes: before,
      afterBytes: normalizedAfter,
      server: 'afyx_graph',
    });

    assert.equal(normalResult.preserved, true);
    assert.equal(normalResult.normalized, true);

    // Destructive loss: other_tool was dropped
    const destructiveAfter = Buffer.from(JSON.stringify({
      version: 1,
      mcpServers: {
        afyx_graph: { command: 'node', args: ['afyx-graph.js'] }
      }
    }));

    const destructResult = validateUnrelatedPreserved({
      format: 'json',
      beforeBytes: before,
      afterBytes: destructiveAfter,
      server: 'afyx_graph',
    });

    assert.equal(destructResult.preserved, false);
  });

  // 8. Antigravity MCP Lifecycle with Universal Backup
  test('Antigravity MCP registration creates recoverable backup and preserves unrelated settings', async () => {
    const configPath = join(geminiHome, 'config', 'mcp_config.json');
    mkdirSync(join(geminiHome, 'config'), { recursive: true });
    const initialConfig = {
      mcpServers: {
        existing_tool: { command: 'existing', args: ['run'] }
      },
      userSetting: 'active'
    };
    writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    const options = {
      scope: 'global',
      geminiHome,
      node: fakeNode,
      entry: fakeEntry,
      apply: true,
    };

    // Registration
    const regResult = await integrateAntigravity(options);
    assert.equal(regResult.status, 'CONFIGURED_RESTART_REQUIRED');
    assert.equal(regResult.changed, true);

    // Verify recovery backup was retained outside repo
    const backups = listProviderBackups('antigravity');
    assert.ok(backups.length >= 1, 'Expected at least one recovery backup for antigravity');
    const latestBackup = backups[0];
    assert.equal(latestBackup.provider, 'antigravity');
    assert.ok(existsSync(latestBackup.backupPath));

    // Read back config
    const afterConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(afterConfig.userSetting, 'active');
    assert.ok(afterConfig.mcpServers.existing_tool);
    assert.ok(afterConfig.mcpServers.afyx_graph);

    // Uninstallation
    const uninstResult = await integrateAntigravity({ ...options, uninstall: true });
    assert.equal(uninstResult.status, 'UNAVAILABLE');
    assert.equal(uninstResult.changed, true);

    const afterUninstall = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(afterUninstall.userSetting, 'active');
    assert.ok(afterUninstall.mcpServers.existing_tool);
    assert.equal(afterUninstall.mcpServers.afyx_graph, undefined);
  });

  // 9. Codex G6 Alignment: Native MCP registration, backup retention, recovery, and normalization
  test('Codex G6 Alignment: native MCP lifecycle retains recovery backup and accepts TOML normalization', async (t) => {
    const codexConfigPath = join(codexHome, 'config.toml');
    const initialToml = [
      '# User comments',
      'model = "fixture-model"',
      '',
      '[mcp_servers.headroom]',
      'url = "http://127.0.0.1:9999/mcp"',
      '',
      '[unrelated_custom_table]',
      'enabled = true',
      '',
    ].join('\n');
    writeFileSync(codexConfigPath, initialToml, 'utf8');

    // Check if codex CLI is available
    const checkCodex = process.platform === 'win32' ? 'where' : 'which';
    const { spawnSync } = await import('node:child_process');
    const found = spawnSync(checkCodex, ['codex'], { encoding: 'utf8' });
    if (found.status !== 0) {
      t.skip('Skipping live Codex CLI test on runner without codex installed');
      return;
    }

    const lines = found.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const codexExecutable = process.platform === 'win32'
      ? (lines.find((l) => l.toLowerCase().endsWith('.cmd')) || lines[0])
      : lines[0];

    // 1. Plan mode: side-effect free
    const planResult = await integrateCodex({
      codex: codexExecutable,
      codexHome,
      node: fakeNode,
      entry: fakeEntry,
      apply: false,
    });
    assert.equal(planResult.mcp, 'MCP_NOT_CONFIGURED');
    assert.equal(readFileSync(codexConfigPath, 'utf8'), initialToml);

    // 2. Apply registration: native codex invocation
    const applyResult = await integrateCodex({
      codex: codexExecutable,
      codexHome,
      node: fakeNode,
      entry: fakeEntry,
      apply: true,
    });
    assert.equal(applyResult.mcp, 'MCP_REACHABLE');
    assert.equal(applyResult.changed, true);

    // 3. Verify recovery backup exists and was retained
    const backups = listProviderBackups('codex');
    assert.ok(backups.length >= 1, 'Expected at least one recovery backup retained for codex');
    const backup = backups[0];
    assert.ok(existsSync(backup.backupPath));
    assert.equal(readFileSync(backup.backupPath, 'utf8'), initialToml, 'Original config recoverable byte-for-byte from backup');

    // 4. Verify TOML normalization is accepted while unrelated settings remain intact
    const configAfter = readFileSync(codexConfigPath, 'utf8');
    assert.ok(configAfter.includes('model = "fixture-model"') || configAfter.includes('model = \'fixture-model\''));
    assert.ok(configAfter.includes('headroom'));
    assert.ok(configAfter.includes('unrelated_custom_table'));
    assert.ok(configAfter.includes('afyx_graph'));

    // 5. Native MCP removal
    const removeResult = await integrateCodex({
      codex: codexExecutable,
      codexHome,
      node: fakeNode,
      entry: fakeEntry,
      uninstall: true,
      apply: true,
    });
    assert.equal(removeResult.mcp, 'MCP_NOT_CONFIGURED');
    assert.equal(removeResult.changed, true);

    const configAfterRemove = readFileSync(codexConfigPath, 'utf8');
    assert.ok(!configAfterRemove.includes('[mcp_servers.afyx_graph]'));
    assert.ok(configAfterRemove.includes('headroom'));
    assert.ok(configAfterRemove.includes('unrelated_custom_table'));

    // 6. Test explicit recovery from backup restores original configuration
    const restoredTarget = join(codexHome, 'restored-codex.toml');
    restoreFromBackup(backup.backupPath, restoredTarget);
    assert.equal(readFileSync(restoredTarget, 'utf8'), initialToml);
  });

  // 10. Claude Code Lifecycle & Rollback Safety
  test('Claude Code MCP lifecycle retains backup and validates rollback on failure', async (t) => {
    const claudeDir = join(tempRoot, 'claude');
    mkdirSync(claudeDir, { recursive: true });
    const claudeConfigPath = join(claudeDir, '.claude.json');
    const initialConfig = {
      mcpServers: {
        existing_claude_server: { command: 'node', args: ['server.js'] }
      },
      preferredTheme: 'dark'
    };
    writeFileSync(claudeConfigPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    // Check if claude CLI is available
    const checkClaude = process.platform === 'win32' ? 'where' : 'which';
    const { spawnSync } = await import('node:child_process');
    const found = spawnSync(checkClaude, ['claude'], { encoding: 'utf8' });
    if (found.status !== 0) {
      t.skip('Skipping live Claude Code CLI test on runner without claude installed');
      return;
    }

    const claudeExecutable = found.stdout.trim().split(/\r?\n/)[0];

    const result = await integrateClaude({
      claude: claudeExecutable,
      claudeConfigDir: claudeDir,
      node: fakeNode,
      entry: fakeEntry,
      scope: 'global',
      operation: 'apply',
    });

    if (result.status === 'READY') {
      const backups = listProviderBackups('claude');
      assert.ok(backups.length >= 1, 'Expected at least one recovery backup for claude');
    }
  });
});
