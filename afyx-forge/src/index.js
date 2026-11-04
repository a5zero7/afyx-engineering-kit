/**
 * Afyx Forge Core — Main Programmatic Entrypoint
 */

import fs from 'node:fs';
import path from 'node:path';
import { classifyTask } from './classifier.js';
import { deriveAdaptivePolicy } from './policy.js';
import { generateGuidance } from './guidance.js';
import { runDoctor } from './doctor.js';

export const FORGE_CORE_VERSION = '0.1.0';

/**
 * Creates an actionable engineering plan from a task description or task file.
 *
 * @param {object} options
 * @param {string} [options.taskText]
 * @param {string} [options.taskFile]
 * @param {string} [options.format='json'] 'json' | 'markdown'
 * @param {object} [options.environment]
 * @returns {object|string} The plan according to the requested format
 */
export function createForgePlan(options = {}) {
  let content = options.taskText || '';
  let taskTitle = 'Engineering Task';

  if (options.taskFile) {
    const resolvedPath = path.resolve(options.taskFile);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Task file not found: ${resolvedPath}`);
    }
    content = fs.readFileSync(resolvedPath, 'utf8');
    taskTitle = path.basename(resolvedPath);
  }

  if (!content.trim()) {
    throw new Error('Task content cannot be empty. Provide taskText or a valid taskFile.');
  }

  // Extract a brief title from the first non-empty line
  const firstLine = content.trim().split(/\r?\n/)[0].replace(/^[#\s\-_*]+/, '').trim();
  if (firstLine && firstLine.length < 80) {
    taskTitle = firstLine;
  }

  // Diagnostics check if environment not supplied
  const doc = runDoctor();
  const env = {
    hasGraph: doc.afyxComponents.afyxGraph === 'HEALTHY',
    hasContext: doc.afyxComponents.afyxContext.startsWith('HEALTHY'),
    contextOptIn: process.env.AFYX_CONTEXT_OPT_IN !== '0',
    ...options.environment,
  };

  const classification = classifyTask(content);

  // If safety check fails, return refused plan
  if (classification.status === 'REFUSED_UNSAFE') {
    const refusedResult = {
      contract: 'afyx-forge-plan/v1',
      version: FORGE_CORE_VERSION,
      timestamp: new Date().toISOString(),
      taskSummary: {
        title: taskTitle,
        observedComplexity: classification.observedComplexity,
        domainContext: 'Security / Safety Boundary Violation',
        relevantFiles: classification.referencedFiles,
      },
      classification: {
        primaryCategory: classification.primaryCategory,
        riskLevel: classification.riskLevel,
        frameworks: classification.frameworks,
        confidence: classification.confidence,
      },
      adaptivePolicy: {
        executionMode: 'SECURITY_DEFENSE_IN_DEPTH',
        graphRouting: 'BYPASS',
        graphRoutingReason: 'Task refused due to unsafe directive; no tooling invoked.',
        contextEngine: 'BYPASS_TASK_REFUSED',
        expertEngagement: 'Refusal Enforced',
      },
      guidance: {
        investigationPriorities: ['Halt execution immediately: request contains unsafe or destructive actions.'],
        toolRecommendations: { preferred: [], avoided: ['All autonomous execution'] },
        validationScope: ['Verify user intent and obtain explicit owner authorization.'],
        completionCriteria: ['Refusal report delivered to user.'],
      },
      boundedExecution: {
        autonomousCodeExecution: false,
        uncontrolledModelInvocation: false,
        privilegeElevationAllowed: false,
        governanceGateA8: 'EVALUATION_GATED (0/36 NOT_RUN)',
      },
      status: 'REFUSED_UNSAFE',
      refusalReason: classification.refusalReason,
    };

    if (options.format === 'markdown') {
      return formatPlanAsMarkdown(refusedResult);
    }
    return refusedResult;
  }

  const policy = deriveAdaptivePolicy(classification, env);
  const guidance = generateGuidance(classification, policy, content);

  const planResult = {
    contract: 'afyx-forge-plan/v1',
    version: FORGE_CORE_VERSION,
    timestamp: new Date().toISOString(),
    taskSummary: {
      title: taskTitle,
      observedComplexity: classification.observedComplexity,
      domainContext: classification.frameworks.length ? classification.frameworks.join(', ') : 'Standard Software Engineering',
      relevantFiles: classification.referencedFiles,
    },
    classification: {
      primaryCategory: classification.primaryCategory,
      riskLevel: classification.riskLevel,
      frameworks: classification.frameworks,
      confidence: classification.confidence,
    },
    adaptivePolicy: {
      executionMode: policy.executionMode,
      graphRouting: policy.graphRouting,
      graphRoutingReason: policy.graphRoutingReason,
      contextEngine: policy.contextEngine,
      expertEngagement: policy.expertEngagement,
    },
    guidance: {
      investigationPriorities: guidance.investigationPriorities,
      toolRecommendations: guidance.toolRecommendations,
      validationScope: guidance.validationScope,
      completionCriteria: guidance.completionCriteria,
    },
    boundedExecution: {
      autonomousCodeExecution: false,
      uncontrolledModelInvocation: false,
      privilegeElevationAllowed: false,
      governanceGateA8: 'EVALUATION_GATED (0/36 NOT_RUN)',
    },
    status: 'PLANNED',
  };

  if (options.format === 'markdown') {
    return formatPlanAsMarkdown(planResult);
  }
  return planResult;
}

/**
 * Formats a structured plan object into human-readable GitHub-flavored markdown.
 * @param {object} plan
 * @returns {string} Markdown representation
 */
export function formatPlanAsMarkdown(plan) {
  const isRefused = plan.status === 'REFUSED_UNSAFE';

  let md = `# Afyx Forge Engineering Plan: ${plan.taskSummary.title}\n\n`;
  md += `**Contract:** \`${plan.contract}\` | **Version:** \`${plan.version}\` | **Status:** **${plan.status}**\n\n`;

  if (isRefused) {
    md += `> [!CAUTION]\n`;
    md += `> **Execution Refused:** ${plan.refusalReason}\n`;
    md += `> Forge Core enforces bounded execution: destructive operations, credential leakage, and unauthorized push/commit actions are strictly prohibited.\n\n`;
    return md;
  }

  md += `## 1. Task Assessment\n`;
  md += `- **Primary Category:** \`${plan.classification.primaryCategory}\`\n`;
  md += `- **Risk Level:** **${plan.classification.riskLevel}**\n`;
  md += `- **Observed Complexity:** ${plan.taskSummary.observedComplexity}\n`;
  md += `- **Domain / Frameworks:** ${plan.taskSummary.domainContext}\n`;
  if (plan.taskSummary.relevantFiles.length > 0) {
    md += `- **Referenced Files:** ${plan.taskSummary.relevantFiles.map((f) => `\`${f}\``).join(', ')}\n`;
  }
  md += `\n`;

  md += `## 2. Adaptive Engineering Policy\n`;
  md += `- **Execution Mode:** \`${plan.adaptivePolicy.executionMode}\`\n`;
  md += `- **Afyx Graph Routing:** \`${plan.adaptivePolicy.graphRouting}\`\n`;
  md += `  - *Reason:* ${plan.adaptivePolicy.graphRoutingReason}\n`;
  md += `- **Context Engine:** \`${plan.adaptivePolicy.contextEngine}\` (available by default when installed; execution remains on demand)\n`;
  md += `- **Specialist Guidance:** ${plan.adaptivePolicy.expertEngagement}\n\n`;

  md += `## 3. Actionable Engineering Guidance\n\n`;
  md += `### Investigation Priorities\n`;
  for (const step of plan.guidance.investigationPriorities) {
    md += `- ${step}\n`;
  }
  md += `\n`;

  md += `### Tool Recommendations\n`;
  md += `**Preferred Tools:**\n`;
  for (const tool of plan.guidance.toolRecommendations.preferred) {
    md += `- :white_check_mark: ${tool}\n`;
  }
  md += `\n**Avoided Tools (Lowest-cost discipline):**\n`;
  for (const tool of plan.guidance.toolRecommendations.avoided) {
    md += `- :x: ${tool}\n`;
  }
  md += `\n`;

  md += `### Validation Scope\n`;
  for (const item of plan.guidance.validationScope) {
    md += `- [ ] ${item}\n`;
  }
  md += `\n`;

  md += `### Explicit Completion Criteria\n`;
  for (const item of plan.guidance.completionCriteria) {
    md += `- [ ] ${item}\n`;
  }
  md += `\n`;

  md += `## 4. Governance & Trust Boundary\n`;
  md += `- **Autonomous Code Execution:** \`${plan.boundedExecution.autonomousCodeExecution}\`\n`;
  md += `- **Uncontrolled Model Invocation:** \`${plan.boundedExecution.uncontrolledModelInvocation}\`\n`;
  md += `- **Campaign Governance:** \`${plan.boundedExecution.governanceGateA8}\`\n`;

  return md;
}

export { runDoctor } from './doctor.js';

