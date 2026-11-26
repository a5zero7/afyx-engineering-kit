/** AFYX lazy skill descriptors. Discovery reads metadata, never executes skill instructions. */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, realpathSync, readdirSync, openSync, readSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

export const SKILL_CATALOG_CONTRACT = 'AfyxSkillCatalog/v1';
const hash = (x) => createHash('sha256').update(x).digest('hex');
const within = (root, file) => { const p = relative(root, file); return p !== '..' && !p.startsWith(`..${sep}`) && !isAbsolute(p); };
const allowed = (root, file) => {
  let current = root;
  if (lstatSync(root).isSymbolicLink()) throw new Error('UNSAFE_SKILL_ROOT');
  for (const part of relative(root, file).split(sep).filter(Boolean)) { current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('UNSAFE_SKILL_PATH'); }
  if (!within(realpathSync(root), realpathSync(file))) throw new Error('UNSAFE_SKILL_PATH');
};


const METADATA_LIMIT = 8192;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const catalogIdentity = new WeakMap();
const contextSessions = new WeakMap();

function fileIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

function readMetadata(path, maxBytes) {
  const descriptor = openSync(path, 'r');
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(maxBytes)) {
      throw new Error('MANIFEST_LIMIT');
    }
    const buffer = Buffer.alloc(Math.min(METADATA_LIMIT, Number(stat.size)));
    let length = 0;
    let lineStart = 0;
    while (length < buffer.length && readSync(descriptor, buffer, length, 1, length) === 1) {
      length++;
      if (buffer[length - 1] !== 10 && length !== Number(stat.size)) continue;
      const line = buffer.toString('utf8', lineStart, length).replace(/\r?\n$/, '');
      if (lineStart === 0 && line !== '---') break;
      if (lineStart !== 0 && line === '---') {
        if (fileIdentity(fstatSync(descriptor, { bigint: true })) !== fileIdentity(stat)) {
          throw new Error('SKILL_SOURCE_CHANGED');
        }
        return { prefix: buffer.subarray(0, length), identity: fileIdentity(stat), size: Number(stat.size) };
      }
      lineStart = length;
    }
    throw new Error('UNSUPPORTED_METADATA');
  } finally {
    closeSync(descriptor);
  }
}

export function createSkillContextSession() {
  const session = Object.freeze({});
  contextSessions.set(session, new WeakMap());
  return session;
}

