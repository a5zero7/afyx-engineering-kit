#!/usr/bin/env node

/**
 * AFYX Unified Installer Core
 *
 * Copyright (c) 2026 Afyx
 * Licensed under the MIT License.
 *
 * Consolidates shared cross-platform installer lifecycle responsibilities
 * using Node.js standard-library modules only:
 * - Path normalization and root/symlink containment checks
 * - Component contract loading and alias/version evaluation
 * - Skill manifest (SKILL.md) validation and ownership verification
 * - Backup digest computation, receipt validation, and retention planning
 * - Atomic receipt persistence and deterministic lifecycle action planning
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const INSTALLER_CORE_CONTRACT = 'AfyxInstallerCore/v1';
export const SKILL_MARKER_FILENAME = '.afyx-install.json';
export const SKILL_BACKUP_HEADER = 'AfyxSkillBackup/v1';
export const DEFAULT_BACKUP_LIMIT = 20;

export const LEGACY_COMPONENT_ALIASES = Object.freeze(new Map([
  ['efficient-coding', 'afyx-efficient-coding'],
  ['odoo-engineering', 'afyx-odoo-engineering'],
  ['codex-usage-tracking', 'afyx-usage-intelligence'],
]));

const BACKUP_DIR_PATTERN = /^\d{8}-\d{6}-[a-zA-Z0-9_-]+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const COMPONENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Normalizes a filesystem path by resolving it and stripping trailing separators
 * unless it is a filesystem root.
 */
export function normalizeRootPath(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  const resolved = resolve(targetPath);
  const { root } = parse(resolved);
  if (resolved === root) return resolved;
  return resolved.replace(/[\\/]+$/, '');
}

function pathsEqual(left, right) {
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/**
 * Enforces that `targetPath` is a direct child of `rootPath` and neither path
 * is a symbolic link / reparse point.
 */
export function assertContainedTarget(rootPath, targetPath) {
  const rootNorm = normalizeRootPath(rootPath);
  const targetNorm = normalizeRootPath(targetPath);
  const parentNorm = normalizeRootPath(dirname(targetNorm));

  if (pathsEqual(rootNorm, targetNorm) || !pathsEqual(rootNorm, parentNorm)) {
    throw new Error(`Skill target escapes configured root: ${targetPath}`);
  }

  for (const candidate of [rootNorm, targetNorm]) {
    if (existsSync(candidate)) {
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing reparse-point or symlinked path: ${candidate}`);
      }
    }
  }

  if (existsSync(rootNorm)) {
    const rootReal = normalizeRootPath(realpathSync(rootNorm));
    const parentPath = normalizeRootPath(dirname(targetNorm));
    if (existsSync(parentPath)) {
      const parentReal = normalizeRootPath(realpathSync(parentPath));
      if (!pathsEqual(rootReal, parentReal)) {
        throw new Error(`Skill target escapes canonical root: ${targetPath}`);
      }
    }
  }

  return { root: rootNorm, target: targetNorm };
}

/**
 * Refuses symlinked ancestors and volume/filesystem roots for backup operations.
 */
export function assertSafeBackupPath(targetPath) {
  let current = normalizeRootPath(targetPath);
  const { root } = parse(current);
  if (pathsEqual(current, normalizeRootPath(root))) {
    throw new Error(`Refusing filesystem root as backup path: ${targetPath}`);
  }

  while (current) {
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing reparse-point or symlinked backup path: ${current}`);
      }
    }
    const parent = normalizeRootPath(dirname(current));
    if (pathsEqual(parent, current)) break;
    current = parent;
  }

  return normalizeRootPath(targetPath);
}

/**
 * Loads and validates scripts/components.json.
 */
export function loadComponentsContract(contractPath = join(__dirname, 'components.json')) {
  const raw = readFileSync(contractPath, 'utf8').replace(/^\uFEFF/, '');
  const doc = JSON.parse(raw);
  if (!doc || doc.schema_version !== 1 || doc.control_plane_version !== 1 || !Array.isArray(doc.components)) {
    throw new Error(`Unsupported AFYX component contract in ${contractPath}`);
  }
  return doc;
}

/**
 * Maps legacy component identifiers to canonical AFYX component IDs.
 */
export function resolveComponentId(id) {
  if (typeof id !== 'string') return '';
  return LEGACY_COMPONENT_ALIASES.get(id) ?? id;
}

/**
 * Deterministic semantic version comparison (-1, 0, 1).
 * Pre-release versions sort lower than release versions with identical core tuple.
 */
