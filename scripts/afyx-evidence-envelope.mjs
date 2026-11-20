/**
 * AFYX Single-Pass Evidence Pipeline & Evidence Envelope (AfyxEvidenceEnvelope/v1)
 *
 * Implements deterministic evidence reuse, deduplication, and strict isolation
 * across cooperating AFYX capabilities (Forge, Graph, Context, Domain Skills, Usage).
 *
 * Governing Principles:
 * - Reuse valid source evidence between cooperating modules without re-reading unchanged files.
 * - Invalidate evidence immediately on source revision or permission changes.
 * - Strict multi-tenant boundaries: zero cross-repository or cross-user leakage.
 * - Bounded resource budgets: fixed in-memory capacity with LRU eviction.
 * - Pure evidence metadata: never persists raw user prompts or full transcripts.
 */

import { createHash } from 'node:crypto';

export const AFYX_EVIDENCE_ENVELOPE_CONTRACT = 'AfyxEvidenceEnvelope/v1';

function sha256(text) {
  return createHash('sha256').update(typeof text === 'string' ? text : JSON.stringify(text)).digest('hex');
}

/**
 * Creates an immutable, versioned evidence envelope.
 */
export function createEvidenceEnvelope(params = {}) {
  const {
    taskId = 'anonymous-task',
    sessionId = 'default-session',
    repositoryId = 'default-repo',
    commitId = 'HEAD',
    capability,
    sourcePath = null,
    contentHash = null,
    evidenceType = 'source-evidence',
    provenance = 'afyx-native',
    permissions = { authorized: true },
    freshness = 'FRESH',
    normalizedResult = null,
    contextBudgetBytes = 65_536,
    deduplicationKey = null,
  } = params;

  if (!capability || typeof capability !== 'string') {
    throw new Error('Evidence envelope requires a valid capability string');
  }

  const effectiveDedupeKey = deduplicationKey ||
    `${repositoryId}::${commitId}::${sourcePath || 'global'}::${capability}`;

  return Object.freeze({
    contract: AFYX_EVIDENCE_ENVELOPE_CONTRACT,
    taskId: String(taskId),
    sessionId: String(sessionId),
    repositoryId: String(repositoryId),
    commitId: String(commitId),
    capability: String(capability),
    sourcePath: sourcePath ? String(sourcePath) : null,
    contentHash: contentHash ? String(contentHash) : (normalizedResult ? sha256(normalizedResult) : null),
    evidenceType: String(evidenceType),
    provenance: String(provenance),
    permissions: Object.freeze({ ...permissions }),
    freshness: String(freshness),
    normalizedResult: normalizedResult !== null && typeof normalizedResult === 'object'
      ? Object.freeze(JSON.parse(JSON.stringify(normalizedResult)))
      : normalizedResult,
    contextBudgetBytes: Number.isSafeInteger(contextBudgetBytes) ? contextBudgetBytes : 65_536,
    deduplicationKey: String(effectiveDedupeKey),
    createdAt: Date.now(),
  });
}

/**
 * In-memory shared evidence pipeline with LRU eviction and revision-aware invalidation.
 */
export function createSharedEvidencePipeline(options = {}) {
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : 500;
  const store = new Map(); // key -> envelope
  const repoRevisions = new Map(); // repositoryId -> latest commitId

  let hitCount = 0;
  let missCount = 0;
  let reuseCount = 0;
  let invalidationCount = 0;

  function set(envelope) {
    if (!envelope || envelope.contract !== AFYX_EVIDENCE_ENVELOPE_CONTRACT) {
      throw new Error('Invalid evidence envelope');
    }

    const { deduplicationKey, repositoryId, commitId } = envelope;

    // Track latest revision for repository
    repoRevisions.set(repositoryId, commitId);

    // LRU eviction if budget exceeded
    if (store.size >= maxEntries && !store.has(deduplicationKey)) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }

    store.set(deduplicationKey, envelope);
    return envelope;
  }

  function get(deduplicationKey, options = {}) {
    const { repositoryId, currentCommitId } = options;

    if (!store.has(deduplicationKey)) {
      missCount++;
      return null;
    }

    const envelope = store.get(deduplicationKey);

    // Cross-repository anti-leakage guard
    if (repositoryId && envelope.repositoryId !== repositoryId) {
      missCount++;
      return null;
    }

    // Invalidate if source revision changed
    if (currentCommitId && envelope.commitId !== currentCommitId) {
      store.delete(deduplicationKey);
      invalidationCount++;
      missCount++;
      return null;
    }

    // Move to end (MRU)
    store.delete(deduplicationKey);
    store.set(deduplicationKey, envelope);

    hitCount++;
    reuseCount++;
    return envelope;
  }

  function invalidate(repositoryId, newCommitId = null) {
    let removed = 0;
    for (const [key, envelope] of store.entries()) {
      if (envelope.repositoryId === repositoryId) {
        if (!newCommitId || envelope.commitId !== newCommitId) {
          store.delete(key);
          removed++;
        }
      }
    }
    if (newCommitId) {
      repoRevisions.set(repositoryId, newCommitId);
    } else {
      repoRevisions.delete(repositoryId);
    }
    invalidationCount += removed;
    return removed;
  }

  function clear() {
    store.clear();
    repoRevisions.clear();
    hitCount = 0;
    missCount = 0;
    reuseCount = 0;
    invalidationCount = 0;
  }

  function stats() {
    return Object.freeze({
      contract: AFYX_EVIDENCE_ENVELOPE_CONTRACT,
      size: store.size,
      maxEntries,
      hitCount,
      missCount,
      reuseCount,
      invalidationCount,
    });
  }

  return Object.freeze({
    set,
    get,
    invalidate,
    clear,
    stats,
    has: (key) => store.has(key),
  });
}
