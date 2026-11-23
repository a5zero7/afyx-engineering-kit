import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverAfyxCapabilities,
  resolveAfyxCapabilityRoute,
  executeAfyxCapabilityRoute,
} from '../afyx-capability-orchestrator.mjs';
import { resolveAfyxToolFamilyRoute } from '../afyx-tool-family-routing.mjs';
import { resolveModularRuntimeActivation } from '../afyx-modular-runtime.mjs';

describe('T02 (AFYX-53): Runtime Provider Selection & Control', () => {
  const baseComponentStates = {
    'efficient-coding': { installed: true, enabled: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'test-src', version: '1.2.2' },
    'odoo-engineering': { installed: true, enabled: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'test-src', version: '1.2.0' },
    'afyx-graph': { installed: true, enabled: true, healthy: true, compatible: true, authorized: true, indexReady: true, indexFresh: true, sourceIdentity: 'test-src', version: '1.0.0' },
    'afyx-context': { installed: true, enabled: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'test-src', version: '0.1.0' },
  };

  test('Scenario 1: Explicit Codex selection routes to Codex provider', () => {
    const route = resolveAfyxCapabilityRoute({
      task: { intent: 'odoo-investigation', files: ['addons/sale/models/sale_order.py'] },
      provider: 'codex',
      componentStates: baseComponentStates,
    });

    assert.equal(route.discovery.provider, 'codex');
    assert.equal(route.discovery.providerKnown, true);
    assert.notEqual(route.status, 'BLOCKED');
  });

  test('Scenario 2: Explicit Antigravity selection routes to Antigravity provider', () => {
    const route = resolveAfyxCapabilityRoute({
      task: { intent: 'odoo-investigation', files: ['addons/sale/models/sale_order.py'] },
      provider: 'antigravity',
      componentStates: baseComponentStates,
    });

    assert.equal(route.discovery.provider, 'antigravity');
    assert.equal(route.discovery.providerKnown, true);
    assert.notEqual(route.status, 'BLOCKED');
  });

  test('Scenario 3: Default selection follows current provider policy when provider is null/omitted', () => {
    const route = resolveAfyxCapabilityRoute({
      task: { intent: 'odoo-investigation', files: ['addons/sale/models/sale_order.py'] },
      componentStates: baseComponentStates,
    });

    assert.equal(route.discovery.provider, null);
    assert.equal(route.discovery.providerKnown, true);
  });

  test('Scenario 4: Explicit selection takes precedence over default setting', () => {
    const route = resolveAfyxCapabilityRoute({
      task: { intent: 'odoo-investigation', files: ['addons/sale/models/sale_order.py'] },
      provider: 'antigravity',
      userPreferences: { defaultProvider: 'codex' },
      componentStates: baseComponentStates,
    });

    assert.equal(route.discovery.provider, 'antigravity');
  });

  test('Scenario 5: Unsupported provider returns a clear error and fails closed', () => {
    const route = resolveAfyxCapabilityRoute({
      task: { intent: 'odoo-investigation', files: ['addons/sale/models/sale_order.py'] },
      provider: 'unsupported-ai-host',
      componentStates: baseComponentStates,
    });

    assert.equal(route.status, 'BLOCKED');
    assert.equal(route.discovery.providerKnown, false);
    const hasUnknown = route.diagnostics.some((d) => d.code === 'UNKNOWN_PROVIDER');
    assert.ok(hasUnknown, 'Diagnostics must include UNKNOWN_PROVIDER');
  });

  test('Scenario 6: Disabled provider is not activated', () => {
    const plan = resolveModularRuntimeActivation({
      task: { intent: 'odoo-investigation', files: ['models/sale_order.py'] },
      provider: 'codex',
      hostAuthorizations: { codex: false },
      installedComponents: baseComponentStates,
    });

    assert.equal(plan.status, 'BLOCKED');
    const blockedDiag = plan.diagnostics.find((d) => d.code === 'HOST_NOT_AUTHORIZED');
    assert.ok(blockedDiag, 'Disabled provider must yield HOST_NOT_AUTHORIZED');
  });

  test('Scenario 7: Unavailable provider is handled safely with graceful degradation', () => {
    const route = resolveAfyxCapabilityRoute({
      task: { intent: 'odoo-investigation', files: ['models/sale_order.py'] },
      provider: 'codex',
      providerPermissions: { 'odoo-engineering': false },
      componentStates: baseComponentStates,
    });

    assert.notEqual(route.status, 'BLOCKED');
    const degraded = route.degradations.find((d) => d.componentId === 'odoo-engineering');
    assert.ok(degraded, 'Unavailable component on provider must degrade cleanly');
    assert.equal(degraded.fallback, 'DIRECT_SOURCE');
  });

  test('Scenario 8: Selected provider receives the correct capability request and identifies dispatch route', async () => {
    let capturedRequest = null;
    const mockAdapters = {
      'odoo-engineering': async (req) => {
        capturedRequest = req;
        return { status: 'SUCCESS', output: { advice: 'Odoo model OK' } };
      },
      'efficient-coding': async (req) => {
        return { status: 'SUCCESS', output: { code: 'Clean code' } };
      },
    };

    const result = await executeAfyxCapabilityRoute({
      task: { id: 'task-test-42', intent: 'odoo-investigation', files: ['models/sale.py'] },
      provider: 'antigravity',
      componentStates: baseComponentStates,
      adapters: mockAdapters,
    });

    assert.equal(result.executionStatus, 'EXECUTED');
    assert.ok(capturedRequest, 'Selected provider adapter must be called');
    assert.equal(capturedRequest.taskId, 'task-test-42');
    assert.equal(capturedRequest.targetComponentId, 'odoo-engineering');
    const odooResult = result.results.find((r) => r.componentId === 'odoo-engineering');
    assert.ok(odooResult, 'Route must execute odoo-engineering');
    assert.equal(odooResult.status, 'EXECUTED');
  });
});

