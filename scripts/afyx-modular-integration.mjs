/**
 * Afyx Modular Integration & Capability Routing Foundation (v1)
 *
 * Governing Principle:
 * "Standalone by Design, Integrated by Contract, Activated by Need."
 *
 * Every Afyx-owned component operates independently and exposes compatible
 * integration contracts when multiple components are installed.
 *
 * Integration is available, but execution is selective:
 * - Prevents duplicate domain responsibilities
 * - Prevents redundant context loading
 * - Prevents unnecessary tool invocation
 * - Prevents unjustified token consumption
 *
 * Boundary Note:
 * This module defines deterministic capability planning. Live runtime tool
 * invocation and execution monitoring remain separate host integration boundaries.
 */

export const AFYX_MODULAR_INTEGRATION_CONTRACT = 'AfyxModularIntegration/v1';

export const GOVERNING_PRINCIPLE = 'Standalone by Design, Integrated by Contract, Activated by Need.';

/**
 * Explicit product maturity classifications.
 */
export const PRODUCT_MATURITY_LEVELS = Object.freeze([
  'SOURCE_READY',          // Code verified in source; formal acceptance pending
  'STANDALONE_ACCEPTED',   // Independently accepted in standalone runtime
  'INTEGRATION_ACCEPTED',  // Verified in multi-component integrated suite
  'RELEASE_READY',         // Promoted for public release distribution
]);

/**
 * The 8 explicit lifecycle states of capability discovery, selection, and execution.
 */
export const CAPABILITY_LIFECYCLE_STATES = Object.freeze([
  'INSTALLED',   // File / binary present on host system
  'AVAILABLE',   // Installed, compatible, and verified healthy
  'ELIGIBLE',    // Relevant to current task intent and project scope
  'SELECTED',    // Chosen by routing policy for the task execution plan
  'ACTIVATED',   // Initialized and session context prepared
  'EXECUTED',    // Invoked during actual task processing
  'DEGRADED',    // Operating with reduced scope due to missing optional component
  'UNAVAILABLE', // Absent, unsupported, disabled, or pending gate acceptance
]);

/**
 * 10 Canonical Modular Integration Principles
 */
export const INTEGRATION_PRINCIPLES = Object.freeze([
  'Every installed component remains independently usable.',
  'Compatible installed components are discoverable and available for cooperation.',
  'Installation does not imply automatic activation.',
  'Activation is based on task intent, available evidence, supported capabilities, and declared user preferences.',
  'A component owns its domain and must not duplicate another component\'s authoritative responsibility.',
  'Optional component absence must result in safe degradation rather than failure of unrelated components.',
  'Expensive context loading, indexing, tool execution, and additional validation require justified demand.',
  'Existing user-authorized behavior and manual overrides take precedence over automatic optimization.',
  'Unsupported capabilities and missing evidence must be reported explicitly.',
  'Security, correctness, and authorization requirements always take priority over efficiency.',
]);

/**
 * Canonical Afyx Product Inventory & Domain Authority Matrix
 */
