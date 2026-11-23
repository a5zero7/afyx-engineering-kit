import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AfyxContextEngine } from '../src/engine.js';
import { AceError } from '../src/errors.js';
import { ContextStore } from '../src/storage.js';

const worker = fileURLToPath(new URL('../test-fixtures/coordination-worker.mjs', import.meta.url));

function lab(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-context-coordination-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function waitFor(predicate, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function launch({ mode = 'reduce', stateDir, ownerId = 'owner', sessionId = 'session', readyPath, gatePath, outputPath, payload = '', id = 'worker', timeout = 5_000 }) {
  const child = spawn(process.execPath, [
    worker, mode, stateDir, ownerId, sessionId, readyPath, gatePath, outputPath, payload, id, String(timeout),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completed = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, completed };
}

async function simultaneousWriters(t, configurations) {
  const root = lab(t);
  const stateDir = path.join(root, 'state');
  const gatePath = path.join(root, 'go');
  const runs = configurations.map((configuration, index) => {
    const readyPath = path.join(root, `ready-${index}`);
    const outputPath = path.join(root, `output-${index}.json`);
    return {
      readyPath,
      outputPath,
      ...launch({ ...configuration, stateDir, readyPath, gatePath, outputPath }),
    };
  });
  await waitFor(() => runs.every(({ readyPath }) => fs.existsSync(readyPath)), 'writers did not reach the deterministic start gate');
  fs.writeFileSync(gatePath, 'go', { flag: 'wx' });
  const exits = await Promise.all(runs.map(({ completed }) => completed));
  const outputs = runs.map(({ outputPath }) => JSON.parse(fs.readFileSync(outputPath, 'utf8')));
  exits.forEach((exit, index) => assert.equal(exit.code, 0, outputs[index].message || exit.stderr || exit.stdout));
  outputs.forEach((output) => assert.equal(output.ok, true, output.message));
  return { root, stateDir, outputs };
}

test('serializes simultaneous first initialization and writers for one session without lost updates', async (t) => {
  const first = 'first concurrent original';
  const second = 'second concurrent original';
  const { stateDir } = await simultaneousWriters(t, [
    { payload: first, id: 'first' },
    { payload: second, id: 'second' },
  ]);
  const reopened = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session' });
  const firstReference = reopened.store.reference(first);
  const secondReference = reopened.store.reference(second);
  assert.equal(reopened.retrieve(firstReference), first);
  assert.equal(reopened.retrieve(secondReference), second);
  assert.deepEqual(reopened.retrieveRecord(firstReference).observations.map(({ id }) => id), ['first']);
  assert.deepEqual(reopened.retrieveRecord(secondReference).observations.map(({ id }) => id), ['second']);
});

test('coordinates different sessions sharing one owner content store', async (t) => {
  const shared = 'content shared safely by two sessions';
  const { stateDir } = await simultaneousWriters(t, [
    { sessionId: 'session-a', payload: shared, id: 'a' },
    { sessionId: 'session-b', payload: shared, id: 'b' },
  ]);
  for (const sessionId of ['session-a', 'session-b']) {
    const reopened = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId });
    assert.equal(reopened.retrieve(reopened.store.reference(shared)), shared);
  }
  const digest = crypto.createHash('sha256').update(shared).digest('hex');
  assert.deepEqual(fs.readdirSync(path.join(stateDir, 'content')), [`${digest}.txt`]);
});

test('times out during a concurrent write, hides partial evidence, then safely recovers the crashed owner', async (t) => {
  const root = lab(t);
  const stateDir = path.join(root, 'state');
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session', lockTimeoutMs: 150, lockRetryMs: 10 });
  const content = 'stable original before interrupted owner';
  const interruptedContent = 'complete orphan blob from interrupted writer';
  const result = engine.reduce({ segments: [{ id: 'stable', content }] });
  const reference = result.items[0].reference;
  const sessionPath = path.join(stateDir, 'sessions', crypto.createHash('sha256').update('session').digest('hex'), 'session.json');
  const before = fs.readFileSync(sessionPath);
  const readyPath = path.join(root, 'holder-ready');
  const gatePath = path.join(root, 'unused-gate');
  const outputPath = path.join(root, 'holder-output.json');
  const holder = launch({
    mode: 'interrupt-write',
    stateDir,
    readyPath,
    gatePath,
    outputPath,
    payload: interruptedContent,
    id: 'interrupted',
  });
  await waitFor(() => fs.existsSync(readyPath), 'writer did not reach the deterministic metadata commit boundary');

  assert.throws(
    () => engine.retrieve(reference),
    (error) => error instanceof AceError && error.code === 'LOCK_TIMEOUT' && /150 ms/.test(error.message),
  );
  assert.deepEqual(fs.readFileSync(sessionPath), before);
  assert.equal(holder.child.kill(), true);
  await holder.completed;

  assert.equal(engine.retrieve(reference), content);
  assert.deepEqual(fs.readFileSync(sessionPath), before);
  const interruptedReference = engine.store.reference(interruptedContent);
  assert.throws(
    () => engine.retrieve(interruptedReference),
    (error) => error instanceof AceError && error.code === 'REFERENCE_BOUNDARY',
  );
  const recovered = engine.reduce({ segments: [{ id: 'recovered', content: interruptedContent }] });
  assert.equal(engine.retrieve(recovered.items[0].reference), interruptedContent);
  assert.equal(fs.readdirSync(path.dirname(sessionPath)).some((entry) => entry.endsWith('.tmp')), false);
  assert.equal(fs.existsSync(path.join(stateDir, '.ace-lock')), false);
});

test('releases an owned lock after a synchronous operation failure', (t) => {
  const stateDir = lab(t);
  const store = new ContextStore({ stateDir, ownerId: 'owner', sessionId: 'session' });
  assert.throws(() => store.withExclusiveAccess(() => { throw new Error('synthetic operation failure'); }), /synthetic operation failure/);
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session' });
  assert.doesNotThrow(() => engine.reduce({ segments: [{ id: 'after', content: 'lock released' }] }));
});

test('rejects invalid coordination bounds before creating state', (t) => {
  const root = lab(t);
  const stateDir = path.join(root, 'not-created');
  assert.throws(
    () => new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session', lockTimeoutMs: 0 }),
    (error) => error instanceof AceError && error.code === 'INVALID_INPUT',
  );
  assert.equal(fs.existsSync(stateDir), false);
});

for (const [name, ownerMetadata] of [
  ['missing ownership metadata', null],
  ['malformed ownership metadata', '{"format":"ace.lock/v1"'],
  ['foreign ownership metadata', JSON.stringify({ format: 'ace.lock/v1', token: crypto.randomUUID() })],
]) {
  test(`fails closed on ${name} without changing state or lock evidence`, (t) => {
    const stateDir = lab(t);
    const established = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session' });
    established.reduce({ segments: [{ id: 'stable', content: 'preserved state' }] });
    const lockDir = path.join(stateDir, '.ace-lock');
    fs.mkdirSync(lockDir);
    if (ownerMetadata !== null) fs.writeFileSync(path.join(lockDir, 'owner.json'), ownerMetadata);
    const before = fs.readdirSync(lockDir).map((entry) => [entry, fs.readFileSync(path.join(lockDir, entry))]);
    const manifestBefore = fs.readFileSync(path.join(stateDir, 'state.json'));

    assert.throws(
      () => new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session', lockTimeoutMs: 100 }),
      (error) => error instanceof AceError && error.code === 'LOCK_RECOVERY_UNSAFE',
    );
    assert.deepEqual(fs.readFileSync(path.join(stateDir, 'state.json')), manifestBefore);
    assert.deepEqual(
      fs.readdirSync(lockDir).map((entry) => [entry, fs.readFileSync(path.join(lockDir, entry))]),
      before,
    );
  });
}

for (const [name, expectedCode, metadataFor] of [
  ['foreign owner', 'LOCK_RECOVERY_UNSAFE', (stateDir) => ({
    format: 'ace.lock/v1',
    token: crypto.randomUUID(),
    stateRootHash: crypto.createHash('sha256').update(stateDir).digest('hex'),
    ownerHash: crypto.createHash('sha256').update('other-owner').digest('hex'),
    host: os.hostname(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
  })],
  ['cross-host owner with inconclusive liveness', 'LOCK_RECOVERY_UNSAFE', (stateDir) => ({
    format: 'ace.lock/v1',
    token: crypto.randomUUID(),
    stateRootHash: crypto.createHash('sha256').update(stateDir).digest('hex'),
    ownerHash: crypto.createHash('sha256').update('owner').digest('hex'),
    host: `${os.hostname()}-other-host`,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  })],
]) {
  test(`preserves a ${name} lock and fails recovery closed`, (t) => {
    const stateDir = lab(t);
    const established = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session' });
    established.reduce({ segments: [{ id: 'stable', content: 'preserved state' }] });
    const lockDir = path.join(stateDir, '.ace-lock');
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify(metadataFor(stateDir), null, 2)}\n`);
    const lockBefore = fs.readFileSync(path.join(lockDir, 'owner.json'));
    const manifestBefore = fs.readFileSync(path.join(stateDir, 'state.json'));

    assert.throws(
      () => new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'session', lockTimeoutMs: 100 }),
      (error) => error instanceof AceError && error.code === expectedCode,
    );
    assert.deepEqual(fs.readFileSync(path.join(lockDir, 'owner.json')), lockBefore);
    assert.deepEqual(fs.readFileSync(path.join(stateDir, 'state.json')), manifestBefore);
  });
}