describe('T03 (AFYX-302): AFYX-First Runtime Routing & Policy Enforcement', () => {
  test('Rule 1: AFYX capability installed, enabled, healthy, reachable and compatible -> Use AFYX', () => {
    const decision = resolveAfyxToolFamilyRoute({
      intent: 'capability',
      capability: 'code-graph',
      candidates: [
        {
          id: 'afyx-graph',
          surface: 'mcp',
          ownership: 'AFYX',
          capabilities: ['code-graph'],
          installed: true,
          enabled: true,
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: true,
        },
        {
          id: 'external-tool',
          surface: 'mcp',
          ownership: 'EXTERNAL',
          capabilities: ['code-graph'],
          installed: true,
          enabled: true,
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: true,
        },
      ],
      allowExternalFallback: true,
    });

    assert.equal(decision.route, 'AFYX');
    assert.equal(decision.reason, 'NATIVE_READY');
    assert.equal(decision.toolId, 'afyx-graph');
  });

  test('Rule 2: AFYX absent -> Use explicitly authorized external provider or direct-source fallback', () => {
    // When external fallback is explicitly authorized
    const decisionAllowed = resolveAfyxToolFamilyRoute({
      intent: 'capability',
      capability: 'code-graph',
      candidates: [
        {
          id: 'external-tool',
          surface: 'mcp',
          ownership: 'EXTERNAL',
          capabilities: ['code-graph'],
          installed: true,
          enabled: true,
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: true,
        },
      ],
      allowExternalFallback: true,
    });

    assert.equal(decisionAllowed.route, 'EXTERNAL');
    assert.equal(decisionAllowed.reason, 'EXTERNAL_EXPLICITLY_ALLOWED');
    assert.equal(decisionAllowed.toolId, 'external-tool');

    // When external fallback is NOT authorized -> direct source
    const decisionNotAllowed = resolveAfyxToolFamilyRoute({
      intent: 'capability',
      capability: 'code-graph',
      candidates: [
        {
          id: 'external-tool',
          surface: 'mcp',
          ownership: 'EXTERNAL',
          capabilities: ['code-graph'],
          installed: true,
          enabled: true,
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: true,
        },
      ],
      allowExternalFallback: false,
    });

    assert.equal(decisionNotAllowed.route, 'DIRECT_SOURCE');
    assert.equal(decisionNotAllowed.reason, 'NO_AUTHORIZED_COMPATIBLE_TOOL');
  });

  test('Rule 3: AFYX disabled by owner -> Respect disabled state and do not activate', () => {
    const decision = resolveAfyxToolFamilyRoute({
      intent: 'capability',
      capability: 'code-graph',
      candidates: [
        {
          id: 'afyx-graph',
          surface: 'mcp',
          ownership: 'AFYX',
          capabilities: ['code-graph'],
          installed: true,
          enabled: false, // Disabled by user/owner
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: true,
        },
      ],
      allowExternalFallback: false,
    });

    assert.equal(decision.route, 'DIRECT_SOURCE');
    assert.equal(decision.reason, 'NO_AUTHORIZED_COMPATIBLE_TOOL');
  });

  test('Rule 4: AFYX unhealthy or stale -> Prefer authoritative direct-source inspection', () => {
    const decisionStale = resolveAfyxToolFamilyRoute({
      intent: 'capability',
      capability: 'code-graph',
      candidates: [
        {
          id: 'afyx-graph',
          surface: 'mcp',
          ownership: 'AFYX',
          capabilities: ['code-graph'],
          installed: true,
          enabled: true,
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: false, // Stale index!
        },
      ],
      allowExternalFallback: false,
    });

    assert.equal(decisionStale.route, 'DIRECT_SOURCE');
    assert.equal(decisionStale.reason, 'NO_AUTHORIZED_COMPATIBLE_TOOL');
  });

  test('Rule 5: External provider explicitly disabled -> Never invoke its MCP, CLI or wrapper', () => {
    const decision = resolveAfyxToolFamilyRoute({
      intent: 'capability',
      capability: 'code-graph',
      candidates: [
        {
          id: 'external-tool',
          surface: 'mcp',
          ownership: 'EXTERNAL',
          capabilities: ['code-graph'],
          installed: true,
          enabled: false, // Disabled MCP
          reachable: true,
          healthy: true,
          authorized: false, // Not authorized
          compatible: true,
          fresh: true,
        },
      ],
      allowExternalFallback: true,
    });

    assert.equal(decision.route, 'DIRECT_SOURCE');
    assert.equal(decision.reason, 'NO_AUTHORIZED_COMPATIBLE_TOOL');
  });

  test('Rule 6: Exact known file or symbol lookup -> Efficient direct-source read with zero tool overhead', () => {
    const decision = resolveAfyxToolFamilyRoute({
      intent: 'exact-source',
      capability: 'code-graph',
      candidates: [
        {
          id: 'afyx-graph',
          surface: 'mcp',
          ownership: 'AFYX',
          capabilities: ['code-graph'],
          installed: true,
          enabled: true,
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: true,
        },
      ],
      allowExternalFallback: false,
    });

    assert.equal(decision.route, 'DIRECT_SOURCE');
    assert.equal(decision.reason, 'EXACT_SOURCE');
    assert.equal(decision.toolId, null);
  });

  test('Rule 7: No compatible permitted provider -> Return clear unavailable result', () => {
    const decision = resolveAfyxToolFamilyRoute({
      intent: 'capability',
      capability: 'unsupported-capability',
      candidates: [
        {
          id: 'afyx-graph',
          surface: 'mcp',
          ownership: 'AFYX',
          capabilities: ['code-graph'],
          installed: true,
          enabled: true,
          reachable: true,
          healthy: true,
          authorized: true,
          compatible: true,
          fresh: true,
        },
      ],
      allowExternalFallback: false,
    });

    assert.equal(decision.route, 'DIRECT_SOURCE');
    assert.equal(decision.reason, 'NO_AUTHORIZED_COMPATIBLE_TOOL');
  });
});

