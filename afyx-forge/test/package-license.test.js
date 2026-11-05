import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const forgeRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(forgeRoot, '..');
const stager = path.join(repositoryRoot, 'scripts', 'afyx-forge-artifact.mjs');

function stage(sourceRoot, stageRoot) {
  return spawnSync(process.execPath, [
    stager,
    '--source-root', sourceRoot,
    '--stage-dir', stageRoot,
    '--revision', 'a'.repeat(40),
    '--provenance', 'TEST_FIXTURE',
    '--installed-at', '2026-11-05T00:00:00.000Z',
  ], { encoding: 'utf8' });
}

test('Forge artifact includes the declared Apache-2.0 license in integrity evidence', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'afyx-forge-license-'));
  try {
    const stageRoot = path.join(temporaryRoot, 'stage');
    const result = stage(forgeRoot, stageRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const sourceLicense = readFileSync(path.join(forgeRoot, 'LICENSE'), 'utf8');
    const stagedLicense = readFileSync(path.join(stageRoot, 'current', 'LICENSE'), 'utf8');
    assert.equal(stagedLicense, sourceLicense);
    assert.match(readFileSync(path.join(stageRoot, 'integrity.sha256'), 'utf8'), /  current\/LICENSE$/m);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('Forge artifact staging rejects a source without its declared license', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'afyx-forge-license-negative-'));
  try {
    const sourceRoot = path.join(temporaryRoot, 'source');
    cpSync(forgeRoot, sourceRoot, {
      recursive: true,
      filter: (source) => path.resolve(source) !== path.resolve(forgeRoot, 'LICENSE'),
    });

    const result = stage(sourceRoot, path.join(temporaryRoot, 'stage'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing Afyx Forge source manifests or LICENSE/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('Forge artifact staging rejects modified license content', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'afyx-forge-license-modified-'));
  try {
    const sourceRoot = path.join(temporaryRoot, 'source');
    cpSync(forgeRoot, sourceRoot, { recursive: true });
    const licensePath = path.join(sourceRoot, 'LICENSE');
    writeFileSync(licensePath, `${readFileSync(licensePath, 'utf8')}\nmodified\n`);

    const result = stage(sourceRoot, path.join(temporaryRoot, 'stage'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /complete Apache-2\.0 license/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
