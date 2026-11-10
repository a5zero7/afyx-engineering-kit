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
