/** Copyright (c) 2026 Afyx */
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { redactSensitiveText } from './privacy.js';

export const TRACE_CONTRACT = 'afyx-trace/v1';
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 5000;
const LOCK_STALE_MS = 10_000;
const VALID_STATUS = new Set(['success', 'failure', 'timeout', 'unavailable']);
const VALID_CACHE = new Set(['hit', 'miss', 'unavailable']);

function userHome() {
  return process.env.USERPROFILE || process.env.HOME || homedir();
}

export function defaultTracePath() {
  return process.env.AFYX_TRACE_FILE || join(userHome(), '.afyx', 'trace', 'invocations.jsonl');
}

export function isTraceEnabled(explicit) {
  if (typeof explicit === 'boolean') return explicit;
  const env = String(process.env.AFYX_TRACE_ENABLED || '').trim().toLowerCase();
  return env === '1' || env === 'true' || env === 'yes' || env === 'on';
}

function safeMetricInt(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeMetricNum(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Number(value.toFixed(3)) : null;
}

function safeLabel(value, maxLen = 128) {
  if (typeof value !== 'string') return 'unavailable';
  const cleaned = redactSensitiveText(value).replace(/[\x00-\x1f\r\n]+/g, ' ').trim();
  if (!cleaned) return 'unavailable';
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function safeTokenBlock(block, includeMethod = false) {
  if (!block || typeof block !== 'object') return null;
  const input = safeMetricInt(block.input);
  const output = safeMetricInt(block.output);
  const cached = safeMetricInt(block.cached);
  const total = safeMetricInt(block.total);
  if (input === null && output === null && cached === null && total === null) return null;
  const out = { input, output, cached, total };
  if (includeMethod && typeof block.method === 'string') {
    out.method = safeLabel(block.method, 64);
  }
  return out;
}

function normalizeTraceEntry(entry = {}) {
  const status = VALID_STATUS.has(entry.status) ? entry.status : 'unavailable';
  const cache = VALID_CACHE.has(entry.cache) ? entry.cache : 'unavailable';
  const aceCost = entry.aceCost && typeof entry.aceCost === 'object'
    ? {
        retrievedBytes: safeMetricInt(entry.aceCost.retrievedBytes),
        reducedBytes: safeMetricInt(entry.aceCost.reducedBytes),
        durationMs: safeMetricNum(entry.aceCost.durationMs),
      }
    : null;
  const graphEvidence = entry.graphEvidence && typeof entry.graphEvidence === 'object'
    ? {
        freshness: safeLabel(entry.graphEvidence.freshness, 32),
        extractionCapability: safeLabel(entry.graphEvidence.extractionCapability, 64),
      }
    : null;

  return {
    contract: TRACE_CONTRACT,
    invocationId: typeof entry.invocationId === 'string' && entry.invocationId.length > 0 && entry.invocationId.length <= 128
      ? safeLabel(entry.invocationId, 128)
      : randomUUID(),
    timestamp: typeof entry.timestamp === 'string' && !Number.isNaN(Date.parse(entry.timestamp))
      ? entry.timestamp
      : new Date().toISOString(),
    component: safeLabel(entry.component, 64),
    operation: safeLabel(entry.operation, 64),
    status,
    durationMs: safeMetricNum(entry.durationMs),
    inputBytes: safeMetricInt(entry.inputBytes),
    outputBytes: safeMetricInt(entry.outputBytes),
    actualTokens: safeTokenBlock(entry.actualTokens, false),
    estimatedTokens: safeTokenBlock(entry.estimatedTokens, true),
    cache,
    runtimePrepMs: safeMetricNum(entry.runtimePrepMs),
    aceCost,
    graphEvidence,
  };
}

function withTraceLock(lockPath, fn) {
  let acquired = false;
  try {
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      acquired = true;
    } catch {
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          const fd = openSync(lockPath, 'wx');
          closeSync(fd);
          acquired = true;
        }
      } catch {
        // Lock contention or unavailable
      }
    }
    if (!acquired) return false;
    fn();
    return true;
  } finally {
    if (acquired) {
      try { unlinkSync(lockPath); } catch {}
    }
  }
}

