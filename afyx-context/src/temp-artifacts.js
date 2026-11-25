/** Copyright (c) 2026 Afyx */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync,
  rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const RECEIPT = '.afyx-completed.json';
const PREFIX = /^(?:afyx|codex|cg)-/;
const SPILL = /^afyx-cli-spill-[a-z0-9]{6}$/i;
const PAYLOAD = /^afyx_raw_cli_\d+_[a-f0-9]{32}\.log$/;
const PROTECTED = /^(?:\.(?:codex|claude|gemini|afyx|agents|rea_source|git)|_afyx-private-archive|node_modules|testing|progres)$/i;
const MAX_RECEIPT = 4096;
const MAX_PAYLOAD = 50 * 1024 * 1024;
const BYTE_BUDGET = 100 * 1024 * 1024;
const HOUR = 3600 * 1000;
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const fileIdentity = ({ dev, ino, size, birthtimeMs, mtimeMs, ctimeMs }) => [dev, ino, size, birthtimeMs, mtimeMs, ctimeMs];
const dirIdentity = ({ dev, ino, birthtimeMs }) => [dev, ino, birthtimeMs];
const matches = (one, two) => JSON.stringify(one) === JSON.stringify(two);
const owned = stat => typeof process.getuid !== 'function' ||
  (stat.uid === process.getuid() && (stat.mode & 0o077) === 0);

function checkedDirectory(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(realpathSync(path), path)) throw new Error('UNSAFE_DIRECTORY');
  return stat;
}

function checkedFile(path, limit, consume) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !owned(stat) || stat.size > limit) {
    throw new Error('UNSAFE_FILE');
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const identity = fileIdentity(stat);
    if (!matches(fileIdentity(fstatSync(fd)), identity) || !samePath(realpathSync(path), path)) throw new Error('IDENTITY_CHANGED');
    const value = consume(fd, stat.size);
    if (!matches(fileIdentity(fstatSync(fd)), identity)) throw new Error('IDENTITY_CHANGED');
    return { value, identity };
  } finally { closeSync(fd); }
}

function digest(fd, size, deadline = Infinity) {
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(64 * 1024);
  for (let offset = 0; offset < size;) {
    if (performance.now() > deadline) throw new Error('CLEAN_BOUND_REACHED');
    const read = readSync(fd, chunk, 0, Math.min(size - offset, chunk.length), offset);
    if (!read) throw new Error('IDENTITY_CHANGED');
    hash.update(chunk.subarray(0, read));
    offset += read;
  }
  return hash.digest('hex');
}

/** Called by the spill producer only after its exclusively opened payload is closed. */
export function registerCompletedSpill(file) {
  try {
    const directory = realpathSync(dirname(file));
    const name = basename(file);
    const stat = checkedDirectory(directory);
    if (!SPILL.test(basename(directory)) || !PAYLOAD.test(name) || !owned(stat)) return;
    const payload = checkedFile(join(directory, name), MAX_PAYLOAD, digest);
    writeFileSync(join(directory, RECEIPT), JSON.stringify({
      schema: 'afyx-temp/spill-v1', directory: dirIdentity(stat), pid: process.pid,
      completed: Date.now(), name, payload,
    }), { flag: 'wx', mode: 0o600 });
  } catch {
    // A recoverable spill can remain even if automatic-cleanup ownership is unavailable.
  }
}

