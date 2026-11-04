#!/usr/bin/env node
/**
 * Afyx Modular Runtime Integration & Intelligent Capability Activation (v1)
 *
 * Governing Principle:
 * "Standalone by Design, Integrated by Contract, Activated by Need."
 *
 * Connects the accepted deterministic capability-planning foundation (K01)
 * to live Afyx engineering and provider integration surfaces.
 *
 * Explicit 5-layer separation:
 * 1. Deterministic capability planning (resolveModularCapabilityPlan)
 * 2. Capability eligibility and single domain authority
 * 3. Runtime readiness and authorization checks
 * 4. Provider-mediated capability preparation and surface mapping
 * 5. Bounded, sanitized runtime observability and execution prep
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AFYX_MODULAR_INTEGRATION_CONTRACT,
  PRODUCT_INVENTORY,
  resolveModularCapabilityPlan,
} from './afyx-modular-integration.mjs';

import {
  resolveAfyxToolFamilyRoute,
} from './afyx-tool-family-routing.mjs';

export const AFYX_MODULAR_RUNTIME_CONTRACT = 'AfyxModularRuntimeActivation/v1';

// Load accepted providers directly from the authoritative component registry
const REGISTRY = JSON.parse(readFileSync(new URL('./components.json', import.meta.url), 'utf8'));
export const ACCEPTED_PROVIDERS = Object.freeze(REGISTRY.providers.map((p) => p.provider));

/**
 * Domain authorities map: exactly one primary authority per capability domain.
 */
export const DOMAIN_AUTHORITY_MATRIX = Object.freeze({
  'odoo-framework-authority': {
    primaryOwner: 'odoo-engineering',
    description: 'Odoo models, ORM, views, release compatibility, and security rules.',
  },
  'focused-coding-discipline': {
    primaryOwner: 'efficient-coding',
    description: 'Proportional implementation, quality-first workflow, and scoped changes.',
  },
  'cross-disciplinary-expertise': {
    primaryOwner: 'afyx-engineering-expert',
    description: 'Multi-disciplinary architecture, system-level trade-offs, and workflow selection.',
  },
  'repository-graph-evidence': {
    primaryOwner: 'afyx-graph',
    description: 'Relational repository structure, dependency graph, and cross-asset impact.',
  },
  'bounded-context-optimization': {
    primaryOwner: 'afyx-context',
    description: 'Bounded context optimization, exact recovery, and fallback token conservation.',
  },
  'codex-usage-telemetry': {
    primaryOwner: 'codex-usage-tracking',
    description: 'Codex-specific session telemetry and local event observation.',
  },
  'adaptive-engineering-policy': {
    primaryOwner: 'afyx-forge',
    description: 'Adaptive engineering execution policy (Gated pending formal A8 acceptance).',
  },
});

/**
 * Capabilities supported by provider surfaces.
 */
export const PROVIDER_CAPABILITY_SUPPORT = Object.freeze({
  codex: Object.freeze({
    supportedCapabilities: Object.freeze([
      'repository-graph-evidence',
      'bounded-context-optimization',
      'cross-disciplinary-expertise',
      'odoo-framework-authority',
      'focused-coding-discipline',
      'codex-usage-telemetry',
    ]),
    surfaces: Object.freeze({
      'afyx-graph': { surface: 'mcp', serverName: 'afyx_graph' },
      'afyx-context': { surface: 'cli', wrapper: 'afyx-context' },
      'afyx-engineering-expert': { surface: 'instructions', reference: 'skills/afyx-engineering-expert' },
      'odoo-engineering': { surface: 'instructions', reference: 'skills/odoo-engineering' },
      'efficient-coding': { surface: 'instructions', reference: 'skills/efficient-coding' },
      'codex-usage-tracking': { surface: 'telemetry', command: 'afyx-codex-tracker' },
    }),
  }),
  antigravity: Object.freeze({
    supportedCapabilities: Object.freeze([
      'repository-graph-evidence',
      'bounded-context-optimization',
      'cross-disciplinary-expertise',
      'odoo-framework-authority',
      'focused-coding-discipline',
    ]),
    surfaces: Object.freeze({
      'afyx-graph': { surface: 'mcp', serverName: 'afyx_graph' },
      'afyx-context': { surface: 'instructions', reference: 'skills/afyx-context' },
      'afyx-engineering-expert': { surface: 'skills', skillName: 'afyx-engineering-expert' },
      'odoo-engineering': { surface: 'skills', skillName: 'odoo-engineering' },
      'efficient-coding': { surface: 'skills', skillName: 'efficient-coding' },
    }),
  }),
  claude: Object.freeze({
    supportedCapabilities: Object.freeze([
      'repository-graph-evidence',
      'bounded-context-optimization',
      'cross-disciplinary-expertise',
      'odoo-framework-authority',
      'focused-coding-discipline',
    ]),
    surfaces: Object.freeze({
      'afyx-graph': { surface: 'mcp', serverName: 'afyx_graph' },
      'afyx-context': { surface: 'instructions', reference: 'CLAUDE.md' },
      'afyx-engineering-expert': { surface: 'skills', skillName: 'afyx-engineering-expert' },
      'odoo-engineering': { surface: 'skills', skillName: 'odoo-engineering' },
      'efficient-coding': { surface: 'skills', skillName: 'efficient-coding' },
    }),
  }),
});

