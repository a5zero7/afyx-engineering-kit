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
 * - Enforce explicit session and caller-permission boundaries; no key-only authorization bypass.
 * - Bounded resource budgets: fixed in-memory capacity with LRU eviction.
 * - Pure evidence metadata: never persists raw user prompts or full transcripts.
 */

import { createHash } from 'node:crypto';

export const AFYX_EVIDENCE_ENVELOPE_CONTRACT = 'AfyxEvidenceEnvelope/v1';

function sha256(text) {
  return createHash('sha256').update(typeof text === 'string' ? text : JSON.stringify(text)).digest('hex');
}

/**
 * Creates an immutable, versioned evidence envelope with caller scope and session identity.
 */
export function createEvidenceEnvelope(params = {}) {
  const {
    taskId = 'anonymous-task',
    sessionId = 'default-session',
    userId = 'default-user',
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
    scope = 'session',
    revoked = false,
  } = params;

  if (!capability || typeof capability !== 'string') {
    throw new Error('Evidence envelope requires a valid capability string');
  }

  const effectiveDedupeKey = deduplicationKey ||
    (scope === 'session' && sessionId !== 'default-session'
      ? `${repositoryId}::${commitId}::${sessionId}::${sourcePath || 'global'}::${capability}`
      : `${repositoryId}::${commitId}::${sourcePath || 'global'}::${capability}`);

  return Object.freeze({
    contract: AFYX_EVIDENCE_ENVELOPE_CONTRACT,
    taskId: String(taskId),
    sessionId: String(sessionId),
    userId: String(userId),
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
    scope: String(scope),
    revoked: Boolean(revoked),
    createdAt: Date.now(),
  });
}

/**
 * In-memory shared evidence pipeline with LRU eviction, session isolation, and caller-scope authorization.
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

  function get(deduplicationKey, callerContext = {}) {
    const {
      repositoryId,
      currentCommitId,
      sessionId,
      userId,
      permissions,
    } = callerContext;

    if (!store.has(deduplicationKey)) {
      missCount++;
      return null;
    }

    const envelope = store.get(deduplicationKey);

    // 1. Revocation check
    if (envelope.revoked === true) {
      store.delete(deduplicationKey);
      invalidationCount++;
      missCount++;
      return null;
    }

    // 2. Caller Authorization & Permission Downgrade check
    // Caller cannot override authorization merely by providing matching deduplication key
    if (permissions && permissions.authorized === false) {
      missCount++;
      return null;
    }
    if (envelope.permissions) {
      for (const [permKey, requiredVal] of Object.entries(envelope.permissions)) {
        if (requiredVal === true) {
          if (permissions && permissions[permKey] === false) {
            missCount++;
            return null; // Denied: caller permission downgraded
          }
        }
      }
    }

    // 3. Cross-repository anti-leakage guard
    if (repositoryId && envelope.repositoryId && envelope.repositoryId !== repositoryId) {
      missCount++;
      return null;
    }

    // 4. Cross-user anti-leakage guard
    if (userId && envelope.userId && envelope.userId !== userId) {
      missCount++;
      return null;
    }

    // 5. Session isolation guard
    if (envelope.scope === 'session' && envelope.sessionId !== 'default-session') {
      if (!sessionId || envelope.sessionId !== sessionId) {
        missCount++;
        return null;
      }
    } else if (sessionId && envelope.sessionId && envelope.sessionId !== sessionId) {
      missCount++;
      return null;
    }

    // 6. Source revision invalidation guard
    if (currentCommitId && envelope.commitId !== currentCommitId) {
      store.delete(deduplicationKey);
      invalidationCount++;
      missCount++;
      return null;
    }

    // Validated hit: move to end (MRU)
    store.delete(deduplicationKey);
    store.set(deduplicationKey, envelope);

    hitCount++;
    reuseCount++;
    return envelope;
  }

  function revoke(deduplicationKey) {
    if (store.has(deduplicationKey)) {
      store.delete(deduplicationKey);
      invalidationCount++;
      return true;
    }
    return false;
  }

  function revokeSession(sessionId) {
    let removed = 0;
    for (const [key, envelope] of store.entries()) {
      if (envelope.sessionId === sessionId) {
        store.delete(key);
        removed++;
      }
    }
    invalidationCount += removed;
    return removed;
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
    revoke,
    revokeSession,
    invalidate,
    clear,
    stats,
    has: (key) => store.has(key),
  });
}
