#!/usr/bin/env node
/**
 * AFYX Revision-Matched Binary Artifact Resolver
 *
 * Resolves precompiled Graph release archives matching the exact Git source revision
 * from official GitHub releases/snapshots. Ensures consumer Git-based installations
 * (e.g. npx github:a5zero7/afyx-engineering-kit#dev) obtain verified binaries without
 * compiling Graph from TypeScript source on the consumer's machine.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const CANONICAL_REPO = 'a5zero7/afyx-engineering-kit';
const GITHUB_API_BASE = `https://api.github.com/repos/${CANONICAL_REPO}`;
const GITHUB_DOWNLOAD_BASE = `https://github.com/${CANONICAL_REPO}/releases/download`;

const REQUIRED_ARTIFACTS = Object.freeze([
  'RELEASE-MANIFEST.json',
  'SHA256SUMS',
  'afyx-graph-win32-x64.zip',
  'afyx-graph-linux-x64.tar.gz',
]);

/**
 * Downloads a URL to a buffer over HTTPS with timeout and bounded retries.
 */
async function fetchBuffer(url, { timeoutMs = 30000, maxRetries = 2, headers = {} } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'afyx-artifact-resolver/1.0',
          ...headers,
        },
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Resolves exact Git checkout revision SHA.
 */