/**
 * Resolves modular runtime capability preparation, enforcing host authorizations,
 * provider mediation, and non-redundant capability execution.
 *
 * @param {Object} options
 * @param {Object} options.task - Engineering task specification
 * @param {string} [options.provider] - Target provider: 'codex', 'antigravity', 'claude', or null/omitted
 * @param {Object} [options.installedComponents] - Installed component states
 * @param {Object} [options.userPreferences] - Explicit user preferences / overrides
 * @param {Object} [options.hostAuthorizations] - Host authorization parameters
 * @param {Array}  [options.toolCandidates] - Optional tool candidates for tool family routing
 * @returns {Object} Runtime activation plan
 */
export function resolveModularRuntimeActivation(options = {}) {
  const {
    task = {},
    provider = null,
    installedComponents = {},
    userPreferences = {},
    hostAuthorizations = {},
    toolCandidates = null,
  } = options;

  const taskId = task.id || `task-${Date.now()}`;
  const targetProvider = typeof provider === 'string' ? provider.toLowerCase() : null;

  // 1. Layer 1 & 2: Deterministic capability planning
  const deterministicPlan = resolveModularCapabilityPlan(task, installedComponents, userPreferences);

  // 2. Layer 3: Runtime readiness & authorization checks
  const diagnostics = [];
  const degradations = [...deterministicPlan.degradations];
  const suppressedRedundancies = [...deterministicPlan.suppressedRedundancies];
  const preparedCapabilities = [];
  const domainAuthorities = {};
  let runtimeStatus = 'READY';

  // Unknown Provider Check: Fail closed immediately
  if (targetProvider !== null && !ACCEPTED_PROVIDERS.includes(targetProvider)) {
    runtimeStatus = 'BLOCKED';
    diagnostics.push({
      code: 'UNKNOWN_PROVIDER_REFUSED',
      severity: 'ERROR',
      message: `Target provider '${targetProvider}' is unknown. Supported providers: ${ACCEPTED_PROVIDERS.join(', ')}. Failed closed without mutation or execution.`,
    });
  }

  // Forge production gating enforcement (A8)
  const isForgeRequested = task.taskType === 'forge-evaluation' ||
    task.requestedComponent === 'afyx-forge' ||
    (typeof task.intent === 'string' && /\bafyx-forge\b/i.test(task.intent));

  if (isForgeRequested) {
    runtimeStatus = 'BLOCKED';
    diagnostics.push({
      code: 'FORGE_GATED_PENDING_A8',
      severity: 'ERROR',
      message: 'Afyx Forge runtime activation is strictly blocked pending formal A8 acceptance gate.',
    });
  }

  // Host MCP / CLI bypass safeguard:
  // "Disabled MCP never implies permission to call an external CLI or wrapper."
  const mcpExplicitlyDisabled = hostAuthorizations.mcpEnabled === false;
  const attemptedCliBypass = Boolean(hostAuthorizations.attemptedCliBypass);
  const cliBypassAllowed = Boolean(hostAuthorizations.cliBypassAllowed);

  if (mcpExplicitlyDisabled && attemptedCliBypass && !cliBypassAllowed) {
    diagnostics.push({
      code: 'CLI_BYPASS_REFUSED',
      severity: 'ERROR',
      message: 'Disabled MCP never implies permission to call an external CLI or wrapper without independent authorization.',
    });
    runtimeStatus = 'BLOCKED';
  }

  // Automatic background indexing & freshness safeguard:
  // Missing evidence is treated as UNKNOWN, never implicitly ready.
  // Never automatically trigger background reindexing or daemonic builds.
  if (deterministicPlan.selectedComponents.includes('afyx-graph')) {
    const graphInstalled = installedComponents['afyx-graph'];
    const isFresh = graphInstalled?.indexFresh === true;
    const isReady = graphInstalled?.indexReady === true;
    const isFreshnessUnknown = graphInstalled?.indexFresh === undefined || graphInstalled?.indexReady === undefined;

    if (!isReady || !isFresh || isFreshnessUnknown) {
      if (hostAuthorizations.allowAutomaticIndexing) {
        // Only if caller explicitly authorized indexing
        diagnostics.push({
          code: 'GRAPH_INDEXING_AUTHORIZED',
          severity: 'INFO',
          message: 'Caller explicitly authorized repository indexing.',
        });
      } else {
        const reasonCode = isFreshnessUnknown ? 'INDEX_FRESHNESS_UNKNOWN' : 'INDEX_NOT_READY_OR_STALE';
        degradations.push({
          component: 'afyx-graph',
          fallback: 'DIRECT_SOURCE',
          reason: reasonCode,
        });
        diagnostics.push({
          code: isFreshnessUnknown ? 'GRAPH_FRESHNESS_UNKNOWN' : 'AUTOMATIC_INDEXING_REFUSED',
          severity: 'WARNING',
          message: isFreshnessUnknown
            ? 'Graph repository index readiness/freshness evidence is missing or unverified; treated as UNKNOWN. Automatic background indexing refused; falling back to direct source.'
            : 'Graph repository index not ready or stale; automatic background reindexing refused. Falling back to direct source.',
        });
      }
    }
  }

  // 3. Layer 4: Provider-mediated capability preparation & surface mapping
  const providerMeta = targetProvider ? PROVIDER_CAPABILITY_SUPPORT[targetProvider] : null;

  // Only prepare capabilities if provider is valid
  if (runtimeStatus !== 'BLOCKED') {
    for (const componentId of deterministicPlan.selectedComponents) {
      // If component degraded (e.g. Graph due to stale/unknown index), do not prepare for invocation
      const isDegraded = degradations.some((d) => d.component === componentId);
      if (isDegraded) continue;

      const compInfo = PRODUCT_INVENTORY[componentId];
      if (!compInfo) continue;

      const primaryCap = compInfo.primaryCapability;
      const authority = DOMAIN_AUTHORITY_MATRIX[primaryCap];

      if (authority) {
        domainAuthorities[primaryCap] = authority.primaryOwner;
      }

      // Check provider capability support
      if (providerMeta) {
        const isSupported = providerMeta.supportedCapabilities.includes(primaryCap);
        if (!isSupported) {
          degradations.push({
            component: componentId,
            fallback: 'UNSUPPORTED_ON_PROVIDER',
            reason: `Component ${componentId} capability ${primaryCap} is not supported on provider ${targetProvider}.`,
          });
          diagnostics.push({
            code: 'CAPABILITY_UNSUPPORTED_ON_PROVIDER',
            severity: 'WARNING',
            message: `Provider '${targetProvider}' does not support '${primaryCap}'. Graceful degradation applied.`,
          });
          continue;
        }

        const surfaceMapping = providerMeta.surfaces[componentId];
        preparedCapabilities.push({
          componentId,
          capability: primaryCap,
          provider: targetProvider,
          surface: surfaceMapping?.surface || 'generic',
          surfaceDetails: surfaceMapping || {},
          ownership: compInfo.ownershipClass,
          lifecycleState: 'PREPARED', // Explicit lifecycle: prepared for session, not claimed live executed
          executionStatus: 'NOT_RUN',
          observationSource: hostAuthorizations.trustedInspection ? 'HOST_INSPECTED' : 'CALLER_DECLARED',
        });
      } else {
        // Provider-neutral preparation
        preparedCapabilities.push({
          componentId,
          capability: primaryCap,
          provider: 'neutral',
          surface: compInfo.type === 'runtime' ? 'mcp' : 'skills',
          surfaceDetails: { type: compInfo.type },
          ownership: compInfo.ownershipClass,
          lifecycleState: 'PREPARED',
          executionStatus: 'NOT_RUN',
          observationSource: hostAuthorizations.trustedInspection ? 'HOST_INSPECTED' : 'CALLER_DECLARED',
        });
      }
    }
  }

  // 4. Tool Family Routing (Optional caller-provided candidates)
  let toolFamilyRoute = null;
  if (Array.isArray(toolCandidates) && toolCandidates.length > 0) {
    const routeConfig = {
      intent: task.intent === 'exact-source' || userPreferences.forceDirectSource ? 'exact-source' : 'capability',
      capability: task.requiredToolCapability || 'repository-graph-evidence',
      candidates: toolCandidates,
      allowExternalFallback: Boolean(userPreferences.allowExternalFallback),
    };
    try {
      toolFamilyRoute = resolveAfyxToolFamilyRoute(routeConfig);
    } catch (routeError) {
      diagnostics.push({
        code: 'TOOL_FAMILY_ROUTING_ERROR',
        severity: 'WARNING',
        message: routeError instanceof Error ? routeError.message : String(routeError),
      });
    }
  }

  // 5. Final Status Calculation
  if (runtimeStatus !== 'BLOCKED') {
    runtimeStatus = degradations.length > 0 ? 'DEGRADED' : 'READY';
  }

  // 6. Layer 5: Bounded, Sanitized Runtime Telemetry
  const telemetry = {
    taskId,
    provider: targetProvider || 'neutral',
    plannedCapabilitiesCount: deterministicPlan.selectedComponents.length,
    preparedCapabilitiesCount: preparedCapabilities.length,
    activatedCapabilitiesCount: preparedCapabilities.length, // Retained for compatibility
    suppressedInvocationsCount: suppressedRedundancies.length,
    degradationsCount: degradations.length,
    claimVerification: 'No speculative token savings claimed without measured provider counters.',
    liveExecutionEvidence: false,
    actualTokenSavingsClaimed: false,
  };

  return Object.freeze({
    contract: AFYX_MODULAR_RUNTIME_CONTRACT,
    taskId,
    provider: targetProvider,
    status: runtimeStatus,
    executionStatus: 'NOT_RUN', // Distinguishes prepared activation plan from actual model invocation
    actualExecutionClaimed: false,
    governingPrinciple: deterministicPlan.governingPrinciple,
    plannedComponents: deterministicPlan.selectedComponents,
    preparedCapabilities: Object.freeze(preparedCapabilities),
    activatedCapabilities: Object.freeze(preparedCapabilities), // Backward-compatible alias with explicit PREPARED state
    domainAuthorities: Object.freeze(domainAuthorities),
    componentStates: deterministicPlan.componentStates,
    suppressedRedundancies: Object.freeze(suppressedRedundancies),
    degradations: Object.freeze(degradations),
    diagnostics: Object.freeze(diagnostics),
    toolFamilyRoute,
    telemetry: Object.freeze(telemetry),
  });
}

