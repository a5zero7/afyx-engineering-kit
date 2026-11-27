/** Copyright (c) 2026 Afyx */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  AfyxContextEngine,
  TRACE_CONTRACT,
  isTraceEnabled,
  recordInvocationTrace,
  readInvocationTraces,
  summarizeInvocationTraces,
} from '../../afyx-context/src/index.js';
import { parseCliArgs } from '../afyx-npm-installer.mjs';

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

test('invocation trace redacts secrets, enforces bounded retention, and separates actual vs estimated tokens', (t) => {
  const dir = fixture(t);
  const traceFile = join(dir, 'invocations.jsonl');

  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
  const rec = recordInvocationTrace({
    component: `afyx-graph-${secret}`,
    operation: 'explore',
    status: 'success',
    durationMs: 12.3456,
    inputBytes: 256,
    outputBytes: 128,
    actualTokens: null,
    estimatedTokens: { input: 64, output: 32, total: 96, method: 'chars/4' },
    cache: 'hit',
    runtimePrepMs: 1.5,
    graphEvidence: { freshness: 'fresh', extractionCapability: 'typescript' },
  }, { enabled: true, traceFile });

  assert.equal(rec.contract, TRACE_CONTRACT);
  assert.equal(rec.status, 'OK');
  assert.equal(rec.recorded, true);

  const read = readInvocationTraces({ traceFile });
  assert.equal(read.status, 'OK');
  assert.equal(read.count, 1);
  assert.equal(JSON.stringify(read).includes(secret), false);
  assert.equal(read.records[0].actualTokens, null);
  assert.equal(read.records[0].estimatedTokens.total, 96);
  assert.equal(read.records[0].cache, 'hit');
  assert.equal(read.records[0].graphEvidence.freshness, 'fresh');

  // Bounded retention check
  for (let i = 0; i < 20; i++) {
    recordInvocationTrace({
      component: 'afyx-context',
      operation: 'reduce',
      status: 'success',
      durationMs: 1 + i,
      inputBytes: 100,
      outputBytes: 50,
    }, { enabled: true, traceFile, maxBytes: 1200, maxRecords: 6 });
  }
  assert.ok(statSync(traceFile).size <= 1600);
  const summary = summarizeInvocationTraces({ traceFile });
  assert.equal(summary.status, 'OK');
  assert.ok(summary.count <= 6);
  assert.ok(summary.durationMs.p50 !== null);
  assert.ok(summary.durationMs.p95 !== null);
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
