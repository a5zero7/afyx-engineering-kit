#!/usr/bin/env node

/** Atomic lifecycle for the installed AfyxHostBridge/v1 runtime bundle. */
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AFYX_HOST_BRIDGE_PRODUCT = 'Afyx Universal Host Bridge';
export const AFYX_HOST_BRIDGE_CONTRACT = 'AfyxHostBridge/v1';
export const HOST_BRIDGE_FILES = Object.freeze([
  'afyx-host-bridge.mjs',
  'afyx-universal-runtime.mjs',
  'afyx-host-adapters.mjs',
  'afyx-capability-orchestrator.mjs',
  'afyx-modular-integration.mjs',
  'afyx-modular-runtime.mjs',
  'afyx-tool-family-routing.mjs',
  'components.json',
]);

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function json(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function ensureOrdinaryDirectory(path) {
  if (!existsSync(path)) return;
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`HOST_BRIDGE_PATH_UNSAFE: ${path}`);
}

function identity(runtimeRoot) {
  return json(join(runtimeRoot, 'metadata.json'));
}

export function verifyHostBridge(runtimeRoot) {
  const root = resolve(runtimeRoot);
  const metadata = identity(root);
  if (metadata?.product_name !== AFYX_HOST_BRIDGE_PRODUCT
      || metadata?.contract !== AFYX_HOST_BRIDGE_CONTRACT) {
    return { status: 'NOT_INSTALLED', runtimeRoot: root, entry: join(root, 'current', 'afyx-host-bridge.mjs') };
  }
  const integrity = json(join(root, 'integrity.json'));
  if (!integrity?.files || typeof integrity.files !== 'object') {
    return { status: 'BROKEN', runtimeRoot: root, reason: 'INTEGRITY_MISSING' };
  }
  for (const file of HOST_BRIDGE_FILES) {
    const target = join(root, 'current', file);
    if (!existsSync(target) || sha256(target) !== integrity.files[file]) {
      return { status: 'BROKEN', runtimeRoot: root, reason: 'INTEGRITY_MISMATCH', file };
    }
  }
  return {
    status: 'READY', runtimeRoot: root,
    entry: join(root, 'current', 'afyx-host-bridge.mjs'),
    sourceRevision: metadata.source_revision ?? null,
  };
}

export function installHostBridge({ sourceRoot, runtimeRoot, sourceRevision = 'UNKNOWN' }) {
  const source = resolve(sourceRoot);
  const root = resolve(runtimeRoot);
  ensureOrdinaryDirectory(root);
  const existing = identity(root);
  if (existsSync(root) && readdirSync(root).length > 0
      && existing?.product_name !== AFYX_HOST_BRIDGE_PRODUCT) {
    throw new Error(`HOST_BRIDGE_FOREIGN_RUNTIME: ${root}`);
  }
  for (const file of HOST_BRIDGE_FILES) {
    if (!existsSync(join(source, file))) throw new Error(`HOST_BRIDGE_SOURCE_MISSING: ${file}`);
  }

  const current = join(root, 'current');
  if (existsSync(current)) ensureOrdinaryDirectory(current);
  const verified = verifyHostBridge(root);
  if (verified.status === 'READY' && verified.sourceRevision === sourceRevision
      && HOST_BRIDGE_FILES.every((file) => sha256(join(source, file)) === sha256(join(current, file)))) {
    return { ...verified, changed: false };
  }
  mkdirSync(root, { recursive: true });
  const stage = join(root, `.stage-${process.pid}-${Date.now()}`);
  const backup = join(root, `.backup-${process.pid}-${Date.now()}`);
  let movedCurrent = false;
  try {
    mkdirSync(stage, { recursive: false });
    const hashes = {};
    for (const file of HOST_BRIDGE_FILES) {
      const target = join(stage, file);
      copyFileSync(join(source, file), target);
      hashes[file] = sha256(target);
    }
    if (existsSync(current)) {
      ensureOrdinaryDirectory(current);
      renameSync(current, backup);
      movedCurrent = true;
    }
    renameSync(stage, current);
    atomicJson(join(root, 'integrity.json'), { schema_version: 1, files: hashes });
    atomicJson(join(root, 'metadata.json'), {
      schema_version: 1,
      product_name: AFYX_HOST_BRIDGE_PRODUCT,
      contract: AFYX_HOST_BRIDGE_CONTRACT,
      source_revision: sourceRevision,
      entry: 'current/afyx-host-bridge.mjs',
    });
    const verified = verifyHostBridge(root);
    if (verified.status !== 'READY') throw new Error(`HOST_BRIDGE_VERIFY_FAILED: ${verified.reason}`);
    if (movedCurrent) rmSync(backup, { recursive: true, force: true });
    return { ...verified, changed: true };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    if (movedCurrent && !existsSync(current) && existsSync(backup)) renameSync(backup, current);
    throw error;
  }
}

export function uninstallHostBridge(runtimeRoot) {
  const root = resolve(runtimeRoot);
  const verified = verifyHostBridge(root);
  if (verified.status === 'NOT_INSTALLED') return { status: 'NOT_INSTALLED', changed: false, runtimeRoot: root };
  if (verified.status !== 'READY') throw new Error(`HOST_BRIDGE_UNINSTALL_REFUSED: ${verified.reason}`);
  rmSync(join(root, 'current'), { recursive: true, force: false });
  rmSync(join(root, 'integrity.json'), { force: false });
  rmSync(join(root, 'metadata.json'), { force: false });
  if (readdirSync(root).length === 0) rmdirSync(root);
  return { status: 'NOT_INSTALLED', changed: true, runtimeRoot: root };
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const runtimeRoot = argument('--runtime-root');
    let result;
    if (process.argv.includes('--install')) {
      result = installHostBridge({
        sourceRoot: argument('--source-root'), runtimeRoot,
        sourceRevision: argument('--source-revision', 'UNKNOWN'),
      });
    } else if (process.argv.includes('--uninstall')) {
      result = uninstallHostBridge(runtimeRoot);
    } else {
      result = verifyHostBridge(runtimeRoot);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'BROKEN') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`[host-bridge-lifecycle] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