// -----------------------------------------------------------------------------
// CLI Runner Entrypoint
// -----------------------------------------------------------------------------

function parseArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function parseJsonArg(flag, fallback = null) {
  const val = parseArg(flag);
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    try {
      // Handle Windows shell escaped quotes (e.g. {\"key\":\"val\"})
      const cleaned = val.replace(/\\"/g, '"');
      return JSON.parse(cleaned);
    } catch {
      return fallback;
    }
  }
}

function parseJsonFileOrArg(jsonFlag, fileFlag, fallback = null) {
  const fileVal = parseArg(fileFlag);
  if (fileVal && existsSync(fileVal)) {
    try {
      return JSON.parse(readFileSync(fileVal, 'utf8'));
    } catch (e) {
      console.error(`[afyx-modular-runtime] Failed to read ${fileFlag}: ${e.message}`);
    }
  }
  return parseJsonArg(jsonFlag, fallback);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const task = parseJsonFileOrArg('--task-json', '--task-file', {}) || {};
  const provider = parseArg('--provider', 'codex');
  const installedComponents = parseJsonFileOrArg('--installed-json', '--installed-file', {}) || {};
  const userPreferences = parseJsonFileOrArg('--user-prefs-json', '--user-prefs-file', {}) || {};
  const hostAuthorizations = parseJsonFileOrArg('--host-auth-json', '--host-auth-file', {}) || {};
  const toolCandidates = parseJsonFileOrArg('--tool-candidates-json', '--tool-candidates-file', null);

  const activation = resolveModularRuntimeActivation({
    task,
    provider,
    installedComponents,
    userPreferences,
    hostAuthorizations,
    toolCandidates,
  });

  console.log(JSON.stringify(activation, null, 2));

  if (activation.status === 'BLOCKED') {
    process.exit(2);
  } else {
    process.exit(0);
  }
}
