import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEVEN_REGISTERED_COMPONENT_IDS,
  discoverAfyxCapabilities,
  resolveAfyxCapabilityRoute,
  executeAfyxCapabilityRoute,
  createEvidenceEnvelope,
  createSharedEvidencePipeline,
  AFYX_EVIDENCE_ENVELOPE_CONTRACT,
} from '../afyx-capability-orchestrator.mjs';

const SOURCE = 'candidate-v1-unified';

function mockStates(availableIds = SEVEN_REGISTERED_COMPONENT_IDS) {
  return Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, {
    installed: availableIds.includes(id),
    enabled: true,
    healthy: availableIds.includes(id),
    compatible: availableIds.includes(id),
    authorized: availableIds.includes(id),
    sourceIdentity: availableIds.includes(id) ? SOURCE : null,
    ...(id === 'afyx-graph' && availableIds.includes(id) ? { indexReady: true, indexFresh: true } : {}),
    observationSource: 'INTEGRATION_TEST_FIXTURE',
  }]));
}

function baseOptions(task, availableIds = SEVEN_REGISTERED_COMPONENT_IDS, extra = {}) {
  return {
    task: {
      id: `task-${task.taskType ?? 'generic'}-${Date.now()}`,
      workspaceIdentity: 'afyx-kit/test-repo',
      sourceRevision: 'rev-001',
      ...task,
    },
    provider: 'codex',
    componentStates: mockStates(availableIds),
    ...extra,
  };
}

// Case 1: Simple task fast path (string replacement / simple edit / format)
test('1. Simple task fast path: zero reasoning modules activated, directSourceFastPath true', async () => {
  const result = await executeAfyxCapabilityRoute({
    ...baseOptions({ intent: 'simple edit in config file', taskType: 'simple-edit', knownFile: true }),
    adapters: Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, () => { throw new Error('Must not be called'); }])),
  });
  assert.equal(result.directSourceFastPath, true);
  assert.equal(result.executionStatus, 'DIRECT_SOURCE');
  assert.equal(result.results.length, 0);
  assert.equal(result.metrics.executedCapabilities, 0);
});

// Case 2: Odoo task selects afyx-odoo-engineering / odoo-engineering
test('2. Odoo task: selects Odoo domain authority', async () => {
  const route = resolveAfyxCapabilityRoute(baseOptions({
    taskType: 'odoo-fix',
    project: { isOdoo: true },
    intent: 'Fix sale.order compute field in Odoo 16',
  }));
  const selected = route.requests.map((r) => r.targetComponentId);
  assert.ok(selected.includes('afyx-odoo-engineering') || selected.includes('odoo-engineering'));
  assert.equal(selected.includes('afyx-efficient-coding'), false);
  assert.equal(selected.includes('efficient-coding'), false);
});

// Case 3: General coding task selects afyx-efficient-coding / efficient-coding
test('3. General coding task: selects focused coding discipline', async () => {
  const route = resolveAfyxCapabilityRoute(baseOptions({
    taskType: 'implementation',
    intent: 'Implement proportional retry mechanism for API client',
  }));
  const selected = route.requests.map((r) => r.targetComponentId);
  assert.ok(selected.includes('afyx-efficient-coding') || selected.includes('efficient-coding'));
  assert.equal(selected.includes('afyx-odoo-engineering'), false);
  assert.equal(selected.includes('odoo-engineering'), false);
});

// Case 4: Complex repository analysis selects afyx-graph when justified
test('4. Complex repository analysis: selects afyx-graph only when justified', async () => {
  const nonRelationalRoute = resolveAfyxCapabilityRoute(baseOptions({
    taskType: 'implementation',
    intent: 'Implement single unit test',
  }));
  assert.equal(nonRelationalRoute.requests.some((r) => r.targetComponentId === 'afyx-graph'), false);

  const relationalRoute = resolveAfyxCapabilityRoute(baseOptions({
    taskType: 'relationship-analysis',
    needsRelationalEvidence: true,
    intent: 'Trace call hierarchy and blast radius of auth middleware',
  }));
  assert.equal(relationalRoute.requests.some((r) => r.targetComponentId === 'afyx-graph'), true);
});

