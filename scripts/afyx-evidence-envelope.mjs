/**
 * AFYX Single-Pass Evidence Pipeline & Evidence Envelope (AfyxEvidenceEnvelope/v1)
 *
 * Implements deterministic evidence reuse, deduplication, and strict fail-closed isolation
 * across cooperating AFYX capabilities (Forge, Graph, Context, Domain Skills, Usage).
 *
 * Governing Principles:
 * - Reuse valid source evidence between cooperating modules without re-reading unchanged files.
 * - Invalidate evidence immediately on source revision or permission changes.
 * - Strict multi-tenant boundaries: zero cross-repository, cross-user, or cross-session leakage.
 * - Fail-closed caller context: require complete valid sessionId, userId, repositoryId, and permissions.
 * - Do not rely on default identities (default-user, default-session, default-repo) to authorize protected evidence.
 * - Bounded resource budgets: fixed in-memory capacity with LRU eviction.
 * - Pure evidence metadata: never persists raw user prompts or full transcripts.
 */

import { createHash } from 'node:crypto';

export const AFYX_EVIDENCE_ENVELOPE_CONTRACT = 'AfyxEvidenceEnvelope/v1';

const RESERVED_DEFAULT_IDENTITIES = new Set([
  'default-session',
  'default-user',
  'default-repo',
]);

function sha256(text) {
  return createHash('sha256').update(typeof text === 'string' ? text : JSON.stringify(text)).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidIdentity(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && !RESERVED_DEFAULT_IDENTITIES.has(trimmed);
}

/**
 * Creates an immutable, versioned evidence envelope with caller scope and session identity.
 */
export function createEvidenceEnvelope(params = {}) {
  const {
    taskId = 'anonymous-task',
    sessionId = null,
    userId = null,
    repositoryId = null,
    commitId = 'HEAD',
    capability,
    sourcePath = null,
    contentHash = null,
    evidenceType = 'source-evidence',
    provenance = 'afyx-native',
    permissions = null,
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

  const normalizedSessionId = isValidIdentity(sessionId) ? sessionId.trim() : null;
  const normalizedUserId = isValidIdentity(userId) ? userId.trim() : null;
  const normalizedRepositoryId = isValidIdentity(repositoryId) ? repositoryId.trim() : null;

  const effectiveDedupeKey = deduplicationKey ||
    (scope === 'session' && normalizedSessionId
      ? `${normalizedRepositoryId || 'unscoped-repo'}::${commitId}::${normalizedSessionId}::${sourcePath || 'global'}::${capability}`
      : `${normalizedRepositoryId || 'unscoped-repo'}::${commitId}::${sourcePath || 'global'}::${capability}`);

  const frozenPermissions = isPlainObject(permissions)
    ? Object.freeze({ ...permissions })
    : Object.freeze({ authorized: false });

  return Object.freeze({
    contract: AFYX_EVIDENCE_ENVELOPE_CONTRACT,
    taskId: String(taskId),
    sessionId: normalizedSessionId,
    userId: normalizedUserId,
    repositoryId: normalizedRepositoryId,
    commitId: String(commitId),
    capability: String(capability),
    sourcePath: sourcePath ? String(sourcePath) : null,
    contentHash: contentHash ? String(contentHash) : (normalizedResult ? sha256(normalizedResult) : null),
    evidenceType: String(evidenceType),
    provenance: String(provenance),
    permissions: frozenPermissions,
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
 * In-memory shared evidence pipeline with LRU eviction, fail-closed caller context,
 * session/user/repository isolation, and permission scope enforcement.
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

    if (repositoryId) {
      repoRevisions.set(repositoryId, commitId);
    }

    // LRU eviction if budget exceeded
    if (store.size >= maxEntries && !store.has(deduplicationKey)) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }

    store.set(deduplicationKey, envelope);
    return envelope;
  }

  function get(deduplicationKey, callerContext) {
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

    // 2. Fail-closed caller context validation
    if (!isPlainObject(callerContext)) {
      missCount++;
      return null;
    }

    const {
      repositoryId,
      currentCommitId,
      sessionId,
      userId,
      permissions,
    } = callerContext;

    if (!isValidIdentity(sessionId) || !isValidIdentity(userId) || !isValidIdentity(repositoryId)) {
      missCount++;
      return null;
    }

    if (!isPlainObject(permissions) || permissions.authorized !== true) {
      missCount++;
      return null;
    }

    // 3. Fail-closed envelope metadata validation (no default-identity authorization)
    if (
      !isValidIdentity(envelope.sessionId) ||
      !isValidIdentity(envelope.userId) ||
      !isValidIdentity(envelope.repositoryId) ||
      !isPlainObject(envelope.permissions) ||
      envelope.permissions.authorized !== true
    ) {
      missCount++;
      return null;
    }

    // 4. Required permission scopes compatibility check
    for (const [permKey, requiredVal] of Object.entries(envelope.permissions)) {
      if (requiredVal === true && permissions[permKey] !== true) {
        missCount++;
        return null;
      }
    }

    // 5. Strict cross-repository, cross-user, and cross-session isolation
    if (envelope.repositoryId !== repositoryId.trim()) {
      missCount++;
      return null;
    }

    if (envelope.userId !== userId.trim()) {
      missCount++;
      return null;
    }

    if (envelope.sessionId !== sessionId.trim()) {
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
