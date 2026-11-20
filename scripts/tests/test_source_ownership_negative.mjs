import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const SCRIPT_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const VERIFIER = join(REPO_ROOT, 'scripts', 'verify-native-source-ownership.mjs');

function createDisposableFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'afyx-ownership-neg-'));
  // Create minimal mirror required for verify script
  const scriptsDir = join(tempDir, 'scripts');
  const contextDir = join(tempDir, 'afyx-context', 'src');
  const forgeDir = join(tempDir, 'afyx-forge', 'src');
  const usageDir = join(tempDir, 'tools', 'afyx-usage-intelligence');
  const graphEngineSrc = join(tempDir, 'afyx-graph', 'engine', 'src');
  const graphEngineUi = join(tempDir, 'afyx-graph', 'engine', 'ui', 'src');

  // Copy minimal valid manifest
  const validManifest = {
    schema: 1,
    baselineRevision: 'c4e4d8e29de239a2fcbc0db8ac65eea2276e7b00',
    totalProductionFiles: 1,
    entries: [
      {
        path: 'scripts/fixture-valid.mjs',
        classification: 'AFYX_NATIVE_IMPLEMENTATION',
        reviewedSha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
        evidence: 'Valid synthetic test fixture for negative ownership verifier gate tests.',
      },
    ],
  };

  const fixtureFiles = [
    scriptsDir, contextDir, forgeDir, usageDir, graphEngineSrc, graphEngineUi
  ];
  for (const dir of fixtureFiles) {
    cpSync(join(REPO_ROOT, 'scripts'), scriptsDir, { recursive: true, filter: (src) => !src.includes('node_modules') });
    break;
  }

  return { tempDir };
}

function runVerifier(args = []) {
  try {
    const stdout = execFileSync(process.execPath, [VERIFIER, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : '',
    };
  }
}

test('Negative Gate 1: Unregistered production .mjs in scripts/ fails closed', () => {
  const rogueFile = join(REPO_ROOT, 'scripts', '__temp_rogue_unregistered.mjs');
  try {
    writeFileSync(rogueFile, '// rogue production file\nexport const x = 1;\n');
    const result = runVerifier();
    assert.notEqual(result.status, 0, 'Verifier must exit nonzero on unregistered script');
    assert.match(result.stderr, /unclassified production source file detected: scripts\/__temp_rogue_unregistered\.mjs/);
  } finally {
    if (existsSync(rogueFile)) rmSync(rogueFile, { force: true });
  }
});

test('Negative Gate 2: Unregistered production .js in afyx-context/src/ fails closed', () => {
  const rogueFile = join(REPO_ROOT, 'afyx-context', 'src', '__temp_rogue_unregistered.js');
  try {
    writeFileSync(rogueFile, '// rogue context file\nexport const ctx = {};\n');
    const result = runVerifier();
    assert.notEqual(result.status, 0, 'Verifier must exit nonzero on unregistered context file');
    assert.match(result.stderr, /unclassified production source file detected: afyx-context\/src\/__temp_rogue_unregistered\.js/);
  } finally {
    if (existsSync(rogueFile)) rmSync(rogueFile, { force: true });
  }
});

test('Negative Gate 3: Unregistered .psm1 in tools/afyx-usage-intelligence/ fails closed', () => {
  const rogueFile = join(REPO_ROOT, 'tools', 'afyx-usage-intelligence', '__temp_rogue_unregistered.psm1');
  try {
    writeFileSync(rogueFile, '# rogue psm1 module\nfunction Get-Rogue { return 42 }\n');
    const result = runVerifier();
    assert.notEqual(result.status, 0, 'Verifier must exit nonzero on unregistered psm1');
    assert.match(result.stderr, /unclassified production source file detected: tools\/afyx-usage-intelligence\/__temp_rogue_unregistered\.psm1/);
  } finally {
    if (existsSync(rogueFile)) rmSync(rogueFile, { force: true });
  }
});

test('Negative Gate 4: Incorrect file hash fails closed with reviewed source drift', () => {
  const tempManifest = join(tmpdir(), `afyx-test-drift-manifest-${Date.now()}.json`);
  try {
    const original = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'native-source-ownership.json'), 'utf8'));
    // Tamper with first entry's hash
    original.entries[0].reviewedSha256 = '0000000000000000000000000000000000000000000000000000000000000000';
    writeFileSync(tempManifest, JSON.stringify(original, null, 2));

    const result = runVerifier(['--manifest', tempManifest]);
    assert.notEqual(result.status, 0, 'Verifier must exit nonzero on tampered hash');
    assert.match(result.stderr, /reviewed source drift:/);
  } finally {
    if (existsSync(tempManifest)) rmSync(tempManifest, { force: true });
  }
});

test('Negative Gate 5: Manifest entry referencing nonexistent file fails closed', () => {
  const tempManifest = join(tmpdir(), `afyx-test-missing-manifest-${Date.now()}.json`);
  try {
    const original = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'native-source-ownership.json'), 'utf8'));
    original.entries.push({
      path: 'scripts/nonexistent-ghost-file.mjs',
      classification: 'AFYX_NATIVE_IMPLEMENTATION',
      reviewedSha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      evidence: 'Synthetic nonexistent entry for fail-closed validation.',
    });
    original.totalProductionFiles = original.entries.length;
    writeFileSync(tempManifest, JSON.stringify(original, null, 2));

    const result = runVerifier(['--manifest', tempManifest]);
    assert.notEqual(result.status, 0, 'Verifier must exit nonzero on missing file');
    assert.match(result.stderr, /file missing from disk: scripts\/nonexistent-ghost-file\.mjs/);
  } finally {
    if (existsSync(tempManifest)) rmSync(tempManifest, { force: true });
  }
});

test('Negative Gate 6: Duplicate manifest entry fails closed', () => {
  const tempManifest = join(tmpdir(), `afyx-test-dup-manifest-${Date.now()}.json`);
  try {
    const original = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'native-source-ownership.json'), 'utf8'));
    // Duplicate the first entry
    original.entries.push({ ...original.entries[0] });
    original.totalProductionFiles = original.entries.length;
    writeFileSync(tempManifest, JSON.stringify(original, null, 2));

    const result = runVerifier(['--manifest', tempManifest]);
    assert.notEqual(result.status, 0, 'Verifier must exit nonzero on duplicate entry');
    assert.match(result.stderr, /duplicate entry:/);
  } finally {
    if (existsSync(tempManifest)) rmSync(tempManifest, { force: true });
  }
});

test('Negative Gate 7: Count discrepancy (totalProductionFiles !== entries.length) fails closed', () => {
  const tempManifest = join(tmpdir(), `afyx-test-count-manifest-${Date.now()}.json`);
  try {
    const original = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'native-source-ownership.json'), 'utf8'));
    original.totalProductionFiles = original.entries.length + 5; // Introduce discrepancy
    writeFileSync(tempManifest, JSON.stringify(original, null, 2));

    const result = runVerifier(['--manifest', tempManifest]);
    assert.notEqual(result.status, 0, 'Verifier must exit nonzero on count discrepancy');
    assert.match(result.stderr, /manifest count discrepancy:/);
  } finally {
    if (existsSync(tempManifest)) rmSync(tempManifest, { force: true });
  }
});
