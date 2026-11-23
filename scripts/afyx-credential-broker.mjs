/** Authorization boundary for credential use. Never returns credential material. */
import { randomUUID } from 'node:crypto';

export const CREDENTIAL_BROKER_CONTRACT = 'AfyxCredentialBroker/v1';
const OPERATIONS = new Set(['inject-process', 'fill-host-field']);
const PROVIDERS = new Set(['codex', 'antigravity', 'claude']);
const ALIAS = /^[a-z][a-z0-9-]{1,63}$/;
const BACKEND = /^[a-z0-9][a-z0-9-]{1,63}$/;

function valid(value, pattern) { return typeof value === 'string' && pattern.test(value); }

/** Adapters are supplied by a trusted host, never by a task payload. */
export function createCredentialBroker({ adapters = {}, now = Date.now } = {}) {
  const sessions = new Map();
  const supported = new Map(Object.entries(adapters).filter(([name, adapter]) =>
    valid(name, BACKEND) && adapter && typeof adapter.use === 'function'));

  function grant({ provider, backend, scope, aliases, operations, targets, ttlMs }, { authorize, consent } = {}) {
    if (!PROVIDERS.has(provider) || !valid(backend, BACKEND) || !valid(scope, ALIAS)
        || !Array.isArray(aliases) || !aliases.length || !aliases.every((x) => valid(x, ALIAS))
        || !Array.isArray(operations) || !operations.length || !operations.every((x) => OPERATIONS.has(x))
        || !Array.isArray(targets) || !targets.length || !targets.every((x) => valid(x, ALIAS))
        || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000) {
      return { contract: CREDENTIAL_BROKER_CONTRACT, status: 'INVALID_GRANT' };
    }
    if (!supported.has(backend)) return { contract: CREDENTIAL_BROKER_CONTRACT, status: 'BACKEND_UNAVAILABLE' };
    const grantRequest = Object.freeze({ provider, backend, scope, aliases: Object.freeze([...aliases]),
      operations: Object.freeze([...operations]), targets: Object.freeze([...targets]), ttlMs });
    let approved = false;
    try { approved = typeof authorize === 'function' && authorize(grantRequest) === true
      && typeof consent === 'function' && consent(grantRequest) === true; } catch { /* fail closed */ }
    if (!approved) {
      return { contract: CREDENTIAL_BROKER_CONTRACT, status: 'DENIED' };
    }
    const sessionId = randomUUID();
    const expiresAt = now() + ttlMs;
    sessions.set(sessionId, { ...grantRequest, expiresAt });
    return { contract: CREDENTIAL_BROKER_CONTRACT, status: 'GRANTED', sessionId, expiresAt };
  }

  async function use(request) {
    const base = { contract: CREDENTIAL_BROKER_CONTRACT };
    if (!request || request.contract !== CREDENTIAL_BROKER_CONTRACT
        || Object.keys(request).some((key) => !['contract', 'sessionId', 'provider', 'scope', 'alias', 'operation', 'target'].includes(key))
        || !valid(request.alias, ALIAS) || !valid(request.target, ALIAS) || !OPERATIONS.has(request.operation)) {
      return { ...base, status: 'INVALID_REQUEST' };
    }
    const session = sessions.get(request.sessionId);
    if (!session) return { ...base, status: 'DENIED' };
    if (now() >= session.expiresAt) { sessions.delete(request.sessionId); return { ...base, status: 'EXPIRED' }; }
    if (session.provider !== request.provider || session.scope !== request.scope
        || !session.aliases.includes(request.alias) || !session.operations.includes(request.operation)
        || !session.targets.includes(request.target)) {
      return { ...base, status: 'DENIED' };
    }
    const adapter = supported.get(session.backend);
    if (!adapter) return { ...base, status: 'BACKEND_UNAVAILABLE' };
    // An approved grant authorizes exactly one use, not unlimited secret-use
    // operations during the TTL. Consume it before awaiting the trusted
    // backend so simultaneous/replayed requests cannot race past consent.
    sessions.delete(request.sessionId);
    try {
      // Adapter output and thrown errors are intentionally never returned to the agent.
      const result = await adapter.use(Object.freeze({ alias: request.alias, operation: request.operation,
        scope: request.scope, target: request.target }));
      return { ...base, status: result?.performed === true ? 'EXECUTED' : 'BACKEND_FAILED', backend: session.backend };
    } catch {
      return { ...base, status: 'BACKEND_FAILED', backend: session.backend };
    }
  }

  function revoke(sessionId) { return sessions.delete(sessionId); }
  function availableBackends() { return [...supported.keys()]; }
  return Object.freeze({ grant, use, revoke, availableBackends });
}
