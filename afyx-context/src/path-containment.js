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

import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const PATH_CONTAINMENT_CONTRACT = 'AfyxPathContainment/v1';

/**
 * Normalizes and canonicalizes a path if it exists on disk.
 *
 * @param {string} pathStr
 * @returns {string}
 */
export function canonicalizePath(pathStr) {
  const resolved = resolve(pathStr);
  try {
    if (existsSync(resolved)) {
      return realpathSync(resolved);
    }
  } catch {
    // Fall back to resolved path on permission or filesystem probe error
  }
  return resolved;
}

/**
 * Checks whether a target path is strictly contained within an authorized workspace root.
 *
 * @param {string} targetPath Relative or absolute target path
 * @param {string} workspaceRoot Canonical authorized workspace root
 * @param {object} [options]
 * @param {boolean} [options.expectFile=false] Require target to be a regular file if it exists
 * @param {boolean} [options.expectDirectory=false] Require target to be a directory if it exists
 * @param {boolean} [options.mustExist=false] Reject target if it does not exist
 * @returns {{ contained: boolean, canonicalPath?: string, error?: string, reason?: string }}
 */
export function checkPathContainment(targetPath, workspaceRoot, options = {}) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return { contained: false, reason: 'INVALID_TARGET_PATH', error: 'Target path must be a non-empty string.' };
  }
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    return { contained: false, reason: 'INVALID_WORKSPACE_ROOT', error: 'Workspace root must be a non-empty string.' };
  }

  const canonicalRoot = canonicalizePath(workspaceRoot);
  const resolvedTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(canonicalRoot, targetPath);

  // 1. Initial relative traversal check on un-dereferenced path
  const unreferencedRel = relative(canonicalRoot, resolvedTarget);
  if (unreferencedRel.startsWith('..') || isAbsolute(unreferencedRel)) {
    return {
      contained: false,
      reason: 'PATH_TRAVERSAL_ESCAPE',
      error: `Path '${targetPath}' resolves outside workspace root '${workspaceRoot}'.`,
    };
  }

  // 2. Existing path check with symlink dereferencing
  if (existsSync(resolvedTarget)) {
    let canonicalTarget;
    let stat;
    try {
      canonicalTarget = realpathSync(resolvedTarget);
      stat = statSync(canonicalTarget);
    } catch (err) {
      return {
        contained: false,
        reason: 'CANONICALIZATION_FAILED',
        error: `Failed to resolve realpath for '${targetPath}': ${err.message}`,
      };
    }

    // Verify canonical path containment
    const canonicalRel = relative(canonicalRoot, canonicalTarget);
    if (canonicalRel.startsWith('..') || isAbsolute(canonicalRel)) {
      return {
        contained: false,
        reason: 'SYMLINK_ESCAPE',
        error: `Target path '${targetPath}' dereferences to '${canonicalTarget}' outside workspace root.`,
      };
    }

    if (options.expectFile && stat.isDirectory()) {
      return {
        contained: false,
        reason: 'DIRECTORY_NOT_ALLOWED',
        error: `Expected a regular file but path '${targetPath}' is a directory.`,
      };
    }

    if (options.expectDirectory && !stat.isDirectory()) {
      return {
        contained: false,
        reason: 'EXPECTED_DIRECTORY',
        error: `Expected a directory but path '${targetPath}' is not a directory.`,
      };
    }

    return {
      contained: true,
      canonicalPath: canonicalTarget,
    };
  }

  // 3. Target does not exist
  if (options.mustExist) {
    return {
      contained: false,
      reason: 'TARGET_NOT_FOUND',
      error: `Target path '${targetPath}' does not exist.`,
    };
  }

  // Verify deepest existing ancestor
  let ancestor = dirname(resolvedTarget);
  while (ancestor && !existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }

  if (existsSync(ancestor)) {
    let canonicalAncestor;
    try {
      canonicalAncestor = realpathSync(ancestor);
    } catch {
      canonicalAncestor = resolve(ancestor);
    }
    const ancestorRel = relative(canonicalRoot, canonicalAncestor);
    if (ancestorRel.startsWith('..') || isAbsolute(ancestorRel)) {
      return {
        contained: false,
        reason: 'ANCESTOR_ESCAPE',
        error: `Ancestor of target path '${targetPath}' resolves outside workspace root.`,
      };
    }
  }

  return {
    contained: true,
    canonicalPath: resolvedTarget,
  };
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
