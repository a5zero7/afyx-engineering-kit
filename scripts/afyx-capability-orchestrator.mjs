/**
 * Native selective capability orchestration for all Afyx-owned components.
 *
 * The orchestrator is deliberately host-neutral. Hosts provide observed component
 * state and small in-process adapters; this module discovers, selects, and invokes
 * only the capabilities justified by the task. No component is mandatory.
 *
 * Conforms to AfyxUniversalInterop/v1:
 * - Standalone by design: every component functions with all optional peers absent
 * - Universal bidirectional interoperability: any installed, healthy, compatible,
 *   and authorized component can participate in task-aware capability exchange
 * - Default-enabled discovery: installed components are available for interoperability
 *   by default without requiring manual pair configuration, while honoring explicit OFF
 * - Dynamic extensibility: synthetic and future components are discovered and routed
 *   without source-level hard-coded allowlist changes
 * - Single domain authority: exactly one authoritative owner per domain
 * - Strict gating: Forge Core remains assistive; autonomous execution is blocked until A8
 * - Budget enforcement: bounded execution time, hops, tool calls, and context bytes
 */

import { performance } from 'node:perf_hooks';

import {
  PRODUCT_INVENTORY,
} from './afyx-modular-integration.mjs';
import {
  ACCEPTED_PROVIDERS,
  DOMAIN_AUTHORITY_MATRIX,
  PROVIDER_CAPABILITY_SUPPORT,
  resolveModularRuntimeActivation,
} from './afyx-modular-runtime.mjs';

export const AFYX_UNIVERSAL_INTEROP_CONTRACT = 'AfyxUniversalInterop/v1';
export const AFYX_CAPABILITY_REQUEST_CONTRACT = 'AfyxCapabilityRequest/v1';
export const AFYX_CAPABILITY_RESULT_CONTRACT = 'AfyxCapabilityResult/v1';

/** The six primary engineering components. */
export const PRIMARY_COMPONENT_IDS = Object.freeze([
  'efficient-coding',
  'odoo-engineering',
  'afyx-engineering-expert',
  'afyx-graph',
  'afyx-context',
  'afyx-forge',
]);

/** The canonical seven registered components in the Engineering Kit. */
export const SEVEN_REGISTERED_COMPONENT_IDS = Object.freeze([
  'efficient-coding',
  'odoo-engineering',
  'afyx-engineering-expert',
  'afyx-graph',
  'afyx-context',
  'afyx-forge',
  'codex-usage-tracking',
]);

export const DEFAULT_BUDGET_LIMITS = Object.freeze({
  maxToolCalls: 4,
  maxContextBytes: 65_536,
  maxExecutionMs: 5_000,
  maxCapabilities: 4,
  maxHops: 2,
});

const AUTONOMOUS_FORGE_INTENTS = new Set([
  'autonomous-forge',
  'forge-campaign',
  'formal-forge-evaluation',
  'production-forge-execution',
]);

/** In-memory dynamic component registry for universal extensibility. */
const DYNAMIC_COMPONENT_REGISTRY = new Map(Object.entries(PRODUCT_INVENTORY));

/** Register a dynamic or synthetic future Afyx-owned component. */
export function registerAfyxComponent(componentDef) {
  if (!componentDef || typeof componentDef.id !== 'string') {
    throw new Error('Component definition must include a valid id string');
  }
  const definition = Object.freeze({
    id: componentDef.id,
    canonicalName: componentDef.canonicalName ?? componentDef.id,
    type: componentDef.type ?? 'runtime',
    primaryCapability: componentDef.primaryCapability ?? `${componentDef.id}-capability`,
    domainAuthority: componentDef.domainAuthority ?? `${componentDef.id} authoritative domain`,
    ownershipClass: componentDef.ownershipClass ?? 'AFYX',
    maturity: componentDef.maturity ?? 'SOURCE_READY',
    productionReady: false,
    activationMode: componentDef.activationMode ?? 'ON_DEMAND',
    cooperatingComponents: Object.freeze(componentDef.cooperatingComponents ?? []),
  });
  DYNAMIC_COMPONENT_REGISTRY.set(componentDef.id, definition);
  return definition;
}

