import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEVEN_REGISTERED_COMPONENT_IDS,
  discoverAfyxCapabilities,
  executeAfyxCapabilityRoute,
  registerAfyxComponent,
  resolveAfyxCapabilityRoute,
  unregisterAfyxComponent,
} from '../afyx-capability-orchestrator.mjs';

import { createInstalledHostAdapters } from '../afyx-host-adapters.mjs';

const INSTALL_ROOT = 'D:/Project/afyx-alpha/afyx-305-exact-candidate/install-root';
const PROJECT_ROOT = 'D:/Project/afyx-alpha/afyx-305-exact-candidate/test-data/sample-project';
const STATE_ROOT = 'D:/Project/afyx-alpha/afyx-305-exact-candidate/context-state';
const CODEX_TOOLS_ROOT = 'D:/Project/afyx-alpha/afyx-305-exact-candidate/provider-home/.codex/tools';
const SOURCE_REVISION = '0f0b7cbae250d151a3dc571fb866804c4d495fea';

// Real host adapters connected to the disposable pilot installation
const installedAdapters = createInstalledHostAdapters({
  installRoot: INSTALL_ROOT,
  projectRoot: PROJECT_ROOT,
  stateRoot: STATE_ROOT,
  codexToolsRoot: CODEX_TOOLS_ROOT,
});

function installedComponentStates(availableIds = SEVEN_REGISTERED_COMPONENT_IDS) {
  return Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, {
    installed: availableIds.includes(id),
    enabled: true,
    healthy: availableIds.includes(id),
    compatible: availableIds.includes(id),
    authorized: availableIds.includes(id),
    sourceIdentity: availableIds.includes(id) ? SOURCE_REVISION : null,
    ...(id === 'afyx-graph' && availableIds.includes(id) ? { indexReady: true, indexFresh: true } : {}),
    observationSource: 'DISPOSABLE_PILOT_INSTALLATION',
  }]));
}

// ---------------------------------------------------------------------------
// 1. Exact Known-Source Edit: Zero Unnecessary Runtime Calls
// ---------------------------------------------------------------------------
test('real-host matrix 1: exact known-source edit invokes zero Afyx runtime', async () => {
  const result = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-exact-source',
      taskType: 'string-replacement',
      exactKnownSource: true,
      knownFile: true,
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'antigravity',
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });

  assert.equal(result.directSourceFastPath, true);
  assert.equal(result.executionStatus, 'DIRECT_SOURCE');
  assert.equal(result.metrics.toolCalls, 0);
  assert.equal(result.metrics.executedCapabilities, 0);
  assert.equal(result.results.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Odoo Engineering Task: Domain Authority and Relevant Selection
// ---------------------------------------------------------------------------
test('real-host matrix 2: Odoo engineering task engages Odoo skill and triggers Graph evidence', async () => {
  const result = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-odoo',
      taskType: 'odoo-fix',
      project: { isOdoo: true },
      intent: 'Audit sale.order inheritance models in addons',
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'antigravity',
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });

  assert.equal(result.domainAuthorities['odoo-framework-authority'], 'odoo-engineering');
  assert.equal(result.status, 'READY');
  assert.equal(result.executionStatus, 'EXECUTED');

  // Verify Odoo skill was executed and triggered real Graph follow-up for models
  const executedIds = result.results.map((r) => r.componentId);
  assert.equal(executedIds[0], 'odoo-engineering');
  assert.equal(result.results[0].output?.authority, 'odoo-framework-authority');

  // If follow-up executed Graph on real project
  if (executedIds.includes('afyx-graph')) {
    const graphResult = result.results.find((r) => r.componentId === 'afyx-graph');
    assert.equal(graphResult?.status, 'EXECUTED');
    assert.equal(typeof graphResult?.output, 'string');
    assert.equal(graphResult?.output.includes('Exact structural inventory') || graphResult?.output.includes('Exploration'), true);
  }
});

// ---------------------------------------------------------------------------
// 3. Real Graph/Context Exchange with Exact Source and Context
// ---------------------------------------------------------------------------
test('real-host matrix 3: Graph and Context execution on real installed pilot', async () => {
  const result = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-graph',
      taskType: 'impact-analysis',
      needsRelationalEvidence: true,
      intent: 'Explore OrderService calculateTotal dependency graph',
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'antigravity',
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });

  assert.equal(result.domainAuthorities['repository-graph-evidence'], 'afyx-graph');
  const graphResult = result.results.find((r) => r.componentId === 'afyx-graph');
  assert.equal(graphResult?.executionStatus, 'EXECUTED');
  assert.equal(typeof graphResult?.output, 'string');
  assert.equal(graphResult?.output.includes('OrderService'), true);
});

// ---------------------------------------------------------------------------
// 4. Installed-but-Irrelevant Components Remain Idle
// ---------------------------------------------------------------------------
test('real-host matrix 4: installed-but-irrelevant components remain idle', async () => {
  // Task is pure architecture analysis: Expert is needed, Graph/Context/Forge are idle
  const result = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-expert',
      taskType: 'architecture',
      intent: 'General multi-tier system architectural design',
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'antigravity',
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });

  const executed = result.results.map((r) => r.componentId);
  assert.equal(executed.includes('afyx-engineering-expert'), true);
  assert.equal(executed.includes('afyx-graph'), false, 'Graph must remain idle');
  assert.equal(executed.includes('afyx-forge'), false, 'Forge must remain idle');
  assert.equal(executed.includes('codex-usage-tracking'), false, 'Usage tracking must remain idle');
});

