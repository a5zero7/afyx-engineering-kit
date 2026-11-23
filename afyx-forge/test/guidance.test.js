import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateGuidance } from '../src/guidance.js';
import { EXECUTION_MODES } from '../src/policy.js';
import { TASK_CATEGORIES } from '../src/classifier.js';

describe('Afyx Forge Core — Actionable Guidance Generator', () => {
  it('generates direct minimal guidance avoiding heavyweight graph indexing', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.KNOWN_FILE_BUG,
      frameworks: [],
      referencedFiles: ['src/core.py'],
    };
    const policy = {
      executionMode: EXECUTION_MODES.DIRECT_MINIMAL,
      graphRouting: 'BYPASS',
    };

    const guidance = generateGuidance(classification, policy, 'Fix typo in src/core.py');
    assert.ok(guidance.investigationPriorities.some((p) => p.includes('Direct Inspection')));
    assert.ok(guidance.toolRecommendations.preferred.some((t) => t.includes('Direct source')));
    assert.ok(guidance.toolRecommendations.avoided.some((t) => t.includes('Afyx Graph indexing')));
    assert.ok(guidance.validationScope.length > 0);
    assert.ok(guidance.completionCriteria.length > 0);
  });

  it('generates defense-in-depth guidance with negative security test requirement', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.SECURITY_SENSITIVE,
      frameworks: [],
      referencedFiles: ['auth/jwt.js'],
    };
    const policy = {
      executionMode: EXECUTION_MODES.SECURITY_DEFENSE_IN_DEPTH,
      graphRouting: 'BYPASS',
    };

    const guidance = generateGuidance(classification, policy, 'Fix JWT expiry check');
    assert.ok(guidance.investigationPriorities.some((p) => p.includes('Security Boundary')));
    assert.ok(guidance.validationScope.some((v) => v.includes('unauthorized access fails closed')));
    assert.ok(guidance.completionCriteria.some((c) => c.includes('no credentials exposed')));
  });

  it('generates Odoo release-aware guidance for Odoo tasks', () => {
    const classification = {
      primaryCategory: TASK_CATEGORIES.UNKNOWN_DEFECT_DIAGNOSIS,
      frameworks: ['Odoo'],
      referencedFiles: ['addons/mod/models/partner.py'],
    };
    const policy = {
      executionMode: EXECUTION_MODES.DOMAIN_SPECIALIST,
      graphRouting: 'RECOMMENDED',
    };

    const guidance = generateGuidance(classification, policy, 'Odoo field update');
    assert.ok(guidance.investigationPriorities.some((p) => p.includes('Odoo Release Schema')));
    assert.ok(guidance.validationScope.some((v) => v.includes('Odoo manifest')));
  });
});

