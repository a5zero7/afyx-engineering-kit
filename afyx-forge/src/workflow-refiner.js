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
  if (typeof rawTaskText !== 'string' || !rawTaskText.trim() || rawTaskText.length > 65_536) {
    throw new TypeError('Task text must be non-empty and at most 65536 characters.');
  }
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
    const denied = /\b(?:(?:do(?:es)?|did)\s+not\s+pass|not\s+(?:verified|passed|passing|successful)|failed|failure|gagal|belum\s+(?:lulus|terverifikasi)|tidak\s+(?:lulus|berhasil))\b/i.test(evidenceText);
    const satisfied = !denied && matchedWords.length >= Math.ceil(words.length * 0.5);
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
    assurance: 'TEXT_HEURISTIC_ONLY',
    verifiedComplete: false,
    isComplete: score >= 1.0,
    completionScore: Number(score.toFixed(2)),
    totalCriteria: criteriaList.length,
    satisfiedCriteriaCount: satisfiedCount,
    details: evaluation,
  };
}

/** Versioned acceptance boundary: model assertions and free text are not verification authority. */
export const VERIFIED_COMPLETION_CONTRACT = 'afyx-forge-completion/v2';
export function evaluateVerifiedTaskCompletion(criteriaList, records = [], { sourceRevision, verifyEvidence } = {}) {
  const validCriteria = Array.isArray(criteriaList) && criteriaList.length > 0 && criteriaList.length <= 64
    && criteriaList.every((item) => item && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(item.id) && typeof item.text === 'string' && item.text.length > 0 && item.text.length <= 4096)
    && new Set(criteriaList.map((item) => item.id)).size === criteriaList.length;
  const validContext = validCriteria && /^[0-9a-f]{40}$/.test(sourceRevision ?? '') && typeof verifyEvidence === 'function'
    && Array.isArray(records) && records.length <= 256;
  const details = validCriteria ? criteriaList.map((criterion) => {
    const matching = validContext ? records.filter((record) => record && typeof record === 'object' && record.criterionId === criterion.id) : [];
    let satisfied = matching.length > 0;
    for (const record of matching) {
      if (record.status !== 'PASS' || record.exitCode !== 0 || record.sourceRevision !== sourceRevision
        || !/^[0-9a-f]{64}$/.test(record.evidenceDigest ?? '') || typeof record.command !== 'string'
        || !record.command.trim() || record.command.length > 4096) { satisfied = false; continue; }
      try {
        // A trusted host binds the record to its actual receipt/log, not record.verified.
        const bound = Object.freeze({ ...record });
        if (verifyEvidence(bound, Object.freeze({ criterionId: criterion.id, sourceRevision })) !== true) satisfied = false;
      } catch { satisfied = false; }
    }
    return Object.freeze({ id: criterion.id, satisfied });
  }) : [];
  const satisfiedCount = details.filter((item) => item.satisfied).length;
  const complete = validContext && details.length > 0 && satisfiedCount === details.length;
  return Object.freeze({ contract: VERIFIED_COMPLETION_CONTRACT, assurance: 'HOST_VERIFIED_EVIDENCE', isComplete: complete,
    verifiedComplete: complete, completionScore: details.length ? satisfiedCount / details.length : 0,
    totalCriteria: validCriteria ? criteriaList.length : 0, satisfiedCriteriaCount: satisfiedCount, details: Object.freeze(details) });
}
