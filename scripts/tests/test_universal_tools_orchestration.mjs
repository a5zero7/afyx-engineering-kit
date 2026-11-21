import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  UNIVERSAL_CAPABILITIES,
  UNIVERSAL_CAPABILITY_HOSTS,
  executeAfyxCapabilityRoute,
  resolveAfyxCapabilityRoute,
} from '../afyx-capability-orchestrator.mjs';

const SOURCE_REVISION = 'c03-test-rev-1';

function makeStates(availableIds = ['afyx-efficient-coding', 'afyx-context', 'afyx-forge', 'afyx-graph']) {
  const allKnown = [
    'afyx-efficient-coding',
    'afyx-odoo-engineering',
    'afyx-engineering-expert',
    'afyx-graph',
    'afyx-context',
    'afyx-forge',
    'afyx-usage-intelligence',
  ];
  return Object.fromEntries(allKnown.map((id) => [id, {
    installed: availableIds.includes(id),
    enabled: true,
    healthy: availableIds.includes(id),
    compatible: availableIds.includes(id),
    authorized: availableIds.includes(id),
    sourceIdentity: availableIds.includes(id) ? SOURCE_REVISION : null,
    ...(id === 'afyx-graph' && availableIds.includes(id) ? { indexReady: true, indexFresh: true } : {}),
    observationSource: 'UNIVERSAL_ORCHESTRATION_TEST',
  }]));
}

