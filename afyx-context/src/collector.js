import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { collectProviderUsage } from './provider-usage.js';
import { USAGE_CONTRACT, normalizeUsageEvent } from './usage.js';

function fail(code, message) {
  const error = new Error(message ? `${code}: ${message}` : code);
  error.code = code;
  throw error;
}

function safeId(value, fallback = 'unknown') {
  if (typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/.test(value)) {
    return value;
  }
  return fallback;
}

function formatPeriodKey(timestampMs, period) {
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return 'unknown-period';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');

  if (period === 'month') {
    return `${y}-${m}`;
  }
  if (period === 'week') {
    // ISO 8601 week number calculation in UTC
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = target.getTime();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
      target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
    }
    const weekNr = 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
    return `${y}-W${String(weekNr).padStart(2, '0')}`;
  }
  if (period === 'total') {
    return 'all-time';
  }
  // default: day
  return `${y}-${m}-${day}`;
}

export function collectCodexLocalUsage(options = {}) {
  const {
    codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
    sessionRoot = join(codexHome, 'sessions'),
    latestUsagePath = join(codexHome, 'tools', 'codex-usage-latest.json'),
    maxFiles = 100,
    maxEvents = 10_000,
    enabled = true,
  } = options;

  if (!enabled) {
    return { contract: USAGE_CONTRACT, provider: 'codex', status: 'DISABLED', events: [] };
  }

  const collectedEvents = [];
  const seenKeys = new Set();

  function pushEvent(raw) {
    if (collectedEvents.length >= maxEvents) return false;
    try {
      const normalized = normalizeUsageEvent(raw);
      const key = `${normalized.provider}:${normalized.sessionId}:${normalized.eventId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        collectedEvents.push(normalized);
        return true;
      }
    } catch {
      // Skip invalid or unclassifiable event cleanly
    }
    return false;
  }

  // 1. Ingest codex-usage-latest.json if available
  if (latestUsagePath && existsSync(latestUsagePath)) {
    try {
      const stat = statSync(latestUsagePath);
      if (stat.isFile() && stat.size > 0 && stat.size <= 1_048_576) {
        const content = readFileSync(latestUsagePath, 'utf8');
        const parsed = JSON.parse(content);
        const completedAtMs = parsed.completed_at ? Date.parse(parsed.completed_at) : null;
        const timestamp = Number.isSafeInteger(completedAtMs) && completedAtMs > 0 ? completedAtMs : Math.floor(stat.mtimeMs);

        const rawSessionFile = typeof parsed.session_file === 'string' ? basename(parsed.session_file) : 'latest-session';
        const sessionMatch = rawSessionFile.match(/rollout-(?:[\d-]+T[\d-]+-)?([a-zA-Z0-9_-]+)(?:\.jsonl)?/);
        const sessionId = safeId(sessionMatch ? sessionMatch[1] : rawSessionFile.replace(/\.jsonl$/, ''));
        const eventId = safeId(parsed.turn_id, 'latest-turn');

        const inputTokens = Number.isSafeInteger(parsed.input_tokens) && parsed.input_tokens >= 0 ? parsed.input_tokens : null;
        const outputTokens = Number.isSafeInteger(parsed.output_tokens) && parsed.output_tokens >= 0 ? parsed.output_tokens : null;
        const cachedInputTokens = Number.isSafeInteger(parsed.cached_input_tokens) && parsed.cached_input_tokens >= 0 ? parsed.cached_input_tokens : null;
        const cacheWriteInputTokens = Number.isSafeInteger(parsed.cache_write_input_tokens) && parsed.cache_write_input_tokens >= 0 ? parsed.cache_write_input_tokens : null;

        const costUsd = typeof parsed.api_equivalent_cost === 'number' && Number.isFinite(parsed.api_equivalent_cost) && parsed.api_equivalent_cost >= 0
          ? parsed.api_equivalent_cost
          : null;

        if (inputTokens !== null || outputTokens !== null) {
          pushEvent({
            contract: USAGE_CONTRACT,
            provider: 'codex',
            sessionId,
            eventId,
            source: 'codex-latest',
            timestamp,
            mode: 'delta',
            model: typeof parsed.model === 'string' ? parsed.model : null,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            cacheWriteInputTokens,
            costUsd,
          });
        }
      }
    } catch {
      // Diagnostic safe ignore: corrupt or inaccessible latest.json must not fail collection
    }
  }

  // 2. Scan session rollouts in sessionRoot if directory exists
  if (sessionRoot && existsSync(sessionRoot)) {
    try {
      const rootStat = statSync(sessionRoot);
      if (rootStat.isDirectory()) {
        const rolloutFiles = [];

        function scanSessionDir(dir, depth = 0) {
          if (depth > 3 || rolloutFiles.length >= maxFiles) return;
          const entries = readdirSync(dir);
          for (const entry of entries) {
            if (rolloutFiles.length >= maxFiles) break;
            const fullPath = join(dir, entry);
            try {
              const st = statSync(fullPath);
              if (st.isDirectory()) {
                scanSessionDir(fullPath, depth + 1);
              } else if (st.isFile() && entry.startsWith('rollout-') && entry.endsWith('.jsonl')) {
                rolloutFiles.push({ path: fullPath, mtimeMs: st.mtimeMs, size: st.size });
              }
            } catch {
              // skip unreadable file
            }
          }
        }

        scanSessionDir(sessionRoot);
        // Sort by modification time descending
        rolloutFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

        for (const fileInfo of rolloutFiles) {
          if (collectedEvents.length >= maxEvents) break;
          // Guard against excessively large telemetry files (max 10MB)
          if (fileInfo.size > 10_485_760) continue;

          try {
            const fileContent = readFileSync(fileInfo.path, 'utf8');
            const lines = fileContent.split(/\r?\n/);
            const fileName = basename(fileInfo.path);
            const match = fileName.match(/rollout-(?:[\d-]+T[\d-]+-)?([a-zA-Z0-9_-]+)\.jsonl/);
            const sessionId = safeId(match ? match[1] : fileName.replace(/\.jsonl$/, ''));

            const turnContexts = new Map(); // turnId -> { model, timestamp }
            const turnUsages = new Map(); // turnId -> usage object
            const turnCompletions = new Map(); // turnId -> completedAt

            for (const line of lines) {
              if (!line || line.length > 65_536 || !line.includes('"type"')) continue;
              // Strict schema allowlist: never inspect message content or tools
              try {
                const record = JSON.parse(line);
                const type = record.type;
                const payload = record.payload || {};
                const eventTimestamp = record.timestamp ? Date.parse(record.timestamp) : null;

                if (type === 'turn_context') {
                  const turnId = safeId(record.turn_id || payload.turn_id, null);
                  const model = typeof (record.model || payload.model) === 'string' ? (record.model || payload.model) : null;
                  if (turnId) {
                    turnContexts.set(turnId, { model, timestamp: eventTimestamp });
                  }
                } else if (type === 'token_usage_record') {
                  const turnId = safeId(record.turn_id || payload.turn_id, null);
                  const usage = record.usage || payload.usage;
                  if (turnId && usage && typeof usage === 'object') {
                    turnUsages.set(turnId, {
                      input_tokens: usage.input_tokens,
                      output_tokens: usage.output_tokens,
                      cached_input_tokens: usage.cached_input_tokens,
                      cache_write_input_tokens: usage.cache_write_input_tokens,
                      timestamp: eventTimestamp,
                    });
                  }
                } else if (type === 'event_msg' && payload.type === 'task_complete') {
                  const turnId = safeId(payload.turn_id, null);
                  if (turnId) {
                    const completedAt = payload.completed_at ? Date.parse(payload.completed_at) : eventTimestamp;
                    turnCompletions.set(turnId, completedAt);
                  }
                }
              } catch {
                // Skip malformed individual line safely
              }
            }

            // Synthesize completed turns into normalized events
            for (const [turnId, usage] of turnUsages.entries()) {
              if (collectedEvents.length >= maxEvents) break;
              const ctx = turnContexts.get(turnId);
              const completedAt = turnCompletions.get(turnId);
              const timestamp = Number.isSafeInteger(completedAt) && completedAt > 0
                ? completedAt
                : (Number.isSafeInteger(usage.timestamp) && usage.timestamp > 0
                  ? usage.timestamp
                  : (Number.isSafeInteger(ctx?.timestamp) && ctx.timestamp > 0
                    ? ctx.timestamp
                    : Math.floor(fileInfo.mtimeMs)));

              const inputTokens = Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0 ? usage.input_tokens : null;
              const outputTokens = Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0 ? usage.output_tokens : null;
              const cachedInputTokens = Number.isSafeInteger(usage.cached_input_tokens) && usage.cached_input_tokens >= 0 ? usage.cached_input_tokens : null;
              const cacheWriteInputTokens = Number.isSafeInteger(usage.cache_write_input_tokens) && usage.cache_write_input_tokens >= 0 ? usage.cache_write_input_tokens : null;

              if (inputTokens !== null || outputTokens !== null) {
                pushEvent({
                  contract: USAGE_CONTRACT,
                  provider: 'codex',
                  sessionId,
                  eventId: turnId,
                  source: 'codex-rollout',
                  timestamp,
                  mode: 'delta',
                  model: ctx?.model || null,
                  inputTokens,
                  outputTokens,
                  cachedInputTokens,
                  cacheWriteInputTokens,
                  costUsd: null, // rollouts lack verified billed price; cost stays null
                });
              }
            }
          } catch {
            // Ignore unreadable rollout file safely
          }
        }
      }
    } catch {
      // Ignore root session read errors
    }
  }

  return {
    contract: USAGE_CONTRACT,
    provider: 'codex',
    status: 'OK',
    count: collectedEvents.length,
    events: collectedEvents,
  };
}

export function collectClaudeLocalUsage(options = {}) {
  return collectProviderUsage('claude', options);
}

export function collectAntigravityLocalUsage(options = {}) {
  return collectProviderUsage('antigravity', options);
}

export function aggregateUsage(events = [], options = {}) {
  const {
    groupBy = ['provider', 'model'],
    period = 'day',
    timezone = 'UTC',
    maxGroups = 10_000,
  } = options;

  if (!['day', 'week', 'month', 'total'].includes(period)) {
    fail('USAGE_INVALID_PERIOD', `Unsupported aggregation period: ${period}`);
  }

  // Deduplicate events by [provider, sessionId, eventId]
  const uniqueMap = new Map();
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const key = `${raw.provider}:${raw.sessionId}:${raw.eventId}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, raw);
    }
  }

  const groupBuckets = new Map();

  for (const event of uniqueMap.values()) {
    const periodKey = formatPeriodKey(event.timestamp, period);
    const keyParts = [periodKey];
    for (const field of groupBy) {
      keyParts.push(String(event[field] ?? 'unknown'));
    }
    const bucketKey = keyParts.join('::');

    let bucket = groupBuckets.get(bucketKey);
    if (!bucket) {
      if (groupBuckets.size >= maxGroups) break;
      bucket = {
        periodKey,
        provider: event.provider || 'unknown',
        model: event.model || null,
        eventCount: 0,
        totals: {
          inputTokens: null,
          cachedInputTokens: null,
          cacheWriteInputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: null,
        },
        hasAnyInput: false,
        hasAnyOutput: false,
        hasAnyCached: false,
        hasAnyCacheWrite: false,
        hasAnyCost: false,
      };
      for (const field of groupBy) {
        if (!['provider', 'model'].includes(field)) {
          bucket[field] = event[field] ?? null;
        }
      }
      groupBuckets.set(bucketKey, bucket);
    }

    bucket.eventCount += 1;

    // Aggregate input tokens
    if (event.inputTokens !== null && Number.isSafeInteger(event.inputTokens)) {
      bucket.totals.inputTokens = (bucket.totals.inputTokens || 0) + event.inputTokens;
      bucket.hasAnyInput = true;
    }
    // Aggregate cached input
    if (event.cachedInputTokens !== null && Number.isSafeInteger(event.cachedInputTokens)) {
      bucket.totals.cachedInputTokens = (bucket.totals.cachedInputTokens || 0) + event.cachedInputTokens;
      bucket.hasAnyCached = true;
    }
    // Aggregate cache write
    if (event.cacheWriteInputTokens !== null && Number.isSafeInteger(event.cacheWriteInputTokens)) {
      bucket.totals.cacheWriteInputTokens = (bucket.totals.cacheWriteInputTokens || 0) + event.cacheWriteInputTokens;
      bucket.hasAnyCacheWrite = true;
    }
    // Aggregate output tokens
    if (event.outputTokens !== null && Number.isSafeInteger(event.outputTokens)) {
      bucket.totals.outputTokens = (bucket.totals.outputTokens || 0) + event.outputTokens;
      bucket.hasAnyOutput = true;
    }
    // Aggregate cost
    if (event.costUsd !== null && Number.isFinite(event.costUsd)) {
      bucket.totals.costUsd = (bucket.totals.costUsd || 0) + event.costUsd;
      bucket.hasAnyCost = true;
    }
  }

  const groups = [];
  for (const bucket of groupBuckets.values()) {
    // Total tokens derivation: only sum if input and output exist
    if (bucket.totals.inputTokens !== null && bucket.totals.outputTokens !== null) {
      bucket.totals.totalTokens = bucket.totals.inputTokens + bucket.totals.outputTokens;
    } else {
      bucket.totals.totalTokens = null;
    }

    groups.push({
      periodKey: bucket.periodKey,
      provider: bucket.provider,
      model: bucket.model,
      eventCount: bucket.eventCount,
      totals: {
        inputTokens: bucket.totals.inputTokens,
        cachedInputTokens: bucket.totals.cachedInputTokens,
        cacheWriteInputTokens: bucket.totals.cacheWriteInputTokens,
        outputTokens: bucket.totals.outputTokens,
        totalTokens: bucket.totals.totalTokens,
        costUsd: bucket.totals.costUsd,
      },
      costKind: bucket.hasAnyCost ? 'reported' : 'unknown',
    });
  }

  // Deterministic stable sorting
  groups.sort((a, b) => {
    if (a.periodKey !== b.periodKey) return a.periodKey.localeCompare(b.periodKey);
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return (a.model || '').localeCompare(b.model || '');
  });

  return {
    contract: USAGE_CONTRACT,
    status: 'OK',
    period,
    timezone,
    totalEvents: events.length,
    uniqueEvents: uniqueMap.size,
    groups,
  };
}
