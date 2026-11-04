import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AceError } from './errors.js';

const LOCK_FORMAT = 'ace.lock/v1';
const CLAIM_FORMAT = 'ace.lock-claim/v1';
const LOCK_NAME = '.ace-lock';
const OWNER_FILE = 'owner.json';
const CLAIM_FILE = 'recovery.json';
const MAX_COORDINATION_BYTES = 16_384;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_MS = 25;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RETRY_MS = 1_000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ABANDONED = new RegExp(`^\\.ace-lock\\.abandoned\\.(${UUID})$`, 'i');
const sleeper = new Int32Array(new SharedArrayBuffer(4));

class MissingCoordinationError extends Error {}

function coordinationError(message) {
  return new AceError('LOCK_RECOVERY_UNSAFE', message);
}

function boundedInteger(value, fallback, maximum, field) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new AceError('INVALID_INPUT', `${field} must be an integer from 1 through ${maximum}`);
  }
  return selected;
}

function sleep(milliseconds) {
  Atomics.wait(sleeper, 0, 0, milliseconds);
}

function processPresence(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return 'unknown';
  try {
    process.kill(pid, 0);
    return 'present';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'absent';
    return 'unknown';
  }
}

function jsonText(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > MAX_COORDINATION_BYTES) {
    throw coordinationError('coordination metadata exceeds its bounded size');
  }
  return text;
}

function writeExclusiveJson(file, value) {
  let handle;
  try {
    handle = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(handle, jsonText(value), { encoding: 'utf8' });
    fs.fsyncSync(handle);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function readRegularJson(file, description) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_COORDINATION_BYTES) {
      throw coordinationError(`${description} is not a bounded owned regular file`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof AceError) throw error;
    if (error?.code === 'ENOENT') throw new MissingCoordinationError(description);
    throw coordinationError(`${description} is missing or unreadable`);
  }
}

function validToken(value) {
  return typeof value === 'string' && new RegExp(`^${UUID}$`, 'i').test(value);
}

export class StateCoordinator {
  constructor({ stateDir, ownerHash, lockTimeoutMs, lockRetryMs }) {
    this.stateDir = stateDir;
    this.ownerHash = ownerHash;
    this.stateRootHash = crypto.createHash('sha256').update(stateDir).digest('hex');
    this.lockPath = path.join(stateDir, LOCK_NAME);
    this.timeoutMs = boundedInteger(lockTimeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'lockTimeoutMs');
    this.retryMs = boundedInteger(lockRetryMs, DEFAULT_RETRY_MS, MAX_RETRY_MS, 'lockRetryMs');
    this.host = os.hostname();
  }

  isCoordinationEntry(name) {
    return name === LOCK_NAME || ABANDONED.test(name);
  }

