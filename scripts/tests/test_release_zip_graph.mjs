import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(root, 'afyx-graph', 'engine', 'release');
const helper = join(root, 'scripts', 'validate-release-zip-graph.mjs');
const revision = 'c38780fcb3113c95b157c6a8f77341bf67f583a8';
const name = 'afyx-graph-win32-x64.zip';

function fixture() {
  const release = mkdtempSync(join(tmpdir(), 'afyx-333-graph-'));
  for (const file of [name, 'RELEASE-MANIFEST.json', 'SHA256SUMS']) {
    copyFileSync(join(source, file), join(release, file));
  }
  return release;
}

function check(release, wanted = revision) {
  return spawnSync(process.execPath, [helper, 'verify', '--release', release, '--root', root, '--revision', wanted],
    { encoding: 'utf8' });
}

function manifest(release, mutate) {
  const path = join(release, 'RELEASE-MANIFEST.json');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
}

test('stale local Graph cache is rejected', (t) => {
  const release = fixture(); t.after(() => rmSync(release, { recursive: true, force: true }));
  assert.match(check(release).stderr, /manifest source\/product mismatch/);
});

test('missing archive and missing checksum fail closed', (t) => {
  const release = fixture(); t.after(() => rmSync(release, { recursive: true, force: true }));
  manifest(release, (value) => { value.source_revision = revision; });
  assert.match(check(release).stderr, /Embedded Graph metadata source\/target mismatch/);
  writeFileSync(join(release, 'SHA256SUMS'), '');
  assert.match(check(release).stderr, /SHA256SUMS entry/);
  writeFileSync(join(release, 'SHA256SUMS'), readFileSync(join(source, 'SHA256SUMS')));
  rmSync(join(release, name));
  assert.notEqual(check(release).status, 0);
});

test('wrong target and corrupt bytes are rejected', (t) => {
  const release = fixture(); t.after(() => rmSync(release, { recursive: true, force: true }));
  manifest(release, (value) => {
    value.source_revision = revision;
    value.artifacts.find((item) => item.file === name).target = 'win32-arm64';
  });
  assert.match(check(release).stderr, /Windows x64 Graph manifest entry/);
  manifest(release, (value) => { value.artifacts.find((item) => item.file === name).target = 'win32-x64'; });
  writeFileSync(join(release, name), 'not a ZIP');
  assert.match(check(release).stderr, /checksum mismatch/);
});

test('malformed or duplicated checksum entry is rejected', (t) => {
  const release = fixture(); t.after(() => rmSync(release, { recursive: true, force: true }));
  manifest(release, (value) => { value.source_revision = revision; });
  writeFileSync(join(release, 'SHA256SUMS'), `bad  ${name}\n`);
  assert.match(check(release).stderr, /SHA256SUMS entry/);
  const original = readFileSync(join(source, 'SHA256SUMS'), 'utf8');
  writeFileSync(join(release, 'SHA256SUMS'), original + original.split('\n').find((line) => line.endsWith(name)) + '\n');
  assert.match(check(release).stderr, /SHA256SUMS entry/);
});

test('invalid revision is rejected before archive access', () => {
  const result = check('missing', 'bad');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Exact source commit SHA required/);
});

test('truncated archive is rejected even when its manifest and checksum agree', (t) => {
  const release = fixture(); t.after(() => rmSync(release, { recursive: true, force: true }));
  const broken = readFileSync(join(release, name)).subarray(0, 100);
  writeFileSync(join(release, name), broken);
  const digest = createHash('sha256').update(broken).digest('hex');
  manifest(release, (value) => {
    value.source_revision = revision;
    value.artifacts.find((item) => item.file === name).sha256 = digest;
  });
  writeFileSync(join(release, 'SHA256SUMS'), `${digest}  ${name}\n`);
  assert.match(check(release).stderr, /central directory is missing/);
});
