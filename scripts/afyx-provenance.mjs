/**
 * AFYX Artifact Integrity & Provenance Engine (AfyxProvenance/v1)
 *
 * Provides deterministic artifact identity, SHA-256 integrity verification,
 * source revision traceability, and tamper detection for AFYX release artifacts,
 * test outputs, benchmarks, and evidence receipts.
 *
 * Clean-Room AFYX-Native Implementation:
 * - Pure Node.js crypto and path modules.
 * - Zero third-party runtime or library dependencies.
 * - Deterministic, sorted canonical manifest hashing.
 * - Fails closed on file drift, truncation, or unexpected mutation.
 */

import { sha256Bytes } from '../afyx-context/src/artifact-lineage.js';
import { checkPathContainment } from '../afyx-context/src/path-containment.js';
export { createArtifactLineage, verifyArtifactLineage } from '../afyx-context/src/artifact-lineage.js';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

export const AFYX_PROVENANCE_CONTRACT = 'AfyxProvenance/v1';

function sha256String(text) {
  return sha256Bytes(Buffer.from(text, 'utf8'));
}

/**
 * Computes deterministic SHA-256 hash of a single file on disk.
 */
export function hashFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symbolic links not permitted in provenance calculation: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Target is not a regular file: ${filePath}`);
  }
  const content = readFileSync(filePath);
  return {
    path: normalize(filePath).replace(/\\/g, '/'),
    sizeBytes: stat.size,
    sha256: sha256Bytes(content),
    mtime: stat.mtime.toISOString(),
  };
}

/**
 * Builds a deterministic, sorted SHA-256 artifact manifest for a directory.
 */
export function createArtifactManifest(directoryPath, options = {}) {
  const {
    sourceRevision = 'UNKNOWN',
    relativeTo = directoryPath,
    excludePatterns = ['.git', 'node_modules', '.afyx-graph', 'tmp', 'temp'],
  } = options;

  if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    throw new Error(`Invalid directory path for artifact manifest: ${directoryPath}`);
  }

  const fileEntries = [];

  function walk(dir) {
    const entries = readdirSync(dir).sort();
    for (const name of entries) {
      if (excludePatterns.some((pattern) => name === pattern || name.includes(pattern))) {
        continue;
      }
      const fullPath = join(dir, name);
      const st = lstatSync(fullPath);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(fullPath);
      } else if (st.isFile()) {
        const fileHash = hashFile(fullPath);
        const relPath = relative(relativeTo, fullPath).replace(/\\/g, '/');
        fileEntries.push({
          path: relPath,
          sizeBytes: fileHash.sizeBytes,
          sha256: fileHash.sha256,
        });
      }
    }
  }

  walk(directoryPath);

  // Stable sort by path
  fileEntries.sort((a, b) => a.path.localeCompare(b.path));

  // Compute composite manifest checksum
  const compositeInput = fileEntries.map((e) => `${e.sha256}  ${e.path}`).join('\n');
  const compositeSha256 = sha256String(compositeInput);

  return Object.freeze({
    contract: AFYX_PROVENANCE_CONTRACT,
    sourceRevision,
    rootDirectory: normalize(relativeTo).replace(/\\/g, '/'),
    fileCount: fileEntries.length,
    compositeSha256,
    files: Object.freeze(fileEntries),
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Verifies a directory against an existing manifest, detecting any tampering or drift.
 */
export function verifyArtifactManifest(manifest, targetDirectory) {
  if (!manifest || manifest.contract !== AFYX_PROVENANCE_CONTRACT || !Array.isArray(manifest.files)) {
    return { verified: false, reason: 'INVALID_MANIFEST_CONTRACT', modified: [], missing: [], untracked: [] };
  }

  const invalid = { verified: false, reason: 'INVALID_MANIFEST_ENTRIES', modified: [], missing: [], untracked: [] };
  const expectedMap = new Map();
  for (const entry of manifest.files) {
    const path = entry?.path;
    if (typeof path !== 'string' || !path || isAbsolute(path) ||
        path.includes('\\') || path.includes(':') ||
        path.split('/').some((part) => !part || part === '..' || part === '.') ||
        expectedMap.has(path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      return invalid;
    }
    expectedMap.set(path, entry);
  }
  if (sha256String(manifest.files.map((entry) => entry.sha256 + '  ' + entry.path).join('\n')) !== manifest.compositeSha256) {
    return invalid;
  }
  const modified = [];
  const missing = [];
  const verifiedFiles = [];

  for (const [relPath, expected] of expectedMap.entries()) {
    const target = checkPathContainment(relPath, targetDirectory, { mustExist: true, expectFile: true });
    if (!target.contained) {
      if (target.reason === 'TARGET_NOT_FOUND') missing.push(relPath);
      else modified.push({ path: relPath, expected: expected.sha256, actual: 'UNREADABLE' });
      continue;
    }

    try {
      const current = hashFile(target.canonicalPath);
      if (current.sha256 !== expected.sha256) {
        modified.push({ path: relPath, expected: expected.sha256, actual: current.sha256 });
      } else {
        verifiedFiles.push(relPath);
      }
    } catch {
      modified.push({ path: relPath, expected: expected.sha256, actual: 'UNREADABLE' });
    }
  }

  const isClean = modified.length === 0 && missing.length === 0;

  return Object.freeze({
    verified: isClean,
    status: isClean ? 'VERIFIED' : 'TAMPERED_OR_DRIFTED',
    sourceRevision: manifest.sourceRevision,
    verifiedCount: verifiedFiles.length,
    modified,
    missing,
    receipt: {
      contract: AFYX_PROVENANCE_CONTRACT,
      compositeSha256: manifest.compositeSha256,
      verifiedAt: new Date().toISOString(),
      passed: isClean,
    },
  });
}
