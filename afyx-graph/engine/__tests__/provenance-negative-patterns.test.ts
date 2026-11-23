/**
 * Native Provenance Negative Gate Tests
 *
 * Verifies that the native source ownership verifier and pre-push gates
 * fail closed when known historical substantive patterns, unapproved manifests,
 * or fraudulent self-declared classifications are injected.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const VERIFIER_SCRIPT = join(REPO_ROOT, 'scripts', 'verify-native-source-ownership.mjs');
const MANIFEST_PATH = join(REPO_ROOT, 'scripts', 'native-source-ownership.json');

function copyProvenanceFixture(tempDir: string) {
  // The verifier reads source bytes, not tests, build payloads or other tooling.
  // Keep the full reviewed manifest and every source it owns, including Context/Forge.
  const manifest = JSON.parse(readFileSyncSafe(MANIFEST_PATH));
  const files = new Set<string>([
    'scripts/verify-native-source-ownership.mjs',
    'scripts/native-source-ownership.json',
    ...manifest.entries.map((entry: { path: string }) => entry.path),
  ]);
  for (const file of files) {
    const destination = join(tempDir, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(REPO_ROOT, file), destination);
  }
}

describe('Native Provenance Negative Gate Enforcement', () => {
  it('passes on the complete source-only fixture before any mutation', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'afyx-prov-clean-'));
    try {
      copyProvenanceFixture(tempDir);
      const result = execFileSync(process.execPath, [
        join(tempDir, 'scripts', 'verify-native-source-ownership.mjs'), '--root', tempDir,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(result).toMatch(/PASS: \d+ production files match/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('still rejects unclassified production source added to the source-only fixture', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'afyx-prov-extra-'));
    try {
      copyProvenanceFixture(tempDir);
      writeFileSync(join(tempDir, 'afyx-graph', 'engine', 'src', 'unclassified.ts'), 'export const extra = true;');
      let diagnostic = '';
      try {
        execFileSync(process.execPath, [
          join(tempDir, 'scripts', 'verify-native-source-ownership.mjs'), '--root', tempDir,
        ], { stdio: 'pipe' });
      } catch (error: unknown) {
        diagnostic = String((error as { stderr?: Buffer }).stderr ?? '');
      }
      expect(diagnostic).toContain('FAIL: unclassified production source file detected: afyx-graph/engine/src/unclassified.ts');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes on the clean authoritative repository baseline', () => {
    const result = execFileSync(process.execPath, [VERIFIER_SCRIPT, '--root', REPO_ROOT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result).toMatch(/PASS: \d+ production files match/);
  });

  it('fails closed when a historical inherited pattern is injected, even with a matched hash', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'afyx-prov-neg-'));
    try {
      // Create minimal sandbox mirror
      copyProvenanceFixture(tempDir);

      const targetFile = join(tempDir, 'afyx-graph', 'engine', 'src', 'ui-server', 'api', 'effects.ts');
      // Inject prohibited historical pattern
      const injected = `// Injected test\nconst ORM_COMMON_OPS = '(?:find|findOne|findAll';\n` +
        readFileSyncSafe(targetFile);
      writeFileSync(targetFile, injected, 'utf8');

      // Update manifest hash to simulate attempted self-declaration bypass
      const hash = require('node:crypto').createHash('sha256').update(injected).digest('hex');
      const manifest = JSON.parse(readFileSyncSafe(join(tempDir, 'scripts', 'native-source-ownership.json')));
      for (const entry of manifest.entries) {
        if (entry.path.includes('effects.ts')) {
          entry.reviewedSha256 = hash;
        }
      }
      writeFileSync(join(tempDir, 'scripts', 'native-source-ownership.json'), JSON.stringify(manifest, null, 2), 'utf8');

      let failed = false;
      try {
        execFileSync(process.execPath, [
          join(tempDir, 'scripts', 'verify-native-source-ownership.mjs'),
          '--root', tempDir,
          '--manifest', join(tempDir, 'scripts', 'native-source-ownership.json'),
        ], { stdio: 'pipe' });
      } catch (err: unknown) {
        failed = true;
        const out = String((err as { stderr?: Buffer }).stderr ?? '');
        expect(out).toContain('FAIL: prohibited substantive inherited pattern detected');
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects a regex-encoded inherited domain rule even when its hash is self-declared', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'afyx-prov-regex-'));
    try {
      copyProvenanceFixture(tempDir);

      const targetFile = join(tempDir, 'afyx-graph', 'engine', 'src', 'ui-server', 'api', 'effects.ts');
      const inheritedRule =
        "/^(?:Repository|Repo|Dao|DAO|Mapper|EntityManager|DataSource|DbContext|DbSet|SessionFactory|JdbcTemplate|MongoTemplate|DatabaseClient|PrismaClient|Knex|Kysely|Drizzle|Sequelize)$/";
      const injected = `${readFileSyncSafe(targetFile)}\nconst inheritedDomainRule = ${inheritedRule};\n`;
      writeFileSync(targetFile, injected, 'utf8');

      const manifestPath = join(tempDir, 'scripts', 'native-source-ownership.json');
      const manifest = JSON.parse(readFileSyncSafe(manifestPath));
      const hash = require('node:crypto').createHash('sha256').update(injected).digest('hex');
      manifest.entries.find((entry: { path: string }) => entry.path.endsWith('effects.ts')).reviewedSha256 = hash;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      let failed = false;
      try {
        execFileSync(process.execPath, [
          join(tempDir, 'scripts', 'verify-native-source-ownership.mjs'),
          '--root', tempDir,
          '--manifest', manifestPath,
        ], { stdio: 'pipe' });
      } catch (err: unknown) {
        failed = true;
        const out = String((err as { stderr?: Buffer }).stderr ?? '');
        expect(out).toContain('effect classifier contains');
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when a file reverts to the unreviewed baseline hash', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'afyx-prov-base-'));
    try {
      copyProvenanceFixture(tempDir);

      const manifestPath = join(tempDir, 'scripts', 'native-source-ownership.json');
      const manifest = JSON.parse(readFileSyncSafe(manifestPath));
      const entry = manifest.entries[0];
      // Force baseline hash
      entry.reviewedSha256 = entry.baselineSha256;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      const targetFile = join(tempDir, ...entry.path.split('/'));
      writeFileSync(targetFile, 'baseline reversion simulation', 'utf8');
      // Set file hash to baselineSha256 simulation
      entry.reviewedSha256 = require('node:crypto').createHash('sha256').update('baseline reversion simulation').digest('hex');
      entry.baselineSha256 = entry.reviewedSha256;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      let failed = false;
      try {
        execFileSync(process.execPath, [
          join(tempDir, 'scripts', 'verify-native-source-ownership.mjs'),
          '--root', tempDir,
          '--manifest', manifestPath,
        ], { stdio: 'pipe' });
      } catch (err: unknown) {
        failed = true;
        const out = String((err as { stderr?: Buffer }).stderr ?? '');
        expect(out).toContain('reverted to the pre-remediation baseline');
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when an entry has PROVENANCE_REVIEW_REQUIRED classification', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'afyx-prov-unres-'));
    try {
      copyProvenanceFixture(tempDir);

      const manifestPath = join(tempDir, 'scripts', 'native-source-ownership.json');
      const manifest = JSON.parse(readFileSyncSafe(manifestPath));
      manifest.entries[0].classification = 'PROVENANCE_REVIEW_REQUIRED';
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      let failed = false;
      try {
        execFileSync(process.execPath, [
          join(tempDir, 'scripts', 'verify-native-source-ownership.mjs'),
          '--root', tempDir,
          '--manifest', manifestPath,
        ], { stdio: 'pipe' });
      } catch (err: unknown) {
        failed = true;
        const out = String((err as { stderr?: Buffer }).stderr ?? '');
        expect(out).toContain('unresolved substantive provenance review');
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function readFileSyncSafe(file: string): string {
  return require('node:fs').readFileSync(file, 'utf8');
}

