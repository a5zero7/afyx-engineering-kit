import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StateCoordinator } from './coordination.js';
import { canPersistSegment } from './privacy.js';
import { AceError, assertNonEmpty } from './errors.js';

const CONTENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_FORMAT = 'ace.state/v1';
const SESSION_FORMAT = 'ace.session/v1';
const MAX_STATE_METADATA_BYTES = 65_536;
const MAX_SESSION_METADATA_BYTES = 16_777_216;
const MAX_SESSION_CONTENT = 100_000;
const MAX_OBSERVATIONS_PER_CONTENT = 256;
const MAX_IDENTITY_BYTES = 512;
const MAX_CONTENT_BLOB_BYTES = 1_048_576;
const TEMP_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const STATE_TEMP = new RegExp(`^state\\.json\\.[0-9]+\\.${TEMP_UUID}\\.tmp$`, 'i');
const SESSION_TEMP = new RegExp(`^session\\.json\\.[0-9]+\\.${TEMP_UUID}\\.tmp$`, 'i');
const CONTENT_TEMP = new RegExp(`^([0-9a-f]{64})\\.txt\\.[0-9]+\\.${TEMP_UUID}\\.tmp$`, 'i');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function jsonText(value, maxBytes) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new AceError('RESOURCE_LIMIT', `ACE metadata exceeds the ${maxBytes} byte limit`);
  }
  return text;
}

export function atomicText(file, content) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, content, { encoding: 'utf8' });
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    fs.rmSync(temporary, { force: true });
  }
}

function atomicJson(file, value, maxBytes) {
  atomicText(file, jsonText(value, maxBytes));
}

function assertNoAliases(target) {
  // Reject an aliased state root itself. Ancestors are intentionally not
  // rejected: macOS commonly exposes /var as a system alias to /private/var.
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new AceError('UNSAFE_STATE_PATH', `state path is a symbolic link: ${target}`);
  }
}

function ensureDirectory(target) {
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new AceError('UNSAFE_STATE_PATH', `ACE directory is not an owned regular directory: ${target}`);
    }
    return;
  }
  fs.mkdirSync(target, { recursive: true });
}

function assertRegularFile(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new AceError('UNSAFE_STATE_PATH', `ACE file is not an owned regular file: ${target}`);
  }
}

function readContentFile(target) {
  assertRegularFile(target);
  if (fs.statSync(target).size > MAX_CONTENT_BLOB_BYTES) {
    throw new AceError('RESOURCE_LIMIT', `stored content exceeds the ${MAX_CONTENT_BLOB_BYTES} byte limit`);
  }
  return fs.readFileSync(target, 'utf8');
}

export class ContextStore {
  constructor({ stateDir, ownerId, sessionId, lockTimeoutMs, lockRetryMs, contentTtlMs = CONTENT_TTL_MS } = {}) {
    assertNonEmpty(stateDir, 'stateDir');
    assertNonEmpty(ownerId, 'ownerId');
    assertNonEmpty(sessionId, 'sessionId');
    if (stateDir.includes('\0')) throw new AceError('UNSAFE_STATE_PATH', 'stateDir contains a NUL character');
    if (Buffer.byteLength(stateDir, 'utf8') > 32_767) throw new AceError('RESOURCE_LIMIT', 'stateDir exceeds the 32767 byte limit');
    if (Buffer.byteLength(ownerId, 'utf8') > MAX_IDENTITY_BYTES || Buffer.byteLength(sessionId, 'utf8') > MAX_IDENTITY_BYTES) {
      throw new AceError('RESOURCE_LIMIT', `ownerId and sessionId are limited to ${MAX_IDENTITY_BYTES} bytes each`);
    }
    if (!path.isAbsolute(stateDir)) {
      throw new AceError('UNSAFE_STATE_PATH', 'stateDir must be absolute');
    }
    if (!Number.isSafeInteger(contentTtlMs) || contentTtlMs < 1 || contentTtlMs > 365 * 24 * 60 * 60 * 1000) {
      throw new AceError('INVALID_INPUT', 'contentTtlMs must be a positive duration of at most one year');
    }
    this.contentTtlMs = contentTtlMs;
    this.stateDir = path.resolve(stateDir);
    this.ownerHash = sha256(ownerId);
    this.sessionHash = sha256(sessionId);
    assertNoAliases(this.stateDir);
    this.coordinator = new StateCoordinator({
      stateDir: this.stateDir,
      ownerHash: this.ownerHash,
      lockTimeoutMs,
      lockRetryMs,
    });
    ensureDirectory(this.stateDir);
    this.coordinator.withLock(({ recovered }) => {
      this.#recoverStateManifestTemporary();
      this.#initialize();
      if (recovered) this.#recoverOwnedTemporaries();
    });
  }

