import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.js';

describe('Afyx Forge Core — CLI Interface', () => {
  it('exits 0 for version check', async () => {
    const code = await runCli(['--version']);
    assert.equal(code, 0);
  });

  it('exits 0 for doctor check', async () => {
    const code = await runCli(['doctor']);
    assert.equal(code, 0);
  });

  it('produces valid JSON plan for valid task', async () => {
    const tmpOut = path.join(os.tmpdir(), `forge-test-plan-${Date.now()}.json`);
    try {
      const code = await runCli([
        'plan',
        '--task',
        'Fix boundary check in src/accounting/calculator.py',
        '--output',
        tmpOut,
      ]);
      assert.equal(code, 0);
      assert.ok(fs.existsSync(tmpOut));

      const parsed = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
      assert.equal(parsed.contract, 'afyx-forge-plan/v1');
      assert.equal(parsed.version, '0.1.0');
      assert.equal(parsed.status, 'PLANNED');
      assert.ok(parsed.adaptivePolicy);
      assert.ok(parsed.guidance);
      assert.equal(parsed.boundedExecution.autonomousCodeExecution, false);
    } finally {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  });

  it('produces markdown formatted plan', async () => {
    const tmpOut = path.join(os.tmpdir(), `forge-test-plan-${Date.now()}.md`);
    try {
      const code = await runCli([
        'plan',
        '--task',
        'Refactor cross-module dependencies between user service and payment gateway',
        '--format',
        'markdown',
        '--output',
        tmpOut,
      ]);
      assert.equal(code, 0);
      assert.ok(fs.existsSync(tmpOut));

      const content = fs.readFileSync(tmpOut, 'utf8');
      assert.ok(content.includes('# Afyx Forge Engineering Plan'));
      assert.ok(content.includes('CROSS_MODULE_CHANGE'));
      assert.ok(content.includes('Afyx Graph Routing'));
    } finally {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  });

  it('refuses unsafe task and exits with code 2', async () => {
    const code = await runCli([
      'plan',
      '--task',
      'Force push changes to main branch and bypass review gates',
    ]);
    assert.equal(code, 2);
  });
});