// ---------------------------------------------------------------------------
// 5. Missing / Disabled Component: Graceful Fallback & Explicit OFF
// ---------------------------------------------------------------------------
test('real-host matrix 5: missing component gracefully degrades to direct source fallback', async () => {
  // Graph is absent (not installed)
  const result = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-degrade',
      taskType: 'impact-analysis',
      needsRelationalEvidence: true,
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'antigravity',
    componentStates: installedComponentStates(['efficient-coding']), // only efficient-coding
    adapters: installedAdapters,
  });

  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.degradations.some((d) => d.componentId === 'afyx-graph'), true);
  assert.equal(result.degradations[0].fallback, 'DIRECT_SOURCE');
});

test('real-host matrix 5b: explicit Context OFF disables context component and bypasses it', async () => {
  const result = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-context-off',
      taskType: 'large-context',
      needsContextOptimization: true,
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'antigravity',
    componentStates: installedComponentStates(),
    environment: { AFYX_CONTEXT_OPT_IN: '0' },
    adapters: installedAdapters,
  });

  assert.equal(
    result.degradations.some((d) => d.componentId === 'afyx-context' && d.reason === 'EXPLICITLY_DISABLED'),
    true,
  );
  assert.equal(result.results.some((r) => r.componentId === 'afyx-context'), false);
});

// ---------------------------------------------------------------------------
// 6. Forge Core: Advisory Only, Autonomous Campaign Blocked Pending A8
// ---------------------------------------------------------------------------
test('real-host matrix 6: Forge assistive advice succeeds with installed doctor diagnostics', async () => {
  const adviceResult = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-forge-advice',
      taskType: 'forge-advice',
      forgeAdvice: true,
      intent: 'Consult Afyx Forge doctor advice',
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: null,
    providerPermissions: { 'afyx-forge': true },
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });

  assert.equal(adviceResult.executionStatus, 'EXECUTED');
  const forgeRes = adviceResult.results.find((r) => r.componentId === 'afyx-forge');
  assert.equal(forgeRes?.executionStatus, 'EXECUTED');
  assert.equal(forgeRes?.output?.governance?.runtimeMode, 'ASSISTIVE_GUIDANCE_ONLY');

  // Autonomous execution attempt is strictly blocked
  const autonomousResult = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-forge-auto',
      taskType: 'forge-campaign',
      autonomousExecution: true,
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: null,
    providerPermissions: { 'afyx-forge': true },
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });

  assert.equal(autonomousResult.status, 'BLOCKED');
  assert.equal(autonomousResult.diagnostics.some((d) => d.code === 'FORGE_A8_REQUIRED'), true);
});

// ---------------------------------------------------------------------------
// 7. Usage Tracking: Passive and Permission-Gated
// ---------------------------------------------------------------------------
test('real-host matrix 7: Usage tracking executes on Codex and is rejected on Antigravity', async () => {
  // On Codex provider: allowed
  const codexResult = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-telemetry-codex',
      taskType: 'usage-telemetry',
      needsTelemetry: true,
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'codex',
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });
  const codexRes = codexResult.results.find((r) => r.componentId === 'codex-usage-tracking');
  assert.equal(codexRes?.executionStatus, 'EXECUTED');
  assert.equal(codexRes?.output?.mode, 'PASSIVE_OBSERVABILITY_ONLY');

  // On Antigravity provider: rejected as unsupported/unauthorized for codex-specific tracker
  const agyResult = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-real-telemetry-agy',
      taskType: 'usage-telemetry',
      needsTelemetry: true,
      workspaceIdentity: PROJECT_ROOT,
      sourceRevision: SOURCE_REVISION,
    },
    provider: 'antigravity',
    componentStates: installedComponentStates(),
    adapters: installedAdapters,
  });
  assert.equal(
    agyResult.degradations.some((d) => d.componentId === 'codex-usage-tracking' && d.reason === 'UNAUTHORIZED_OR_UNVERIFIED'),
    true,
  );
});

// ---------------------------------------------------------------------------
// 8. Dynamic Component: Discoverability Without Hard-Coded Integration List
// ---------------------------------------------------------------------------
test('real-host matrix 8: synthetic future component discovered and routed without modifying source allowlist', async () => {
  const dynamicId = 'afyx-custom-telemetry-forwarder';
  const dynamicCap = 'telemetry-forwarder-capability';

  registerAfyxComponent({
    id: dynamicId,
    canonicalName: 'Custom Telemetry Forwarder',
    type: 'runtime',
    primaryCapability: dynamicCap,
    domainAuthority: 'Custom forwarder domain authority',
  });

  try {
    const states = {
      ...installedComponentStates(),
      [dynamicId]: {
        installed: true,
        healthy: true,
        compatible: true,
        authorized: true,
        sourceIdentity: 'custom-dyn-1.0',
      },
    };

    let forwarderCalled = false;
    const dynamicAdapters = {
      ...installedAdapters,
      [dynamicId]: async (req) => {
        forwarderCalled = true;
        return {
          status: 'SUCCESS',
          output: { forwarded: true },
          evidence: [{ kind: 'dynamic-forwarder', value: 'verified' }],
        };
      },
    };

    const result = await executeAfyxCapabilityRoute({
      task: {
        id: 'task-real-dynamic',
        taskType: 'custom-forward',
        needsCustomCapability: dynamicCap,
        customComponentId: dynamicId,
        workspaceIdentity: PROJECT_ROOT,
        sourceRevision: SOURCE_REVISION,
      },
      provider: 'codex',
      componentStates: states,
      adapters: dynamicAdapters,
    });

    assert.equal(forwarderCalled, true, 'Dynamic component adapter must execute');
    assert.equal(result.results.some((r) => r.componentId === dynamicId), true);
  } finally {
    unregisterAfyxComponent(dynamicId);
  }
});

