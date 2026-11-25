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
import {
  createEvidenceEnvelope,
  createSharedEvidencePipeline,
  AFYX_EVIDENCE_ENVELOPE_CONTRACT,
} from './afyx-evidence-envelope.mjs';
import {
  UNIVERSAL_CAPABILITIES,
} from './afyx-tool-family-routing.mjs';

export {
  createEvidenceEnvelope,
  createSharedEvidencePipeline,
  AFYX_EVIDENCE_ENVELOPE_CONTRACT,
  UNIVERSAL_CAPABILITIES,
};

export const UNIVERSAL_CAPABILITY_HOSTS = Object.freeze({
  'afyx-work-ledger': 'afyx-context',
  'afyx-migration-planner': 'afyx-forge',
  'afyx-impact-simulator': 'afyx-context',
  'afyx-db-inspector': 'afyx-context',
  'afyx-api-contract-validator': 'afyx-forge',
  'afyx-env-preflight': 'afyx-context',
  'afyx-cli-compactor': 'afyx-context',
  'afyx-massive-context': 'afyx-context',
});

export const AFYX_UNIVERSAL_INTEROP_CONTRACT = 'AfyxUniversalInterop/v1';
export const AFYX_CAPABILITY_REQUEST_CONTRACT = 'AfyxCapabilityRequest/v1';
export const AFYX_CAPABILITY_RESULT_CONTRACT = 'AfyxCapabilityResult/v1';

/** The six primary engineering components with canonical afyx-* identities and backward-compatibility aliases. */
export const PRIMARY_COMPONENT_IDS = Object.freeze([
  'afyx-efficient-coding',
  'afyx-odoo-engineering',
  'afyx-engineering-expert',
  'afyx-graph',
  'afyx-context',
  'afyx-forge',
  'efficient-coding',
  'odoo-engineering',
]);

/** The canonical registered components in the Engineering Kit with backward-compatibility aliases. */
export const SEVEN_REGISTERED_COMPONENT_IDS = Object.freeze([
  'afyx-efficient-coding',
  'afyx-odoo-engineering',
  'afyx-engineering-expert',
  'afyx-graph',
  'afyx-context',
  'afyx-forge',
  'afyx-usage-intelligence',
  'efficient-coding',
  'odoo-engineering',
  'codex-usage-tracking',
]);

export const DEFAULT_BUDGET_LIMITS = Object.freeze({
  maxToolCalls: 4,
  maxContextBytes: 65_536,
  maxExecutionMs: 5_000,
  maxCapabilities: 3, // 1 primary domain + 2 supporting modules
  maxHops: 2,
});

const AUTONOMOUS_FORGE_INTENTS = new Set([
  'autonomous-forge',
  'forge-campaign',
  'formal-forge-evaluation',
  'production-forge-execution',
]);
const FOLLOW_UP_JUSTIFICATION = Symbol('host-adapter-justification');

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
    providers: componentDef.providers ?? null,
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

const ALIAS_MAP = Object.freeze({
  'efficient-coding': 'afyx-efficient-coding',
  'odoo-engineering': 'afyx-odoo-engineering',
  'codex-usage-tracking': 'afyx-usage-intelligence',
  'afyx-efficient-coding': 'efficient-coding',
  'afyx-odoo-engineering': 'odoo-engineering',
  'afyx-usage-intelligence': 'codex-usage-tracking',
});

function isSameComponent(id1, id2) {
  if (id1 === id2) return true;
  if (!id1 || !id2) return false;
  return ALIAS_MAP[id1] === id2 || ALIAS_MAP[id2] === id1;
}

function pickCandidate(canonicalId, aliasId, discovery, modularRuntimePlan) {
  const canonicalInstalled = discovery?.capabilities?.[canonicalId]?.installed === true;
  const aliasInstalled = discovery?.capabilities?.[aliasId]?.installed === true;
  if (aliasInstalled && !canonicalInstalled) return aliasId;
  if (canonicalInstalled && !aliasInstalled) return canonicalId;
  if (modularRuntimePlan?.plannedComponents?.includes(aliasId)) return aliasId;
  if (modularRuntimePlan?.plannedComponents?.includes(canonicalId)) return canonicalId;
  if (aliasInstalled) return aliasId;
  return canonicalId;
}

