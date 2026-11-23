import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkGraphReleaseValid, prepareG6Package } from '../prepare-g6-package.mjs';

const root = mkdtempSync(join(tmpdir(), 'afyx-g6-package-'));
after(() => rmSync(root, { recursive: true }));
const revision = 'a'.repeat(40);
const release = join(root, 'afyx-graph', 'engine', 'release');
mkdirSync(release, { recursive: true });
writeFileSync(join(root, 'afyx-graph', 'engine', 'package.json'), '{"version":"1.0.0"}');
const files = [
  ['afyx-graph-win32-x64.zip', 'win32-x64'],
  ['afyx-graph-linux-x64.tar.gz', 'linux-x64'],
];
const artifacts = files.map(([file, target]) => {
  writeFileSync(join(release, file), target);
  return { file, target, sha256: createHash('sha256').update(target).digest('hex') };
});
const manifest = { schema: 1, product: 'Afyx Graph', product_version: '1.0.0', source_revision: revision, artifacts };
const manifestPath = join(release, 'RELEASE-MANIFEST.json');
const writeManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest));
writeManifest();
writeFileSync(join(release, 'SHA256SUMS'), artifacts.map(({ file, sha256 }) => `${sha256}  ${file}`).join('\n') + '\n');

test('paket sah menghasilkan penanda revisi sumber tepat', () => {
  assert.equal(existsSync(join(root, '.afyx-source-revision')), false);
  assert.equal(checkGraphReleaseValid(root, revision), true);
  assert.equal(existsSync(join(root, '.afyx-source-revision')), false);
  assert.equal(prepareG6Package(root, revision), revision);
  assert.equal(readFileSync(join(root, '.afyx-source-revision'), 'utf8').trim(), revision);
});
test('preflight menolak checksum hilang tanpa membuat atau memperbarui penanda', () => {
  const sums = join(release, 'SHA256SUMS');
  const original = readFileSync(sums);
  const marker = readFileSync(join(root, '.afyx-source-revision'));
  rmSync(sums);
  try {
    assert.equal(checkGraphReleaseValid(root, revision), false);
    assert.throws(() => prepareG6Package(root, revision), /ENOENT/);
    assert.deepEqual(readFileSync(join(root, '.afyx-source-revision')), marker);
  } finally { writeFileSync(sums, original); }
});
for (const [name, contents] of [
  ['kosong', ''],
  ['malformed', `not-a-digest  ${files[0][0]}\n`],
  ['kurang target', `${artifacts[0].sha256}  ${files[0][0]}\n`],
  ['duplikat target', `${artifacts[0].sha256}  ${files[0][0]}\n${artifacts[0].sha256}  ${files[0][0]}\n`],
  ['digest berbeda', artifacts.map(({ file }) => `${'0'.repeat(64)}  ${file}`).join('\n') + '\n'],
]) {
  test(`preflight menolak SHA256SUMS ${name} tanpa mengubah penanda sumber`, () => {
    const sums = join(release, 'SHA256SUMS');
    const original = readFileSync(sums);
    const marker = readFileSync(join(root, '.afyx-source-revision'));
    writeFileSync(sums, contents);
    try {
      assert.equal(checkGraphReleaseValid(root, revision), false);
      assert.throws(() => prepareG6Package(root, revision), /SHA256SUMS/);
      assert.deepEqual(readFileSync(join(root, '.afyx-source-revision')), marker);
    } finally { writeFileSync(sums, original); }
  });
}

test('arsip berubah ditolak sebelum penanda lain ditulis', () => {
  writeFileSync(join(release, files[0][0]), 'tampered');
  try {
    assert.equal(checkGraphReleaseValid(root, revision), false);
    assert.throws(() => prepareG6Package(root, revision), /SHA256SUMS mismatch|checksum mismatch/);
  } finally {
    writeFileSync(join(release, files[0][0]), files[0][1]);
  }
});

test('manifest dengan revisi berbeda ditolak', () => {
  manifest.source_revision = 'b'.repeat(40);
  writeManifest();
  assert.equal(checkGraphReleaseValid(root, revision), false);
  assert.throws(() => prepareG6Package(root, revision), /does not match/);
  manifest.source_revision = revision;
  writeManifest();
});

test('target arsip yang diduplikasi dalam manifest ditolak', () => {
  manifest.artifacts = [artifacts[0], artifacts[0]];
  writeManifest();
  assert.equal(checkGraphReleaseValid(root, revision), false);
  assert.throws(() => prepareG6Package(root, revision), /duplicate Graph archive target/);
  manifest.artifacts = artifacts;
  writeManifest();
});
