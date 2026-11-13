import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInstallPlan, decodeContract, encodeContract, targetFingerprint } from '../afyx-install-contract.mjs';
import { summarizeExecution } from '../afyx-install-backend.mjs';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../afyx-install-contract.mjs');
function fixture(t) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, 'afyx-plan-contract-'));
  t.after(() => { assert.ok(root.startsWith(`${parent}\\`) || root.startsWith(`${parent}/`)); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(join(root, 'scripts'));
  for (const file of ['install.ps1', 'install.sh', 'verify.ps1', 'verify.sh', 'scripts/components.json',
    'scripts/afyx-install-contract.mjs', 'scripts/afyx-npm-installer.mjs']) writeFileSync(join(root, file), 'fixture');
  writeFileSync(join(root, 'scripts/components.json'), JSON.stringify({ prerequisites: [] }));
  const target = join(root, 'skill');
  mkdirSync(target);
  writeFileSync(join(target, 'SKILL.md'), 'original');
  const config = join(root, 'config.toml');
  writeFileSync(config, '# owner configuration\n');
  const input = { sourceRoot: root, preset: 'recommended', providers: '', scope: 'global', configureProviders: false,
    workspaceRoot: root, platform: 'fixture', configurationPaths: [config], components: [{
      id: 'skill', name: 'Skill', type: 'skill', currentState: 'DRIFTED', desired: true,
      backendAction: 'repair', target, ownership: 'AFYX', version: '1', availableVersion: '2',
      compatibility: 'SUPPORTED', detail: 'modified owned skill',
    }] };
  return { root, target, config, input };
}

test('backend snapshot is deterministic and changes on owned content or foreign configuration edits', (t) => {
  const { target, config, input } = fixture(t);
  const first = createInstallPlan(input);
  assert.equal(createInstallPlan(input).fingerprint, first.fingerprint);
  writeFileSync(join(target, 'SKILL.md'), 'concurrent owner edit');
  const changed = createInstallPlan(input);
  assert.notEqual(changed.fingerprint, first.fingerprint);
  writeFileSync(config, '# concurrent config edit\n');
  assert.notEqual(createInstallPlan(input).fingerprint, changed.fingerprint);
});

test('stale expected fingerprint is rejected before an installer can mutate files', (t) => {
  const { target, input } = fixture(t);
  const expectedFingerprint = createInstallPlan(input).fingerprint;
  writeFileSync(join(target, 'SKILL.md'), 'new owner data');
  const result = spawnSync(process.execPath, [cli, 'plan'], { input: JSON.stringify({ ...input, expectedFingerprint }), encoding: 'utf8' });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /PLAN_CHANGED/);
});

test('additional provider targets and backend source changes invalidate a reviewed plan', (t) => {
  const { root, input } = fixture(t);
  const companion = join(root, 'provider-skills', 'companion');
  input.additionalTargets = [{ id: 'companion', type: 'skill', target: companion }];
  const before = createInstallPlan(input);
  mkdirSync(companion, { recursive: true });
  writeFileSync(join(companion, 'SKILL.md'), 'new provider-owned state');
  const changed = createInstallPlan(input);
  assert.notEqual(changed.fingerprint, before.fingerprint);
  writeFileSync(join(root, 'install.sh'), 'updated backend');
  assert.notEqual(createInstallPlan(input).fingerprint, changed.fingerprint);
});

test('runtime snapshot excludes indexes and old releases outside current program files', (t) => {
  const { root } = fixture(t);
  const runtime = join(root, 'runtime');
  mkdirSync(join(runtime, 'current'), { recursive: true });
  writeFileSync(join(runtime, 'current', 'entry.js'), 'program');
  writeFileSync(join(runtime, 'graph.db'), 'protected dataset');
  const before = targetFingerprint(runtime, 'runtime');
  writeFileSync(join(runtime, 'graph.db'), 'changed dataset');
  assert.equal(targetFingerprint(runtime, 'runtime'), before);
});

test('runtime snapshot follows only owned current links and rejects escapes and cycles', (t) => {
  const { root } = fixture(t);
  const runtime = join(root, 'runtime');
  const release = join(runtime, 'releases', 'v1');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'entry.js'), 'native runtime');
  symlinkSync(release, join(runtime, 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(targetFingerprint(runtime, 'runtime'), /^[0-9a-f]{64}$/);
  rmSync(join(runtime, 'current'));
  symlinkSync(root, join(runtime, 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => targetFingerprint(runtime, 'runtime'), /outside/);
  rmSync(join(runtime, 'current'));
  symlinkSync(runtime, join(runtime, 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => targetFingerprint(runtime, 'runtime'), /cycle/);
});

test('structured response parsing rejects absent, duplicate, and wrong-schema contracts', () => {
  const encoded = encodeContract({ schema: 'AfyxVerification/v1', rows: [] });
  assert.deepEqual(decodeContract(`diagnostic\n${encoded}\n`, 'AfyxVerification/v1').rows, []);
  assert.throws(() => decodeContract('', 'AfyxVerification/v1'), /exactly one/);
  assert.throws(() => decodeContract(`${encoded}\n${encoded}`, 'AfyxVerification/v1'), /exactly one/);
  assert.throws(() => decodeContract(encoded, 'AfyxInstallPlan/v1'), /Unexpected/);
});

test('execution status requires both healthy desired components and successful backend verification', () => {
  const plan = { components: [{ id: 'graph', name: 'Graph', desired: true, currentState: 'HEALTHY', compatibility: 'SUPPORTED', version: '1', detail: 'verified' }] };
  assert.equal(summarizeExecution(plan, { rows: [], exitCode: 0 }, 0).status, 'PASS');
  assert.equal(summarizeExecution(plan, { rows: [], exitCode: 1 }, 0).status, 'FAILED');
  assert.equal(summarizeExecution({ components: [{ ...plan.components[0], currentState: 'INVALID' }] }, { rows: [], exitCode: 0 }, 0).status, 'FAILED');
});
