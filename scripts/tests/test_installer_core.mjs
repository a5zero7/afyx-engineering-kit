import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertContainedTarget,
  assertSafeBackupPath,
  compareSemver,
  computeBackupDigest,
  computeSkillDigest,
  evaluateSkillOwnership,
  formatBackupReceipt,
  isComponentDesired,
  loadComponentsContract,
  normalizeRootPath,
  parseBackupReceipt,
  parseSkillMarker,
  planBackupRetention,
  planLifecycleAction,
  resolveComponentId,
  SKILL_MARKER_FILENAME,
  validateSkillManifest,
  writeAtomicFile,
} from '../afyx-installer-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORE_CLI = resolve(__dirname, '../afyx-installer-core.mjs');
const REPO_ROOT = resolve(__dirname, '../..');

function withDisposableTemp(fn) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-core-test-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('path normalization handles spaces and rejects empty roots', () => {
  withDisposableTemp((root) => {
    const spaced = join(root, 'Program Files', 'AFYX Skills');
    mkdirSync(spaced, { recursive: true });
    assert.equal(normalizeRootPath(`${spaced}${process.platform === 'win32' ? '\\' : '/'}`), resolve(spaced));
  });
  assert.throws(() => normalizeRootPath(''), /non-empty/);
  assert.throws(() => normalizeRootPath('   '), /non-empty/);
});

test('containment rejects traversal, root self-target, and symlink escapes', (t) => {
  withDisposableTemp((root) => {
    const skillsRoot = join(root, 'skills');
    const outside = join(root, 'outside');
    mkdirSync(skillsRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });

    const valid = join(skillsRoot, 'afyx-forge');
    mkdirSync(valid, { recursive: true });
    assert.deepEqual(assertContainedTarget(skillsRoot, valid), {
      root: normalizeRootPath(skillsRoot),
      target: normalizeRootPath(valid),
    });

    assert.throws(() => assertContainedTarget(skillsRoot, skillsRoot), /escapes/);
    assert.throws(() => assertContainedTarget(skillsRoot, join(skillsRoot, '..', 'outside')), /escapes/);
    assert.throws(() => assertContainedTarget(skillsRoot, join(valid, 'nested')), /escapes/);

    const linkTarget = join(skillsRoot, 'linked-skill');
    try {
      symlinkSync(outside, linkTarget, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => assertContainedTarget(skillsRoot, linkTarget), /reparse-point|symlinked/);
    } catch (err) {
      if (err?.code === 'EPERM') {
        t.diagnostic('Symlink creation requires elevated privileges on this host; skipping symlink subcheck');
      } else {
        throw err;
      }
    }
  });
});

test('manifest validation handles valid, malformed, incomplete, and missing version', () => {
  withDisposableTemp((root) => {
    const validDir = join(root, 'valid');
    mkdirSync(validDir, { recursive: true });
    writeFileSync(join(validDir, 'SKILL.md'), '---\nname: afyx-test\nmetadata:\n  version: "1.1.0"\n---\n# Test\n');
    const ok = validateSkillManifest(validDir, true);
    assert.equal(ok.valid, true);
    assert.equal(ok.name, 'afyx-test');
    assert.equal(ok.version, '1.1.0');

    const noVersion = join(root, 'no-version');
    mkdirSync(noVersion, { recursive: true });
    writeFileSync(join(noVersion, 'SKILL.md'), '---\nname: afyx-test\n---\n');
    assert.equal(validateSkillManifest(noVersion, false).valid, true);
    assert.equal(validateSkillManifest(noVersion, true).valid, false);
    assert.equal(validateSkillManifest(noVersion, true).reason, 'MISSING_VERSION');

    const badFm = join(root, 'bad-fm');
    mkdirSync(badFm, { recursive: true });
    writeFileSync(join(badFm, 'SKILL.md'), '# Missing frontmatter\n');
    assert.equal(validateSkillManifest(badFm, false).reason, 'MISSING_FRONTMATTER');
  });
});

test('version comparison and component contract resolution work deterministically', () => {
  assert.equal(compareSemver('1.0.2', '1.1.0'), -1);
  assert.equal(compareSemver('1.1.0', '1.1.0'), 0);
  assert.equal(compareSemver('1.1.0', '1.0.2'), 1);
  assert.equal(compareSemver('1.1.0-alpha.1', '1.1.0'), -1);
  assert.throws(() => compareSemver('invalid', '1.0.0'), /Invalid semantic version/);

  assert.equal(resolveComponentId('efficient-coding'), 'afyx-efficient-coding');
  assert.equal(resolveComponentId('odoo-engineering'), 'afyx-odoo-engineering');
  assert.equal(resolveComponentId('codex-usage-tracking'), 'afyx-usage-intelligence');

  const contract = loadComponentsContract(join(REPO_ROOT, 'scripts', 'components.json'));
  assert.equal(contract.schema_version, 1);
  const usage = contract.components.find((c) => c.id === 'afyx-usage-intelligence');
  assert.equal(isComponentDesired(usage, { preset: 'full', providers: ['codex'] }), true);
  assert.equal(isComponentDesired(usage, { preset: 'full', providers: ['claude'] }), false);
});

