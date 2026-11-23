#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { verifyEngineDistribution } from './distribution-contract.mjs';

export const RELEASE_STAMP = '.afyx-release-ready.json';

const SOURCE_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'src',
  'ui/index.html',
  'ui/package.json',
  'ui/src',
  'ui/tsconfig.json',
  'ui/vite.config.ts',
]);

function collect(root, input, files) {
  const absolute = join(root, ...input.split('/'));
  if (!existsSync(absolute)) throw new Error(`release input is missing: ${input}`);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`release input must not be a symlink: ${input}`);
  if (stat.isFile()) {
    files.push(absolute);
    return;
  }
  if (!stat.isDirectory()) throw new Error(`unsupported release input: ${input}`);
  for (const entry of readdirSync(absolute).sort()) {
    collect(root, `${input}/${entry}`, files);
  }
}

export function sourceDigest(root) {
  const base = resolve(root);
  const files = [];
  for (const input of SOURCE_INPUTS) collect(base, input, files);
  files.sort((left, right) => left.localeCompare(right));
  const digest = createHash('sha256');
  for (const file of files) {
    const name = relative(base, file).split(sep).join('/');
    const bytes = readFileSync(file);
    digest.update(`${name}\0${bytes.length}\0`, 'utf8');
    digest.update(bytes);
    digest.update('\0', 'utf8');
  }
  return digest.digest('hex');
}

export function releaseStamp(digest) {
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid release source digest');
  return {
    schema: 1,
    buildSystem: 'afyx-graph-atomic-build-v1',
    sourceDigest: digest,
  };
}

export function verifyReleaseReady(root) {
  const base = resolve(root);
  const distribution = verifyEngineDistribution(base);
  const stampPath = join(base, 'dist', RELEASE_STAMP);
  if (!existsSync(stampPath)) throw new Error(`missing dist/${RELEASE_STAMP}`);
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid dist/${RELEASE_STAMP}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (stamp?.schema !== 1 || stamp?.buildSystem !== 'afyx-graph-atomic-build-v1') {
    throw new Error(`invalid dist/${RELEASE_STAMP} identity`);
  }
  const current = sourceDigest(base);
  if (stamp.sourceDigest !== current) {
    throw new Error('dist was not built from the current release inputs; run `npm run build`');
  }
  return { ...distribution, sourceDigest: current };
}
