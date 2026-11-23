#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PRODUCT = 'Afyx Context Engine';
const REQUIRED_SOURCE = ['package.json', 'afyx-context.json', 'README.md', 'LICENSE'];

function fail(message) {
  process.stderr.write(`afyx-context-artifact: ${message}\n`);
  process.exit(1);
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`${name} requires a value`);
  return process.argv[index + 1];
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyFile(source, target, mode) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  if (mode) fs.chmodSync(target, mode);
}

function safeFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`symbolic links are forbidden in artifacts: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
      else fail(`unsupported filesystem entry: ${absolute}`);
    }
  }
  visit(root);
  return files.sort();
}

function prepare() {
  const source = path.resolve(argument('--source'));
  const target = path.resolve(argument('--target'));
  const metadataPath = path.resolve(argument('--metadata'));
  const manifestPath = path.resolve(argument('--manifest'));
  const revision = argument('--revision');
  const provenance = argument('--provenance', 'LOCAL_SOURCE');
  if (!/^[0-9a-f]{40}$/.test(revision)) fail('source revision must be an exact 40-character lowercase Git SHA');
  if (fs.existsSync(target)) fail(`target already exists: ${target}`);

  const product = JSON.parse(fs.readFileSync(path.join(source, 'afyx-context.json'), 'utf8'));
  const packageDocument = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (product.product_name !== PRODUCT || product.product_version !== packageDocument.version) {
    fail('source product metadata and package version do not agree');
  }
  for (const relative of REQUIRED_SOURCE) {
    const sourceFile = path.join(source, relative);
    if (!fs.statSync(sourceFile, { throwIfNoEntry: false })?.isFile()) fail(`required source file is missing: ${relative}`);
    copyFile(sourceFile, path.join(target, relative));
  }
  for (const entry of fs.readdirSync(path.join(source, 'contracts'), { withFileTypes: true })) {
    if (entry.isFile()) copyFile(path.join(source, 'contracts', entry.name), path.join(target, 'contracts', entry.name));
  }
  for (const entry of fs.readdirSync(path.join(source, 'src'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) copyFile(path.join(source, 'src', entry.name), path.join(target, 'dist', entry.name), entry.name === 'cli.js' ? 0o755 : undefined);
  }
  copyFile(path.join(source, 'package-lock.json'), path.join(target, 'package-lock.json'));
  const unixLauncher = '#!/usr/bin/env bash\nset -euo pipefail\nroot="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"\nexec node "$root/dist/cli.js" "$@"\n';
  const windowsLauncher = '@echo off\r\nsetlocal\r\nnode "%~dp0..\\dist\\cli.js" %*\r\n';
  fs.mkdirSync(path.join(target, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(target, 'bin', 'afyx-context'), unixLauncher, { mode: 0o755 });
  fs.writeFileSync(path.join(target, 'bin', 'afyx-context.cmd'), windowsLauncher);

  const identity = {
    product_name: PRODUCT,
    product_version: product.product_version,
    source_revision: revision,
    ownership_class: 'AFYX',
    build_provenance: provenance,
    release_channel: 'development',
    integration_default: 'OFF',
  };
  fs.writeFileSync(path.join(target, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);

  const records = safeFiles(target).map((relative) => `${sha256(path.join(target, ...relative.split('/')))}  current/${relative}`);
  const manifestText = `${records.join('\n')}\n`;
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, manifestText);
  const artifactDigest = sha256(manifestPath);
  const metadata = {
    schema_version: 1,
    ...identity,
    artifact_digest: artifactDigest,
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

if (process.argv[2] !== 'prepare') fail('usage: prepare --source DIR --target DIR --metadata FILE --manifest FILE --revision SHA [--provenance VALUE]');
prepare();
