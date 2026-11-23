/**
 * AFYX Workspace Path Containment Utility (AfyxPathContainment/v1).
 *
 * Enforces strict filesystem containment within an authorized workspace root:
 * - Canonical root normalization with realpath verification
 * - Relative and absolute path traversal rejection (../ escapes, foreign drive letters)
 * - Symlink resolution and symlink escape rejection
 * - Type assertions (rejecting directories where regular files are expected)
 * - Safe handling of nonexistent targets via ancestor verification
 */

import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const PATH_CONTAINMENT_CONTRACT = 'AfyxPathContainment/v1';

export function canonicalizePath(pathStr) {
  return realpathSync.native(resolve(pathStr));
}

function isInside(root, target) {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function refused(reason, error) {
  return { contained: false, reason, error };
}

/** Check a path against both the authorized root alias and its physical directory. */
export function checkPathContainment(targetPath, workspaceRoot, options = {}) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return refused('INVALID_TARGET_PATH', 'Target path must be a non-empty string.');
  }
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    return refused('INVALID_WORKSPACE_ROOT', 'Workspace root must be a non-empty string.');
  }

  const logicalRoot = resolve(workspaceRoot);
  let canonicalRoot;
  try {
    canonicalRoot = canonicalizePath(logicalRoot);
    if (!statSync(canonicalRoot).isDirectory()) {
      return refused('INVALID_WORKSPACE_ROOT', 'Workspace root must be a directory.');
    }
  } catch (err) {
    return refused('CANONICALIZATION_FAILED', `Cannot verify workspace root: ${err.code}.`);
  }

  const resolvedTarget = resolve(logicalRoot, targetPath);
  if (!isInside(logicalRoot, resolvedTarget) &&
      !(isAbsolute(targetPath) && isInside(canonicalRoot, resolvedTarget))) {
    return refused('PATH_TRAVERSAL_ESCAPE', `Target path '${targetPath}' resolves outside workspace root.`);
  }

  let ancestor = resolvedTarget;
  const missing = [];
  while (true) {
    try {
      const canonical = canonicalizePath(ancestor);
      // Windows path.relative ignores case even on case-sensitive NTFS directories.
      if (!isInside(canonicalRoot, canonical) ||
          resolve(canonicalRoot, relative(canonicalRoot, canonical)) !== canonical) {
        const reason = missing.length ? 'ANCESTOR_ESCAPE' : 'SYMLINK_ESCAPE';
        return refused(reason, `Target path '${targetPath}' resolves outside workspace root.`);
      }

      const stat = statSync(canonical);
      if (missing.length) {
        if (!stat.isDirectory()) {
          return refused('CANONICALIZATION_FAILED', 'Target ancestor is not a directory.');
        }
        if (options.mustExist) {
          return refused('TARGET_NOT_FOUND', `Target path '${targetPath}' does not exist.`);
        }
        return { contained: true, canonicalPath: resolve(canonical, ...missing) };
      }
      if (options.expectFile && !stat.isFile()) {
        return refused('DIRECTORY_NOT_ALLOWED', `Expected a regular file at '${targetPath}'.`);
      }
      if (options.expectDirectory && !stat.isDirectory()) {
        return refused('EXPECTED_DIRECTORY', `Expected a directory at '${targetPath}'.`);
      }
      return { contained: true, canonicalPath: canonical };
    } catch (err) {
      if (err.code !== 'ENOENT' || ancestor === logicalRoot || ancestor === canonicalRoot) {
        return refused('CANONICALIZATION_FAILED', `Cannot verify target path: ${err.code}.`);
      }
      try {
        // A dangling link exists as an entry even though realpath reports ENOENT.
        if (lstatSync(ancestor, { throwIfNoEntry: false })) {
          return refused('CANONICALIZATION_FAILED', 'Target path contains an unresolved entry.');
        }
      } catch (probeError) {
        return refused('CANONICALIZATION_FAILED', `Cannot verify target entry: ${probeError.code}.`);
      }
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

/**
 * Asserts path containment, throwing a fail-closed error if breached.
 *
 * @param {string} targetPath
 * @param {string} workspaceRoot
 * @param {object} [options]
 * @returns {string} The canonical contained path
 */
export function assertPathContained(targetPath, workspaceRoot, options = {}) {
  const check = checkPathContainment(targetPath, workspaceRoot, options);
  if (!check.contained) {
    const err = new Error(check.error || 'Access denied: path is outside authorized workspace.');
    err.code = check.reason || 'ERR_PATH_TRAVERSAL_ESCAPE';
    throw err;
  }
  return check.canonicalPath;
}
