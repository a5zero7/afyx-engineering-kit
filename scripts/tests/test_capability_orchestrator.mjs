import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AFYX_CAPABILITY_REQUEST_CONTRACT,
  AFYX_CAPABILITY_RESULT_CONTRACT,
  PRIMARY_COMPONENT_IDS,
  SEVEN_REGISTERED_COMPONENT_IDS,
  discoverAfyxCapabilities,
  executeAfyxCapabilityRoute,
  getRegisteredComponent,
  getRegisteredComponentIds,
  registerAfyxComponent,
  resolveAfyxCapabilityRoute,
  unregisterAfyxComponent,
} from '../afyx-capability-orchestrator.mjs';

const SOURCE = 'candidate-308';

function state(availableIds = SEVEN_REGISTERED_COMPONENT_IDS) {
  return Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, {
    installed: availableIds.includes(id),
    enabled: true,
    healthy: availableIds.includes(id),
    compatible: availableIds.includes(id),
    authorized: availableIds.includes(id),
    sourceIdentity: availableIds.includes(id) ? SOURCE : null,
    ...(id === 'afyx-graph' && availableIds.includes(id) ? { indexReady: true, indexFresh: true } : {}),
    observationSource: 'TEST_FIXTURE',
  }]));
}

function options(task, availableIds = SEVEN_REGISTERED_COMPONENT_IDS, extra = {}) {
  return {
    task: {
      id: `task-${task.taskType ?? 'generic'}`,
      workspaceIdentity: 'fixture/repository',
      sourceRevision: 'abc123',
      ...task,
    },
    provider: 'codex',
    componentStates: state(availableIds),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. Versioned Contracts & Schemas
// ---------------------------------------------------------------------------
test('versioned request and result schemas are present and identify v1 contracts', () => {
  const requestSchema = JSON.parse(readFileSync(new URL('../contracts/afyx-capability-request-v1.schema.json', import.meta.url)));
  const resultSchema = JSON.parse(readFileSync(new URL('../contracts/afyx-capability-result-v1.schema.json', import.meta.url)));
  assert.equal(requestSchema.$id, AFYX_CAPABILITY_REQUEST_CONTRACT);
  assert.equal(resultSchema.$id, AFYX_CAPABILITY_RESULT_CONTRACT);
});

// ---------------------------------------------------------------------------
// 2. Default-Enabled Capability Integration (Requirement 1 & 2)
// ---------------------------------------------------------------------------
test('installed components are enabled by default for interop discovery while explicit OFF is honored', () => {
  // Omit enabled field entirely — installed components must be default-enabled for interoperability
  const defaultStates = {
    'afyx-graph': {
      installed: true,
      healthy: true,
      compatible: true,
      authorized: true,
      sourceIdentity: SOURCE,
      indexReady: true,
      indexFresh: true,
    },
    'afyx-context': {
      installed: true,
      enabled: false, // explicit OFF
      healthy: true,
      compatible: true,
      authorized: true,
      sourceIdentity: SOURCE,
    },
  };
  const discovery = discoverAfyxCapabilities({ componentStates: defaultStates, provider: 'codex' });
  assert.equal(discovery.capabilities['afyx-graph'].enabled, true);
  assert.equal(discovery.capabilities['afyx-graph'].available, true);
  assert.equal(discovery.capabilities['afyx-graph'].reason, 'AVAILABLE');

  assert.equal(discovery.capabilities['afyx-context'].enabled, false);
  assert.equal(discovery.capabilities['afyx-context'].available, false);
  assert.equal(discovery.capabilities['afyx-context'].reason, 'EXPLICITLY_DISABLED');
});

test('installed-but-irrelevant capabilities remain completely idle', () => {
  // All 7 components installed and healthy, but task is a focused Odoo task without relational need
  const route = resolveAfyxCapabilityRoute(options(
    { taskType: 'odoo-fix', project: { isOdoo: true } },
    SEVEN_REGISTERED_COMPONENT_IDS,
  ));
  const selectedIds = route.requests.map((r) => r.targetComponentId);
  assert.equal(selectedIds.includes('odoo-engineering'), true);
  assert.equal(selectedIds.includes('afyx-graph'), false, 'Graph must remain idle for non-relational task');
  assert.equal(selectedIds.includes('afyx-context'), false, 'Context must remain idle');
  assert.equal(selectedIds.includes('afyx-forge'), false, 'Forge must remain idle');
  assert.equal(selectedIds.includes('codex-usage-tracking'), false, 'Usage tracking must remain idle');
});

// ---------------------------------------------------------------------------
// 3. Simple Direct-Source Task (Requirement 3)
// ---------------------------------------------------------------------------
test('known-file string replacement uses direct source with zero runtime invocation', async () => {
  let calls = 0;
  const result = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'string-replacement', knownFile: true }),
    adapters: Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, () => { calls += 1; return { status: 'SUCCESS' }; }])),
  });
  assert.equal(result.directSourceFastPath, true);
  assert.equal(result.executionStatus, 'DIRECT_SOURCE');
  assert.equal(result.metrics.selectedCapabilities, 0);
  assert.equal(result.metrics.executedCapabilities, 0);
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------------------
// 4. Standalone Operation for ALL Seven Components (Requirement 5)
// ---------------------------------------------------------------------------
test('each of the seven registered components executes its advertised standalone route with all peers absent', async () => {
  const cases = [
    ['efficient-coding', { taskType: 'implementation' }],
    ['odoo-engineering', { taskType: 'odoo-fix', project: { isOdoo: true } }],
    ['afyx-engineering-expert', { taskType: 'architecture' }],
    ['afyx-graph', { taskType: 'relationship-analysis', needsRelationalEvidence: true }],
    ['afyx-context', { taskType: 'large-context', needsContextOptimization: true }],
    ['afyx-forge', { taskType: 'forge-advice', forgeAdvice: true }],
    ['codex-usage-tracking', { taskType: 'usage-telemetry', needsTelemetry: true }],
  ];
  for (const [componentId, task] of cases) {
    const provider = componentId === 'afyx-forge' ? null : 'codex';
    const result = await executeAfyxCapabilityRoute({
      ...options(task, [componentId], {
        provider,
        providerPermissions: componentId === 'afyx-forge' ? { 'afyx-forge': true } : {},
      }),
      adapters: { [componentId]: () => ({ status: 'SUCCESS', output: `output-from-${componentId}` }) },
    });
    assert.equal(result.metrics.executedCapabilities, 1, `Failed standalone execution for ${componentId}`);
    assert.equal(result.results[0].componentId, componentId);
    assert.equal(result.results[0].output, `output-from-${componentId}`);
    assert.equal(result.results[0].executionStatus, 'EXECUTED');
  }
});

