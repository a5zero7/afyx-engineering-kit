import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCliArgs } from '../afyx-npm-installer.mjs';
import { sha256, verifyArtifactAttestation } from '../afyx-graph-artifact.mjs';
import { CliCompactor } from '../../afyx-context/src/cli-compactor.js';
import { cleanTempArtifacts } from '../../afyx-context/src/temp-artifacts.js';

const fixture = t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-b2-governance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test('declarative parser retains aliases, repeatables, inline values and fail-fast errors', () => {
  const ok = [
    [['install', '-n', '--yes', '--preset=recommended'], { dryRun: true, nonInteractive: true, preset: 'recommended' }],
    [['verify', '--skills-root=-fixture'], { skillsRoot: '-fixture' }],
    [['doctor', '--project', 'fixture with spaces'], { project: 'fixture with spaces' }],
    [['update', '--offline', '--no-build-fallback'], { offline: true, noBuildFallback: true }],
    [['uninstall', '--component', 'afyx-context', '--component=afyx-forge'], { componentActions: ['afyx-context', 'afyx-forge'] }],
    [['clean', '--dry-run', '--json', '--max-age-hours', '6'], { dryRun: true, json: true, maxAgeHours: '6' }],
    [['install', '--verify-attestation'], { verifyAttestation: true }],
  ];
  for (const [args, options] of ok) {
    const result = parseCliArgs(args);
    assert.deepEqual(result.errors, []);
    for (const [key, value] of Object.entries(options)) assert.deepEqual(result.options[key], value);
  }
  for (const [args, pattern] of [
    [['install', '--skills-root', '--dry-run'], /requires a value/],
    [['install', '--provider=a', '--provider=b'], /only be specified once/],
    [['verify', '--dry-run'], /not supported/],
    [['install', '--offline', '--verify-attestation'], /cannot be used with --offline/],
    [['doctor', 'unexpected'], /Unknown option/],
    [['clean', '--max-age-hours=-6'], /integer from 6/],
    [['clean', '--max-age-hours=0'], /integer from 6/],
    [['clean', '--max-age-hours=Infinity'], /integer from 6/],
  ]) {
    const result = parseCliArgs(args);
    assert.match(result.errors[0], pattern);
    assert.deepEqual(result.options, {});
  }
});

test('cleanup requires a completed spill, preserves active and foreign data, and performs read-only preview', t => {
  const root = fixture(t);
  const make = () => execFileSync(process.execPath, ['--input-type=module', '-e',
    'import { CliCompactor } from "./afyx-context/src/cli-compactor.js"; ' +
    'console.log(new CliCompactor({spillDir:process.argv[1]}).compact("fixture result").spillFilePath);', root],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', windowsHide: true }).trim();
  const eligible = make();
  const locked = make();
  writeFileSync(join(dirname(locked), 'active.lock'), 'fixture lock');
  const tampered = make();
  writeFileSync(tampered, 'foreign replacement');
  const active = new CliCompactor({ spillDir: root }).compact('active fixture').spillFilePath;
  const foreign = join(root, 'codex-unowned');
  mkdirSync(foreign);
  writeFileSync(join(foreign, 'keep.txt'), 'foreign fixture');
  symlinkSync(foreign, join(root, 'afyx-cli-spill-aaaaaa'), process.platform === 'win32' ? 'junction' : 'dir');
  const now = Date.now() + 7 * 3600 * 1000;
  assert.equal(cleanTempArtifacts({ root, dryRun: true }).eligible, 0);
  const commandPreview = JSON.parse(execFileSync(process.execPath,
    ['bin/afyx-engineering-kit.mjs', 'clean', '--dry-run', '--json'], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8',
      env: { ...process.env, TMP: root, TEMP: root, TMPDIR: root }, windowsHide: true,
    }));
  assert.equal(commandPreview.dryRun, true);
  assert.equal(commandPreview.eligible, 0);
  assert.equal(commandPreview.discovered, 6);
  const preview = cleanTempArtifacts({ root, dryRun: true, now });
  assert.equal(preview.eligible, 1);
  assert.equal(preview.removed, 0);
  assert.equal(preview.reasons.ACTIVE_CREATOR, 1);
  assert.ok(existsSync(eligible));
  const result = cleanTempArtifacts({ root, now });
  assert.equal(result.removed, 1);
  assert.ok(result.estimatedReclaimedBytes > 0);
  assert.ok(!existsSync(eligible));
  for (const file of [active, tampered, locked, join(foreign, 'keep.txt')]) assert.ok(existsSync(file));
});

test('attestation binds the verified subject, signer workflow, repository, and source SHA', t => {
  const archive = join(fixture(t), 'archive.tgz');
  writeFileSync(archive, 'synthetic artifact');
  const identity = { archiveSha256: sha256(archive), sourceRevision: 'a'.repeat(40) };
  const predicateType = 'https://slsa.dev/provenance/v1';
  let digest = identity.archiveSha256;
  let verification = { status: 0 };
  const run = (exe, args, options) => {
    assert.equal(exe, process.execPath);
    assert.equal(options.shell, false);
    assert.equal(options.env.GH_PROMPT_DISABLED, '1');
    if (args.includes('--help')) return { status: 0, stdout: '--repo --signer-workflow --source-digest --format --predicate-type --hostname' };
    assert.ok(args.includes('a5zero7/afyx-engineering-kit'));
    assert.ok(args.includes('a5zero7/afyx-engineering-kit/.github/workflows/graph-release.yml'));
    assert.ok(args.includes(identity.sourceRevision));
    return { stdout: JSON.stringify([{ verificationResult: { statement: { predicateType, subject: [{ digest: { sha256: digest } }] } } }]), ...verification };
  };
  const verify = extra => verifyArtifactAttestation(archive, identity, { executable: process.execPath, run, ...extra });
  assert.equal(verify().status, 'VERIFIED');
  digest = 'b'.repeat(64);
  assert.equal(verify().reason, 'ATTESTATION_SUBJECT_MISMATCH');
  verification = { status: 1, stderr: 'signature failure' };
  assert.equal(verify().accepted, false);
  assert.equal(verify({ executable: null }).status, 'SKIPPED_GH_UNAVAILABLE');
  assert.equal(verify({ executable: null, mode: 'required' }).accepted, false);
  assert.equal(verify({ offline: true }).status, 'SKIPPED_OFFLINE');
  assert.equal(verify({ offline: true, mode: 'required' }).accepted, false);
});
