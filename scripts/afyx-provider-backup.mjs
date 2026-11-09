/**
 * Universal Provider Configuration Management & Backup Contract
 *
 * Principle: "Native Integration First. Backup Before Modification. Validate After Changes. Restore When Needed."
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

export const PROVIDER_BACKUP_SCHEMA_VERSION = 1;
export const DEFAULT_BACKUP_RETENTION_LIMIT = 20;

/**
 * Returns the canonical root directory for Afyx backups outside the source repository.
 */
export function getProviderBackupRoot(overrideRoot = '') {
  if (overrideRoot) return resolve(overrideRoot);
  if (process.env.AFYX_BACKUP_ROOT) return resolve(process.env.AFYX_BACKUP_ROOT);
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return join(home, '.afyx', 'backups');
}

/**
 * Calculates SHA-256 hex digest for a given Buffer or string.
 */
export function sha256(data) {
  if (data === null || data === undefined) return null;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Reads file bytes safely; returns null if file does not exist.
 */
export function readFileBytes(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return readFileSync(filePath);
}

/**
 * Compares two byte buffers for exact equality.
 */
export function byteEquals(a, b) {
  if (a === null || b === null) return a === b;
  return Buffer.isBuffer(a) && Buffer.isBuffer(b) ? a.equals(b) : a === b;
}

/**
 * Applies retention limit to provider backups, keeping the newest N backups.
 */
export function enforceBackupRetention(providerDir, limit = DEFAULT_BACKUP_RETENTION_LIMIT) {
  if (!existsSync(providerDir)) return;
  const max = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_BACKUP_RETENTION_LIMIT;

  const entries = readdirSync(providerDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.meta.json'))
    .map((e) => {
      const metaPath = join(providerDir, e.name);
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        const mtime = statSync(metaPath).mtimeMs;
        return {
          metaName: e.name,
          metaPath,
          backupPath: metaPath.slice(0, -'.meta.json'.length),
          timestamp: meta.timestamp ? new Date(meta.timestamp).getTime() : mtime,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp); // Newest first

  if (entries.length > max) {
    const toRemove = entries.slice(max);
    for (const item of toRemove) {
      try {
        if (existsSync(item.backupPath)) rmSync(item.backupPath, { force: true });
        if (existsSync(item.metaPath)) rmSync(item.metaPath, { force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

/**
 * Creates an immutable, recoverable configuration backup before modification.
 *
 * @param {Object} params
 * @param {string} params.provider - Provider identifier ('codex', 'antigravity', 'claude', etc.)
 * @param {string} params.configPath - Absolute path to the configuration file
 * @param {string} [params.operation='modify'] - Operation description ('mcp-register', 'mcp-remove', etc.)
 * @param {string} [params.backupRoot=''] - Optional custom backup root directory
 * @param {number} [params.retentionLimit=20] - Retention limit for backups
 * @returns {Object} Backup handle
 */
export function createConfigurationBackup({
  provider,
  configPath,
  operation = 'modify',
  backupRoot = '',
  retentionLimit = DEFAULT_BACKUP_RETENTION_LIMIT,
}) {
  if (!provider || typeof provider !== 'string') throw new Error('Provider identifier is required');
  if (!configPath || typeof configPath !== 'string') throw new Error('Configuration path is required');

  const absoluteConfig = resolve(configPath);
  const existed = existsSync(absoluteConfig);
  const originalBytes = existed ? readFileSync(absoluteConfig) : null;
  const originalSha256 = existed ? sha256(originalBytes) : null;
  let originalMode = null;

  if (existed) {
    try {
      originalMode = statSync(absoluteConfig).mode;
    } catch {
      originalMode = null;
    }
  }

  const root = getProviderBackupRoot(backupRoot);
  const providerDir = join(root, 'provider-config', provider);
  mkdirSync(providerDir, { recursive: true });

  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, '-');
  const nonce = randomBytes(4).toString('hex');
  const backupFileName = `${basename(absoluteConfig)}.${timestampStr}-${nonce}.bak`;
  const backupPath = join(providerDir, backupFileName);
  const metaPath = `${backupPath}.meta.json`;

  if (existed && originalBytes !== null) {
    writeFileSync(backupPath, originalBytes);
    if (originalMode !== null) {
      try {
        chmodSync(backupPath, originalMode);
      } catch {
        // Platform permission fallback
      }
    }
    // Verify backup integrity immediately
    const verifyBytes = readFileSync(backupPath);
    if (sha256(verifyBytes) !== originalSha256) {
      rmSync(backupPath, { force: true });
      throw new Error(`Backup integrity verification failed for ${absoluteConfig}`);
    }
  }

  const metadata = {
    schemaVersion: PROVIDER_BACKUP_SCHEMA_VERSION,
    provider,
    configPath: absoluteConfig,
    operation,
    timestamp: now.toISOString(),
    existed,
    sha256: originalSha256,
    size: originalBytes ? originalBytes.length : 0,
    backupFile: existed ? backupFileName : null,
  };

  writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

  // Enforce retention limit
  enforceBackupRetention(providerDir, retentionLimit);

  return {
    provider,
    configPath: absoluteConfig,
    backupPath: existed ? backupPath : null,
    metaPath,
    existed,
    originalSha256,
    originalBytes,
    lastKnownSha256: originalSha256,
    lastKnownBytes: originalBytes,
    operation,
  };
}

/**
 * Updates the last-known byte state on the backup handle after an intentional Afyx step.
 */
export function updateKnownState(backupHandle, currentBytes = null) {
  if (!backupHandle) return;
  if (currentBytes !== null) {
    backupHandle.lastKnownBytes = currentBytes;
    backupHandle.lastKnownSha256 = sha256(currentBytes);
  } else if (existsSync(backupHandle.configPath)) {
    const bytes = readFileSync(backupHandle.configPath);
    backupHandle.lastKnownBytes = bytes;
    backupHandle.lastKnownSha256 = sha256(bytes);
  } else {
    backupHandle.lastKnownBytes = null;
    backupHandle.lastKnownSha256 = null;
  }
}

/**
 * Attempts a safe rollback to the original configuration state.
 * Refuses rollback and reports conflict if concurrent modifications occurred.
 *
 * @param {Object} backupHandle - Handle created by createConfigurationBackup
 * @param {Object} [options]
 * @param {string} [options.reason=''] - Diagnostic reason for rollback
 * @param {boolean} [options.force=false] - Force rollback even if concurrent edits detected
 * @returns {Object} Rollback result
 */
export function rollbackConfiguration(backupHandle, { reason = '', force = false } = {}) {
  if (!backupHandle || !backupHandle.configPath) {
    return { restored: false, error: 'INVALID_BACKUP_HANDLE' };
  }

  const currentBytes = readFileBytes(backupHandle.configPath);
  const currentSha = sha256(currentBytes);

  // Check for concurrent modification:
  // If target changed to something other than our last-known state or original state
  const isConcurrentlyModified = currentSha !== null
    && currentSha !== backupHandle.lastKnownSha256
    && currentSha !== backupHandle.originalSha256;

  if (isConcurrentlyModified && !force) {
    // Preserve concurrent file as conflict evidence
    const conflictNonce = randomBytes(3).toString('hex');
    const conflictPath = `${backupHandle.configPath}.conflict-${Date.now()}-${conflictNonce}`;
    try {
      if (currentBytes !== null) writeFileSync(conflictPath, currentBytes);
    } catch {
      // Best-effort
    }
    return {
      restored: false,
      conflict: true,
      conflictPath,
      reason: `CONCURRENT_MODIFICATION_DETECTED: Target configuration changed externally during operation; original backup preserved at ${backupHandle.backupPath || 'none'}`,
    };
  }

  try {
    if (!backupHandle.existed) {
      if (existsSync(backupHandle.configPath)) {
        rmSync(backupHandle.configPath, { force: true });
      }
    } else {
      if (backupHandle.backupPath && existsSync(backupHandle.backupPath)) {
        mkdirSync(dirname(backupHandle.configPath), { recursive: true });
        copyFileSync(backupHandle.backupPath, backupHandle.configPath);
      } else if (backupHandle.originalBytes !== null) {
        mkdirSync(dirname(backupHandle.configPath), { recursive: true });
        writeFileSync(backupHandle.configPath, backupHandle.originalBytes);
      } else {
        return { restored: false, error: 'BACKUP_DATA_MISSING' };
      }

      // Verify restored content
      const restoredBytes = readFileBytes(backupHandle.configPath);
      if (sha256(restoredBytes) !== backupHandle.originalSha256) {
        return { restored: false, error: 'RESTORE_VERIFICATION_FAILED' };
      }
    }

    return {
      restored: true,
      conflict: false,
      verified: true,
      reason,
    };
  } catch (err) {
    return {
      restored: false,
      conflict: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Restores configuration from a specific backup file and verifies integrity.
 */
export function restoreFromBackup(backupPath, targetPath) {
  if (!existsSync(backupPath)) throw new Error(`Backup file does not exist: ${backupPath}`);
  const metaPath = `${backupPath}.meta.json`;
  let expectedSha256 = null;

  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      expectedSha256 = meta.sha256;
    } catch {
      expectedSha256 = null;
    }
  }

  const backupBytes = readFileSync(backupPath);
  if (expectedSha256 && sha256(backupBytes) !== expectedSha256) {
    throw new Error(`Backup file checksum corrupted: ${backupPath}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(backupPath, targetPath);

  const restoredBytes = readFileSync(targetPath);
  if (sha256(restoredBytes) !== sha256(backupBytes)) {
    throw new Error(`Restoration verification failed for ${targetPath}`);
  }

  return { restored: true, targetPath, sha256: sha256(restoredBytes) };
}

/**
 * Parses basic and standard TOML strings into a JavaScript object without external dependencies.
 * Fails closed on syntax errors or invalid TOML.
 */
export function parseToml(input) {
  if (typeof input !== 'string') {
    throw new TypeError('TOML input must be a string');
  }

  // Strip UTF-8 BOM if present
  const src = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  let pos = 0;
  const len = src.length;

  function skipWhitespace(includeNewlines = false) {
    while (pos < len) {
      const ch = src[pos];
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        pos++;
      } else if (includeNewlines && ch === '\n') {
        pos++;
      } else if (ch === '#') {
        while (pos < len && src[pos] !== '\n') {
          pos++;
        }
      } else {
        break;
      }
    }
  }

  function skipWhitespaceAndCommentsInMultiline() {
    while (pos < len) {
      const ch = src[pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        pos++;
      } else if (ch === '#') {
        while (pos < len && src[pos] !== '\n') {
          pos++;
        }
      } else {
        break;
      }
    }
  }

  function expect(char) {
    skipWhitespace(false);
    if (src[pos] !== char) {
      throw new Error(`Expected '${char}' at index ${pos}, found '${src[pos] || 'EOF'}'`);
    }
    pos++;
  }

  function parseBareKey() {
    const start = pos;
    while (pos < len && /[A-Za-z0-9_-]/.test(src[pos])) {
      pos++;
    }
    if (pos === start) {
      throw new Error(`Expected bare key at position ${pos}`);
    }
    return src.slice(start, pos);
  }

  function parseEscapeChar() {
    if (pos >= len) throw new Error('Unexpected EOF in string escape');
    const ch = src[pos++];
    switch (ch) {
      case '"': return '"';
      case '\\': return '\\';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'u': {
        const hex = src.slice(pos, pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Invalid unicode escape \\u${hex}`);
        pos += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      case 'U': {
        const hex = src.slice(pos, pos + 8);
        if (!/^[0-9a-fA-F]{8}$/.test(hex)) throw new Error(`Invalid unicode escape \\U${hex}`);
        pos += 8;
        return String.fromCodePoint(parseInt(hex, 16));
      }
      default:
        throw new Error(`Invalid escape sequence \\${ch}`);
    }
  }

  function parseBasicString(isMultiline = false) {
    if (isMultiline) {
      if (src[pos] === '\r' && src[pos + 1] === '\n') pos += 2;
      else if (src[pos] === '\n') pos++;

      let result = '';
      while (pos < len) {
        if (src.startsWith('"""', pos)) {
          pos += 3;
          return result;
        }
        if (src[pos] === '\\') {
          pos++;
          if (pos >= len) throw new Error('Unterminated multiline string escape');
          const nextCh = src[pos];
          if (nextCh === '\r' || nextCh === '\n') {
            if (nextCh === '\r' && src[pos + 1] === '\n') pos++;
            pos++;
            while (pos < len && (src[pos] === ' ' || src[pos] === '\t' || src[pos] === '\r' || src[pos] === '\n')) {
              pos++;
            }
            continue;
          }
          result += parseEscapeChar();
        } else {
          result += src[pos++];
        }
      }
      throw new Error('Unterminated multiline basic string');
    }

    let result = '';
    while (pos < len) {
      const ch = src[pos++];
      if (ch === '"') {
        return result;
      }
      if (ch === '\n' || ch === '\r') {
        throw new Error('Unescaped newline in single-line basic string');
      }
      if (ch === '\\') {
        result += parseEscapeChar();
      } else {
        result += ch;
      }
    }
    throw new Error('Unterminated basic string');
  }

  function parseLiteralString(isMultiline = false) {
    if (isMultiline) {
      if (src[pos] === '\r' && src[pos + 1] === '\n') pos += 2;
      else if (src[pos] === '\n') pos++;

      let result = '';
      while (pos < len) {
        if (src.startsWith("'''", pos)) {
          pos += 3;
          return result;
        }
        result += src[pos++];
      }
      throw new Error('Unterminated multiline literal string');
    }

    let result = '';
    while (pos < len) {
      const ch = src[pos++];
      if (ch === "'") return result;
      if (ch === '\n' || ch === '\r') throw new Error('Unescaped newline in single-line literal string');
      result += ch;
    }
    throw new Error('Unterminated literal string');
  }

  function parseKeySegment() {
    skipWhitespace(false);
    if (src[pos] === '"') {
      pos++;
      return parseBasicString(false);
    }
    if (src[pos] === "'") {
      pos++;
      return parseLiteralString(false);
    }
    return parseBareKey();
  }

  function parseKey() {
    const keys = [parseKeySegment()];
    while (true) {
      skipWhitespace(false);
      if (src[pos] === '.') {
        pos++;
        skipWhitespace(false);
        keys.push(parseKeySegment());
      } else {
        break;
      }
    }
    return keys;
  }

  function parseValue() {
    skipWhitespace(false);
    if (pos >= len) throw new Error('Unexpected EOF when expecting value');

    // Strings
    if (src.startsWith('"""', pos)) {
      pos += 3;
      return parseBasicString(true);
    }
    if (src[pos] === '"') {
      pos++;
      return parseBasicString(false);
    }
    if (src.startsWith("'''", pos)) {
      pos += 3;
      return parseLiteralString(true);
    }
    if (src[pos] === "'") {
      pos++;
      return parseLiteralString(false);
    }

    // Boolean
    if (src.startsWith('true', pos) && !/[a-zA-Z0-9_-]/.test(src[pos + 4] || '')) {
      pos += 4;
      return true;
    }
    if (src.startsWith('false', pos) && !/[a-zA-Z0-9_-]/.test(src[pos + 5] || '')) {
      pos += 5;
      return false;
    }

    // Array
    if (src[pos] === '[') {
      pos++;
      const arr = [];
      while (pos < len) {
        skipWhitespaceAndCommentsInMultiline();
        if (src[pos] === ']') {
          pos++;
          return arr;
        }
        arr.push(parseValue());
        skipWhitespaceAndCommentsInMultiline();
        if (src[pos] === ',') {
          pos++;
          skipWhitespaceAndCommentsInMultiline();
          if (src[pos] === ']') {
            pos++;
            return arr;
          }
        } else if (src[pos] === ']') {
          pos++;
          return arr;
        } else {
          throw new Error(`Expected ',' or ']' in array at pos ${pos}, found '${src[pos] || 'EOF'}'`);
        }
      }
      throw new Error('Unterminated array');
    }

    // Inline Table
    if (src[pos] === '{') {
      pos++;
      const tbl = {};
      skipWhitespace(false);
      if (src[pos] === '}') {
        pos++;
        return tbl;
      }
      while (pos < len) {
        skipWhitespace(false);
        const keyParts = parseKey();
        skipWhitespace(false);
        expect('=');
        skipWhitespace(false);
        const val = parseValue();

        let cur = tbl;
        for (let i = 0; i < keyParts.length - 1; i++) {
          const k = keyParts[i];
          if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) {
            cur[k] = {};
          }
          cur = cur[k];
        }
        const lastKey = keyParts[keyParts.length - 1];
        if (Object.prototype.hasOwnProperty.call(cur, lastKey)) {
          throw new Error(`Duplicate key "${keyParts.join('.')}" in inline table`);
        }
        cur[lastKey] = val;

        skipWhitespace(false);
        if (src[pos] === ',') {
          pos++;
          skipWhitespace(false);
          if (src[pos] === '}') {
            pos++;
            return tbl;
          }
        } else if (src[pos] === '}') {
          pos++;
          return tbl;
        } else {
          throw new Error(`Expected ',' or '}' in inline table at pos ${pos}, found '${src[pos] || 'EOF'}'`);
        }
      }
      throw new Error('Unterminated inline table');
    }

    // Numbers & Dates
    const valStart = pos;
    while (pos < len && !/[ \t\r\n#,\]}]/.test(src[pos])) {
      pos++;
    }
    const raw = src.slice(valStart, pos);
    if (!raw) {
      throw new Error(`Expected value at position ${valStart}`);
    }

    if (raw === 'inf' || raw === '+inf') return Infinity;
    if (raw === '-inf') return -Infinity;
    if (raw === 'nan' || raw === '+nan' || raw === '-nan') return NaN;

    function parseInteger(cleanStr) {
      const bi = BigInt(cleanStr);
      if (bi >= BigInt(Number.MIN_SAFE_INTEGER) && bi <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(bi);
      }
      return bi;
    }

    if (/^0x[0-9a-fA-F](_?[0-9a-fA-F])*$/.test(raw)) {
      return parseInteger(raw.replace(/_/g, ''));
    }
    if (/^0o[0-7](_?[0-7])*$/.test(raw)) {
      return parseInteger(raw.replace(/_/g, ''));
    }
    if (/^0b[01](_?[01])*$/.test(raw)) {
      return parseInteger(raw.replace(/_/g, ''));
    }

    if (/^[+-]?(?:0|[1-9](?:_?\d)*)$/.test(raw)) {
      return parseInteger(raw.replace(/_/g, ''));
    }
    if (/^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?$/.test(raw) ||
        /^[+-]?0\.\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?$/.test(raw)) {
      return parseFloat(raw.replace(/_/g, ''));
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw;
    }

    throw new Error(`Invalid TOML value: "${raw}" at pos ${valStart}`);
  }

  const root = {};
  let currentTable = root;

  while (pos < len) {
    skipWhitespace(false);
    if (pos >= len) break;

    const ch = src[pos];
    if (ch === '\n') {
      pos++;
      continue;
    }
    if (ch === '#') {
      while (pos < len && src[pos] !== '\n') pos++;
      continue;
    }

    if (ch === '[') {
      if (src.startsWith('[[', pos)) {
        pos += 2;
        skipWhitespace(false);
        const tableKeys = parseKey();
        skipWhitespace(false);
        if (!src.startsWith(']]', pos)) {
          throw new Error(`Expected ']]' after table header at pos ${pos}`);
        }
        pos += 2;

        let cur = root;
        for (let i = 0; i < tableKeys.length - 1; i++) {
          const k = tableKeys[i];
          if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
          if (Array.isArray(cur[k])) cur = cur[k][cur[k].length - 1];
          else cur = cur[k];
        }
        const lastKey = tableKeys[tableKeys.length - 1];
        if (!cur[lastKey]) cur[lastKey] = [];
        if (!Array.isArray(cur[lastKey])) {
          throw new Error(`Cannot define array of tables on existing non-array table "${tableKeys.join('.')}"`);
        }
        const newTable = {};
        cur[lastKey].push(newTable);
        currentTable = newTable;
        continue;
      }

      pos++;
      skipWhitespace(false);
      const tableKeys = parseKey();
      skipWhitespace(false);
      if (src[pos] !== ']') {
        throw new Error(`Expected ']' after table header at pos ${pos}`);
      }
      pos++;

      let cur = root;
      for (let i = 0; i < tableKeys.length; i++) {
        const k = tableKeys[i];
        if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) {
          cur[k] = {};
        }
        cur = cur[k];
      }
      currentTable = cur;
      continue;
    }

    const keyParts = parseKey();
    skipWhitespace(false);
    expect('=');
    skipWhitespace(false);
    const value = parseValue();

    skipWhitespace(false);
    if (pos < len && src[pos] !== '\n' && src[pos] !== '\r' && src[pos] !== '#') {
      throw new Error(`Unexpected character '${src[pos]}' after value at pos ${pos}`);
    }

    let cur = currentTable;
    for (let i = 0; i < keyParts.length - 1; i++) {
      const k = keyParts[i];
      if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) {
        cur[k] = {};
      }
      cur = cur[k];
    }
    const lastKey = keyParts[keyParts.length - 1];
    if (Object.prototype.hasOwnProperty.call(cur, lastKey)) {
      throw new Error(`Duplicate key "${keyParts.join('.')}" in table`);
    }
    cur[lastKey] = value;
  }

  return root;
}

/**
 * Safely clones a configuration object supporting primitives, BigInt, arrays, and plain objects.
 */
export function cloneConfig(val) {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(cloneConfig);
  const result = {};
  for (const [k, v] of Object.entries(val)) {
    result[k] = cloneConfig(v);
  }
  return result;
}

/**
 * Formats values safely for diagnostics without throwing on BigInt.
 */
function formatValue(v) {
  if (typeof v === 'bigint') return v.toString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Recursively diffs two configuration objects and reports missing tables, missing keys,
 * mutated key paths, and unexpectedly injected settings.
 */
export function diffConfigObjects(before, after) {
  const missingTables = [];
  const missingKeys = [];
  const mutatedKeys = [];
  const addedTables = [];
  const addedKeys = [];

  function isObject(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
  }

  function valuesEqual(a, b) {
    if (a === b) return true;

    // Both are BigInt
    if (typeof a === 'bigint' && typeof b === 'bigint') {
      return a === b;
    }

    // Mathematical integer comparison between BigInt and safe integer Number
    if (typeof a === 'bigint' && typeof b === 'number') {
      return Number.isSafeInteger(b) && a === BigInt(b);
    }
    if (typeof a === 'number' && typeof b === 'bigint') {
      return Number.isSafeInteger(a) && BigInt(a) === b;
    }

    // Both are Number (floats and safe integers)
    if (typeof a === 'number' && typeof b === 'number') {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      return Object.is(a, b) || a === b;
    }

    // Unrelated types must not be conflated
    if (a === null || b === null || typeof a !== typeof b) return false;

    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!valuesEqual(a[i], b[i])) return false;
      }
      return true;
    }

    if (isObject(a)) {
      if (!isObject(b)) return false;
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      for (const k of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!valuesEqual(a[k], b[k])) return false;
      }
      return true;
    }

    return false;
  }

  function walk(bObj, aObj, currentPath = '') {
    for (const key of Object.keys(bObj)) {
      const path = currentPath ? `${currentPath}.${key}` : key;
      const bVal = bObj[key];

      if (!Object.prototype.hasOwnProperty.call(aObj, key)) {
        if (isObject(bVal) || (Array.isArray(bVal) && bVal.every(isObject))) {
          missingTables.push(path);
        } else {
          missingKeys.push(path);
        }
        continue;
      }

      const aVal = aObj[key];
      if (isObject(bVal)) {
        if (!isObject(aVal)) {
          mutatedKeys.push({ path, before: bVal, after: aVal });
        } else {
          walk(bVal, aVal, path);
        }
      } else {
        if (!valuesEqual(bVal, aVal)) {
          mutatedKeys.push({ path, before: bVal, after: aVal });
        }
      }
    }

    for (const key of Object.keys(aObj)) {
      const path = currentPath ? `${currentPath}.${key}` : key;
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) {
        const aVal = aObj[key];
        if (isObject(aVal) || (Array.isArray(aVal) && aVal.every(isObject))) {
          addedTables.push(path);
        } else {
          addedKeys.push(path);
        }
      }
    }
  }

  walk(before, after);

  return {
    missingTables,
    missingKeys,
    mutatedKeys,
    addedTables,
    addedKeys,
  };
}

/**
 * Removes only the target MCP server table/entry from a configuration object,
 * preserving all sibling servers and unrelated configuration.
 */
function cleanTargetServer(obj, server) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = cloneConfig(obj);

  if (clone.mcp_servers && typeof clone.mcp_servers === 'object' && !Array.isArray(clone.mcp_servers)) {
    delete clone.mcp_servers[server];
    if (Object.keys(clone.mcp_servers).length === 0) delete clone.mcp_servers;
  }
  if (clone.mcpServers && typeof clone.mcpServers === 'object' && !Array.isArray(clone.mcpServers)) {
    delete clone.mcpServers[server];
    if (Object.keys(clone.mcpServers).length === 0) delete clone.mcpServers;
  }
  if (clone[server]) {
    delete clone[server];
  }
  // Single-server transport descriptor fallback (e.g. mock test harnesses)
  if (clone.transport && (clone.transport.command || clone.transport.type)) {
    delete clone.transport;
  }

  return clone;
}

/**
 * Validates whether unrelated configuration entries were preserved during provider integration.
 * Distinguishes harmless provider-native normalization (whitespace, quoting, comment stripping, table ordering,
 * numeric representations) from destructive loss or unauthorized mutation of unrelated user settings.
 */
export function validateUnrelatedPreserved({
  format = 'toml',
  beforeBytes,
  afterBytes,
  server = 'afyx_graph',
}) {
  if (!beforeBytes) {
    return {
      preserved: true,
      normalized: false,
      code: 'INITIAL_CONFIG_CREATED',
      missingTables: [],
      missingKeys: [],
      mutatedKeys: [],
      detail: 'Initial configuration created.',
    };
  }

  const exactSame = byteEquals(beforeBytes, afterBytes);
  if (exactSame) {
    return {
      preserved: true,
      normalized: false,
      code: 'PRESERVED',
      missingTables: [],
      missingKeys: [],
      mutatedKeys: [],
      detail: 'Configuration bytes unchanged.',
    };
  }

  if (format === 'json') {
    let cleanBefore;
    try {
      const beforeObj = JSON.parse(beforeBytes.toString('utf8'));
      cleanBefore = cleanTargetServer(beforeObj, server);
    } catch (err) {
      return {
        preserved: false,
        normalized: false,
        code: 'INVALID_JSON',
        missingTables: [],
        missingKeys: [],
        mutatedKeys: [],
        detail: `Failed to parse JSON for semantic validation: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!afterBytes) {
      const hadUnrelated = Object.keys(cleanBefore).length > 0;
      return {
        preserved: !hadUnrelated,
        normalized: false,
        code: hadUnrelated ? 'UNRELATED_CONFIG_DELETED' : 'PRESERVED',
        missingTables: [],
        missingKeys: [],
        mutatedKeys: [],
        detail: hadUnrelated
          ? 'Configuration file containing unrelated settings was deleted.'
          : 'Configuration file cleanly removed as no unrelated settings existed.',
      };
    }

    let cleanAfter;
    try {
      const afterObj = JSON.parse(afterBytes.toString('utf8'));
      cleanAfter = cleanTargetServer(afterObj, server);
    } catch (err) {
      return {
        preserved: false,
        normalized: false,
        code: 'INVALID_JSON',
        missingTables: [],
        missingKeys: [],
        mutatedKeys: [],
        detail: `Failed to parse JSON for semantic validation: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const diff = diffConfigObjects(cleanBefore, cleanAfter);
    const unrelatedMatch = diff.missingTables.length === 0
      && diff.missingKeys.length === 0
      && diff.mutatedKeys.length === 0
      && diff.addedTables.length === 0
      && diff.addedKeys.length === 0;

    let code = 'PRESERVED';
    let detail = 'Provider normalized JSON formatting; unrelated settings preserved.';
    if (!unrelatedMatch) {
      if (diff.mutatedKeys.length > 0) {
        code = 'UNRELATED_KEY_VALUE_MUTATED';
        detail = `UNRELATED_KEY_VALUE_MUTATED: Setting at "${diff.mutatedKeys[0].path}" was changed.`;
      } else if (diff.missingKeys.length > 0) {
        code = 'UNRELATED_KEY_DELETED';
        detail = `UNRELATED_KEY_DELETED: Unrelated key "${diff.missingKeys[0]}" was removed.`;
      } else if (diff.missingTables.length > 0) {
        code = 'UNRELATED_TABLE_DELETED';
        detail = `UNRELATED_TABLE_DELETED: Unrelated table "${diff.missingTables[0]}" was removed.`;
      } else {
        code = 'UNRELATED_SETTING_INJECTED';
        detail = 'Provider tooling altered unrelated JSON settings.';
      }
    }

    return {
      preserved: unrelatedMatch,
      normalized: true,
      code,
      missingTables: diff.missingTables,
      missingKeys: diff.missingKeys,
      mutatedKeys: diff.mutatedKeys,
      detail,
    };
  }

  if (format === 'toml') {
    let cleanBefore;
    try {
      const beforeStr = beforeBytes.toString('utf8');
      let beforeObj;
      try {
        beforeObj = parseToml(beforeStr);
      } catch (tomlErr) {
        if (beforeStr.trim().startsWith('{') && beforeStr.trim().endsWith('}')) {
          beforeObj = JSON.parse(beforeStr);
        } else {
          throw tomlErr;
        }
      }
      cleanBefore = cleanTargetServer(beforeObj, server);
    } catch (err) {
      return {
        preserved: false,
        normalized: false,
        code: 'INVALID_TOML',
        error: err instanceof Error ? err.message : String(err),
        missingTables: [],
        missingKeys: [],
        mutatedKeys: [],
        detail: `Failed to parse TOML for semantic validation: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!afterBytes) {
      const hadUnrelated = Object.keys(cleanBefore).length > 0;
      return {
        preserved: !hadUnrelated,
        normalized: false,
        code: hadUnrelated ? 'UNRELATED_CONFIG_DELETED' : 'PRESERVED',
        missingTables: [],
        missingKeys: [],
        mutatedKeys: [],
        detail: hadUnrelated
          ? 'Configuration file containing unrelated settings was deleted.'
          : 'Configuration file cleanly removed as no unrelated settings existed.',
      };
    }

    let cleanAfter;
    try {
      const afterStr = afterBytes.toString('utf8');
      let afterObj;
      try {
        afterObj = parseToml(afterStr);
      } catch (tomlErr) {
        if (afterStr.trim().startsWith('{') && afterStr.trim().endsWith('}')) {
          afterObj = JSON.parse(afterStr);
        } else {
          throw tomlErr;
        }
      }
      cleanAfter = cleanTargetServer(afterObj, server);
    } catch (err) {
      return {
        preserved: false,
        normalized: false,
        code: 'INVALID_TOML',
        error: err instanceof Error ? err.message : String(err),
        missingTables: [],
        missingKeys: [],
        mutatedKeys: [],
        detail: `Failed to parse TOML for semantic validation: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const diff = diffConfigObjects(cleanBefore, cleanAfter);
    const preserved = diff.missingTables.length === 0
      && diff.missingKeys.length === 0
      && diff.mutatedKeys.length === 0
      && diff.addedTables.length === 0
      && diff.addedKeys.length === 0;

    let code = 'PRESERVED';
    let detail = 'Provider normalized TOML formatting; unrelated tables and keys preserved.';

    if (!preserved) {
      if (diff.mutatedKeys.length > 0) {
        const first = diff.mutatedKeys[0];
        code = 'UNRELATED_KEY_VALUE_MUTATED';
        detail = `UNRELATED_KEY_VALUE_MUTATED: Setting at "${first.path}" was changed from ${formatValue(first.before)} to ${formatValue(first.after)}`;
      } else if (diff.missingKeys.length > 0) {
        const first = diff.missingKeys[0];
        code = 'UNRELATED_KEY_DELETED';
        detail = `UNRELATED_KEY_DELETED: Unrelated key "${first}" was removed.`;
      } else if (diff.missingTables.length > 0) {
        const first = diff.missingTables[0];
        code = 'UNRELATED_TABLE_DELETED';
        detail = `UNRELATED_TABLE_DELETED: Unrelated table "${first}" was removed.`;
      } else if (diff.addedKeys.length > 0 || diff.addedTables.length > 0) {
        const first = diff.addedKeys[0] || diff.addedTables[0];
        code = 'UNRELATED_SETTING_INJECTED';
        detail = `UNRELATED_SETTING_INJECTED: Unrelated setting "${first}" was unexpectedly added.`;
      }
    }

    return {
      preserved,
      normalized: true,
      code,
      missingTables: diff.missingTables,
      missingKeys: diff.missingKeys,
      mutatedKeys: diff.mutatedKeys,
      detail,
    };
  }

  return {
    preserved: true,
    normalized: true,
    code: 'PRESERVED',
    missingTables: [],
    missingKeys: [],
    mutatedKeys: [],
    detail: 'Unrelated validation completed.',
  };
}

/**
 * Lists existing backups for a specific provider.
 */
export function listProviderBackups(provider, backupRoot = '') {
  const root = getProviderBackupRoot(backupRoot);
  const providerDir = join(root, 'provider-config', provider);
  if (!existsSync(providerDir)) return [];

  return readdirSync(providerDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.meta.json'))
    .map((e) => {
      const metaPath = join(providerDir, e.name);
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        return {
          ...meta,
          metaPath,
          backupPath: metaPath.slice(0, -'.meta.json'.length),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
