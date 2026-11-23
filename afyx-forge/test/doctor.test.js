import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runDoctor } from '../src/doctor.js';

describe('Afyx Forge Core — Doctor Diagnostic', () => {
  it('returns valid diagnostic structure with governance gate', () => {
    const doc = runDoctor();
    assert.equal(doc.forgeCoreVersion, '0.1.0');
    assert.ok(doc.runtime.nodeVersion.startsWith('v'));
    assert.ok(doc.runtime.platform);
    assert.ok(typeof doc.agentSurfaces === 'object');
    assert.ok(typeof doc.afyxComponents === 'object');
    assert.ok(typeof doc.skills === 'object');

    // Governance gate verification
    assert.equal(doc.governance.gate, 'A8_FORMAL_CAMPAIGN');
    assert.ok(doc.governance.status.includes('EVALUATION_GATED'));
    assert.equal(doc.governance.localDecision, 'GO_OWNER_APPROVED_LOCAL_SCOPE');
    assert.equal(doc.governance.formalCampaign, 'WAIVED_BY_OWNER_NOT_RUN');
    assert.equal(doc.governance.autonomousExecutionAllowed, false);
    assert.equal(doc.governance.uncontrolledModelCost, false);
    assert.equal(doc.governance.runtimeMode, 'ASSISTIVE_GUIDANCE_ONLY');
  });
});


it('finds known executables in paths with spaces and shell metacharacters without running them', (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'afyx forge & probe-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const win = process.platform === 'win32';
  writeFileSync(join(fixture, win ? 'codex.cmd' : 'codex'), 'unexecuted fixture', { mode: 0o755 });
  const doctor = new URL('../src/doctor.js', import.meta.url).href;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  const locatorPath = win ? '' : delimiter + '/usr/bin' + delimiter + '/bin';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'const { runDoctor } = await import(process.argv[1]); console.log(JSON.stringify(runDoctor().agentSurfaces));',
    doctor], { cwd: fixture, env: { ...env, HOME: fixture, USERPROFILE: fixture, PATH: fixture + locatorPath }, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const surfaces = JSON.parse(result.stdout);
  assert.equal(surfaces.codex, 'DETECTED');
  assert.equal(surfaces.claude, 'UNAVAILABLE');
});
