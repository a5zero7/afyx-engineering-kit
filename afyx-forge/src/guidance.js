/**
 * Afyx Forge Core — Actionable Engineering Guidance Generator
 * Formulates investigation priorities, preferred/avoided tools,
 * validation scope, and explicit completion criteria for software engineers and AI agents.
 */

import { EXECUTION_MODES } from './policy.js';
import { TASK_CATEGORIES } from './classifier.js';

/**
 * Generates actionable engineering guidance based on classification and adaptive policy.
 *
 * @param {object} classification
 * @param {object} policy
 * @param {string} taskText
 * @returns {object} Structured guidance
 */
export function generateGuidance(classification, policy, taskText) {
  const { primaryCategory, frameworks = [], referencedFiles = [] } = classification;
  const { executionMode, graphRouting } = policy;

  const investigationPriorities = [];
  const preferredTools = [];
  const avoidedTools = [];
  const validationScope = [];
  const completionCriteria = [];

  // 1. Investigation Priorities
  if (executionMode === EXECUTION_MODES.DIRECT_MINIMAL) {
    investigationPriorities.push('1. Direct Inspection: Read the target file directly at the exact symbol location.');
    investigationPriorities.push('2. Focused Edit: Apply the minimal necessary change while preserving surrounding comments and structure.');
    investigationPriorities.push('3. Unit Verification: Execute the single affected unit test.');
  } else if (executionMode === EXECUTION_MODES.FOCUSED_INVESTIGATION) {
    investigationPriorities.push('1. Symptom Reproduction: Reproduce the observed defect or error trace before modifying code.');
    investigationPriorities.push('2. Root-Cause Isolation: Trace variable states and caller paths using focused search.');
    investigationPriorities.push('3. Hypothesize & Verify: Formulate the minimal correction and prove it resolves the symptom.');
  } else if (executionMode === EXECUTION_MODES.STRUCTURAL_GRAPH_AWARE) {
    investigationPriorities.push('1. Dependency Mapping: Inspect cross-module interfaces and call hierarchies.');
    if (graphRouting === 'RECOMMENDED') {
      investigationPriorities.push('2. Graph Impact Analysis: Query callers, callees, and affected test suites via Afyx Graph.');
    } else {
      investigationPriorities.push('2. Source Trace: Trace imports and usages across modules using ripgrep.');
    }
    investigationPriorities.push('3. Contract Preservation: Verify that existing API signatures remain backwards-compatible.');
    investigationPriorities.push('4. Integrated Validation: Run multi-component test suite.');
  } else if (executionMode === EXECUTION_MODES.SECURITY_DEFENSE_IN_DEPTH) {
    investigationPriorities.push('1. Security Boundary Audit: Identify trust boundaries, untrusted input paths, and privilege levels.');
    investigationPriorities.push('2. Defense-in-Depth Verification: Ensure strict validation, authorization checks, and fail-closed defaults.');
    investigationPriorities.push('3. Exploit/Regression Test: Write a negative test proving unauthorized requests are rejected.');
  } else if (executionMode === EXECUTION_MODES.DOMAIN_SPECIALIST) {
    if (frameworks.includes('Odoo')) {
      investigationPriorities.push('1. Odoo Release Schema: Determine target Odoo release (10-20) from evidence and follow ORM conventions.');
      investigationPriorities.push('2. Model & View Inheritance: Track `_inherit` hierarchy and XML view xpath selectors.');
      investigationPriorities.push('3. Security & ACL: Ensure ir.model.access.csv and record rules match model definitions.');
    } else {
      investigationPriorities.push('1. Domain Architecture Review: Consult domain-specific standards and data models.');
      investigationPriorities.push('2. Transactional Safety: Verify atomicity, rollback safety, and migration reversibility.');
    }
  }

  // 2. Tool Recommendations
  if (executionMode === EXECUTION_MODES.DIRECT_MINIMAL) {
    preferredTools.push('Direct source reading (read_file)');
    preferredTools.push('Focused search (rg / ripgrep)');
    preferredTools.push('Single test runner');
    avoidedTools.push('Afyx Graph indexing (unnecessary overhead for known file)');
    avoidedTools.push('Afyx Context Engine (keep default OFF)');
    avoidedTools.push('Speculative prompt rewriting or agent swarms');
  } else if (executionMode === EXECUTION_MODES.STRUCTURAL_GRAPH_AWARE) {
    if (graphRouting === 'RECOMMENDED') {
      preferredTools.push('Afyx Graph CLI/MCP (afyx_graph_explore, callers, impact)');
    }
    preferredTools.push('ripgrep (cross-file symbol search)');
    preferredTools.push('git diff (verifying boundary changes)');
    avoidedTools.push('Blind whole-repository search');
    avoidedTools.push('Afyx Context Engine (keep default OFF unless explicitly requested)');
  } else if (executionMode === EXECUTION_MODES.SECURITY_DEFENSE_IN_DEPTH) {
    preferredTools.push('Source code inspection and dataflow tracing');
    preferredTools.push('Negative unit/integration security tests');
    avoidedTools.push('Disabling security checks or mock-only bypasses');
    avoidedTools.push('Uncontrolled external package installations');
  } else {
    preferredTools.push('Direct source tools (read_file, edit_file)');
    preferredTools.push('Focused test execution');
    avoidedTools.push('Heavyweight indexing when localized tools suffice');
  }

  // 3. Validation Scope
  if (referencedFiles.length > 0) {
    for (const f of referencedFiles.slice(0, 3)) {
      validationScope.push(`Verify syntax and structure of ${f}`);
    }
  }
  validationScope.push('Run targeted unit and regression tests associated with the change.');
  if (frameworks.includes('Odoo')) {
    validationScope.push('Validate Odoo manifest syntax and dependency consistency.');
  }
  if (primaryCategory === TASK_CATEGORIES.SECURITY_SENSITIVE) {
    validationScope.push('Prove unauthorized access fails closed with proper rejection.');
  }

  // 4. Completion Criteria
  completionCriteria.push('All targeted unit and regression tests pass with exit code 0.');
  completionCriteria.push('Working tree is clean with no temporary files, debug logs, or unwanted artifacts committed.');
  completionCriteria.push('No regressions introduced into existing public contracts or interfaces.');
  if (primaryCategory === TASK_CATEGORIES.SECURITY_SENSITIVE) {
    completionCriteria.push('Security audit verified: no credentials exposed, no permissions bypassed.');
  }

  return {
    investigationPriorities,
    toolRecommendations: {
      preferred: preferredTools,
      avoided: avoidedTools,
    },
    validationScope,
    completionCriteria,
  };
}

