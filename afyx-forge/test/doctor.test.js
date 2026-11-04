import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(doc.governance.autonomousExecutionAllowed, false);
    assert.equal(doc.governance.uncontrolledModelCost, false);
    assert.equal(doc.governance.runtimeMode, 'ASSISTIVE_GUIDANCE_ONLY');
  });
});