// ---------------------------------------------------------------------------
// 1. Universal Capability Registry & Host Mapping Truth
// ---------------------------------------------------------------------------
test('universal capabilities are registered and mapped to authoritative host components', () => {
  assert.equal(UNIVERSAL_CAPABILITIES.length, 8);
  for (const cap of UNIVERSAL_CAPABILITIES) {
    const host = UNIVERSAL_CAPABILITY_HOSTS[cap];
    assert.ok(host === 'afyx-context' || host === 'afyx-forge', `Invalid host for ${cap}: ${host}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Budget Ceiling: Max 1 Primary Domain + Max 2 Supporting Modules
// ---------------------------------------------------------------------------
test('enforces max 1 primary domain and max 2 supporting modules rule', () => {
  const route = resolveAfyxCapabilityRoute({
    task: {
      id: 'task-budget-enforcement',
      taskType: 'architecture', // Primary: afyx-engineering-expert
      needsContextOptimization: true, // Supporting 1: afyx-context
      needsTelemetry: true, // Supporting 2 / Infrastructure: afyx-usage-intelligence
    },
    provider: 'codex',
    componentStates: makeStates(['afyx-engineering-expert', 'afyx-context', 'afyx-usage-intelligence']),
  });

  const selectedComponents = route.requests.map((r) => r.targetComponentId);
  assert.ok(selectedComponents.length <= 3, `Expected <= 3 components, got ${selectedComponents.length}`);
  assert.ok(selectedComponents.includes('afyx-engineering-expert'), 'Primary architecture domain must be selected');
  assert.ok(selectedComponents.includes('afyx-context'), 'Context supporting module selected');
  assert.ok(selectedComponents.includes('afyx-usage-intelligence'), 'Telemetry module selected');
});

// ---------------------------------------------------------------------------
// 3. Real Execution & Lazy Activation: SQLite Db-Inspector
// ---------------------------------------------------------------------------
test('orchestrates real SQLite db inspection with lazy module activation and hash invariance', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-orch-sqlite-'));
  const dbFile = path.join(tempDir, 'sample.db');

  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, salary REAL, ssn TEXT);
    INSERT INTO employees VALUES (1, 'Eve', 85000.0, '123-45-6789');
    CREATE TABLE departments (id INTEGER PRIMARY KEY, dept_name TEXT);
    INSERT INTO departments VALUES (10, 'Engineering');
  `);
  db.close();

  try {
    const result = await executeAfyxCapabilityRoute({
      task: {
        id: 'task-sqlite-inspect',
        taskType: 'db-inspection',
        capability: 'afyx-db-inspector',
        workspaceIdentity: tempDir,
        payload: { path: 'sample.db', options: { sampleLimit: 2 } },
      },
      provider: 'codex',
      componentStates: makeStates(['afyx-context']),
    });

    assert.equal(result.executionStatus, 'EXECUTED');
    assert.equal(result.results.length, 1);
    const exec = result.results[0];
    assert.equal(exec.capability, 'afyx-db-inspector');
    assert.equal(exec.status, 'EXECUTED');
    assert.equal(exec.output.status, 'INSPECTED');
    assert.equal(exec.output.format, 'sqlite');
    assert.equal(exec.output.hashVerifiedUnchanged, true);
    assert.ok(exec.output.tables.some((t) => t.name === 'employees'));
    assert.ok(exec.output.tables.some((t) => t.name === 'departments'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Real Execution: CLI Output Compactor
// ---------------------------------------------------------------------------
test('orchestrates real CLI compaction with error preservation and recoverable spill', async () => {
  const rawLogs = [
    'Building test suite...',
    'AssertionError: Expected 200 OK but received 500 Internal Server Error at api/route.js:45',
    'FAIL: test/payment.test.js',
    ...Array.from({ length: 60 }, (_, i) => `[DEBUG] Processing payload index ${i}... OK`),
    'Process exited with code 1',
  ].join('\n');

  const result = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-cli-compact',
      taskType: 'cli-compaction',
      capability: 'afyx-cli-compactor',
      payload: { raw: rawLogs, command: 'npm test', exitCode: 1 },
    },
    provider: 'codex',
    componentStates: makeStates(['afyx-context']),
  });

  assert.equal(result.executionStatus, 'EXECUTED');
  assert.equal(result.results.length, 1);
  const exec = result.results[0];
  assert.equal(exec.capability, 'afyx-cli-compactor');
  assert.equal(exec.status, 'EXECUTED');
  assert.ok(exec.output.compactedOutput);
  assert.ok(exec.output.compactedOutput.includes('AssertionError: Expected 200 OK'));
  assert.ok(exec.output.compactedOutput.includes('FAIL: test/payment.test.js'));
  assert.ok(exec.output.spillFilePath);
  assert.ok(fs.existsSync(exec.output.spillFilePath));

  // Clean up spill
  fs.rmSync(path.dirname(exec.output.spillFilePath), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 5. Real Execution: Massive Context Navigator
// ---------------------------------------------------------------------------
test('orchestrates massive context streaming index and slice retrieval', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-orch-massive-'));
  const testDoc = path.join(tempDir, 'architecture-spec.md');
  fs.writeFileSync(
    testDoc,
    Array.from({ length: 100 }, (_, i) => `### Section ${i + 1}\nAdaptive routing policy details and architecture token constraints for step ${i + 1}.\n`).join('\n'),
    'utf8'
  );

  try {
    const result = await executeAfyxCapabilityRoute({
      task: {
        id: 'task-massive-nav',
        taskType: 'massive-context',
        capability: 'afyx-massive-context',
        workspaceIdentity: tempDir,
        payload: { query: 'Adaptive routing policy', options: { maxTokens: 150 } },
      },
      provider: 'codex',
      componentStates: makeStates(['afyx-context']),
    });

    assert.equal(result.executionStatus, 'EXECUTED');
    const exec = result.results[0];
    assert.equal(exec.capability, 'afyx-massive-context');
    assert.equal(exec.status, 'EXECUTED');
    assert.equal(exec.output.status, 'RETRIEVED');
    assert.ok(exec.output.segments.length > 0);
    assert.ok(exec.output.segments[0].content.includes('Adaptive routing policy'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. Real Execution: Polyglot API Contract Validation (Forge)
// ---------------------------------------------------------------------------
test('orchestrates API contract validator via Forge with OpenAPI schema verification', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-orch-contract-'));
  const openapiFile = path.join(tempDir, 'openapi.json');
  fs.writeFileSync(
    openapiFile,
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'User Service API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            summary: 'Get all users',
            responses: { '200': { description: 'A list of users' } },
          },
        },
      },
    }),
    'utf8'
  );

  try {
    const result = await executeAfyxCapabilityRoute({
      task: {
        id: 'task-validate-contract',
        taskType: 'contract-validation',
        capability: 'afyx-api-contract-validator',
        workspaceIdentity: tempDir,
        payload: { path: 'openapi.json' },
      },
      provider: null, // Host direct
      providerPermissions: { 'afyx-forge': true },
      componentStates: makeStates(['afyx-forge']),
    });

    assert.equal(result.executionStatus, 'EXECUTED');
    const exec = result.results[0];
    assert.equal(exec.capability, 'afyx-api-contract-validator');
    assert.equal(exec.status, 'EXECUTED');
    assert.equal(exec.output.status, 'PASS');
    assert.equal(exec.output.contractType, 'openapi');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. Work Ledger: Task Recording & Receipt
// ---------------------------------------------------------------------------
test('orchestrates task ledger entry recording and receipt generation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-orch-ledger-'));

  try {
    const result = await executeAfyxCapabilityRoute({
      task: {
        id: 'task-ledger-step',
        taskType: 'work-ledger',
        capability: 'afyx-work-ledger',
        workspaceIdentity: tempDir,
        payload: {
          ledgerId: 'LEDGER-101',
          taskObjective: 'Stabilize Universal Runtime',
          scope: 'afyx-context;afyx-forge',
          verificationState: 'VERIFIED',
          evidence: [{ type: 'test', pass: true }],
        },
      },
      provider: 'codex',
      componentStates: makeStates(['afyx-context']),
    });

    assert.equal(result.executionStatus, 'EXECUTED');
    const exec = result.results[0];
    assert.equal(exec.capability, 'afyx-work-ledger');
    assert.equal(exec.status, 'EXECUTED');
    assert.equal(exec.output.ledgerId, 'LEDGER-101');
    assert.equal(exec.output.taskObjective, 'Stabilize Universal Runtime');
    assert.equal(exec.output.verificationState, 'VERIFIED');
    assert.ok(exec.output.receipt);
    assert.ok(exec.output.receipt.receiptHash);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. Unauthorized & Fallback Flows
// ---------------------------------------------------------------------------
test('degrades gracefully to DIRECT_SOURCE or BLOCKED when host or capability is unauthorized', async () => {
  // 1. Explicit OFF for context engine
  const resultOff = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-unauth',
      taskType: 'db-inspection',
      capability: 'afyx-db-inspector',
    },
    provider: 'codex',
    componentStates: {
      'afyx-context': {
        installed: true,
        enabled: false, // OFF
        healthy: true,
        compatible: true,
        authorized: true,
        sourceIdentity: SOURCE_REVISION,
      },
    },
  });

  assert.equal(resultOff.status, 'DEGRADED');
  assert.equal(resultOff.executionStatus, 'NOT_RUN');
  assert.equal(resultOff.degradations.length, 1);
  assert.equal(resultOff.degradations[0].reason, 'EXPLICITLY_DISABLED');
  assert.equal(resultOff.degradations[0].fallback, 'DIRECT_SOURCE');

  // 2. Unauthorized provider permission for forge
  const resultForgeUnauth = await executeAfyxCapabilityRoute({
    task: {
      id: 'task-forge-unauth',
      taskType: 'contract-validation',
      capability: 'afyx-api-contract-validator',
    },
    provider: 'codex',
    providerPermissions: { 'afyx-forge': false }, // Denied
    componentStates: makeStates(['afyx-forge']),
  });

  assert.equal(resultForgeUnauth.status, 'DEGRADED');
  assert.equal(resultForgeUnauth.degradations[0].reason, 'UNAUTHORIZED_OR_UNVERIFIED');
});