function enforceRetention(traceFile, maxBytes, maxRecords) {
  if (!existsSync(traceFile)) return;
  const st = statSync(traceFile);
  if (st.size <= maxBytes) return;
  const lockPath = `${traceFile}.lock`;
  withTraceLock(lockPath, () => {
    if (!existsSync(traceFile)) return;
    const raw = readFileSync(traceFile, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const keepCount = Math.max(1, Math.min(lines.length, Math.floor(maxRecords / 2)));
    const kept = lines.slice(-keepCount).join('\n') + '\n';
    const tmpFile = `${traceFile}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpFile, kept, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpFile, traceFile);
  });
}

export function recordInvocationTrace(entry = {}, options = {}) {
  if (!isTraceEnabled(options.enabled)) {
    return { contract: TRACE_CONTRACT, status: 'DISABLED', recorded: false };
  }
  const traceFile = options.traceFile || defaultTracePath();
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_BYTES;
  const maxRecords = Number.isSafeInteger(options.maxRecords) && options.maxRecords > 0 ? options.maxRecords : DEFAULT_MAX_RECORDS;

  try {
    const record = normalizeTraceEntry(entry);
    const dir = dirname(traceFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    appendFileSync(traceFile, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
    enforceRetention(traceFile, maxBytes, maxRecords);
    return { contract: TRACE_CONTRACT, status: 'OK', recorded: true, invocationId: record.invocationId };
  } catch (err) {
    return {
      contract: TRACE_CONTRACT,
      status: 'ERROR',
      recorded: false,
      reason: basename(String(err?.code || 'WRITE_FAILED')),
    };
  }
}

export function readInvocationTraces(options = {}) {
  const traceFile = options.traceFile || defaultTracePath();
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, DEFAULT_MAX_RECORDS) : 100;
  if (!existsSync(traceFile)) {
    return {
      contract: TRACE_CONTRACT,
      status: 'NOT_AVAILABLE',
      count: 0,
      malformed: 0,
      records: [],
    };
  }
  try {
    const raw = readFileSync(traceFile, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const records = [];
    let malformed = 0;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (options.component && parsed.component !== options.component) continue;
        if (options.status && parsed.status !== options.status) continue;
        records.push(parsed);
      } catch {
        malformed++;
      }
    }
    const sliced = records.slice(-limit);
    return {
      contract: TRACE_CONTRACT,
      status: malformed > 0 ? 'PARTIAL' : 'OK',
      count: sliced.length,
      totalMatched: records.length,
      malformed,
      records: sliced,
    };
  } catch {
    return {
      contract: TRACE_CONTRACT,
      status: 'ERROR',
      count: 0,
      malformed: 0,
      records: [],
    };
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarizeInvocationTraces(options = {}) {
  const read = readInvocationTraces({ ...options, limit: DEFAULT_MAX_RECORDS });
  if (read.status === 'NOT_AVAILABLE' || read.status === 'ERROR') {
    return {
      contract: TRACE_CONTRACT,
      status: read.status,
      count: 0,
      malformed: read.malformed,
      byComponent: {},
      byStatus: {},
      cache: { hit: 0, miss: 0, unavailable: 0 },
      durationMs: { p50: null, p95: null, min: null, max: null },
      inputBytesTotal: null,
      outputBytesTotal: null,
      actualTokensTotal: null,
      estimatedTokensTotal: null,
    };
  }

  const byComponent = {};
  const byStatus = {};
  const cache = { hit: 0, miss: 0, unavailable: 0 };
  const durations = [];
  let inputBytesTotal = null;
  let outputBytesTotal = null;
  let actualTokensTotal = null;
  let estimatedTokensTotal = null;

  for (const r of read.records) {
    const comp = r.component || 'unavailable';
    byComponent[comp] = (byComponent[comp] || 0) + 1;
    const st = r.status || 'unavailable';
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (r.cache === 'hit') cache.hit++;
    else if (r.cache === 'miss') cache.miss++;
    else cache.unavailable++;

    if (typeof r.durationMs === 'number' && Number.isFinite(r.durationMs)) durations.push(r.durationMs);
    if (Number.isSafeInteger(r.inputBytes)) inputBytesTotal = (inputBytesTotal ?? 0) + r.inputBytes;
    if (Number.isSafeInteger(r.outputBytes)) outputBytesTotal = (outputBytesTotal ?? 0) + r.outputBytes;
    if (r.actualTokens && Number.isSafeInteger(r.actualTokens.total)) {
      actualTokensTotal = (actualTokensTotal ?? 0) + r.actualTokens.total;
    }
    if (r.estimatedTokens && Number.isSafeInteger(r.estimatedTokens.total)) {
      estimatedTokensTotal = (estimatedTokensTotal ?? 0) + r.estimatedTokens.total;
    }
  }

  durations.sort((a, b) => a - b);
  return {
    contract: TRACE_CONTRACT,
    status: read.status,
    count: read.records.length,
    malformed: read.malformed,
    byComponent,
    byStatus,
    cache,
    durationMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      min: durations.length ? durations[0] : null,
      max: durations.length ? durations[durations.length - 1] : null,
    },
    inputBytesTotal,
    outputBytesTotal,
    actualTokensTotal,
    estimatedTokensTotal,
  };
}