test('receipt atomic persistence, ownership evaluation, and lifecycle planning work end-to-end', () => {
  withDisposableTemp((root) => {
    const skillDir = join(root, 'afyx-efficient-coding');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: afyx-efficient-coding\n---\n');

    assert.equal(evaluateSkillOwnership(join(root, 'missing'), 'afyx-efficient-coding', 'afyx'), 'NOT_INSTALLED');
    assert.equal(evaluateSkillOwnership(skillDir, 'afyx-efficient-coding', 'afyx'), 'FOREIGN_UNPROVEN');

    const digest = computeSkillDigest(skillDir);
    const markerPath = join(skillDir, SKILL_MARKER_FILENAME);
    writeAtomicFile(markerPath, JSON.stringify({
      schema: 1,
      product: 'Afyx Codex Engineering Kit',
      component: 'afyx-efficient-coding',
      owner: 'afyx',
      version: '1.1.0',
      content_sha256: digest,
    }));

    assert.equal(parseSkillMarker(markerPath).version, '1.1.0');
    assert.equal(evaluateSkillOwnership(skillDir, 'afyx-efficient-coding', 'afyx'), 'AFYX_OWNED_UNMODIFIED');

    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: afyx-efficient-coding\n---\n# modified\n');
    assert.equal(evaluateSkillOwnership(skillDir, 'afyx-efficient-coding', 'afyx'), 'AFYX_OWNED_MODIFIED');

    assert.equal(planLifecycleAction({ currentState: 'NOT INSTALLED' }).action, 'install');
    assert.equal(planLifecycleAction({ currentState: 'HEALTHY', ownership: 'AFYX_OWNED_UNMODIFIED', currentVersion: '1.0.2', availableVersion: '1.1.0' }).action, 'update');
    assert.equal(planLifecycleAction({ currentState: 'HEALTHY', ownership: 'AFYX_OWNED_UNMODIFIED', currentVersion: '1.1.0', availableVersion: '1.0.2', allowDowngrade: false }).allowed, false);
    assert.equal(planLifecycleAction({ currentState: 'HEALTHY', ownership: 'AFYX_OWNED_UNMODIFIED', currentVersion: '1.1.0', availableVersion: '1.0.2', allowDowngrade: true }).action, 'downgrade');
    assert.equal(planLifecycleAction({ currentState: 'DRIFTED', ownership: 'AFYX_OWNED_MODIFIED', force: false }).allowed, false);
    assert.equal(planLifecycleAction({ currentState: 'DRIFTED', ownership: 'AFYX_OWNED_MODIFIED', force: true }).action, 'repair');
  });
});

test('backup retention preserves active and foreign backups while pruning excess verified backups', () => {
  withDisposableTemp((root) => {
    const compRoot = join(root, 'backups', 'afyx-efficient-coding');
    mkdirSync(compRoot, { recursive: true });
    assertSafeBackupPath(compRoot);

    const names = [
      '20261125-010000-a',
      '20261125-020000-b',
      '20261125-030000-c',
      '20261125-040000-d',
      '20261125-050000-e',
      '20261125-060000-f',
      '20261125-070000-g',
    ];
    for (const name of names) {
      const dir = join(compRoot, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'file.txt'), `payload-${name}`);
      const digest = computeBackupDigest(dir);
      const receipt = formatBackupReceipt('afyx-efficient-coding', name, digest);
      assert.ok(parseBackupReceipt(receipt, 'afyx-efficient-coding', name));
      writeFileSync(`${dir}.afyx-backup`, receipt);
    }

    // Mark newest as active rollback and add a foreign unverified backup
    writeFileSync(`${join(compRoot, names[6])}.afyx-active`, 'active rollback');
    const foreign = join(compRoot, '20250101-000000-foreign');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'keep.txt'), 'foreign');

    const keep5 = planBackupRetention(compRoot, 'afyx-efficient-coding', { keep: 5 });
    assert.equal(keep5.verified.length, 6);
    assert.equal(keep5.toRemove.length, 1);
    assert.equal(keep5.toRemove[0].name, names[0]);
    assert.ok(keep5.preserved.includes(join(compRoot, names[6])));
    assert.ok(keep5.preserved.includes(foreign));

    const purgeAll = planBackupRetention(compRoot, 'afyx-efficient-coding', { keep: 0 });
    assert.equal(purgeAll.toRemove.length, 6);

    // CLI contract + exit code parity
    const okCli = spawnSync('node', [CORE_CLI, 'plan-backup-retention', '--root', compRoot, '--component', 'afyx-efficient-coding', '--keep', '5'], { encoding: 'utf8' });
    assert.equal(okCli.status, 0);
    const parsed = JSON.parse(okCli.stdout);
    assert.equal(parsed.toRemove.length, 1);

    const badCli = spawnSync('node', [CORE_CLI, 'unknown-op'], { encoding: 'utf8' });
    assert.equal(badCli.status, 2);
  });
});

test('PowerShell backup rotation fallback parity works with AFYX_FORCE_SHELL_FALLBACK=1', () => {
  const res = spawnSync('pwsh', ['-NoProfile', '-File', join(REPO_ROOT, 'scripts/tests/test_backup_rotation.ps1')], {
    encoding: 'utf8',
    env: { ...process.env, AFYX_FORCE_SHELL_FALLBACK: '1' },
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});
