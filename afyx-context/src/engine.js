import { AceError, assertNonEmpty } from './errors.js';
import { ContextStore, sha256 } from './storage.js';

const CLASSIFICATIONS = new Set(['normal', 'diagnostic', 'security', 'source-evidence']);
const PRESERVED = new Set(['diagnostic', 'security', 'source-evidence']);
export const ACE_LIMITS = Object.freeze({
  maxSegments: 1_024,
  maxSegmentBytes: 1_048_576,
  maxRequestBytes: 8_388_608,
  maxProvenanceBytes: 65_536,
  maxIdBytes: 512,
  maxCliInputBytes: 10_485_760,
});

/** Conservative classification: false positives retain bytes instead of losing them. */
export function classifyContent(content, hint, provenance = {}) {
  if (hint !== undefined) {
    if (!CLASSIFICATIONS.has(hint)) throw new AceError('INVALID_INPUT', `unsupported classification: ${hint}`);
    if (hint !== 'normal') return hint;
  }
  if (provenance.exactSource === true) return 'source-evidence';
  if (/\b(?:SECURITY|UNAUTHORIZED|PERMISSION DENIED|ACCESS DENIED|CREDENTIAL|SECRET)\b/i.test(content)) return 'security';
  if (/\b(?:ERROR|FAIL(?:ED|URE)?|EXCEPTION|TRACEBACK|E_[A-Z0-9_]+)\b/i.test(content)) return 'diagnostic';
  return 'normal';
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new AceError('INVALID_INPUT', 'segments must be a non-empty array');
  }
  if (segments.length > ACE_LIMITS.maxSegments) {
    throw new AceError('RESOURCE_LIMIT', `segments exceeds the ${ACE_LIMITS.maxSegments} item limit`);
  }
  const ids = new Set();
  let requestBytes = 0;
  return segments.map((segment, index) => {
    if (!segment || typeof segment !== 'object') throw new AceError('INVALID_INPUT', `segments[${index}] must be an object`);
    const id = assertNonEmpty(segment.id, `segments[${index}].id`);
    if (/[\u0000-\u001f\u007f]/.test(id)) {
      throw new AceError('INVALID_INPUT', `segments[${index}].id contains a control character`);
    }
    if (Buffer.byteLength(id, 'utf8') > ACE_LIMITS.maxIdBytes) {
      throw new AceError('RESOURCE_LIMIT', `segments[${index}].id exceeds the ${ACE_LIMITS.maxIdBytes} byte limit`);
    }
    if (ids.has(id)) throw new AceError('INVALID_INPUT', `duplicate segment id: ${id}`);
    ids.add(id);
    if (typeof segment.content !== 'string') throw new AceError('INVALID_INPUT', `segments[${index}].content must be a string`);
    const contentBytes = Buffer.byteLength(segment.content, 'utf8');
    if (contentBytes > ACE_LIMITS.maxSegmentBytes) {
      throw new AceError('RESOURCE_LIMIT', `segments[${index}].content exceeds the ${ACE_LIMITS.maxSegmentBytes} byte limit`);
    }
    requestBytes += contentBytes + Buffer.byteLength(id, 'utf8');
    if (segment.provenance !== undefined && (segment.provenance === null || typeof segment.provenance !== 'object' || Array.isArray(segment.provenance))) {
      throw new AceError('INVALID_INPUT', `segments[${index}].provenance must be an object`);
    }
    let provenance;
    try {
      const encoded = JSON.stringify(segment.provenance ?? {});
      if (Buffer.byteLength(encoded, 'utf8') > ACE_LIMITS.maxProvenanceBytes) {
        throw new AceError('RESOURCE_LIMIT', `segments[${index}].provenance exceeds the ${ACE_LIMITS.maxProvenanceBytes} byte limit`);
      }
      requestBytes += Buffer.byteLength(encoded, 'utf8');
      if (requestBytes > ACE_LIMITS.maxRequestBytes) {
        throw new AceError('RESOURCE_LIMIT', `segments exceed the ${ACE_LIMITS.maxRequestBytes} byte request limit`);
      }
      provenance = JSON.parse(encoded);
    } catch (error) {
      if (error instanceof AceError) throw error;
      throw new AceError('INVALID_INPUT', `segments[${index}].provenance must be JSON-serializable`);
    }
    const classification = classifyContent(segment.content, segment.classification, provenance);
    return { id, content: segment.content, classification, provenance };
  });
}

