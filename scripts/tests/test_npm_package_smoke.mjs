import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');

describe('AFYX Universal npm Package Disposable Smoke Suite', () => {
  let tempRoot;
  let pkgDir;
  let cliPath;
  let isoSkills;
  let foreignDir;

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
  });

  after(() => {
    if (tempRoot && existsSync(tempRoot)) {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  });

  test('packaged tarball does not contain git metadata', () => {
    assert.equal(existsSync(join(pkgDir, '.git')), false);
  });

  test('packaged CLI responds to --version with expected semver', () => {
    const res = spawnSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /afyx-engineering-kit v\d+\.\d+\.\d+/);
  });

  test('packaged CLI responds to --help with canonical usage', () => {
    const res = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /AFYX Engineering Kit — Universal Cross-Platform CLI Installer/);
    assert.match(res.stdout, /Commands:/);
  });

  test('packaged CLI rejects unsupported command option before launching subprocess', () => {
    const res = spawnSync(process.execPath, [cliPath, 'doctor', '--preset', 'minimal'], { encoding: 'utf8' });
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
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0);
    const combined = res.stdout + res.stderr;
    assert.ok(combined.includes('WhatIf') || combined.includes('PLANNED') || combined.includes('DRY RUN'));
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
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0);
    const combined = res.stdout + res.stderr;
    assert.ok(combined.includes('WhatIf') || combined.includes('PLANNED') || combined.includes('DRY RUN'));
  });

  test('packaged CLI performs actual isolated installation and respects foreign files', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'install',
      '--preset', 'minimal',
      '--skip-provider-configuration',
      '--skills-root', isoSkills,
      '--non-interactive',
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0);
    assert.ok(existsSync(join(isoSkills, 'efficient-coding')), 'efficient-coding must be installed');
    assert.ok(existsSync(join(isoSkills, 'odoo-engineering')), 'odoo-engineering must be installed');
    assert.ok(existsSync(join(foreignDir, 'SKILL.md')), 'Foreign skill must be preserved untouched');
  });

  test('packaged CLI verify checks installed isolated state', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'verify',
      '--preset', 'minimal',
      '--skills-root', isoSkills,
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0);
    const combined = res.stdout + res.stderr;
    assert.ok(combined.includes('HEALTHY') || combined.includes('PASS') || combined.includes('Verified'));
  });

  test('packaged CLI doctor runs diagnostic checks', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'doctor',
      '--skills-root', isoSkills,
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0);
    const combined = res.stdout + res.stderr;
    assert.ok(combined.includes('HEALTHY') || combined.includes('System check') || combined.includes('Prerequisite'));
  });

  test('packaged CLI idempotent reinstall maintains healthy state', () => {
    const res = spawnSync(process.execPath, [
      cliPath,
      'install',
      '--preset', 'minimal',
      '--skip-provider-configuration',
      '--skills-root', isoSkills,
      '--non-interactive',
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0);
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
    ], { encoding: 'utf8' });

    assert.equal(res.status, 0);
    assert.ok(existsSync(join(isoSkills, 'efficient-coding')), 'efficient-coding must remain installed');
    assert.equal(existsSync(join(isoSkills, 'odoo-engineering')), false, 'odoo-engineering must be removed');
    assert.ok(existsSync(join(foreignDir, 'SKILL.md')), 'Foreign skill must remain untouched');
  });
});
