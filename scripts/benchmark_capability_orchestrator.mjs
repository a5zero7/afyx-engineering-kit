import { performance } from 'node:perf_hooks';

import {
  SEVEN_REGISTERED_COMPONENT_IDS,
  resolveAfyxCapabilityRoute,
} from './afyx-capability-orchestrator.mjs';

const iterations = 10_000;
const componentStates = Object.fromEntries(SEVEN_REGISTERED_COMPONENT_IDS.map((id) => [id, {
  installed: true,
  enabled: true,
  healthy: true,
  compatible: true,
  authorized: true,
  sourceIdentity: 'benchmark-fixture',
  ...(id === 'afyx-graph' ? { indexReady: true, indexFresh: true } : {}),
}]));
const input = {
  task: {
    id: 'benchmark-route',
    taskType: 'odoo-impact-analysis',
    project: { isOdoo: true },
    needsRelationalEvidence: true,
    needsContextOptimization: true,
    workspaceIdentity: 'benchmark/fixture',
    sourceRevision: 'benchmark',
  },
  provider: 'codex',
  componentStates,
};

// Warm the module and JIT before measuring.
for (let index = 0; index < 1_000; index += 1) resolveAfyxCapabilityRoute(input);
const heapBefore = process.memoryUsage().heapUsed;
const cpuBefore = process.cpuUsage();
const startedAt = performance.now();
let selectedCapabilities = 0;
for (let index = 0; index < iterations; index += 1) {
  selectedCapabilities += resolveAfyxCapabilityRoute(input).requests.length;
}
const elapsedMs = performance.now() - startedAt;
const cpu = process.cpuUsage(cpuBefore);
const heapAfter = process.memoryUsage().heapUsed;
let directSourceRuntimeSelections = 0;
for (let index = 0; index < iterations; index += 1) {
  directSourceRuntimeSelections += resolveAfyxCapabilityRoute({
    ...input,
    task: { ...input.task, taskType: 'string-replacement', exactKnownSource: true },
  }).requests.length;
}

console.log(JSON.stringify({
  contract: 'AfyxCapabilityRouterBenchmark/v1',
  iterations,
  elapsedMs,
  averageRouteMs: elapsedMs / iterations,
  heapDeltaBytes: heapAfter - heapBefore,
  cpuUserMicroseconds: cpu.user,
  cpuSystemMicroseconds: cpu.system,
  selectedCapabilities,
  averageSelectedCapabilities: selectedCapabilities / iterations,
  directSourceRuntimeSelections,
  note: 'CPU elapsed and process heap delta are local deterministic observations, not provider cost.',
}, null, 2));
