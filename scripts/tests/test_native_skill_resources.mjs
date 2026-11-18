import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createSkill, validateSkill, reviseSkill, packageSkill, inspectSkillPackage,
  previewSkillInstall, applySkillInstall, rollbackSkillInstall } from '../afyx-skill-engineering.mjs';

function fixture(run) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-skill-resources-'));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const spec = { name: 'afyx-resource-fixture', description: 'Use for review fixture requests.',
  triggers: ['review fixture'], body: '# Review\n\nRead [guide](references/guide.md).',
  resources: { 'references/guide.md': '# Guide\n\nInspect the source.\n',
    'scripts/check.js': 'throw new Error("must never execute");\n' } };
const hash = (value) => createHash('sha256').update(value).digest('hex');

test('authored resources survive deterministic package, reviewed update and rollback without executing helpers', () => fixture((root) => {
  const draft = join(root, spec.name);
  createSkill(draft, spec);
  const pkg = packageSkill(draft);
  assert.deepEqual(pkg, packageSkill(draft));
  const payload = inspectSkillPackage(pkg);
  assert.equal(payload.metadata.inventory.find((file) => file.path === 'references/guide.md').sha256,
    hash(spec.resources['references/guide.md']));
  const provider = join(root, 'provider');
  mkdirSync(provider);
  const preview = previewSkillInstall(pkg, { provider: 'codex', skillsRoot: provider });
  assert.throws(() => applySkillInstall(pkg, preview, { authorize: () => false }), /HOST_APPROVAL_REQUIRED/);
  assert.equal(existsSync(preview.target), false);
  applySkillInstall(pkg, preview, { authorize: () => true });
  reviseSkill(draft, { description: 'Updated review fixture requests.', triggers: spec.triggers }, { authorize: () => true });
  const updated = packageSkill(draft);
  applySkillInstall(updated, previewSkillInstall(updated, { provider: 'codex', skillsRoot: provider }), { authorize: () => true });
  rollbackSkillInstall({ provider: 'codex', skillsRoot: provider, name: spec.name }, { authorize: () => true });
  assert.equal(validateSkill(preview.target).digest, payload.metadata.digest);
  assert.equal(readFileSync(join(preview.target, 'references', 'guide.md'), 'utf8'), spec.resources['references/guide.md']);
}));

test('unsafe or ambiguous resource paths and broken references are rejected before draft writes', () => fixture((root) => {
  for (const resources of [
    { '../escape.md': '' }, { 'references/NUL.txt': '' }, { 'references/file.': '' },
    { '.AFYX-SKILL-OWNERSHIP.JSON': '' }, { 'SKILL.MD': '' },
    { 'assets/data': '', 'assets/data/file': '' }, { 'assets/A': '', 'assets/a': '' },
    { 'references/guide.md': '[missing](absent.md)' }, { 'scripts/check.js': 3 },
  ]) {
    const draft = join(root, spec.name);
    assert.throws(() => createSkill(draft, { ...spec, resources }), /PACKAGE_PATH_INVALID|INVALID_RESOURCE_REFERENCE|INVALID_RESOURCES/);
    assert.equal(existsSync(draft), false);
  }
}));

test('archive inspection rejects portable aliases and file-directory collisions even with matching hashes', () => fixture((root) => {
  const draft = join(root, spec.name);
  createSkill(draft, spec);
  const bytes = packageSkill(draft);
  for (const paths of [['references/NUL.txt'], ['assets/A', 'assets/a'], ['assets/data', 'assets/data/file'], ['.AFYX-SKILL-OWNERSHIP.JSON']]) {
    const payload = JSON.parse(bytes);
    payload.files.push(...paths.map((path) => ({ path, data: '' })));
    payload.metadata.inventory = payload.files.map(({ path, data }) => ({ path, sha256: hash(Buffer.from(data, 'base64')), size: Buffer.from(data, 'base64').length }));
    payload.metadata.digest = hash(Buffer.from(JSON.stringify(payload.metadata.inventory)));
    assert.throws(() => inspectSkillPackage(Buffer.from(JSON.stringify(payload))), /PACKAGE_PATH_INVALID/);
  }
}));

test('invalid metadata and over-budget authored resources fail before any write', () => fixture((root) => {
  const draft = join(root, spec.name);
  assert.throws(() => createSkill(draft, { ...spec, triggers: ['review fixture', 'review fixture'] }), /INVALID_TRIGGERS/);
  assert.equal(existsSync(draft), false);
  assert.throws(() => createSkill(draft, { ...spec, resources: { 'assets/large.txt': 'a'.repeat(2 * 1024 * 1024 + 1) } }), /PACKAGE_TOO_LARGE/);
  assert.equal(existsSync(draft), false);
  const resources = Object.fromEntries(Array.from({ length: 1000 }, (_, n) => [`assets/file-${n}`, '']));
  assert.throws(() => createSkill(draft, { ...spec, resources }), /PACKAGE_TOO_LARGE/);
  assert.equal(existsSync(draft), false);
}));
