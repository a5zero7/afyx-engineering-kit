import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeProfiles, executeForgeWorkflow, evaluateTaskCompletion, evaluateVerifiedTaskCompletion, refineTaskDirective } from '../src/index.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const revision = 'a'.repeat(40);
const criterion = { id: 'AC-1', text: 'Tests pass successfully' };
const record = { criterionId: 'AC-1', sourceRevision: revision, status: 'PASS', exitCode: 0, command: 'node --test', evidenceDigest: 'b'.repeat(64) };
const plan = (steps, extra = {}) => ({ contract: 'afyx-forge-workflow/v1', id: 'fixture', steps, ...extra });
const step = (id, capability = 'inspect', dependsOn = []) => ({ id, capability, dependsOn });
const success = async () => ({ status: 'SUCCESS' });
const read = { effect: 'read', execute: success };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('domain profiles reuse AFYX Expert authority and grant no execution permission', () => {
  const [profile] = createForgeProfiles({ domain: 'erp', availableCapabilities: ['odoo-engineering'] });
  assert.equal(profile.owner, 'afyx-forge'); assert.equal(profile.knowledgeOwner, 'afyx-engineering-expert');
  assert.deepEqual(profile.availableCapabilities, ['odoo-engineering']); assert.equal(profile.authorization, 'TRUSTED_HOST_REQUIRED');
  assert.throws(() => createForgeProfiles({ domain: 'untrusted' }), /UNKNOWN_DOMAIN/);
});
test('independent reads overlap, dependencies and mutations execute in exclusive order', async () => {
  let active = 0; let peak = 0; const events = [];
  const inspect = { effect: 'read', execute: async (_, { proposal }) => {
    active++; peak = Math.max(peak, active); events.push(proposal.stepId);
    await sleep(10); active--; return { status: 'PASS' };
  } };
  const mutate = { effect: 'mutation', execute: async () => { assert.equal(active, 0); events.push('write'); return { status: 'SUCCESS', output: 'sensitive result' }; } };
  const result = await executeForgeWorkflow(plan([step('one'), step('two'), step('write', 'change', ['one', 'two']), step('after', 'inspect', ['write'])]),
    { adapters: { inspect, change: mutate }, authorize: () => true });
  assert.equal(result.status, 'SUCCESS'); assert.equal(peak, 2); assert.deepEqual(events, ['one', 'two', 'write', 'after']);
  assert.equal(result.calls, 4); assert.ok(!JSON.stringify(result).includes('sensitive result'));
});
test('concurrent workflows serialize mutation adapters within the host process', async () => {
  let active = 0; let peak = 0;
  const change = { effect: 'mutation', execute: async () => { active++; peak = Math.max(peak, active); await sleep(15); active--; return { status: 'PASS' }; } };
  const options = { adapters: { change }, authorize: () => true };
  const results = await Promise.all([executeForgeWorkflow(plan([step('one', 'change')]), options), executeForgeWorkflow(plan([step('two', 'change')]), options)]);
  assert.equal(peak, 1); assert.ok(results.every((result) => result.status === 'SUCCESS' && result.mutationIsolation === 'PROCESS_LOCAL'));
});
test('host lock integration invokes the approved mutation exactly once', async () => {
  let locks = 0; let actions = 0;
  const result = await executeForgeWorkflow(plan([step('one', 'change')]), { adapters: { change: { effect: 'mutation', execute: async () => { actions++; return { status: 'SUCCESS' }; } } },
    authorize: () => true, runExclusive: async (_, action) => { locks++; const result = await action(); assert.throws(action, /STEP_ALREADY_INVOKED/); return result; } });
  assert.equal(result.status, 'SUCCESS'); assert.equal(result.mutationIsolation, 'TRUSTED_HOST_LOCK_CALLBACK'); assert.equal(locks, 1); assert.equal(actions, 1);
});
test('missing dependencies, cycles, duplicate IDs and unknown adapters fail before execution', async () => {
  for (const steps of [[step('one', 'inspect', ['missing'])], [step('one', 'inspect', ['two']), step('two', 'inspect', ['one'])], [step('one'), step('one')]]) {
    await assert.rejects(executeForgeWorkflow(plan(steps), { adapters: { inspect: read } }));
  }
  await assert.rejects(executeForgeWorkflow(plan([step('one', 'missing')]), { adapters: { inspect: read } }), /TRUSTED_ADAPTER_REQUIRED/);
  await assert.rejects(executeForgeWorkflow(plan(Array.from({ length: 65 }, (_, i) => step(`s-${i}`))), { adapters: { inspect: read } }), /INVALID_PLAN/);
});
test('task JSON cannot downgrade host effect or approve mutation', async () => {
  const change = { effect: 'mutation', execute: async () => { throw new Error('must never run'); } };
  await assert.rejects(executeForgeWorkflow(plan([{ ...step('one', 'change'), effect: 'read' }]), { adapters: { change } }), /TRUSTED_ADAPTER_REQUIRED/);
  const result = await executeForgeWorkflow(plan([{ ...step('one', 'change'), input: { authorized: true, approval: true } }]), { adapters: { change } });
  assert.equal(result.status, 'STOPPED'); assert.equal(result.receipts[0].status, 'DENIED'); assert.equal(result.calls, 0);
});
test('failure and tool budget prevent dependent or additional calls', async () => {
  const failed = await executeForgeWorkflow(plan([step('one'), step('two', 'inspect', ['one'])]), { adapters: { inspect: { effect: 'read', execute: async () => ({ status: 'FAILED' }) } } });
  assert.equal(failed.status, 'STOPPED'); assert.equal(failed.calls, 1); assert.equal(failed.steps[1].status, 'PENDING');
  const limited = await executeForgeWorkflow(plan([step('one'), step('two')]), { adapters: { inspect: read }, budget: { maxCalls: 1 } });
  assert.equal(limited.reason, 'BUDGET_EXHAUSTED'); assert.equal(limited.calls, 1);
});
test('first failing parallel read cancels its uncompleted peer immediately', async () => {
  const result = await executeForgeWorkflow(plan([step('one', 'fail'), step('two', 'wait')]), { adapters: {
    fail: { effect: 'read', execute: async () => ({ status: 'FAILED' }) },
    wait: { effect: 'read', execute: () => new Promise(() => {}) },
  }, budget: { maxElapsedMs: 500 } });
  assert.equal(result.reason, 'FAILED'); assert.ok(result.durationMs < 400);
  assert.equal(result.receipts[1].status, 'CANCELLED');
});
test('deadline and cancellation stop scheduling and signal trusted adapters', async () => {
  let aborted = false;
  const never = { effect: 'read', execute: (_, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve({ status: 'FAILED' }); }, { once: true })) };
  const timed = await executeForgeWorkflow(plan([step('one')]), { adapters: { inspect: never }, budget: { maxElapsedMs: 20 } });
  assert.equal(timed.status, 'STOPPED'); assert.equal(timed.reason, 'TIMEOUT'); assert.equal(aborted, true);
  const controller = new AbortController(); controller.abort();
  const cancelled = await executeForgeWorkflow(plan([step('one')]), { adapters: { inspect: read }, signal: controller.signal });
  assert.equal(cancelled.reason, 'CANCELLED'); assert.equal(cancelled.calls, 0);
});
test('resume requires host-verified candidate binding and never repeats completed mutation', async () => {
  let executed = 0; let saved;
  const change = { effect: 'mutation', execute: async () => { executed++; return { status: 'SUCCESS' }; } };
  const input = plan([step('one', 'change')]);
  const first = await executeForgeWorkflow(input, { adapters: { change }, authorize: () => true, saveCheckpoint: (checkpoint) => { saved = checkpoint; } });
  assert.equal(first.status, 'SUCCESS');
  await assert.rejects(executeForgeWorkflow(input, { adapters: { change }, checkpoint: saved }), /UNVERIFIED_CHECKPOINT/);
  const resumed = await executeForgeWorkflow(input, { adapters: { change }, checkpoint: saved, verifyCheckpoint: (candidate) => candidate === saved });
  assert.equal(resumed.status, 'SUCCESS'); assert.equal(resumed.calls, 0); assert.equal(executed, 1);
  await assert.rejects(executeForgeWorkflow(plan([step('different', 'change')]), { adapters: { change }, checkpoint: saved, verifyCheckpoint: () => true }), /UNVERIFIED_CHECKPOINT/);
});
test('checkpoint save failure retains completed receipts and stops further mutation', async () => {
  let calls = 0;
  const change = { effect: 'mutation', execute: async () => { calls++; return { status: 'SUCCESS' }; } };
  const result = await executeForgeWorkflow(plan([step('one', 'change'), step('two', 'change')]), { adapters: { change }, authorize: () => true,
    saveCheckpoint: async () => { throw new Error('storage failed'); } });
  assert.equal(result.reason, 'CHECKPOINT_SAVE_FAILED_REVIEW_REQUIRED'); assert.equal(calls, 1); assert.deepEqual(result.checkpoint.completed, ['one']);
});
test('text completion remains a compatibility hint and rejects negated success', () => {
  const hint = evaluateTaskCompletion([criterion], ['tests pass successfully']);
  assert.equal(hint.isComplete, true); assert.equal(hint.verifiedComplete, false); assert.equal(hint.assurance, 'TEXT_HEURISTIC_ONLY');
  assert.equal(evaluateTaskCompletion([criterion], ['tests do not pass successfully']).isComplete, false);
  assert.equal(evaluateTaskCompletion([criterion], ['tests did not pass successfully']).isComplete, false);
  assert.equal(evaluateTaskCompletion([criterion], ['tests pass successfully tetapi gagal']).isComplete, false);
  assert.throws(() => refineTaskDirective('x'.repeat(65_537)), /65536/);
});
test('verified completion requires actual host receipt binding, criterion, revision and successful exit', () => {
  const trusted = (candidate) => candidate.evidenceDigest === record.evidenceDigest && candidate.command === record.command;
  const evaluate = (records, extra = {}) => evaluateVerifiedTaskCompletion([criterion], records, { sourceRevision: revision, verifyEvidence: trusted, ...extra });
  assert.equal(evaluate([{ ...record, verified: true }], { verifyEvidence: undefined }).isComplete, false);
  assert.equal(evaluate(['tests pass successfully']).isComplete, false);
  for (const changed of [{ sourceRevision: 'c'.repeat(40) }, { exitCode: 1 }, { status: 'FAIL' }, { criterionId: 'AC-2' }, { command: '' }, { evidenceDigest: 'bad' }]) {
    assert.equal(evaluate([{ ...record, ...changed }]).isComplete, false);
  }
  const verified = evaluate([record]); assert.equal(verified.isComplete, true); assert.equal(verified.verifiedComplete, true);
  assert.equal(evaluate([record, { ...record, status: 'FAIL' }]).isComplete, false);
});
test('workflow acceptance uses verified v2 evidence, not model-supplied verified flags', async () => {
  const input = plan([step('one')], { acceptanceCriteria: [criterion] });
  const missing = await executeForgeWorkflow(input, { adapters: { inspect: read }, sourceRevision: revision, evidence: [{ ...record, verified: true }] });
  assert.equal(missing.status, 'UNVERIFIED');
  const accepted = await executeForgeWorkflow(input, { adapters: { inspect: read }, sourceRevision: revision, evidence: [record], verifyEvidence: () => true });
  assert.equal(accepted.status, 'SUCCESS'); assert.equal(accepted.acceptance.contract, 'afyx-forge-completion/v2');
});
test('installed Forge CLI exposes bounded profiles/refine without invoking capabilities', () => {
  const cli = fileURLToPath(new URL('../bin/afyx-forge.js', import.meta.url));
  for (const args of [['profiles', '--domain', 'security'], ['refine', '--task', '# Objective\nVerify a local fixture.']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.doesNotThrow(() => JSON.parse(result.stdout));
  }
});