function processActive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export function cleanTempArtifacts({ root, dryRun = false, maxAgeHours = 6, now = Date.now() }) {
  if (!Number.isSafeInteger(maxAgeHours) || maxAgeHours < 6 || maxAgeHours > 8760) throw new Error('INVALID_CLEAN_RETENTION');
  const result = { contract: 'AfyxTempCleanup/v1', dryRun, maxAgeHours, discovered: 0, eligible: 0,
    removed: 0, skipped: 0, failed: 0, estimatedReclaimedBytes: 0, truncated: false, reasons: {} };
  const record = (kind, reason) => {
    ++result[kind];
    result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
  };
  let boundary, rootIdentity;
  try {
    if (typeof root !== 'string' || !isAbsolute(root) || lstatSync(resolve(root)).isSymbolicLink()) throw new Error();
    boundary = realpathSync(root);
    if (boundary === dirname(boundary) || samePath(boundary, resolve(homedir())) || boundary.split(sep).some(part => PROTECTED.test(part)) ||
        (process.platform === 'win32' && boundary.startsWith('\\\\'))) throw new Error();
    if (process.platform === 'win32') {
      const fromProfile = relative(realpathSync(homedir()), boundary);
      if (!fromProfile || isAbsolute(fromProfile) || fromProfile.split(sep)[0] === '..') throw new Error();
    }
    rootIdentity = dirIdentity(checkedDirectory(boundary));
  } catch {
    record('failed', 'UNSAFE_TEMP_ROOT');
    return result;
  }
  const deadline = performance.now() + 1500;
  let budget = BYTE_BUDGET;
  const names = [];
  try {
    const dir = opendirSync(boundary);
    try {
      for (let item, count = 0; (item = dir.readSync());) {
        if (++count > 1024 || performance.now() > deadline) { result.truncated = true; break; }
        if (PREFIX.test(item.name)) names.push(item.name);
      }
    } finally { dir.closeSync(); }
  } catch {
    record('failed', 'TEMP_ROOT_UNREADABLE');
    return result;
  }
  result.discovered = names.length;
  for (const name of names.sort()) {
    if (performance.now() > deadline || budget <= 0) {
      result.truncated = true;
      record('skipped', 'CLEAN_BOUND_REACHED');
      continue;
    }
    if (!SPILL.test(name)) { record('skipped', 'OWNERSHIP_UNVERIFIED'); continue; }
    const directory = join(boundary, name);
    const marker = join(directory, RECEIPT);
    let eligible = false;
    try {
      if (!matches(rootIdentity, dirIdentity(checkedDirectory(boundary)))) throw new Error('IDENTITY_CHANGED');
      const stat = checkedDirectory(directory);
      if (!owned(stat)) throw new Error('OWNERSHIP_UNVERIFIED');
      if (now - stat.mtimeMs < maxAgeHours * HOUR) { record('skipped', 'RETAINED_BY_AGE'); continue; }
      const { value: receipt, identity: markerIdentity } = checkedFile(marker, MAX_RECEIPT, (fd, size) => {
        const bytes = Buffer.alloc(size);
        if (readSync(fd, bytes, 0, size, 0) !== size) throw new Error('INVALID_RECEIPT');
        return JSON.parse(bytes.toString('utf8'));
      });
      if (receipt?.schema !== 'afyx-temp/spill-v1' || !matches(receipt.directory, dirIdentity(stat)) ||
          !PAYLOAD.test(receipt.name ?? '') || !Number.isSafeInteger(receipt.completed) ||
          receipt.completed < stat.birthtimeMs - 1000 || !Number.isInteger(receipt.pid) ||
          receipt.pid <= 0 || receipt.pid > 0x7fffffff) throw new Error('OWNERSHIP_UNVERIFIED');
      if (now - receipt.completed < maxAgeHours * HOUR) { record('skipped', 'RETAINED_BY_AGE'); continue; }
      if (processActive(receipt.pid)) { record('skipped', 'ACTIVE_CREATOR'); continue; }
      const dir = opendirSync(directory);
      try {
        const contents = [dir.readSync()?.name, dir.readSync()?.name];
        if (!contents.includes(RECEIPT) || !contents.includes(receipt.name) || dir.readSync()) {
          throw new Error('UNCLASSIFIED_CONTENTS');
        }
      } finally { dir.closeSync(); }
      const payload = join(directory, receipt.name);
      const verified = checkedFile(payload, Math.min(budget, MAX_PAYLOAD), (fd, size) => {
        budget -= size;
        return digest(fd, size, deadline);
      });
      const confirm = () => matches(rootIdentity, dirIdentity(checkedDirectory(boundary))) &&
        matches(dirIdentity(stat), dirIdentity(checkedDirectory(directory)));
      if (!matches(verified, receipt.payload) || !confirm() || processActive(receipt.pid) ||
          !matches(markerIdentity, fileIdentity(lstatSync(marker))) ||
          !matches(verified.identity, fileIdentity(lstatSync(payload)))) throw new Error('IDENTITY_CHANGED');
      eligible = true;
      ++result.eligible;
      result.estimatedReclaimedBytes += verified.identity[2];
      if (dryRun) continue;
      unlinkSync(payload);
      if (!confirm() || !matches(markerIdentity, fileIdentity(lstatSync(marker)))) throw new Error('IDENTITY_CHANGED');
      unlinkSync(marker);
      if (!confirm()) throw new Error('IDENTITY_CHANGED');
      rmdirSync(directory);
      ++result.removed;
    } catch (error) {
      if (error.message === 'CLEAN_BOUND_REACHED') result.truncated = true;
      const reason = ['CLEAN_BOUND_REACHED', 'UNCLASSIFIED_CONTENTS', 'IDENTITY_CHANGED', 'UNSAFE_DIRECTORY', 'UNSAFE_FILE']
        .includes(error.message) ? error.message : eligible ? 'REMOVE_FAILED' : 'OWNERSHIP_UNVERIFIED';
      record(eligible ? 'failed' : 'skipped', reason);
    }
  }
  return result;
}
