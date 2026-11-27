import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  USAGE_CONTRACT,
  normalizeUsageEvent,
  createUsageAnalytics,
  collectCodexLocalUsage,
  collectClaudeLocalUsage,
  collectAntigravityLocalUsage,
  aggregateUsage,
} from '../src/index.js';

function createTempDir(prefix = 'afyx-usage-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('collectCodexLocalUsage extracts valid usage from latest snapshot and rollouts', (t) => {
  const root = createTempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const toolsDir = path.join(root, 'tools');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  // 1. Create a synthetic latest.json
  const latestPath = path.join(toolsDir, 'codex-usage-latest.json');
  fs.writeFileSync(latestPath, JSON.stringify({
    completed_at: '2026-11-20T08:00:00.000Z',
    model: 'gpt-5.6-sol',
    input_tokens: 120,
    cached_input_tokens: 50,
    cache_write_input_tokens: 10,
    output_tokens: 30,
    total_tokens: 150,
    api_equivalent_cost: 0.00065,
    session_file: 'rollout-2026-11-20T08-00-00-sessionA.jsonl',
    turn_id: 'turn-latest',
  }), 'utf8');

  // 2. Create a rollout file with telemetry lines
  const rolloutPath = path.join(sessionsDir, 'rollout-2026-11-20T08-00-00-sessionB.jsonl');
  const lines = [
    JSON.stringify({ type: 'turn_context', turn_id: 'turn-1', model: 'gpt-5.6-sol', timestamp: '2026-11-20T08:05:00.000Z' }),
    JSON.stringify({
      type: 'token_usage_record',
      turn_id: 'turn-1',
      usage: { input_tokens: 200, output_tokens: 50, cached_input_tokens: 80, cache_write_input_tokens: 0, total_tokens: 250 },
      timestamp: '2026-11-20T08:05:05.000Z',
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn-1', completed_at: '2026-11-20T08:05:10.000Z' },
    }),
  ];
  fs.writeFileSync(rolloutPath, lines.join('\n'), 'utf8');

  const result = collectCodexLocalUsage({
    codexHome: root,
    sessionRoot: sessionsDir,
    latestUsagePath: latestPath,
  });

  assert.equal(result.contract, USAGE_CONTRACT);
  assert.equal(result.status, 'OK');
  assert.equal(result.count, 2);

  const eventLatest = result.events.find((e) => e.eventId === 'turn-latest');
  assert.ok(eventLatest);
  assert.equal(eventLatest.provider, 'codex');
  assert.equal(eventLatest.model, 'gpt-5.6-sol');
  assert.equal(eventLatest.inputTokens, 120);
  assert.equal(eventLatest.outputTokens, 30);
  assert.equal(eventLatest.cachedInputTokens, 50);
  assert.equal(eventLatest.costUsd, 0.00065);
  assert.equal(eventLatest.costKind, 'reported');

  const eventTurn1 = result.events.find((e) => e.eventId === 'turn-1');
  assert.ok(eventTurn1);
  assert.equal(eventTurn1.provider, 'codex');
  assert.equal(eventTurn1.model, 'gpt-5.6-sol');
  assert.equal(eventTurn1.inputTokens, 200);
  assert.equal(eventTurn1.outputTokens, 50);
  assert.equal(eventTurn1.costUsd, null);
  assert.equal(eventTurn1.costKind, 'unknown');
});

test('collectCodexLocalUsage deduplicates identical turns across sources and respects disabled state', (t) => {
  const root = createTempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const toolsDir = path.join(root, 'tools');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  const latestPath = path.join(toolsDir, 'codex-usage-latest.json');
  fs.writeFileSync(latestPath, JSON.stringify({
    completed_at: '2026-11-20T09:00:00.000Z',
    model: 'gpt-5.6-sol',
    input_tokens: 100,
    output_tokens: 20,
    session_file: 'rollout-sessionA.jsonl',
    turn_id: 'turn-dup',
  }), 'utf8');

  // Same session and turnId in rollout
  const rolloutPath = path.join(sessionsDir, 'rollout-sessionA.jsonl');
  const lines = [
    JSON.stringify({ type: 'turn_context', turn_id: 'turn-dup', model: 'gpt-5.6-sol' }),
    JSON.stringify({
      type: 'token_usage_record',
      turn_id: 'turn-dup',
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn-dup' },
    }),
  ];
  fs.writeFileSync(rolloutPath, lines.join('\n'), 'utf8');

  const result = collectCodexLocalUsage({
    codexHome: root,
    sessionRoot: sessionsDir,
    latestUsagePath: latestPath,
  });

  assert.equal(result.count, 1, 'Should deduplicate turn present in both latest and rollout');

  // When disabled
  const disabled = collectCodexLocalUsage({ enabled: false });
  assert.equal(disabled.status, 'DISABLED');
  assert.equal(disabled.events.length, 0);
});

