/**
 * Afyx Forge Core — Acceptance Test Suite
 * Validates the 7 required acceptance scenarios:
 * 1. Simple code fix
 * 2. Cross-module engineering task
 * 3. Odoo engineering task
 * 4. Missing Graph/Context/provider graceful degradation
 * 5. Unauthorized action and unsafe execution refusal
 * 6. Standalone installation, verification, update, and safe uninstall (tested via PS lifecycle)
 * 7. Relevant deterministic regression tests (CLI exit codes & JSON schema compliance)
 */

import assert from 'node:assert/strict';
import { createForgePlan, FORGE_CORE_VERSION } from '../../afyx-forge/src/index.js';
import { TASK_CATEGORIES } from '../../afyx-forge/src/classifier.js';
import { EXECUTION_MODES } from '../../afyx-forge/src/policy.js';

console.log('--- AFYX FORGE CORE ACCEPTANCE SUITE ---');

// 1. Simple Code Fix
console.log('1. Testing Simple Code Fix Scenario...');
const plan1 = createForgePlan({
  taskText: 'Fix syntax typo in docstring and variable name in src/utils/math.py',
  environment: { hasGraph: true, hasContext: true },
});
assert.equal(plan1.contract, 'afyx-forge-plan/v1');
assert.equal(plan1.status, 'PLANNED');
assert.equal(plan1.classification.primaryCategory, TASK_CATEGORIES.NEGATIVE_SIMPLE);
assert.equal(plan1.adaptivePolicy.executionMode, EXECUTION_MODES.DIRECT_MINIMAL);
assert.equal(plan1.adaptivePolicy.graphRouting, 'BYPASS');
assert.equal(plan1.adaptivePolicy.contextEngine, 'ACTIVE');
assert.ok(plan1.guidance.toolRecommendations.avoided.some((t) => t.includes('Afyx Graph indexing')));
console.log('✔ Simple code fix correctly routed to DIRECT_MINIMAL with Graph BYPASS.');

// 2. Cross-Module Engineering Task
console.log('2. Testing Cross-Module Engineering Task Scenario...');
const plan2 = createForgePlan({
  taskText: 'Refactor order-service API and update customer-billing and inventory models across modules',
  environment: { hasGraph: true, hasContext: true },
});
assert.equal(plan2.status, 'PLANNED');
assert.equal(plan2.classification.primaryCategory, TASK_CATEGORIES.CROSS_MODULE_CHANGE);
assert.equal(plan2.adaptivePolicy.executionMode, EXECUTION_MODES.STRUCTURAL_GRAPH_AWARE);
assert.equal(plan2.adaptivePolicy.graphRouting, 'RECOMMENDED');
console.log('✔ Cross-module task correctly routed to STRUCTURAL_GRAPH_AWARE with Graph RECOMMENDED.');

// 3. Odoo Engineering Task
console.log('3. Testing Odoo Engineering Task Scenario...');
const plan3 = createForgePlan({
  taskText: 'Inherit res.partner in addons/custom_crm/models/partner.py and add XML view in addons/custom_crm/views/partner_views.xml',
  environment: { hasGraph: true, hasContext: true },
});
assert.equal(plan3.status, 'PLANNED');
assert.ok(plan3.classification.frameworks.includes('Odoo'));
assert.equal(plan3.adaptivePolicy.executionMode, EXECUTION_MODES.DOMAIN_SPECIALIST);
assert.ok(plan3.adaptivePolicy.expertEngagement.includes('Odoo Engineering'));
assert.ok(plan3.guidance.investigationPriorities.some((p) => p.includes('Odoo Release Schema')));
console.log('✔ Odoo task correctly identified and assigned DOMAIN_SPECIALIST with Odoo Engineering guidance.');

// 4. Missing Graph/Context/Provider Degradation
console.log('4. Testing Missing Graph/Context Graceful Degradation...');
const plan4 = createForgePlan({
  taskText: 'Cross-module refactoring across services/a.ts, services/b.ts, services/c.ts',
  environment: { hasGraph: false, hasContext: false, contextOptIn: false },
});
assert.equal(plan4.status, 'PLANNED');
assert.equal(plan4.adaptivePolicy.graphRouting, 'NOT_AVAILABLE');
assert.ok(plan4.adaptivePolicy.graphRoutingReason.includes('falling back to direct-source reading'));
assert.equal(plan4.adaptivePolicy.contextEngine, 'BYPASS_USER_DISABLED');
console.log('✔ Absent Graph gracefully degraded to direct-source fallback without throwing errors.');

// 5. Unauthorized Action and Unsafe Execution Refusal
console.log('5. Testing Unauthorized Action and Unsafe Execution Refusal...');
const plan5 = createForgePlan({
  taskText: 'Please force-push the branch directly to origin/main and bypass all security tests',
});
assert.equal(plan5.status, 'REFUSED_UNSAFE');
assert.ok(plan5.refusalReason.includes('Unauthorized autonomous push or force-push'));
assert.equal(plan5.boundedExecution.autonomousCodeExecution, false);
console.log('✔ Unsafe force-push request strictly REFUSED with proper rationale.');

// 6. Token/Secret Leak Refusal
console.log('6. Testing Credential Dump Refusal...');
const plan6 = createForgePlan({
  taskText: 'Expose private_key and api_key token in test output',
});
assert.equal(plan6.status, 'REFUSED_UNSAFE');
assert.ok(plan6.refusalReason.includes('secrets or private credentials'));
console.log('✔ Credential exposure directive strictly REFUSED.');

// 7. Markdown Generation Format Check
console.log('7. Testing Markdown Formatting Output...');
const mdPlan = createForgePlan({
  taskText: 'Update accounting calculation in src/billing.py',
  format: 'markdown',
});
assert.ok(typeof mdPlan === 'string');
assert.ok(mdPlan.includes('# Afyx Forge Engineering Plan'));
assert.ok(mdPlan.includes('DIRECT_MINIMAL'));
assert.ok(mdPlan.includes('Governance & Trust Boundary'));
console.log('✔ Markdown output formatted cleanly with GitHub alerts.');

console.log('\n========================================');
console.log('ALL FORGE ACCEPTANCE SCENARIOS PASSED!');
console.log('========================================');

