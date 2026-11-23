import { createHash } from 'node:crypto';
import { evaluateVerifiedTaskCompletion } from './workflow-refiner.js';

export const FORGE_WORKFLOW_CONTRACT = 'afyx-forge-workflow/v1';
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const plain = (value) => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
let mutationTail = Promise.resolve();
async function serialMutation(action, signal) {
  const previous = mutationTail;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  mutationTail = previous.catch(() => {}).then(() => held);
  try {
    await previous.catch(() => {});
    if (signal.aborted) throw new Error('WORKFLOW_ABORTED');
    return await action();
  } finally { release(); }
}
const profiles = Object.freeze([
  ['general', 'software-engineer', ['direct-source']], ['erp', 'erp-technical-specialist', ['odoo-engineering', 'afyx-graph']],
  ['security', 'cybersecurity-devsecops', ['afyx-security-auditor']], ['data', 'database-administrator', ['afyx-graph']],
  ['architecture', 'solutions-architect', ['afyx-graph']], ['platform', 'site-reliability-engineer', ['native-execution']],
]);

/** Profile metadata references AFYX-owned Expert roles; it grants no tool permission. */
export function createForgeProfiles({ domain, availableCapabilities = [] } = {}) {
  if (domain !== undefined && !profiles.some(([name]) => name === domain)) throw new Error('UNKNOWN_DOMAIN');
  if (!Array.isArray(availableCapabilities) || availableCapabilities.some((item) => typeof item !== 'string')) throw new Error('INVALID_CAPABILITIES');
  return profiles.filter(([name]) => domain === undefined || name === domain).map(([name, role, capabilities]) => ({
    contract: 'afyx-forge-profile/v1', domain: name, role, owner: 'afyx-forge', knowledgeOwner: 'afyx-engineering-expert',
    roleReference: `references/${role}.md`, capabilities: [...capabilities],
    availableCapabilities: capabilities.filter((capability) => capability === 'direct-source' || availableCapabilities.includes(capability)),
    authorization: 'TRUSTED_HOST_REQUIRED',
  }));
}
function bounded(value, fallback, max) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > max) throw new Error('INVALID_BUDGET');
  return selected;
}
function copyPlainData(value, stack = new Set(), depth = 0, budget = { items: 0 }) {
  if (++budget.items > 8192 || depth > 16) throw new Error('PLAN_LIMIT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || (!Array.isArray(value) && !plain(value)) || stack.has(value)) throw new Error('PLAIN_PLAN_REQUIRED');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string' || ['toJSON', '__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('PLAIN_PLAN_REQUIRED');
  stack.add(value);
  let result;
  if (Array.isArray(value)) {
    const length = descriptors.length.value;
    if (length > 1024 || keys.length !== length + 1) throw new Error('PLAIN_PLAN_REQUIRED');
    result = []; Object.setPrototypeOf(result, null);
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('PLAIN_PLAN_REQUIRED');
      result.push?.(); // Arrays have no inherited methods in the plain-data snapshot.
      result[index] = copyPlainData(descriptor.value, stack, depth + 1, budget);
    }
  } else {
    result = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('PLAIN_PLAN_REQUIRED');
      result[key] = copyPlainData(descriptor.value, stack, depth + 1, budget);
    }
  }
  stack.delete(value);
  return result;
}
function normalizePlan(plan) {
  const serialized = JSON.stringify(copyPlainData(plan));
  if (!serialized || Buffer.byteLength(serialized) > 65_536) throw new Error('PLAN_LIMIT');
  const copy = JSON.parse(serialized);
  if (!plain(copy) || copy.contract !== FORGE_WORKFLOW_CONTRACT || !ID.test(copy.id)
    || !Array.isArray(copy.steps) || !copy.steps.length || copy.steps.length > 64
    || Object.keys(copy).some((key) => !['contract', 'id', 'steps', 'acceptanceCriteria'].includes(key))) throw new Error('INVALID_PLAN');
  const ids = new Set();
  for (const step of copy.steps) {
    if (!plain(step) || !ID.test(step.id) || ids.has(step.id) || !ID.test(step.capability)
      || Object.keys(step).some((key) => !['id', 'capability', 'dependsOn', 'input', 'effect'].includes(key))
      || !Array.isArray(step.dependsOn) || step.dependsOn.some((dep) => !ID.test(dep))
      || new Set(step.dependsOn).size !== step.dependsOn.length
      || (step.effect !== undefined && !['read', 'mutation'].includes(step.effect))) throw new Error('INVALID_STEP');
    ids.add(step.id);
  }
  const reachable = new Set();
  while (reachable.size < copy.steps.length) {
    const ready = copy.steps.filter((step) => !reachable.has(step.id) && step.dependsOn.every((id) => reachable.has(id)));
    if (!ready.length) throw new Error('MISSING_DEPENDENCY_OR_CYCLE');
    for (const step of ready) reachable.add(step.id);
  }
  return { plan: copy, digest: hash(serialized) };
}