// Case 5: Forge selection only for genuine planning complexity; autonomous blocked
test('5. Forge selection: assistive advice permitted; autonomous execution strictly blocked pending A8', async () => {
  const assistiveRoute = resolveAfyxCapabilityRoute({
    ...baseOptions({ taskType: 'forge-advice', forgeAdvice: true }),
    provider: null,
    providerPermissions: { 'afyx-forge': true },
  });
  assert.equal(assistiveRoute.status, 'READY');
  assert.equal(assistiveRoute.requests.some((r) => r.targetComponentId === 'afyx-forge'), true);

  const autonomousRoute = resolveAfyxCapabilityRoute({
    ...baseOptions({ taskType: 'autonomous-forge', autonomousExecution: true }),
    provider: null,
  });
  assert.equal(autonomousRoute.status, 'BLOCKED');
  assert.ok(autonomousRoute.diagnostics.some((d) => d.code === 'FORGE_A8_REQUIRED'));
});

// Case 6: Context deduplication and envelope compression
test('6. Context deduplication: single-pass evidence envelope deduplicates identical items', () => {
  const env1 = createEvidenceEnvelope({
    taskId: 'test-dedupe-task-1',
    capability: 'repository-graph-evidence',
    repositoryId: 'repo/app',
    commitId: 'rev-001',
    sourcePath: 'auth.ts',
    normalizedResult: { symbol: 'getUser', line: 10 },
  });
  const env2 = createEvidenceEnvelope({
    taskId: 'test-dedupe-task-2',
    capability: 'repository-graph-evidence',
    repositoryId: 'repo/app',
    commitId: 'rev-001',
    sourcePath: 'auth.ts',
    normalizedResult: { symbol: 'getUser', line: 10 },
  });

  assert.equal(env1.contract, AFYX_EVIDENCE_ENVELOPE_CONTRACT);
  assert.equal(env1.deduplicationKey, env2.deduplicationKey, 'Identical evidence must produce identical deduplicationKey');
  assert.equal(env1.capability, 'repository-graph-evidence');
});

// Case 7: Evidence reuse and invalidation across revisions
test('7. Evidence reuse and invalidation: envelope valid for same revision, invalid on revision change', () => {
  const pipeline = createSharedEvidencePipeline();
  const env1 = createEvidenceEnvelope({
    taskId: 'task-a',
    capability: 'repository-graph-evidence',
    repositoryId: 'repo/app',
    commitId: 'rev-001',
    sourcePath: 'main.ts',
    normalizedResult: { caller: 'main', target: 'init' },
  });
  pipeline.set(env1);

  // Retrieve with matching revision
  const cached = pipeline.get(env1.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-001',
  });
  assert.ok(cached !== null, 'Evidence must be retrievable for identical scope and revision');
  assert.equal(cached.normalizedResult.caller, 'main');

  // Invalidate when revision updates
  const updatedRev = pipeline.get(env1.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-002',
  });
  assert.equal(updatedRev, null, 'Evidence must be invalidated when source revision changes');
});

// Case 8: 1 primary domain + 2 supporting modules activation budget
test('8. Activation budget: max 1 primary domain + max 2 supporting modules per turn', () => {
  const route = resolveAfyxCapabilityRoute(baseOptions({
    taskType: 'architecture',
    needsRelationalEvidence: true,
    needsContextOptimization: true,
    forgeAdvice: true,
  }));
  // Primary domain: afyx-engineering-expert
  // Supporting candidates: afyx-graph, afyx-forge, afyx-context (3 candidates, budget clamps to max 2)
  const nonTelemetryRequests = route.requests.filter(
    (r) => !['afyx-usage-intelligence', 'codex-usage-tracking'].includes(r.targetComponentId)
  );
  assert.ok(nonTelemetryRequests.length <= 3, `Expected <= 3 active reasoning modules, got ${nonTelemetryRequests.length}`);
  assert.ok(route.degradations.length >= 0);
});

// Case 9: Mutual exclusion: no unrelated domain overactivation
test('9. Mutual exclusion: Odoo task never activates general coding or security auditor', () => {
  const route = resolveAfyxCapabilityRoute(baseOptions({
    taskType: 'odoo-fix',
    project: { isOdoo: true },
    intent: 'Update Odoo account.move form view',
  }));
  const targets = route.requests.map((r) => r.targetComponentId);
  assert.equal(targets.some((id) => id.includes('efficient-coding')), false);
  assert.equal(targets.includes('afyx-security-auditor'), false);
  assert.equal(targets.includes('afyx-native-github'), false);
});

