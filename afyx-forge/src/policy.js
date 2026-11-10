/**
 * Afyx Forge Core — Adaptive Engineering Policy Engine
 * Determines proportional execution mode, Graph-aware routing,
 * and component cooperation according to Afyx Adaptive Tool Routing principles.
 */

import { TASK_CATEGORIES, RISK_LEVELS } from './classifier.js';

export const EXECUTION_MODES = Object.freeze({
  DIRECT_MINIMAL: 'DIRECT_MINIMAL',
  FOCUSED_INVESTIGATION: 'FOCUSED_INVESTIGATION',
  STRUCTURAL_GRAPH_AWARE: 'STRUCTURAL_GRAPH_AWARE',
  DOMAIN_SPECIALIST: 'DOMAIN_SPECIALIST',
  SECURITY_DEFENSE_IN_DEPTH: 'SECURITY_DEFENSE_IN_DEPTH',
});

/**
 * Derives the proportional adaptive policy from task classification and environment context.
 *
 * @param {object} classification
 * @param {object} [environment={}]
 * @param {boolean} [environment.hasGraph=false]
 * @param {boolean} [environment.hasContext=false]
 * @param {boolean} [environment.contextOptIn=true] - Explicit false disables the installed Context Engine
 * @returns {object} Adaptive policy object
 */
export function deriveAdaptivePolicy(classification, environment = {}) {
  const { primaryCategory, riskLevel, frameworks = [], referencedFiles = [] } = classification;
  const { hasGraph = false, hasContext = false, contextOptIn = true,
    graphOptIn = true, expertOptIn = true, providerSupported = true } = environment;

  // 1. Determine Execution Mode
  let executionMode = EXECUTION_MODES.DIRECT_MINIMAL;
  if (primaryCategory === TASK_CATEGORIES.SECURITY_SENSITIVE || riskLevel === RISK_LEVELS.CRITICAL) {
    executionMode = EXECUTION_MODES.SECURITY_DEFENSE_IN_DEPTH;
  } else if (frameworks.includes('Odoo') || primaryCategory === TASK_CATEGORIES.DATA_RELIABILITY) {
    executionMode = EXECUTION_MODES.DOMAIN_SPECIALIST;
  } else if (primaryCategory === TASK_CATEGORIES.CROSS_MODULE_CHANGE) {
    executionMode = EXECUTION_MODES.STRUCTURAL_GRAPH_AWARE;
  } else if (primaryCategory === TASK_CATEGORIES.UNKNOWN_DEFECT_DIAGNOSIS) {
    executionMode = EXECUTION_MODES.FOCUSED_INVESTIGATION;
  } else {
    executionMode = EXECUTION_MODES.DIRECT_MINIMAL;
  }

  // 2. Graph-Aware Routing (Afyx Adaptive Routing Rule)
  // Principle: Lowest-cost reliable evidence. Avoid Graph for known-file, simple edit, config lookup.
  // Prefer Graph ONLY when cross-file relationships, inheritance, or multi-module impact materially help.
  let graphRouting = 'BYPASS';
  let graphRoutingReason = 'Direct-source reading, ripgrep, or targeted tests are sufficient; Graph is bypassed for minimal cost.';

  const isCrossModuleOrInheritance =
    primaryCategory === TASK_CATEGORIES.CROSS_MODULE_CHANGE ||
    (frameworks.includes('Odoo') && referencedFiles.length > 1) ||
    referencedFiles.length >= 3;

  if (isCrossModuleOrInheritance) {
    if (providerSupported === false) {
      graphRouting = 'BYPASS_PROVIDER_UNSUPPORTED';
      graphRoutingReason = 'The selected provider does not support the required Afyx Graph surface.';
    } else if (graphOptIn === false) {
      graphRouting = 'BYPASS_USER_DISABLED';
      graphRoutingReason = 'Afyx Graph explicitly disabled by the user.';
    } else if (hasGraph) {
      graphRouting = 'RECOMMENDED';
      graphRoutingReason = 'Cross-module relationships or framework inheritance identified; Afyx Graph exploration recommended.';
    } else {
      graphRouting = 'NOT_AVAILABLE';
      graphRoutingReason = 'Cross-module analysis identified, but Afyx Graph is not installed; falling back to direct-source reading.';
    }
  }

  // 3. Context Engine Cooperation
  // Available by default when installed and healthy. This is a planning status,
  // not evidence that a Context operation was executed for this task.
  let contextEngine = 'NOT_AVAILABLE';
  if (contextOptIn === false) contextEngine = 'BYPASS_USER_DISABLED';
  else if (providerSupported === false) contextEngine = 'BYPASS_PROVIDER_UNSUPPORTED';
  else if (hasContext) contextEngine = 'ACTIVE';

  // 4. Expert Cooperation
  let expertEngagement = 'NONE';
  if (frameworks.includes('Odoo')) {
    expertEngagement = 'Odoo Engineering Skill (Version-aware schema & ORM guidance)';
  } else if (primaryCategory === TASK_CATEGORIES.SECURITY_SENSITIVE) {
    expertEngagement = 'Afyx Engineering Expert: Cybersecurity / DevSecOps role';
  } else if (primaryCategory === TASK_CATEGORIES.DATA_RELIABILITY) {
    expertEngagement = 'Afyx Engineering Expert: Database Administrator role';
  } else if (executionMode === EXECUTION_MODES.STRUCTURAL_GRAPH_AWARE) {
    expertEngagement = 'Afyx Engineering Expert: Solutions Architect role';
  }

  if (expertOptIn === false) expertEngagement = 'BYPASS_USER_DISABLED';
  else if (providerSupported === false) expertEngagement = 'BYPASS_PROVIDER_UNSUPPORTED';
  const executionDirective = executionMode === EXECUTION_MODES.DIRECT_MINIMAL
    ? (primaryCategory === TASK_CATEGORIES.KNOWN_FILE_BUG ? 'SURGICAL_KNOWN_FILE' : 'DIRECT_SIMPLE')
    : executionMode === EXECUTION_MODES.FOCUSED_INVESTIGATION ? 'FOCUSED_DIAGNOSIS'
      : executionMode === EXECUTION_MODES.STRUCTURAL_GRAPH_AWARE ? 'CROSS_FILE'
        : executionMode === EXECUTION_MODES.DOMAIN_SPECIALIST ? 'DOMAIN_AWARE' : 'HIGH_RISK';
  return {
    executionMode,
    executionDirective,
    graphRouting,
    graphRoutingReason,
    contextEngine,
    expertEngagement,
  };
}

