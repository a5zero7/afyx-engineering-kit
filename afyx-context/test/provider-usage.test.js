import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectClaudeLocalUsage, collectAntigravityLocalUsage } from '../src/collector.js';
import { createUsageAnalytics } from '../src/usage.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'afyx-provider-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const date = '2026-02-01T12:00:00.000Z';
const session = 'private-session-identifier';
const usage = { input_tokens: 5, cache_read_input_tokens: 12, cache_creation_input_tokens: 3, output_tokens: 4 };
const assistant = (id, value = usage, extra = {}) => ({
  type: 'assistant', sessionId: session, timestamp: date,
  message: { role: 'assistant', id, model: 'claude-fixture', usage: value,
    content: [{ text: 'fixture private prompt and response' }] }, ...extra,
});
const lines = records => records.map(record => JSON.stringify(record) + '\n').join('');

test('Claude deduplicates message snapshots, continuation, and subagents while preserving counters', t => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'a.jsonl'), lines([assistant('msg-a'), assistant('msg-a', { ...usage, output_tokens: 8 })]));
  mkdirSync(join(dir, 'subagents'));
  writeFileSync(join(dir, 'subagents', 'agent.jsonl'), lines([assistant('msg-child')]));
  writeFileSync(join(dir, 'b.jsonl'), lines([assistant('msg-a'), assistant('msg-side', usage, { isSidechain: true })]) + '{\n{"truncated"');
  const result = collectClaudeLocalUsage({ providerRoot: dir, authorized: true });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.activity.sessions, 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.coverage.duplicates, 2);
  assert.equal(result.coverage.malformed, 2);
  const event = result.events[0];
  assert.equal(event.inputTokens, 17);
  assert.equal(event.cachedInputTokens, 12);
  assert.equal(event.cacheWriteInputTokens, 3);
  assert.equal(event.outputTokens, 8);
  const analytics = createUsageAnalytics();
  assert.equal(analytics.record(event).status, 'RECORDED');
  assert.equal(analytics.record(event).status, 'DUPLICATE');
  const serialized = JSON.stringify(result);
  for (const secret of [session, dir, 'msg-a', 'fixture private prompt and response']) assert.ok(!serialized.includes(secret));
});

test('Claude missing fields, unauthorized roots, links and resource limits fail closed', t => {
  const dir = fixture(t), outside = fixture(t);
  writeFileSync(join(dir, 'metadata.jsonl'), lines([assistant('no-counts', {})]));
  writeFileSync(join(outside, 'never.jsonl'), lines([assistant('never')]));
  symlinkSync(outside, join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(collectClaudeLocalUsage({ providerRoot: dir }).status, 'NOT_AVAILABLE');
  assert.equal(collectClaudeLocalUsage({ providerRoot: join(dir, 'linked'), authorized: true }).events.length, 0);
  assert.equal(collectClaudeLocalUsage({ providerRoot: dir, authorized: true }).status, 'UNMEASURED');
  assert.equal(collectClaudeLocalUsage({ providerRoot: join(dir, 'absent'), authorized: true }).status, 'NOT_AVAILABLE');
  const bounded = collectClaudeLocalUsage({ providerRoot: dir, authorized: true, signal: AbortSignal.abort() });
  assert.equal(bounded.coverage.bounded, true);
  assert.equal(bounded.coverage.bytes, 0);
});

test('Gemini CLI session format preserves measured zero and rejects unknown or patch journals', t => {
  const dir = fixture(t);
  const head = { sessionId: session, projectHash: 'fixture', startTime: date };
  const message = { id: 'gemini-msg', type: 'gemini', model: 'gemini-fixture', timestamp: date,
    tokens: { input: 0, output: 0, cached: 0 }, content: 'private response' };
  writeFileSync(join(dir, 'session-a.json'), JSON.stringify({ ...head, messages: [message] }));
  writeFileSync(join(dir, 'session-b.jsonl'), lines([head, message]));
  writeFileSync(join(dir, 'session-c.jsonl'), lines([head, { ...message, id: 'ambiguous' }, { $rewindTo: 'ambiguous' }]));
  assert.equal(collectAntigravityLocalUsage({ providerRoot: dir, authorized: true }).status, 'NOT_AVAILABLE');
  const result = collectAntigravityLocalUsage({ providerRoot: dir, authorized: true, format: 'gemini-cli-chat/v1' });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].provider, 'antigravity');
  assert.equal(result.events[0].inputTokens, 0);
  assert.equal(result.events[0].outputTokens, 0);
  assert.equal(result.coverage.duplicates, 1);
  assert.ok(!JSON.stringify(result).includes('private response'));
});

test('contradictory Claude counter snapshots withhold the event', t => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'metadata.jsonl'), lines([
    assistant('conflict'),
    assistant('conflict', { ...usage, input_tokens: 6 }, { timestamp: '2026-02-01T12:00:01.000Z' }),
    assistant('valid'),
  ]));
  const report = collectClaudeLocalUsage({ providerRoot: dir, authorized: true });
  assert.equal(report.status, 'PARTIAL');
  assert.equal(report.coverage.conflicts, 1);
  assert.equal(report.events.length, 1);
  assert.equal(collectClaudeLocalUsage({ providerRoot: dir, authorized: true, maxRecords: 1 }).coverage.bounded, true);
});
