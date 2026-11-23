import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAfyxCapabilityRoute, getRegisteredComponentIds } from '../afyx-capability-orchestrator.mjs';
const states = () => Object.fromEntries(getRegisteredComponentIds().map((id) => [id, {
  installed: true, enabled: true, healthy: true, compatible: true, authorized: true,
  sourceIdentity: 'independent-fixture', indexReady: true, indexFresh: true,
}]));
const options = (task, extra = {}) => ({ task, provider: 'codex', providerPermissions: { 'afyx-forge': true },
  componentStates: states(), adapters: Object.fromEntries(getRegisteredComponentIds().map((id) => [id, () => ({ status: 'SUCCESS', output: id })])), ...extra });
for (const [taskType, expected] of [['odoo-fix', 'odoo-engineering'], ['github-operation', 'afyx-native-github'],
  ['documentation-search', 'afyx-context'], ['multi-agent-workflow', 'afyx-forge'], ['cli-automation', 'afyx-native-execution']]) {
  test(`${taskType} loads and invokes only the selected domain; all installed tools stay discoverable`, async () => {
    const loaded = [];
    const result = await executeAfyxCapabilityRoute(options({ taskType, project: { framework: 'odoo' } }, {
      loadCapabilityDetails: async (request) => { loaded.push(request.targetComponentId); return { description: 'Relevant detailed schema' }; },
    }));
    assert.deepEqual(result.metrics.invokedTools, [expected]);
    assert.deepEqual(loaded, [expected]);
    assert.equal(result.metrics.discoveredTools.length, getRegisteredComponentIds().length);
    assert.equal(result.metrics.unnecessaryInvocationCount, 0);
    assert.equal(result.metrics.schemaBytes, Buffer.byteLength(JSON.stringify({ description: 'Relevant detailed schema' })));
    assert.equal(result.metrics.registrationTokenSavings, 'NOT_CLAIMED');
  });
}
test('host framework/file context routes Odoo; explicit GitHub domain overrides framework context', async () => {
  const hostMetadata = { file: { path: 'addons/sale/models/order.py', framework: 'odoo' } };
  assert.deepEqual((await executeAfyxCapabilityRoute(options({}, { hostMetadata }))).metrics.invokedTools, ['odoo-engineering']);
  assert.deepEqual((await executeAfyxCapabilityRoute(options({ domain: 'github' }, { hostMetadata }))).metrics.invokedTools, ['afyx-native-github']);
});
test('known-source edits load zero schemas and execute zero tools despite framework hints', async () => {
  let loads = 0;
  const result = await executeAfyxCapabilityRoute(options({ taskType: 'string-replacement', exactKnownSource: true }, {
    hostMetadata: { project: { framework: 'odoo' } }, loadCapabilityDetails: () => { loads++; },
  }));
  assert.equal(result.executionStatus, 'DIRECT_SOURCE'); assert.equal(loads, 0); assert.equal(result.metrics.toolCalls, 0);
  const document = await executeAfyxCapabilityRoute(options({ taskType: 'string-replacement', exactKnownSource: true }, {
    hostMetadata: { domain: 'documentation' }, loadCapabilityDetails: () => { throw Error('not needed'); },
  }));
  assert.equal(document.executionStatus, 'DIRECT_SOURCE');
});
for (const [task, hostMetadata] of [[{ domain: 'unknown-domain' }, {}], [{}, { domains: ['github', 'odoo'] }], [{ intent: 'Review GitHub and Odoo' }, {}]]) {
  test(`unknown/ambiguous domain stays idle: ${JSON.stringify(task)}`, async () => {
    const result = await executeAfyxCapabilityRoute(options(task, { hostMetadata }));
    assert.deepEqual(result.metrics.invokedTools, []); assert.ok(result.diagnostics.length);
  });
}
test('custom provider restrictions are request-local and overlapping authorities fail closed', async () => {
  const custom = { id: 'future-fixture', primaryCapability: 'future-capability', providers: ['codex'] };
  const data = options({ customComponentId: custom.id }, { customComponents: [custom], provider: 'antigravity',
    componentStates: { [custom.id]: { installed: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'fixture' } } });
  assert.equal((await executeAfyxCapabilityRoute(data)).discovery.capabilities[custom.id].reason, 'UNAUTHORIZED_OR_UNVERIFIED');
  const overlapping = ['future-one', 'future-two'].map((id) => ({ id, primaryCapability: 'overlap' }));
  let loads = 0;
  const result = await executeAfyxCapabilityRoute(options({ needsCustomCapability: 'overlap' }, {
    customComponents: overlapping, loadCapabilityDetails: () => { loads++; return {}; },
    componentStates: Object.fromEntries(overlapping.map(({ id }) => [id, { installed: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'fixture' }])),
  }));
  assert.equal(result.status, 'BLOCKED'); assert.equal(loads, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'AUTHORITY_CONFLICT'));
  const handoff = await executeAfyxCapabilityRoute(options({ customComponentId: 'future-one' }, {
    customComponents: overlapping,
    componentStates: Object.fromEntries(overlapping.map(({ id }) => [id, { installed: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'fixture' }])),
    adapters: { 'future-one': () => ({ status: 'SUCCESS', followUpRequests: [{ targetComponentId: 'future-two', invocationReason: 'Duplicate owner' }] }) },
  }));
  assert.deepEqual(handoff.metrics.invokedTools, ['future-one']);
  assert.ok(handoff.results.some((item) => item.reason === 'FOLLOW_UP_AUTHORITY_CONFLICT'));
});
test('autonomous Forge and host MCP denial cannot be granted by task metadata', async () => {
  let loads = 0;
  const result = await executeAfyxCapabilityRoute(options({ taskType: 'autonomous-forge', payload: { authorized: true } }, {
    loadCapabilityDetails: () => { loads++; return {}; },
  }));
  assert.equal(result.executionStatus, 'BLOCKED'); assert.equal(loads, 0);
});
test('unrelated adapter follow-ups are rejected without schema load or invocation', async () => {
  const result = await executeAfyxCapabilityRoute(options({ taskType: 'odoo-fix' }, { adapters: {
    'odoo-engineering': () => ({ status: 'SUCCESS', followUpRequests: [{ targetComponentId: 'afyx-native-github', invocationReason: 'Unrelated request' }] }),
    'afyx-native-github': () => { throw Error('must not execute'); },
  } }));
  assert.deepEqual(result.metrics.invokedTools, ['odoo-engineering']);
  assert.equal(result.metrics.blockedOutOfScopeRequests, 1);
  assert.ok(result.results.some((item) => item.reason === 'FOLLOW_UP_OUT_OF_SCOPE'));
});
test('explicit selection remains bounded by permissions and OFF before loading details', async () => {
  let loads = 0;
  const data = options({ domain: 'github', manualSelection: ['afyx-context'] }, { loadCapabilityDetails: () => { loads++; return {}; } });
  data.componentStates['afyx-native-github'].authorized = false;
  data.componentStates['afyx-context'].enabled = false;
  const result = await executeAfyxCapabilityRoute(data);
  assert.equal(result.metrics.toolCalls, 0); assert.equal(loads, 0);
});
test('explicit manual selection is retained even outside the automatic domain', async () => {
  const result = await executeAfyxCapabilityRoute(options({ domain: 'github', manualSelection: ['odoo-engineering'] }));
  assert.deepEqual(result.metrics.invokedTools, ['afyx-native-github', 'odoo-engineering']);
});
test('schema byte/deadline budgets stop invocation and loader cannot leak across requests', async () => {
  const request = { taskType: 'github-operation' }; let calls = 0;
  const adapters = { 'afyx-native-github': () => { calls++; return { status: 'SUCCESS' }; } };
  const oversized = await executeAfyxCapabilityRoute(options(request, { adapters, budgetLimits: { maxContextBytes: 16 }, loadCapabilityDetails: () => ({ description: 'x'.repeat(100) }) }));
  assert.equal(calls, 0); assert.equal(oversized.results[0].reason, 'SCHEMA_CONTEXT_BUDGET_EXHAUSTED');
  const slow = await executeAfyxCapabilityRoute(options(request, { adapters, budgetLimits: { maxExecutionMs: 5 },
    loadCapabilityDetails: () => new Promise((resolve) => setTimeout(() => resolve({}), 20)) }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls, 0); assert.equal(slow.metrics.toolCalls, 0);
  const results = await Promise.all(['first', 'second'].map((tag) => executeAfyxCapabilityRoute(options(request, {
    loadCapabilityDetails: () => ({ tag }), adapters: { 'afyx-native-github': (_request, control) => ({ status: 'SUCCESS', output: control.capabilityDetails.tag }) },
  }))));
  assert.deepEqual(results.map((result) => result.results[0].output), ['first', 'second']);
});
