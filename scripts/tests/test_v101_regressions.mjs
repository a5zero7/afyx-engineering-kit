import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseCliArgs, buildSubprocessCall, getPackageVersion } from '../afyx-npm-installer.mjs';
import { providerSelectable, providerExtensionOnly, renderFrame } from '../afyx-midnight-circuit.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..', '..');

function resolveBashExecutable() {
  const candidates = [
    'bash',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

const bashExe = resolveBashExecutable();

function toPosixPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
}

test('v1.0.1 version parity across package, CLI, scripts, and SECURITY.md', () => {
  assert.equal(getPackageVersion(), '1.0.1');
  const cli = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'bin', 'afyx-engineering-kit.mjs'), '--version'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout.trim(), /v1\.0\.1$/);

  for (const rel of ['install.sh', 'verify.sh', 'uninstall.sh', 'install.ps1', 'verify.ps1', 'uninstall.ps1']) {
    const text = fs.readFileSync(join(PACKAGE_ROOT, rel), 'utf8');
    assert.match(text, /1\.0\.1/, `${rel} must reference v1.0.1`);
    assert.doesNotMatch(text, /0\.1\.0-alpha\.12/, `${rel} must not contain stale 0.1.0-alpha.12`);
  }

  const security = fs.readFileSync(join(PACKAGE_ROOT, 'SECURITY.md'), 'utf8');
  assert.match(security, /1\.0\.x.*v1\.0\.1/);
});

test('VS Code extension-only providers are not selectable and display accurate note', () => {
  const extOnlyCodex = {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    supported: true,
    products: [{ type: 'VS Code Extension', version: '0.4.0' }],
  };
  const extOnlyClaude = {
    id: 'claude',
    name: 'Claude Code CLI',
    supported: true,
    products: [{ type: 'VS Code Extension', version: '2.1.0' }],
  };
  const cliCodex = {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    supported: true,
    products: [
      { type: 'CLI', version: '0.1.0' },
      { type: 'VS Code Extension', version: '0.4.0' },
    ],
  };

  assert.equal(providerExtensionOnly(extOnlyCodex), true);
  assert.equal(providerSelectable(extOnlyCodex), false);
  assert.equal(providerExtensionOnly(extOnlyClaude), true);
  assert.equal(providerSelectable(extOnlyClaude), false);
  assert.equal(providerExtensionOnly(cliCodex), false);
  assert.equal(providerSelectable(cliCodex), true);

  const frame = renderFrame({
    stage: 0,
    width: 180,
    height: 30,
    providers: [extOnlyCodex],
    environment: {
      os: { name: 'macOS' },
      architecture: 'arm64',
      invokingShell: { name: 'Zsh' },
      terminal: { name: 'Terminal.app' },
      backendShell: { name: 'Bash' },
      package: { version: '1.0.1', sourceRevision: 'a'.repeat(40) },
    },
  });
  const normalizedFrame = frame.replace(/[│╭╮╰╯─\s]/g, '');
  assert.ok(normalizedFrame.includes('VSCodeextensiononly—standaloneCLIrequiredforMCPregistration'));
});

