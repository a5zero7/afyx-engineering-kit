#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildGraphReleaseArtifacts } from './prepare-g6-package.mjs';
import { verifyGraphArchivePaths } from './verify-graph-archive.mjs';

const [mode, ...args] = process.argv.slice(2);
function arg(name) { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1]; }
const root = resolve(arg('--root') || '.');
const revision = arg('--revision');
if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Exact source commit SHA required');
if (mode === 'build') {
  buildGraphReleaseArtifacts(root, revision);
  process.stdout.write('Graph artifacts built from selected commit\n');
} else if (mode === 'verify') {
  const release = resolve(arg('--release'));
  const archiveName = 'afyx-graph-win32-x64.zip';
  const archive = join(release, archiveName);
  const manifest = JSON.parse(readFileSync(join(release, 'RELEASE-MANIFEST.json'), 'utf8'));
  const graphVersion = JSON.parse(readFileSync(join(root, 'afyx-graph', 'engine', 'package.json'), 'utf8')).version;
  if (manifest.schema !== 1 || manifest.product !== 'Afyx Graph' ||
      manifest.source_revision !== revision || manifest.product_version !== graphVersion ||
      !Array.isArray(manifest.artifacts)) throw new Error('Graph manifest source/product mismatch');
  const matches = manifest.artifacts.filter((item) => item.file === archiveName);
  if (matches.length !== 1 || matches[0].target !== 'win32-x64' || !/^[0-9a-f]{64}$/.test(matches[0].sha256)) {
    throw new Error('Missing or invalid Windows x64 Graph manifest entry');
  }
  const lines = readFileSync(join(release, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
  const sums = lines.map((line) => /^([0-9a-f]{64})  (afyx-graph-(?:win32|linux)-x64\.(?:zip|tar\.gz))$/.exec(line));
  if (sums.some((match) => !match) || sums.filter((match) => match[2] === archiveName).length !== 1) {
    throw new Error('Missing, duplicate, or malformed Windows Graph SHA256SUMS entry');
  }
  const bytes = readFileSync(archive);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== matches[0].sha256 || digest !== sums.find((match) => match[2] === archiveName)[1]) {
    throw new Error('Graph archive checksum mismatch');
  }
  verifyGraphArchivePaths(bytes, archiveName);
  const names = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const prefix = basename(archive, '.zip');
  for (const required of [`${prefix}/metadata.json`, `${prefix}/bin/afyx-graph.cmd`,
    `${prefix}/lib/dist/bin/afyx-graph.js`, `${prefix}/lib/dist/viewer/index.html`]) {
    if (!names.includes(required)) throw new Error(`Incomplete Graph archive: ${required}`);
  }
  const metadata = JSON.parse(execFileSync('tar', ['-xOf', archive, `${prefix}/metadata.json`], { encoding: 'utf8' }));
  if (metadata.artifact_target !== 'win32-x64' || metadata.source_revision !== revision ||
      metadata.build_identity !== `git:${revision}` || metadata.product_version !== graphVersion) {
    throw new Error('Embedded Graph metadata source/target mismatch');
  }
  process.stdout.write(JSON.stringify({ revision, digest, target: metadata.artifact_target, entries: names.length }) + '\n');
} else {
  throw new Error('Usage: validate-release-zip-graph.mjs build|verify --root PATH --revision SHA [--release PATH]');
}
