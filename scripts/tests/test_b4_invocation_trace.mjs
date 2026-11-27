/** Copyright (c) 2026 Afyx */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  AfyxContextEngine,
  TRACE_CONTRACT,
  isTraceEnabled,
  recordInvocationTrace,
  readInvocationTraces,
  summarizeInvocationTraces,
} from '../../afyx-context/src/index.js';
import { parseCliArgs } from '../afyx-npm-installer.mjs';
import { runInstalledAfyxWorkflow } from '../afyx-universal-runtime.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'afyx-b4-trace-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('invocation trace is opt-in by default and creates no file when disabled', (t) => {
  const dir = fixture(t);
  const traceFile = join(dir, 'trace', 'invocations.jsonl');
  const prevEnabled = process.env.AFYX_TRACE_ENABLED;
  const prevFile = process.env.AFYX_TRACE_FILE;
  delete process.env.AFYX_TRACE_ENABLED;
  process.env.AFYX_TRACE_FILE = traceFile;
  t.after(() => {
    if (prevEnabled === undefined) delete process.env.AFYX_TRACE_ENABLED;
    else process.env.AFYX_TRACE_ENABLED = prevEnabled;
    if (prevFile === undefined) delete process.env.AFYX_TRACE_FILE;
    else process.env.AFYX_TRACE_FILE = prevFile;
  });

  assert.equal(isTraceEnabled(), false);
  const res = recordInvocationTrace({ component: 'afyx-context', operation: 'reduce', status: 'success' });
  assert.equal(res.status, 'DISABLED');
  assert.equal(res.recorded, false);
  assert.equal(existsSync(traceFile), false);

  const engine = new AfyxContextEngine({ stateDir: join(dir, 'state'), ownerId: 'o1', sessionId: 's1' });
  const reduced = engine.reduce({ segments: [{ id: 'a', content: 'hello world' }], budgetChars: 1000 });
  assert.equal(reduced.mode, 'optimized');
  assert.equal(existsSync(traceFile), false);
});

test('owner-verified locking protects live locks, recovers dead locks, and enforces independent byte/record limits', (t) => {
  const dir = fixture(t);
  const traceFile = join(dir, 'invocations.jsonl');
  const lockPath = `${traceFile}.lock`;

  // 1. Live-owner lock (even with old timestamp) MUST NOT be reclaimed
  writeFileSync(lockPath, JSON.stringify({
    format: 'afyx.trace-lock/v1',
    token: '11111111-1111-4111-8111-111111111111',
    pid: process.pid,
    host: hostname(),
    createdAt: '2020-01-01T00:00:00.000Z',
  }), 'utf8');

  const contended = recordInvocationTrace(
    { component: 'afyx-context', operation: 'reduce', status: 'success' },
    { enabled: true, traceFile, lockTimeoutMs: 50, lockRetryMs: 10 },
  );
  assert.equal(contended.status, 'LOCK_CONTENTION');
  assert.equal(contended.recorded, false);
  assert.equal(existsSync(lockPath), true);
  rmSync(lockPath, { force: true });

  // 2. Dead-owner lock MUST be reclaimed cleanly
  writeFileSync(lockPath, JSON.stringify({
    format: 'afyx.trace-lock/v1',
    token: '22222222-2222-4222-8222-222222222222',
    pid: 99999999,
    host: hostname(),
    createdAt: new Date().toISOString(),
  }), 'utf8');

  const recovered = recordInvocationTrace(
    { component: 'afyx-context', operation: 'reduce', status: 'success', inputBytes: 10 },
    { enabled: true, traceFile },
  );
  assert.equal(recovered.status, 'OK');
  assert.equal(recovered.recorded, true);

  // 3. Record larger than maxBytes is rejected explicitly without corrupting file
  const tooLarge = recordInvocationTrace(
    { component: 'afyx-context', operation: 'reduce', status: 'success' },
    { enabled: true, traceFile, maxBytes: 50 },
  );
  assert.equal(tooLarge.status, 'RECORD_TOO_LARGE');
  assert.equal(tooLarge.recorded, false);

  // 4. Independent maxRecords enforcement
  for (let i = 0; i < 8; i++) {
    const r = recordInvocationTrace(
      { component: 'afyx-context', operation: 'reduce', status: 'success', inputBytes: i + 1 },
      { enabled: true, traceFile, maxBytes: 1024 * 1024, maxRecords: 3 },
    );
    assert.equal(r.recorded, true);
  }
  const read = readInvocationTraces({ traceFile });
  assert.equal(read.count, 3);
  assert.deepEqual(read.records.map((r) => r.inputBytes), [6, 7, 8]);
});

test('concurrent multi-process append and rotation never drops or corrupts JSONL lines', async (t) => {
  const dir = fixture(t);
  const traceFile = join(dir, 'concurrent.jsonl');
  const moduleUrl = new URL('../../afyx-context/src/invocation-trace.js', import.meta.url).href;
  const workerScript = `
    import { recordInvocationTrace } from ${JSON.stringify(moduleUrl)};
    const id = process.argv[2];
    for (let i = 0; i < 5; i++) {
      const r = recordInvocationTrace({ component: 'afyx-context', operation: 'worker-' + id, status: 'success', inputBytes: i + 1 },
        { enabled: true, traceFile: ${JSON.stringify(traceFile)}, maxBytes: 4096, maxRecords: 12, lockTimeoutMs: 5000 });
      if (!r.recorded) process.exit(1);
    }
  `;
  const workers = [1, 2, 3, 4].map((id) => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', workerScript, String(id)], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`Worker ${id} failed: ${code}`))));
  }));
  await Promise.all(workers);

  const lines = readFileSync(traceFile, 'utf8').split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length <= 12 && lines.length > 0);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