function originalLine(segment) {
  return `[${segment.id}] ${segment.classification}\n${segment.content}`;
}

function referenceLine(segment, reference, reason) {
  return `[${segment.id}] ${reason} ${reference}`;
}

function passthrough(segments, reason) {
  const renderedContext = segments.map(originalLine).join('\n\n');
  return {
    contract: 'ace.result/v1',
    mode: 'passthrough',
    reason,
    renderedContext,
    items: segments.map((segment) => ({
      id: segment.id,
      classification: segment.classification,
      disposition: 'original',
      digest: sha256(segment.content),
      provenance: segment.provenance,
      content: segment.content,
    })),
    metrics: {
      rawChars: renderedContext.length,
      outputChars: renderedContext.length,
      savedChars: 0,
      reductionRatio: 0,
    },
  };
}

function normalizeRequest({ segments, budgetChars = 32_000 } = {}) {
  const normalized = normalizeSegments(segments);
  if (!Number.isSafeInteger(budgetChars) || budgetChars < 1) {
    throw new AceError('INVALID_INPUT', 'budgetChars must be a positive safe integer');
  }
  return { normalized, budgetChars };
}

export function validateContextRequest(request) {
  normalizeRequest(request);
  return true;
}

export class AfyxContextEngine {
  constructor(options = {}) {
    this.store = new ContextStore(options);
  }

  reduce(request = {}) {
    const { normalized, budgetChars } = normalizeRequest(request);

    // Validate everything before the first state mutation. Original bytes are
    // persisted before reduction so every emitted reference is recoverable.
    const knownBefore = this.store.snapshotAndPersist(normalized);
    const mandatoryChars = normalized
      .filter((segment) => PRESERVED.has(segment.classification))
      .reduce((total, segment) => total + originalLine(segment).length + 2, 0);
    if (mandatoryChars > budgetChars) return passthrough(normalized, 'protected-content-exceeds-budget');

    const seen = new Set();
    const rendered = [];
    const items = [];
    let used = 0;
    for (const segment of normalized) {
      const digest = sha256(segment.content);
      const reference = this.store.reference(segment.content);
      const original = originalLine(segment);
      const repeated = seen.has(digest) || knownBefore.has(digest);
      const preserve = PRESERVED.has(segment.classification);
      const refReason = repeated ? 'repeated' : 'budgeted';
      const reduced = referenceLine(segment, reference, refReason);
      const separator = rendered.length === 0 ? 0 : 2;
      const reservedLater = normalized.slice(items.length + 1)
        .filter((candidate) => PRESERVED.has(candidate.classification))
        .reduce((total, candidate) => total + originalLine(candidate).length + 2, 0);
      const mayReference = !preserve && reduced.length < original.length;
      const chooseReference = mayReference && (repeated || used + separator + original.length + reservedLater > budgetChars);
      const selected = chooseReference ? reduced : original;
      if (used + separator + selected.length + reservedLater > budgetChars) {
        return passthrough(normalized, 'safe-budget-fallback');
      }
      rendered.push(selected);
      used += separator + selected.length;
      items.push({
        id: segment.id,
        classification: segment.classification,
        disposition: chooseReference ? 'reference' : 'original',
        digest,
        reference,
        provenance: segment.provenance,
        ...(chooseReference ? { reason: refReason } : { content: segment.content }),
      });
      seen.add(digest);
    }

    const rawContext = normalized.map(originalLine).join('\n\n');
    const renderedContext = rendered.join('\n\n');
    return {
      contract: 'ace.result/v1',
      mode: 'optimized',
      renderedContext,
      items,
      metrics: {
        rawChars: rawContext.length,
        outputChars: renderedContext.length,
        savedChars: rawContext.length - renderedContext.length,
        reductionRatio: rawContext.length === 0 ? 0 : (rawContext.length - renderedContext.length) / rawContext.length,
      },
    };
  }

  retrieve(reference) {
    return this.store.retrieve(reference);
  }

  retrieveRecord(reference) {
    return this.store.retrieveRecord(reference);
  }
}

export const classifications = Object.freeze([...CLASSIFICATIONS]);
