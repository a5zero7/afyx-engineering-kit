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
import { verifyGraphArchivePaths } from './verify-graph-archive.mjs';
import { graphManifestTargets, graphArchiveName } from './afyx-graph-targets.mjs';

const CANONICAL_REPO = 'a5zero7/afyx-engineering-kit';
const GITHUB_API_BASE = `https://api.github.com/repos/${CANONICAL_REPO}`;
const GITHUB_DOWNLOAD_BASE = `https://github.com/${CANONICAL_REPO}/releases/download`;

const REQUIRED_ARTIFACTS = Object.freeze([
  'RELEASE-MANIFEST.json',
  'SHA256SUMS',
  'afyx-graph-win32-x64.zip',
  'afyx-graph-linux-x64.tar.gz',
]);

export function validateReleaseChecksums(manifest, sumsText, revision) {
  const archives = graphManifestTargets(manifest).map(graphArchiveName);
  if (manifest?.source_revision !== revision || !Array.isArray(manifest.artifacts) ||
      manifest.artifacts.length !== archives.length) throw new Error('Incomplete or stale Graph release manifest');
  const entries = new Map();
  for (const artifact of manifest.artifacts) {
    if (!archives.includes(artifact?.file) || entries.has(artifact.file) ||
        !/^[0-9a-f]{64}$/i.test(artifact.sha256 || '')) {
      throw new Error('Unsafe or duplicate Graph release manifest artifact');
    }
    entries.set(artifact.file, artifact.sha256.toLowerCase());
  }
  const sums = new Map();
  for (const line of sumsText.trim().split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/i.exec(line);
    if (!match || !archives.includes(match[2]) || sums.has(match[2])) {
      throw new Error('Unsafe, missing, or duplicate SHA256SUMS entry');
    }
    sums.set(match[2], match[1].toLowerCase());
  }
  for (const archive of archives) {
    if (!entries.has(archive) || !sums.has(archive) || entries.get(archive) !== sums.get(archive)) {
      throw new Error(`Missing or mismatched Graph checksum for ${archive}`);
    }
  }
  return sums;
}

/**
 * Downloads a URL to a buffer over HTTPS with timeout and bounded retries.
 */
async function fetchBuffer(url, { timeoutMs = 30000, maxAttempts = 2, headers = {} } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      if (attempt < maxAttempts) {
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
  const fetchArtifact = options.fetchBuffer || fetchBuffer;
  const apiBase = options.apiBase || GITHUB_API_BASE;
  const downloadBase = options.downloadBase || GITHUB_DOWNLOAD_BASE;
  const tagMatchesRevision = async (tag) => {
    const raw = await fetchArtifact(`${apiBase}/commits/${encodeURIComponent(tag)}`,
      { timeoutMs: 10000, maxAttempts: 1 });
    return JSON.parse(raw.toString('utf8'))?.sha === revision;
  };

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
        const manifestUrl = `${downloadBase}/${tag}/RELEASE-MANIFEST.json`;
        const buf = await fetchArtifact(manifestUrl, { timeoutMs: 10000, maxAttempts: 1 });
        const parsed = JSON.parse(buf.toString('utf8'));
        if (parsed?.source_revision === revision && await tagMatchesRevision(tag)) {
          resolvedTag = tag;
          manifestBuffer = buf;
          manifestObj = parsed;
          break;
        }
      } catch {
        // Continue searching other candidate tags
      }
    }

    // 2. Search release assets; target_commitish is not proof of the tag's target.
    if (!resolvedTag) {
      try {
        const releasesBuf = await fetchArtifact(`${apiBase}/releases`, { timeoutMs: 15000, maxAttempts: 1 });
        const releases = JSON.parse(releasesBuf.toString('utf8'));
        if (Array.isArray(releases)) {
          for (const rel of releases) {
            if (rel.tag_name && await tagMatchesRevision(rel.tag_name)) {
              const manifestAsset = (rel.assets || []).find((a) => a.name === 'RELEASE-MANIFEST.json');
              if (manifestAsset) {
                const buf = await fetchArtifact(manifestAsset.browser_download_url, { timeoutMs: 10000, maxAttempts: 1 });
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
    const sumsUrl = `${downloadBase}/${resolvedTag}/SHA256SUMS`;
    const sumsBuf = await fetchArtifact(sumsUrl);
    writeFileSync(join(tempStage, 'SHA256SUMS'), sumsBuf);

    const sumsContent = sumsBuf.toString('utf8').trim();
    const expectedSums = validateReleaseChecksums(manifestObj, sumsContent, revision);

    // 4. Download and verify each required archive
    const archivesToDownload = graphManifestTargets(manifestObj).map(graphArchiveName);
    for (const archiveName of archivesToDownload) {
      const archiveUrl = `${downloadBase}/${resolvedTag}/${archiveName}`;
      const archiveBuf = await fetchArtifact(archiveUrl, { timeoutMs: 60000 });
      verifyGraphArchivePaths(archiveBuf, archiveName);

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
      if (!sumEntry) {
        throw new Error(`Missing SHA256SUMS entry: ${archiveName}`);
      }
      if (computedSha !== sumEntry) {
        throw new Error(`SHA256SUMS mismatch: ${archiveName}`);
      }

      writeFileSync(join(tempStage, archiveName), archiveBuf);
    }

    // 5. Atomically stage all verified artifacts to releaseDir
    for (const file of ['RELEASE-MANIFEST.json', 'SHA256SUMS', ...graphManifestTargets(manifestObj).map(graphArchiveName)]) {
      copyFileSync(join(tempStage, file), join(releaseDir, file));
    }

    return {
      success: true,
      tag: resolvedTag,
      revision,
      artifacts: ['RELEASE-MANIFEST.json', 'SHA256SUMS', ...graphManifestTargets(manifestObj).map(graphArchiveName)],
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