test('ACE instrumentation measures actual UTF-8 bytes, accurate cache states, and prevents double counting', async (t) => {
  const dir = fixture(t);
  const traceFile = join(dir, 'utf8-cache.jsonl');
  const prevEnabled = process.env.AFYX_TRACE_ENABLED;
  const prevFile = process.env.AFYX_TRACE_FILE;
  process.env.AFYX_TRACE_ENABLED = '1';
  process.env.AFYX_TRACE_FILE = traceFile;
  t.after(() => {
    if (prevEnabled === undefined) delete process.env.AFYX_TRACE_ENABLED;
    else process.env.AFYX_TRACE_ENABLED = prevEnabled;
    if (prevFile === undefined) delete process.env.AFYX_TRACE_FILE;
    else process.env.AFYX_TRACE_FILE = prevFile;
  });

  const engine = new AfyxContextEngine({ stateDir: join(dir, 'state'), ownerId: 'o1', sessionId: 's1' });
  const unicodeText = 'Halo 🚀 日本語 ' + 'α'.repeat(300);
  // First call: budget fits -> miss (no reference)
  const r1 = engine.reduce({ segments: [{ id: 'u1', content: unicodeText }], budgetChars: 2000 });
  assert.equal(r1.mode, 'optimized');
  // Second call: repeated digest -> reference hit!
  const r2 = engine.reduce({ segments: [{ id: 'u1', content: unicodeText }], budgetChars: 2000 });
  assert.equal(r2.items[0].disposition, 'reference');
  assert.equal(r2.items[0].reason, 'repeated');
  // Retrieve call
  const retrieved = engine.retrieve(r2.items[0].reference);
  assert.equal(retrieved, unicodeText);

  // Runtime workflow generates primary + component traces without double counting
  const installRoot = join(dir, 'empty-install');
  mkdirSync(installRoot, { recursive: true });
  await runInstalledAfyxWorkflow({ installRoot, projectRoot: dir, task: { prompt: 'hello' } });

  // Secret leakage check & metric validation
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
  recordInvocationTrace({ component: `x-${secret}`, operation: 'op', status: 'success' });

  const read = readInvocationTraces({ traceFile });
  assert.equal(JSON.stringify(read).includes(secret), false);
  const aceReduce1 = read.records[0];
  assert.equal(aceReduce1.cache, 'miss');
  assert.ok(aceReduce1.inputBytes > unicodeText.length, 'UTF-8 bytes must exceed JS char length for multibyte text');
  assert.equal(read.records[1].cache, 'hit');
  assert.equal(read.records[2].operation, 'retrieve');
  assert.equal(read.records[2].aceCost.retrievedBytes, Buffer.byteLength(unicodeText, 'utf8'));

  // Double-counting check: primary + component subspan with shared invocationId
  const pid = 'primary-parent-1';
  recordInvocationTrace({ invocationId: pid, aggregationRole: 'primary', component: 'afyx-runtime', operation: 'wf', status: 'success', inputBytes: 100, outputBytes: 50 });
  recordInvocationTrace({ parentInvocationId: pid, aggregationRole: 'component', component: 'afyx-graph', operation: 'explore', status: 'success', inputBytes: 100, outputBytes: 50 });
  const summary = summarizeInvocationTraces({ traceFile });
  assert.ok(summary.byComponent['afyx-runtime'] >= 1);
  // Ensure the component subspan for pid did not add another 100 inputBytes
  const withoutSubspan = read.records.reduce((s, r) => s + (r.inputBytes ?? 0), 0) + 100;
  assert.equal(summary.inputBytesTotal, withoutSubspan);
});

test('afyx trace and afyx trace summary CLI options parse and execute cleanly', (t) => {
  const dir = fixture(t);
  const traceFile = join(dir, 'cli-trace.jsonl');
  recordInvocationTrace({
    component: 'afyx-context',
    operation: 'reduce',
    status: 'success',
    durationMs: 4.2,
    inputBytes: 500,
    outputBytes: 200,
    cache: 'miss',
  }, { enabled: true, traceFile });

  const parsedList = parseCliArgs(['trace', '--trace-file', traceFile, '--limit', '10', '--json']);
  assert.deepEqual(parsedList.errors, []);
  assert.equal(parsedList.command, 'trace');

  const parsedSummary = parseCliArgs(['trace', 'summary', '--trace-file', traceFile, '--json']);
  assert.deepEqual(parsedSummary.errors, []);
  assert.equal(parsedSummary.options.traceSubcommand, 'summary');

  const here = dirname(fileURLToPath(import.meta.url));
  const cliPath = resolve(here, '..', '..', 'bin', 'afyx-engineering-kit.mjs');
  const run = spawnSync(process.execPath, [cliPath, 'trace', 'summary', '--trace-file', traceFile, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.contract, TRACE_CONTRACT);
  assert.equal(payload.count, 1);
  assert.equal(payload.actualTokensTotal, null);
});