  withExclusiveAccess(action) {
    if (typeof action !== 'function') throw new AceError('INVALID_INPUT', 'exclusive action must be a function');
    return this.coordinator.withLock(({ recovered }) => {
      if (recovered) this.#recoverOwnedTemporaries();
      return action();
    });
  }

  #recoverStateManifestTemporary() {
    const manifestPath = path.join(this.stateDir, 'state.json');
    const temporaries = fs.readdirSync(this.stateDir).filter((entry) => STATE_TEMP.test(entry)).sort();
    if (temporaries.length > 1) {
      throw new AceError('INVALID_STATE', 'multiple interrupted state manifests require manual inspection');
    }
    if (temporaries.length === 0) return;
    const temporary = path.join(this.stateDir, temporaries[0]);
    const manifest = this.#readJson(temporary, 'INVALID_STATE', MAX_STATE_METADATA_BYTES);
    if (manifest.format !== STATE_FORMAT || manifest.ownerHash !== this.ownerHash) {
      throw new AceError('INVALID_STATE', 'interrupted state manifest is foreign or invalid');
    }
    if (fs.existsSync(manifestPath)) {
      const committed = this.#readJson(manifestPath, 'INVALID_STATE', MAX_STATE_METADATA_BYTES);
      if (committed.format !== STATE_FORMAT || committed.ownerHash !== this.ownerHash) {
        throw new AceError('FOREIGN_STATE', 'state belongs to a different owner or format');
      }
      fs.unlinkSync(temporary);
    } else {
      fs.renameSync(temporary, manifestPath);
    }
  }

  #initialize() {
    const manifestPath = path.join(this.stateDir, 'state.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = this.#readJson(manifestPath, 'INVALID_STATE', MAX_STATE_METADATA_BYTES);
      if (manifest.format !== STATE_FORMAT || manifest.ownerHash !== this.ownerHash) {
        throw new AceError('FOREIGN_STATE', 'state belongs to a different owner or format');
      }
    } else {
      const entries = fs.readdirSync(this.stateDir)
        .filter((entry) => !this.coordinator.isCoordinationEntry(entry));
      if (entries.length !== 0) {
        throw new AceError('AMBIGUOUS_STATE', 'state directory is non-empty and has no ACE ownership manifest');
      }
      atomicJson(manifestPath, { format: STATE_FORMAT, ownerHash: this.ownerHash }, MAX_STATE_METADATA_BYTES);
    }

    this.contentDir = path.join(this.stateDir, 'content');
    this.sessionDir = path.join(this.stateDir, 'sessions', this.sessionHash);
    ensureDirectory(this.contentDir);
    ensureDirectory(path.dirname(this.sessionDir));
    ensureDirectory(this.sessionDir);
    this.sessionPath = path.join(this.sessionDir, 'session.json');
    if (fs.existsSync(this.sessionPath)) {
      this.#readSession();
    } else {
      atomicJson(this.sessionPath, {
        format: SESSION_FORMAT,
        ownerHash: this.ownerHash,
        sessionHash: this.sessionHash,
        content: [],
        records: {},
      }, MAX_SESSION_METADATA_BYTES);
    }
  }

  #readJson(file, code, maxBytes) {
    try {
      assertRegularFile(file);
      if (fs.statSync(file).size > maxBytes) {
        throw new AceError('RESOURCE_LIMIT', `${path.basename(file)} exceeds the ${maxBytes} byte limit`);
      }
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error instanceof AceError) throw error;
      throw new AceError(code, `ACE metadata is unreadable: ${path.basename(file)}`);
    }
  }

  #readSession() {
    const session = this.#readJson(this.sessionPath, 'INVALID_SESSION', MAX_SESSION_METADATA_BYTES);
    return this.#validateSession(session);
  }

  #validateSession(session, expectedSessionHash = this.sessionHash) {
    if (session.format !== SESSION_FORMAT || session.ownerHash !== this.ownerHash || session.sessionHash !== expectedSessionHash
      || !Array.isArray(session.content) || !session.records || typeof session.records !== 'object' || Array.isArray(session.records)) {
      throw new AceError('INVALID_SESSION', 'session metadata is invalid or does not match this owner/session');
    }
    if (session.content.length > MAX_SESSION_CONTENT) {
      throw new AceError('RESOURCE_LIMIT', `session exceeds the ${MAX_SESSION_CONTENT} content limit`);
    }
    const known = new Set();
    for (const digest of session.content) {
      if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest) || known.has(digest)) {
        throw new AceError('INVALID_SESSION', 'session content identities are malformed or duplicated');
      }
      known.add(digest);
    }
    if (session.expiresAt !== undefined &&
        (!session.expiresAt || typeof session.expiresAt !== 'object' || Array.isArray(session.expiresAt) ||
        Object.entries(session.expiresAt).some(([digest, expiry]) => !known.has(digest) ||
          !Number.isSafeInteger(expiry) || expiry < 1))) {
      throw new AceError('INVALID_SESSION', 'session content expiration metadata is malformed');
    }
    for (const [digest, observations] of Object.entries(session.records)) {
      if (!known.has(digest) || !Array.isArray(observations) || observations.length > MAX_OBSERVATIONS_PER_CONTENT) {
        throw new AceError('INVALID_SESSION', 'session provenance records are malformed');
      }
      for (const observation of observations) {
        if (!observation || typeof observation !== 'object' || typeof observation.id !== 'string'
          || typeof observation.classification !== 'string' || !observation.provenance
          || typeof observation.provenance !== 'object' || Array.isArray(observation.provenance)) {
          throw new AceError('INVALID_SESSION', 'session provenance observation is malformed');
        }
      }
    }
    return session;
  }

  #recoverOwnedTemporaries() {
    for (const entry of fs.readdirSync(this.contentDir).sort()) {
      const match = CONTENT_TEMP.exec(entry);
      if (!match) continue;
      const temporary = path.join(this.contentDir, entry);
      const content = readContentFile(temporary);
      const digest = match[1].toLowerCase();
      if (sha256(content) !== digest) {
        throw new AceError('CONTENT_INTEGRITY', `interrupted content artifact failed integrity validation: ${entry}`);
      }
      const target = path.join(this.contentDir, `${digest}.txt`);
      if (fs.existsSync(target)) {
        const committed = readContentFile(target);
        if (committed !== content || sha256(committed) !== digest) {
          throw new AceError('CONTENT_INTEGRITY', 'committed content conflicts with an interrupted artifact');
        }
        fs.unlinkSync(temporary);
      } else {
        fs.renameSync(temporary, target);
      }
    }

    for (const entry of fs.readdirSync(this.sessionDir).sort()) {
      if (!SESSION_TEMP.test(entry)) continue;
      const temporary = path.join(this.sessionDir, entry);
      const session = this.#readJson(temporary, 'INVALID_SESSION', MAX_SESSION_METADATA_BYTES);
      this.#validateSession(session);
      fs.unlinkSync(temporary);
    }
  }

  knownDigests() {
    return this.withExclusiveAccess(() => new Set(this.#readSession().content));
  }

  knownActiveDigests() {
    return this.withExclusiveAccess(() => {
      const session = this.#readSession();
      const now = Date.now();
      return new Set(session.content.filter((digest) => (session.expiresAt?.[digest] ?? Infinity) > now));
    });
  }

  snapshotAndPersist(segments) {
    return this.withExclusiveAccess(() => {
      const session = this.#readSession();
      const now = Date.now();
      const knownBefore = new Set(session.content.filter((digest) => (session.expiresAt?.[digest] ?? Infinity) > now));
      this.#persist(segments);
      return knownBefore;
    });
  }

  persist(segments) {
    return this.withExclusiveAccess(() => this.#persist(segments));
  }

  #persist(segments) {
    const session = this.#readSession();
    const known = new Set(session.content);
    const records = { ...session.records };
    const expiresAt = { ...session.expiresAt };
    const expires = Date.now() + this.contentTtlMs;
    const pending = [];
    for (const segment of segments) {
      if (!canPersistSegment(segment)) continue;
      const { content } = segment;
      const digest = sha256(content);
      known.add(digest);
      expiresAt[digest] = expires;
      const observation = {
        id: segment.id,
        classification: segment.classification,
        provenance: segment.provenance,
      };
      const observations = Array.isArray(records[digest]) ? records[digest] : [];
      const encoded = JSON.stringify(observation);
      if (!observations.some((item) => JSON.stringify(item) === encoded)) {
        if (observations.length >= MAX_OBSERVATIONS_PER_CONTENT) {
          throw new AceError('RESOURCE_LIMIT', `content provenance exceeds the ${MAX_OBSERVATIONS_PER_CONTENT} observation limit`);
        }
        observations.push(observation);
      }
      records[digest] = observations;
      pending.push({ content, digest, target: path.join(this.contentDir, `${digest}.txt`) });
    }
    if (pending.length === 0) return;
    if (known.size > MAX_SESSION_CONTENT) {
      throw new AceError('RESOURCE_LIMIT', `session exceeds the ${MAX_SESSION_CONTENT} content limit`);
    }
    const nextSession = { ...session, content: [...known].sort(), records, expiresAt };
    jsonText(nextSession, MAX_SESSION_METADATA_BYTES);
    const missing = [];
    for (const { content, digest, target } of pending) {
      if (fs.existsSync(target)) {
        const existing = readContentFile(target);
        if (sha256(existing) !== digest || existing !== content) {
          throw new AceError('CONTENT_INTEGRITY', 'stored original content failed integrity validation');
        }
      } else {
        missing.push({ content, target });
      }
    }
    for (const { content, target } of missing) atomicText(target, content);
    atomicJson(this.sessionPath, nextSession, MAX_SESSION_METADATA_BYTES);
  }

  collectExpired({ maxDeletes = 64 } = {}) {
    if (!Number.isSafeInteger(maxDeletes) || maxDeletes < 1 || maxDeletes > 256) {
      throw new AceError('INVALID_INPUT', 'maxDeletes must be between 1 and 256');
    }
    return this.withExclusiveAccess(() => {
      const sessionsRoot = path.dirname(this.sessionDir);
      const hashes = fs.readdirSync(sessionsRoot);
      if (hashes.length > 128 || hashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
        throw new AceError('RESOURCE_LIMIT', 'cannot verify all ACE sessions within collection bounds');
      }
      const live = new Set();
      const expired = new Set();
      const now = Date.now();
      for (const hash of hashes) {
        const directory = path.join(sessionsRoot, hash);
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AceError('UNSAFE_STATE_PATH', 'unsafe ACE session directory');
        const file = path.join(directory, 'session.json');
        const session = this.#validateSession(this.#readJson(file, 'INVALID_SESSION', MAX_SESSION_METADATA_BYTES), hash);
        for (const digest of session.content) {
          ((session.expiresAt?.[digest] ?? Infinity) > now ? live : expired).add(digest);
        }
      }

      let removed = 0;
      for (const digest of expired) {
        if (live.has(digest)) continue;
        const file = path.join(this.contentDir, digest + '.txt');
        if (!fs.existsSync(file)) continue;
        assertRegularFile(file);
        fs.unlinkSync(file);
        if (++removed >= maxDeletes) break;
      }
      return { removed };
    });
  }

  reference(content) {
    return `ace:v1:${this.ownerHash.slice(0, 16)}:${this.sessionHash.slice(0, 16)}:${sha256(content)}`;
  }

  retrieve(reference) {
    return this.withExclusiveAccess(() => this.#retrieve(reference));
  }

  #retrieve(reference) {
    const match = /^ace:v1:([0-9a-f]{16}):([0-9a-f]{16}):([0-9a-f]{64})$/.exec(reference);
    if (!match) throw new AceError('INVALID_REFERENCE', 'reference is not an ACE v1 reference');
    if (match[1] !== this.ownerHash.slice(0, 16) || match[2] !== this.sessionHash.slice(0, 16)) {
      throw new AceError('REFERENCE_BOUNDARY', 'reference belongs to a different owner or session');
    }
    const session = this.#readSession();
    if (!session.content.includes(match[3])) throw new AceError('REFERENCE_BOUNDARY', 'reference is not owned by this session');
    if ((session.expiresAt?.[match[3]] ?? Infinity) <= Date.now()) {
      throw new AceError('REFERENCE_EXPIRED', 'ACE original expired under the content retention policy');
    }
    const target = path.join(this.contentDir, `${match[3]}.txt`);
    let content;
    try {
      content = readContentFile(target);
    } catch (error) {
      if (error instanceof AceError) throw error;
      throw new AceError('MISSING_ORIGINAL', 'referenced original content is unavailable');
    }
    if (sha256(content) !== match[3]) {
      throw new AceError('CONTENT_INTEGRITY', 'referenced original content failed integrity validation');
    }
    return content;
  }

  retrieveRecord(reference) {
    return this.withExclusiveAccess(() => {
      const content = this.#retrieve(reference);
      const digest = sha256(content);
      const session = this.#readSession();
      return {
        reference,
        digest,
        content,
        observations: session.records[digest] ?? [],
      };
    });
  }
}
