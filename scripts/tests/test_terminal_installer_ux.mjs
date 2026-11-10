import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, buildSubprocessCall } from '../afyx-npm-installer.mjs';

describe('T06 (AFYX-316): Terminal Installer UX & Preset Coverage', () => {
  test('Preset support: minimal preset parses and maps correctly', () => {
    const parsed = parseCliArgs(['install', '--preset', 'minimal', '--dry-run', '--non-interactive']);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.command, 'install');
    assert.equal(parsed.options.preset, 'minimal');
    assert.equal(parsed.options.dryRun, true);
    assert.equal(parsed.options.nonInteractive, true);

    const call = buildSubprocessCall(parsed.command, parsed.options, 'win32', '/pkg');
    assert.ok(call.args.includes('-Preset'));
    assert.ok(call.args.includes('minimal'));
    assert.ok(call.args.includes('-WhatIf'));
    assert.ok(call.args.includes('-Confirm:$false'));
  });

  test('Preset support: recommended preset parses and maps correctly', () => {
    const parsed = parseCliArgs(['install', '--preset', 'recommended', '--dry-run']);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.options.preset, 'recommended');

    const call = buildSubprocessCall(parsed.command, parsed.options, { isWindows: false });
    assert.ok(call.args.includes('--preset'));
    assert.ok(call.args.includes('recommended'));
    assert.ok(call.args.includes('--dry-run'));
  });

  test('Preset support: full preset parses and maps correctly', () => {
    const parsed = parseCliArgs(['install', '--preset', 'full', '--dry-run']);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.options.preset, 'full');
  });

  test('Preset support: custom preset parses and maps custom components correctly', () => {
    const parsed = parseCliArgs([
      'install',
      '--preset', 'custom',
      '--custom-component', 'efficient-coding',
      '--custom-component', 'odoo-engineering',
      '--dry-run'
    ]);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.options.preset, 'custom');
    assert.deepEqual(parsed.options.customComponents, ['efficient-coding', 'odoo-engineering']);
  });

  test('Error recovery: Clear actionable error on missing option value', () => {
    const parsed = parseCliArgs(['install', '--preset']);
    assert.ok(parsed.errors.length > 0);
    assert.match(parsed.errors[0], /--preset requires a value/);
  });

  test('Error recovery: Fail-closed on conflicting options', () => {
    const parsed = parseCliArgs(['install', '--offline', '--no-build-fallback']);
    assert.equal(parsed.errors.length, 0); // valid combination
    const invalid = parseCliArgs(['install', '--unknown-flag']);
    assert.ok(invalid.errors.length > 0);
    assert.ok(invalid.errors[0].includes('Unknown option'));
  });
});

test('actual AFYX terminal choices: provider, Enter, Y/N confirmation and safe abort', (t) => {
  const probe = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output ready'], { timeout: 5000, encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') { t.skip('pwsh missing; run this acceptance test on Windows PowerShell 7'); return; }
  assert.ifError(probe.error);
  assert.equal(probe.status, 0, probe.stderr);
  const modulePath = fileURLToPath(new URL('../lib/AfyxTerminal.psm1', import.meta.url));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module -Name $env:AFYX_TERMINAL_MODULE -Force",
    "$terminal = [pscustomobject]@{ Interactive = $true; Ansi = $false; Width = 80 }",
    "$options = @([pscustomobject]@{ Id = 'codex'; Label = 'Codex'; Enabled = $true }, [pscustomobject]@{ Id = 'antigravity'; Label = 'Antigravity'; Enabled = $true })",
    "$chosen = Read-AfyxSingleChoice -Prompt 'Provider' -Options $options -DefaultId 'codex' -Terminal $terminal -ReadKey { [pscustomobject]@{ VirtualKeyCode = 50; KeyDown = $true } } -NoRender",
    "if ($chosen -ne 'antigravity') { throw 'Provider selection failed' }",
    "$default = Read-AfyxSingleChoice -Prompt 'Provider' -Options $options -DefaultId 'codex' -Terminal $terminal -ReadKey { [pscustomobject]@{ VirtualKeyCode = 13; KeyDown = $true } } -NoRender",
    "if ($default -ne 'codex') { throw 'Enter default failed' }",
    "if (-not (Read-AfyxConfirmation -Prompt 'Apply?' -Terminal $terminal -ReadLine { 'Y' } -NoRender)) { throw 'Y confirmation failed' }",
    "if (Read-AfyxConfirmation -Prompt 'Apply?' -Terminal $terminal -ReadLine { 'N' } -NoRender) { throw 'N cancellation failed' }",
    "if (Read-AfyxConfirmation -Prompt 'Apply?' -Terminal $terminal -ReadLine { '' } -NoRender) { throw 'Empty must default to no' }",
    "$cancelled = $false",
    "try { $null = Read-AfyxSingleChoice -Prompt 'Provider' -Options $options -DefaultId 'codex' -Terminal $terminal -ReadKey { [pscustomobject]@{ VirtualKeyCode = 27; KeyDown = $true } } -NoRender } catch [System.OperationCanceledException] { $cancelled = $true }",
    "if (-not $cancelled) { throw 'Escape cancellation failed' }",
    "'AFYX_INTERACTIVE_UX_PASS'",
  ].join('\n');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 512 * 1024,
    env: { ...process.env, AFYX_TERMINAL_MODULE: modulePath, NO_COLOR: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /AFYX_INTERACTIVE_UX_PASS/);
});
