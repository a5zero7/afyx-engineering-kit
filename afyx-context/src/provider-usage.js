/** Copyright (c) 2026 Afyx */
import { createHash } from 'node:crypto';
import { constants, lstatSync, realpathSync, opendirSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { createUsageAnalytics, normalizeUsageEvent, USAGE_CONTRACT } from './usage.js';

const id = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const digest = (...items) => createHash('sha256').update(JSON.stringify(items)).digest('hex');
const FIELDS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens'];
const DEFAULTS = { maxFiles: 32, maxBytes: 16 * 1024 * 1024, maxRecords: 10000, maxMs: 2000, maxEntries: 2048 };
const MAX_RECORD_BYTES = 512 * 1024;

function model(value, provider) {
  return typeof value === 'string' && new RegExp('^' + provider + '-[A-Za-z0-9.\\-]{1,70}$').test(value) ? value : null;
}

function row(session, event, timestamp, modelName, metrics) {
  if (!id(session) || !id(event) || typeof timestamp !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(timestamp)) return null;
  const time = Date.parse(timestamp);
  if (!Number.isSafeInteger(time) || time < 0) return null;
  if (timestamp.endsWith('Z') && new Date(time).toISOString().slice(0, 19) !== timestamp.slice(0, 19)) return null;
  const normalized = Object.fromEntries(FIELDS.map(key => [key, count(metrics[key]) ? metrics[key] : null]));
  if (normalized.cachedInputTokens !== null && normalized.inputTokens !== null &&
      normalized.cachedInputTokens > normalized.inputTokens) {
    normalized.inputTokens = null;
    normalized.cachedInputTokens = null;
  }
  return { session, event, time, modelName, normalized };
}

function claude(record) {
  if (record?.type !== 'assistant' || record.isSidechain === true ||
      record.message?.role !== 'assistant' || record.message.model === '<synthetic>') return undefined;
  const usage = record.message.usage ?? {};
  const input = usage.input_tokens;
  const cached = usage.cache_read_input_tokens;
  // Canonical input includes cache reads. Cache writes remain a separate field.
  const inputTokens = count(input) && count(cached) && count(input + cached) ? input + cached : null;
  return row(record.sessionId, record.message.id, record.timestamp, model(record.message.model, 'claude'), {
    inputTokens, cachedInputTokens: cached, outputTokens: usage.output_tokens,
    cacheWriteInputTokens: usage.cache_creation_input_tokens,
  });
}

function gemini(record, session) {
  if (record?.type !== 'gemini') return undefined;
  const usage = record.tokens ?? {};
  return row(session, record.id, record.timestamp, model(record.model, 'gemini'), {
    inputTokens: usage.input, outputTokens: usage.output, cachedInputTokens: usage.cached,
  });
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..';
}

function merge(previous, current) {
  if (previous.session !== current.session ||
      (previous.modelName && current.modelName && previous.modelName !== current.modelName)) return null;
  const newer = current.time >= previous.time ? current : previous;
  const older = newer === current ? previous : current;
  const normalized = {};
  for (const field of FIELDS) {
    const before = older.normalized[field], after = newer.normalized[field];
    if (before !== null && after !== null &&
        (field === 'outputTokens' ? newer.time !== older.time && before > after : before !== after)) return null;
    normalized[field] = newer.time === older.time && before !== null && after !== null
      ? Math.max(before, after) : after ?? before;
  }
  if (normalized.inputTokens !== null && normalized.cachedInputTokens !== null &&
      normalized.cachedInputTokens > normalized.inputTokens) return null;
  return { ...newer, firstTime: Math.min(previous.firstTime ?? previous.time, current.time), modelName: newer.modelName ?? older.modelName, normalized };
}

export function collectProviderUsage(provider, options = {}) {
  const report = (status, reason, extra = {}) => ({ contract: USAGE_CONTRACT, provider, status, events: [], reason, ...extra });
  if (options.enabled === false) return report('DISABLED', 'COLLECTION_DISABLED');
  if (options.authorized !== true) return report('NOT_AVAILABLE', 'PROVIDER_TELEMETRY_UNCONFIGURED');
  const claudeHost = provider === 'claude';
  const format = claudeHost ? 'claude-code-assistant/v1' : options.format;
  if (!claudeHost && format !== 'gemini-cli-chat/v1') return report('NOT_AVAILABLE', 'PROVIDER_FORMAT_UNVERIFIED');
  const directory = options.providerRoot ?? (claudeHost
    ? join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects') : null);
  if (typeof directory !== 'string' || !isAbsolute(directory)) return report('NOT_AVAILABLE', 'PROVIDER_ROOT_REQUIRED');
  let root;
  try {
    const logical = resolve(directory);
    root = realpathSync(logical);
    if (root !== logical || !lstatSync(root).isDirectory()) return report('NOT_AVAILABLE', 'PROVIDER_ROOT_UNSAFE');
  } catch {
    return report('NOT_AVAILABLE', 'PROVIDER_ROOT_UNAVAILABLE');
  }
  const limits = Object.fromEntries(Object.entries(DEFAULTS).map(([key, max]) => [
    key, Number.isSafeInteger(options[key]) && options[key] > 0 ? Math.min(max, options[key]) : max,
  ]));
  const deadline = performance.now() + limits.maxMs;
  const seen = new Map(), conflicted = new Set(), sessions = new Set();
  const coverage = { files: 0, records: 0, bytes: 0, duplicates: 0, malformed: 0, skipped: 0, conflicts: 0, bounded: false };
  let entries = 0;
  const stop = () => {
    if (coverage.records >= limits.maxRecords || coverage.bytes >= limits.maxBytes ||
        entries >= limits.maxEntries || performance.now() >= deadline || options.signal?.aborted) coverage.bounded = true;
    return coverage.bounded;
  };
  const accept = current => {
    if (current === null) { coverage.malformed++; return; }
    if (!current) return;
    const sessionKey = digest(provider, current.session);
    const key = digest(provider, current.event);
    sessions.add(sessionKey);
    if (conflicted.has(key)) return;
    const prior = seen.get(key);
    if (prior) {
      coverage.duplicates++;
      current = merge(prior, current);
      if (!current) { seen.delete(key); conflicted.add(key); coverage.conflicts++; return; }
    }
    seen.set(key, current);
  };

  function collectFile(path) {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || !inside(root, realpathSync(path))) { coverage.skipped++; return; }
    if (before.size > limits.maxBytes - coverage.bytes) { coverage.skipped++; return; }
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const records = [];
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || realpathSync(path) !== path) {
        coverage.skipped++; return;
      }
      coverage.files++;
      const isJson = path.endsWith('.json');
      let pending = Buffer.alloc(0), remaining = before.size, dropping = false, session, invalidGemini = false;
      const parse = bytes => {
        if (bytes.length === 0 || !bytes.toString('utf8').trim() || stop()) return;
        coverage.records++;
        let data;
        try { data = JSON.parse(bytes.toString('utf8')); } catch { coverage.malformed++; if (!claudeHost) invalidGemini = true; return; }
        if (claudeHost) { records.push(claude(data)); return; }
        if (isJson || session === undefined) {
          if (!id(data?.sessionId) || typeof data.projectHash !== 'string' ||
              typeof data.startTime !== 'string' || data.kind === 'subagent' ||
              (isJson && !Array.isArray(data.messages))) { invalidGemini = true; return; }
          session = data.sessionId;
          if (isJson) for (const message of data.messages) {
            if (stop()) break;
            coverage.records++;
            records.push(gemini(message, session));
          }
        } else if (data && typeof data === 'object' && Object.keys(data).some(key => key.startsWith('$'))) {
          // Patch/rewind journals need full semantics before their tokens can be attributed.
          invalidGemini = true;
        } else records.push(gemini(data, session));
      };
      const buffer = Buffer.allocUnsafe(16384);
      while (remaining > 0 && !stop()) {
        const length = readSync(fd, buffer, 0, Math.min(buffer.length, remaining, limits.maxBytes - coverage.bytes), null);
        if (!length) break;
        remaining -= length;
        const bytes = buffer.subarray(0, length);
        if (isJson) {
          if (pending.length + length > MAX_RECORD_BYTES) { coverage.bytes += length; coverage.skipped++; return; }
          pending = Buffer.concat([pending, bytes]);
          coverage.bytes += length;
          continue;
        }
        let start = 0;
        while (start < bytes.length && !stop()) {
          const newline = bytes.indexOf(10, start);
          const end = newline === -1 ? bytes.length : newline;
          if (!dropping && pending.length + end - start > MAX_RECORD_BYTES) {
            coverage.malformed++; dropping = true; pending = Buffer.alloc(0);
            if (!claudeHost) invalidGemini = true;
          }
          if (!dropping) pending = Buffer.concat([pending, bytes.subarray(start, end)]);
          if (newline !== -1) { if (!dropping) parse(pending); pending = Buffer.alloc(0); dropping = false; }
          start = end + 1;
        }
        coverage.bytes += length;
      }
      if (remaining > 0) { coverage.skipped++; if (!claudeHost) invalidGemini = true; }
      else if (!dropping && pending.length) {
        if (isJson) parse(pending);
        else { coverage.malformed++; if (!claudeHost) invalidGemini = true; }
      }
      const after = fstatSync(fd);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
          (!claudeHost && (invalidGemini || coverage.bounded))) { coverage.skipped++; return; }
      for (const record of records) accept(record);
    } finally { closeSync(fd); }
  }

  const candidates = [];
  function walk(path, depth) {
    if (stop()) return;
    if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) { coverage.skipped++; return; }
    const names = [];
    const directory = opendirSync(path);
    try {
      for (let entry; !stop() && (entry = directory.readSync());) {
        entries++;
        names.push(entry);
      }
    } finally { directory.closeSync(); }
    if (coverage.bounded) return;
    for (const entry of names.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (stop()) return;
      const child = join(path, entry.name);
      try {
        if (entry.isSymbolicLink()) { coverage.skipped++; continue; }
        if (entry.isDirectory() && entry.name !== 'subagents') {
          if (depth >= 4 || realpathSync(child) !== child) { coverage.skipped++; continue; }
          walk(child, depth + 1);
        } else if (entry.isFile() && (claudeHost ? entry.name.endsWith('.jsonl') : /^session-.*\.jsonl?$/.test(entry.name))) {
          const st = lstatSync(child);
          candidates.push({ path: child, mtimeMs: st.mtimeMs });
        }
      } catch { coverage.skipped++; }
    }
  }
  try {
    walk(root, 0);
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
    for (const candidate of candidates) {
      if (stop()) break;
      if (coverage.files >= limits.maxFiles) { coverage.bounded = true; break; }
      collectFile(candidate.path);
    }
  } catch { coverage.skipped++; }
  const events = [];
  for (const [eventId, record] of seen) {
    if (Object.values(record.normalized).every(value => value === null)) continue;
    events.push(normalizeUsageEvent({
      ...record.normalized, provider, eventId, sessionId: digest(provider, record.session),
      timestamp: record.firstTime ?? record.time, model: record.modelName, mode: 'delta', source: format,
    }));
  }
  events.sort((a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId));
  let partial = coverage.bounded || coverage.malformed > 0 || coverage.skipped > 0 ||
    coverage.conflicts > 0 || events.length < seen.size ||
    events.some(event => event.inputTokens === null || event.outputTokens === null);
  let totals = null;
  if (events.length && !partial) {
    const analytics = createUsageAnalytics();
    for (const event of events) analytics.record(event);
    try { totals = analytics.summarize().totals; } catch (error) {
      if (error.code !== 'USAGE_TOTAL_OVERFLOW') throw error;
      partial = true;
    }
  }
  return report(events.length ? (partial ? 'PARTIAL' : 'OK') : (sessions.size ? 'UNMEASURED' : 'NOT_AVAILABLE'),
    events.length ? (partial ? 'INCOMPLETE_COVERAGE' : null) : 'NO_VERIFIED_TOKEN_EVENTS',
    { source: format, sourceProduct: claudeHost ? 'claude-code' : 'gemini-cli',
      events, totals, count: events.length,
      activity: sessions.size ? { sessions: sessions.size, modelMessages: seen.size } : null, coverage });
}
