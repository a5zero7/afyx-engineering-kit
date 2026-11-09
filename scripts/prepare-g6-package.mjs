#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  artifactPlan,
  DISTRIBUTION_PRODUCT,
  verifyBundle,
} from '../afyx-graph/engine/scripts/distribution-contract.mjs';
import { verifyReleaseReady } from '../afyx-graph/engine/scripts/release-readiness.mjs';
import { createDeterministicArchive } from '../afyx-graph/engine/scripts/deterministic-archive.mjs';
import { stampArtifact } from './afyx-graph-artifact.mjs';

const expected = new Map([
  ['afyx-graph-win32-x64.zip', 'win32-x64'],
  ['afyx-graph-linux-x64.tar.gz', 'linux-x64'],
]);

export function buildGraphBundle({ root, target, revision, outputDir }) {
  const engineRoot = join(root, 'afyx-graph', 'engine');
  const plan = artifactPlan(target);
  const bundleName = plan.bundleName;

  try {
    verifyReleaseReady(engineRoot);
  } catch {
    execFileSync(process.execPath, [join(engineRoot, 'scripts', 'build-release.mjs')], {
      cwd: engineRoot,
      stdio: 'inherit',
    });
    verifyReleaseReady(engineRoot);
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'afyx-graph-bundle-'));
  const stage = join(tmpRoot, bundleName);

  try {
    mkdirSync(join(stage, 'lib'), { recursive: true });
    mkdirSync(join(stage, 'bin'), { recursive: true });

    // 1. Copy dist
    cpSync(join(engineRoot, 'dist'), join(stage, 'lib', 'dist'), { recursive: true });

    // 2. Copy package.json
    copyFileSync(join(engineRoot, 'package.json'), join(stage, 'lib', 'package.json'));

    // 3. Stage & stamp metadata.json
    const metadataRaw = JSON.parse(readFileSync(join(root, 'afyx-graph', 'afyx-graph.json'), 'utf8'));
    metadataRaw.release_channel = DISTRIBUTION_PRODUCT.releaseChannel;

    let extractionVersion = 29;
    const extractionVersionTs = join(engineRoot, 'src', 'extraction', 'extraction-version.ts');
    if (existsSync(extractionVersionTs)) {
      const match = readFileSync(extractionVersionTs, 'utf8').match(/EXTRACTION_VERSION\s*=\s*(\d+)/);
      if (match) extractionVersion = parseInt(match[1], 10);
    }

    const stampedMetadata = stampArtifact(metadataRaw, {
      target,
      revision,
      extractionVersion,
    });
    writeFileSync(join(stage, 'metadata.json'), `${JSON.stringify(stampedMetadata, null, 2)}\n`, 'utf8');

    // 4. Legal files
    for (const legal of plan.legalFiles) {
      const destPath = join(stage, ...legal.bundlePath.split('/'));
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(join(engineRoot, ...legal.source.split('/')), destPath);
    }

    // 5. Launcher
    if (plan.family === 'win32') {
      const launcherContent = [
        '@echo off\r\n',
        'where node >nul 2>&1\r\n',
        'if errorlevel 1 (\r\n',
        '  echo [Afyx Graph] Node.js was not found on PATH. Install Node.js 22.5.0 or newer: https://nodejs.org/ 1>&2\r\n',
        '  exit /b 1\r\n',
        ')\r\n',
        'node --disable-warning=ExperimentalWarning "%~dp0..\\lib\\dist\\bin\\afyx-graph.js" %*\r\n',
        'exit /b %ERRORLEVEL%\r\n',
      ].join('');
      writeFileSync(join(stage, 'bin', 'afyx-graph.cmd'), launcherContent, 'utf8');
    } else {
      const launcherContent = [
        '#!/bin/sh\n',
        'if ! command -v node >/dev/null 2>&1; then\n',
        '  printf \'%s\\n\' \'[Afyx Graph] Node.js was not found on PATH. Install Node.js 22.5.0 or newer: https://nodejs.org/\' >&2\n',
        '  exit 1\n',
        'fi\n',
        'SELF="$0"\n',
        'while [ -L "$SELF" ]; do\n',
        '  link="$(readlink "$SELF")"\n',
        '  case "$link" in /*) SELF="$link" ;; *) SELF="$(dirname "$SELF")/$link" ;; esac\n',
        'done\n',
        'BUNDLE_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"\n',
        'AFYX_GRAPH_HOST_PPID="${AFYX_GRAPH_HOST_PPID:-$PPID}"\n',
        'export AFYX_GRAPH_HOST_PPID\n',
        'exec node --disable-warning=ExperimentalWarning "$BUNDLE_DIR/lib/dist/bin/afyx-graph.js" "$@"\n',
      ].join('');
      writeFileSync(join(stage, 'bin', 'afyx-graph'), launcherContent, { encoding: 'utf8', mode: 0o755 });
    }

    // 6. Verify bundle
    verifyBundle(stage, target);

    // 7. Deterministic archive
    const archiveName = plan.family === 'win32' ? `${bundleName}.zip` : `${bundleName}.tar.gz`;
    const archivePath = join(outputDir, archiveName);
    mkdirSync(outputDir, { recursive: true });

    createDeterministicArchive({
      source: stage,
      target,
      output: archivePath,
    });

    return archivePath;
  } finally {
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

export function buildGraphReleaseArtifacts(root, revision) {
  const releaseDir = join(root, 'afyx-graph', 'engine', 'release');
  mkdirSync(releaseDir, { recursive: true });

  const winZip = buildGraphBundle({ root, target: 'win32-x64', revision, outputDir: releaseDir });
  const linuxTar = buildGraphBundle({ root, target: 'linux-x64', revision, outputDir: releaseDir });

  const winSum = createHash('sha256').update(readFileSync(winZip)).digest('hex');
  const linuxSum = createHash('sha256').update(readFileSync(linuxTar)).digest('hex');

  const sumsContent = `${linuxSum}  afyx-graph-linux-x64.tar.gz\n${winSum}  afyx-graph-win32-x64.zip\n`;
  writeFileSync(join(releaseDir, 'SHA256SUMS'), sumsContent, 'utf8');

  const graphVersion = JSON.parse(readFileSync(join(root, 'afyx-graph', 'engine', 'package.json'), 'utf8')).version;
  const manifest = {
    schema: 1,
    product: 'Afyx Graph',
    product_version: graphVersion,
    release_tag: `afyx-graph-v${graphVersion}`,
    source_revision: revision,
    integrity_claim: 'sha256',
    publisher_authenticity: 'requires-independent-attestation',
    artifacts: [
      {
        file: 'afyx-graph-linux-x64.tar.gz',
        target: 'linux-x64',
        sha256: linuxSum,
      },
      {
        file: 'afyx-graph-win32-x64.zip',
        target: 'win32-x64',
        sha256: winSum,
      },
    ],
  };
  writeFileSync(join(releaseDir, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function checkGraphReleaseValid(root, revision) {
  const release = join(root, 'afyx-graph', 'engine', 'release');
  const manifestPath = join(release, 'RELEASE-MANIFEST.json');
  const sumsPath = join(release, 'SHA256SUMS');
  const winZip = join(release, 'afyx-graph-win32-x64.zip');
  const linuxTar = join(release, 'afyx-graph-linux-x64.tar.gz');

  if (!existsSync(manifestPath) || !existsSync(sumsPath) || !existsSync(winZip) || !existsSync(linuxTar)) {
    return false;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.source_revision !== revision) return false;
    const graphVersion = JSON.parse(readFileSync(join(root, 'afyx-graph', 'engine', 'package.json'), 'utf8')).version;
    if (manifest.product_version !== graphVersion) return false;
    for (const artifact of manifest.artifacts) {
      const filePath = join(release, artifact.file);
      if (!existsSync(filePath)) return false;
      const digest = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      if (digest !== artifact.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function prepareG6Package(root, revision, { autoBuild = false } = {}) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Git HEAD must be an exact commit SHA');
  const release = join(root, 'afyx-graph', 'engine', 'release');

  if (autoBuild && !checkGraphReleaseValid(root, revision)) {
    buildGraphReleaseArtifacts(root, revision);
  }

  const manifest = JSON.parse(readFileSync(join(release, 'RELEASE-MANIFEST.json'), 'utf8'));
  const graphVersion = JSON.parse(readFileSync(join(root, 'afyx-graph', 'engine', 'package.json'), 'utf8')).version;
  if (manifest.schema !== 1 || manifest.product !== 'Afyx Graph' ||
      manifest.source_revision !== revision || manifest.product_version !== graphVersion ||
      !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== expected.size) {
    throw new Error('Graph release manifest does not match this source revision and product');
  }
  const sumLines = readFileSync(join(release, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
  const sums = new Map(sumLines.map((line) => {
    const match = /^([0-9a-f]{64})  (afyx-graph-(?:win32|linux)-x64\.(?:zip|tar\.gz))$/.exec(line);
    if (!match) throw new Error('Malformed Graph SHA256SUMS');
    return [match[2], match[1]];
  }));
  if (sumLines.length !== expected.size || sums.size !== expected.size) {
    throw new Error('Graph SHA256SUMS has missing or duplicate targets');
  }
  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    if (expected.get(artifact.file) !== artifact.target || seen.has(artifact.file)) {
      throw new Error('Unexpected or duplicate Graph archive target');
    }
    seen.add(artifact.file);
    const digest = createHash('sha256').update(readFileSync(join(release, artifact.file))).digest('hex');
    if (digest !== artifact.sha256 || digest !== sums.get(artifact.file)) {
      throw new Error(`Graph archive checksum mismatch: ${artifact.file}`);
    }
  }
  const marker = join(root, '.afyx-source-revision');
  if (existsSync(marker)) {
    if (!lstatSync(marker).isFile()) {
      throw new Error('Existing source revision marker is not a regular file');
    }
    if (readFileSync(marker, 'utf8').trim() !== revision) {
      writeFileSync(marker, `${revision}\n`, 'utf8');
    }
  } else {
    writeFileSync(marker, `${revision}\n`, { flag: 'wx' });
  }
  return revision;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let revision = '';

  // 1. In a Git repository, resolve Git HEAD first
  try {
    revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // In WSL2 mounting a Windows git worktree, .git file contains Windows D:/ path
    if (existsSync(join(root, '.git'))) {
      try {
        const gitContent = readFileSync(join(root, '.git'), 'utf8');
        const gitDirMatch = gitContent.match(/gitdir:\s*([^\r\n]+)/);
        if (gitDirMatch) {
          let gitDir = gitDirMatch[1].trim();
          if (process.platform === 'linux' && /^[a-zA-Z]:[\\/]/.test(gitDir)) {
            const drive = gitDir[0].toLowerCase();
            const rest = gitDir.slice(2).replace(/\\/g, '/');
            gitDir = `/mnt/${drive}${rest}`;
          }
          revision = execFileSync('git', ['--git-dir', gitDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        }
      } catch {
        // ignore
      }
    }
  }

  // 2. In an unpacked tarball without Git, fall back to .afyx-source-revision
  if (!revision) {
    const marker = join(root, '.afyx-source-revision');
    if (existsSync(marker)) {
      const raw = readFileSync(marker, 'utf8').trim();
      if (/^[0-9a-f]{40}$/.test(raw)) revision = raw;
    }
  }

  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('Exact Git source revision is required to prepare G6 package.');
  }

  // 3. Ensure Graph release artifacts exist and match current revision
  if (!checkGraphReleaseValid(root, revision)) {
    console.error(`[G6 package] building Graph release artifacts for revision ${revision}...`);
    buildGraphReleaseArtifacts(root, revision);
  }

  console.error(`[G6 package] verified Graph archives and source revision ${prepareG6Package(root, revision)}`);
}
