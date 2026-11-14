#!/usr/bin/env node
// Build an npm candidate from committed source without stamping the checkout.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraphReleaseArtifacts, checkGraphReleaseValid } from './prepare-g6-package.mjs';
import { GRAPH_PACKAGE_TARGETS, graphArchiveName } from './afyx-graph-targets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outputIndex = args.indexOf('--output-dir');
const outputDir = outputIndex >= 0 && args[outputIndex + 1] ? resolve(args[outputIndex + 1])
  : mkdtempSync(join(tmpdir(), 'afyx-npm-release-'));
if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output-dir requires a path');
if (args.some((arg, index) => arg !== '--dry-run' && arg !== '--output-dir' && index !== outputIndex + 1)) {
  throw new Error('Usage: node scripts/stage-npm-release.mjs [--dry-run] [--output-dir PATH]');
}
const inside = relative(root, outputDir);
if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('Release output must be outside the source checkout');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: 10 * 60 * 1000, windowsHide: true, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error?.code}): ${(result.stderr || result.error?.message || '').trim()}`);
  }
  return result.stdout;
}

function npmCommand() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
  const candidate = process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(candidate)) throw new Error('Installed npm CLI could not be located');
  return candidate;
}

const revision = run('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Invalid committed source revision');
if (run('git', ['-C', root, 'status', '--porcelain']).trim()) {
  throw new Error('Source checkout has uncommitted files; release candidate requires a clean commit');
}
if (!checkGraphReleaseValid(root, revision)) {
  if (process.env.AFYX_BUILD_FROM_SOURCE !== '1') {
    throw new Error(`Graph release artifacts do not match ${revision}; set AFYX_BUILD_FROM_SOURCE=1 for an authorized maintainer build`);
  }
  buildGraphReleaseArtifacts(root, revision);
}
if (!checkGraphReleaseValid(root, revision)) throw new Error('Graph release artifacts remain incomplete');

mkdirSync(outputDir, { recursive: true });
const stage = mkdtempSync(join(outputDir, 'source-'));
const archive = join(stage, 'committed-source.tar');
run('git', ['-C', root, 'archive', '--format=tar', `--output=${archive}`, revision]);
run('tar', ['-xf', archive, '-C', stage]);
writeFileSync(join(stage, '.afyx-source-revision'), `${revision}\n`, 'utf8');
const release = join('afyx-graph', 'engine', 'release');
mkdirSync(join(stage, release), { recursive: true });
for (const name of [...GRAPH_PACKAGE_TARGETS.map(graphArchiveName), 'SHA256SUMS', 'RELEASE-MANIFEST.json']) {
  const source = join(root, release, name);
  if (!statSync(source).isFile()) throw new Error(`Missing regular Graph artifact: ${name}`);
  copyFileSync(source, join(stage, release, name));
}

const npmArgs = [npmCommand(), 'pack', '--json', '--pack-destination', outputDir];
if (dryRun) npmArgs.push('--dry-run');
const result = JSON.parse(run(process.execPath, npmArgs, { cwd: stage }));
const pkg = result[0];
if (!pkg?.filename || !Array.isArray(pkg.files)) throw new Error('npm pack did not return a valid inventory');
const fileNames = new Set(pkg.files.map((file) => file.path));
for (const required of ['.afyx-source-revision', 'bin/afyx-engineering-kit.mjs',
  `${release.replaceAll('\\', '/')}/RELEASE-MANIFEST.json`,
  `${release.replaceAll('\\', '/')}/afyx-graph-win32-x64.zip`,
  ...GRAPH_PACKAGE_TARGETS.filter((target) => target.startsWith('darwin')).map((target) => `${release.replaceAll('\\', '/')}/${graphArchiveName(target)}`),
  `${release.replaceAll('\\', '/')}/afyx-graph-linux-x64.tar.gz`]) {
  if (!fileNames.has(required)) throw new Error(`Incomplete npm package: ${required}`);
}
const candidate = join(outputDir, pkg.filename);
if (!dryRun) {
  if (!statSync(candidate).isFile()) throw new Error('npm tarball was not produced');
  const marker = run('tar', ['-xOzf', candidate, 'package/.afyx-source-revision']).trim();
  const manifest = JSON.parse(run('tar', ['-xOzf', candidate,
    'package/afyx-graph/engine/release/RELEASE-MANIFEST.json']));
  if (marker !== revision || manifest.source_revision !== revision) {
    throw new Error('Packed source marker or Graph manifest does not match committed source');
  }
}
if (run('git', ['-C', root, 'status', '--porcelain']).trim()) throw new Error('Packaging mutated the source checkout');
const digest = dryRun ? null : createHash('sha256').update(readFileSync(candidate)).digest('hex');
process.stdout.write(JSON.stringify({ revision, version: pkg.version, dryRun, candidate: dryRun ? null : candidate,
  sha256: digest, fileCount: pkg.files.length, stage }) + '\n');
