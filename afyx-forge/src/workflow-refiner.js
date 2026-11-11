/**
 * AFYX Forge Core - Workflow Intelligence & Instruction Refiner
 *
 * Distills raw task instructions into bounded, high-signal engineering directives.
 * Eliminates redundant LLM prompt boilerplate ('slop'), structures concrete
 * acceptance criteria, and enforces rigorous completion verification without
 * introducing autonomous execution authority.
 */

export const WORKFLOW_REFINER_CONTRACT = 'afyx-forge-refiner-v1';

const BOILERPLATE_PATTERNS = [
  /^\s*(?:Please\s+)?(?:act\s+as|you\s+are)\s+(?:an?\s+)?(?:senior|principal|expert|lead|staff)\s+[^.\n]+[.\n]?/gim,
  /^\s*(?:Please\s+)?make\s+sure\s+you\s+(?:think\s+step\s+by\s+step|are\s+very\s+careful)[.\n]?/gim,
  /^\s*(?:Remember\s+to\s+)?always\s+follow\s+best\s+practices[.\n]?/gim,
  /^\s*(?:In\s+this\s+task,\s+)?we\s+need\s+to\s+carefully[.\n]?/gim,
  /^\s*(?:Note\s+that\s+)?quality\s+is\s+of\s+utmost\s+importance[.\n]?/gim,
];

/**
 * Strips superficial prompt boilerplate and filler text.
 */
export function stripInstructionBoilerplate(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

/**
 * Extracts structured acceptance criteria and constraints from an instruction string.
 */
export function extractStructuredCriteria(taskText) {
  const lines = taskText.split(/\r?\n/);
  const objectives = [];
  const criteria = [];
  const constraints = [];

  let currentSection = 'general';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section headers
    if (/^(?:#+\s*)?(?:acceptance\s+criteria|requirements|kriteria\s+penerimaan)/i.test(trimmed)) {
      currentSection = 'criteria';
      continue;
    } else if (/^(?:#+\s*)?(?:constraints|restrictions|batasan|larangan)/i.test(trimmed)) {
      currentSection = 'constraints';
      continue;
    } else if (/^(?:#+\s*)?(?:objective|goals|tujuan|mission)/i.test(trimmed)) {
      currentSection = 'objective';
      continue;
    }

    // Bullet points / numbered lists
    const isBullet = /^[-*•]\s+|^\[[ xX]\]\s+|^\d+\.\s+/.test(trimmed);
    const content = trimmed.replace(/^[-*•]\s+|^\[[ xX]\]\s+|^\d+\.\s+/, '').trim();

    if (isBullet) {
      if (currentSection === 'criteria') {
        criteria.push({ id: `AC-${criteria.length + 1}`, text: content });
      } else if (currentSection === 'constraints') {
        constraints.push({ id: `CONST-${constraints.length + 1}`, text: content });
      } else if (currentSection === 'objective') {
        objectives.push(content);
      } else {
        // Infer from keywords
        if (/\b(?:must\s+not|never|no\s+|larang|jangan)\b/i.test(content)) {
          constraints.push({ id: `CONST-${constraints.length + 1}`, text: content });
        } else if (/\b(?:must|shall|verify|test|prove|harus|pastikan)\b/i.test(content)) {
          criteria.push({ id: `AC-${criteria.length + 1}`, text: content });
        } else {
          objectives.push(content);
        }
      }
    } else if (!trimmed.startsWith('#')) {
      if (currentSection === 'objective' || currentSection === 'general') {
        if (objectives.length < 3) objectives.push(trimmed);
      }
    }
  }

  // Ensure default criteria if none parsed
  if (criteria.length === 0) {
    criteria.push({ id: 'AC-1', text: 'Implementation passes automated tests and regression checks' });
  }

  return {
    objectives: objectives.slice(0, 5),
    criteria,
    constraints,
  };
}

/**
 * Refines a raw task directive into high-signal engineering specifications.
 */
export function refineTaskDirective(rawTaskText) {
  const stripped = stripInstructionBoilerplate(rawTaskText);
  const structured = extractStructuredCriteria(stripped);

  return {
    contract: WORKFLOW_REFINER_CONTRACT,
    originalLength: rawTaskText.length,
    refinedLength: stripped.length,
    characterSavings: Math.max(0, rawTaskText.length - stripped.length),
    objectives: structured.objectives,
    acceptanceCriteria: structured.criteria,
    constraints: structured.constraints,
    definitionOfDone: [
      'All source changes match native architecture contracts',
      'No third-party proprietary implementation files imported',
      'Positive and negative unit/integration tests verified',
      'Pre-push and workspace hygiene self-tests pass',
    ],
  };
}

/**
 * Validates task completion against refined acceptance criteria.
 */
export function evaluateTaskCompletion(criteriaList, verifiedEvidence = []) {
  const evidenceText = verifiedEvidence.join(' ').toLowerCase();
  const evaluation = criteriaList.map((criterion) => {
    // Check key terms from criterion in verified evidence
    const words = criterion.text.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const matchedWords = words.filter((w) => evidenceText.includes(w));
    const satisfied = matchedWords.length >= Math.ceil(words.length * 0.5);
    return {
      id: criterion.id,
      text: criterion.text,
      satisfied,
      matchedTerms: matchedWords,
    };
  });

  const satisfiedCount = evaluation.filter((e) => e.satisfied).length;
  const score = criteriaList.length > 0 ? satisfiedCount / criteriaList.length : 1.0;

  return {
    isComplete: score >= 1.0,
    completionScore: Number(score.toFixed(2)),
    totalCriteria: criteriaList.length,
    satisfiedCriteriaCount: satisfiedCount,
    details: evaluation,
  };
}
