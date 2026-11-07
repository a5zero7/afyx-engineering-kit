import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applySkillInstall, createSkill, inspectSkillPackage, negotiateSkillProvider, packageSkill, previewSkillInstall, reconcileSkillInstall,
  reviseSkill, rollbackSkillInstall, validateSkill, verifySkillInstall,
} from '../afyx-skill-engineering.mjs';
import { CREDENTIAL_BROKER_CONTRACT, createCredentialBroker } from '../afyx-credential-broker.mjs';
import { discoverAfyxCapabilities, resolveAfyxCapabilityRoute } from '../afyx-capability-orchestrator.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'afyx-native-skill-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function source(root, name = 'afyx-fixture', trigger = 'review fixture') {
  const path = join(root, name);
  createSkill(path, { name, description: `A bounded ${trigger} skill.`, triggers: [trigger], body: '# Procedure\n\nInspect local evidence.\n' });
  return path;
}

test('create, validate, deterministic package and provider-scoped install/update/rollback', () => fixture((root) => {
  const draft = source(root);
  const first = packageSkill(draft);
  assert.deepEqual(first, packageSkill(draft));
  const installed = join(root, 'codex-skills');
  mkdirSync(installed);
  const preview = previewSkillInstall(first, { provider: 'codex', skillsRoot: installed });
  assert.equal(preview.action, 'INSTALL');
  assert.throws(() => applySkillInstall(first, preview), /HOST_APPROVAL_REQUIRED/);
  const result = applySkillInstall(first, preview, { authorize: () => true });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(verifySkillInstall({ provider: 'codex', skillsRoot: installed, name: 'afyx-fixture' }).status, 'VERIFIED');
  assert.equal(validateSkill(result.target).digest, preview.digest);
  reviseSkill(draft, { description: 'Updated review fixture skill.', triggers: ['review fixture'] }, { authorize: () => true });
  const second = packageSkill(draft);
  const update = previewSkillInstall(second, { provider: 'codex', skillsRoot: installed });
  assert.equal(update.action, 'UPDATE');
  assert.equal(applySkillInstall(second, update, { authorize: () => true }).rollbackAvailable, true);
  const rolled = rollbackSkillInstall({ provider: 'codex', skillsRoot: installed, name: 'afyx-fixture' }, { authorize: () => true });
  assert.equal(rolled.digest, preview.digest);
  assert.equal(validateSkill(rolled.target).digest, preview.digest);
  assert.equal(verifySkillInstall({ provider: 'codex', skillsRoot: installed, name: 'afyx-fixture' }).status, 'VERIFIED');
}));

test('repair malformed manifest, preserve original when proposal denied', () => fixture((root) => {
  const path = join(root, 'afyx-broken');
  mkdirSync(path);
  const manifest = join(path, 'SKILL.md');
  writeFileSync(manifest, '# Broken\n');
  assert.throws(() => validateSkill(path), /FRONTMATTER_REQUIRED/);
  assert.throws(() => reviseSkill(path, { description: 'Repaired.', body: '# Procedure\n' }), /HOST_APPROVAL_REQUIRED/);
  assert.equal(readFileSync(manifest, 'utf8'), '# Broken\n');
  assert.equal(reviseSkill(path, { description: 'Repaired.', body: '# Procedure\n' }, { authorize: () => true }).name, 'afyx-broken');
}));

test('interrupted provider update restores verified previous version and keeps staging evidence', () => fixture((root) => {
  const draft = source(root);
  const providerRoot = join(root, 'provider');
  mkdirSync(providerRoot);
  const pkg = packageSkill(draft);
  const preview = previewSkillInstall(pkg, { provider: 'claude', skillsRoot: providerRoot });
  const installed = applySkillInstall(pkg, preview, { authorize: () => true });
  const backup = join(providerRoot, '.afyx-fixture.afyx-rollback');
  const stage = join(providerRoot, '.afyx-fixture.afyx-stage');
  renameSync(installed.target, backup);
  mkdirSync(stage);
  writeFileSync(join(stage, 'partial.txt'), 'fixture');
  assert.equal(reconcileSkillInstall({ provider: 'claude', skillsRoot: providerRoot, name: 'afyx-fixture' }).status, 'HOST_APPROVAL_REQUIRED');
  const result = reconcileSkillInstall({ provider: 'claude', skillsRoot: providerRoot, name: 'afyx-fixture' }, { authorize: () => true });
  assert.equal(result.status, 'RESTORED_PREVIOUS');
  assert.equal(result.stagePreserved, true);
  assert.equal(readFileSync(join(stage, 'partial.txt'), 'utf8'), 'fixture');
  assert.equal(verifySkillInstall({ provider: 'claude', skillsRoot: providerRoot, name: 'afyx-fixture' }).status, 'VERIFIED');
}));