/** Unregister a dynamically added component (primary 7 cannot be removed). */
export function unregisterAfyxComponent(componentId) {
  if (!SEVEN_REGISTERED_COMPONENT_IDS.includes(componentId)) {
    DYNAMIC_COMPONENT_REGISTRY.delete(componentId);
  }
}

/** Retrieve definition of any registered component. */
export function getRegisteredComponent(componentId) {
  return DYNAMIC_COMPONENT_REGISTRY.get(componentId);
}

/** Retrieve all registered component identifiers. */
export function getRegisteredComponentIds() {
  return [...DYNAMIC_COMPONENT_REGISTRY.keys()];
}

function boundedInteger(value, fallback, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function normalizeBudgets(requested = {}) {
  return Object.freeze({
    maxToolCalls: boundedInteger(requested.maxToolCalls, DEFAULT_BUDGET_LIMITS.maxToolCalls),
    maxContextBytes: boundedInteger(requested.maxContextBytes, DEFAULT_BUDGET_LIMITS.maxContextBytes),
    maxExecutionMs: boundedInteger(requested.maxExecutionMs, DEFAULT_BUDGET_LIMITS.maxExecutionMs, 1),
    maxCapabilities: boundedInteger(requested.maxCapabilities, DEFAULT_BUDGET_LIMITS.maxCapabilities),
    maxHops: boundedInteger(requested.maxHops, DEFAULT_BUDGET_LIMITS.maxHops),
  });
}

function providerAllows(componentId, capability, provider, providerPermissions) {
  if (providerPermissions?.[componentId] === false || providerPermissions?.[capability] === false) {
    return false;
  }
  if (provider === null) return true;
  const providerMeta = PROVIDER_CAPABILITY_SUPPORT[provider];
  if (!providerMeta) return false;
  if (componentId === 'afyx-forge') {
    return providerPermissions?.[componentId] === true;
  }
  if (providerMeta.supportedCapabilities.includes(capability)) {
    return true;
  }
  // Dynamic synthetic component allowed on known provider if not explicitly forbidden
  if (!SEVEN_REGISTERED_COMPONENT_IDS.includes(componentId) && providerPermissions?.[componentId] !== false) {
    return true;
  }
  return false;
}

/**
 * Normalize caller-observed component state into a deterministic availability set.
 *
 * Implements default-enabled interoperability: installed components are enabled
 * by default for interop discovery unless explicitly disabled by user/environment.
 * Health, compatibility, positive source identity, and authorization remain mandatory.
 */
export function discoverAfyxCapabilities({
  componentStates = {},
  provider = null,
  providerPermissions = {},
  environment = process.env,
  customComponents = [],
} = {}) {
  const normalizedProvider = typeof provider === 'string' ? provider.toLowerCase() : null;
  const providerKnown = normalizedProvider === null || ACCEPTED_PROVIDERS.includes(normalizedProvider);
  const contextEnvironmentOff = String(environment?.AFYX_CONTEXT_OPT_IN ?? '').trim() === '0';
  const capabilities = {};

  if (Array.isArray(customComponents)) {
    for (const comp of customComponents) {
      if (comp?.id) registerAfyxComponent(comp);
    }
  }

  // Universal discovery over all registered and caller-declared components
  const allComponentIds = new Set([
    ...DYNAMIC_COMPONENT_REGISTRY.keys(),
    ...Object.keys(componentStates),
  ]);

  for (const componentId of allComponentIds) {
    const observed = componentStates[componentId] ?? {};
    const metadata = DYNAMIC_COMPONENT_REGISTRY.get(componentId) ?? {
      id: componentId,
      canonicalName: observed.canonicalName ?? componentId,
      type: observed.type ?? 'runtime',
      primaryCapability: observed.capability ?? `${componentId}-capability`,
      domainAuthority: observed.domainAuthority ?? `${componentId} authoritative domain`,
      ownershipClass: observed.ownershipClass ?? 'AFYX',
    };
    const capability = metadata.primaryCapability;
    const explicitOff = observed.enabled === false ||
      (componentId === 'afyx-context' && contextEnvironmentOff);
    const providerAuthorized = providerKnown && providerAllows(
      componentId,
      capability,
      normalizedProvider,
      providerPermissions,
    );
    const installed = observed.installed === true;
    // Default-enabled for interoperability if installed, unless explicitly set to false or context env off
    const enabled = installed && observed.enabled !== false && !contextEnvironmentOff;
    const healthy = observed.healthy === true;
    const compatible = observed.compatible === true;
    const authorized = observed.authorized === true && providerAuthorized;
    const sourceIdentity = typeof observed.sourceIdentity === 'string' && observed.sourceIdentity.length > 0
      ? observed.sourceIdentity
      : null;
    const graphIndexUsable = componentId !== 'afyx-graph' ||
      (observed.indexReady === true && observed.indexFresh === true);
    const available = installed && enabled && healthy && compatible && authorized &&
      sourceIdentity !== null && graphIndexUsable;

    let reason = 'AVAILABLE';
    if (!providerKnown) reason = 'UNKNOWN_PROVIDER';
    else if (!installed) reason = 'NOT_INSTALLED';
    else if (explicitOff) reason = 'EXPLICITLY_DISABLED';
    else if (!enabled) reason = 'ENABLED_STATE_UNVERIFIED';
    else if (!healthy) reason = 'UNHEALTHY_OR_UNVERIFIED';
    else if (!compatible) reason = 'INCOMPATIBLE_OR_UNVERIFIED';
    else if (!authorized) reason = 'UNAUTHORIZED_OR_UNVERIFIED';
    else if (sourceIdentity === null) reason = 'SOURCE_IDENTITY_UNVERIFIED';
    else if (!graphIndexUsable) reason = 'GRAPH_INDEX_NOT_READY_OR_FRESH';

    capabilities[componentId] = Object.freeze({
      componentId,
      capability,
      installed,
      enabled,
      healthy,
      compatible,
      authorized,
      available,
      reason,
      sourceIdentity,
      observationSource: observed.observationSource ?? 'CALLER_DECLARED',
    });
  }

  return Object.freeze({
    contract: AFYX_UNIVERSAL_INTEROP_CONTRACT,
    provider: normalizedProvider,
    providerKnown,
    capabilities: Object.freeze(capabilities),
  });
}

/** Cheap deterministic task classification. */
export function classifyTaskIntent(task = {}) {
  const intentText = `${task.intent ?? ''} ${task.operation ?? ''}`.toLowerCase();
  const taskType = String(task.taskType ?? 'generic').toLowerCase();
  const directSource = task.exactKnownSource === true || task.knownFile === true ||
    ['known-file', 'string-replacement', 'exact-source'].includes(taskType) ||
    /\b(exact source|known file|string replacement)\b/.test(intentText);
  const odoo = task.project?.isOdoo === true || task.explicitOdooEvidence === true ||
    taskType.startsWith('odoo-') || /\bodoo\b/.test(intentText);
  const relational = task.needsRelationalEvidence === true ||
    ['impact-analysis', 'cross-asset', 'relationship-analysis'].includes(taskType) ||
    /\b(dependency|relationship|blast radius|call graph|impact analysis)\b/.test(intentText);
  const contextOptimization = task.needsContextOptimization === true ||
    taskType === 'large-context';
  const architecture = ['architecture', 'multi-disciplinary', 'system-design'].includes(taskType);
  const forgeAdvice = task.forgeAdvice === true || taskType === 'forge-advice';
  const forgeAutonomous = task.autonomousExecution === true || AUTONOMOUS_FORGE_INTENTS.has(taskType);
  const telemetry = task.needsTelemetry === true || task.telemetry === true || task.trackUsage === true ||
    taskType === 'usage-telemetry' || taskType === 'telemetry' ||
    /\b(telemetry|usage tracking|usage report)\b/.test(intentText);
  const customCapability = task.needsCustomCapability ?? task.customCapability ?? null;
  const customComponentId = task.customComponentId ?? null;

  return Object.freeze({
    directSource,
    odoo,
    relational,
    contextOptimization,
    architecture,
    forgeAdvice,
    forgeAutonomous,
    telemetry,
    customCapability,
    customComponentId,
  });
}

function dedupeKey(request) {
  return [
    request.taskId,
    request.sourceRevision ?? '',
    request.capability,
    request.evidenceScope ?? '',
  ].join('|');
}

function makeRequest({ task, componentId, discovery, budgets, reason, hopCount = 0 }) {
  const discovered = discovery.capabilities[componentId];
  return Object.freeze({
    contract: AFYX_CAPABILITY_REQUEST_CONTRACT,
    taskId: task.id ?? 'anonymous-task',
    intent: task.intent ?? task.taskType ?? 'generic',
    capability: discovered.capability,
    targetComponentId: componentId,
    callerComponentId: 'afyx-native-orchestrator',
    candidateProviders: Object.freeze(discovery.provider ? [discovery.provider] : []),
    workspaceIdentity: task.workspaceIdentity ?? null,
    sourceRevision: task.sourceRevision ?? null,
    evidenceScope: task.evidenceScope ?? task.workspaceIdentity ?? 'task',
    permissions: Object.freeze({ authorized: discovered.authorized }),
    budgetLimits: budgets,
    hopCount,
    invocationReason: reason,
    sourceIdentity: discovered.sourceIdentity,
  });
}

function selectionCandidates(task, classification, modularRuntimePlan, discovery) {
  if (classification.directSource) return [];
  const selectedByPlanner = new Set(modularRuntimePlan.plannedComponents);
  if (classification.odoo) selectedByPlanner.add('odoo-engineering');
  if (classification.architecture) selectedByPlanner.add('afyx-engineering-expert');
  if (classification.relational) selectedByPlanner.add('afyx-graph');
  if (classification.contextOptimization) selectedByPlanner.add('afyx-context');
  if (classification.forgeAdvice && !classification.forgeAutonomous) {
    selectedByPlanner.add('afyx-forge');
  }
  if (classification.telemetry) {
    selectedByPlanner.add('codex-usage-tracking');
  }
  if (classification.customComponentId) {
    selectedByPlanner.add(classification.customComponentId);
  }
  if (classification.customCapability && discovery?.capabilities) {
    for (const [id, comp] of Object.entries(discovery.capabilities)) {
      if (comp.capability === classification.customCapability) {
        selectedByPlanner.add(id);
      }
    }
  }

  const preferredOrder = [
    ...(classification.odoo ? ['odoo-engineering'] : []),
    ...(classification.architecture ? ['afyx-engineering-expert'] : []),
    ...(classification.relational ? ['afyx-graph'] : []),
    'efficient-coding',
    ...(classification.contextOptimization ? ['afyx-context'] : []),
    ...(classification.forgeAdvice ? ['afyx-forge'] : []),
    ...(classification.telemetry ? ['codex-usage-tracking'] : []),
    ...(classification.customComponentId ? [classification.customComponentId] : []),
    ...modularRuntimePlan.plannedComponents,
  ];
  const reasons = {
    'odoo-engineering': 'Odoo domain authority',
    'afyx-engineering-expert': 'Cross-disciplinary authority',
    'afyx-graph': 'Relational evidence is beneficial',
    'efficient-coding': 'Focused implementation authority',
    'afyx-context': 'Bounded context optimization requested',
    'afyx-forge': 'Assistive advice requested; autonomous execution remains blocked',
    'codex-usage-tracking': 'Passive usage telemetry observation',
  };
  return [...new Set(preferredOrder)]
    .filter((componentId) => selectedByPlanner.has(componentId))
    .map((componentId) => [componentId, reasons[componentId] ?? `Selected for ${componentId} capability`]);
}

/** Resolve an executable, deterministic route without invoking a component. */
export function resolveAfyxCapabilityRoute(options = {}) {
  const task = options.task ?? {};
  const budgets = normalizeBudgets(options.budgetLimits);
  const discovery = discoverAfyxCapabilities(options);
  const classification = classifyTaskIntent(task);
  const modularRuntimePlan = resolveModularRuntimeActivation({
    task,
    provider: options.provider ?? null,
    installedComponents: options.componentStates ?? {},
    userPreferences: {
      ...(options.userPreferences ?? {}),
      forceDirectSource: classification.directSource || options.userPreferences?.forceDirectSource === true,
      disableContext: discovery.capabilities['afyx-context']?.enabled === false,
    },
    hostAuthorizations: options.hostAuthorizations ?? {},
  });
  const diagnostics = [];
  const degradations = [];
  const requests = [];
  const seenCapabilities = new Set();
  const owners = {};

  if (!discovery.providerKnown) {
    diagnostics.push({ code: 'UNKNOWN_PROVIDER', severity: 'ERROR' });
  }
  if (classification.forgeAutonomous) {
    diagnostics.push({ code: 'FORGE_A8_REQUIRED', severity: 'ERROR' });
  }
  const inheritedBlockingDiagnostics = modularRuntimePlan.diagnostics.filter((item) =>
    item.severity === 'ERROR' && !(
      item.code === 'FORGE_GATED_PENDING_A8' &&
      classification.forgeAdvice &&
      !classification.forgeAutonomous
    ));
  for (const item of inheritedBlockingDiagnostics) {
    if (!diagnostics.some((diagnostic) => diagnostic.code === item.code)) {
      diagnostics.push({ code: item.code, severity: item.severity });
    }
  }

  for (const [componentId, reason] of selectionCandidates(task, classification, modularRuntimePlan, discovery)) {
    if (seenCapabilities.has(componentId)) continue;
    seenCapabilities.add(componentId);
    const discovered = discovery.capabilities[componentId];
    if (!discovered) continue;

    const authority = DOMAIN_AUTHORITY_MATRIX[discovered.capability] ?? {
      primaryOwner: componentId,
      description: `${componentId} authoritative domain`,
    };
    if (authority?.primaryOwner !== componentId) {
      diagnostics.push({ code: 'AUTHORITY_MISMATCH', componentId, severity: 'ERROR' });
      continue;
    }
    owners[discovered.capability] = componentId;
    if (!discovered.available) {
      degradations.push({
        componentId,
        capability: discovered.capability,
        reason: discovered.reason,
        fallback: 'DIRECT_SOURCE',
      });
      continue;
    }
    if (requests.length >= budgets.maxCapabilities) {
      degradations.push({
        componentId,
        capability: discovered.capability,
        reason: 'CAPABILITY_BUDGET_EXHAUSTED',
        fallback: 'DIRECT_SOURCE',
      });
      continue;
    }
    requests.push(makeRequest({ task, componentId, discovery, budgets, reason }));
  }

  const blocked = !discovery.providerKnown || classification.forgeAutonomous || inheritedBlockingDiagnostics.length > 0;
  return Object.freeze({
    contract: AFYX_UNIVERSAL_INTEROP_CONTRACT,
    taskId: task.id ?? 'anonymous-task',
    status: blocked ? 'BLOCKED' : (degradations.length ? 'DEGRADED' : 'READY'),
    executionStatus: 'NOT_RUN',
    directSourceFastPath: classification.directSource,
    classification,
    discovery,
    domainAuthorities: Object.freeze(owners),
    requests: Object.freeze(requests),
    degradations: Object.freeze(degradations),
    diagnostics: Object.freeze(diagnostics),
    planningEvidence: Object.freeze({
      contract: modularRuntimePlan.contract,
      status: modularRuntimePlan.status,
      executionStatus: modularRuntimePlan.executionStatus,
    }),
    budgets,
  });
}

function normalizedAdapterResult(request, raw, durationMs, validTargetIds) {
  const succeeded = raw?.status === 'SUCCESS' || raw?.status === 'EXECUTED';
  const output = raw?.output ?? null;
  let measuredOutputBytes = 0;
  try {
    measuredOutputBytes = output === null
      ? 0
      : Buffer.byteLength(typeof output === 'string' ? output : JSON.stringify(output));
  } catch {
    measuredOutputBytes = Number.MAX_SAFE_INTEGER;
  }
  const followUpRequests = Array.isArray(raw?.followUpRequests)
    ? raw.followUpRequests
      .filter((item) => item && (validTargetIds ? validTargetIds.has(item.targetComponentId) : true))
      .map((item) => Object.freeze({
        targetComponentId: item.targetComponentId,
        invocationReason: typeof item.invocationReason === 'string'
          ? item.invocationReason
          : `Requested by ${request.targetComponentId}`,
      }))
    : [];
  return Object.freeze({
    contract: AFYX_CAPABILITY_RESULT_CONTRACT,
    taskId: request.taskId,
    capability: request.capability,
    componentId: request.targetComponentId,
    status: succeeded ? 'EXECUTED' : (raw?.status ?? 'FAILED'),
    executionStatus: succeeded ? 'EXECUTED' : 'FAILED',
    output,
    evidence: Object.freeze(Array.isArray(raw?.evidence) ? raw.evidence : []),
    provenance: Object.freeze({
      workspaceIdentity: request.workspaceIdentity,
      sourceRevision: request.sourceRevision,
      componentSourceIdentity: request.sourceIdentity,
      observationSource: 'ADAPTER_EXECUTION',
    }),
    durationMs,
    contextBytes: Math.max(boundedInteger(raw?.contextBytes, 0), measuredOutputBytes),
    followUpRequests: Object.freeze(followUpRequests),
  });
}

function nonExecutedResult(request, status, reason) {
  return Object.freeze({
    contract: AFYX_CAPABILITY_RESULT_CONTRACT,
    taskId: request.taskId,
    capability: request.capability,
    componentId: request.targetComponentId,
    status,
    executionStatus: 'NOT_RUN',
    reason,
    output: null,
    evidence: Object.freeze([]),
    provenance: Object.freeze({
      workspaceIdentity: request.workspaceIdentity,
      sourceRevision: request.sourceRevision,
      componentSourceIdentity: request.sourceIdentity,
      observationSource: 'ORCHESTRATOR_DECISION',
    }),
    durationMs: 0,
    contextBytes: 0,
    followUpRequests: Object.freeze([]),
  });
}

function failedExecutionResult(request, reason, durationMs) {
  return Object.freeze({
    ...nonExecutedResult(request, 'FAILED', reason),
    executionStatus: 'FAILED',
    durationMs,
  });
}

/**
 * Execute a route through caller-provided, in-process component adapters.
 *
 * Implements universal bidirectional interoperability: any available component
 * can request an authorized follow-up capability from any other available component,
 * bounded by budgets, deduplication, cycle prevention, and Forge A8 restrictions.
 */
export async function executeAfyxCapabilityRoute(options = {}) {
  const route = resolveAfyxCapabilityRoute(options);
  const adapters = options.adapters ?? {};
  const startedAt = performance.now();
  const queue = [...route.requests];
  const results = [];
  const seen = new Set();
  const scheduledComponents = new Set(route.requests.map((request) => request.targetComponentId));
  const validTargetIds = new Set(Object.keys(route.discovery.capabilities));
  let contextBytes = 0;
  let duplicateInvocationsAvoided = 0;
  let toolCalls = 0;
  let contextBudgetExceeded = false;

  if (route.status === 'BLOCKED' || route.directSourceFastPath) {
    return Object.freeze({
      ...route,
      executionStatus: route.status === 'BLOCKED' ? 'BLOCKED' : 'DIRECT_SOURCE',
      results: Object.freeze([]),
      metrics: Object.freeze({
        selectedCapabilities: route.requests.length,
        executedCapabilities: 0,
        toolCalls: 0,
        contextBytes: 0,
        duplicateInvocationsAvoided: 0,
        elapsedMs: performance.now() - startedAt,
      }),
    });
  }

  while (queue.length > 0) {
    const request = queue.shift();
    const key = dedupeKey(request);
    if (seen.has(key)) {
      duplicateInvocationsAvoided += 1;
      results.push(nonExecutedResult(request, 'SUPPRESSED', 'DUPLICATE_REQUEST'));
      continue;
    }
    seen.add(key);

    if (request.hopCount > route.budgets.maxHops) {
      results.push(nonExecutedResult(request, 'BLOCKED', 'HOP_BUDGET_EXHAUSTED'));
      continue;
    }
    if (toolCalls >= route.budgets.maxToolCalls) {
      results.push(nonExecutedResult(request, 'BLOCKED', 'TOOL_CALL_BUDGET_EXHAUSTED'));
      continue;
    }
    if (performance.now() - startedAt >= route.budgets.maxExecutionMs) {
      results.push(nonExecutedResult(request, 'BLOCKED', 'EXECUTION_TIME_BUDGET_EXHAUSTED'));
      continue;
    }
    const discovered = route.discovery.capabilities[request.targetComponentId];
    if (!discovered?.available || discovered.capability !== request.capability) {
      results.push(nonExecutedResult(request, 'BLOCKED', 'CAPABILITY_NOT_AVAILABLE'));
      continue;
    }
    const adapter = adapters[request.targetComponentId];
    if (typeof adapter !== 'function') {
      results.push(nonExecutedResult(request, 'DEGRADED', 'ADAPTER_NOT_PROVIDED'));
      continue;
    }

    const invocationStartedAt = performance.now();
    let result;
    let timeout;
    const controller = new AbortController();
    try {
      const remainingMs = Math.max(1, route.budgets.maxExecutionMs - (performance.now() - startedAt));
      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('EXECUTION_TIME_BUDGET_EXHAUSTED'));
        }, remainingMs);
      });
      toolCalls += 1;
      result = normalizedAdapterResult(
        request,
        await Promise.race([adapter(request, { signal: controller.signal }), timeoutPromise]),
        performance.now() - invocationStartedAt,
        validTargetIds,
      );
    } catch (error) {
      result = failedExecutionResult(
        request,
        error instanceof Error ? error.message : String(error),
        performance.now() - invocationStartedAt,
      );
    } finally {
      clearTimeout(timeout);
    }
    results.push(result);
    contextBytes += result.contextBytes;
    if (contextBytes > route.budgets.maxContextBytes) {
      contextBudgetExceeded = true;
      break;
    }

    // Process bidirectional follow-up capability requests
    for (const followUp of result.followUpRequests) {
      const target = followUp?.targetComponentId;
      const followUpCapability = route.discovery.capabilities[target];
      const forgeAllowed = target !== 'afyx-forge' ||
        (route.classification.forgeAdvice && !route.classification.forgeAutonomous);
      const isAvailable = followUpCapability?.available === true;
      const notDirectSelfCycle = target !== request.targetComponentId;

      if (!isAvailable || !forgeAllowed || !notDirectSelfCycle) {
        if (followUpCapability) {
          results.push(nonExecutedResult(
            makeRequest({
              task: options.task ?? {},
              componentId: target,
              discovery: route.discovery,
              budgets: route.budgets,
              reason: followUp.invocationReason ?? `Requested by ${request.targetComponentId}`,
              hopCount: request.hopCount + 1,
            }),
            'BLOCKED',
            !forgeAllowed ? 'FORGE_A8_REQUIRED' : (!notDirectSelfCycle ? 'DIRECT_SELF_CYCLE' : 'FOLLOW_UP_NOT_AUTHORIZED'),
          ));
        }
        continue;
      }
      if (!scheduledComponents.has(target) && scheduledComponents.size >= route.budgets.maxCapabilities) {
        results.push(nonExecutedResult(
          makeRequest({
            task: options.task ?? {},
            componentId: target,
            discovery: route.discovery,
            budgets: route.budgets,
            reason: followUp.invocationReason ?? `Requested by ${request.targetComponentId}`,
            hopCount: request.hopCount + 1,
          }),
          'BLOCKED',
          'CAPABILITY_BUDGET_EXHAUSTED',
        ));
        continue;
      }
      scheduledComponents.add(target);
      queue.push(Object.freeze({
        ...makeRequest({
          task: options.task ?? {},
          componentId: target,
          discovery: route.discovery,
          budgets: route.budgets,
          reason: followUp.invocationReason ?? `Requested by ${request.targetComponentId}`,
          hopCount: request.hopCount + 1,
        }),
        callerComponentId: request.targetComponentId,
      }));
    }
  }

  const executedCapabilities = results.filter((result) => result.executionStatus === 'EXECUTED').length;
  const failed = results.some((result) => result.status === 'FAILED');
  const degraded = contextBudgetExceeded || route.status === 'DEGRADED' || results.some((result) => ['DEGRADED', 'BLOCKED'].includes(result.status));
  return Object.freeze({
    ...route,
    status: failed ? 'FAILED' : (degraded ? 'DEGRADED' : 'READY'),
    executionStatus: executedCapabilities > 0 ? 'EXECUTED' : 'NOT_RUN',
    results: Object.freeze(results),
    metrics: Object.freeze({
      selectedCapabilities: route.requests.length,
      executedCapabilities,
      toolCalls,
      contextBytes,
      contextBudgetExceeded,
      duplicateInvocationsAvoided,
      elapsedMs: performance.now() - startedAt,
    }),
  });
}
