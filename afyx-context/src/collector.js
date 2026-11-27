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

function formatPeriodKey(timestampMs, period, timezone = 'UTC') {
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return 'unknown-period';
  if (period === 'total') {
    return 'all-time';
  }
  let y, m, day;
  if (timezone === 'UTC') {
    y = d.getUTCFullYear();
    m = String(d.getUTCMonth() + 1).padStart(2, '0');
    day = String(d.getUTCDate()).padStart(2, '0');
  } else {
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d);
    } catch {
      fail('USAGE_INVALID_TIMEZONE', `Unsupported timezone: ${timezone}`);
    }
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    y = Number(map.year);
    m = map.month;
    day = map.day;
  }

  if (period === 'month') {
    return `${y}-${m}`;
  }
  if (period === 'week') {
    // ISO 8601 week number calculation for the resolved calendar date
    const target = new Date(Date.UTC(y, Number(m) - 1, Number(day)));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = target.getTime();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
      target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
    }
    const weekNr = 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
    return `${target.getUTCFullYear()}-W${String(weekNr).padStart(2, '0')}`;
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
  const coverage = { files: 0, records: 0, malformed: 0, skipped: 0, bounded: false };

  function pushEvent(raw) {
    if (collectedEvents.length >= maxEvents) {
      coverage.bounded = true;
      return false;
    }
    try {
      const normalized = normalizeUsageEvent(raw);
      const key = `${normalized.provider}:${normalized.sessionId}:${normalized.eventId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        collectedEvents.push(normalized);
        return true;
      }
    } catch {
      coverage.malformed++;
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
      } else if (stat.isFile() && stat.size > 1_048_576) {
        coverage.skipped++;
      }
    } catch {
      coverage.malformed++;
    }
  }

  // 2. Scan session rollouts in sessionRoot if directory exists
  if (sessionRoot && existsSync(sessionRoot)) {
    try {
      const rootStat = statSync(sessionRoot);
      if (rootStat.isDirectory()) {
        const rolloutFiles = [];
        const maxDiscovery = Math.max(maxFiles * 10, 2000);

        function scanSessionDir(dir, depth = 0) {
          if (depth > 3 || rolloutFiles.length >= maxDiscovery) {
            if (rolloutFiles.length >= maxDiscovery) coverage.bounded = true;
            return;
          }
          const entries = readdirSync(dir);
          for (const entry of entries) {
            if (rolloutFiles.length >= maxDiscovery) {
              coverage.bounded = true;
              break;
            }
            const fullPath = join(dir, entry);
            try {
              const st = statSync(fullPath);
              if (st.isDirectory()) {
                scanSessionDir(fullPath, depth + 1);
              } else if (st.isFile() && entry.startsWith('rollout-') && entry.endsWith('.jsonl')) {
                rolloutFiles.push({ path: fullPath, mtimeMs: st.mtimeMs, size: st.size });
              }
            } catch {
              coverage.skipped++;
            }
          }
        }

        scanSessionDir(sessionRoot);
        // Sort by modification time descending BEFORE enforcing maxFiles
        rolloutFiles.sort((a, b) => b.mtimeMs - a.mtimeMs || b.path.localeCompare(a.path));
        if (rolloutFiles.length > maxFiles) {
          coverage.bounded = true;
        }
        const selectedFiles = rolloutFiles.slice(0, maxFiles);

        for (const fileInfo of selectedFiles) {
          if (collectedEvents.length >= maxEvents) {
            coverage.bounded = true;
            break;
          }
          // Guard against excessively large telemetry files (max 10MB)
          if (fileInfo.size > 10_485_760) {
            coverage.skipped++;
            continue;
          }

          try {
            coverage.files++;
            const fileContent = readFileSync(fileInfo.path, 'utf8');
            const lines = fileContent.split(/\r?\n/);
            const fileName = basename(fileInfo.path);
            const match = fileName.match(/rollout-(?:[\d-]+T[\d-]+-)?([a-zA-Z0-9_-]+)\.jsonl/);
            const sessionId = safeId(match ? match[1] : fileName.replace(/\.jsonl$/, ''));

            const turnContexts = new Map(); // turnId -> { model, timestamp }
            const turnUsages = new Map(); // turnId -> { input_tokens, output_tokens, cached_input_tokens, cache_write_input_tokens, timestamp, authoritative }
            const turnCompletions = new Map(); // turnId -> completedAt

            function addCounter(current, next) {
              if (!Number.isSafeInteger(next) || next < 0) return current;
              return (current ?? 0) + next;
            }

            for (const line of lines) {
              if (!line || !line.trim()) continue;
              if (line.length > 65_536) {
                coverage.malformed++;
                continue;
              }
              if (!line.includes('"type"')) continue;
              coverage.records++;
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
                  const cumulativeTurn = record.turn_token_usage || payload.turn_token_usage;
                  const deltaUsage = record.usage || payload.usage;
                  if (turnId && cumulativeTurn && typeof cumulativeTurn === 'object') {
                    // Authoritative cumulative turn counter: replace prior delta/snapshot for this turn
                    turnUsages.set(turnId, {
                      input_tokens: Number.isSafeInteger(cumulativeTurn.input_tokens) && cumulativeTurn.input_tokens >= 0 ? cumulativeTurn.input_tokens : null,
                      output_tokens: Number.isSafeInteger(cumulativeTurn.output_tokens) && cumulativeTurn.output_tokens >= 0 ? cumulativeTurn.output_tokens : null,
                      cached_input_tokens: Number.isSafeInteger(cumulativeTurn.cached_input_tokens) && cumulativeTurn.cached_input_tokens >= 0 ? cumulativeTurn.cached_input_tokens : null,
                      cache_write_input_tokens: Number.isSafeInteger(cumulativeTurn.cache_write_input_tokens) && cumulativeTurn.cache_write_input_tokens >= 0 ? cumulativeTurn.cache_write_input_tokens : null,
                      timestamp: eventTimestamp,
                      authoritative: true,
                    });
                  } else if (turnId && deltaUsage && typeof deltaUsage === 'object') {
                    const prev = turnUsages.get(turnId);
                    if (!prev || !prev.authoritative) {
                      turnUsages.set(turnId, {
                        input_tokens: addCounter(prev?.input_tokens ?? null, deltaUsage.input_tokens),
                        output_tokens: addCounter(prev?.output_tokens ?? null, deltaUsage.output_tokens),
                        cached_input_tokens: addCounter(prev?.cached_input_tokens ?? null, deltaUsage.cached_input_tokens),
                        cache_write_input_tokens: addCounter(prev?.cache_write_input_tokens ?? null, deltaUsage.cache_write_input_tokens),
                        timestamp: eventTimestamp ?? prev?.timestamp ?? null,
                        authoritative: false,
                      });
                    }
                  }
                } else if (type === 'event_msg' && payload.type === 'task_complete') {
                  const turnId = safeId(payload.turn_id, null);
                  if (turnId) {
                    const completedAt = payload.completed_at ? Date.parse(payload.completed_at) : eventTimestamp;
                    turnCompletions.set(turnId, completedAt);
                  }
                }
              } catch {
                coverage.malformed++;
              }
            }

            // Synthesize completed turns into normalized events
            for (const [turnId, usage] of turnUsages.entries()) {
              if (collectedEvents.length >= maxEvents) {
                coverage.bounded = true;
                break;
              }
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
            coverage.skipped++;
          }
        }
      }
    } catch {
      coverage.skipped++;
    }
  }

  const partial = coverage.bounded || coverage.malformed > 0 || coverage.skipped > 0;
  const status = partial
    ? 'PARTIAL'
    : (collectedEvents.length > 0 ? 'OK' : (coverage.files > 0 ? 'UNMEASURED' : 'OK'));

  return {
    contract: USAGE_CONTRACT,
    provider: 'codex',
    status,
    reason: partial ? 'INCOMPLETE_COVERAGE' : null,
    count: collectedEvents.length,
    events: collectedEvents,
    coverage,
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
    const periodKey = formatPeriodKey(event.timestamp, period, timezone);
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