export function compareSemver(left, right) {
  const parseVersion = (value) => {
    const trimmed = String(value ?? '').trim().replace(/^v/i, '');
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed);
    if (!match) {
      throw new Error(`Invalid semantic version: ${value}`);
    }
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: match[4] ? match[4].split('.') : null,
    };
  };

  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const maxLen = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i >= a.pre.length) return -1;
    if (i >= b.pre.length) return 1;
    const x = a.pre[i];
    const y = b.pre[i];
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Validates a skill directory's SKILL.md frontmatter metadata.
 */
export function validateSkillManifest(skillDir, requireVersion = false) {
  const manifestPath = join(skillDir, 'SKILL.md');
  if (!existsSync(manifestPath)) {
    return { valid: false, reason: 'MISSING_SKILL_MD', name: null, version: null };
  }
  const stat = lstatSync(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { valid: false, reason: 'UNSAFE_SKILL_MD', name: null, version: null };
  }
  const content = readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return { valid: false, reason: 'MISSING_FRONTMATTER', name: null, version: null };
  }
  const endIdx = content.indexOf('\n---\n', 4);
  const endAlt = endIdx === -1 ? content.indexOf('\n---', 4) : endIdx;
  if (endAlt === -1) {
    return { valid: false, reason: 'UNTERMINATED_FRONTMATTER', name: null, version: null };
  }
  const frontmatter = content.slice(4, endAlt);
  const nameMatch = /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(frontmatter);
  const versionMatch = /^\s*version:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(frontmatter);
  const name = nameMatch ? nameMatch[1].trim() : null;
  const version = versionMatch ? versionMatch[1].trim() : null;

  if (!name) {
    return { valid: false, reason: 'MISSING_NAME', name: null, version };
  }
  if (requireVersion && !version) {
    return { valid: false, reason: 'MISSING_VERSION', name, version: null };
  }
  return { valid: true, reason: 'OK', name, version };
}

/**
 * Evaluates whether a component is desired for the given preset, custom list, and providers.
 */
export function isComponentDesired(component, { preset = 'recommended', customComponents = [], providers = ['codex'] } = {}) {
  const validPresets = new Set(['minimal', 'recommended', 'full', 'custom']);
  if (!validPresets.has(preset)) {
    throw new Error(`Unsupported preset: ${preset}`);
  }
  const canonicalId = resolveComponentId(component.id);
  const providerList = Array.isArray(providers)
    ? providers
    : String(providers || '').split(',').map((p) => p.trim()).filter(Boolean);

  if (preset === 'custom') {
    const customResolved = new Set((customComponents || []).map((item) => resolveComponentId(item)));
    if (!customResolved.has(canonicalId)) return false;
  } else {
    const memberships = String(component.presets || '').split(';').filter(Boolean);
    if (!memberships.includes(preset)) return false;
  }

  if (canonicalId === 'afyx-usage-intelligence' && !providerList.includes('codex')) {
    return false;
  }

  const restriction = String(component.providers || '').split(';').filter(Boolean);
  if (restriction.length > 0 && !providerList.some((p) => restriction.includes(p))) {
    return false;
  }
  return true;
}

/**
 * Computes the deterministic skill ownership digest (excludes .afyx-install.json and .git).
 */
export function computeSkillDigest(directory) {
  const root = normalizeRootPath(directory);
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === SKILL_MARKER_FILENAME) continue;
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlinked skill entry: ${full}`);
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  walk(root);
  files.sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });

  const lines = files.map((file) => {
    const rel = relative(root, file).replace(/\\/g, '/');
    const fileHash = createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
    return `${fileHash}  ./${rel}`;
  });
  const payload = `${lines.join('\n')}\n`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Computes the full recovery backup digest (includes markers, .git, hidden files, empty dirs).
 * Refuses symlinks and reparse points.
 */
export function computeBackupDigest(directory) {
  const root = assertSafeBackupPath(directory);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Backup source directory missing: ${root}`);
  }
  const lines = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing reparse-point backup content: ${full}`);
      }
      const rel = relative(root, full).replace(/\\/g, '/');
      if (/[\r\n]/.test(rel)) {
        throw new Error('Backup paths containing newlines are unsupported.');
      }
      if (stat.isDirectory()) {
        lines.push(`D  ${rel}`);
        walk(full);
      } else if (stat.isFile()) {
        const fileHash = createHash('sha256').update(readFileSync(full)).digest('hex').toLowerCase();
        lines.push(`F ${fileHash}  ${rel}`);
      }
    }
  };
  walk(root);
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = `${lines.join('\n')}\n`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Parses and validates an .afyx-install.json receipt/marker.
 */
export function parseSkillMarker(markerPath) {
  if (!existsSync(markerPath)) return null;
  const stat = lstatSync(markerPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Unsafe marker file: ${markerPath}`);
  }
  const parsed = JSON.parse(readFileSync(markerPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!parsed || parsed.schema !== 1 || parsed.product !== 'Afyx Codex Engineering Kit') {
    return null;
  }
  return parsed;
}

