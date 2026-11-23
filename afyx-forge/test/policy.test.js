import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAdaptivePolicy, EXECUTION_MODES } from '../src/policy.js';
import { TASK_CATEGORIES, RISK_LEVELS } from '../src/classifier.js';

describe('Afyx Forge Core — Adaptive Policy Engine', () => {
  it('selects DIRECT_MINIMAL and bypasses Graph for known-file simple bug', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.KNOWN_FILE_BUG,
      riskLevel: RISK_LEVELS.LOW,
      frameworks: ['Python'],
      referencedFiles: ['src/app.py'],
    };
    const policy = deriveAdaptivePolicy(classification, { hasGraph: true, hasContext: true });
    assert.equal(policy.executionMode, EXECUTION_MODES.DIRECT_MINIMAL);
    assert.equal(policy.graphRouting, 'BYPASS');
    assert.equal(policy.contextEngine, 'ACTIVE');
  });

  it('selects STRUCTURAL_GRAPH_AWARE and recommends Graph for cross-module task when available', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.CROSS_MODULE_CHANGE,
      riskLevel: RISK_LEVELS.MEDIUM,
      frameworks: ['TypeScript'],
      referencedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    };
    const policy = deriveAdaptivePolicy(classification, { hasGraph: true, hasContext: true });
    assert.equal(policy.executionMode, EXECUTION_MODES.STRUCTURAL_GRAPH_AWARE);
    assert.equal(policy.graphRouting, 'RECOMMENDED');
  });

  it('gracefully degrades to NOT_AVAILABLE when Graph is absent on cross-module task', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.CROSS_MODULE_CHANGE,
      riskLevel: RISK_LEVELS.MEDIUM,
      frameworks: [],
      referencedFiles: ['pkg1/mod.py', 'pkg2/mod.py', 'pkg3/mod.py'],
    };
    const policy = deriveAdaptivePolicy(classification, { hasGraph: false, hasContext: false });
    assert.equal(policy.graphRouting, 'NOT_AVAILABLE');
    assert.ok(policy.graphRoutingReason.includes('falling back to direct-source reading'));
  });

  it('enables healthy Context by default and respects explicit disable', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.KNOWN_FILE_BUG,
      riskLevel: RISK_LEVELS.LOW,
      frameworks: [],
      referencedFiles: ['test.js'],
    };

    const policyDefault = deriveAdaptivePolicy(classification, { hasContext: true });
    assert.equal(policyDefault.contextEngine, 'ACTIVE');

    const policyDisabled = deriveAdaptivePolicy(classification, { hasContext: true, contextOptIn: false });
    assert.equal(policyDisabled.contextEngine, 'BYPASS_USER_DISABLED');

    const policyOptIn = deriveAdaptivePolicy(classification, { hasContext: true, contextOptIn: true });
    assert.equal(policyOptIn.contextEngine, 'ACTIVE');
  });

  it('selects DOMAIN_SPECIALIST and engages Odoo Engineering for Odoo tasks', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.UNKNOWN_DEFECT_DIAGNOSIS,
      riskLevel: RISK_LEVELS.MEDIUM,
      frameworks: ['Odoo'],
      referencedFiles: ['addons/mod/models/partner.py'],
    };
    const policy = deriveAdaptivePolicy(classification, { hasGraph: true });
    assert.equal(policy.executionMode, EXECUTION_MODES.DOMAIN_SPECIALIST);
    assert.ok(policy.expertEngagement.includes('Odoo Engineering'));
  });
});

