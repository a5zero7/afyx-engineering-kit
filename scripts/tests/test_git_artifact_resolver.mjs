import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import {
  resolveGitRevision,
  getCandidateTagsForRevision,
  resolveAndStageGitReleaseArtifacts,
  validateReleaseChecksums,
} from '../resolve-git-release-artifacts.mjs';
import { verifyGraphArchivePaths } from '../verify-graph-archive.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('T01 & T02: Git Release Artifact Resolver & Packaging Lifecycle', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

  test('resolveGitRevision: determines exact 40-character Git SHA', () => {
    const revision = resolveGitRevision(root);
    assert.ok(revision, 'Revision must be determined');
    assert.match(revision, /^[0-9a-f]{40}$/, 'Must be exact 40-character SHA');
  });

  test('getCandidateTagsForRevision: generates canonical release tag variants', () => {
    const testSha = '1234567890abcdef1234567890abcdef12345678';
    const tags = getCandidateTagsForRevision(testSha);
    assert.ok(tags.includes(`afyx-dev-${testSha}`));
    assert.ok(tags.includes(`dev-${testSha}`));
    assert.ok(tags.includes(`afyx-dev-1234567890ab`));
    assert.ok(tags.includes(`afyx-dev-snapshot`));
  });

  test('resolveAndStageGitReleaseArtifacts: fails closed on invalid revision', async () => {
    await assert.rejects(
      async () => {
        await resolveAndStageGitReleaseArtifacts(root, 'invalid-short-sha');
      },
      /Valid 40-character Git commit SHA is required/
    );
  });

  test('resolveAndStageGitReleaseArtifacts: fails closed without source compile when release is absent', async () => {
    const fakeSha = '0000000000000000000000000000000000000000';
    await assert.rejects(
      async () => {
        await resolveAndStageGitReleaseArtifacts(root, fakeSha, { fetchBuffer: async () => Buffer.from('[]') });
      },
      /No official precompiled Graph release artifacts found/
    );
  });
});

const revision = '1234567890abcdef1234567890abcdef12345678';
const winName = 'afyx-graph-win32-x64.zip';
const linuxName = 'afyx-graph-linux-x64.tar.gz';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function tinyTar(name = 'bundle/file.txt') {
  const header = Buffer.alloc(512);
  header.write(name, 0);
  header.write('00000000000\0', 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
}

function tinyZip(name = 'bundle/file.txt', unixMode = 0) {
  const file = Buffer.from(name);
  const local = Buffer.alloc(30 + file.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(file.length, 26);
  file.copy(local, 30);
  const central = Buffer.alloc(46 + file.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(file.length, 28);
  central.writeUInt32LE((unixMode << 16) >>> 0, 38);
  file.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

function fixture(overrides = {}) {
  const archives = { [winName]: tinyZip(), [linuxName]: tinyTar(), ...overrides.archives };
  const manifest = overrides.manifest || { source_revision: revision, artifacts: Object.entries(archives)
    .map(([file, bytes]) => ({ file, sha256: digest(bytes) })) };
  const sums = overrides.sums ?? Object.entries(archives).map(([file, bytes]) => `${digest(bytes)}  ${file}`).join('\n');
  const requests = [];
  const fetchBuffer = async (url) => {
    requests.push(url);
    if (url.includes('/commits/')) return Buffer.from(JSON.stringify({ sha: overrides.tagSha ?? revision }));
    if (url.endsWith('/releases')) return Buffer.from('[]');
    if (url.endsWith('/RELEASE-MANIFEST.json')) return Buffer.from(JSON.stringify(manifest));
    if (url.endsWith('/SHA256SUMS')) return Buffer.from(sums);
    const file = Object.keys(archives).find((name) => url.endsWith(`/${name}`));
    if (file && file !== overrides.interruptedFile) return archives[file];
    throw new Error('Interrupted fixture download');
  };
  return { archives, manifest, sums, requests, fetchBuffer };
}

test('verified tag, complete checksums, and safe archives stage together', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-resolver-positive-'));
  try {
    const sample = fixture();
    const result = await resolveAndStageGitReleaseArtifacts(root, revision, { fetchBuffer: sample.fetchBuffer });
    assert.equal(result.revision, revision);
    assert.deepEqual(readFileSync(join(root, 'afyx-graph/engine/release', winName)), sample.archives[winName]);
    assert.ok(sample.requests.some((url) => url.includes('/commits/')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('manifest and SHA256SUMS reject missing, duplicate, and unsafe entries', () => {
  const sample = fixture();
  assert.equal(validateReleaseChecksums(sample.manifest, sample.sums, revision).size, 2);
  assert.throws(() => validateReleaseChecksums(sample.manifest, sample.sums.split('\n')[0], revision), /Missing or mismatched/);
  assert.throws(() => validateReleaseChecksums(sample.manifest, `${sample.sums}\n${sample.sums.split('\n')[0]}`, revision), /duplicate/);
  assert.throws(() => validateReleaseChecksums({ ...sample.manifest, artifacts: [
    { file: '../escape.zip', sha256: '0'.repeat(64) }, sample.manifest.artifacts[1],
  ] }, sample.sums, revision), /Unsafe/);
  assert.throws(() => validateReleaseChecksums({ ...sample.manifest, source_revision: '0'.repeat(40) }, sample.sums, revision), /stale/);
});

test('tag target mismatch and interrupted download leave no staged archives', async () => {
  for (const overrides of [{ tagSha: '0'.repeat(40) }, { interruptedFile: linuxName }]) {
    const root = mkdtempSync(join(tmpdir(), 'afyx-resolver-negative-'));
    try {
      const sample = fixture(overrides);
      await assert.rejects(resolveAndStageGitReleaseArtifacts(root, revision, { fetchBuffer: sample.fetchBuffer }),
        /No official precompiled|Interrupted fixture download/);
      assert.throws(() => readFileSync(join(root, 'afyx-graph/engine/release', winName)), /ENOENT/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('archive inspection rejects traversal, truncation, and symlink-style entries', () => {
  assert.equal(verifyGraphArchivePaths(tinyZip(), winName), 1);
  assert.equal(verifyGraphArchivePaths(tinyTar(), linuxName), 1);
  assert.throws(() => verifyGraphArchivePaths(tinyZip('../escape'), winName), /Unsafe/);
  assert.throws(() => verifyGraphArchivePaths(tinyZip('bundle/link', 0o120777), winName), /symlink/);
  assert.throws(() => verifyGraphArchivePaths(tinyTar('/absolute'), linuxName), /Unsafe/);
  assert.throws(() => verifyGraphArchivePaths(Buffer.from('bad'), winName), /central directory/);
});