export function resolveGitRevision(root) {
  // 1. Try git rev-parse HEAD directly
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{40}$/.test(out)) return out;
  } catch {
    // In WSL2 mounting Windows paths, check .git pointer
    const gitPath = join(root, '.git');
    if (existsSync(gitPath)) {
      try {
        const gitContent = readFileSync(gitPath, 'utf8');
        const match = gitContent.match(/gitdir:\s*([^\r\n]+)/);
        if (match) {
          let gitDir = match[1].trim();
          if (process.platform === 'linux' && /^[a-zA-Z]:[\\/]/.test(gitDir)) {
            const drive = gitDir[0].toLowerCase();
            const rest = gitDir.slice(2).replace(/\\/g, '/');
            gitDir = `/mnt/${drive}${rest}`;
          }
          const out = execFileSync('git', ['--git-dir', gitDir, 'rev-parse', 'HEAD'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
          if (/^[0-9a-f]{40}$/.test(out)) return out;
        }
      } catch {
        // ignore
      }
    }
  }

  // 2. Fall back to stamped .afyx-source-revision
  const marker = join(root, '.afyx-source-revision');
  if (existsSync(marker)) {
    const raw = readFileSync(marker, 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(raw)) return raw;
  }

  // 3. Fall back to npm lifecycle environment variable or explicit env
  if (process.env.npm_package_gitHead && /^[0-9a-f]{40}$/.test(process.env.npm_package_gitHead)) {
    return process.env.npm_package_gitHead;
  }
  if (process.env.AFYX_SOURCE_REVISION && /^[0-9a-f]{40}$/.test(process.env.AFYX_SOURCE_REVISION)) {
    return process.env.AFYX_SOURCE_REVISION;
  }

  return null;
}

/**
 * Resolves candidates tags for GitHub releases associated with a given commit SHA.
 */
export function getCandidateTagsForRevision(revision) {
  const shortSha = revision.slice(0, 12);
  return [
    `afyx-dev-${revision}`,
    `dev-${revision}`,
    `afyx-dev-${shortSha}`,
    `dev-${shortSha}`,
    `afyx-dev-snapshot`,
  ];
}

/**
 * Downloads and verifies revision-matched release artifacts into afyx-graph/engine/release/.
 */
export async function resolveAndStageGitReleaseArtifacts(root, revision, options = {}) {
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`Valid 40-character Git commit SHA is required (got: "${revision}")`);
  }

  const releaseDir = join(root, 'afyx-graph', 'engine', 'release');
  mkdirSync(releaseDir, { recursive: true });

  const tempStage = mkdtempSync(join(tmpdir(), 'afyx-download-artifacts-'));

  try {
    let resolvedTag = null;
    let manifestBuffer = null;
    let manifestObj = null;

    // 1. Try candidate release tags directly
    const candidateTags = getCandidateTagsForRevision(revision);

    for (const tag of candidateTags) {
      try {
        const manifestUrl = `${GITHUB_DOWNLOAD_BASE}/${tag}/RELEASE-MANIFEST.json`;
        const buf = await fetchBuffer(manifestUrl, { timeoutMs: 10000, maxRetries: 1 });
        const parsed = JSON.parse(buf.toString('utf8'));
        if (parsed?.source_revision === revision) {
          resolvedTag = tag;
          manifestBuffer = buf;
          manifestObj = parsed;
          break;
        }
      } catch {
        // Continue searching other candidate tags
      }
    }

    // 2. If candidate tags didn't match, query GitHub releases list API to find matching target_commitish
    if (!resolvedTag) {
      try {
        const releasesBuf = await fetchBuffer(`${GITHUB_API_BASE}/releases`, { timeoutMs: 15000, maxRetries: 1 });
        const releases = JSON.parse(releasesBuf.toString('utf8'));
        if (Array.isArray(releases)) {
          for (const rel of releases) {
            if (rel.target_commitish === revision) {
              const manifestAsset = (rel.assets || []).find((a) => a.name === 'RELEASE-MANIFEST.json');
              if (manifestAsset) {
                const buf = await fetchBuffer(manifestAsset.browser_download_url, { timeoutMs: 10000, maxRetries: 1 });
                const parsed = JSON.parse(buf.toString('utf8'));
                if (parsed?.source_revision === revision) {
                  resolvedTag = rel.tag_name;
                  manifestBuffer = buf;
                  manifestObj = parsed;
                  break;
                }
              }
            }
          }
        }
      } catch {
        // Releases API query failed or rate-limited
      }
    }

    if (!resolvedTag || !manifestObj) {
      throw new Error(
        `No official precompiled Graph release artifacts found for Git revision ${revision}.\n` +
        `Consumer installations require prebuilt binaries to prevent source compilation.\n` +
        `To build artifacts locally as a maintainer, run with AFYX_BUILD_FROM_SOURCE=1.`
      );
    }

    writeFileSync(join(tempStage, 'RELEASE-MANIFEST.json'), manifestBuffer);

    // 3. Download SHA256SUMS
    const sumsUrl = `${GITHUB_DOWNLOAD_BASE}/${resolvedTag}/SHA256SUMS`;
    const sumsBuf = await fetchBuffer(sumsUrl);
    writeFileSync(join(tempStage, 'SHA256SUMS'), sumsBuf);

    const sumsContent = sumsBuf.toString('utf8').trim();
    const expectedSums = new Map();
    for (const line of sumsContent.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        expectedSums.set(parts[1], parts[0].toLowerCase());
      }
    }

    // 4. Download and verify each required archive
    const archivesToDownload = ['afyx-graph-win32-x64.zip', 'afyx-graph-linux-x64.tar.gz'];
    for (const archiveName of archivesToDownload) {
      const archiveUrl = `${GITHUB_DOWNLOAD_BASE}/${resolvedTag}/${archiveName}`;
      const archiveBuf = await fetchBuffer(archiveUrl, { timeoutMs: 60000 });

      // Verify SHA256 against SHA256SUMS and manifest
      const computedSha = createHash('sha256').update(archiveBuf).digest('hex').toLowerCase();
      const manifestEntry = (manifestObj.artifacts || []).find((a) => a.file === archiveName);
      if (!manifestEntry) {
        throw new Error(`Manifest missing artifact entry for ${archiveName}`);
      }
      if (computedSha !== manifestEntry.sha256.toLowerCase()) {
        throw new Error(
          `Checksum mismatch for ${archiveName} against manifest: expected ${manifestEntry.sha256}, got ${computedSha}`
        );
      }
      const sumEntry = expectedSums.get(archiveName);
      if (sumEntry && computedSha !== sumEntry) {
        throw new Error(
          `Checksum mismatch for ${archiveName} against SHA256SUMS: expected ${sumEntry}, got ${computedSha}`
        );
      }

      writeFileSync(join(tempStage, archiveName), archiveBuf);
    }

    // 5. Atomically stage all verified artifacts to releaseDir
    for (const file of REQUIRED_ARTIFACTS) {
      copyFileSync(join(tempStage, file), join(releaseDir, file));
    }

    return {
      success: true,
      tag: resolvedTag,
      revision,
      artifacts: REQUIRED_ARTIFACTS,
    };
  } finally {
    if (existsSync(tempStage)) {
      rmSync(tempStage, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const revision = resolveGitRevision(root);
  if (!revision) {
    console.error('[artifact-resolver] ERROR: Could not determine Git revision.');
    process.exit(1);
  }
  console.log(`[artifact-resolver] Resolving precompiled artifacts for revision ${revision}...`);
  resolveAndStageGitReleaseArtifacts(root, revision)
    .then((result) => {
      console.log(`[artifact-resolver] Successfully staged artifacts from release tag ${result.tag}`);
    })
    .catch((err) => {
      console.error(`[artifact-resolver] FAILED: ${err.message}`);
      process.exit(1);
    });
}
