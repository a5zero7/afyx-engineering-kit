import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getPackageVersion,
  getHelpText,
  parseCliArgs,
  buildSubprocessCall,
  PACKAGE_ROOT,
} from '../afyx-npm-installer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_BIN = join(PACKAGE_ROOT, 'bin', 'afyx-engineering-kit.mjs');

test('getPackageVersion returns non-empty semver string', () => {
  const version = getPackageVersion();
  assert.ok(typeof version === 'string' && version.length > 0);
  assert.match(version, /^\d+\.\d+\.\d+/);
});

test('getHelpText contains canonical usage and all supported commands', () => {
  const help = getHelpText();
  assert.ok(help.includes('afyx-engineering-kit <command>'));
  assert.ok(help.includes('install'));
  assert.ok(help.includes('verify'));
  assert.ok(help.includes('doctor'));
  assert.ok(help.includes('update'));
  assert.ok(help.includes('uninstall'));
  assert.ok(help.includes('--preset'));
  assert.ok(help.includes('--dry-run'));
});

test('parseCliArgs handles help and version flags', () => {
  assert.equal(parseCliArgs([]).showHelp, true);
  assert.equal(parseCliArgs(['--help']).showHelp, true);
  assert.equal(parseCliArgs(['-h']).showHelp, true);
  assert.equal(parseCliArgs(['help']).showHelp, true);

  assert.equal(parseCliArgs(['--version']).showVersion, true);
  assert.equal(parseCliArgs(['-v']).showVersion, true);
  assert.equal(parseCliArgs(['version']).showVersion, true);
});

test('parseCliArgs identifies supported commands correctly', () => {
  for (const cmd of ['install', 'verify', 'doctor', 'update', 'uninstall']) {
    const res = parseCliArgs([cmd]);
    assert.equal(res.command, cmd);
    assert.equal(res.errors.length, 0);
  }
});

test('parseCliArgs rejects unknown commands or dangling flags', () => {
  const unk = parseCliArgs(['nonexistent']);
  assert.equal(unk.command, null);
  assert.ok(unk.errors.length > 0);
  assert.match(unk.errors[0], /Unknown command/);

  const missing = parseCliArgs(['--unknown']);
  assert.equal(missing.command, null);
  assert.ok(missing.errors.length > 0);
});

test('parseCliArgs parses common boolean and value options', () => {
  const res = parseCliArgs([
    'install',
    '--preset', 'recommended',
    '--provider', 'codex,antigravity',
    '--provider-scope', 'workspace',
    '--workspace-root', '/tmp/ws',
    '--dry-run',
    '--validate-only',
    '--offline',
    '--non-interactive',
    '--custom-component', 'comp-a',
    '--custom-component', 'comp-b',
  ]);

  assert.equal(res.command, 'install');
  assert.equal(res.options.preset, 'recommended');
  assert.equal(res.options.provider, 'codex,antigravity');
  assert.equal(res.options.providerScope, 'workspace');
  assert.equal(res.options.workspaceRoot, '/tmp/ws');
  assert.equal(res.options.dryRun, true);
  assert.equal(res.options.validateOnly, true);
  assert.equal(res.options.offline, true);
  assert.equal(res.options.nonInteractive, true);
  assert.deepEqual(res.options.customComponents, ['comp-a', 'comp-b']);
});

test('parseCliArgs detects missing option values', () => {
  const res = parseCliArgs(['install', '--preset']);
  assert.ok(res.errors.length > 0);
  assert.match(res.errors[0], /--preset requires a value/);
});

test('buildSubprocessCall maps Windows arguments to PowerShell', () => {
  const call = buildSubprocessCall('install', {
    preset: 'full',
    dryRun: true,
    nonInteractive: true,
  }, 'win32', '/pkg');

  assert.equal(call.executable, 'pwsh');
  assert.equal(call.fallbackExecutable, 'powershell.exe');
  assert.ok(call.args.includes('-File'));
  assert.ok(call.args.includes('-Preset'));
  assert.ok(call.args.includes('full'));
  assert.ok(call.args.includes('-WhatIf'));
  assert.ok(call.args.includes('-Confirm:$false'));
});

test('buildSubprocessCall maps Linux/macOS arguments to Bash', () => {
  const call = buildSubprocessCall('install', {
    preset: 'minimal',
    dryRun: true,
    offline: true,
  }, 'linux', '/pkg');

  assert.equal(call.executable, 'bash');
  assert.ok(call.args[0].endsWith('install.sh'));
  assert.ok(call.args.includes('--preset'));
  assert.ok(call.args.includes('minimal'));
  assert.ok(call.args.includes('--dry-run'));
  assert.ok(call.args.includes('--offline'));
});

test('buildSubprocessCall routes doctor to afyx-doctor script', () => {
  const win = buildSubprocessCall('doctor', { project: '/my/proj' }, 'win32', '/pkg');
  assert.ok(win.scriptPath.endsWith(join('scripts', 'afyx-doctor.ps1')));
  assert.ok(win.args.includes('-ProjectPath'));
  assert.ok(win.args.includes('/my/proj'));

  const unix = buildSubprocessCall('doctor', { project: '/my/proj' }, 'linux', '/pkg');
  assert.ok(unix.scriptPath.endsWith(join('scripts', 'afyx-doctor.sh')));
  assert.ok(unix.args.includes('--project'));
  assert.ok(unix.args.includes('/my/proj'));
});

test('CLI executable responds to --version and exits 0', () => {
  const run = spawnSync(process.execPath, [CLI_BIN, '--version'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /afyx-engineering-kit v\d+\.\d+\.\d+/);
});

test('CLI executable responds to --help and exits 0', () => {
  const run = spawnSync(process.execPath, [CLI_BIN, '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /AFYX Engineering Kit/);
  assert.match(run.stdout, /Commands:/);
});

test('CLI executable rejects unknown command with exit code 1', () => {
  const run = spawnSync(process.execPath, [CLI_BIN, 'unrecognized-verb'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Unknown command/);
});
