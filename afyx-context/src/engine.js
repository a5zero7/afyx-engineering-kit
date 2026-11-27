import { AceError, assertNonEmpty } from './errors.js';
import { ContextStore, sha256 } from './storage.js';
import { canPersistSegment } from './privacy.js';
import { isTraceEnabled, recordInvocationTrace } from './invocation-trace.js';

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

function passthrough(segments, reason, { includeItemContent = true } = {}) {
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
      ...(includeItemContent ? { content: segment.content } : {}),
    })),
    metrics: {
      rawChars: renderedContext.length,
      outputChars: renderedContext.length,
      savedChars: 0,
      reductionRatio: 0,
    },
  };
}

function isReferenceEligible(segment, reference, { benefitAware = false } = {}) {
  if (!reference || PRESERVED.has(segment.classification)) return false;
  if (!benefitAware) return true;
  return referenceLine(segment, reference, 'repeated').length < originalLine(segment).length;
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

  reduce(request = {}, options = {}) {
    const benefitAware = Boolean(options?.benefitAware ?? request?.benefitAware);
    const tracing = isTraceEnabled();
    const startMs = tracing ? performance.now() : 0;
    try {
      const { normalized, budgetChars } = normalizeRequest(request);

      const mandatoryChars = normalized
        .filter((segment) => PRESERVED.has(segment.classification))
        .reduce((total, segment) => total + originalLine(segment).length + 2, 0);
      if (mandatoryChars > budgetChars) {
        const out = passthrough(normalized, 'protected-content-exceeds-budget');
        if (tracing) {
          const origBytes = Buffer.byteLength(out.renderedContext, 'utf8');
          const payBytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
          const dur = performance.now() - startMs;
          recordInvocationTrace({
            component: 'afyx-context',
            operation: 'reduce',
            status: 'success',
            durationMs: dur,
            inputBytes: origBytes,
            outputBytes: origBytes,
            payloadBytes: payBytes,
            cache: 'bypass',
            aceCost: { retrievedBytes: 0, originalBytes: origBytes, renderedBytes: origBytes, savedBytes: 0, durationMs: dur },
          });
        }
        return out;
      }

      // Inspect known active digests read-only first; persist only reference-eligible
      // normal segments after confirming we will not fall back to passthrough.
      const knownBefore = this.store.knownActiveDigests();
      const seen = new Set();
      const rendered = [];
      const items = [];
      const eligibleToPersist = [];
      let used = 0;
      for (const segment of normalized) {
        const digest = sha256(segment.content);
        const candidateRef = canPersistSegment(segment) ? this.store.reference(segment.content) : undefined;
        const eligible = isReferenceEligible(segment, candidateRef, { benefitAware });
        const reference = eligible ? candidateRef : undefined;
        const original = originalLine(segment);
        const repeated = seen.has(digest) || knownBefore.has(digest);
        const refReason = repeated ? 'repeated' : 'budgeted';
        const reduced = reference ? referenceLine(segment, reference, refReason) : original;
        const separator = rendered.length === 0 ? 0 : 2;
        const reservedLater = normalized.slice(items.length + 1)
          .filter((candidate) => PRESERVED.has(candidate.classification))
          .reduce((total, candidate) => total + originalLine(candidate).length + 2, 0);
        const mayReference = eligible && reduced.length < original.length;
        const chooseReference = mayReference && (repeated || used + separator + original.length + reservedLater > budgetChars);
        const selected = chooseReference ? reduced : original;
        if (used + separator + selected.length + reservedLater > budgetChars) {
          const out = passthrough(normalized, 'safe-budget-fallback');
          if (tracing) {
            const origBytes = Buffer.byteLength(out.renderedContext, 'utf8');
            const payBytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
            const dur = performance.now() - startMs;
            recordInvocationTrace({
              component: 'afyx-context',
              operation: 'reduce',
              status: 'success',
              durationMs: dur,
              inputBytes: origBytes,
              outputBytes: origBytes,
              payloadBytes: payBytes,
              cache: 'bypass',
              aceCost: { retrievedBytes: 0, originalBytes: origBytes, renderedBytes: origBytes, savedBytes: 0, durationMs: dur },
            });
          }
          return out;
        }
        if (eligible) eligibleToPersist.push(segment);
        rendered.push(selected);
        used += separator + selected.length;
        items.push({
          id: segment.id,
          classification: segment.classification,
          disposition: chooseReference ? 'reference' : 'original',
          digest,
          ...(reference ? { reference } : {}),
          provenance: segment.provenance,
          ...(chooseReference ? { reason: refReason } : (benefitAware ? {} : { content: segment.content })),
        });
        seen.add(digest);
      }

      if (benefitAware && eligibleToPersist.length === 0) {
        const out = passthrough(normalized, 'no-net-reduction', { includeItemContent: false });
        if (tracing) {
          const origBytes = Buffer.byteLength(out.renderedContext, 'utf8');
          const payBytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
          const dur = performance.now() - startMs;
          recordInvocationTrace({
            component: 'afyx-context',
            operation: 'reduce',
            status: 'success',
            durationMs: dur,
            inputBytes: origBytes,
            outputBytes: origBytes,
            payloadBytes: payBytes,
            cache: 'bypass',
            aceCost: { retrievedBytes: 0, originalBytes: origBytes, renderedBytes: origBytes, savedBytes: 0, durationMs: dur },
          });
        }
        return out;
      }

      if (eligibleToPersist.length > 0) {
        this.store.persist(eligibleToPersist);
      }

      const rawContext = normalized.map(originalLine).join('\n\n');
      const renderedContext = rendered.join('\n\n');
      const out = {
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
      if (tracing) {
        const dur = performance.now() - startMs;
        const origBytes = Buffer.byteLength(rawContext, 'utf8');
        const rendBytes = Buffer.byteLength(renderedContext, 'utf8');
        const payBytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
        const repeatedRefs = items.filter((i) => i.disposition === 'reference' && i.reason === 'repeated').length;
        const budgetedRefs = items.filter((i) => i.disposition === 'reference' && i.reason === 'budgeted').length;
        const cacheState = repeatedRefs > 0 && budgetedRefs === 0 ? 'hit'
          : (repeatedRefs > 0 ? 'partial' : 'miss');
        recordInvocationTrace({
          component: 'afyx-context',
          operation: 'reduce',
          status: 'success',
          durationMs: dur,
          inputBytes: origBytes,
          outputBytes: rendBytes,
          payloadBytes: payBytes,
          cache: cacheState,
          aceCost: {
            retrievedBytes: 0,
            originalBytes: origBytes,
            renderedBytes: rendBytes,
            savedBytes: origBytes - rendBytes,
            durationMs: dur,
          },
        });
      }
      return out;
    } catch (err) {
      if (tracing) {
        recordInvocationTrace({
          component: 'afyx-context',
          operation: 'reduce',
          status: 'failure',
          durationMs: performance.now() - startMs,
        });
      }
      throw err;
    }
  }

  collectExpired(options) {
    return this.store.collectExpired(options);
  }

  retrieve(reference) {
    const tracing = isTraceEnabled();
    const startMs = tracing ? performance.now() : 0;
    try {
      const result = this.store.retrieve(reference);
      if (tracing) {
        const dur = performance.now() - startMs;
        const outBytes = Buffer.byteLength(result, 'utf8');
        recordInvocationTrace({
          component: 'afyx-context',
          operation: 'retrieve',
          status: 'success',
          durationMs: dur,
          inputBytes: null,
          outputBytes: outBytes,
          cache: 'hit',
          aceCost: { retrievedBytes: outBytes, originalBytes: null, renderedBytes: outBytes, savedBytes: 0, durationMs: dur },
        });
      }
      return result;
    } catch (err) {
      if (tracing) {
        recordInvocationTrace({
          component: 'afyx-context',
          operation: 'retrieve',
          status: 'failure',
          durationMs: performance.now() - startMs,
        });
      }
      throw err;
    }
  }

  retrieveRecord(reference) {
    return this.store.retrieveRecord(reference);
  }
}

export const classifications = Object.freeze([...CLASSIFICATIONS]);