export function discoverSkillDescriptors({ roots = [], provider = 'codex', scope = 'workspace', maxSkills = 64, maxManifestBytes = 32768, disabled = [] } = {}) {
  if (!Array.isArray(disabled) || !Array.isArray(roots) || roots.length > 16 || !['codex', 'antigravity', 'claude'].includes(provider) || !['workspace', 'global'].includes(scope)
    || !Number.isSafeInteger(maxSkills) || maxSkills < 1 || maxSkills > 256 || !Number.isSafeInteger(maxManifestBytes) || maxManifestBytes < 1 || maxManifestBytes > 131072) throw new Error('INVALID_CATALOG_CONFIG');
  const items = [], diagnostics = [];
  for (const input of roots) {
    const root = resolve(input);
    try {
      allowed(root, root);
      for (const name of readdirSync(root).sort()) {
        if (items.length >= maxSkills) { diagnostics.push({ code: 'SKILL_LIMIT' }); break; }
        if (disabled.includes(name)) continue;
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) continue;
        const directory = join(root, name), manifest = join(directory, 'SKILL.md');
        try {
          allowed(root, manifest); const stat = lstatSync(manifest);
          if (!stat.isFile() || stat.nlink > 1 || stat.size > maxManifestBytes) throw new Error('MANIFEST_LIMIT');
          const { prefix, identity, size } = readMetadata(manifest, maxManifestBytes);
          const text = new TextDecoder('utf-8', { fatal: true }).decode(prefix);
          const front = text.match(FRONTMATTER)?.[1];
          if (!front || /[!&*][A-Za-z_][\w-]*|!!|<<:/.test(front)) throw new Error('UNSUPPORTED_METADATA');
          const field = (key) => front.match(new RegExp(`^${key}:\\s*([^\\r\\n]*)`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
          const declared = field('name'); if (declared !== name) throw new Error('MANIFEST_NAME_MISMATCH');
          let description = field('description');
          if (/^[>|][-+]?$/.test(description)) description = front.match(/^description:\s*[>|][-+]?\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/m)?.[1]?.replace(/\r?\n\s*/g, ' ').trim() || '';
          const version = front.match(/^\s+version:\s*["']?([^\s"']+)/m)?.[1] || front.match(/"version"\s*:\s*"([^"]+)"/)?.[1] || field('version') || 'UNKNOWN';
          if (!description || description.length > 4096) throw new Error('UNSUPPORTED_METADATA');
          const item = Object.freeze({ id: name, name, description, version, root: directory, manifest, providerScope: `${provider}:${scope}`,
            domains: name === 'afyx-ui-architect' ? ['ui'] : name.includes('odoo') ? ['odoo', 'python', 'erp'] : name.includes('expert') ? ['engineering', 'architecture', 'security'] : ['coding'],
            manifestSha256: null, manifestBytes: size, metadataSha256: hash(prefix),
            metadataBytes: prefix.length, status: 'DISCOVERED_NOT_EXECUTED' });
          catalogIdentity.set(item, identity);
          items.push(item);
        } catch (error) { if (error.code !== 'ENOENT') diagnostics.push({ id: name, code: ['UNSAFE_SKILL_PATH', 'MANIFEST_LIMIT', 'UNSUPPORTED_METADATA', 'MANIFEST_NAME_MISMATCH'].includes(error.message) ? error.message : 'SKILL_UNAVAILABLE' }); }
      }
    } catch { diagnostics.push({ code: 'SKILL_ROOT_UNAVAILABLE' }); }
  }
  const grouped = new Map();
  for (const item of items) { if (grouped.has(item.id)) diagnostics.push({ id: item.id, code: 'DUPLICATE_SKILL_ID' }); else grouped.set(item.id, item); }
  return Object.freeze({ contract: SKILL_CATALOG_CONTRACT, items: Object.freeze([...grouped.values()]), diagnostics: Object.freeze(diagnostics), instructionBytesLoaded: 0, referenceBytesLoaded: 0 });
}

export function loadSkillContext(descriptor, { authorize, maxBytes = 32768, session } = {}) {
  if (!descriptor || descriptor.disabled === true || !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 || maxBytes > 131072 || typeof authorize !== 'function' || authorize(descriptor) !== true) {
    throw new Error('SKILL_HOST_AUTHORIZATION_REQUIRED');
  }
  const cache = contextSessions.get(session);
  if (session !== undefined && !cache) throw new Error('INVALID_SKILL_CONTEXT_SESSION');
  const identity = catalogIdentity.get(descriptor);
  let cached;
  let bytes;
  let fd;
  try {
    allowed(descriptor.root, descriptor.manifest);
    fd = openSync(descriptor.manifest, 'r');
    const stat = fstatSync(fd, { bigint: true });
    if (identity && fileIdentity(stat) !== identity) throw new Error('SKILL_SOURCE_CHANGED');
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(maxBytes)) throw new Error('SKILL_CONTEXT_LIMIT');
    cached = identity && cache?.get(descriptor);
    if (cached) return { ...cached, bytesLoaded: 0, reused: true };
    const limit = Number(stat.size) + 1;
    const buffer = Buffer.alloc(limit);
    let count = 0;
    while (count < limit) {
      const read = readSync(fd, buffer, count, limit - count, count);
      if (!read) break;
      count += read;
    }
    if (count !== limit - 1 || fileIdentity(fstatSync(fd, { bigint: true })) !== fileIdentity(stat)) {
      throw new Error('SKILL_SOURCE_CHANGED');
    }
    bytes = buffer.subarray(0, count);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error('SKILL_SOURCE_CHANGED');
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const digest = hash(bytes);
  if (!identity && digest !== descriptor.manifestSha256) throw new Error('SKILL_SOURCE_CHANGED');
  const result = Object.freeze({
    contract: SKILL_CATALOG_CONTRACT, id: descriptor.id, sourceDigest: digest,
    content: bytes.toString('utf8'), bytes: bytes.length, bytesLoaded: bytes.length,
    disposition: 'INSTRUCTIONS_SUBORDINATE_TO_HOST_POLICY', executionPerformed: false,
  });
  if (identity) cache?.set(descriptor, result);
  return result;
}


export function refineSkillSpecification(spec = {}) {
  const diagnostics = [];
  const text = (key, max) => { const value = spec[key]; if (typeof value !== 'string' || !value.trim() || value.length > max) { diagnostics.push({ field: key, code: 'REQUIRED_BOUNDED_TEXT' }); return ''; } return value.trim(); };
  const list = (key) => { if (!Array.isArray(spec[key]) || spec[key].length > 32 || spec[key].some((x) => typeof x !== 'string' || !x.trim() || x.length > 512)) { diagnostics.push({ field: key, code: 'REQUIRED_BOUNDED_LIST' }); return []; } return [...new Set(spec[key].map((x) => x.trim()))]; };
  const normalized = { name: text('name', 64), objective: text('objective', 4096), domain: text('domain', 64), inputs: list('inputs'), outputs: list('outputs'), acceptance: list('acceptance'), permissions: list('permissions') };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized.name)) diagnostics.push({ field: 'name', code: 'INVALID_NAME' });
  if (!normalized.acceptance.length) diagnostics.push({ field: 'acceptance', code: 'ACCEPTANCE_REQUIRED' });
  return { contract: 'AfyxSkillSpecification/v1', status: diagnostics.length ? 'INVALID' : 'VALID', specification: normalized, diagnostics, executionOwner: 'afyx-forge', contextOwner: 'afyx-context' };
}


/** Reads one resource only after the same skill is authorized and activated. */
export function loadSkillReference(skill, reference, { authorize, session, maxBytes = 32768 } = {}) {
  if (!contextSessions.get(session)?.has(skill) || typeof authorize !== 'function' ||
      authorize(skill, reference) !== true) throw new Error('SKILL_HOST_AUTHORIZATION_REQUIRED');
  if (typeof reference !== 'string' ||
      !/^references\/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(reference)) {
    throw new Error('UNSAFE_SKILL_PATH');
  }
  // Reconfirm manifest freshness before reading a supporting resource.
  loadSkillContext(skill, { authorize: () => true, session });
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 131072) throw new Error('SKILL_CONTEXT_LIMIT');
  const path = join(skill.root, reference);
  allowed(skill.root, path);
  const descriptor = openSync(path, 'r');
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(maxBytes)) throw new Error('SKILL_CONTEXT_LIMIT');
    const content = Buffer.alloc(Number(stat.size) + 1);
    let length = 0;
    while (length < content.length) {
      const count = readSync(descriptor, content, length, content.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length !== Number(stat.size) || fileIdentity(fstatSync(descriptor, { bigint: true })) !== fileIdentity(stat)) {
      throw new Error('SKILL_SOURCE_CHANGED');
    }
    const bytes = content.subarray(0, length);
    return { reference, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytesLoaded: length, sourceDigest: hash(bytes) };
  } finally {
    closeSync(descriptor);
  }
}

export function composeSkillSpecifications(specs = []) {
  if (!Array.isArray(specs) || specs.length > 16) throw new Error('SKILL_COMPOSITION_LIMIT');
  const items = specs.map(refineSkillSpecification), conflicts = [], names = new Set(), domains = new Map();
  for (const item of items) {
    const spec = item.specification;
    if (item.status !== 'VALID') conflicts.push({ name: spec.name, code: 'INVALID_SPECIFICATION' });
    if (names.has(spec.name)) conflicts.push({ name: spec.name, code: 'DUPLICATE_NAME' }); names.add(spec.name);
    if (domains.has(spec.domain)) conflicts.push({ domain: spec.domain, code: 'DOMAIN_OWNER_CONFLICT', owners: [domains.get(spec.domain), spec.name] });
    else domains.set(spec.domain, spec.name);
  }
  return { contract: 'AfyxSkillComposition/v1', status: conflicts.length ? 'CONFLICT' : 'COMPOSABLE', items, conflicts, executionPerformed: false, executionOwner: 'afyx-forge' };
}