test('README.md has no relative docs/ links and includes v1.0.1 and global alpha note', () => {
  const readme = fs.readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /\*\*Versi Kit 1\.0\.1\.\*\*/);
  assert.equal((readme.match(/\(docs\//g) || []).length, 0, 'README.md must not have relative (docs/ links');
  assert.match(readme, /https:\/\/github\.com\/a5zero7\/afyx-engineering-kit\/blob\/main\/docs\//);
  assert.match(readme, /npm uninstall -g afyx-engineering-kit/);
});

test('CLI supports uninstall --all --purge-backups --non-interactive', () => {
  const parsed = parseCliArgs(['uninstall', '--all', '--purge-backups', '--non-interactive']);
  assert.equal(parsed.command, 'uninstall');
  assert.equal(parsed.options.all, true);
  assert.equal(parsed.options.purgeBackups, true);
  assert.equal(parsed.options.nonInteractive, true);

  const posixCall = buildSubprocessCall(parsed.command, parsed.options, 'linux');
  assert.ok(posixCall.args.includes('--all'));
  assert.ok(posixCall.args.includes('--purge-backups'));
  assert.ok(posixCall.args.includes('--non-interactive'));

  const winCall = buildSubprocessCall(parsed.command, parsed.options, 'win32');
  assert.ok(winCall.args.includes('-All'));
  assert.ok(winCall.args.includes('-PurgeBackups'));
});

test('Bash 3.2 empty-argument safety and uninstall --all --purge-backups in disposable HOME', { skip: !bashExe }, () => {
  const tmpRoot = fs.mkdtempSync(join(os.tmpdir(), 'afyx-v101-test-'));
  try {
    const fakeHome = join(tmpRoot, 'home');
    const fakeBin = join(tmpRoot, 'bin');
    const fakeBackup = join(tmpRoot, 'backups');
    fs.mkdirSync(join(fakeHome, '.afyx', 'forge'), { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(join(fakeBackup, 'afyx-efficient-coding'), { recursive: true });
    fs.writeFileSync(
      join(fakeHome, '.afyx', 'forge', 'metadata.json'),
      JSON.stringify({ product_name: 'Afyx Forge Core', ownership_class: 'AFYX' }),
    );
    fs.writeFileSync(join(fakeBackup, 'afyx-efficient-coding', 'state.json'), '{}');
    fs.writeFileSync(join(fakeBin, 'claude'), '#!/usr/bin/env bash\necho "claude 2.1.0"\n', { mode: 0o755 });
    fs.writeFileSync(join(fakeBin, 'claude.cmd'), '@echo off\r\necho claude 2.1.0\r\n');

    const sep = process.platform === 'win32' ? ';' : ':';
    const env = {
      ...process.env,
      PATH: `${fakeBin}${sep}${process.env.PATH || ''}`,
      HOME: toPosixPath(fakeHome),
      USERPROFILE: fakeHome,
      AFYX_BACKUP_ROOT: toPosixPath(fakeBackup),
      AFYX_NONINTERACTIVE: '1',
    };

    // 1. Dynamic [REQUIRED] vs [OPTIONAL / NOT_SELECTED] in install.sh --dry-run --provider claude
    const installRes = spawnSync(bashExe, [
      '-u',
      toPosixPath(join(PACKAGE_ROOT, 'install.sh')),
      '--dry-run',
      '--provider',
      'claude',
    ], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(installRes.status, 0, installRes.stderr || installRes.stdout);
    assert.match(installRes.stdout, /Claude Code host \[REQUIRED\]/);
    assert.match(installRes.stdout, /Codex host \[OPTIONAL \/ NOT_SELECTED\]/);

    // 2. Bash -u update.sh with zero args must not throw unbound variable under set -u
    const updateZeroArgs = spawnSync(bashExe, [
      '-u',
      toPosixPath(join(PACKAGE_ROOT, 'update.sh')),
    ], { env, encoding: 'utf8', timeout: 30000 });
    assert.doesNotMatch(updateZeroArgs.stderr || '', /unbound variable/i);
    assert.notEqual(updateZeroArgs.status, null);

    // 3. uninstall.sh --all --purge-backups --non-interactive removes component dirs & backups cleanly
    const uninstallRes = spawnSync(bashExe, [
      '-u',
      toPosixPath(join(PACKAGE_ROOT, 'uninstall.sh')),
      '--all',
      '--purge-backups',
      '--non-interactive',
    ], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(uninstallRes.status, 0, uninstallRes.stderr || uninstallRes.stdout);
    assert.equal(fs.existsSync(join(fakeHome, '.afyx', 'forge')), false);
    assert.match(uninstallRes.stdout, /Afyx Forge Core: uninstalled/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