/**
 * Atomically writes UTF-8 content to `filePath` using a temp sibling and rename.
 */
export function writeAtomicFile(filePath, content) {
  const target = normalizeRootPath(filePath);
  const parent = dirname(target);
  const temp = join(parent, `.${basename(target)}.afyx-tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, target);
  } catch (err) {
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/**
 * Evaluates installed skill ownership state.
 */
export function evaluateSkillOwnership(targetDir, componentId, expectedOwner = 'afyx') {
  if (!existsSync(targetDir)) return 'NOT_INSTALLED';
  const stat = lstatSync(targetDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return 'UNSAFE';

  const markerPath = join(targetDir, SKILL_MARKER_FILENAME);
  if (!existsSync(markerPath)) return 'FOREIGN_UNPROVEN';

  try {
    const marker = parseSkillMarker(markerPath);
    if (!marker || marker.owner !== expectedOwner) return 'FOREIGN_UNPROVEN';

    const validComponent =
      marker.component === componentId ||
      marker.component === componentId.replace(/^afyx-/, '') ||
      `afyx-${marker.component}` === componentId;
    if (!validComponent) return 'FOREIGN_UNPROVEN';

    if (expectedOwner === 'afyx') {
      if (typeof marker.content_sha256 !== 'string' || !SHA256_HEX_PATTERN.test(marker.content_sha256)) {
        return 'FOREIGN_UNPROVEN';
      }
      const actual = computeSkillDigest(targetDir);
      return actual === marker.content_sha256 ? 'AFYX_OWNED_UNMODIFIED' : 'AFYX_OWNED_MODIFIED';
    }
    return 'FOREIGN_UNPROVEN';
  } catch {
    return 'FOREIGN_UNPROVEN';
  }
}

/**
 * Formats the 4-line AfyxSkillBackup/v1 receipt payload.
 */
export function formatBackupReceipt(component, dirName, digest) {
  if (!COMPONENT_ID_PATTERN.test(component)) {
    throw new Error(`Invalid backup component ID: ${component}`);
  }
  if (!SHA256_HEX_PATTERN.test(digest)) {
    throw new Error(`Invalid backup digest: ${digest}`);
  }
  return `${SKILL_BACKUP_HEADER}\n${component}\n${dirName}\n${digest}\n`;
}

/**
 * Parses and validates an AfyxSkillBackup/v1 receipt.
 */
export function parseBackupReceipt(receiptText, expectedComponent, expectedDirName) {
  const lines = String(receiptText).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length !== 4) return null;
  if (lines[0] !== SKILL_BACKUP_HEADER) return null;
  if (lines[1] !== expectedComponent) return null;
  if (lines[2] !== expectedDirName) return null;
  if (!SHA256_HEX_PATTERN.test(lines[3])) return null;
  return {
    schema: lines[0],
    component: lines[1],
    directory: lines[2],
    digest: lines[3],
  };
}

/**
 * Plans backup retention or purge/prune removals for a component backup root.
 * Only completed, verifiable AFYX backups without `.afyx-active` are eligible.
 */
export function planBackupRetention(componentRoot, component, { limit = DEFAULT_BACKUP_LIMIT, keep = null, protectNew = false } = {}) {
  if (!COMPONENT_ID_PATTERN.test(component)) {
    throw new Error(`Invalid component ID: ${component}`);
  }
  const safeRoot = assertSafeBackupPath(componentRoot);
  if (!existsSync(safeRoot) || !statSync(safeRoot).isDirectory()) {
    return { verified: [], toRemove: [], preserved: [] };
  }

  const verified = [];
  const preserved = [];

  for (const entry of readdirSync(safeRoot, { withFileTypes: true })) {
    const candidate = join(safeRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const activePath = `${candidate}.afyx-active`;
    if (!BACKUP_DIR_PATTERN.test(entry.name) || existsSync(activePath)) {
      preserved.push(candidate);
      continue;
    }

    const receiptPath = `${candidate}.afyx-backup`;
    try {
      assertSafeBackupPath(receiptPath);
      if (!existsSync(receiptPath) || lstatSync(receiptPath).isSymbolicLink()) {
        preserved.push(candidate);
        continue;
      }
      const receipt = parseBackupReceipt(readFileSync(receiptPath, 'utf8'), component, entry.name);
      if (!receipt || computeBackupDigest(candidate) !== receipt.digest) {
        preserved.push(candidate);
        continue;
      }
      verified.push({ name: entry.name, path: candidate, receiptPath, digest: receipt.digest });
    } catch {
      preserved.push(candidate);
    }
  }

  verified.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  let toRemove = [];
  if (keep !== null && keep !== undefined) {
    const keepCount = Number(keep);
    if (keepCount !== 0 && keepCount !== 5) {
      throw new Error(`Unsupported backup keep count: ${keep}`);
    }
    const descending = [...verified].reverse();
    toRemove = descending.slice(keepCount);
  } else {
    const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_BACKUP_LIMIT;
    let excess = verified.length + (protectNew ? 1 : 0) - effectiveLimit;
    if (excess > 0) {
      toRemove = verified.slice(0, excess);
    }
  }

  return { verified, toRemove, preserved };
}

/**
 * Deterministic lifecycle action planner across install/update/downgrade/repair/skip.
 */
export function planLifecycleAction({
  currentState,
  ownership = 'NOT_INSTALLED',
  currentVersion = '',
  availableVersion = '',
  force = false,
  allowDowngrade = false,
} = {}) {
  if (currentState === 'NOT INSTALLED' || ownership === 'NOT_INSTALLED') {
    return { action: 'install', reason: 'NOT_INSTALLED', requiresBackup: false, allowed: true };
  }
  if (ownership === 'UNSAFE') {
    return { action: 'blocked', reason: 'UNSAFE_TARGET', requiresBackup: false, allowed: false };
  }
  if (ownership === 'FOREIGN_UNPROVEN') {
    return { action: 'blocked', reason: 'FOREIGN_UNPROVEN', requiresBackup: false, allowed: false };
  }
  if (currentState === 'DRIFTED' || ownership === 'AFYX_OWNED_MODIFIED' || currentState === 'INCOMPLETE' || currentState === 'INVALID') {
    if (!force && ownership === 'AFYX_OWNED_MODIFIED') {
      return { action: 'blocked', reason: 'MODIFIED_WITHOUT_FORCE', requiresBackup: true, allowed: false };
    }
    return { action: 'repair', reason: currentState || ownership, requiresBackup: true, allowed: true };
  }
  if (currentVersion && availableVersion) {
    const cmp = compareSemver(currentVersion, availableVersion);
    if (cmp < 0) {
      return { action: 'update', reason: 'UPGRADE_AVAILABLE', requiresBackup: true, allowed: true };
    }
    if (cmp > 0) {
      if (!allowDowngrade) {
        return { action: 'blocked', reason: 'DOWNGRADE_NOT_ALLOWED', requiresBackup: true, allowed: false };
      }
      return { action: 'downgrade', reason: 'DOWNGRADE_AUTHORIZED', requiresBackup: true, allowed: true };
    }
  }
  return { action: 'skip', reason: 'ALREADY_CURRENT', requiresBackup: false, allowed: true };
}

function parseCliFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'protect-new' || key === 'require-version' || key === 'force' || key === 'allow-downgrade') {
      flags[key] = true;
    } else if (i + 1 < argv.length) {
      flags[key] = argv[i + 1];
      i += 1;
    }
  }
  return flags;
}

function main(argv) {
  const [command, ...rest] = argv;
  const flags = parseCliFlags(rest);

  if (command === 'plan-backup-retention') {
    const result = planBackupRetention(flags.root, flags.component, {
      limit: flags.limit ? Number(flags.limit) : DEFAULT_BACKUP_LIMIT,
      keep: flags.keep !== undefined ? Number(flags.keep) : null,
      protectNew: Boolean(flags['protect-new']),
    });
    process.stdout.write(`${JSON.stringify({ contract: INSTALLER_CORE_CONTRACT, ...result })}\n`);
    return;
  }

  if (command === 'validate-manifest') {
    const result = validateSkillManifest(flags.dir, Boolean(flags['require-version']));
    process.stdout.write(`${JSON.stringify({ contract: INSTALLER_CORE_CONTRACT, ...result })}\n`);
    return;
  }

  if (command === 'evaluate-ownership') {
    const state = evaluateSkillOwnership(flags.target, flags.component, flags.owner || 'afyx');
    process.stdout.write(`${JSON.stringify({ contract: INSTALLER_CORE_CONTRACT, state })}\n`);
    return;
  }

  if (command === 'plan-lifecycle') {
    const plan = planLifecycleAction({
      currentState: flags['current-state'] || '',
      ownership: flags.ownership || 'NOT_INSTALLED',
      currentVersion: flags['current-version'] || '',
      availableVersion: flags['available-version'] || '',
      force: Boolean(flags.force),
      allowDowngrade: Boolean(flags['allow-downgrade']),
    });
    process.stdout.write(`${JSON.stringify({ contract: INSTALLER_CORE_CONTRACT, ...plan })}\n`);
    return;
  }

  throw new Error(`Unknown afyx-installer-core command: ${command || '(none)'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
