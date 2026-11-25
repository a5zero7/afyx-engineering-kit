import assert from 'node:assert/strict';
import test from 'node:test';
import { createContractImpactPlan } from '../src/index.js';

test('Forge orders producer, consumer and verification without inventing missing evidence', () => {
  const producer = { repository: 'api', file: 'api.proto', line: 4, symbol: 'Orders.Get' };
  const consumer = { repository: 'consumer', file: 'handler.ts', line: 9, symbol: 'handle' };
  const evidence = { contract: 'AfyxContractEvidenceDigest/v1', producer, truncated: true,
    links: [{ provenance: 'cross-repo-contract', from: producer, to: consumer, depth: 1 }] };
  const plan = createContractImpactPlan(evidence, { maxExecutionMs: 1200 });
  assert.deepEqual(plan.stages.map(stage => stage.phase), ['producer', 'consumers', 'verification']);
  assert.equal(plan.budget.maxExecutionMs, 1200);
  assert.equal(plan.risk, 'HIGH');
  assert.equal(plan.evidenceCoverage, 'PARTIAL');
  assert.deepEqual(plan.stages[1].scope, [{ repository: 'consumer', citations: ['consumer/handler.ts:9'] }]);
  assert.throws(() => createContractImpactPlan({ ...evidence, producer: null }), /Invalid contract evidence/);
});
