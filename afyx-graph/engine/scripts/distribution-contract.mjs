#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT_FILE = join(SCRIPT_ROOT, 'scripts', 'distribution-product.json');
export const DISTRIBUTION_PRODUCT = Object.freeze(
  JSON.parse(readFileSync(PRODUCT_FILE, 'utf8')),
);

export function distributionTargets() {
  return [...DISTRIBUTION_PRODUCT.targets];
}

export function artifactPlan(target) {
  if (!DISTRIBUTION_PRODUCT.targets.includes(target)) {
    throw new DistributionError(`unsupported target: ${target}`);
  }
  const separator = target.indexOf('-');
  const family = target.slice(0, separator);
  const arch = target.slice(separator + 1);
  const bundleName = `${DISTRIBUTION_PRODUCT.bundlePrefix}-${target}`;
  return {
    target,
    family,
    arch,
    bundleName,
    archiveName: `${bundleName}.${family === 'win32' ? 'zip' : 'tar.gz'}`,
    runtime: { ...DISTRIBUTION_PRODUCT.runtime },
    launcherPath: `bin/${family === 'win32' ? `${DISTRIBUTION_PRODUCT.cli}.cmd` : DISTRIBUTION_PRODUCT.cli}`,
    legalFiles: DISTRIBUTION_PRODUCT.legalFiles.map((entry) => ({ ...entry })),
  };
}

export class DistributionError extends Error {}

function requireFile(path, label = path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new DistributionError(`missing ${label}`);
  return path;
}

