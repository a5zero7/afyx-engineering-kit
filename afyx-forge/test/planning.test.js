import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createForgePlan } from '../src/index.js';
import { extractRequirementIntelligence } from '../src/planning.js';

const environment = { hasGraph: false, hasContext: false };
const timestamp = '2026-11-10T00:00:00.000Z';
const plan = (taskText, extra = {}) => createForgePlan({ taskText, environment, timestamp, ...extra });

describe('Forge MB8 request-grounded planning', () => {
  it('extracts only explicit requirements and preserves their source wording', () => {
    const result = plan(`# Task
## Objective
Fix invoice rounding in src/invoice.js.
## Requirements
- Round the displayed total once.
## Constraints
- Do not change the payment API.
## Dependencies
- Requires the current invoice fixture.
## Acceptance criteria
- Existing invoice test and new zero-rate test pass.
## Unknowns
- Tax locale is unspecified.
## Out of scope
- Payment provider migration.
`);
    assert.equal(result.requirements.objective, 'Fix invoice rounding in src/invoice.js.');
    assert.deepEqual(result.requirements.functionalRequirements, ['Round the displayed total once.']);
    assert.deepEqual(result.requirements.dependencies, ['Requires the current invoice fixture.']);
    assert.deepEqual(result.requirements.acceptanceCriteria, ['Existing invoice test and new zero-rate test pass.']);
    assert.deepEqual(result.requirements.unknownAssumptions, ['Tax locale is unspecified.']);
    assert.deepEqual(result.requirements.scopeBoundaries, ['Payment provider migration.']);
    assert.ok(result.requirements.constraints.includes('Do not change the payment API.'));
    assert.ok(result.requirements.affectedFiles.includes('src/invoice.js'));
    assert.equal(result.requirements.evidenceStatus, 'REQUEST_TEXT_ONLY');
  });

  it('does not invent acceptance criteria for a sparse request', () => {
    const result = plan('Fix typo in docs/readme.md');
    assert.deepEqual(result.requirements.acceptanceCriteria, []);
    assert.deepEqual(result.requirements.unknownAssumptions, []);
    assert.match(result.executionPlan.completionCriteria[0], /missing/);
  });

  it('orders four proposed phases without claiming execution', () => {
    const result = plan('Fix calculation in src/math.js');
    assert.deepEqual(result.executionPlan.steps.map(step => step.id), ['analysis', 'implementation', 'validation', 'delivery']);
    assert.deepEqual(result.executionPlan.steps.map(step => step.dependsOn), [[], ['analysis'], ['implementation'], ['validation']]);
    assert.equal(result.executionPlan.status, 'PROPOSED_NOT_EXECUTED');
    assert.equal(result.executionBudget.status, 'RECOMMENDED_NOT_ENFORCED');
    assert.equal(result.executionBudget.observedProviderTokens, null);
    assert.match(result.boundedExecution.governanceGateA8, /GO_OWNER_APPROVED_LOCAL_SCOPE/);
    assert.match(result.boundedExecution.governanceGateA8, /WAIVED_NOT_RUN/);
  });

  it('uses smaller budgets for surgical work than cross-module or security work', () => {
    const direct = plan('Fix calculation in src/math.js');
    const cross = plan('Change the interface contract across src/api.ts, src/model.ts and src/view.ts');
    const security = plan('Fix OAuth token validation and prove unauthorized access fails closed');
    assert.equal(direct.adaptivePolicy.executionDirective, 'SURGICAL_KNOWN_FILE');
    assert.equal(cross.adaptivePolicy.executionDirective, 'CROSS_FILE');
    assert.equal(security.adaptivePolicy.executionDirective, 'HIGH_RISK');
    assert.ok(direct.executionBudget.toolCallCeiling < cross.executionBudget.toolCallCeiling);
    assert.ok(cross.executionBudget.toolCallCeiling < security.executionBudget.toolCallCeiling);
    assert.match(security.executionPlan.steps[2].action, /negative/);
  });

  it('recognizes investigation wording and Odoo specialist guidance', () => {
    const result = plan('Investigate Odoo _inherit behavior in addons/sale/models/order.py');
    assert.equal(result.classification.primaryCategory, 'UNKNOWN_DEFECT_DIAGNOSIS');
    assert.equal(result.adaptivePolicy.executionMode, 'DOMAIN_SPECIALIST');
    assert.match(result.adaptivePolicy.expertEngagement, /Odoo Engineering/);
  });

  it('respects explicit OFF and unavailable optional components', () => {
    const taskText = 'Change interface contract across src/api.ts, src/model.ts and src/view.ts';
    const disabled = plan(taskText, { environment: { hasGraph: true, graphOptIn: false, hasContext: true, contextOptIn: false, expertOptIn: false } });
    assert.equal(disabled.adaptivePolicy.graphRouting, 'BYPASS_USER_DISABLED');
    assert.equal(disabled.adaptivePolicy.contextEngine, 'BYPASS_USER_DISABLED');
    assert.equal(disabled.adaptivePolicy.expertEngagement, 'BYPASS_USER_DISABLED');
    const absent = plan(taskText);
    assert.equal(absent.adaptivePolicy.graphRouting, 'NOT_AVAILABLE');
  });

  it('does not recommend provider-bound capabilities on an unsupported host', () => {
    const result = plan('Change interface contract across src/api.ts, src/model.ts and src/view.ts', {
      environment: { hasGraph: true, hasContext: true, providerSupported: false },
    });
    assert.equal(result.adaptivePolicy.graphRouting, 'BYPASS_PROVIDER_UNSUPPORTED');
    assert.equal(result.adaptivePolicy.contextEngine, 'BYPASS_PROVIDER_UNSUPPORTED');
    assert.equal(result.adaptivePolicy.expertEngagement, 'BYPASS_PROVIDER_UNSUPPORTED');
  });

  it('keeps refusal free of executable steps and resource claims', () => {
    const result = plan('Force-push and bypass security review');
    assert.equal(result.status, 'REFUSED_UNSAFE');
    assert.equal(result.executionPlan.status, 'REFUSED_NOT_EXECUTED');
    assert.deepEqual(result.executionPlan.steps, []);
    assert.equal(result.executionBudget.observedToolCalls, 0);
    assert.match(result.boundedExecution.governanceGateA8, /GO_OWNER_APPROVED_LOCAL_SCOPE/);
  });

  it('repeats deterministically with fixed timestamp and explicit environment', () => {
    const taskText = 'Fix boundary in src/math.js';
    assert.deepEqual(plan(taskText), plan(taskText));
  });

  it('exposes planning fields in the existing v1 schema and Markdown output', () => {
    const schema = JSON.parse(readFileSync(new URL('../contracts/forge-plan-v1.schema.json', import.meta.url)));
    const result = plan('Fix boundary in src/math.js');
    for (const name of ['requirements', 'executionPlan', 'executionBudget']) {
      assert.ok(schema.properties[name], `${name} missing from v1 schema`);
      assert.ok(result[name], `${name} missing from runtime`);
    }
    assert.ok(schema.properties.adaptivePolicy.properties.graphRouting.enum.includes('BYPASS_USER_DISABLED'));
    const markdown = plan('Fix boundary in src/math.js', { format: 'markdown' });
    assert.match(markdown, /Request-grounded Requirements/);
    assert.match(markdown, /Proposed Execution Plan/);
    assert.match(markdown, /Recommended Budget/);
  });

  it('rejects invalid and oversized inputs before planning', () => {
    assert.throws(() => plan(''), /cannot be empty/);
    assert.throws(() => createForgePlan({ taskText: 12 }), /taskText must be a string/);
    assert.throws(() => plan('x'.repeat(65_537)), /bounded/);
    assert.throws(() => plan('Fix src/math.js', { environment: { hasGraph: 'false' } }), /must be boolean/);
    assert.throws(() => plan('Fix src/math.js', { timestamp: 'invalid' }), /timestamp/);
  });

  it('keeps direct extraction bounded for excessive malformed prose', () => {
    const classification = { referencedFiles: [], riskLevel: 'LOW' };
    const result = extractRequirementIntelligence('## Requirements\n' + '- duplicate\n'.repeat(1000), classification);
    assert.deepEqual(result.functionalRequirements, ['duplicate']);
  });
});
