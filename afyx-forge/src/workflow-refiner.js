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
  // Strip only a complete role-title line. Free-form role instructions may
  // contain safety/scope constraints and must remain in the refined directive.
  /^[ \t]*(?:Please\s+)?(?:act\s+as|you\s+are)\s+(?:an?\s+)?(?:(?:senior|principal|expert|lead|staff)\s+)*(?:software engineer|security engineer|engineer|architect|developer|reviewer)(?:\s+and\s+(?:(?:senior|principal|expert|lead|staff)\s+)*(?:software engineer|security engineer|engineer|architect|developer|reviewer))*[.!]?[ \t]*\r?$/gim,
  /^[ \t]*(?:Please\s+)?make\s+sure\s+you\s+(?:think\s+step\s+by\s+step|are\s+very\s+careful)[.!]?[ \t]*\r?$/gim,
  /^[ \t]*(?:Remember\s+to\s+)?always\s+follow\s+best\s+practices[.!]?[ \t]*\r?$/gim,
  /^[ \t]*(?:In\s+this\s+task,\s+)?we\s+need\s+to\s+carefully[.!]?[ \t]*\r?$/gim,
  /^[ \t]*(?:Note\s+that\s+)?quality\s+is\s+of\s+utmost\s+importance[.!]?[ \t]*\r?$/gim,
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
    if (/^(?:#+\s*)?(?:acceptance\s+criteria|requirements|kriteria\s+penerimaan|persyaratan)\s*:?\s*$/i.test(trimmed)) {
      currentSection = 'criteria';
      continue;
    } else if (/^(?:#+\s*)?(?:constraints|restrictions|batasan|larangan)\s*:?\s*$/i.test(trimmed)) {
      currentSection = 'constraints';
      continue;
    } else if (/^(?:#+\s*)?(?:objective|goals|tujuan|mission|misi)\s*:?\s*$/i.test(trimmed)) {
      currentSection = 'objective';
      continue;
    }

    // Unknown Markdown headings end the preceding section. Preserve their
    // content too: a heading can itself carry a safety instruction.
    const heading = /^#{1,6}\s+/.test(trimmed);
    if (heading) currentSection = 'general';
    const content = trimmed.replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s+/, '').trim();
    if (!content) continue;

    if (currentSection === 'constraints' || /\b(?:must\s+not|never|do\s+not|don't|cannot|can't|may\s+not|should\s+not|no\s+|larang|dilarang|jangan|tidak\s+(?:boleh|diizinkan)|without\s+(?:permission|authorization)|tanpa\s+(?:izin|otorisasi))\b/i.test(content)) {
      constraints.push({ id: `CONST-${constraints.length + 1}`, text: content });
    } else if (currentSection === 'criteria') {
      criteria.push({ id: `AC-${criteria.length + 1}`, text: content });
    } else if (currentSection === 'objective') {
      objectives.push(content);
    } else {
      // Infer from keywords, without rewriting the user's requirement.
      if (/\b(?:must|shall|verify|test|prove|harus|pastikan|verifikasi|buktikan)\b/i.test(content)) {
        criteria.push({ id: `AC-${criteria.length + 1}`, text: content });
      } else {
        objectives.push(content);
      }
    }
  }

  return {
    objectives,
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
    clarificationRequired: structured.criteria.length === 0,
    clarificationReasons: structured.criteria.length === 0 ? ['ACCEPTANCE_CRITERIA_UNSPECIFIED'] : [],
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
    const denied = /\b(?:(?:do(?:es)?|did)\s+not\s+pass|not\s+(?:verified|passed|passing|successful|tested|run|executed|confirmed)|failed|failure|gagal|belum\s+(?:lulus|terverifikasi|diuji|dijalankan)|tidak\s+(?:lulus|berhasil|diuji|dijalankan))\b/i.test(evidenceText);
    const satisfied = !denied && words.length > 0 && matchedWords.length >= Math.ceil(words.length * 0.5);
    return {
      id: criterion.id,
      text: criterion.text,
      satisfied,
      matchedTerms: matchedWords,
    };
  });

  const satisfiedCount = evaluation.filter((e) => e.satisfied).length;
  const score = criteriaList.length > 0 ? satisfiedCount / criteriaList.length : 0;

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

const PROMOTIONAL_BUZZWORDS = [
  /\b(?:seamlessly|cutting-edge|game-changing|revolutionary|state-of-the-art|effortlessly|world-class|unmatched|best-in-class)\b/gi,
  /\b(?:delivering unprecedented|unrivaled|magical|ultimate solution|hyper-optimized)\b/gi,
];

/**
 * Strips unsupported promotional buzzwords and marketing rhetoric from technical text.
 */
export function stripPromotionalSlop(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;
  for (const pattern of PROMOTIONAL_BUZZWORDS) {
    cleaned = cleaned.replace(pattern, '').replace(/\s{2,}/g, ' ');
  }
  return cleaned.trim();
}

/**
 * Refines documentation quality: removes slop, strips duplicated boilerplate,
 * and preserves technical facts, evidence indicators, and uncertainty labels.
 */
export function refineDocumentationQuality(text) {
  if (!text || typeof text !== 'string') return '';
  const withoutHype = stripPromotionalSlop(text);
  const lines = withoutHype.split(/\r?\n/);
  const seenLines = new Set();
  const refinedLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Preserve empty lines and markdown structural headers
    if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^[-*|]/.test(trimmed)) {
      refinedLines.push(line);
      continue;
    }
    // Deduplicate non-structural verbatim repeated sentences
    if (seenLines.has(trimmed)) {
      continue;
    }
    seenLines.add(trimmed);
    refinedLines.push(line);
  }

  return refinedLines.join('\n');
}