test('missing optional Graph degrades to direct source without preventing useful output', async () => {
  const result = await executeAfyxCapabilityRoute(options(
    { taskType: 'impact-analysis', needsRelationalEvidence: true },
    ['efficient-coding'],
  ));
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.executionStatus, 'NOT_RUN');
  assert.deepEqual(result.degradations.map((item) => item.componentId), ['afyx-graph']);
  assert.equal(result.degradations[0].fallback, 'DIRECT_SOURCE');
});

// ---------------------------------------------------------------------------
// 5. Meaningful Bidirectional Capability Handoffs (Requirement 4)
// ---------------------------------------------------------------------------
test('bidirectional handoff: Odoo requests Graph evidence, Graph requests Context reduction', async () => {
  const callSequence = [];
  const result = await executeAfyxCapabilityRoute({
    ...options({
      taskType: 'odoo-fix',
      project: { isOdoo: true },
    }, ['odoo-engineering', 'afyx-graph', 'afyx-context']),
    adapters: {
      'odoo-engineering': (request) => {
        callSequence.push(request.targetComponentId);
        return {
          status: 'SUCCESS',
          evidence: [{ kind: 'odoo-model', value: 'sale.order' }],
          followUpRequests: [{ targetComponentId: 'afyx-graph', invocationReason: 'Inspect model inheritance' }],
        };
      },
      'afyx-graph': (request) => {
        callSequence.push(request.targetComponentId);
        return {
          status: 'SUCCESS',
          evidence: [{ kind: 'graph-edge', path: 'models/order.py' }],
          followUpRequests: [{ targetComponentId: 'afyx-context', invocationReason: 'Compress large graph payload' }],
        };
      },
      'afyx-context': (request) => {
        callSequence.push(request.targetComponentId);
        return {
          status: 'SUCCESS',
          output: 'ace:v1:reduced:token',
          contextBytes: 256,
        };
      },
    },
  });
  assert.deepEqual(callSequence, ['odoo-engineering', 'afyx-graph', 'afyx-context']);
  assert.equal(result.results.length, 3);
  assert.equal(result.results[0].componentId, 'odoo-engineering');
  assert.equal(result.results[1].componentId, 'afyx-graph');
  assert.equal(result.results[2].componentId, 'afyx-context');
  assert.equal(result.metrics.executedCapabilities, 3);
});

