import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');
const hadBackupRoot = Object.hasOwn(process.env, 'AFYX_BACKUP_ROOT');
const originalBackupRoot = process.env.AFYX_BACKUP_ROOT;

describe('AFYX Universal npm Package Disposable Smoke Suite', () => {
  let tempRoot;
  let pkgDir;
  let cliPath;
  let isoSkills;
  let foreignDir;
  let mockBinDir;
  let isolatedEnv;
  let mockHostEnv;

  before(() => {
    tempRoot = join(tmpdir(), 'afyx-npm-smoke-test-' + randomBytes(4).toString('hex'));
    mkdirSync(tempRoot, { recursive: true });

    // 1. Pack tarball
    const packOut = execSync('npm pack --pack-destination ' + JSON.stringify(tempRoot), {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const tarballName = packOut.trim().split(/\r?\n/).pop().trim();
    const tarballPath = join(tempRoot, tarballName);
    assert.ok(existsSync(tarballPath), `Tarball must exist at ${tarballPath}`);
    assert.ok(statSync(tarballPath).size > 100000, 'Tarball size must be substantial (>100KB)');

    // 2. Extract tarball
    const extractDir = join(tempRoot, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${tarballPath}" -C "${extractDir}"`);
    pkgDir = join(extractDir, 'package');
    assert.ok(existsSync(pkgDir), `Extracted package dir must exist at ${pkgDir}`);

    cliPath = join(pkgDir, 'bin', 'afyx-engineering-kit.mjs');
    assert.ok(existsSync(cliPath), `CLI entrypoint must exist at ${cliPath}`);

    // Setup isolated skills root with a foreign directory
    isoSkills = join(tempRoot, 'iso-skills');
    mkdirSync(isoSkills, { recursive: true });
    foreignDir = join(isoSkills, 'custom-foreign-skill');
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(join(foreignDir, 'SKILL.md'), '# Preserved Foreign Skill\n');

    // 3. Isolated Mock Codex host executable for readiness verification
    mockBinDir = join(tempRoot, 'mock-bin');
    mkdirSync(mockBinDir, { recursive: true });

    // Universal mock script logic
    const mockJsPath = join(mockBinDir, 'codex.js');
    const mockJsContent = `const args = process.argv.slice(2);
if (args[0] === '--version' || args[0] === '-v') {
  console.log('codex-cli 0.1.0-test-mock');
  process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'get') {
  console.error('no mcp server named ' + (args[2] || 'unknown'));
  process.exit(1);
}
console.error('not found: ' + args.join(' '));
process.exit(1);
`;
    writeFileSync(mockJsPath, mockJsContent, { encoding: 'utf8' });

    // Linux / macOS executable shell script
    const mockShPath = join(mockBinDir, 'codex');
    const mockShContent = `#!/bin/sh
exec node "$(dirname "$0")/codex.js" "$@"
`;
    writeFileSync(mockShPath, mockShContent, { encoding: 'utf8' });
    try {
      chmodSync(mockShPath, 0o755);
    } catch {
      // Windows filesystem may ignore posix mode
    }

    // Windows CMD batch executable
    const mockCmdPath = join(mockBinDir, 'codex.cmd');
    const mockCmdContent = `@echo off
node "%~dp0codex.js" %*
`;
    writeFileSync(mockCmdPath, mockCmdContent, { encoding: 'utf8' });

    // Isolate backup directory so tests do not collide with retention limits
    const isoBackups = join(tempRoot, 'backups');
    mkdirSync(isoBackups, { recursive: true });
    const pathSep = process.platform === 'win32' ? ';' : ':';
    isolatedEnv = { ...process.env, AFYX_BACKUP_ROOT: isoBackups };
    // Windows host resolution checks codex.exe before codex.cmd, even when
    // the mock cmd directory is first on PATH.
    const mockPath = (process.env.PATH || '').split(pathSep)
      .filter((entry) => process.platform !== 'win32' || !existsSync(join(entry, 'codex.exe')))
      .join(pathSep);
    mockHostEnv = {
      ...isolatedEnv,
      PATH: `${mockBinDir}${pathSep}${mockPath}`,
    };
  });

  after(() => {
    try {
      if (tempRoot && existsSync(tempRoot)) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    } finally {
      if (hadBackupRoot) process.env.AFYX_BACKUP_ROOT = originalBackupRoot;
      else delete process.env.AFYX_BACKUP_ROOT;
    }
  });

  test('packaged tarball does not contain git metadata', () => {
    assert.equal(existsSync(join(pkgDir, '.git')), false);
  });

  test('packaged CLI responds to --version with expected semver', () => {
    const res = spawnSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8', env: isolatedEnv });
    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );
    assert.match(res.stdout, /afyx-engineering-kit v\d+\.\d+\.\d+/);
  });

  test('packaged CLI responds to --help with canonical usage', () => {
    const res = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8', env: isolatedEnv });
    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );
    assert.match(res.stdout, /AFYX Engineering Kit — Universal Cross-Platform CLI Installer/);
    assert.match(res.stdout, /Commands:/);
  });

  test('packaged CLI rejects unsupported command option before launching subprocess', () => {
    const res = spawnSync(process.execPath, [cliPath, 'doctor', '--preset', 'minimal'], { encoding: 'utf8', env: isolatedEnv });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Option "--preset" is not supported for command "doctor"/);
  });

  test('packaged CLI install --dry-run performs non-mutating preview', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'install',
      '--dry-run',
      '--preset', 'minimal',
      '--skills-root', isoSkills,
      '--skip-provider-configuration',
    ], { encoding: 'utf8', env: isolatedEnv });

    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );
    const combined = res.stdout + res.stderr;
    assert.match(combined, /whatif|planned|dry[- ]?run/i);
    // Ensure no skills were installed during dry-run
    assert.equal(existsSync(join(isoSkills, 'efficient-coding')), false);
  });

  test('packaged CLI update --dry-run performs non-mutating preview', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'update',
      '--dry-run',
      '--preset', 'minimal',
      '--skills-root', isoSkills,
      '--skip-provider-configuration',
    ], { encoding: 'utf8', env: isolatedEnv });

    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );
    const combined = res.stdout + res.stderr;
    assert.match(combined, /whatif|planned|dry[- ]?run/i);
  });

  test('packaged CLI performs actual isolated installation and respects foreign files', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'install',
      '--preset', 'minimal',
      '--skip-provider-configuration',
      '--skills-root', isoSkills,
      '--non-interactive',
    ], { encoding: 'utf8', env: isolatedEnv });

    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );
    assert.ok(existsSync(join(isoSkills, 'efficient-coding')), 'efficient-coding must be installed');
    assert.ok(existsSync(join(isoSkills, 'odoo-engineering')), 'odoo-engineering must be installed');
    assert.ok(existsSync(join(foreignDir, 'SKILL.md')), 'Foreign skill must be preserved untouched');
  });

  test('packaged CLI verify checks installed isolated state with isolated mock host', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'verify',
      '--preset', 'minimal',
      '--skills-root', isoSkills,
    ], {
      encoding: 'utf8',
      env: mockHostEnv,
    });

    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );

    const combined = res.stdout + res.stderr;
    assert.ok(
      combined.includes('OK') || combined.includes('HEALTHY') || combined.includes('PASS') || combined.includes('Verified'),
      `Expected healthy verification output, got:\n${combined}`
    );
    // Assert that mock host was detected
    assert.ok(
      combined.includes('codex-cli 0.1.0-test-mock'),
      `Expected exact mock Codex host identity in verify output, got:\n${combined}`
    );
  });

  test('packaged CLI verify fails without detectable host when unmocked on POSIX', (t) => {
    if (process.platform === 'win32') {
      const check = spawnSync('where', ['codex'], { encoding: 'utf8' });
      if (check.status === 0) {
        t.skip('Skipped on Windows where system codex is installed');
        return;
      }
    } else {
      const check = spawnSync('which', ['codex'], { encoding: 'utf8' });
      if (check.status === 0) {
        t.skip('Skipped when unmocked system codex exists on PATH');
        return;
      }
    }

    const res = spawnSync(process.execPath, [
      cliPath,
      'verify',
      '--preset', 'minimal',
      '--skills-root', isoSkills,
    ], {
      encoding: 'utf8',
      env: process.env, // Unmocked environment
    });

    assert.equal(res.status, 1, `Expected exit 1 without host, got ${res.status}`);
    const combined = res.stdout + res.stderr;
    assert.ok(combined.includes('FAIL') || combined.includes('not found') || combined.includes('BLOCKED'));
  });

  test('packaged CLI doctor runs diagnostic checks with isolated mock host', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'doctor',
      '--skills-root', isoSkills,
    ], {
      encoding: 'utf8',
      env: mockHostEnv,
    });

    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );

    const combined = res.stdout + res.stderr;
    assert.ok(combined.includes('READY'), `Expected READY diagnostic, got:\n${combined}`);
    // Assert that mock host was detected
    assert.ok(
      combined.includes('codex-cli 0.1.0-test-mock'),
      `Expected exact mock Codex host identity in doctor output, got:\n${combined}`
    );
  });

  test('packaged CLI idempotent reinstall maintains healthy state', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'install',
      '--preset', 'minimal',
      '--skip-provider-configuration',
      '--skills-root', isoSkills,
      '--non-interactive',
    ], { encoding: 'utf8', env: isolatedEnv });

    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );
    assert.ok(existsSync(join(isoSkills, 'efficient-coding')));
    assert.ok(existsSync(join(isoSkills, 'odoo-engineering')));
  });

  test('packaged CLI uninstall removes targeted component and preserves unmanaged files', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'uninstall',
      '--component', 'odoo-engineering',
      '--skills-root', isoSkills,
      '--non-interactive',
    ], { encoding: 'utf8', env: isolatedEnv });

    assert.equal(
      res.status,
      0,
      `Exit: ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
    );
    assert.ok(existsSync(join(isoSkills, 'efficient-coding')), 'efficient-coding must remain installed');
    assert.equal(existsSync(join(isoSkills, 'odoo-engineering')), false, 'odoo-engineering must be removed');
    assert.ok(existsSync(join(foreignDir, 'SKILL.md')), 'Foreign skill must remain untouched');
  });
});