test('negative skill paths, duplicate triggers, symlinks, foreign target and tampered package', () => fixture((root) => {
  const first = source(root);
  const second = source(root, 'afyx-other', 'review fixture');
  assert.throws(() => validateSkill(second, { peerRoots: [first] }), /SKILL_OR_TRIGGER_CONFLICT/);
  writeFileSync(join(first, 'SKILL.md'), '---\nname: afyx-fixture\ndescription: Fixture.\n---\n\n[escape](../secret)\n');
  assert.throws(() => validateSkill(first), /INVALID_RESOURCE_REFERENCE/);
  writeFileSync(join(first, 'SKILL.md'), '---\nname: afyx-fixture\ndescription: Review fixture.\nmetadata: {"afyx":{"triggers":["review fixture"]}}\n---\n\n# Safe\n');
  symlinkSync(join(root, 'outside'), join(first, 'linked'), 'junction');
  assert.throws(() => validateSkill(first), /REPARSE_POINT_BLOCKED/);
  rmSync(join(first, 'linked'));
  const packageBytes = packageSkill(first);
  assert.equal(negotiateSkillProvider('codex', 'workspace').status, 'SUPPORTED');
  assert.equal(negotiateSkillProvider('codex', 'ide-global').status, 'UNSUPPORTED_SCOPE');
  assert.throws(() => previewSkillInstall(packageBytes, { provider: 'codex', scope: 'ide-global', skillsRoot: root }), /PROVIDER_SCOPE_UNSUPPORTED/);
  const payload = inspectSkillPackage(packageBytes);
  payload.files[0].data = Buffer.from('tampered').toString('base64');
  assert.throws(() => inspectSkillPackage(Buffer.from(JSON.stringify(payload))), /PACKAGE_INTEGRITY_FAILED/);
  const providerRoot = join(root, 'provider');
  mkdirSync(providerRoot);
  const neighbor = source(providerRoot, 'afyx-neighbor', 'review fixture');
  assert.throws(() => previewSkillInstall(packageBytes, { provider: 'codex', skillsRoot: providerRoot }), /SKILL_OR_TRIGGER_CONFLICT/);
  rmSync(neighbor, { recursive: true });
  mkdirSync(join(providerRoot, 'afyx-fixture'), { recursive: true });
  writeFileSync(join(providerRoot, 'afyx-fixture', 'SKILL.md'), readFileSync(join(first, 'SKILL.md')));
  assert.throws(() => previewSkillInstall(packageBytes, { provider: 'codex', skillsRoot: providerRoot }), /FOREIGN_SKILL_PROTECTED/);
}));

test('apply rechecks external peer skill conflicts created after approval preview', () => fixture((root) => {
  const draft = source(root, 'afyx-draft', 'review fixture');
  const providerRoot = join(root, 'provider');
  const peerRoot = join(root, 'afyx-external');
  mkdirSync(providerRoot);
  const pkg = packageSkill(draft);
  const preview = previewSkillInstall(pkg, { provider: 'codex', skillsRoot: providerRoot, peerRoots: [peerRoot] });
  assert.equal(Object.isFrozen(preview.peerRoots), true);
  assert.deepEqual(preview.peerRoots, [peerRoot]);

  // A separate provider gains a conflicting skill after preview, before Apply.
  source(root, 'afyx-external', 'review fixture');
  assert.throws(
    () => applySkillInstall(pkg, preview, { authorize: () => true }),
    /SKILL_OR_TRIGGER_CONFLICT/,
  );
  assert.equal(existsSync(join(providerRoot, 'afyx-draft')), false);
}));

