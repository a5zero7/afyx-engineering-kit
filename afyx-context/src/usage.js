/** AFYX usage evidence normalization. No log discovery, background tracker or invented prices. */
export const USAGE_CONTRACT = 'afyx-usage/v1';
const COUNTERS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'costUsd'];
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function identity(value) { return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/.test(value); }

export function normalizeUsageEvent(event = {}) {
  if (!['provider', 'sessionId', 'eventId', 'source'].every((field) => identity(event[field])) || !['delta', 'cumulative'].includes(event.mode)
    || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0 || (event.model != null && !identity(event.model))) fail('USAGE_INVALID_EVENT');
  const normalized = { contract: USAGE_CONTRACT, provider: event.provider, sessionId: event.sessionId, eventId: event.eventId, source: event.source,
    timestamp: event.timestamp, mode: event.mode, model: typeof event.model === 'string' ? event.model : null };
  for (const field of COUNTERS) {
    const value = event[field] ?? null;
    if (value !== null && (!Number.isFinite(value) || value < 0 || (field !== 'costUsd' && !Number.isSafeInteger(value)))) fail('USAGE_INVALID_COUNT');
    normalized[field] = value;
  }
  if (normalized.inputTokens !== null && normalized.cachedInputTokens !== null && normalized.cachedInputTokens > normalized.inputTokens) fail('USAGE_INVALID_COUNT');
  if (COUNTERS.every((field) => normalized[field] === null)) fail('USAGE_MISSING_DATA');
  normalized.costKind = normalized.costUsd === null ? 'unknown' : 'reported';
  return Object.freeze(normalized);
}

export function createUsageAnalytics({ enabled = true, maxEvents = 10_000 } = {}) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 100_000) fail('USAGE_INVALID_LIMIT');
  const records = new Map();
  const modes = new Map();
  let duplicates = 0, dropped = 0;
  function record(event) {
    if (!enabled) return { status: 'DISABLED' };
    const normalized = normalizeUsageEvent(event);
    const key = JSON.stringify([normalized.provider, normalized.sessionId, normalized.eventId]);
    if (records.has(key)) {
      if (JSON.stringify(records.get(key)) !== JSON.stringify(normalized)) fail('USAGE_EVENT_CONFLICT');
      duplicates++; return { status: 'DUPLICATE', event: normalized };
    }
    const streamKey = JSON.stringify([normalized.provider, normalized.sessionId]);
    const stream = modes.get(streamKey);
    if (stream && stream.mode !== normalized.mode) fail('USAGE_MODE_CONFLICT');
    modes.set(streamKey, { mode: normalized.mode, count: (stream?.count || 0) + 1 });
    records.set(key, normalized);
    while (records.size > maxEvents) {
      const oldestKey = records.keys().next().value, oldest = records.get(oldestKey);
      const oldestStreamKey = JSON.stringify([oldest.provider, oldest.sessionId]);
      const oldestStream = modes.get(oldestStreamKey);
      if (--oldestStream.count === 0) modes.delete(oldestStreamKey);
      records.delete(oldestKey); dropped++;
    }
    return { status: 'RECORDED', event: normalized };
  }
  function summarize({ provider, sessionId } = {}) {
    if (!enabled) return { contract: USAGE_CONTRACT, status: 'DISABLED', events: 0, totals: Object.fromEntries([...COUNTERS, 'totalTokens'].map((field) => [field, null])) };
    const selected = [...records.values()].filter((event) => (provider === undefined || event.provider === provider) && (sessionId === undefined || event.sessionId === sessionId))
      .sort((a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId));
    const streams = new Map(), anomalies = [];
    for (const event of selected) {
      const key = JSON.stringify([event.provider, event.sessionId]);
      if (!streams.has(key)) streams.set(key, []);
      streams.get(key).push(event);
    }
    const totals = Object.fromEntries(COUNTERS.map((field) => [field, selected.length ? 0 : null]));
    for (const events of streams.values()) {
      for (const field of COUNTERS) {
        let value = events[0].mode === 'cumulative' ? null : 0;
        let lastSeen = null;
        let known = true;
        for (const event of events) {
          const next = event[field];
          if (event.mode === 'delta') {
            if (next === null) known = false;
            else value += next;
          } else if (next !== null) {
            if (lastSeen !== null && next < lastSeen) { known = false; anomalies.push({ provider: event.provider, sessionId: event.sessionId, eventId: event.eventId, field, code: 'COUNTER_DECREASE' }); }
            lastSeen = next;
            value = next;
          } else value = null;
          if (value !== null && (field === 'costUsd' ? !Number.isFinite(value) : !Number.isSafeInteger(value))) fail('USAGE_TOTAL_OVERFLOW');
        }
        if (!known || value === null) totals[field] = null;
        else if (totals[field] !== null) totals[field] += value;
      }
    }
    totals.totalTokens = totals.inputTokens !== null && totals.outputTokens !== null ? totals.inputTokens + totals.outputTokens : null;
    for (const field of COUNTERS) if (totals[field] !== null && (field === 'costUsd' ? !Number.isFinite(totals[field]) : !Number.isSafeInteger(totals[field]))) fail('USAGE_TOTAL_OVERFLOW');
    if (totals.totalTokens !== null && !Number.isSafeInteger(totals.totalTokens)) fail('USAGE_TOTAL_OVERFLOW');
    return { contract: USAGE_CONTRACT, status: anomalies.length ? 'DEGRADED' : 'OK', events: selected.length, sessions: streams.size,
      providers: [...new Set(selected.map((event) => event.provider))], models: [...new Set(selected.map((event) => event.model).filter(Boolean))],
      totals, costKind: totals.costUsd === null ? 'unknown' : 'reported', duplicates, droppedEvents: dropped, anomalies,
      sources: [...new Set(selected.map((event) => event.source))] };
  }
  return Object.freeze({ record, summarize, clear: () => { records.clear(); modes.clear(); duplicates = 0; dropped = 0; } });
}
