/** AFYX lazy skill descriptors. Discovery reads metadata, never executes skill instructions. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
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

export function discoverSkillDescriptors({ roots = [], provider = 'codex', scope = 'workspace', maxSkills = 64, maxManifestBytes = 32768 } = {}) {
  if (!Array.isArray(roots) || roots.length > 16 || !['codex', 'antigravity', 'claude'].includes(provider) || !['workspace', 'global'].includes(scope)
    || !Number.isSafeInteger(maxSkills) || maxSkills < 1 || maxSkills > 256 || !Number.isSafeInteger(maxManifestBytes) || maxManifestBytes < 1 || maxManifestBytes > 131072) throw new Error('INVALID_CATALOG_CONFIG');
  const items = [], diagnostics = [];
  for (const input of roots) {
    const root = resolve(input);
    try {
      allowed(root, root);
      for (const name of readdirSync(root).sort()) {
        if (items.length >= maxSkills) { diagnostics.push({ code: 'SKILL_LIMIT' }); break; }
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) continue;
        const directory = join(root, name), manifest = join(directory, 'SKILL.md');
        try {
          allowed(root, manifest); const stat = lstatSync(manifest);
          if (!stat.isFile() || stat.nlink > 1 || stat.size > maxManifestBytes) throw new Error('MANIFEST_LIMIT');
          const bytes = readFileSync(manifest); if (bytes.length > maxManifestBytes) throw new Error('MANIFEST_LIMIT');
          const text = bytes.toString('utf8'), front = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
          if (!front || /[!&*][A-Za-z_][\w-]*|!!|<<:/.test(front)) throw new Error('UNSUPPORTED_METADATA');
          const field = (key) => front.match(new RegExp(`^${key}:\\s*([^\\r\\n]*)`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
          const declared = field('name'); if (declared !== name) throw new Error('MANIFEST_NAME_MISMATCH');
          let description = field('description');
          if (/^[>|][-+]?$/.test(description)) description = front.match(/^description:\s*[>|][-+]?\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/m)?.[1]?.replace(/\r?\n\s*/g, ' ').trim() || '';
          const version = front.match(/^\s+version:\s*["']?([^\s"']+)/m)?.[1] || front.match(/"version"\s*:\s*"([^"]+)"/)?.[1] || field('version') || 'UNKNOWN';
          if (!description || description.length > 4096) throw new Error('UNSUPPORTED_METADATA');
          items.push(Object.freeze({ id: name, name, description, version, root: directory, manifest, providerScope: `${provider}:${scope}`,
            domains: name.includes('odoo') ? ['odoo', 'python', 'erp'] : name.includes('expert') ? ['engineering', 'architecture', 'security'] : ['coding'],
            manifestSha256: hash(bytes), manifestBytes: bytes.length, status: 'DISCOVERED_NOT_EXECUTED' }));
        } catch (error) { if (error.code !== 'ENOENT') diagnostics.push({ id: name, code: ['UNSAFE_SKILL_PATH', 'MANIFEST_LIMIT', 'UNSUPPORTED_METADATA', 'MANIFEST_NAME_MISMATCH'].includes(error.message) ? error.message : 'SKILL_UNAVAILABLE' }); }
      }
    } catch { diagnostics.push({ code: 'SKILL_ROOT_UNAVAILABLE' }); }
  }
  const grouped = new Map();
  for (const item of items) { if (grouped.has(item.id)) diagnostics.push({ id: item.id, code: 'DUPLICATE_SKILL_ID' }); else grouped.set(item.id, item); }
  return Object.freeze({ contract: SKILL_CATALOG_CONTRACT, items: Object.freeze([...grouped.values()]), diagnostics: Object.freeze(diagnostics) });
}

export function loadSkillContext(descriptor, { authorize, maxBytes = 32768 } = {}) {
  if (!descriptor || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || typeof authorize !== 'function' || authorize(descriptor) !== true) throw new Error('SKILL_HOST_AUTHORIZATION_REQUIRED');
  allowed(descriptor.root, descriptor.manifest);
  if (lstatSync(descriptor.manifest).size > maxBytes) throw new Error('SKILL_CONTEXT_LIMIT');
  const bytes = readFileSync(descriptor.manifest);
  if (bytes.length > maxBytes || hash(bytes) !== descriptor.manifestSha256) throw new Error('SKILL_SOURCE_CHANGED');
  return { contract: SKILL_CATALOG_CONTRACT, id: descriptor.id, sourceDigest: descriptor.manifestSha256, content: bytes.toString('utf8'),
    bytes: bytes.length, disposition: 'INSTRUCTIONS_SUBORDINATE_TO_HOST_POLICY', executionPerformed: false };
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
