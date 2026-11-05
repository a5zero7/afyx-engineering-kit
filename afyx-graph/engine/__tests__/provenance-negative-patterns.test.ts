/**
 * Native Provenance Negative Gate Tests
 *
 * Verifies that the native source ownership verifier and pre-push gates
 * fail closed when known historical substantive patterns, unapproved manifests,
 * or fraudulent self-declared classifications are injected.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const VERIFIER_SCRIPT = join(REPO_ROOT, 'scripts', 'verify-native-source-ownership.mjs');
const MANIFEST_PATH = join(REPO_ROOT, 'scripts', 'native-source-ownership.json');

describe('Native Provenance Negative Gate Enforcement', () => {
  it('passes on the clean authoritative repository baseline', () => {
    const result = execFileSync(process.execPath, [VERIFIER_SCRIPT, '--root', REPO_ROOT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result).toContain('PASS: 8 high-similarity files match');
  });

  it('fails closed when a historical inherited pattern is injected, even with a matched hash', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'afyx-prov-neg-'));
    try {
      // Create minimal sandbox mirror
      cpSync(join(REPO_ROOT, 'scripts'), join(tempDir, 'scripts'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });
      cpSync(join(REPO_ROOT, 'afyx-graph'), join(tempDir, 'afyx-graph'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });

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
      cpSync(join(REPO_ROOT, 'scripts'), join(tempDir, 'scripts'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });
      cpSync(join(REPO_ROOT, 'afyx-graph'), join(tempDir, 'afyx-graph'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });

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
      cpSync(join(REPO_ROOT, 'scripts'), join(tempDir, 'scripts'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });
      cpSync(join(REPO_ROOT, 'afyx-graph'), join(tempDir, 'afyx-graph'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });

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
      cpSync(join(REPO_ROOT, 'scripts'), join(tempDir, 'scripts'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });
      cpSync(join(REPO_ROOT, 'afyx-graph'), join(tempDir, 'afyx-graph'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.afyx-build') && !src.includes('dist'),
      });

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

