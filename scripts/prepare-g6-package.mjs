#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expected = new Map([
  ['afyx-graph-win32-x64.zip', 'win32-x64'],
  ['afyx-graph-linux-x64.tar.gz', 'linux-x64'],
]);

export function prepareG6Package(root, revision) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Git HEAD must be an exact commit SHA');
  const release = join(root, 'afyx-graph', 'engine', 'release');
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
    if (!lstatSync(marker).isFile() || readFileSync(marker, 'utf8').trim() !== revision) {
      throw new Error('Existing source revision marker conflicts with Git HEAD');
    }
  } else {
    writeFileSync(marker, `${revision}\n`, { flag: 'wx' });
  }
  return revision;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let revision = '';
  const marker = join(root, '.afyx-source-revision');
  if (existsSync(marker)) {
    const raw = readFileSync(marker, 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(raw)) revision = raw;
  }
  if (!revision) {
    try {
      revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      // In WSL2 mounting a Windows git worktree, .git file contains Windows D:/ path which Linux git cannot resolve directly
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
  }
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('Exact Git source revision is required to prepare G6 package.');
  }
  console.error(`[G6 package] verified Graph archives and source revision ${prepareG6Package(root, revision)}`);
}