export const PRODUCT_INVENTORY = Object.freeze({
  'afyx-graph': Object.freeze({
    id: 'afyx-graph',
    canonicalName: 'Afyx Graph',
    type: 'runtime',
    primaryCapability: 'repository-graph-evidence',
    domainAuthority: 'Authoritative supported repository structure, relationships, and impact evidence.',
    cooperatingComponents: Object.freeze(['afyx-context', 'odoo-engineering', 'efficient-coding']),
    ownershipClass: 'AFYX',
    maturity: 'SOURCE_READY',
    productionReady: false,
    activationMode: 'ON_DEMAND',
  }),
  'afyx-context': Object.freeze({
    id: 'afyx-context',
    canonicalName: 'Afyx Context Engine',
    type: 'runtime',
    primaryCapability: 'bounded-context-optimization',
    domainAuthority: 'Bounded context optimization, exact recovery, and fallback.',
    cooperatingComponents: Object.freeze(['afyx-graph', 'efficient-coding']),
    ownershipClass: 'AFYX',
    maturity: 'SOURCE_READY',
    productionReady: false,
    activationMode: 'ON_DEMAND_DEFAULT_ENABLED', // Installed and healthy; selected only for relevant tasks
  }),
  'afyx-engineering-expert': Object.freeze({
    id: 'afyx-engineering-expert',
    canonicalName: 'Afyx Engineering Expert',
    type: 'skill',
    primaryCapability: 'cross-disciplinary-expertise',
    domainAuthority: 'Cross-disciplinary expertise selection and workflow routing.',
    cooperatingComponents: Object.freeze(['odoo-engineering', 'afyx-graph']),
    ownershipClass: 'AFYX',
    maturity: 'SOURCE_READY',
    productionReady: false,
    activationMode: 'ON_DEMAND',
  }),
  'odoo-engineering': Object.freeze({
    id: 'odoo-engineering',
    canonicalName: 'Afyx Odoo Engineering',
    type: 'skill',
    primaryCapability: 'odoo-framework-authority',
    domainAuthority: 'Odoo-specific technical and framework authority.',
    cooperatingComponents: Object.freeze(['afyx-graph', 'afyx-engineering-expert']),
    ownershipClass: 'AFYX',
    maturity: 'SOURCE_READY',
    productionReady: false,
    activationMode: 'DOMAIN_SPECIFIC', // Only for Odoo repositories/tasks
  }),
  'efficient-coding': Object.freeze({
    id: 'efficient-coding',
    canonicalName: 'Afyx Efficient Coding',
    type: 'skill',
    primaryCapability: 'focused-coding-discipline',
    domainAuthority: 'Focused coding discipline and proportional implementation guidance.',
    cooperatingComponents: Object.freeze(['afyx-graph', 'afyx-context']),
    ownershipClass: 'AFYX',
    maturity: 'SOURCE_READY',
    productionReady: false,
    activationMode: 'ALWAYS_AVAILABLE',
  }),
  'codex-usage-tracking': Object.freeze({
    id: 'codex-usage-tracking',
    canonicalName: 'Afyx Codex Usage Tracking',
    type: 'toolset',
    primaryCapability: 'codex-usage-telemetry',
    domainAuthority: 'Optional Codex-specific usage telemetry.',
    cooperatingComponents: Object.freeze([]),
    ownershipClass: 'AFYX',
    maturity: 'STANDALONE_ACCEPTED',
    productionReady: false,
    activationMode: 'OPTIONAL',
  }),
  'afyx-forge': Object.freeze({
    id: 'afyx-forge',
    canonicalName: 'Afyx Forge',
    type: 'runtime',
    primaryCapability: 'adaptive-engineering-policy',
    domainAuthority: 'Adaptive engineering execution policy, context/tool/validation allocation.',
    cooperatingComponents: Object.freeze(['efficient-coding', 'afyx-engineering-expert', 'afyx-graph', 'afyx-context']),
    ownershipClass: 'AFYX',
    maturity: 'SOURCE_READY',
    productionReady: false,
    activationMode: 'GATED_EVALUATION',
    gateStatus: 'UNAVAILABLE_PENDING_A8',
  }),
});

/**
 * Pure non-coding task types where implementation engineering discipline (efficient-coding)
 * is deterministically suppressed to prevent redundant guidance. Technical configuration
 * and automation tasks (such as 'devops-config', CI/CD workflows, Dockerfiles, and provisioning)
 * are classified as implementation tasks and retain efficient-coding selection for quality-first
 * scoped changes and validation.
 */
const NON_CODING_TASK_TYPES = new Set([
  'documentation',
  'document-review',
  'general-inquiry',
  'conversation',
  'prompt-writing',
  'plain-question',
]);

