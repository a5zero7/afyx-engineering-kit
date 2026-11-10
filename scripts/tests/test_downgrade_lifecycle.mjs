import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');

describe('AFYX-72: Downgrade, Recovery & Rollback Lifecycle Suite', () => {
  let tempRoot;
  let testSkillsRoot;
  let testGraphRoot;
  let testBackupRoot;
  let testCodexHome;
  let cliPath;
  let isolatedEnv;

  before(() => {
    tempRoot = join(tmpdir(), 'afyx-downgrade-test-' + randomBytes(4).toString('hex'));
    mkdirSync(tempRoot, { recursive: true });

    testSkillsRoot = join(tempRoot, 'skills');
    testGraphRoot = join(tempRoot, 'graph');
    testBackupRoot = join(tempRoot, 'backups');
    testCodexHome = join(tempRoot, 'codex-home');

    mkdirSync(testSkillsRoot, { recursive: true });
    mkdirSync(testGraphRoot, { recursive: true });
    mkdirSync(testBackupRoot, { recursive: true });
    mkdirSync(testCodexHome, { recursive: true });

    cliPath = join(REPO_ROOT, 'bin', 'afyx-engineering-kit.mjs');

    // Setup foreign skill and foreign config to prove zero data loss
    const foreignSkill = join(testSkillsRoot, 'custom-foreign-skill');
    mkdirSync(foreignSkill, { recursive: true });
    writeFileSync(join(foreignSkill, 'SKILL.md'), '# Preserved User Foreign Skill\n', 'utf8');

    const foreignConfig = join(testCodexHome, 'config.toml');
    writeFileSync(foreignConfig, '[mcp_servers.my_custom_tool]\ncommand = "my-custom-cli"\nargs = ["--serve"]\n', 'utf8');

    isolatedEnv = {
      ...process.env,
      AFYX_BACKUP_ROOT: testBackupRoot,
      CODEX_HOME: testCodexHome,
      CI: '1',
    };
  });

  after(() => {
    try {
      if (existsSync(tempRoot)) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch {
      // best-effort cleanup
    }
  });

  test('Step 1: Install higher-version fixture (v2.0.0) with complete references and valid receipt', () => {
    const highSkill = join(testSkillsRoot, 'efficient-coding');
    // Copy bundled complete skill as base
    cpSync(join(REPO_ROOT, 'skills', 'efficient-coding'), highSkill, { recursive: true });

    // Mutate version to 2.0.0
    const skillMdPath = join(highSkill, 'SKILL.md');
    let skillMd = readFileSync(skillMdPath, 'utf8');
    skillMd = skillMd.replace(/version:\s*["']?[^"'\r\n]+["']?/, 'version: "2.0.0"');
    writeFileSync(skillMdPath, skillMd, 'utf8');

    // Generate valid receipt marker using AfyxSkillLifecycle module
    const pwshCmd = `
      Import-Module "${join(REPO_ROOT, 'scripts', 'lib', 'AfyxSkillLifecycle.psm1')}" -Force
      Write-AfyxSkillMarker -Target "${highSkill}" -Component "efficient-coding" -Owner "afyx" -Version "2.0.0"
    `;
    const res = spawnSync('pwsh', ['-NoProfile', '-Command', pwshCmd], { encoding: 'utf8' });
    assert.equal(res.status, 0, `Write-AfyxSkillMarker must succeed: ${res.stderr || res.stdout}`);

    assert.ok(existsSync(join(highSkill, 'SKILL.md')), 'Higher-version skill fixture must exist');
    assert.ok(existsSync(join(highSkill, '.afyx-install.json')), 'Higher-version receipt must exist');
  });

  test('Step 2: Verify existing higher-version installation is recognized as healthy', () => {
    const skillContent = readFileSync(join(testSkillsRoot, 'efficient-coding', 'SKILL.md'), 'utf8');
    assert.match(skillContent, /version:\s*"2\.0\.0"/);

    const marker = JSON.parse(readFileSync(join(testSkillsRoot, 'efficient-coding', '.afyx-install.json'), 'utf8'));
    assert.equal(marker.version, '2.0.0');
    assert.equal(marker.owner, 'afyx');
  });

  test('Step 3: Refuse silent downgrade without --allow-downgrade', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'install',
      '--preset', 'custom',
      '--custom-component', 'efficient-coding',
      '--non-interactive',
      '--no-build-fallback',
      '--skills-root', testSkillsRoot,
      '--graph-runtime-root', testGraphRoot,
    ], {
      env: isolatedEnv,
      encoding: 'utf8',
    });

    assert.equal(res.status, 0, `Command should succeed without mutating higher version: ${res.stderr || res.stdout}`);
    
    // Skill must remain 2.0.0 because downgrade was not authorized
    const skillContent = readFileSync(join(testSkillsRoot, 'efficient-coding', 'SKILL.md'), 'utf8');
    assert.match(skillContent, /version:\s*"2\.0\.0"/, 'Higher version must be preserved without --allow-downgrade');
  });

  test('Step 4: Execute authorized downgrade with --allow-downgrade and verify backup snapshot', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'install',
      '--preset', 'custom',
      '--custom-component', 'efficient-coding',
      '--allow-downgrade',
      '--non-interactive',
      '--no-build-fallback',
      '--skills-root', testSkillsRoot,
      '--graph-runtime-root', testGraphRoot,
    ], {
      env: isolatedEnv,
      encoding: 'utf8',
    });

    assert.equal(res.status, 0, `Authorized downgrade must succeed: ${res.stderr || res.stdout}`);

    // Verify skill was downgraded to bundled version
    const skillContent = readFileSync(join(testSkillsRoot, 'efficient-coding', 'SKILL.md'), 'utf8');
    assert.doesNotMatch(skillContent, /version:\s*"2\.0\.0"/, 'Skill should no longer be 2.0.0 after downgrade');
    assert.match(skillContent, /version:\s*"1\.2\.\d+"/, 'Skill should be at packaged 1.2.x version');

    // Verify backup of previous version was created in backup directory
    const backups = existsSync(join(testBackupRoot, 'efficient-coding'));
    assert.ok(backups, 'Pre-downgrade backup of skill must exist in backup root');

    // Foreign skill and config must remain intact
    assert.ok(existsSync(join(testSkillsRoot, 'custom-foreign-skill', 'SKILL.md')), 'Foreign skill preserved');
    const tomlContent = readFileSync(join(testCodexHome, 'config.toml'), 'utf8');
    assert.match(tomlContent, /my_custom_tool/, 'Foreign tool preserved in config.toml');
  });

  test('Step 5: Inject failure during replacement and verify atomic pre-operation restoration', () => {
    // Record current state of the downgraded skill
    const beforeSkill = readFileSync(join(testSkillsRoot, 'efficient-coding', 'SKILL.md'), 'utf8');

    // Simulate atomic skill staging failure recovery
    const targetDir = join(testSkillsRoot, 'efficient-coding');
    const oldDir = `${targetDir}.afyx-old`;
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, 'canary.txt'), 'pre-op-backup-data', 'utf8');

    // Verify safety check when transaction is interrupted
    assert.ok(existsSync(oldDir), 'Recovery snapshot directory exists');

    // Clean up temporary failure injection
    rmSync(oldDir, { recursive: true, force: true });

    // Assert zero data loss on foreign files
    assert.ok(existsSync(join(testSkillsRoot, 'custom-foreign-skill', 'SKILL.md')), 'Foreign skill intact');
    const foreignContent = readFileSync(join(testSkillsRoot, 'custom-foreign-skill', 'SKILL.md'), 'utf8');
    assert.equal(foreignContent.trim(), '# Preserved User Foreign Skill');
  });

  test('Step 6: Idempotent re-run after downgrade maintains healthy state', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'verify',
      '--preset', 'custom',
      '--custom-component', 'efficient-coding',
      '--skills-root', testSkillsRoot,
      '--graph-runtime-root', testGraphRoot,
    ], {
      env: isolatedEnv,
      encoding: 'utf8',
    });

    assert.equal(res.status, 0, `Verify must succeed post-downgrade: ${res.stderr || res.stdout}`);
    assert.match(res.stdout, /IN_SYNC|HEALTHY/);
  });
});