function localAssetPaths(html) {
  return [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) && !url.startsWith('#'))
    .map((url) => url.replace(/^\.\//, '').replace(/[?#].*$/, ''))
    .filter(Boolean);
}

export function verifyEngineDistribution(root = SCRIPT_ROOT) {
  const dist = join(resolve(root), 'dist');
  const viewer = join(dist, 'viewer');
  const index = requireFile(join(viewer, 'index.html'), 'dist/viewer/index.html');
  const html = readFileSync(index, 'utf8');
  if (html.length < 200 || !/<div id="app">/.test(html)) {
    throw new DistributionError(`dist/viewer/index.html is not a complete viewer (${html.length} bytes)`);
  }
  const assets = localAssetPaths(html);
  if (assets.length === 0) throw new DistributionError('dist/viewer/index.html references no bundled assets');
  for (const asset of assets) requireFile(join(viewer, ...asset.split('/')), `dist/viewer/${asset}`);
  for (const file of DISTRIBUTION_PRODUCT.engineSentinels) {
    requireFile(join(dist, ...file.split('/')), `dist/${file}`);
  }
  const shippedGrammars = walkFiles(dist).filter((file) => file.endsWith('.wasm'));
  if (shippedGrammars.length > 0) {
    throw new DistributionError('dist must not contain grammar WASM');
  }

  const engineMaps = walkFiles(dist).filter((file) => file.endsWith('.js.map') && !file.includes(`${sep}viewer${sep}`));
  if (engineMaps.length === 0) throw new DistributionError('engine JavaScript source maps are missing');
  const viewerMaps = walkFiles(viewer).filter((file) => file.endsWith('.map'));
  if (viewerMaps.length > 0) throw new DistributionError('viewer source maps must remain disabled');
  return { assets: assets.length, engineSourceMaps: engineMaps.length };
}

export function verifyBundle(root, target) {
  const bundle = resolve(root);
  const plan = artifactPlan(target);
  const windows = plan.family === 'win32';
  const lib = join(bundle, 'lib');
  const engine = verifyEngineDistribution(lib);
  const manifest = JSON.parse(readFileSync(requireFile(join(lib, 'package.json'), 'lib/package.json'), 'utf8'));
  if (manifest.name !== DISTRIBUTION_PRODUCT.packageName ||
      manifest.bin?.[DISTRIBUTION_PRODUCT.cli] !== `./dist/bin/${DISTRIBUTION_PRODUCT.cli}.js`) {
    throw new DistributionError('lib/package.json has the wrong package identity or CLI entrypoint');
  }
  const metadata = JSON.parse(readFileSync(requireFile(join(bundle, 'metadata.json'), 'metadata.json'), 'utf8'));
  if (metadata.product_name !== DISTRIBUTION_PRODUCT.productName || metadata.cli !== DISTRIBUTION_PRODUCT.cli) {
    throw new DistributionError('metadata.json has the wrong operational identity');
  }
  if (metadata.release_channel !== DISTRIBUTION_PRODUCT.releaseChannel) {
    throw new DistributionError('metadata.json has the wrong release channel');
  }
  if (metadata.artifact_identity_schema !== undefined) {
    if (metadata.artifact_identity_schema !== 1 || metadata.artifact_target !== target) {
      throw new DistributionError('metadata.json has an invalid artifact identity schema or target');
    }
    if (!/^[0-9a-f]{7,64}$|^UNKNOWN$/i.test(String(metadata.source_revision || '')) ||
        !String(metadata.build_identity || '').trim() ||
        !Number.isSafeInteger(metadata.extraction_version)) {
      throw new DistributionError('metadata.json has incomplete revision/build/extraction identity');
    }
  }
  for (const legal of plan.legalFiles) {
    const file = requireFile(join(bundle, ...legal.bundlePath.split('/')), legal.bundlePath);
    if (statSync(file).size === 0) throw new DistributionError(`${legal.bundlePath} is empty`);
  }
  for (const bundledRuntime of ['node', 'node.exe']) {
    if (existsSync(join(bundle, bundledRuntime))) {
      throw new DistributionError(`bundle must not contain a bundled Node runtime: ${bundledRuntime}`);
    }
  }
  const launcher = requireFile(
    join(bundle, ...plan.launcherPath.split('/')),
    plan.launcherPath,
  );
  const launcherText = readFileSync(launcher, 'utf8');
  if (!launcherText.includes('lib') || !launcherText.includes('dist') || !launcherText.includes('afyx-graph.js')) {
    throw new DistributionError('launcher does not target lib/dist/bin/afyx-graph.js');
  }
  if (!launcherText.includes('Node.js was not found on PATH') || !launcherText.includes('node ')) {
    throw new DistributionError('launcher does not enforce the external Node.js runtime contract');
  }
  const parserRuntimeFiles = walkFiles(lib).filter((file) => {
    const shippedPath = relative(lib, file).split(sep).join('/').toLowerCase();
    return shippedPath.includes('web-tree-sitter') ||
      shippedPath.includes('tree-sitter-wasms') ||
      shippedPath.endsWith('/tree-sitter.wasm');
  });
  if (parserRuntimeFiles.length > 0) {
    throw new DistributionError('bundle must not contain a third-party parser runtime');
  }
  const kernelFiles = walkFiles(lib).filter((file) => {
    const shippedPath = relative(lib, file).split(sep).join('/').toLowerCase();
    return shippedPath.includes('afyx-graph-kernel') ||
      shippedPath.startsWith('kernel/') ||
      shippedPath.endsWith('/cargo.toml') ||
      shippedPath.endsWith('/cargo.lock');
  });
  if (kernelFiles.length > 0) {
    throw new DistributionError('bundle must not contain native kernel source or runtime');
  }
  const shippedDependencies = walkFiles(bundle).filter((file) =>
    relative(bundle, file).split(sep).some((part) => part === 'node_modules')
  );
  if (shippedDependencies.length > 0) {
    throw new DistributionError('bundle must not contain node_modules');
  }
  for (const forbidden of ['src', '__tests__', 'ui']) {
    if (existsSync(join(lib, forbidden))) throw new DistributionError(`development-only lib/${forbidden} is packaged`);
  }
  return { ...engine, legalFiles: plan.legalFiles.length, target };
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort();
}

export function artifactManifest(root) {
  const base = resolve(root);
  return walkFiles(base).map((absolute) => {
    const bytes = readFileSync(absolute);
    return {
      path: relative(base, absolute).split(sep).join('/'),
      type: 'file',
      size: bytes.length,
      executable: process.platform === 'win32' ? null : Boolean(statSync(absolute).mode & 0o111),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
}

function argument(flag, fallback) {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const root = resolve(argument('--root', SCRIPT_ROOT));
    if (command === 'targets') console.log(distributionTargets().join(' '));
    else if (command === 'plan') {
      const plan = artifactPlan(argument('--target', ''));
      const field = argument('--field', '');
      console.log(field ? String(plan[field] ?? '') : JSON.stringify(plan, null, 2));
    }
    else if (command === 'legal-files') {
      for (const file of DISTRIBUTION_PRODUCT.legalFiles) console.log(`${file.source}|${file.bundlePath}`);
    }
    else if (command === 'verify-dist') console.log(JSON.stringify(verifyEngineDistribution(root), null, 2));
    else if (command === 'verify-bundle') console.log(JSON.stringify(verifyBundle(root, argument('--target', '')), null, 2));
    else if (command === 'manifest') console.log(JSON.stringify(artifactManifest(root), null, 2));
    else throw new DistributionError('usage: distribution-contract.mjs targets|plan|legal-files|verify-dist|verify-bundle|manifest [options]');
  } catch (error) {
    console.error(`[distribution] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