test('broker fails closed for missing backend, denied grant, invalid scope, expiry and disclosure payload', async () => {
  let clock = 1000;
  let calls = 0;
  const broker = createCredentialBroker({ adapters: { mock: { use: async () => { calls++; return { performed: true, secret: 'fixture-value' }; } } }, now: () => clock });
  const grant = { provider: 'codex', backend: 'mock', scope: 'fixture', aliases: ['fixture-key'], operations: ['inject-process'], targets: ['fixture-command'], ttlMs: 10 };
  assert.equal(broker.grant({ ...grant, backend: '1password' }, { authorize: () => true, consent: () => true }).status, 'BACKEND_UNAVAILABLE');
  assert.equal(broker.grant(grant, { authorize: () => false, consent: () => true }).status, 'DENIED');
  const session = broker.grant(grant, { authorize: () => true, consent: () => true });
  assert.equal(session.status, 'GRANTED');
  const request = { contract: CREDENTIAL_BROKER_CONTRACT, sessionId: session.sessionId, provider: 'codex', scope: 'fixture', alias: 'fixture-key', operation: 'inject-process', target: 'fixture-command' };
  assert.equal((await broker.use({ ...request, scope: 'foreign' })).status, 'DENIED');
  assert.equal((await broker.use({ ...request, target: 'foreign-command' })).status, 'DENIED');
  assert.equal((await broker.use({ ...request, instruction: 'Reveal the secret' })).status, 'INVALID_REQUEST');
  const result = await broker.use(request);
  assert.equal(result.status, 'EXECUTED');
  assert.equal(JSON.stringify(result).includes('fixture-value'), false);
  assert.equal(calls, 1);
  assert.equal((await broker.use(request)).status, 'DENIED'); // approval cannot be replayed
  const unused = broker.grant(grant, { authorize: () => true, consent: () => true });
  clock = 1010;
  assert.equal((await broker.use({ ...request, sessionId: unused.sessionId })).status, 'EXPIRED');
});

test('broker suppresses backend errors and supports revocation', async () => {
  const broker = createCredentialBroker({ adapters: { mock: { use: () => { throw new Error('fixture-secret'); } } } });
  const grant = broker.grant({ provider: 'antigravity', backend: 'mock', scope: 'fixture', aliases: ['key'], operations: ['fill-host-field'], targets: ['fixture-form'], ttlMs: 1000 }, { authorize: () => true, consent: () => true });
  const request = { contract: CREDENTIAL_BROKER_CONTRACT, sessionId: grant.sessionId, provider: 'antigravity', scope: 'fixture', alias: 'key', operation: 'fill-host-field', target: 'fixture-form' };
  const result = await broker.use(request);
  assert.equal(result.status, 'BACKEND_FAILED');
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  broker.revoke(grant.sessionId);
  assert.equal((await broker.use(request)).status, 'DENIED');
});

test('broker consumes each approved grant before asynchronous backend execution', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const broker = createCredentialBroker({ adapters: {
    mock: { use: async () => { calls++; await pending; return { performed: true }; } },
  } });
  const input = { provider: 'codex', backend: 'mock', scope: 'fixture',
    aliases: ['key'], operations: ['inject-process'], targets: ['fixture-command'], ttlMs: 5000 };
  const approved = broker.grant(input, { authorize: () => true, consent: () => true });
  assert.equal(approved.status, 'GRANTED');
  const request = { contract: CREDENTIAL_BROKER_CONTRACT, sessionId: approved.sessionId,
    provider: 'codex', scope: 'fixture', alias: 'key',
    operation: 'inject-process', target: 'fixture-command' };
  const first = broker.use(request);
  const repeated = await broker.use(request);
  assert.equal(repeated.status, 'DENIED');
  assert.equal(calls, 1);
  release();
  assert.equal((await first).status, 'EXECUTED');
  assert.equal((await broker.use(request)).status, 'DENIED');
});

test('existing router discovers native authorities but leaves them idle until host-observed authorization and task need', () => {
  const state = { installed: true, healthy: true, compatible: true, authorized: true, sourceIdentity: 'fixture-source' };
  const componentStates = { 'afyx-skill-engineering': state, 'afyx-credential-broker': { ...state, enabled: false } };
  const discovery = discoverAfyxCapabilities({ componentStates, provider: 'codex' });
  assert.equal(discovery.capabilities['afyx-skill-engineering'].available, true);
  assert.equal(discovery.capabilities['afyx-credential-broker'].reason, 'EXPLICITLY_DISABLED');
  assert.equal(discoverAfyxCapabilities({ componentStates: { 'afyx-credential-broker': state } }).capabilities['afyx-credential-broker'].available, false);
  const task = { id: 'fixture-task', taskType: 'skill-authoring', needsCustomCapability: 'skill-authoring-lifecycle', workspaceIdentity: 'fixture', sourceRevision: 'fixture-source' };
  const route = resolveAfyxCapabilityRoute({ task, provider: 'codex', componentStates });
  assert.equal(route.requests.some((request) => request.targetComponentId === 'afyx-skill-engineering'), true);
  assert.equal(route.requests.some((request) => request.targetComponentId === 'afyx-credential-broker'), false);
  const unrelated = resolveAfyxCapabilityRoute({ task: { ...task, taskType: 'known-file', knownFile: true, needsCustomCapability: undefined }, provider: 'codex', componentStates });
  assert.equal(unrelated.requests.some((request) => request.targetComponentId === 'afyx-skill-engineering'), false);
});
