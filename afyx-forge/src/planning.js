/** Bounded, deterministic planning facts. No source edit or tool execution occurs here. */

const MAX_ITEMS = 12;
const MAX_LINE = 300;
const SECTIONS = new Map([
  ['objective', 'objective'], ['goal', 'objective'],
  ['requirements', 'functionalRequirements'], ['functional requirements', 'functionalRequirements'],
  ['constraints', 'constraints'], ['dependencies', 'dependencies'],
  ['acceptance', 'acceptanceCriteria'], ['acceptance criteria', 'acceptanceCriteria'],
  ['assumptions', 'assumptions'], ['unknowns', 'unknownAssumptions'],
  ['scope', 'scopeBoundaries'], ['out of scope', 'scopeBoundaries'],
]);

function addUnique(items, value) {
  const item = value.replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '').trim().slice(0, MAX_LINE);
  if (item && items.length < MAX_ITEMS && !items.includes(item)) items.push(item);
}

/** Extract only statements actually present in the request. */
export function extractRequirementIntelligence(taskText, classification) {
  const facts = {
    objective: '', functionalRequirements: [], affectedFiles: [...classification.referencedFiles],
    affectedComponents: [], constraints: [], dependencies: [], assumptions: [], unknownAssumptions: [],
    acceptanceCriteria: [], scopeBoundaries: [], riskLevel: classification.riskLevel,
    evidenceStatus: 'REQUEST_TEXT_ONLY',
  };
  for (const component of ['Afyx Graph', 'Afyx Context', 'Afyx Forge', 'Afyx Engineering Expert', 'Odoo Engineering']) {
    if (taskText.toLowerCase().includes(component.toLowerCase())) facts.affectedComponents.push(component);
  }
  let section = '';
  for (const raw of taskText.split(/\r?\n/).slice(0, 500)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^(?:#{1,4}\s*)?(objective|goal|functional requirements?|requirements?|constraints?|dependencies?|acceptance criteria|acceptance|assumptions?|unknowns?|out of scope|scope)\s*:?(?:\s+(.+))?$/i.exec(line);
    if (heading) {
      const name = heading[1].toLowerCase();
      section = SECTIONS.get(name) ?? SECTIONS.get(`${name}s`) ?? '';
      if (heading[2]) {
        if (section === 'objective') facts.objective = heading[2].slice(0, MAX_LINE);
        else if (section) addUnique(facts[section], heading[2]);
      }
      continue;
    }
    if (line.startsWith('#')) { section = ''; continue; }
    if (section === 'objective' && !facts.objective) facts.objective = line.slice(0, MAX_LINE);
    else if (section && section !== 'objective') addUnique(facts[section], line);
    else if (!facts.objective && !line.startsWith('#')) facts.objective = line.slice(0, MAX_LINE);
    if (!section && /^(?:acceptance|expected)\s*:/i.test(line)) {
      addUnique(facts.acceptanceCriteria, line.replace(/^[^:]+:\s*/, ''));
    }
    if (!section && /^(?:depends on|requires)\b/i.test(line)) addUnique(facts.dependencies, line);
    if (/\b(?:must not|do not|never|without)\b/i.test(line)) addUnique(facts.constraints, line);
  }
  return facts;
}

const BUDGETS = Object.freeze({
  DIRECT_MINIMAL: [1, 6, 1, 120_000, 'focused'],
  FOCUSED_INVESTIGATION: [2, 14, 2, 300_000, 'focused-plus-regression'],
  STRUCTURAL_GRAPH_AWARE: [3, 22, 2, 600_000, 'affected-components'],
  DOMAIN_SPECIALIST: [3, 22, 2, 600_000, 'domain-contracts'],
  SECURITY_DEFENSE_IN_DEPTH: [4, 28, 1, 900_000, 'positive-negative-regression'],
});

/** Recommendations are ceilings for a proposed plan, not observed usage. */
export function recommendExecutionBudget(policy) {
  const [investigationDepth, toolCallCeiling, retryCeiling, elapsedTimeCeilingMs, validationIntensity] =
    BUDGETS[policy.executionMode] ?? BUDGETS.FOCUSED_INVESTIGATION;
  return {
    status: 'RECOMMENDED_NOT_ENFORCED', investigationDepth, toolCallCeiling,
    retryCeiling, elapsedTimeCeilingMs, validationIntensity,
    contextGuideline: 'Read only relevant source; use Context for genuinely large output when enabled.',
    observedToolCalls: null, observedProviderTokens: null,
    escalation: policy.executionMode === 'SECURITY_DEFENSE_IN_DEPTH'
      ? 'Stop at an authorization or integrity boundary; require owner decision.'
      : 'Stop when evidence is insufficient or the retry ceiling is reached.',
  };
}

/** Four ordered, minimal phases; each item is explicitly a proposal. */
export function buildExecutionPlan(requirements, classification, policy) {
  const target = requirements.affectedFiles.length
    ? ` in ${requirements.affectedFiles.slice(0, 3).join(', ')}` : ' in the smallest verified scope';
  const investigation = policy.executionMode === 'DIRECT_MINIMAL'
    ? `Inspect the named source${target} and its nearest test.`
    : policy.executionMode === 'SECURITY_DEFENSE_IN_DEPTH'
      ? 'Map trust boundaries and reproduce the unsafe or failing case before editing.'
      : policy.executionMode === 'STRUCTURAL_GRAPH_AWARE'
        ? 'Map affected interfaces and dependencies with available, authorized evidence.'
        : 'Reproduce the symptom and isolate the smallest supported root cause.';
  const validation = policy.executionMode === 'SECURITY_DEFENSE_IN_DEPTH'
    ? 'Run positive, negative, and regression tests for the affected security boundary.'
    : `Run focused tests${target} and the required affected regression gate.`;
  return {
    status: 'PROPOSED_NOT_EXECUTED',
    steps: [
      { id: 'analysis', dependsOn: [], action: investigation },
      { id: 'implementation', dependsOn: ['analysis'], action: `Apply the smallest justified change${target}.` },
      { id: 'validation', dependsOn: ['implementation'], action: validation },
      { id: 'delivery', dependsOn: ['validation'], action: 'Review the diff and report actual evidence and unresolved risks.' },
    ],
    completionCriteria: requirements.acceptanceCriteria.length
      ? requirements.acceptanceCriteria
      : ['Explicit acceptance criteria are missing; confirm them before declaring completion.'],
    stoppingCondition: 'Stop at an unresolved safety boundary or when required evidence is unavailable.',
  };
}