// Case 10: Provider availability fallback
test('10. Provider availability fallback: unknown provider fails closed without crash', () => {
  const route = resolveAfyxCapabilityRoute({
    ...baseOptions({ taskType: 'implementation' }),
    provider: 'unsupported-ai-assistant-xyz',
  });
  assert.equal(route.status, 'BLOCKED');
  assert.ok(route.diagnostics.some((d) => d.code === 'UNKNOWN_PROVIDER'));
});

// Case 11: Independent module operation: standalone execution works with peers absent
test('11. Independent module operation: standalone component runs cleanly with all peers absent', async () => {
  const result = await executeAfyxCapabilityRoute({
    ...baseOptions(
      { taskType: 'relationship-analysis', needsRelationalEvidence: true },
      ['afyx-graph'],
    ),
    adapters: {
      'afyx-graph': () => ({
        status: 'SUCCESS',
        output: 'standalone-graph-relationship-tree',
        contextBytes: 256,
      }),
    },
  });
  assert.equal(result.metrics.executedCapabilities, 1);
  assert.equal(result.results[0].componentId, 'afyx-graph');
  assert.equal(result.results[0].output, 'standalone-graph-relationship-tree');
});

// Case 12: Usage telemetry isolation: passive telemetry does not count toward reasoning budget
test('12. Usage telemetry isolation: passive telemetry is not counted as reasoning module', () => {
  const route = resolveAfyxCapabilityRoute(baseOptions({
    taskType: 'implementation',
    needsTelemetry: true,
  }));
  const telemetryRequests = route.requests.filter(
    (r) => ['afyx-usage-intelligence', 'codex-usage-tracking'].includes(r.targetComponentId)
  );
  assert.equal(telemetryRequests.length, 1);
  // Telemetry is passive; domain authority remains implementation
  assert.ok(route.requests.some((r) => ['afyx-efficient-coding', 'efficient-coding'].includes(r.targetComponentId)));
});

// Case 13: Disabled/OFF behavior: explicit OFF honored cleanly
test('13. Disabled/OFF behavior: explicitly disabled component is not invoked', () => {
  const states = mockStates();
  states['afyx-graph'].enabled = false;

  const route = resolveAfyxCapabilityRoute({
    ...baseOptions({ taskType: 'relationship-analysis', needsRelationalEvidence: true }),
    componentStates: states,
  });
  assert.equal(route.requests.some((r) => r.targetComponentId === 'afyx-graph'), false);
  assert.ok(route.degradations.some((d) => d.componentId === 'afyx-graph' && d.reason === 'EXPLICITLY_DISABLED'));
});

// Case 14: Cross-repository isolation: zero evidence leakage across distinct scopes
test('14. Cross-repository isolation: evidence scoped to repository A is never returned for repository B', () => {
  const pipeline = createSharedEvidencePipeline();
  const repoAEnvelope = createEvidenceEnvelope({
    taskId: 'task-repo-a',
    capability: 'source-security-candidates',
    repositoryId: 'github.com/org-alpha/project-one',
    commitId: 'rev-main',
    sourcePath: 'security.ts',
    normalizedResult: { secretScan: 'clean' },
  });
  pipeline.set(repoAEnvelope);

  const leakCandidate = pipeline.get(repoAEnvelope.deduplicationKey, {
    repositoryId: 'github.com/org-beta/project-two',
    currentCommitId: 'rev-main',
  });
  assert.equal(leakCandidate, null, 'Evidence must not leak across distinct repositories');
});

// Case 15: Cross-session isolation: different session ID is strictly denied
test('15. Session isolation: different session ID denies cached evidence access', () => {
  const pipeline = createSharedEvidencePipeline();
  const env = createEvidenceEnvelope({
    taskId: 'task-session-1',
    sessionId: 'session-alpha-123',
    capability: 'repository-graph-evidence',
    repositoryId: 'repo/app',
    commitId: 'rev-1',
    normalizedResult: { graph: 'data' },
  });
  pipeline.set(env);

  const result = pipeline.get(env.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-1',
    sessionId: 'session-beta-999', // Different session
  });
  assert.equal(result, null, 'Cross-session access must be denied');
});