/**
 * Resolves an explicit, deterministic capability integration plan for an engineering task.
 *
 * @param {Object} task
 * @param {string} task.taskType - e.g. 'simple-fix', 'odoo-issue', 'architecture', 'large-context', 'documentation'
 * @param {string} [task.intent] - descriptive intent
 * @param {Object} [task.project] - project facts e.g. { isOdoo: boolean, language: string }
 * @param {boolean} [task.explicitOdooEvidence] - justified explicit Odoo evidence even if repo is undetected
 * @param {boolean} [task.needsRelationalEvidence] - whether relational/impact analysis is required
 * @param {boolean} [task.optInContextEngine] - true forces eligible selection; false explicitly disables Context
 * @param {Object} [installedComponents] - map of { [componentId]: { installed: boolean, healthy: boolean } }
 * @param {Object} [userPreferences] - user overrides e.g. { forceDirectSource: boolean, disableContext: boolean }
 * @returns {Object} Deterministic capability plan
 */
export function resolveModularCapabilityPlan(task = {}, installedComponents = {}, userPreferences = {}) {
  const plan = {
    contract: AFYX_MODULAR_INTEGRATION_CONTRACT,
    governingPrinciple: GOVERNING_PRINCIPLE,
    taskType: task.taskType || 'generic',
    selectedComponents: [],
    componentStates: {},
    suppressedRedundancies: [],
    degradations: [],
    reasons: {},
  };

  const isOdooDetected = Boolean(task.project?.isOdoo);
  const isExplicitOdooTask = Boolean(
    task.explicitOdooEvidence ||
    task.taskType?.startsWith('odoo-') ||
    (typeof task.intent === 'string' && /\bodoo\b/i.test(task.intent))
  );
  const isOdooRelevant = isOdooDetected || isExplicitOdooTask;

  const isNonCoding = NON_CODING_TASK_TYPES.has(task.taskType);
  const needsRelational = Boolean(task.needsRelationalEvidence);
  const contextEnabled = task.optInContextEngine !== false && !userPreferences.disableContext;
  const contextNeeded = task.optInContextEngine === true || task.taskType === 'large-context' || task.needsContextOptimization === true;
  const forceDirectSource = Boolean(userPreferences.forceDirectSource);

  for (const [id, meta] of Object.entries(PRODUCT_INVENTORY)) {
    const installInfo = installedComponents[id] || { installed: false, healthy: false };
    const isInstalled = Boolean(installInfo.installed);
    const isHealthy = Boolean(installInfo.healthy);

    // 1. Forge is strictly blocked pending formal A8 gate
    if (id === 'afyx-forge') {
      plan.componentStates[id] = 'UNAVAILABLE';
      plan.reasons[id] = 'Production activation unavailable pending formal A8 acceptance.';
      continue;
    }

    // 2. Base installation check
    if (!isInstalled) {
      plan.componentStates[id] = 'UNAVAILABLE';
      plan.reasons[id] = 'Not installed on host.';
      continue;
    }

    // 3. Health check: installed but unhealthy degrades
    if (!isHealthy) {
      plan.componentStates[id] = 'DEGRADED';
      plan.reasons[id] = 'Installed but reported unhealthy; safe degradation to direct source.';
      plan.degradations.push({ component: id, fallback: 'DIRECT_SOURCE', reason: 'COMPONENT_UNHEALTHY' });
      continue;
    }

    // 4. Component is physically INSTALLED and AVAILABLE on host.
    // If not selected, it remains AVAILABLE (never marked UNAVAILABLE when merely irrelevant).
    plan.componentStates[id] = 'AVAILABLE';

    // 5. Domain eligibility and selection
    switch (id) {
      case 'efficient-coding':
        if (isNonCoding) {
          plan.reasons[id] = 'Task is non-coding; implementation discipline suppressed to avoid redundant guidance.';
          plan.suppressedRedundancies.push({ component: id, reason: 'NON_CODING_TASK' });
        } else {
          plan.componentStates[id] = 'SELECTED';
          plan.selectedComponents.push(id);
          plan.reasons[id] = 'Primary authority for proportional implementation and quality-first discipline.';
        }
        break;

      case 'odoo-engineering':
        if (isOdooRelevant) {
          plan.componentStates[id] = 'SELECTED';
          plan.selectedComponents.push(id);
          plan.reasons[id] = 'Primary domain authority for Odoo models, ORM, views, and version release rules.';
        } else {
          plan.reasons[id] = 'Repository/task is non-Odoo; Odoo Engineering remains available but unselected.';
          plan.suppressedRedundancies.push({ component: id, reason: 'NON_ODOO_WORKSPACE' });
        }
        break;

      case 'afyx-engineering-expert':
        if (task.taskType === 'architecture' || task.taskType === 'multi-disciplinary' || task.taskType === 'system-design') {
          plan.componentStates[id] = 'SELECTED';
          plan.selectedComponents.push(id);
          plan.reasons[id] = 'Primary authority for multi-disciplinary architecture and workflow orchestration.';
        } else if (task.taskType === 'simple-fix') {
          plan.reasons[id] = 'Simple fix task; expert orchestration suppressed to prevent token waste and deep persona overhead.';
          plan.suppressedRedundancies.push({ component: id, reason: 'SIMPLE_FIX_DISCIPLINE' });
        } else {
          plan.reasons[id] = 'Available on host; activated on demand for ambiguous or system-level tasks.';
        }
        break;

      case 'afyx-graph':
        if (forceDirectSource) {
          plan.reasons[id] = 'User explicitly requested direct source; Graph invocation bypassed.';
        } else if (needsRelational || task.taskType === 'impact-analysis' || task.taskType === 'cross-asset') {
          plan.componentStates[id] = 'SELECTED';
          plan.selectedComponents.push(id);
          plan.reasons[id] = 'Authoritative provider of relational repository evidence and cross-asset dependencies.';
        } else {
          plan.reasons[id] = 'Direct source sufficient for task; Graph index invocation suppressed to save resources.';
          plan.suppressedRedundancies.push({ component: id, reason: 'EXACT_SOURCE_SUFFICIENT' });
        }
        break;

      case 'afyx-context':
        if (contextEnabled && contextNeeded) {
          plan.componentStates[id] = 'SELECTED';
          plan.selectedComponents.push(id);
          plan.reasons[id] = 'Installed Context Engine is enabled and the task warrants bounded optimization.';
        } else if (!contextEnabled) {
          plan.reasons[id] = 'Context Engine explicitly disabled by task or user preference.';
          plan.suppressedRedundancies.push({ component: id, reason: 'USER_CONTEXT_DISABLED' });
        } else {
          plan.reasons[id] = 'Context Engine available by default; no optimization needed for this task.';
          plan.suppressedRedundancies.push({ component: id, reason: 'CONTEXT_NOT_NEEDED' });
        }
        break;

      case 'codex-usage-tracking':
        plan.reasons[id] = 'Passive telemetry utility; available without task-level intervention.';
        break;

      default:
        break;
    }
  }

  // 6. Handle safe degradation for Graph when relational evidence is required but Graph is not selected
  if (needsRelational || task.taskType === 'impact-analysis') {
    if (forceDirectSource) {
      plan.degradations.push({
        component: 'afyx-graph',
        fallback: 'DIRECT_SOURCE',
        reason: 'BYPASSED_BY_USER',
      });
    } else if (!plan.selectedComponents.includes('afyx-graph')) {
      const graphInfo = installedComponents['afyx-graph'] || { installed: false, healthy: false };
      const reasonCode = !graphInfo.installed ? 'COMPONENT_ABSENT' : (!graphInfo.healthy ? 'COMPONENT_UNHEALTHY' : 'UNSUPPORTED_CAPABILITY');
      plan.degradations.push({
        component: 'afyx-graph',
        fallback: 'DIRECT_SOURCE',
        reason: reasonCode,
      });
    }
  }

  return Object.freeze(plan);
}

export {
  AFYX_MODULAR_RUNTIME_CONTRACT,
  ACCEPTED_PROVIDERS,
  DOMAIN_AUTHORITY_MATRIX,
  PROVIDER_CAPABILITY_SUPPORT,
  resolveModularRuntimeActivation,
} from './afyx-modular-runtime.mjs';