test('bidirectional handoff: Engineering Expert requests Odoo framework advice and records Usage Telemetry', async () => {
  const callSequence = [];
  const result = await executeAfyxCapabilityRoute({
    ...options({
      taskType: 'architecture',
    }, ['afyx-engineering-expert', 'odoo-engineering', 'codex-usage-tracking']),
    adapters: {
      'afyx-engineering-expert': (request) => {
        callSequence.push(request.targetComponentId);
        return {
          status: 'SUCCESS',
          followUpRequests: [
            { targetComponentId: 'odoo-engineering', invocationReason: 'Obtain Odoo architectural constraint' },
            { targetComponentId: 'codex-usage-tracking', invocationReason: 'Record session telemetry' },
          ],
        };
      },
      'odoo-engineering': (request) => {
        callSequence.push(request.targetComponentId);
        return { status: 'SUCCESS', output: 'odoo-v17-constraint' };
      },
      'codex-usage-tracking': (request) => {
        callSequence.push(request.targetComponentId);
        return { status: 'SUCCESS', output: 'telemetry-event-logged' };
      },
    },
  });
  assert.deepEqual(callSequence, ['afyx-engineering-expert', 'odoo-engineering', 'codex-usage-tracking']);
  assert.equal(result.metrics.executedCapabilities, 3);
});

// ---------------------------------------------------------------------------
// 6. Selective Activation, Authority, and Domain Ownership (Requirement 4 & 5)
// ---------------------------------------------------------------------------
test('Graph is selected only for beneficial relational work', () => {
  const ordinary = resolveAfyxCapabilityRoute(options({ taskType: 'implementation' }, ['efficient-coding', 'afyx-graph']));
  const relational = resolveAfyxCapabilityRoute(options({ taskType: 'impact-analysis', needsRelationalEvidence: true }, ['efficient-coding', 'afyx-graph']));
  assert.deepEqual(ordinary.requests.map((request) => request.targetComponentId), ['efficient-coding']);
  assert.equal(ordinary.requests.some((request) => request.targetComponentId === 'afyx-graph'), false);
  assert.equal(relational.requests.some((request) => request.targetComponentId === 'afyx-graph'), true);
});

test('Context is selective, returns exact adapter recovery, and explicit OFF wins', async () => {
  const payload = 'byte-exact:\u0000:\ud83d\udca1';
  const selected = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'large-context', needsContextOptimization: true }, ['afyx-context']),
    adapters: {
      'afyx-context': () => ({ status: 'SUCCESS', output: payload, contextBytes: Buffer.byteLength(payload) }),
    },
  });
  assert.equal(selected.results[0].output, payload);
  assert.equal(selected.metrics.contextBytes, Buffer.byteLength(payload));

  const disabled = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'large-context', needsContextOptimization: true }, ['afyx-context']),
    environment: { AFYX_CONTEXT_OPT_IN: '0' },
    adapters: { 'afyx-context': () => { throw new Error('must not execute'); } },
  });
  assert.equal(disabled.metrics.executedCapabilities, 0);
  assert.equal(
    disabled.degradations.find((item) => item.componentId === 'afyx-context')?.reason,
    'EXPLICITLY_DISABLED',
  );
});

