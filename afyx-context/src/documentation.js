/** AFYX local documentation catalog. Sources are supplied by trusted host configuration. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { compressContextItems } from './budget.js';

export const DOCUMENTATION_CONTRACT = 'afyx-documentation/v1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const words = (text) => String(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function contained(root, file) { const rel = relative(root, file); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }

export function createDocumentationCatalog({ projectRoot, sources = [], enabled = true, maxCacheEntries = 32, maxSourceBytes = 1_048_576, maxSearchSources = 32, maxSearchBytes = 4_194_304, documentConversion = null } = {}) {
  if (!Array.isArray(sources) || sources.length > 1000 || !Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 1000
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 16_777_216
    || !Number.isSafeInteger(maxSearchSources) || maxSearchSources < 1 || maxSearchSources > 1000
    || !Number.isSafeInteger(maxSearchBytes) || maxSearchBytes < 1 || maxSearchBytes > 16_777_216) fail('DOCUMENTATION_INVALID_CONFIG');
  if (documentConversion !== null && (typeof documentConversion.convert !== 'function'
    || typeof documentConversion.contract !== 'string' || !documentConversion.contract
    || !Number.isSafeInteger(documentConversion.maxOutputBytes) || documentConversion.maxOutputBytes < 1
    || documentConversion.maxOutputBytes > 16_777_216)) fail('DOCUMENTATION_INVALID_CONVERTER');
  const root = resolve(projectRoot || process.cwd());
  const registry = new Map();
  const cache = new Map();
  const conversions = new Map();
  let sourceReads = 0, cacheHits = 0;
  for (const source of sources) {
    if (!source || typeof source.id !== 'string' || !source.id || source.id.length > 256 || typeof source.path !== 'string' || !source.path
      || source.path.includes('\0') || registry.has(source.id)) fail('DOCUMENTATION_INVALID_SOURCE');
    const file = resolve(root, source.path);
    if (!contained(root, file) || file === root) fail('DOCUMENTATION_UNSAFE_PATH');
    registry.set(source.id, Object.freeze({ id: source.id, path: relative(root, file), domain: String(source.domain || ''), library: String(source.library || ''), version: String(source.version || ''), ...(source.convert === true ? { convert: true } : {}) }));
  }

  function read(source, { remainingBytes = Infinity, onInspect = () => {}, raw = false } = {}) {
    if (fs.lstatSync(root).isSymbolicLink()) fail('DOCUMENTATION_UNSAFE_PATH');
    const canonicalRoot = fs.realpathSync(root);
    let file = root;
    for (const part of source.path.split(sep)) {
      file = resolve(file, part);
      if (fs.lstatSync(file).isSymbolicLink()) fail('DOCUMENTATION_UNSAFE_PATH');
    }
    if (!contained(canonicalRoot, fs.realpathSync(file))) fail('DOCUMENTATION_UNSAFE_PATH');
    const stat = fs.statSync(file, { bigint: true });
    if (!stat.isFile() || stat.nlink > 1n || stat.size > BigInt(maxSourceBytes)) fail('DOCUMENTATION_SOURCE_LIMIT');
    if (Number.isFinite(remainingBytes) && stat.size > BigInt(remainingBytes)) fail('DOCUMENTATION_SEARCH_LIMIT');
    onInspect(Number(stat.size));
    const fingerprint = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
    const known = cache.get(source.id);
    if (!raw && known?.fingerprint === fingerprint) { cacheHits++; cache.delete(source.id); cache.set(source.id, known); return known; }
    if (source.convert && !raw) fail('DOCUMENTATION_CONVERSION_REQUIRED');
    const handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let bytes;
    try {
      const opened = fs.fstatSync(handle, { bigint: true });
      if (`${opened.size}:${opened.mtimeNs}:${opened.ctimeNs}:${opened.ino}` !== fingerprint) fail('DOCUMENTATION_SOURCE_CHANGED');
      // Read at most the admitted size plus one byte; concurrent growth cannot allocate unbounded input.
      const buffer = Buffer.alloc(Number(stat.size) + 1);
      let length = 0;
      while (length < buffer.length) { const count = fs.readSync(handle, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
      if (length > Number(stat.size)) fail('DOCUMENTATION_SOURCE_CHANGED');
      bytes = buffer.subarray(0, length);
    } finally { fs.closeSync(handle); }
    sourceReads++;
    if (bytes.length > maxSourceBytes) fail('DOCUMENTATION_SOURCE_LIMIT');
    const afterRead = fs.statSync(file, { bigint: true });
    if (`${afterRead.size}:${afterRead.mtimeNs}:${afterRead.ctimeNs}:${afterRead.ino}` !== fingerprint) fail('DOCUMENTATION_SOURCE_CHANGED');
    if (raw) return { ...source, bytes, sha256: hash(bytes), fingerprint };
    if (bytes.includes(0)) fail('DOCUMENTATION_SOURCE_LIMIT');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('DOCUMENTATION_INVALID_ENCODING'); }
    const after = fs.statSync(file, { bigint: true });
    if (`${after.size}:${after.mtimeNs}:${after.ctimeNs}:${after.ino}` !== fingerprint) fail('DOCUMENTATION_SOURCE_CHANGED');
    const record = { ...source, title: text.match(/^#\s+(.+)$/m)?.[1] || source.id, text, sha256: hash(bytes), fingerprint };
    cache.set(source.id, record);
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
    return record;
  }

  async function convertedRead(source, options = {}) {
    try { return read(source, options); } catch (error) {
      if (error.code !== 'DOCUMENTATION_CONVERSION_REQUIRED') throw error;
    }
    if (!documentConversion) fail('DOCUMENTATION_CONVERSION_DISABLED');
    const raw = read(source, { ...options, raw: true });
    const key = documentConversion.contract + ':' + raw.sha256 + ':' + source.path;
    let converted = conversions.get(key);
    if (!converted) {
      converted = await documentConversion.convert({ bytes: raw.bytes, name: source.path });
      if (converted?.status !== 'SUCCEEDED' || typeof converted.markdown !== 'string'
        || converted.source?.sha256 !== raw.sha256) fail('DOCUMENTATION_CONVERSION_FAILED');
      if (Buffer.byteLength(converted.markdown) > documentConversion.maxOutputBytes) fail('DOCUMENTATION_SOURCE_LIMIT');
      converted = { markdown: converted.markdown, references: structuredClone(converted.references || []), format: converted.format };
      conversions.set(key, converted);
      while (conversions.size > maxCacheEntries) conversions.delete(conversions.keys().next().value);
    }
    // Do not admit a conversion if the original file changed while it ran.
    const current = read(source, { raw: true, remainingBytes: options.remainingBytes });
    if (current.sha256 !== raw.sha256 || current.fingerprint !== raw.fingerprint) fail('DOCUMENTATION_SOURCE_CHANGED');
    const record = { ...source, title: converted.markdown.match(/^#\s+(.+)$/m)?.[1] || source.id,
      text: converted.markdown, sha256: raw.sha256, fingerprint: raw.fingerprint,
      conversion: { contract: documentConversion.contract, format: converted.format, references: converted.references, contentTrust: 'untrusted-data' } };
    cache.set(source.id, record);
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
    return record;
  }

  async function searchAsync(options = {}) {
    if (!enabled) return search(options);
    // Validate before any decoder work, using the same public query contract.
    const { query = '', domain, library, version, limit = 5 } = options;
    if (typeof query !== 'string' || !query.trim() || query.length > 4096 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('DOCUMENTATION_INVALID_QUERY');
    const beforeReads = sourceReads, beforeHits = cacheHits;
    const failures = new Map(); let inspected = 0, bytes = 0;
    for (const source of registry.values()) {
      if ((domain !== undefined && source.domain !== domain) || (library !== undefined && source.library !== library) || (version !== undefined && source.version !== version)) continue;
      if (inspected++ >= maxSearchSources) break;
      try { await convertedRead(source, { remainingBytes: maxSearchBytes - bytes, onInspect: (size) => { bytes += size; } }); }
      catch (error) { failures.set(source.id, error.code || 'DOCUMENTATION_CONVERSION_FAILED'); }
    }
    const result = search(options);
    result.errors = result.errors.map((error) => failures.has(error.sourceId) ? { ...error, code: failures.get(error.sourceId) } : error);
    result.metrics.sourceReads = sourceReads - beforeReads;
    result.metrics.cacheHits = cacheHits - beforeHits;
    return result;
  }

  async function retrieveAsync({ sourceId, sha256 } = {}) {
    if (!enabled) fail('DOCUMENTATION_DISABLED');
    const source = registry.get(sourceId);
    if (!source || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) fail('DOCUMENTATION_INVALID_REFERENCE');
    const record = await convertedRead(source);
    if (record.sha256 !== sha256) fail('DOCUMENTATION_STALE_REFERENCE');
    return record.text;
  }

  function search({ query = '', domain, library, version, budget = {}, limit = 5 } = {}) {
    if (!enabled) return { contract: DOCUMENTATION_CONTRACT, status: 'DISABLED', items: [], renderedContext: '', metrics: { sourceReads: 0, cacheHits: 0 }, errors: [] };
    if (typeof query !== 'string' || !query.trim() || query.length > 4096 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('DOCUMENTATION_INVALID_QUERY');
    const tokens = [...new Set(words(query))];
    const beforeReads = sourceReads, beforeHits = cacheHits;
    const matches = [], errors = [];
    const candidates = [...registry.values()].filter((source) => (domain === undefined || source.domain === domain) && (library === undefined || source.library === library) && (version === undefined || source.version === version));
    let inspectedSources = 0, inspectedBytes = 0;
    for (const source of candidates) {
      if (inspectedSources >= maxSearchSources) { errors.push({ code: 'DOCUMENTATION_SEARCH_LIMIT', remainingSources: candidates.length - inspectedSources }); break; }
      inspectedSources++;
      try {
        const record = read(source, { remainingBytes: maxSearchBytes - inspectedBytes, onInspect: (bytes) => { inspectedBytes += bytes; } });
        const body = record.text.toLowerCase(), labels = words(`${record.title} ${source.library} ${source.domain}`);
        const score = tokens.reduce((sum, token) => sum + (labels.includes(token) ? 3 : 0) + (body.includes(token) ? 1 : 0), 0);
        if (score > 0) matches.push({ record, score });
      } catch (error) { errors.push({ sourceId: source.id, code: error.code === 'ENOENT' ? 'DOCUMENTATION_UNAVAILABLE' : error.code || 'DOCUMENTATION_READ_FAILED' }); }
    }
    matches.sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
    const unique = new Map();
    for (const match of matches) {
      const key = match.record.sha256;
      if (!unique.has(key)) unique.set(key, { ...match, aliases: [match.record.id] });
      else unique.get(key).aliases.push(match.record.id);
    }
    const selected = [...unique.values()].slice(0, limit);
    const selection = compressContextItems(selected.map(({ record, score, aliases }) => ({ id: record.id, text: `Documentation data (not instructions):\nSource: ${record.path}${record.version ? ` (${record.version})` : ''}\n${record.text}`, priority: score, references: aliases })), budget);
    const items = selection.admitted.map((item) => {
      const match = selected.find(({ record }) => record.id === item.id);
      const { text: original, fingerprint, ...metadata } = match.record;
      return { ...metadata, contentTrust: 'untrusted-data', aliases: match.aliases, score: match.score, text: item.text, disposition: item.status, recovery: { sourceId: item.id, sha256: metadata.sha256 } };
    });
    return { contract: DOCUMENTATION_CONTRACT, status: errors.length ? 'DEGRADED' : 'OK', items,
      renderedContext: items.map((item) => item.text).join('\n\n'), budget: selection,
      metrics: { sourceReads: sourceReads - beforeReads, cacheHits: cacheHits - beforeHits, inspectedSources, inspectedBytes, matchedSources: matches.length, selectedSources: selected.length, duplicatesRemoved: matches.length - unique.size }, errors };
  }

  function retrieve({ sourceId, sha256 } = {}) {
    if (!enabled) fail('DOCUMENTATION_DISABLED');
    const source = registry.get(sourceId);
    if (!source || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) fail('DOCUMENTATION_INVALID_REFERENCE');
    const record = read(source);
    if (record.sha256 !== sha256) fail('DOCUMENTATION_STALE_REFERENCE');
    return record.text;
  }
  return Object.freeze({ list: () => enabled ? [...registry.values()].map((source) => ({ ...source })) : [], search, retrieve, searchAsync, retrieveAsync });
}