  withLock(action) {
    const acquisition = this.#acquire();
    let failure;
    try {
      return action({ recovered: acquisition.recovered });
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        this.#release(acquisition.owner.token);
      } catch (releaseError) {
        if (failure) failure.cause ??= releaseError;
        else throw releaseError;
      }
    }
  }

  #identity(format, token = crypto.randomUUID()) {
    return {
      format,
      token,
      stateRootHash: this.stateRootHash,
      ownerHash: this.ownerHash,
      host: this.host,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
  }

  #validateIdentity(value, format, description) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.format !== format || !validToken(value.token)
      || value.stateRootHash !== this.stateRootHash || value.ownerHash !== this.ownerHash
      || typeof value.host !== 'string' || !Number.isSafeInteger(value.pid) || value.pid < 1
      || typeof value.createdAt !== 'string') {
      throw coordinationError(`${description} is malformed, foreign, or not bound to this state`);
    }
    return value;
  }

  #readDirectory(directory, { claim = 'optional', allowMissing = false } = {}) {
    let entries;
    try {
      const stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw coordinationError('coordination path is not an owned regular directory');
      }
      entries = fs.readdirSync(directory).sort();
    } catch (error) {
      if (error instanceof AceError) throw error;
      if (allowMissing && error?.code === 'ENOENT') return null;
      throw coordinationError('coordination directory is missing or unreadable');
    }
    const allowed = claim === 'required' ? [OWNER_FILE, CLAIM_FILE] : [OWNER_FILE];
    if (claim === 'optional') {
      if (entries.length < 1 || entries.length > 2 || entries[0] !== OWNER_FILE
        || (entries.length === 2 && entries[1] !== CLAIM_FILE)) {
        throw coordinationError('coordination directory contains unknown artifacts');
      }
    } else if (entries.length !== allowed.length || entries.some((entry, index) => entry !== allowed[index])) {
      throw coordinationError('coordination directory contains unknown or missing artifacts');
    }
    let owner;
    let recovery;
    try {
      owner = this.#validateIdentity(
        readRegularJson(path.join(directory, OWNER_FILE), 'lock owner metadata'),
        LOCK_FORMAT,
        'lock owner metadata',
      );
      recovery = entries.includes(CLAIM_FILE)
        ? this.#validateIdentity(
          readRegularJson(path.join(directory, CLAIM_FILE), 'lock recovery metadata'),
          CLAIM_FORMAT,
          'lock recovery metadata',
        )
        : null;
    } catch (error) {
      if (allowMissing && error instanceof MissingCoordinationError) return null;
      throw error;
    }
    return { owner, recovery };
  }

  #liveness(identity) {
    if (identity.host !== this.host) return 'unknown';
    const presence = processPresence(identity.pid);
    if (presence === 'absent') return 'dead';
    if (presence === 'present') return 'alive';
    return 'unknown';
  }

  #removeDirectory(directory, ownerToken, recoveryToken = null) {
    if (path.dirname(directory) !== this.stateDir) {
      throw coordinationError('refusing to remove coordination data outside the state root');
    }
    const expectedClaim = recoveryToken ? 'required' : 'forbidden';
    const metadata = this.#readDirectory(directory, { claim: expectedClaim });
    if (metadata.owner.token !== ownerToken || (recoveryToken && metadata.recovery?.token !== recoveryToken)) {
      throw coordinationError('coordination ownership changed before cleanup');
    }
    if (recoveryToken) fs.unlinkSync(path.join(directory, CLAIM_FILE));
    fs.unlinkSync(path.join(directory, OWNER_FILE));
    fs.rmdirSync(directory);
  }

  #tryAcquire() {
    const owner = this.#identity(LOCK_FORMAT);
    try {
      fs.mkdirSync(this.lockPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code === 'EEXIST') return null;
      throw error;
    }
    const temporary = path.join(this.lockPath, `.owner.${owner.token}.tmp`);
    try {
      writeExclusiveJson(temporary, owner);
      fs.renameSync(temporary, path.join(this.lockPath, OWNER_FILE));
      return owner;
    } catch (error) {
      try {
        if (fs.existsSync(temporary)) {
          const stat = fs.lstatSync(temporary);
          if (stat.isSymbolicLink() || !stat.isFile()) throw coordinationError('owned lock temporary changed type');
          fs.unlinkSync(temporary);
        }
        fs.rmdirSync(this.lockPath);
      } catch (cleanupError) {
        throw coordinationError(`failed to clean an incomplete owned lock: ${cleanupError.message}`);
      }
      throw error;
    }
  }

  #recoverAbandonedLock() {
    const first = this.#readDirectory(this.lockPath, { allowMissing: true });
    if (!first) return true;
    const ownerState = this.#liveness(first.owner);
    if (ownerState === 'alive') return false;
    if (ownerState === 'unknown') {
      throw coordinationError('lock owner liveness cannot be verified; manual inspection is required');
    }
    if (first.recovery) {
      const claimantState = this.#liveness(first.recovery);
      if (claimantState === 'alive') return false;
      if (claimantState === 'unknown') {
        throw coordinationError('lock recovery claimant liveness cannot be verified; manual inspection is required');
      }
      const current = this.#readDirectory(this.lockPath, { claim: 'required' });
      if (current.owner.token !== first.owner.token || current.recovery.token !== first.recovery.token) return false;
      fs.unlinkSync(path.join(this.lockPath, CLAIM_FILE));
    }

    const claim = this.#identity(CLAIM_FORMAT);
    try {
      writeExclusiveJson(path.join(this.lockPath, CLAIM_FILE), claim);
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      if (error?.code === 'ENOENT') return true;
      throw error;
    }
    const claimed = this.#readDirectory(this.lockPath, { claim: 'required' });
    if (claimed.owner.token !== first.owner.token || claimed.recovery.token !== claim.token) {
      throw coordinationError('lock ownership changed during abandoned-lock recovery');
    }
    const abandoned = path.join(this.stateDir, `.ace-lock.abandoned.${claim.token}`);
    fs.renameSync(this.lockPath, abandoned);
    this.#removeDirectory(abandoned, first.owner.token, claim.token);
    return true;
  }

  #cleanupArtifacts() {
    for (const entry of fs.readdirSync(this.stateDir).sort()) {
      const abandonedMatch = ABANDONED.exec(entry);
      if (!abandonedMatch) {
        if (entry.startsWith('.ace-lock.') && entry !== LOCK_NAME) {
          throw coordinationError(`unrecognized coordination artifact: ${entry}`);
        }
        continue;
      }
      const target = path.join(this.stateDir, entry);
      const metadata = this.#readDirectory(target, {
        claim: 'required',
        allowMissing: true,
      });
      if (!metadata) continue;
      if (metadata.recovery.token.toLowerCase() !== abandonedMatch[1].toLowerCase()) {
        throw coordinationError('abandoned lock name does not match its recovery token');
      }
      const state = this.#liveness(metadata.recovery);
      if (state === 'alive') continue;
      if (state === 'unknown') {
        throw coordinationError(`coordination artifact owner cannot be verified: ${entry}`);
      }
      this.#removeDirectory(target, metadata.owner.token, metadata.recovery.token);
    }
  }

  #acquire() {
    const started = Date.now();
    let recovered = false;
    while (true) {
      const owner = this.#tryAcquire();
      if (owner) {
        try {
          this.#cleanupArtifacts();
          return { owner, recovered };
        } catch (error) {
          this.#release(owner.token);
          throw error;
        }
      }
      let recoveryError;
      try {
        if (this.#recoverAbandonedLock()) {
          recovered = true;
          continue;
        }
      } catch (error) {
        if (!(error instanceof AceError) || error.code !== 'LOCK_RECOVERY_UNSAFE') throw error;
        recoveryError = error;
      }
      if (Date.now() - started >= this.timeoutMs) {
        if (recoveryError) throw recoveryError;
        const metadata = this.#readDirectory(this.lockPath, { allowMissing: true });
        const detail = metadata
          ? `host ${metadata.owner.host}, pid ${metadata.owner.pid}`
          : 'no stable lock owner could be observed';
        throw new AceError(
          'LOCK_TIMEOUT',
          `ACE state lock timed out after ${this.timeoutMs} ms (${detail})`,
        );
      }
      sleep(Math.min(this.retryMs, Math.max(1, this.timeoutMs - (Date.now() - started))));
    }
  }

  #release(token) {
    this.#removeDirectory(this.lockPath, token);
  }
}