test('collectCodexLocalUsage handles missing, corrupted, or unreadable files cleanly without throwing', (t) => {
  const root = createTempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const toolsDir = path.join(root, 'tools');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Corrupted latest.json
  fs.writeFileSync(path.join(toolsDir, 'codex-usage-latest.json'), '{ invalid json ...', 'utf8');
  // Corrupted rollout
  fs.writeFileSync(path.join(sessionsDir, 'rollout-corrupt.jsonl'), 'not valid json\n{ neither is this', 'utf8');

  const result = collectCodexLocalUsage({
    codexHome: root,
    sessionRoot: sessionsDir,
    latestUsagePath: path.join(toolsDir, 'codex-usage-latest.json'),
  });

  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.reason, 'INCOMPLETE_COVERAGE');
  assert.ok(result.coverage.malformed >= 1);
  assert.equal(result.count, 0, 'Corrupt files should be skipped cleanly');
});

test('collectCodexLocalUsage sums multiple incremental usage records per turn and selects newest files before maxFiles', (t) => {
  const root = createTempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const oldPath = path.join(sessionsDir, 'rollout-2026-11-01T01-00-00-old.jsonl');
  fs.writeFileSync(oldPath, JSON.stringify({
    type: 'token_usage_record', turn_id: 'turn-old',
    usage: { input_tokens: 10, output_tokens: 5 },
  }), 'utf8');
  fs.utimesSync(oldPath, new Date('2026-11-01T01:00:00Z'), new Date('2026-11-01T01:00:00Z'));

  const newPath = path.join(sessionsDir, 'rollout-2026-11-20T09-00-00-new.jsonl');
  fs.writeFileSync(newPath, [
    JSON.stringify({ type: 'turn_context', turn_id: 'turn-multi', model: 'gpt-5.6-sol', timestamp: '2026-11-20T09:00:00.000Z' }),
    JSON.stringify({ type: 'token_usage_record', turn_id: 'turn-multi', usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40 } }),
    JSON.stringify({ type: 'token_usage_record', turn_id: 'turn-multi', usage: { input_tokens: 50, output_tokens: 15, cached_input_tokens: 10 } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-multi', completed_at: '2026-11-20T09:01:00.000Z' } }),
  ].join('\n'), 'utf8');
  fs.utimesSync(newPath, new Date('2026-11-20T09:01:00Z'), new Date('2026-11-20T09:01:00Z'));

  const result = collectCodexLocalUsage({
    codexHome: root,
    sessionRoot: sessionsDir,
    latestUsagePath: path.join(root, 'missing-latest.json'),
    maxFiles: 1,
  });

  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.coverage.bounded, true);
  assert.equal(result.count, 1);
  assert.equal(result.events[0].eventId, 'turn-multi');
  assert.equal(result.events[0].inputTokens, 150);
  assert.equal(result.events[0].outputTokens, 35);
  assert.equal(result.events[0].cachedInputTokens, 50);
});

test('Claude and Antigravity collectors truthfully report NOT_AVAILABLE without inventing telemetry', () => {
  const claudeResult = collectClaudeLocalUsage();
  assert.equal(claudeResult.status, 'NOT_AVAILABLE');
  assert.equal(claudeResult.provider, 'claude');
  assert.equal(claudeResult.events.length, 0);
  assert.equal(claudeResult.reason, 'PROVIDER_TELEMETRY_UNCONFIGURED');

  const agyResult = collectAntigravityLocalUsage();
  assert.equal(agyResult.status, 'NOT_AVAILABLE');
  assert.equal(agyResult.provider, 'antigravity');
  assert.equal(agyResult.events.length, 0);
  assert.equal(agyResult.reason, 'PROVIDER_TELEMETRY_UNCONFIGURED');
});

