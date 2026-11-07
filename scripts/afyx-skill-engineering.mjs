/** AFYX-owned skill lifecycle. No provider profile is selected implicitly. */
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const SKILL_ENGINEERING_CONTRACT = 'AfyxSkillEngineering/v1';
const PROVIDER_DEFS = new Map(JSON.parse(readFileSync(new URL('./components.json', import.meta.url), 'utf8'))
  .providers.map((provider) => [provider.provider, provider]));
const PROVIDERS = new Set(PROVIDER_DEFS.keys());
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 1000;
const SHA256 = (data) => createHash('sha256').update(data).digest('hex');

function fail(code) { throw new Error(code); }
function itemAt(path) {
  try { return lstatSync(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
function inside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function ordinary(path, directory) {
  const item = lstatSync(path);
  if (item.isSymbolicLink() || (item.isDirectory() !== directory)) fail('UNSAFE_FILE_TYPE');
  return item;
}
function safeRoot(root) {
  const absolute = resolve(root);
  let cursor = absolute;
  for (;;) {
    if (itemAt(cursor)) ordinary(cursor, true);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return absolute;
}
function safePart(path, root) {
  if (!inside(root, path)) fail('PATH_OUTSIDE_SCOPE');
  let cursor = resolve(root);
  for (const part of relative(cursor, resolve(path)).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (itemAt(cursor)) {
      const item = lstatSync(cursor);
      if (item.isSymbolicLink()) fail('REPARSE_POINT_BLOCKED');
    }
  }
}
function filesOf(source) {
  const root = safeRoot(source);
  ordinary(root, true);
  const files = [];
  let bytes = 0;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.afyx-skill-ownership.json') continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('REPARSE_POINT_BLOCKED');
      if (entry.isDirectory()) { ordinary(path, true); visit(path); continue; }
      if (!entry.isFile()) fail('UNSAFE_FILE_TYPE');
      if (files.length >= MAX_FILES) fail('PACKAGE_TOO_MANY_FILES');
      const size = ordinary(path, false).size;
      if (size > MAX_FILE_BYTES || (bytes += size) > MAX_PACKAGE_BYTES) fail('PACKAGE_TOO_LARGE');
      files.push({ path: relative(root, path).split(sep).join('/'), bytes: readFileSync(path) });
    }
  }
  visit(root);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function metadataOf(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) fail('FRONTMATTER_REQUIRED');
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const item = /^([a-z][a-z0-9-]*):\s*(.*?)\s*$/.exec(line);
    if (!item) fail('FRONTMATTER_UNSUPPORTED');
    if (fields.has(item[1])) fail('DUPLICATE_METADATA');
    fields.set(item[1], item[2].replace(/^['"]|['"]$/g, ''));
  }
  const name = fields.get('name');
  const description = fields.get('description');
  if (!name || !/^[a-z][a-z0-9-]{1,63}$/.test(name)) fail('INVALID_SKILL_NAME');
  if (!description || description.length > 1000) fail('INVALID_DESCRIPTION');
  let extension = {};
  try { extension = fields.has('metadata') ? JSON.parse(fields.get('metadata')) : {}; }
  catch { fail('INVALID_METADATA'); }
  const rawTriggers = extension?.afyx?.triggers ?? [];
  if (!Array.isArray(rawTriggers) || rawTriggers.some((x) => typeof x !== 'string')) fail('INVALID_TRIGGERS');
  const triggers = rawTriggers.map((x) => x.trim().toLowerCase());
  if (triggers.some((x) => !/^[a-z][a-z0-9 -]{1,79}$/.test(x) || !description.toLowerCase().includes(x))
      || new Set(triggers).size !== triggers.length) fail('INVALID_TRIGGERS');
  return { name, description, triggers };
}
function checkedReferences(content, paths, sourcePath = 'SKILL.md') {
  const candidates = [
    ...[...content.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]),
    ...(sourcePath === 'SKILL.md' ? [...content.matchAll(/`((?:references|scripts|assets)\/[^`]+)`/g)].map((match) => match[1]) : []),
  ];
  const prefix = sourcePath.split('/').slice(0, -1).join('/');
  for (const candidate of candidates) {
    const target = candidate.split(/[?#]/, 1)[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
    const normalized = target.replace(/^\.\//, '');
    const local = prefix ? `${prefix}/${normalized}` : normalized;
    if (target.includes('%') || target.includes('\\') || target.startsWith('/') || target.split('/').includes('..') || !paths.has(local)) fail('INVALID_RESOURCE_REFERENCE');
  }
}

export function validateSkill(source, { peerRoots = [], allowDirectoryMismatch = false } = {}) {
  const files = filesOf(source);
  const manifest = files.find((file) => file.path === 'SKILL.md');
  if (!manifest) fail('SKILL_MANIFEST_MISSING');
  const metadata = metadataOf(manifest.bytes.toString('utf8'));
  if (!allowDirectoryMismatch && basename(resolve(source)) !== metadata.name) fail('SKILL_DIRECTORY_NAME_MISMATCH');
  const paths = new Set(files.map((file) => file.path));
  for (const file of files.filter((item) => item.path.endsWith('.md'))) {
    checkedReferences(file.bytes.toString('utf8'), paths, file.path);
  }
  for (const peerRoot of peerRoots) {
    if (!itemAt(peerRoot)) continue;
    const peer = filesOf(peerRoot).find((file) => file.path === 'SKILL.md');
    if (!peer) continue;
    const other = metadataOf(peer.bytes.toString('utf8'));
    if (other.name === metadata.name || other.triggers.some((trigger) => metadata.triggers.includes(trigger))) fail('SKILL_OR_TRIGGER_CONFLICT');
  }
  const inventory = files.map(({ path, bytes }) => ({ path, sha256: SHA256(bytes), size: bytes.length }));
  const digest = SHA256(Buffer.from(JSON.stringify(inventory)));
  return Object.freeze({ contract: SKILL_ENGINEERING_CONTRACT, ...metadata, digest, inventory });
}

export function createSkill(directory, { name, description, triggers = [], body = '' }) {
  if (itemAt(directory)) fail('TARGET_ALREADY_EXISTS');
  if (basename(resolve(directory)) !== name) fail('SKILL_DIRECTORY_NAME_MISMATCH');
  safeRoot(dirname(directory));
  const text = `---\nname: ${name}\ndescription: ${description}\nmetadata: ${JSON.stringify({ afyx: { triggers } })}\n---\n\n${body}\n`;
  // Validate all caller-supplied fields before the first write.
  const parsed = metadataOf(text);
  if (parsed.name !== name || parsed.description !== description
      || JSON.stringify(parsed.triggers) !== JSON.stringify(triggers)) fail('SKILL_METADATA_INVALID');
  checkedReferences(text, new Set(['SKILL.md']));
  mkdirSync(directory);
  writeFileSync(join(directory, 'SKILL.md'), text, { flag: 'wx' });
  return validateSkill(directory);
}

/** Revision/repair is a host-approved source edit with exact-byte restoration on failure. */
export function reviseSkill(source, { description, triggers = [], body }, { authorize } = {}) {
  const root = safeRoot(source);
  ordinary(root, true);
  const manifest = join(root, 'SKILL.md');
  ordinary(manifest, false);
  const original = readFileSync(manifest);
  const oldText = original.toString('utf8');
  const existingBody = oldText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const draft = `---\nname: ${basename(root)}\ndescription: ${description}\nmetadata: ${JSON.stringify({ afyx: { triggers } })}\n---\n\n${body ?? existingBody}`;
  const parsed = metadataOf(draft);
  if (parsed.name !== basename(root) || parsed.description !== description
      || JSON.stringify(parsed.triggers) !== JSON.stringify(triggers)) fail('REVISION_METADATA_INVALID');
  checkedReferences(draft, new Set(filesOf(root).map((file) => file.path)));
  const proposal = Object.freeze({ contract: SKILL_ENGINEERING_CONTRACT, name: parsed.name, action: 'REVISE', beforeSha256: SHA256(original), afterSha256: SHA256(Buffer.from(draft)) });
  if (typeof authorize !== 'function' || authorize(proposal) !== true) fail('HOST_APPROVAL_REQUIRED');
  if (SHA256(readFileSync(manifest)) !== proposal.beforeSha256) fail('PREVIEW_STALE');
  try {
    writeFileSync(manifest, draft);
    return validateSkill(root);
  } catch (error) {
    writeFileSync(manifest, original);
    throw error;
  }
}

export function packageSkill(source) {
  const report = validateSkill(source);
  const files = filesOf(source).map(({ path, bytes }) => ({ path, data: bytes.toString('base64') }));
  const payload = { contract: SKILL_ENGINEERING_CONTRACT, metadata: report, files };
  return Buffer.from(`${JSON.stringify(payload)}\n`);
}

export function inspectSkillPackage(packageBytes) {
  if (!Buffer.isBuffer(packageBytes) || packageBytes.length > MAX_PACKAGE_BYTES * 2) fail('PACKAGE_INVALID');
  const payload = JSON.parse(packageBytes.toString('utf8'));
  if (payload.contract !== SKILL_ENGINEERING_CONTRACT || !Array.isArray(payload.files)) fail('PACKAGE_INVALID');
  const names = new Set();
  const inventory = payload.files.map((file) => {
    if (typeof file.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(file.path) || file.path.startsWith('/') || file.path === '.afyx-skill-ownership.json' || file.path.split('/').some((part) => part === '..' || part === '.' || !part) || names.has(file.path)) fail('PACKAGE_PATH_INVALID');
    names.add(file.path);
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data || bytes.length > MAX_FILE_BYTES) fail('PACKAGE_INVALID');
    return { path: file.path, sha256: SHA256(bytes), size: bytes.length };
  });
  if (inventory.length > MAX_FILES || !names.has('SKILL.md')
      || SHA256(Buffer.from(JSON.stringify(inventory))) !== payload.metadata?.digest
      || JSON.stringify(inventory) !== JSON.stringify(payload.metadata?.inventory)) fail('PACKAGE_INTEGRITY_FAILED');
  const manifest = payload.files.find((file) => file.path === 'SKILL.md');
  const parsed = metadataOf(Buffer.from(manifest.data, 'base64').toString('utf8'));
  if (parsed.name !== payload.metadata.name || parsed.description !== payload.metadata.description
      || JSON.stringify(parsed.triggers) !== JSON.stringify(payload.metadata.triggers)) fail('PACKAGE_METADATA_MISMATCH');
  for (const file of payload.files.filter((item) => item.path.endsWith('.md'))) {
    checkedReferences(Buffer.from(file.data, 'base64').toString('utf8'), names, file.path);
  }
  return payload;
}

export function negotiateSkillProvider(provider, scope = 'workspace') {
  const supportedScopes = PROVIDER_DEFS.get(provider)?.skill_scopes?.split(';') ?? [];
  return Object.freeze({ contract: SKILL_ENGINEERING_CONTRACT, provider, scope,
    status: supportedScopes.includes(scope) ? 'SUPPORTED' : 'UNSUPPORTED_SCOPE' });
}

export function previewSkillInstall(packageBytes, { provider, scope = 'workspace', skillsRoot, peerRoots = [] }) {
  if (!PROVIDERS.has(provider) || negotiateSkillProvider(provider, scope).status !== 'SUPPORTED') fail('PROVIDER_SCOPE_UNSUPPORTED');
  const payload = inspectSkillPackage(packageBytes);
  const root = safeRoot(skillsRoot);
  ordinary(root, true);
  const target = join(root, payload.metadata.name);
  safePart(target, root);
  const existing = itemAt(target) ? validateSkill(target) : null;
  if (existing) {
    const markerPath = join(target, '.afyx-skill-ownership.json');
    if (!existsSync(markerPath) || !ordinary(markerPath, false)) fail('FOREIGN_SKILL_PROTECTED');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (marker.contract !== SKILL_ENGINEERING_CONTRACT || marker.provider !== provider || marker.digest !== existing.digest) fail('FOREIGN_SKILL_PROTECTED');
  }
  // Inspect neighboring provider skills without following foreign junctions.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-z][a-z0-9-]{1,63}$/.test(entry.name)
        || entry.name === payload.metadata.name) continue;
    const neighbor = join(root, entry.name, 'SKILL.md');
    const stat = itemAt(neighbor);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) continue;
    const text = readFileSync(neighbor, 'utf8');
    const metadataLine = /^metadata:\s*(\{.*\})\s*$/m.exec(text)?.[1];
    let triggers = [];
    try { triggers = JSON.parse(metadataLine ?? '{}')?.afyx?.triggers ?? []; } catch { /* foreign metadata */ }
    if (!Array.isArray(triggers)) triggers = [];
    if (triggers.some((trigger) => payload.metadata.triggers.includes(trigger))) fail('SKILL_OR_TRIGGER_CONFLICT');
  }
  for (const peer of peerRoots) {
    if (!itemAt(peer)) continue;
    const other = validateSkill(peer);
    if (other.name !== payload.metadata.name && other.triggers.some((trigger) => payload.metadata.triggers.includes(trigger))) fail('SKILL_OR_TRIGGER_CONFLICT');
  }
  return Object.freeze({ contract: SKILL_ENGINEERING_CONTRACT, provider, scope, root, target, action: existing ? 'UPDATE' : 'INSTALL', digest: payload.metadata.digest, previousDigest: existing?.digest ?? null });
}

export function verifySkillInstall({ provider, skillsRoot, name }) {
  if (!PROVIDERS.has(provider) || !/^[a-z][a-z0-9-]{1,63}$/.test(name)) fail('VERIFY_REQUEST_INVALID');
  const root = safeRoot(skillsRoot);
  ordinary(root, true);
  const target = join(root, name);
  safePart(target, root);
  if (!itemAt(target)) return { contract: SKILL_ENGINEERING_CONTRACT, status: 'NOT_INSTALLED' };
  const report = validateSkill(target);
  const markerPath = join(target, '.afyx-skill-ownership.json');
  if (!existsSync(markerPath)) return { contract: SKILL_ENGINEERING_CONTRACT, status: 'FOREIGN_UNPROVEN' };
  ordinary(markerPath, false);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  return { contract: SKILL_ENGINEERING_CONTRACT,
    status: marker.contract === SKILL_ENGINEERING_CONTRACT && marker.provider === provider && marker.digest === report.digest ? 'VERIFIED' : 'INTEGRITY_FAILED',
    digest: report.digest };
}

export function reconcileSkillInstall({ provider, skillsRoot, name }, { authorize } = {}) {
  if (!PROVIDERS.has(provider) || !/^[a-z][a-z0-9-]{1,63}$/.test(name)) fail('RECOVERY_REQUEST_INVALID');
  const root = safeRoot(skillsRoot);
  ordinary(root, true);
  const target = join(root, name);
  const backup = join(root, `.${name}.afyx-rollback`);
  const stage = join(root, `.${name}.afyx-stage`);
  safePart(target, root); safePart(backup, root); safePart(stage, root);
  const state = Object.freeze({ targetPresent: Boolean(itemAt(target)), backupPresent: Boolean(itemAt(backup)), stagePresent: Boolean(itemAt(stage)) });
  if (state.targetPresent && state.backupPresent) return { status: 'REVIEW_BOTH_VERSIONS', ...state };
  if (!state.backupPresent) return { status: state.stagePresent ? 'REVIEW_STAGE' : 'NO_RECOVERY_NEEDED', ...state };
  const report = validateSkill(backup, { allowDirectoryMismatch: true });
  const backupMarker = join(backup, '.afyx-skill-ownership.json');
  ordinary(backupMarker, false);
  const marker = JSON.parse(readFileSync(backupMarker, 'utf8'));
  if (marker.contract !== SKILL_ENGINEERING_CONTRACT || marker.provider !== provider || marker.digest !== report.digest) fail('OWNERSHIP_DRIFT');
  const proposal = Object.freeze({ provider, target, backup, digest: report.digest, action: 'RESTORE_INTERRUPTED_INSTALL' });
  if (typeof authorize !== 'function' || authorize(proposal) !== true) return { status: 'HOST_APPROVAL_REQUIRED', ...state };
  if (itemAt(target) || !itemAt(backup)) fail('RECOVERY_STATE_CHANGED');
  renameSync(backup, target);
  return { status: 'RESTORED_PREVIOUS', target, digest: report.digest, stagePreserved: state.stagePresent };
}

export function applySkillInstall(packageBytes, preview, { authorize } = {}) {
  if (typeof authorize !== 'function' || authorize(preview) !== true) fail('HOST_APPROVAL_REQUIRED');
  const current = previewSkillInstall(packageBytes, { provider: preview.provider, scope: preview.scope, skillsRoot: preview.root });
  if (JSON.stringify(current) !== JSON.stringify(preview)) fail('PREVIEW_STALE');
  const payload = inspectSkillPackage(packageBytes);
  const root = preview.root;
  const target = preview.target;
  const stage = join(root, `.${payload.metadata.name}.afyx-stage`);
  const backup = join(root, `.${payload.metadata.name}.afyx-rollback`);
  if (itemAt(stage) || itemAt(backup)) fail('TRANSACTION_RECONCILIATION_REQUIRED');
  mkdirSync(stage);
  let movedOld = false;
  try {
    for (const file of payload.files) {
      const destination = join(stage, ...file.path.split('/'));
      safePart(destination, stage);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, Buffer.from(file.data, 'base64'), { flag: 'wx' });
    }
    if (validateSkill(stage, { allowDirectoryMismatch: true }).digest !== preview.digest) fail('PACKAGE_INTEGRITY_FAILED');
    writeFileSync(join(stage, '.afyx-skill-ownership.json'), `${JSON.stringify({ contract: SKILL_ENGINEERING_CONTRACT, provider: preview.provider, digest: preview.digest })}\n`, { flag: 'wx' });
    if (itemAt(target)) { renameSync(target, backup); movedOld = true; }
    renameSync(stage, target);
    if (validateSkill(target).digest !== preview.digest) fail('INSTALL_VERIFY_FAILED');
    return { contract: SKILL_ENGINEERING_CONTRACT, status: 'VERIFIED', target, digest: preview.digest, rollbackAvailable: movedOld };
  } catch (error) {
    if (movedOld && !itemAt(target)) renameSync(backup, target);
    if (itemAt(stage)) rmSync(stage, { recursive: true });
    throw error;
  }
}

export function rollbackSkillInstall({ provider, skillsRoot, name }, { authorize } = {}) {
  if (!PROVIDERS.has(provider) || !/^[a-z][a-z0-9-]{1,63}$/.test(name)) fail('ROLLBACK_REQUEST_INVALID');
  const root = safeRoot(skillsRoot);
  ordinary(root, true);
  const target = join(root, name);
  const backup = join(root, `.${name}.afyx-rollback`);
  safePart(target, root); safePart(backup, root);
  if (!itemAt(target) || !itemAt(backup)) fail('ROLLBACK_UNAVAILABLE');
  if (typeof authorize !== 'function' || authorize({ provider, target, action: 'ROLLBACK' }) !== true) fail('HOST_APPROVAL_REQUIRED');
  const current = validateSkill(target);
  const previous = validateSkill(backup, { allowDirectoryMismatch: true });
  const markerPath = join(target, '.afyx-skill-ownership.json');
  const oldMarkerPath = join(backup, '.afyx-skill-ownership.json');
  ordinary(markerPath, false); ordinary(oldMarkerPath, false);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const oldMarker = JSON.parse(readFileSync(oldMarkerPath, 'utf8'));
  if (marker.contract !== SKILL_ENGINEERING_CONTRACT || marker.provider !== provider || marker.digest !== current.digest
      || oldMarker.contract !== SKILL_ENGINEERING_CONTRACT || oldMarker.provider !== provider || oldMarker.digest !== previous.digest) fail('OWNERSHIP_DRIFT');
  const displaced = join(root, `.${name}.afyx-displaced`);
  if (itemAt(displaced)) fail('TRANSACTION_RECONCILIATION_REQUIRED');
  renameSync(target, displaced);
  try { renameSync(backup, target); }
  catch (error) { renameSync(displaced, target); throw error; }
  return { status: 'ROLLED_BACK', target, digest: previous.digest, displaced };
}
