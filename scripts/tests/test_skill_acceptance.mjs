import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applySkillInstall, createSkill, inspectSkillPackage, packageSkill, previewSkillInstall,
  reviseSkill, rollbackSkillInstall, validateSkill, verifySkillInstall } from '../afyx-skill-engineering.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-skill-acceptance-'));
  t.after(() => rmSync(root, { recursive: true }));
  return root;
}
function draft(root, name = 'afyx-acceptance') {
  const source = join(root, name);
  createSkill(source, { name, description: 'Review fixture source safely.', triggers: ['review fixture'],
    body: '# Procedure\nInspect source without execution.' });
  return source;
}

test('review binds deterministic package inventory and exact preview before each supported provider install/rollback', (t) => {
  const root = fixture(t), source = draft(root);
  const first = packageSkill(source), digest = inspectSkillPackage(first).metadata.digest;
  assert.deepEqual(packageSkill(source), first);
  assert.equal(digest, validateSkill(source).digest);
  for (const provider of ['codex', 'claude', 'antigravity']) {
    const skillsRoot = join(root, provider); mkdirSync(skillsRoot);
    const foreign = join(skillsRoot, 'owner.txt'); writeFileSync(foreign, 'owner bytes\r\n');
    const foreignSha = sha(readFileSync(foreign));
    const preview = previewSkillInstall(first, { provider, skillsRoot });
    let reviews = 0;
    const installed = applySkillInstall(first, preview, { authorize: (actual) => {
      reviews++; assert.deepEqual(actual, preview); assert.equal(actual.digest, digest); return true;
    } });
    assert.equal(reviews, 1); assert.equal(installed.status, 'VERIFIED');
    const providerSource = join(root, `source-${provider}`); mkdirSync(providerSource);
    const updatedSource = draft(providerSource);
    reviseSkill(updatedSource, { description: 'Review fixture safely with receipts.', triggers: ['review fixture'],
      body: '# Procedure\nInspect source and save a receipt.' }, { authorize: () => true });
    const second = packageSkill(updatedSource), update = previewSkillInstall(second, { provider, skillsRoot });
    assert.equal(update.action, 'UPDATE');
    assert.equal(applySkillInstall(second, update, { authorize: () => true }).status, 'VERIFIED');
    const rolled = rollbackSkillInstall({ provider, skillsRoot, name: 'afyx-acceptance' }, { authorize: () => true });
    assert.equal(rolled.digest, digest);
    assert.equal(verifySkillInstall({ provider, skillsRoot, name: 'afyx-acceptance' }).status, 'VERIFIED');
    assert.equal(sha(readFileSync(foreign)), foreignSha);
    assert.ok(existsSync(rolled.displaced));
  }
});

test('malformed metadata and unsafe linked assets fail without writing or executing source', (t) => {
  const root = fixture(t);
  for (const [name, content, expected] of [
    ['afyx-invalid', '---\nname: afyx-invalid\ndescription: Test.\nmetadata: {bad}\n---\n', /INVALID_METADATA/],
    ['afyx-duplicate', '---\nname: afyx-duplicate\nname: afyx-duplicate\ndescription: Test.\n---\n', /DUPLICATE_METADATA/],
  ]) {
    const source = join(root, name); mkdirSync(source); const manifest = join(source, 'SKILL.md');
    writeFileSync(manifest, content); const before = sha(readFileSync(manifest));
    assert.throws(() => packageSkill(source), expected);
    assert.equal(sha(readFileSync(manifest)), before);
  }
  const source = draft(root), external = join(root, 'owner'); mkdirSync(external);
  writeFileSync(join(external, 'secret.txt'), 'owner evidence');
  symlinkSync(external, join(source, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => packageSkill(source), /REPARSE_POINT_BLOCKED/);
  assert.equal(readFileSync(join(external, 'secret.txt'), 'utf8'), 'owner evidence');
});

test('archive traversal, absolute paths, ownership marker injection and duplicate members reject before installation', (t) => {
  const root = fixture(t), source = draft(root), first = packageSkill(source);
  const skillsRoot = join(root, 'provider'); mkdirSync(skillsRoot);
  for (const path of ['../outside.txt', '/absolute', 'assets/../../outside', 'C:/outside',
    'assets\\outside', '.afyx-skill-ownership.json', 'assets//outside']) {
    const payload = JSON.parse(first); payload.files.push({ path, data: Buffer.from('untrusted').toString('base64') });
    assert.throws(() => previewSkillInstall(Buffer.from(JSON.stringify(payload)), { provider: 'codex', skillsRoot }), /PACKAGE_PATH_INVALID/);
    assert.deepEqual(readdirSync(skillsRoot), []);
  }
  const payload = JSON.parse(first); payload.files.push(payload.files[0]);
  assert.throws(() => inspectSkillPackage(Buffer.from(JSON.stringify(payload))), /PACKAGE_PATH_INVALID/);
  assert.ok(!existsSync(join(root, 'outside.txt')));
});

test('review denial, stale preview and stage collision leave unrelated files and source intact', (t) => {
  const root = fixture(t), source = draft(root), pkg = packageSkill(source);
  const skillsRoot = join(root, 'provider'); mkdirSync(skillsRoot);
  const preview = previewSkillInstall(pkg, { provider: 'codex', skillsRoot });
  assert.throws(() => applySkillInstall(pkg, preview, { authorize: () => false }), /HOST_APPROVAL_REQUIRED/);
  assert.deepEqual(readdirSync(skillsRoot), []);
  const stage = join(skillsRoot, '.afyx-acceptance.afyx-stage'); mkdirSync(stage);
  writeFileSync(join(stage, 'owner.txt'), 'existing stage evidence');
  assert.throws(() => applySkillInstall(pkg, preview, { authorize: () => true }), /TRANSACTION_RECONCILIATION_REQUIRED/);
  assert.equal(readFileSync(join(stage, 'owner.txt'), 'utf8'), 'existing stage evidence');
  const elsewhere = join(root, 'elsewhere'); mkdirSync(elsewhere);
  const fresh = previewSkillInstall(pkg, { provider: 'codex', skillsRoot: elsewhere });
  applySkillInstall(pkg, fresh, { authorize: () => true });
  assert.throws(() => applySkillInstall(pkg, fresh, { authorize: () => true }), /PREVIEW_STALE/);
});