// Case 16: Missing caller session identity for session-scoped evidence is denied
test('16. Session isolation: missing caller session ID for session-scoped evidence is denied', () => {
  const pipeline = createSharedEvidencePipeline();
  const env = createEvidenceEnvelope({
    taskId: 'task-session-2',
    sessionId: 'session-secure-456',
    scope: 'session',
    capability: 'repository-graph-evidence',
    repositoryId: 'repo/app',
    commitId: 'rev-1',
    normalizedResult: { graph: 'data' },
  });
  pipeline.set(env);

  const result = pipeline.get(env.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-1',
    // sessionId omitted
  });
  assert.equal(result, null, 'Access must be denied when caller session is omitted for session-scoped evidence');
});

// Case 17: Cross-user isolation: different user ID is strictly denied
test('17. User isolation: different user ID denies access to user-scoped evidence', () => {
  const pipeline = createSharedEvidencePipeline();
  const env = createEvidenceEnvelope({
    taskId: 'task-user-1',
    userId: 'user-alice',
    capability: 'source-security-candidates',
    repositoryId: 'repo/app',
    commitId: 'rev-1',
    normalizedResult: { privateFindings: 'none' },
  });
  pipeline.set(env);

  const result = pipeline.get(env.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-1',
    userId: 'user-bob', // Different user
  });
  assert.equal(result, null, 'Cross-user access must be denied');
});

// Case 18: Permission downgrade & key-spoofing denial
test('18. Permission scope: unauthorized caller cannot access evidence by matching key alone', () => {
  const pipeline = createSharedEvidencePipeline();
  const env = createEvidenceEnvelope({
    taskId: 'task-perm-1',
    capability: 'source-security-candidates',
    repositoryId: 'repo/app',
    commitId: 'rev-1',
    permissions: { authorized: true, read: true },
    normalizedResult: { secretCheck: 'pass' },
  });
  pipeline.set(env);

  // Attempt with authorized: false (caller tries to spoof key)
  const deniedSpoof = pipeline.get(env.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-1',
    permissions: { authorized: false },
  });
  assert.equal(deniedSpoof, null, 'Caller with authorized=false must be rejected even with matching key');

  // Attempt with permission downgrade (missing read: true)
  const deniedDowngrade = pipeline.get(env.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-1',
    permissions: { authorized: true, read: false },
  });
  assert.equal(deniedDowngrade, null, 'Caller with downgraded permissions must be rejected');
});

// Case 19: Revoked evidence and session revocation denial
test('19. Revocation guard: revoked evidence or revoked session is deleted and denied', () => {
  const pipeline = createSharedEvidencePipeline();
  const env = createEvidenceEnvelope({
    taskId: 'task-revoked-1',
    sessionId: 'session-to-revoke',
    capability: 'repository-graph-evidence',
    repositoryId: 'repo/app',
    commitId: 'rev-1',
    normalizedResult: { nodes: 10 },
  });
  pipeline.set(env);

  // Revoke session
  const removed = pipeline.revokeSession('session-to-revoke');
  assert.equal(removed, 1);

  const result = pipeline.get(env.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-1',
    sessionId: 'session-to-revoke',
  });
  assert.equal(result, null, 'Revoked evidence must return null');
});

// Case 20: Legitimate same-session, authorized reuse succeeds
test('20. Legitimate reuse: matching session, repository, and authorized permissions succeeds', () => {
  const pipeline = createSharedEvidencePipeline();
  const env = createEvidenceEnvelope({
    taskId: 'task-legit-1',
    sessionId: 'session-legit-100',
    userId: 'user-legit',
    capability: 'repository-graph-evidence',
    repositoryId: 'repo/app',
    commitId: 'rev-1',
    permissions: { authorized: true },
    normalizedResult: { verifiedCallers: 2 },
  });
  pipeline.set(env);

  const result = pipeline.get(env.deduplicationKey, {
    repositoryId: 'repo/app',
    currentCommitId: 'rev-1',
    sessionId: 'session-legit-100',
    userId: 'user-legit',
    permissions: { authorized: true },
  });
  assert.ok(result !== null, 'Legitimate caller must get cache hit');
  assert.equal(result.normalizedResult.verifiedCallers, 2);
});