describe('AFYX-302 Odoo agent MCP-session routing mock', () => {
  const request = Object.freeze({ source: 'odoo-agent', transport: 'mcp', workspace: 'fixtures/odoo17',
    file: 'addons/sale/models/sale_order.py', intent: 'capability', capability: 'code-graph' });
  const target = (id, ownership, surface = 'mcp', state = {}) => ({
    id, ownership, surface, capabilities: ['code-graph'],
    installed: true, enabled: true, reachable: true, healthy: true,
    authorized: true, compatible: true, fresh: true, ...state,
  });
  function run(candidates, allowExternalFallback = false, intent = request.intent, capability = request.capability) {
    assert.equal(request.source, 'odoo-agent');
    assert.equal(request.transport, 'mcp');
    assert.match(request.file, /addons\/sale\/models\/sale_order\.py$/);
    return resolveAfyxToolFamilyRoute({ intent, capability, candidates, allowExternalFallback });
  }
  test('native AFYX Graph wins over a permitted external MCP', () => {
    const result = run([target('external-graph', 'EXTERNAL'), target('afyx-graph', 'AFYX')], true);
    assert.equal(result.route, 'AFYX');
    assert.equal(result.toolId, 'afyx-graph');
    assert.equal(result.surface, 'mcp');
  });
  test('unhealthy native uses external only with explicit authorization', () => {
    const candidates = [target('afyx-graph', 'AFYX', 'mcp', { healthy: false }), target('external-graph', 'EXTERNAL')];
    assert.equal(run(candidates, true).route, 'EXTERNAL');
    assert.equal(run(candidates, false).route, 'DIRECT_SOURCE');
  });
  test('disabled external MCP cannot silently fall back through disabled CLI', () => {
    const candidates = [target('external-graph', 'EXTERNAL', 'mcp', { enabled: false }),
      target('external-graph', 'EXTERNAL', 'cli', { authorized: false })];
    assert.equal(run(candidates, true).route, 'DIRECT_SOURCE');
  });
  test('exact-source Odoo request avoids Graph overhead', () => {
    assert.equal(run([target('afyx-graph', 'AFYX')], false, 'exact-source').reason, 'EXACT_SOURCE');
  });
  test('non-Graph Odoo capability prefers eligible AFYX Context', () => {
    assert.equal(run([target('afyx-context', 'AFYX', 'mcp', { capabilities: ['context'] })], false, 'capability', 'context').toolId, 'afyx-context');
  });
  test('Odoo MCP mock dispatches only the selected authorized tool', () => {
    const calls = [];
    const dispatch = (decision, payload) => {
      if (!['AFYX', 'EXTERNAL'].includes(decision.route)) return null;
      const call = { toolId: decision.toolId, surface: decision.surface, payload };
      calls.push(call);
      return call;
    };
    const native = run([target('external-graph', 'EXTERNAL'), target('afyx-graph', 'AFYX')], true);
    assert.deepEqual(dispatch(native, request), { toolId: 'afyx-graph', surface: 'mcp', payload: request });
    const fallback = run([target('afyx-graph', 'AFYX', 'mcp', { healthy: false }), target('external-graph', 'EXTERNAL')], true);
    assert.equal(dispatch(fallback, request).toolId, 'external-graph');
    const contextRequest = { ...request, capability: 'context' };
    const context = run([target('afyx-context', 'AFYX', 'mcp', { capabilities: ['context'] })], false, 'capability', 'context');
    assert.deepEqual(dispatch(context, contextRequest), { toolId: 'afyx-context', surface: 'mcp', payload: contextRequest });
    const denied = run([target('external-graph', 'EXTERNAL', 'mcp', { enabled: false })], true);
    assert.equal(dispatch(denied, request), null);
    const exactSource = run([target('afyx-graph', 'AFYX')], false, 'exact-source');
    assert.equal(dispatch(exactSource, request), null);
    assert.deepEqual(calls.map(({ toolId }) => toolId), ['afyx-graph', 'external-graph', 'afyx-context']);
  });
});
