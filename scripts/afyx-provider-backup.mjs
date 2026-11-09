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

function deepSemanticEquals(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepSemanticEquals(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepSemanticEquals(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Validates whether unrelated configuration entries were preserved during provider integration.
 * Distinguishes harmless provider-native normalization (whitespace, quoting, comment stripping, table ordering)
 * from destructive loss of unrelated user settings.
 */
export function validateUnrelatedPreserved({
  format = 'toml',
  beforeBytes,
  afterBytes,
  server = 'afyx_graph',
}) {
  if (!beforeBytes) return { preserved: true, normalized: false, detail: 'Initial configuration created.' };

  const exactSame = byteEquals(beforeBytes, afterBytes);
  if (exactSame) return { preserved: true, normalized: false, detail: 'Configuration bytes unchanged.' };

  if (format === 'json') {
    try {
      const beforeObj = JSON.parse(beforeBytes.toString('utf8'));
      const cleanBefore = JSON.parse(JSON.stringify(beforeObj));
      if (cleanBefore.mcpServers) {
        delete cleanBefore.mcpServers[server];
        if (Object.keys(cleanBefore.mcpServers).length === 0) delete cleanBefore.mcpServers;
      }

      if (!afterBytes) {
        const hadUnrelated = Object.keys(cleanBefore).length > 0;
        return {
          preserved: !hadUnrelated,
          normalized: false,
          detail: hadUnrelated
            ? 'Configuration file containing unrelated settings was deleted.'
            : 'Configuration file cleanly removed as no unrelated settings existed.',
        };
      }

      const afterObj = JSON.parse(afterBytes.toString('utf8'));
      const cleanAfter = JSON.parse(JSON.stringify(afterObj));
      if (cleanAfter.mcpServers) {
        delete cleanAfter.mcpServers[server];
        if (Object.keys(cleanAfter.mcpServers).length === 0) delete cleanAfter.mcpServers;
      }

      const unrelatedMatch = deepSemanticEquals(cleanBefore, cleanAfter);
      return {
        preserved: unrelatedMatch,
        normalized: true,
        detail: unrelatedMatch
          ? 'Provider normalized JSON formatting; unrelated settings preserved.'
          : 'Provider tooling altered unrelated JSON settings.',
      };
    } catch {
      return { preserved: false, normalized: false, detail: 'Failed to parse JSON for semantic validation.' };
    }
  }

  if (format === 'toml') {
    const beforeStr = beforeBytes.toString('utf8');

    // Extract table headers and simple key=value pairs outside the target mcp server
    const extractKeysAndTables = (str) => {
      const lines = str.split(/\r?\n/);
      const tables = new Set();
      const keys = [];
      let currentTable = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const tableMatch = trimmed.match(/^\[([^\]]+)\]/);
        if (tableMatch) {
          currentTable = tableMatch[1].trim();
          if (!currentTable.includes(server)) tables.add(currentTable);
          continue;
        }

        if (currentTable.includes(server)) continue;

        const kvMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*=/);
        if (kvMatch) {
          keys.push(`${currentTable}:${kvMatch[1]}`);
        }
      }
      return { tables, keys };
    };

    const beforeInfo = extractKeysAndTables(beforeStr);

    if (!afterBytes) {
      const hadUnrelated = beforeInfo.tables.size > 0 || beforeInfo.keys.length > 0;
      return {
        preserved: !hadUnrelated,
        normalized: false,
        detail: hadUnrelated
          ? 'Configuration file containing unrelated settings was deleted.'
          : 'Configuration file cleanly removed as no unrelated settings existed.',
      };
    }

    const afterStr = afterBytes.toString('utf8');
    const afterInfo = extractKeysAndTables(afterStr);

    // Check that every table in before exists in after
    const missingTables = [...beforeInfo.tables].filter((t) => !afterInfo.tables.has(t));
    const missingKeys = beforeInfo.keys.filter((k) => !afterInfo.keys.includes(k));

    const preserved = missingTables.length === 0 && missingKeys.length === 0;
    return {
      preserved,
      normalized: true,
      missingTables,
      missingKeys,
      detail: preserved
        ? 'Provider normalized TOML formatting; unrelated tables and keys preserved.'
        : `Provider tooling dropped unrelated settings: tables=[${missingTables.join(', ')}], keys=[${missingKeys.join(', ')}]`,
    };
  }

  return { preserved: true, normalized: true, detail: 'Unrelated validation completed.' };
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