// ---------------------------------------------------------------------------
// 7. Duplicate, Cycle, Hop, and Budget Enforcement (Requirement 4 & 7)
// ---------------------------------------------------------------------------
test('duplicate and cyclic follow-ups are suppressed without repeated execution', async () => {
  let graphCalls = 0;
  let contextCalls = 0;
  const result = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'impact-analysis', needsRelationalEvidence: true }, ['afyx-graph', 'afyx-context']),
    adapters: {
      'afyx-graph': () => {
        graphCalls += 1;
        return {
          status: 'SUCCESS',
          followUpRequests: [{ targetComponentId: 'afyx-context', invocationReason: 'optimize evidence' }],
        };
      },
      'afyx-context': () => {
        contextCalls += 1;
        return {
          status: 'SUCCESS',
          followUpRequests: [{ targetComponentId: 'afyx-graph', invocationReason: 'cycle back' }],
        };
      },
    },
  });
  assert.equal(graphCalls, 1);
  assert.equal(contextCalls, 1);
  assert.equal(result.metrics.duplicateInvocationsAvoided, 1);
  assert.equal(result.results.at(-1).reason, 'DUPLICATE_REQUEST');
});

test('direct self-cycle in followUpRequests is rejected with DIRECT_SELF_CYCLE', async () => {
  let calls = 0;
  const result = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'impact-analysis', needsRelationalEvidence: true }, ['afyx-graph']),
    adapters: {
      'afyx-graph': () => {
        calls += 1;
        return {
          status: 'SUCCESS',
          followUpRequests: [{ targetComponentId: 'afyx-graph', invocationReason: 'recursive self call' }],
        };
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.results.some((r) => r.reason === 'DIRECT_SELF_CYCLE'), true);
});

test('failed adapters are counted as attempted calls and never relabeled executed', async () => {
  const result = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'implementation' }, ['efficient-coding']),
    adapters: { 'efficient-coding': () => { throw new Error('adapter failure'); } },
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.executionStatus, 'NOT_RUN');
  assert.equal(result.metrics.toolCalls, 1);
  assert.equal(result.metrics.executedCapabilities, 0);
  assert.equal(result.results[0].executionStatus, 'FAILED');
});

test('non-cooperative adapter is bounded by execution timeout and reported failed', async () => {
  const result = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'implementation' }, ['efficient-coding']),
    budgetLimits: { maxExecutionMs: 10 },
    adapters: { 'efficient-coding': () => new Promise(() => {}) },
  });
  assert.equal(result.metrics.toolCalls, 1);
  assert.equal(result.results[0].executionStatus, 'FAILED');
  assert.equal(result.results[0].reason, 'EXECUTION_TIME_BUDGET_EXHAUSTED');
  assert.equal(result.metrics.elapsedMs < 250, true);
});

test('tool, capability, and context budgets are enforced honestly', async () => {
  const result = await executeAfyxCapabilityRoute({
    ...options({
      taskType: 'odoo-impact-analysis',
      project: { isOdoo: true },
      needsRelationalEvidence: true,
      needsContextOptimization: true,
    }, ['odoo-engineering', 'afyx-graph', 'afyx-context']),
    budgetLimits: { maxToolCalls: 1, maxCapabilities: 2, maxContextBytes: 8, maxExecutionMs: 5000, maxHops: 1 },
    adapters: {
      'odoo-engineering': () => ({ status: 'SUCCESS', contextBytes: 9 }),
      'afyx-graph': () => ({ status: 'SUCCESS' }),
      'afyx-context': () => ({ status: 'SUCCESS' }),
    },
  });
  assert.equal(result.metrics.executedCapabilities, 1);
  assert.equal(result.metrics.contextBytes, 9);
  assert.equal(result.degradations.some((item) => item.reason === 'CAPABILITY_BUDGET_EXHAUSTED'), true);
});

// ---------------------------------------------------------------------------
// 8. Security, Permissions, and Forge A8 Gating (Requirement 5 & 6)
// ---------------------------------------------------------------------------
test('Forge advice is bounded but autonomous or campaign execution remains A8-blocked', async () => {
  let calls = 0;
  const advice = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'forge-advice', intent: 'Afyx Forge advice', forgeAdvice: true }, ['afyx-forge'], {
      provider: null,
      providerPermissions: { 'afyx-forge': true },
    }),
    adapters: { 'afyx-forge': () => { calls += 1; return { status: 'SUCCESS', output: 'advice' }; } },
  });
  assert.equal(advice.executionStatus, 'EXECUTED');
  const blocked = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'forge-campaign', autonomousExecution: true }, ['afyx-forge'], {
      provider: null,
      providerPermissions: { 'afyx-forge': true },
    }),
    adapters: { 'afyx-forge': () => { calls += 1; return { status: 'SUCCESS' }; } },
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.executionStatus, 'BLOCKED');
  assert.equal(calls, 1);
});

