import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeMove } from '../safe-move.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'afyx-safe-move-'));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function forcedEperm() {
  throw Object.assign(new Error('forced rename failure'), { code: 'EPERM' });
}

test('normal rename handles spaces, quotes, and Unicode', () => fixture((root) => {
  const from = join(root, "source O'Brien Ω");
  const to = join(root, 'destination é');
  mkdirSync(from);
  writeFileSync(join(from, 'proof.txt'), 'preserved');
  safeMove(from, to);
  assert.equal(readFileSync(join(to, 'proof.txt'), 'utf8'), 'preserved');
}));

test('Windows fallback treats quoted paths as literal data', { skip: process.platform !== 'win32' }, () => fixture((root) => {
  const from = join(root, "source O'Brien Ω");
  const to = join(root, "destination O'Brien é");
  mkdirSync(from);
  writeFileSync(join(from, 'proof.txt'), 'preserved');
  safeMove(from, to, { rename: forcedEperm });
  assert.equal(readFileSync(join(to, 'proof.txt'), 'utf8'), 'preserved');
}));

test('existing destination is never overwritten', () => fixture((root) => {
  const from = join(root, 'source');
  const to = join(root, 'destination');
  mkdirSync(from);
  mkdirSync(to);
  writeFileSync(join(from, 'proof.txt'), 'source');
  writeFileSync(join(to, 'proof.txt'), 'destination');
  assert.throws(() => safeMove(from, to), /destination already exists/);
  assert.equal(readFileSync(join(from, 'proof.txt'), 'utf8'), 'source');
  assert.equal(readFileSync(join(to, 'proof.txt'), 'utf8'), 'destination');
}));

test('failed fallback leaves source intact and reports failure', () => fixture((root) => {
  const from = join(root, 'source');
  const to = join(root, 'destination');
  mkdirSync(from);
  writeFileSync(join(from, 'proof.txt'), 'source');
  assert.throws(() => safeMove(from, to, {
    rename: forcedEperm,
    platform: 'win32',
    spawn: () => ({ status: 1 }),
  }), /PowerShell move failed/);
  assert.equal(readFileSync(join(from, 'proof.txt'), 'utf8'), 'source');
}));

test('zero subprocess exit without a move is rejected', () => fixture((root) => {
  const from = join(root, 'source');
  const to = join(root, 'destination');
  mkdirSync(from);
  assert.throws(() => safeMove(from, to, {
    rename: forcedEperm,
    platform: 'win32',
    spawn: () => ({ status: 0 }),
  }), /did not preserve source\/destination state/);
}));

test('non-Windows EPERM never invokes PowerShell', () => fixture((root) => {
  const from = join(root, 'source');
  mkdirSync(from);
  assert.throws(() => safeMove(from, join(root, 'destination'), {
    rename: forcedEperm,
    platform: 'linux',
    spawn: () => { throw new Error('unexpected PowerShell invocation'); },
  }), /forced rename failure/);
}));