test('aggregateUsage performs bounded aggregation by day, week, month, and total', () => {
  const events = [
    normalizeUsageEvent({
      provider: 'codex',
      sessionId: 'sess-1',
      eventId: 'evt-1',
      source: 'codex-rollout',
      timestamp: Date.parse('2026-11-16T10:00:00.000Z'), // Monday
      mode: 'delta',
      model: 'gpt-5.6-sol',
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 50,
      costUsd: 0.0005,
    }),
    normalizeUsageEvent({
      provider: 'codex',
      sessionId: 'sess-1',
      eventId: 'evt-2',
      source: 'codex-rollout',
      timestamp: Date.parse('2026-11-16T12:00:00.000Z'), // Same day
      mode: 'delta',
      model: 'gpt-5.6-sol',
      inputTokens: 200,
      outputTokens: 40,
      cachedInputTokens: 80,
      costUsd: 0.0010,
    }),
    normalizeUsageEvent({
      provider: 'codex',
      sessionId: 'sess-2',
      eventId: 'evt-3',
      source: 'codex-rollout',
      timestamp: Date.parse('2026-11-20T10:00:00.000Z'), // Different day, same week/month
      mode: 'delta',
      model: 'gpt-5.6-sol',
      inputTokens: 300,
      outputTokens: 60,
      cachedInputTokens: null,
      costUsd: null,
    }),
  ];

  // 1. Daily aggregation
  const daily = aggregateUsage(events, { period: 'day' });
  assert.equal(daily.status, 'OK');
  assert.equal(daily.groups.length, 2);
  const day1 = daily.groups.find((g) => g.periodKey === '2026-11-16');
  assert.ok(day1);
  assert.equal(day1.eventCount, 2);
  assert.equal(day1.totals.inputTokens, 300);
  assert.equal(day1.totals.outputTokens, 60);
  assert.equal(day1.totals.totalTokens, 360);
  assert.equal(day1.totals.cachedInputTokens, 130);
  assert.ok(Math.abs(day1.totals.costUsd - 0.0015) < 1e-6);
  assert.equal(day1.costKind, 'reported');

  const day2 = daily.groups.find((g) => g.periodKey === '2026-11-20');
  assert.ok(day2);
  assert.equal(day2.eventCount, 1);
  assert.equal(day2.totals.inputTokens, 300);
  assert.equal(day2.totals.outputTokens, 60);
  assert.equal(day2.totals.totalTokens, 360);
  assert.equal(day2.totals.cachedInputTokens, null, 'Null cached count stays null');
  assert.equal(day2.totals.costUsd, null, 'Null cost stays null');
  assert.equal(day2.costKind, 'unknown');

  // 2. Weekly aggregation
  const weekly = aggregateUsage(events, { period: 'week' });
  assert.equal(weekly.groups.length, 1, 'All events in week 47 of 2026');
  assert.equal(weekly.groups[0].eventCount, 3);
  assert.equal(weekly.groups[0].totals.inputTokens, 600);
  assert.equal(weekly.groups[0].totals.outputTokens, 120);
  assert.equal(weekly.groups[0].totals.totalTokens, 720);

  // 3. Monthly aggregation
  const monthly = aggregateUsage(events, { period: 'month' });
  assert.equal(monthly.groups.length, 1);
  assert.equal(monthly.groups[0].periodKey, '2026-11');
  assert.equal(monthly.groups[0].totals.totalTokens, 720);

  // 4. Total aggregation
  const total = aggregateUsage(events, { period: 'total' });
  assert.equal(total.groups.length, 1);
  assert.equal(total.groups[0].periodKey, 'all-time');
  assert.equal(total.groups[0].totals.totalTokens, 720);
});

test('aggregateUsage idempotently deduplicates repeated events without double-counting', () => {
  const event1 = normalizeUsageEvent({
    provider: 'codex',
    sessionId: 'sess-1',
    eventId: 'evt-repeat',
    source: 'codex-rollout',
    timestamp: Date.parse('2026-11-20T10:00:00.000Z'),
    mode: 'delta',
    model: 'gpt-5.6-sol',
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.0005,
  });

  const aggregate = aggregateUsage([event1, event1, event1], { period: 'day' });
  assert.equal(aggregate.totalEvents, 3);
  assert.equal(aggregate.uniqueEvents, 1);
  assert.equal(aggregate.groups[0].eventCount, 1);
  assert.equal(aggregate.groups[0].totals.inputTokens, 100);
  assert.equal(aggregate.groups[0].totals.outputTokens, 20);
  assert.equal(aggregate.groups[0].totals.totalTokens, 120);
});

test('aggregateUsage respects IANA timezone boundaries for daily grouping', () => {
  const event = normalizeUsageEvent({
    provider: 'codex',
    sessionId: 'sess-tz',
    eventId: 'evt-tz',
    source: 'codex-rollout',
    timestamp: Date.parse('2026-11-20T20:00:00.000Z'), // 2026-11-21T03:00:00+07:00 in Asia/Jakarta
    mode: 'delta',
    model: 'gpt-5.6-sol',
    inputTokens: 40,
    outputTokens: 10,
  });

  const utc = aggregateUsage([event], { period: 'day', timezone: 'UTC' });
  const jakarta = aggregateUsage([event], { period: 'day', timezone: 'Asia/Jakarta' });
  assert.equal(utc.groups[0].periodKey, '2026-11-20');
  assert.equal(jakarta.groups[0].periodKey, '2026-11-21');
});