test('existing host authorization refusal propagates and prevents adapter execution', async () => {
  let calls = 0;
  const result = await executeAfyxCapabilityRoute({
    ...options({ taskType: 'impact-analysis', needsRelationalEvidence: true }, ['afyx-graph']),
    hostAuthorizations: {
      mcpEnabled: false,
      attemptedCliBypass: true,
      cliBypassAllowed: false,
    },
    adapters: { 'afyx-graph': () => { calls += 1; return { status: 'SUCCESS' }; } },
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.executionStatus, 'BLOCKED');
  assert.equal(result.diagnostics.some((item) => item.code === 'CLI_BYPASS_REFUSED'), true);
  assert.equal(calls, 0);
});

test('telemetry capability is gated by provider permission and unsupported provider rejects it', () => {
  // Codex supports usage telemetry
  const codexDiscovery = discoverAfyxCapabilities({
    componentStates: { 'codex-usage-tracking': { installed: true, healthy: true, compatible: true, authorized: true, sourceIdentity: SOURCE } },
    provider: 'codex',
  });
  assert.equal(codexDiscovery.capabilities['codex-usage-tracking'].available, true);

  // Antigravity does not support codex-specific telemetry
  const agyDiscovery = discoverAfyxCapabilities({
    componentStates: { 'codex-usage-tracking': { installed: true, healthy: true, compatible: true, authorized: true, sourceIdentity: SOURCE } },
    provider: 'antigravity',
  });
  assert.equal(agyDiscovery.capabilities['codex-usage-tracking'].available, false);
  assert.equal(agyDiscovery.capabilities['codex-usage-tracking'].reason, 'UNAUTHORIZED_OR_UNVERIFIED');
});

test('discovery fails closed for health, compatibility, authorization, and positive evidence', () => {
  const componentStates = state(['afyx-graph']);
  componentStates['afyx-graph'] = { ...componentStates['afyx-graph'], compatible: false };
  let discovery = discoverAfyxCapabilities({ componentStates, provider: 'codex' });
  assert.equal(discovery.capabilities['afyx-graph'].reason, 'INCOMPATIBLE_OR_UNVERIFIED');

  componentStates['afyx-graph'] = { ...componentStates['afyx-graph'], compatible: true, indexFresh: false };
  discovery = discoverAfyxCapabilities({ componentStates, provider: 'codex' });
  assert.equal(discovery.capabilities['afyx-graph'].reason, 'GRAPH_INDEX_NOT_READY_OR_FRESH');

  componentStates['afyx-graph'] = { ...componentStates['afyx-graph'], indexFresh: true, sourceIdentity: null };
  discovery = discoverAfyxCapabilities({ componentStates, provider: 'codex' });
  assert.equal(discovery.capabilities['afyx-graph'].reason, 'SOURCE_IDENTITY_UNVERIFIED');
});

// ---------------------------------------------------------------------------
// 9. Deterministic Routing Over All 127 Non-Empty Presence Masks (Requirement 9)
// ---------------------------------------------------------------------------
test('all 127 non-empty component presence masks route deterministically across seven components', () => {
  const taskCases = [
    { taskType: 'implementation' },
    { taskType: 'odoo-impact-analysis', project: { isOdoo: true }, needsRelationalEvidence: true },
    { taskType: 'architecture' },
    { taskType: 'large-context', needsContextOptimization: true },
    { taskType: 'forge-advice', forgeAdvice: true },
    { taskType: 'usage-telemetry', needsTelemetry: true },
  ];

  // 2^7 - 1 = 127 non-empty masks
  for (let mask = 1; mask < 128; mask += 1) {
    const installed = SEVEN_REGISTERED_COMPONENT_IDS.filter((_, index) => (mask & (1 << index)) !== 0);
    for (const task of taskCases) {
      const first = resolveAfyxCapabilityRoute(options(task, installed));
      const second = resolveAfyxCapabilityRoute(options(task, installed));
      const projection = (route) => ({
        status: route.status,
        requests: route.requests.map((request) => request.targetComponentId),
        degradations: route.degradations,
        states: Object.fromEntries(Object.entries(route.discovery.capabilities).map(([id, value]) => [id, value.reason])),
      });
      assert.deepEqual(projection(first), projection(second), `mask ${mask} task ${task.taskType}`);
      assert.equal(['READY', 'DEGRADED', 'BLOCKED'].includes(first.status), true);
    }
  }
});

// ---------------------------------------------------------------------------
// 10. Dynamic Discovery & Routing of Synthetic Future Component (Requirement 10)
// ---------------------------------------------------------------------------
test('dynamic discovery and routing of synthetic future component without hardcoded allowlist edits', async () => {
  const syntheticComponentId = 'afyx-security-auditor';
  const syntheticCapability = 'vulnerability-audit-capability';

  // 1. Dynamically register synthetic component via API
  registerAfyxComponent({
    id: syntheticComponentId,
    canonicalName: 'Afyx Security Auditor',
    type: 'runtime',
    primaryCapability: syntheticCapability,
    domainAuthority: 'Automated vulnerability scanning and security posture audit.',
  });

  try {
    assert.equal(getRegisteredComponentIds().includes(syntheticComponentId), true);
    assert.equal(getRegisteredComponent(syntheticComponentId)?.primaryCapability, syntheticCapability);

    // 2. Discover capabilities with synthetic component present (isolated environment with Graph)
    const componentStates = {
      [syntheticComponentId]: {
        installed: true,
        healthy: true,
        compatible: true,
        authorized: true,
        sourceIdentity: 'synthetic-audit-v1',
      },
      'afyx-graph': {
        installed: true,
        healthy: true,
        compatible: true,
        authorized: true,
        sourceIdentity: 'graph-v1',
        indexReady: true,
        indexFresh: true,
      },
    };

    const discovery = discoverAfyxCapabilities({ componentStates, provider: 'codex' });
    assert.equal(discovery.capabilities[syntheticComponentId]?.available, true);
    assert.equal(discovery.capabilities[syntheticComponentId]?.capability, syntheticCapability);

    // 3. Resolve route for a task requiring this custom capability
    const route = resolveAfyxCapabilityRoute({
      task: {
        id: 'task-sec-audit',
        taskType: 'security-audit',
        needsCustomCapability: syntheticCapability,
        customComponentId: syntheticComponentId,
        workspaceIdentity: 'repo/app',
        sourceRevision: 'sec-123',
      },
      provider: 'codex',
      componentStates,
    });

    assert.equal(route.requests.some((r) => r.targetComponentId === syntheticComponentId), true);
    assert.equal(route.domainAuthorities[syntheticCapability], syntheticComponentId);

    // 4. Execute route through adapter and prove bidirectional collaboration with existing Graph component
    let syntheticExecuted = false;
    let graphExecuted = false;

    const result = await executeAfyxCapabilityRoute({
      task: {
        id: 'task-sec-audit',
        taskType: 'security-audit',
        needsCustomCapability: syntheticCapability,
        customComponentId: syntheticComponentId,
        workspaceIdentity: 'repo/app',
        sourceRevision: 'sec-123',
      },
      provider: 'codex',
      componentStates,
      adapters: {
        [syntheticComponentId]: (request) => {
          syntheticExecuted = true;
          return {
            status: 'SUCCESS',
            output: { vulnerabilities: 0, posture: 'SECURE' },
            followUpRequests: [{ targetComponentId: 'afyx-graph', invocationReason: 'Verify dependencies for CVEs' }],
          };
        },
        'afyx-graph': (request) => {
          graphExecuted = true;
          return {
            status: 'SUCCESS',
            output: { graphScanned: true },
          };
        },
      },
    });

    assert.equal(syntheticExecuted, true, 'Synthetic component adapter should execute');
    assert.equal(graphExecuted, true, 'Graph adapter should execute follow-up from synthetic component');
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].componentId, syntheticComponentId);
    assert.equal(result.results[1].componentId, 'afyx-graph');
    assert.equal(result.results[0].provenance.componentSourceIdentity, 'synthetic-audit-v1');
    assert.equal(result.results[0].provenance.observationSource, 'ADAPTER_EXECUTION');
  } finally {
    unregisterAfyxComponent(syntheticComponentId);
  }
});