function providerAllows(componentId, capability, provider, providerPermissions, metadata) {
  if (providerPermissions?.[componentId] === false || providerPermissions?.[capability] === false) {
    return false;
  }
  if (provider === null) return componentId !== 'afyx-credential-broker';
  const providerMeta = PROVIDER_CAPABILITY_SUPPORT[provider];
  if (!providerMeta) return false;
  const declaredProviders = metadata?.providers;
  if (declaredProviders && !declaredProviders.includes(provider)) return false;
  if (componentId === 'afyx-forge') {
    return providerPermissions?.[componentId] === true;
  }
  if (providerMeta.supportedCapabilities.includes(capability) ||
      (capability === 'universal-usage-telemetry' && providerMeta.supportedCapabilities.includes('codex-usage-telemetry'))) {
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

  const localRegistry = new Map(DYNAMIC_COMPONENT_REGISTRY);
  for (const item of Array.isArray(customComponents) ? customComponents : []) {
    if (item?.id && typeof item.id === 'string') localRegistry.set(item.id, Object.freeze({ ...item }));
  }

  // Universal discovery over all registered and caller-declared components
  const allComponentIds = new Set([
    ...localRegistry.keys(),
    ...Object.keys(componentStates),
  ]);

  for (const componentId of allComponentIds) {
    const observed = componentStates[componentId] ?? {};
    const metadata = localRegistry.get(componentId) ?? {
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
      metadata,
    );
    const installed = observed.installed === true;
    // Default-enabled for interoperability if installed, unless explicitly set to false or context env off
    const enabled = installed && observed.enabled !== false &&
      !(componentId === 'afyx-context' && contextEnvironmentOff);
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
export function classifyTaskIntent(task = {}, hostMetadata = {}) {
  // Host observations are routing hints, never authorization grants. Task JSON
  // cannot supply the in-process hostMetadata or a schema loader.
  const domain = String(task.domain ?? hostMetadata.domain ?? '').toLowerCase();
  const knownDomains = new Set(['odoo', 'github', 'documentation', 'local-cli', 'engineering', 'security']);
  const unknownDomain = Boolean(domain && !knownDomains.has(domain));
  const framework = task.project?.framework ?? task.framework ?? hostMetadata.project?.framework ?? hostMetadata.file?.framework;
  const intentText = `${task.intent ?? ''} ${task.operation ?? ''}`.toLowerCase();
  const taskType = String(task.taskType ?? 'generic').toLowerCase();
  const textualDomains = [/\bodoo\b/, /\bgithub\b/, /\bdocumentation\b/].filter((pattern) => pattern.test(intentText));
  const specifiedType = taskType !== 'generic' && taskType !== 'unknown';
  const ambiguousDomain = !domain && !specifiedType && (textualDomains.length > 1 ||
    (Array.isArray(hostMetadata.domains) && new Set(hostMetadata.domains).size > 1));
  const fastPathPatterns = [
    /\b(?:simple\s+edit|straightforward\s+edit|single\s+file\s+edit)\b/i,
    /\b(?:simple\s+formatting|code\s+format|reformat|prettier|lint\s+fix)\b/i,
    /\b(?:config\s+lookup|configuration\s+lookup|read\s+config|inspect\s+setting)\b/i,
    /\b(?:trivial\s+code\s+explanation|explain\s+this\s+function|what\s+does\s+this\s+do)\b/i,
    /\b(?:small\s+deterministic\s+refactor|local\s+refactor|rename\s+local\s+var)\b/i,
  ];
  const isFastPath = fastPathPatterns.some((pattern) => pattern.test(intentText)) ||
    ['simple-edit', 'formatting', 'config-lookup', 'explanation', 'trivial-refactor'].includes(taskType);
  const directSourceCandidate = task.exactKnownSource === true || task.knownFile === true || isFastPath ||
    ['known-file', 'string-replacement', 'exact-source'].includes(taskType) ||
    /\b(exact source|known file|string replacement)\b/.test(intentText);
  const specializedType = ['github-operation', 'documentation-search', 'documentation-research', 'multi-agent-workflow', 'workflow-execution', 'cli-automation'].includes(taskType);
  const odoo = (!domain || domain === 'odoo') && !ambiguousDomain && (domain === 'odoo' || !specializedType && (framework === 'odoo' ||
    task.project?.isOdoo === true || task.explicitOdooEvidence === true || taskType.startsWith('odoo-') || /\bodoo\b/.test(intentText)));
  const graphRelationshipTask = ['callers', 'caller-analysis', 'impact', 'symbol-impact'].includes(taskType);
  const relational = graphRelationshipTask || task.needsRelationalEvidence === true ||
    ['impact-analysis', 'cross-asset', 'relationship-analysis'].includes(taskType) ||
    /\b(dependency|relationship|blast radius|call graph|impact analysis)\b/.test(intentText);
  const dbInspection = taskType === 'db-inspection' || task.needsDbInspection === true ||
    task.capability === 'afyx-db-inspector' || /\b(sqlite|database inspection|inspect database|schema inspection)\b/i.test(intentText);
  const cliCompaction = taskType === 'cli-compaction' || task.needsCliCompaction === true ||
    task.capability === 'afyx-cli-compactor' || /\b(compact cli|cli compaction|compress output|terminal compaction)\b/i.test(intentText);
  const massiveContext = taskType === 'massive-context' || task.needsMassiveContext === true ||
    task.capability === 'afyx-massive-context' || /\b(massive context|large file navigation|slice extraction)\b/i.test(intentText);
  const contractValidation = taskType === 'contract-validation' || task.needsContractValidation === true ||
    task.capability === 'afyx-api-contract-validator' || /\b(api contract|contract validation|openapi validation|graphql schema)\b/i.test(intentText);
  const migrationPlanning = taskType === 'migration-planning' || task.needsMigrationPlanning === true ||
    task.capability === 'afyx-migration-planner' || /\b(migration plan|migration planning|rollback plan)\b/i.test(intentText);
  const workLedger = taskType === 'work-ledger' || task.needsWorkLedger === true ||
    task.capability === 'afyx-work-ledger' || /\b(work ledger|task ledger|execution receipt)\b/i.test(intentText);
  const impactSimulation = taskType === 'impact-simulation' || task.needsImpactSimulation === true ||
    task.capability === 'afyx-impact-simulator' || /\b(impact simulation|simulate impact|blast radius simulation)\b/i.test(intentText);
  const envPreflight = taskType === 'env-preflight' || task.needsEnvPreflight === true ||
    task.capability === 'afyx-env-preflight' || /\b(env preflight|environment preflight|prerequisite check)\b/i.test(intentText);

  const hasUniversalContext = dbInspection || cliCompaction || massiveContext || workLedger || impactSimulation || envPreflight;
  const hasUniversalForge = contractValidation || migrationPlanning;

  const peerImpact = graphRelationshipTask && Array.isArray(task.payload?.peerProjectPaths);
  const contextOptimization = peerImpact || task.needsContextOptimization === true ||
    taskType === 'large-context' || hasUniversalContext;
  const architecture = ['architecture', 'multi-disciplinary', 'system-design', 'general-engineering', 'skill-discovery', 'skill-refinement', 'skill-composition'].includes(taskType);
  const forgeAdvice = (task.forgeAdvice === true || ['forge-advice', 'workflow-execution', 'multi-agent-workflow'].includes(taskType) || hasUniversalForge);
  const forgeAutonomous = task.autonomousExecution === true || AUTONOMOUS_FORGE_INTENTS.has(taskType);
  const telemetry = task.needsTelemetry === true || task.telemetry === true || task.trackUsage === true ||
    taskType === 'usage-telemetry' || taskType === 'telemetry' ||
    /\b(telemetry|usage tracking|usage report)\b/.test(intentText);
  const documentation = ['documentation-search', 'documentation-research'].includes(taskType) || domain === 'documentation';
  const usageAnalytics = taskType === 'usage-analytics';
  const github = taskType !== 'cli-automation' && (taskType === 'github-operation' || domain === 'github');
  const nativeExecution = taskType === 'cli-automation' || domain === 'local-cli';
  const securityAudit = taskType === 'security-audit';
  const manualSelection = Array.isArray(task.manualSelection) ? task.manualSelection.filter((id) => typeof id === 'string').slice(0, 4) : [];
  const customCapability = task.needsCustomCapability ?? task.customCapability ?? null;
  const customComponentId = task.customComponentId ?? null;
  const explicitSharedNeed = task.needsRelationalEvidence === true || task.needsContextOptimization === true || hasUniversalContext;
  const explicitCapabilityType = graphRelationshipTask || taskType.startsWith('odoo-') || specializedType || securityAudit || architecture ||
    ['large-context', 'usage-telemetry', 'usage-analytics', 'impact-analysis', 'cross-asset', 'relationship-analysis', 'db-inspection', 'cli-compaction', 'massive-context', 'contract-validation', 'migration-planning', 'work-ledger', 'impact-simulation', 'env-preflight'].includes(taskType);
  const explicitTelemetry = task.needsTelemetry === true || task.telemetry === true || task.trackUsage === true;
  const directSource = directSourceCandidate && !explicitSharedNeed && !explicitCapabilityType && !manualSelection.length &&
    !forgeAdvice && !forgeAutonomous && !explicitTelemetry && !customCapability && !customComponentId && !hasUniversalContext && !hasUniversalForge;

  return Object.freeze({
    directSource,
    odoo,
    relational,
    peerImpact,
    contextOptimization,
    architecture,
    forgeAdvice,
    forgeAutonomous,
    telemetry,
    customCapability,
    customComponentId, documentation, usageAnalytics, github, nativeExecution, securityAudit, manualSelection,
    unknownDomain, ambiguousDomain,
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
  const targetCap = (task.capability && UNIVERSAL_CAPABILITIES.includes(task.capability) && UNIVERSAL_CAPABILITY_HOSTS[task.capability] === componentId)
    ? task.capability
    : (discovered?.capability ?? `${componentId}-capability`);
  return Object.freeze({
    contract: AFYX_CAPABILITY_REQUEST_CONTRACT,
    taskId: task.id ?? 'anonymous-task',
    taskType: task.taskType ?? null,
    intent: task.intent ?? task.taskType ?? 'generic',
    capability: targetCap,
    targetComponentId: componentId,
    callerComponentId: 'afyx-native-orchestrator',
    candidateProviders: Object.freeze(discovery.provider ? [discovery.provider] : []),
    workspaceIdentity: task.workspaceIdentity ?? null,
    sourceRevision: task.sourceRevision ?? null,
    evidenceScope: task.evidenceScope ?? task.workspaceIdentity ?? 'task',
    permissions: Object.freeze({ authorized: discovered?.authorized ?? false }),
    budgetLimits: budgets,
    hopCount,
    invocationReason: reason,
    sourceIdentity: discovered?.sourceIdentity ?? null,
    // Structured task data is not host configuration or an authorization grant.
    payload: task.payload !== null && typeof task.payload === 'object' ? task.payload
      : typeof task.payload === 'string' ? task.payload : (typeof task.text === 'string' ? task.text : (typeof task.input === 'string' ? task.input : null)),
    classification: typeof task.classification === 'string' ? task.classification : null,
  });
}

function selectionCandidates(task, classification, modularRuntimePlan, discovery) {
  if (classification.directSource) return [];
  const exclusiveDomain = classification.odoo || classification.forgeAdvice || classification.documentation || classification.usageAnalytics || classification.github || classification.nativeExecution || classification.securityAudit || classification.unknownDomain || classification.ambiguousDomain;
  const selectedByPlanner = new Set(exclusiveDomain ? [] : modularRuntimePlan.plannedComponents);
  if (classification.documentation || classification.usageAnalytics) selectedByPlanner.add('afyx-context');
  if (classification.github) selectedByPlanner.add('afyx-native-github');
  if (classification.nativeExecution) selectedByPlanner.add('afyx-native-execution');
  if (classification.securityAudit) selectedByPlanner.add('afyx-security-auditor');
  for (const id of classification.manualSelection) selectedByPlanner.add(id);

  // 1. Primary Domain Selection (Max 1 Primary Domain)
  if (classification.odoo) {
    selectedByPlanner.add(pickCandidate('afyx-odoo-engineering', 'odoo-engineering', discovery, modularRuntimePlan));
  } else if (classification.architecture) {
    selectedByPlanner.add('afyx-engineering-expert');
  } else if (!exclusiveDomain) {
    const codingCandidate = pickCandidate('afyx-efficient-coding', 'efficient-coding', discovery, modularRuntimePlan);
    const codingInstalled = discovery?.capabilities?.[codingCandidate]?.installed === true;
    const isCodingTask = task.taskType === 'implementation' ||
      modularRuntimePlan.plannedComponents.includes(codingCandidate) ||
      modularRuntimePlan.plannedComponents.includes('efficient-coding') ||
      modularRuntimePlan.plannedComponents.includes('afyx-efficient-coding');
    if (isCodingTask && codingInstalled) {
      selectedByPlanner.add(codingCandidate);
    }
  }

  // 2. Supporting Modules (Max 2 Supporting Modules: Graph, Forge, Context)
  const supporting = [];
  if (classification.relational && (!exclusiveDomain || classification.peerImpact || task.needsRelationalEvidence === true)) {
    supporting.push('afyx-graph');
  }
  if (classification.forgeAdvice && !classification.forgeAutonomous) {
    supporting.push('afyx-forge');
  }
  if (classification.contextOptimization) {
    supporting.push('afyx-context');
  }

  // Bounded supporting budget: at most 2 supporting modules per turn
  for (const suppId of supporting.slice(0, 2)) {
    selectedByPlanner.add(suppId);
  }

  // 3. Passive Telemetry (Infrastructure, not counted against active reasoning budget)
  if (classification.telemetry) {
    selectedByPlanner.add(pickCandidate('afyx-usage-intelligence', 'codex-usage-tracking', discovery, modularRuntimePlan));
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
    ...(classification.documentation || classification.usageAnalytics ? ['afyx-context'] : []),
    ...(classification.github ? ['afyx-native-github'] : []),
    ...(classification.nativeExecution ? ['afyx-native-execution'] : []),
    ...(classification.securityAudit ? ['afyx-security-auditor'] : []),
    ...(classification.peerImpact ? ['afyx-graph'] : []),
    ...classification.manualSelection,
    ...(classification.odoo ? ['afyx-odoo-engineering', 'odoo-engineering'] : []),
    ...(classification.architecture ? ['afyx-engineering-expert'] : []),
    ...(classification.relational ? ['afyx-graph'] : []),
    'afyx-efficient-coding',
    'efficient-coding',
    ...(classification.contextOptimization ? ['afyx-context'] : []),
    ...(classification.forgeAdvice ? ['afyx-forge'] : []),
    ...(classification.telemetry ? ['afyx-usage-intelligence', 'codex-usage-tracking'] : []),
    ...(classification.customComponentId ? [classification.customComponentId] : []),
    ...(classification.customCapability ? Object.entries(discovery.capabilities)
      .filter(([, component]) => component.capability === classification.customCapability)
      .map(([id]) => id) : []),
    ...modularRuntimePlan.plannedComponents,
  ];
  const reasons = {
    'afyx-odoo-engineering': 'AFYX Odoo domain authority',
    'odoo-engineering': 'Odoo domain authority',
    'afyx-engineering-expert': 'Cross-disciplinary authority',
    'afyx-graph': 'Relational evidence is beneficial',
    'afyx-efficient-coding': 'Focused implementation authority',
    'efficient-coding': 'Focused implementation authority',
    'afyx-context': 'Bounded context optimization requested',
    'afyx-forge': 'Assistive advice requested; autonomous execution remains blocked',
    'afyx-usage-intelligence': 'Passive usage telemetry observation',
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
  const classification = classifyTaskIntent(task, options.hostMetadata);
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

  if (classification.unknownDomain || classification.ambiguousDomain) {
    diagnostics.push({ code: classification.unknownDomain ? 'UNKNOWN_DOMAIN' : 'AMBIGUOUS_DOMAIN', severity: 'INFO' });
  }

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
    const isOwnerMatch = authority?.primaryOwner === componentId || isSameComponent(authority?.primaryOwner, componentId);
    if (!isOwnerMatch) {
      diagnostics.push({ code: 'AUTHORITY_MISMATCH', componentId, severity: 'ERROR' });
      continue;
    }
    const currentOwner = owners[discovered.capability];
    if (currentOwner && currentOwner !== componentId && !isSameComponent(currentOwner, componentId)) {
      diagnostics.push({ code: 'AUTHORITY_CONFLICT', capability: discovered.capability, severity: 'ERROR' });
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
    // Graph->Context Dependency-Aware Scheduling:
    // When a task requests both relational Graph evidence and Context optimization,
    // Context is a downstream dependent capability of Graph evidence.
    // Do not schedule Context in initial requests; it will be scheduled dynamically
    // only when the actual Graph result is eligible (>20KB) and available.
    if (componentId === 'afyx-context' && classification.relational && classification.contextOptimization) {
      continue;
    }
    requests.push(makeRequest({ task, componentId, discovery, budgets, reason }));
  }

  const blocked = !discovery.providerKnown || classification.forgeAutonomous || inheritedBlockingDiagnostics.length > 0 ||
    diagnostics.some((item) => ['AUTHORITY_CONFLICT', 'AUTHORITY_MISMATCH'].includes(item.code));
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
        [FOLLOW_UP_JUSTIFICATION]: typeof item.invocationReason === 'string' && item.invocationReason.trim().length > 0,
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
    reason: succeeded ? undefined : (raw?.reason ?? 'ADAPTER_EXECUTION_FAILED'),
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

function getBuiltinLazyAdapter(componentId, capability) {
  if (componentId === 'afyx-context') {
    return async (req) => {
      const workspace = req.workspaceIdentity || process.cwd();
      const cap = req.capability || capability;
      if (cap === 'afyx-db-inspector' || req.taskType === 'db-inspection') {
        const { DbInspector } = await import('../afyx-context/src/db-inspector.js');
        const inspector = new DbInspector(workspace);
        const relPath = req.payload?.path || req.payload?.file || (typeof req.payload === 'string' ? req.payload : 'data.sqlite');
        const out = inspector.inspectDataset(relPath, req.payload?.options || {});
        const isSuccess = out && (out.status === 'SCHEMA_INSPECTED' || out.status === 'INSPECTED' || out.status === 'HEADER_ONLY_FALLBACK');
        return { status: isSuccess ? 'SUCCESS' : 'FAILED', output: out, evidence: [out] };
      }
      if (cap === 'afyx-cli-compactor' || req.taskType === 'cli-compaction') {
        const { CliCompactor } = await import('../afyx-context/src/cli-compactor.js');
        const compactor = new CliCompactor();
        const raw = typeof req.payload === 'string' ? req.payload : (req.payload?.raw || req.payload?.output || '');
        const out = compactor.compact(raw, typeof req.payload === 'object' ? req.payload : {});
        return { status: 'SUCCESS', output: out, evidence: [out] };
      }
      if (cap === 'afyx-massive-context' || req.taskType === 'massive-context') {
        const { MassiveContextNavigator } = await import('../afyx-context/src/massive-context.js');
        const nav = new MassiveContextNavigator(workspace);
        nav.indexWorkspace();
        const query = req.payload?.query || (typeof req.payload === 'string' ? req.payload : 'context');
        const out = nav.retrieveContext(query, typeof req.payload === 'object' ? req.payload : {});
        return { status: 'SUCCESS', output: out, evidence: [out] };
      }
      if (cap === 'afyx-work-ledger' || req.taskType === 'work-ledger') {
        const { WorkLedger } = await import('../afyx-context/src/work-ledger.js');
        const ledger = new WorkLedger(workspace);
        const record = ledger.recordEntry(typeof req.payload === 'object' ? req.payload : { ledgerId: req.taskId, taskObjective: req.intent });
        const receipt = ledger.createReceipt(record.ledgerId);
        const out = { ...record, receipt };
        return { status: 'SUCCESS', output: out, evidence: [out] };
      }
      if (cap === 'afyx-impact-simulator' || req.taskType === 'impact-simulation') {
        const { ImpactSimulator } = await import('../afyx-context/src/impact-simulator.js');
        const sim = new ImpactSimulator(workspace);
        const targetPath = req.payload?.targetPath || req.payload?.file || (typeof req.payload === 'string' ? req.payload : 'index.js');
        const out = sim.simulate(targetPath, typeof req.payload === 'object' ? req.payload : {});
        return { status: 'SUCCESS', output: out, evidence: [out] };
      }
      if (cap === 'afyx-env-preflight' || req.taskType === 'env-preflight') {
        const { EnvPreflight } = await import('../afyx-context/src/env-preflight.js');
        const preflight = new EnvPreflight(workspace);
        const out = await preflight.runPreflight(typeof req.payload === 'object' ? req.payload : {});
        return { status: 'SUCCESS', output: out, evidence: [out] };
      }
      return null;
    };
  }
  if (componentId === 'afyx-forge') {
    return async (req) => {
      const workspace = req.workspaceIdentity || process.cwd();
      const cap = req.capability || capability;
      if (cap === 'afyx-migration-planner' || req.taskType === 'migration-planning') {
        const { MigrationPlanner } = await import('../afyx-forge/src/migration-planner.js');
        const planner = new MigrationPlanner(workspace);
        const out = planner.createMigrationPlan(typeof req.payload === 'object' ? req.payload : { migrationType: 'data-transform', sourcePath: 'src', targetPath: 'dest' });
        return { status: 'SUCCESS', output: out, evidence: [out] };
      }
      if (cap === 'afyx-api-contract-validator' || req.taskType === 'contract-validation') {
        const { ContractValidator } = await import('../afyx-forge/src/contract-validator.js');
        const validator = new ContractValidator(workspace);
        const relPath = req.payload?.path || req.payload?.file || (typeof req.payload === 'string' ? req.payload : 'schema.json');
        const out = validator.validate(relPath, typeof req.payload === 'object' ? req.payload : {});
        return { status: 'SUCCESS', output: out, evidence: [out] };
      }
      return null;
    };
  }
  return null;
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
  const executionStarted = performance.now();
  const startedAt = executionStarted - (Number.isFinite(options.preparationElapsedMs) ? Math.max(0, options.preparationElapsedMs) : 0);

  const task = options.task ?? {};
  const initialClassification = classifyTaskIntent(task, options.hostMetadata);
  const exclusive = initialClassification.odoo || initialClassification.forgeAdvice || initialClassification.documentation || initialClassification.usageAnalytics ||
    initialClassification.github || initialClassification.nativeExecution || initialClassification.securityAudit || initialClassification.unknownDomain || initialClassification.ambiguousDomain;
  const hasRelationalDemand = initialClassification.relational && (!exclusive || task.needsRelationalEvidence === true);

  // First-use Graph JIT Initialization:
  // When a task has explicit relational demand, Graph is installed and authorized,
  // but the workspace index is not ready, perform JIT initialization before route planning.
  const graphState = options.componentStates?.['afyx-graph'];
  if (hasRelationalDemand && graphState?.installed && graphState?.enabled !== false && graphState?.authorized &&
      !graphState?.indexReady && options.budgetLimits?.maxToolCalls !== 0 && options.budgetLimits?.maxCapabilities !== 0 &&
      typeof options.prepareCapabilityState === 'function') {
    try {
      const remainingMs = Math.max(1, Math.floor((options.budgetLimits?.maxExecutionMs || DEFAULT_BUDGET_LIMITS.maxExecutionMs) - (performance.now() - startedAt)));
      const preparedGraph = await options.prepareCapabilityState('afyx-graph', {
        jitInitialize: true,
        relationalDemand: true,
        useInitialStatus: true,
        maxExecutionMs: remainingMs,
      });
      if (preparedGraph && typeof preparedGraph === 'object') {
        options = {
          ...options,
          componentStates: {
            ...options.componentStates,
            'afyx-graph': preparedGraph,
          },
        };
      }
    } catch {
      // Preflight pre-init failure degrades safely to direct source
    }
  }

  const route = resolveAfyxCapabilityRoute(options);
  const planningMs = performance.now() - executionStarted;
  let activeDiscovery = route.discovery;
  const activeOwners = { ...route.domainAuthorities };
  const adapters = options.adapters ?? {};
  const queue = [...route.requests];
  const results = [];
  const seen = new Set();
  const scheduledComponents = new Set(route.requests.map((request) => request.targetComponentId));
  const validTargetIds = new Set(Object.keys(route.discovery.capabilities));
  const preparedCapabilities = new Set();
  let contextBytes = 0;
  let duplicateInvocationsAvoided = 0;
  let toolCalls = 0;
  let contextBudgetExceeded = false;
  const invokedTools = [], loadedTools = [], details = new Map();
  const justified = new Set(route.requests.map((request) => request.targetComponentId));
  let schemaBytes = 0, schemaLatencyMs = 0, activeSchemaStarted = null, schemaLoadCalls = 0, blockedOutOfScopeRequests = 0;
  const routingMetrics = () => ({
    registeredTools: Object.keys(route.discovery.capabilities),
    discoveredTools: Object.values(route.discovery.capabilities).filter((item) => item.installed && item.enabled).map((item) => item.componentId),
    selectedTools: route.requests.map((request) => request.targetComponentId),
    invokedTools: [...invokedTools], loadedTools: [...loadedTools], schemaBytes, planningMs, schemaLoadCalls,
    schemaLatencyMs: schemaLatencyMs + (activeSchemaStarted === null ? 0 : performance.now() - activeSchemaStarted),
    unnecessaryInvocationCount: invokedTools.filter((id) => !justified.has(id)).length,
    blockedOutOfScopeRequests,
    detailLoading: typeof options.loadCapabilityDetails === 'function' ? 'HOST_DEFERRED_DETAILS' : 'HOST_NOT_SUPPORTED',
    registrationTokenSavings: 'NOT_CLAIMED',
  });

  if (route.status === 'BLOCKED' || route.directSourceFastPath) {
    return Object.freeze({
      ...route,
      executionStatus: route.status === 'BLOCKED' ? 'BLOCKED' : 'DIRECT_SOURCE',
      results: Object.freeze([]),
      metrics: Object.freeze({
        ...routingMetrics(),
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
    let request = queue.shift();
    if (route.classification.peerImpact && request.targetComponentId === 'afyx-forge') {
      const sourceResult = results.findLast(item => item.status === 'EXECUTED' &&
        item.output?.producer && (
          (item.componentId === 'afyx-context' && item.output.contract === 'AfyxContractEvidenceDigest/v1') ||
          (item.componentId === 'afyx-graph' && item.output.contract === 'AfyxCrossRepoContractImpact/v1')));
      request = Object.freeze({ ...request, sourceResult: sourceResult ?? null });
    }
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
    const discovered = activeDiscovery.capabilities[request.targetComponentId];
    const isUniversalSubcap = UNIVERSAL_CAPABILITIES.includes(request.capability) &&
      UNIVERSAL_CAPABILITY_HOSTS[request.capability] === request.targetComponentId;
    if (!discovered?.available || (!isUniversalSubcap && discovered.capability !== request.capability)) {
      results.push(nonExecutedResult(request, 'BLOCKED', 'CAPABILITY_NOT_AVAILABLE'));
      continue;
    }
    let adapter = adapters[request.targetComponentId] ??
      (ALIAS_MAP[request.targetComponentId] ? adapters[ALIAS_MAP[request.targetComponentId]] : undefined) ??
      adapters[request.capability];
    if (typeof adapter !== 'function') {
      adapter = getBuiltinLazyAdapter(request.targetComponentId, request.capability);
    }
    if (typeof adapter !== 'function') {
      results.push(nonExecutedResult(request, 'DEGRADED', 'ADAPTER_NOT_PROVIDED'));
      continue;
    }

    const invocationStartedAt = performance.now();
    let result;
    let timeout;
    let adapterStarted = false;
    const controller = new AbortController();
    try {
      const remainingMs = Math.max(1, route.budgets.maxExecutionMs - (performance.now() - startedAt));
      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('EXECUTION_TIME_BUDGET_EXHAUSTED'));
        }, remainingMs);
      });
      const invoke = async () => {
        let capabilityDetails;
        if (typeof options.loadCapabilityDetails === 'function') {
          activeSchemaStarted = performance.now();
          schemaLoadCalls += 1;
          try { capabilityDetails = await options.loadCapabilityDetails(request, { signal: controller.signal }); }
          finally { schemaLatencyMs += performance.now() - activeSchemaStarted; activeSchemaStarted = null; }
          if (controller.signal.aborted) throw new Error('EXECUTION_TIME_BUDGET_EXHAUSTED');
          const encoded = JSON.stringify(capabilityDetails);
          if (!encoded) throw new Error('CAPABILITY_DETAILS_UNAVAILABLE');
          const bytes = Buffer.byteLength(encoded);
          if (schemaBytes + contextBytes + bytes > route.budgets.maxContextBytes) throw new Error('SCHEMA_CONTEXT_BUDGET_EXHAUSTED');
          schemaBytes += bytes;
          // Snapshot host data; adapter mutations cannot affect another request.
          details.set(request.targetComponentId, JSON.parse(encoded));
          loadedTools.push(request.targetComponentId);
          capabilityDetails = details.get(request.targetComponentId);
        }
        if (controller.signal.aborted) throw new Error('EXECUTION_TIME_BUDGET_EXHAUSTED');
        toolCalls += 1;
        adapterStarted = true;
        invokedTools.push(request.targetComponentId);
        // Synchronous subprocess adapters must receive the remaining deadline;
        // an AbortController timer cannot interrupt spawnSync on the event loop.
        const remainingMs = Math.max(1, Math.floor(route.budgets.maxExecutionMs - (performance.now() - startedAt)));
        return adapter({ ...request, budgetLimits: { ...request.budgetLimits, maxExecutionMs: remainingMs } }, { signal: controller.signal, capabilityDetails });
      };
      result = normalizedAdapterResult(
        request,
        await Promise.race([invoke(), timeoutPromise]),
        performance.now() - invocationStartedAt,
        validTargetIds,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = adapterStarted ? failedExecutionResult(request, reason, performance.now() - invocationStartedAt)
        : Object.freeze({ ...nonExecutedResult(request, 'FAILED', reason), durationMs: performance.now() - invocationStartedAt });
    } finally {
      clearTimeout(timeout);
    }
    results.push(result);
    contextBytes += result.contextBytes;
    if (contextBytes + schemaBytes > route.budgets.maxContextBytes) {
      contextBudgetExceeded = true;
      break;
    }

    // Process bidirectional follow-up capability requests and dynamic Graph->Context handoff
    const isGraphResult = request.targetComponentId === 'afyx-graph';
    const contextOptimizationRequested = route.classification.contextOptimization === true;
    const canPackContract = isGraphResult && result.status === 'EXECUTED' && route.classification.peerImpact &&
      result.output?.contract === 'AfyxCrossRepoContractImpact/v1' &&
      Array.isArray(result.output.links) &&
      result.contextBytes > 8000 && result.output.links.some(link => link.provenance === 'cross-repo-contract') &&
      activeDiscovery.capabilities['afyx-context']?.available === true;
    const isEligibleGraphPayload = canPackContract || result.status === 'EXECUTED' && typeof result.output === 'string' &&
      (result.contextBytes > 20_000 || Buffer.byteLength(result.output, 'utf8') > 20_000);
    const alreadyHasContextFollowUp = result.followUpRequests.some((f) => f?.targetComponentId === 'afyx-context');

    const effectiveFollowUps = [...result.followUpRequests];
    if (isGraphResult && contextOptimizationRequested && isEligibleGraphPayload && !alreadyHasContextFollowUp) {
      effectiveFollowUps.push({
        targetComponentId: 'afyx-context',
        invocationReason: 'Compress large graph evidence payload',
        [FOLLOW_UP_JUSTIFICATION]: true,
      });
    }

    for (const followUp of effectiveFollowUps) {
      const target = followUp?.targetComponentId;
      let followUpCapability = activeDiscovery.capabilities[target];
      const forgeAllowed = target !== 'afyx-forge' ||
        ((route.classification.forgeAdvice || route.classification.manualSelection.includes(target)) && !route.classification.forgeAutonomous);
      const notDirectSelfCycle = target !== request.targetComponentId && !isSameComponent(target, request.targetComponentId);
      const authorityOwner = DOMAIN_AUTHORITY_MATRIX[followUpCapability?.capability]?.primaryOwner || activeOwners[followUpCapability?.capability];
      const ownsDomain = !authorityOwner || authorityOwner === target || isSameComponent(authorityOwner, target);
      const narrowDomain = route.classification.odoo || route.classification.github || route.classification.documentation || route.classification.nativeExecution ||
        route.classification.relational || route.classification.contextOptimization || route.classification.forgeAdvice;
      const shared = ['afyx-graph', 'afyx-context'].includes(target) && result.status === 'EXECUTED' &&
        followUp[FOLLOW_UP_JUSTIFICATION] === true &&
        (route.classification.odoo || route.classification.relational || route.classification.forgeAdvice || (target === 'afyx-context' && route.classification.contextOptimization) ||
          (target === 'afyx-graph' && options.task?.needsRelationalEvidence === true));
      const inScope = !narrowDomain || justified.has(target) || route.classification.manualSelection.includes(target) || shared;
      if (!inScope) blockedOutOfScopeRequests += 1;
      if (inScope && ownsDomain && forgeAllowed && notDirectSelfCycle && target === 'afyx-graph' &&
          followUpCapability?.reason === 'GRAPH_INDEX_NOT_READY_OR_FRESH' && typeof options.prepareCapabilityState === 'function' &&
          !preparedCapabilities.has(target) && toolCalls < route.budgets.maxToolCalls && request.hopCount < route.budgets.maxHops &&
          (scheduledComponents.has(target) || scheduledComponents.size < route.budgets.maxCapabilities) &&
          performance.now() - startedAt < route.budgets.maxExecutionMs) {
        preparedCapabilities.add(target);
        try {
          const state = await options.prepareCapabilityState(target, {
            jitInitialize: true,
            relationalDemand: true,
            maxExecutionMs: Math.max(1, Math.floor(route.budgets.maxExecutionMs - (performance.now() - startedAt))),
          });
          const observed = discoverAfyxCapabilities({ ...options, componentStates: { ...options.componentStates, [target]: state } });
          if (observed.capabilities[target]?.sourceIdentity === followUpCapability.sourceIdentity) {
            activeDiscovery = observed;
            followUpCapability = observed.capabilities[target];
          }
        } catch { /* A failed preflight remains unavailable, never assumed fresh. */ }
      }
      const isAvailable = followUpCapability?.available === true;

      if (!isAvailable || !forgeAllowed || !notDirectSelfCycle || !inScope || !ownsDomain) {
        if (followUpCapability) {
          results.push(nonExecutedResult(
            makeRequest({
              task: options.task ?? {},
              componentId: target,
              discovery: activeDiscovery,
              budgets: route.budgets,
              reason: followUp.invocationReason ?? `Requested by ${request.targetComponentId}`,
              hopCount: request.hopCount + 1,
            }),
            'BLOCKED',
            !ownsDomain ? 'FOLLOW_UP_AUTHORITY_CONFLICT' : !inScope ? 'FOLLOW_UP_OUT_OF_SCOPE' : !forgeAllowed ? 'FORGE_A8_REQUIRED' : (!notDirectSelfCycle ? 'DIRECT_SELF_CYCLE' : 'FOLLOW_UP_NOT_AUTHORIZED'),
          ));
        }
        continue;
      }
      if (!scheduledComponents.has(target) && scheduledComponents.size >= route.budgets.maxCapabilities) {
        results.push(nonExecutedResult(
          makeRequest({
            task: options.task ?? {},
            componentId: target,
            discovery: activeDiscovery,
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
      activeOwners[followUpCapability.capability] = target;
      justified.add(target);
      const nextRequest = Object.freeze({
        ...makeRequest({
          task: options.task ?? {},
          componentId: target,
          discovery: activeDiscovery,
          budgets: route.budgets,
          reason: followUp.invocationReason ?? `Requested by ${request.targetComponentId}`,
          hopCount: request.hopCount + 1,
        }),
        callerComponentId: request.targetComponentId,
        // Only actual executed evidence is passed to bounded downstream adapters.
        sourceResult: result.status === 'EXECUTED' ? result : null,
      });
      const forgeIndex = route.classification.peerImpact && target === 'afyx-context'
        ? queue.findIndex(item => item.targetComponentId === 'afyx-forge') : -1;
      if (forgeIndex < 0) queue.push(nextRequest);
      else queue.splice(forgeIndex, 0, nextRequest);
    }
  }

  const executedCapabilities = results.filter((result) => result.executionStatus === 'EXECUTED').length;
  const failed = results.some((result) => result.status === 'FAILED');
  const degraded = contextBudgetExceeded || route.status === 'DEGRADED' || results.some((result) => ['DEGRADED', 'BLOCKED'].includes(result.status));
  return Object.freeze({
    ...route,
    discovery: activeDiscovery,
    domainAuthorities: Object.freeze(activeOwners),
    status: failed ? 'FAILED' : (degraded ? 'DEGRADED' : 'READY'),
    executionStatus: executedCapabilities > 0 ? 'EXECUTED' : 'NOT_RUN',
    results: Object.freeze(results),
    metrics: Object.freeze({
      ...routingMetrics(),
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