/** Forge owns scheduling; the trusted host supplies capability adapters and authorization. */
export async function executeForgeWorkflow(input, options = {}) {
  const { plan, digest } = normalizePlan(input);
  const { adapters = {}, authorize, checkpoint, verifyCheckpoint, saveCheckpoint, signal } = options;
  const limits = { maxCalls: bounded(options.budget?.maxCalls, 64, 256),
    maxElapsedMs: bounded(options.budget?.maxElapsedMs, 30_000, 300_000), maxParallel: bounded(options.budget?.maxParallel, 2, 2) };
  const definitions = new Map();
  for (const step of plan.steps) {
    const descriptor = Object.hasOwn(adapters, step.capability) ? adapters[step.capability] : null;
    if (!descriptor || typeof descriptor.execute !== 'function' || !['read', 'mutation'].includes(descriptor.effect)
      || (descriptor.privileged !== undefined && typeof descriptor.privileged !== 'boolean')
      || (step.effect !== undefined && step.effect !== descriptor.effect)) throw new Error('TRUSTED_ADAPTER_REQUIRED');
    definitions.set(step.id, Object.freeze({ execute: descriptor.execute, effect: descriptor.effect, privileged: descriptor.privileged === true }));
  }
  const state = new Map(plan.steps.map((step) => [step.id, 'PENDING']));
  const receipts = []; const completed = new Set();
  if (checkpoint !== undefined) {
    let approved = false;
    try { approved = typeof verifyCheckpoint === 'function' && verifyCheckpoint(checkpoint, Object.freeze({ planDigest: digest })) === true; } catch { /* fail closed */ }
    if (!approved || checkpoint.contract !== 'afyx-forge-checkpoint/v1' || checkpoint.planDigest !== digest
      || !Array.isArray(checkpoint.completed) || checkpoint.completed.some((id) => !state.has(id))
      || new Set(checkpoint.completed).size !== checkpoint.completed.length) throw new Error('UNVERIFIED_CHECKPOINT');
    for (const id of checkpoint.completed) completed.add(id);
    if (plan.steps.some((step) => completed.has(step.id) && step.dependsOn.some((id) => !completed.has(id)))) throw new Error('INVALID_CHECKPOINT_DEPENDENCIES');
    for (const id of completed) state.set(id, 'COMPLETED');
  }
  const snapshot = () => Object.freeze({ contract: 'afyx-forge-checkpoint/v1', planDigest: digest,
    completed: Object.freeze(plan.steps.filter((step) => completed.has(step.id)).map((step) => step.id)) });
  const started = performance.now(); let calls = 0; let stopped = null;
  const controller = new AbortController();
  const abort = () => { stopped ??= 'CANCELLED'; controller.abort(); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  async function run(step) {
    const adapter = definitions.get(step.id);
    const proposal = Object.freeze({ workflowId: plan.id, planDigest: digest, stepId: step.id,
      capability: step.capability, effect: adapter.effect, privileged: adapter.privileged });
    if (adapter.effect === 'mutation' || adapter.privileged) {
      try { if (typeof authorize !== 'function' || authorize(proposal) !== true) return { stepId: step.id, status: 'DENIED' }; }
      catch { return { stepId: step.id, status: 'DENIED' }; }
    }
    if (controller.signal.aborted) return { stepId: step.id, status: 'CANCELLED' };
    const remaining = limits.maxElapsedMs - (performance.now() - started);
    if (remaining <= 0) return { stepId: step.id, status: 'TIMEOUT' };
    let timer; let onStepAbort;
    try {
      const invoke = () => {
        if (controller.signal.aborted) throw new Error('WORKFLOW_ABORTED');
        let consumed = false;
        const action = () => {
          if (consumed) throw new Error('STEP_ALREADY_INVOKED');
          consumed = true; calls++;
          return adapter.execute(step.input ?? {}, { signal: controller.signal, proposal });
        };
        return adapter.effect === 'mutation' && typeof options.runExclusive === 'function'
          ? Promise.resolve(options.runExclusive(proposal, action, { signal: controller.signal })).then((result) => {
            if (!consumed) throw new Error('HOST_LOCK_DID_NOT_EXECUTE');
            return result;
          }) : action();
      };
      const result = await Promise.race([
        adapter.effect === 'mutation' ? serialMutation(invoke, controller.signal) : Promise.resolve().then(invoke),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('WORKFLOW_TIMEOUT')); }, remaining); }),
        new Promise((_, reject) => {
          onStepAbort = () => reject(new Error('WORKFLOW_ABORTED'));
          controller.signal.addEventListener('abort', onStepAbort, { once: true });
        }),
      ]);
      if (!result || !['SUCCESS', 'PASS', 'EXECUTED'].includes(result.status)) return { stepId: step.id, status: 'FAILED' };
      const encoded = JSON.stringify(result);
      if (!encoded || Buffer.byteLength(encoded) > 1_048_576) return { stepId: step.id, status: 'INVALID_RESULT' };
      return { stepId: step.id, status: 'COMPLETED', resultDigest: hash(encoded) };
    } catch { return { stepId: step.id, status: stopped ? 'CANCELLED' : controller.signal.aborted ? 'TIMEOUT' : 'FAILED' }; }
    finally { clearTimeout(timer); if (onStepAbort) controller.signal.removeEventListener('abort', onStepAbort); }
  }
  try {
    while (completed.size < plan.steps.length && !stopped) {
      if (controller.signal.aborted) { stopped = 'CANCELLED'; break; }
      if (calls >= limits.maxCalls || performance.now() - started >= limits.maxElapsedMs) { stopped = 'BUDGET_EXHAUSTED'; break; }
      const ready = plan.steps.filter((step) => state.get(step.id) === 'PENDING' && step.dependsOn.every((id) => completed.has(id)));
      const batch = [];
      for (const step of ready) {
        const mutation = definitions.get(step.id).effect === 'mutation';
        if (mutation && batch.length) break;
        batch.push(step);
        if (mutation || batch.length >= limits.maxParallel || batch.length >= limits.maxCalls - calls) break;
      }
      if (!batch.length) { stopped = 'DEPENDENCY_BLOCKED'; break; }
      for (const step of batch) state.set(step.id, 'RUNNING');
      const outcomes = await Promise.all(batch.map(async (step) => {
        const outcome = await run(step);
        if (outcome.status !== 'COMPLETED') { stopped ??= outcome.status; controller.abort(); }
        return outcome;
      }));
      for (const outcome of outcomes) {
        receipts.push(Object.freeze(outcome)); state.set(outcome.stepId, outcome.status);
        if (outcome.status === 'COMPLETED') {
          completed.add(outcome.stepId);
          if (saveCheckpoint) {
            let saveTimer; let onSaveAbort;
            try {
              const remaining = limits.maxElapsedMs - (performance.now() - started);
              if (remaining <= 0) throw new Error('CHECKPOINT_TIMEOUT');
              await Promise.race([saveCheckpoint(snapshot(), { signal: controller.signal }),
                new Promise((_, reject) => { saveTimer = setTimeout(() => reject(new Error('CHECKPOINT_TIMEOUT')), remaining); }),
                new Promise((_, reject) => {
                  onSaveAbort = () => reject(new Error('WORKFLOW_ABORTED'));
                  controller.signal.addEventListener('abort', onSaveAbort, { once: true });
                  if (controller.signal.aborted) onSaveAbort();
                })]);
            }
            catch { stopped ??= 'CHECKPOINT_SAVE_FAILED_REVIEW_REQUIRED'; }
            finally { clearTimeout(saveTimer); if (onSaveAbort) controller.signal.removeEventListener('abort', onSaveAbort); }
          }
        } else stopped ??= outcome.status;
      }
      if (stopped) controller.abort();
    }
  } finally { signal?.removeEventListener('abort', abort); }
  const acceptance = plan.acceptanceCriteria === undefined ? null : evaluateVerifiedTaskCompletion(plan.acceptanceCriteria,
    options.evidence ?? [], { sourceRevision: options.sourceRevision, verifyEvidence: options.verifyEvidence });
  const successful = !stopped && completed.size === plan.steps.length;
  return Object.freeze({ contract: FORGE_WORKFLOW_CONTRACT, workflowId: plan.id, planDigest: digest,
    status: successful ? acceptance && !acceptance.isComplete ? 'UNVERIFIED' : 'SUCCESS' : 'STOPPED',
    reason: stopped ?? (acceptance && !acceptance.isComplete ? 'ACCEPTANCE_UNVERIFIED' : 'COMPLETED'),
    calls, durationMs: performance.now() - started, mutationIsolation: typeof options.runExclusive === 'function' ? 'TRUSTED_HOST_LOCK_CALLBACK' : 'PROCESS_LOCAL',
    checkpoint: snapshot(), receipts: Object.freeze(receipts),
    steps: Object.freeze(plan.steps.map((step) => Object.freeze({ id: step.id, status: state.get(step.id) }))), acceptance });
}
