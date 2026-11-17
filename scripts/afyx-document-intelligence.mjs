#!/usr/bin/env node
/** Standalone, optional document conversion. Input text remains untrusted data. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { formatNames } from './afyx-document-formats.mjs';

export const DOCUMENT_CONTRACT = 'AfyxDocument/v1';
export const DOCUMENT_LIMITS = Object.freeze({ maxInputBytes: 8 * 1024 * 1024, maxInflatedBytes: 32 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024, maxEntries: 128, maxOutputBytes: 2 * 1024 * 1024,
  maxTimeMs: 3000, maxMemoryMb: 96 });
const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
function diagnosticCode(error) {
  const message = String(error.message || error);
  if (error.code?.startsWith('E')) return `DOCUMENT_FILESYSTEM_${error.code}`;
  if (/JSON|property name|Unexpected token|Unexpected end/i.test(message)) return 'DOCUMENT_JSON_MALFORMED';
  if (/encoded data|encoding/i.test(message) && !message.startsWith('ZIP_')) return 'DOCUMENT_TEXT_ENCODING_INVALID';
  return message.startsWith('USAGE:') ? message : message.split(':')[0].replace(/[^A-Za-z0-9_]/g, '_').slice(0, 100);
}
const errorResult = (error, source = null) => ({ contract: DOCUMENT_CONTRACT,
  status: error.unsupported ? 'UNSUPPORTED' : 'BLOCKED', source, markdown: '', metadata: {}, references: [],
  untrusted: true, diagnostics: [{ code: diagnosticCode(error) }] });

export function listSupportedFormats() {
  return { contract: DOCUMENT_CONTRACT, formats: formatNames.map((id) => ({ id,
    status: id === 'pdf' ? 'UNSUPPORTED' : ['docx', 'xlsx', 'pptx', 'html', 'zip'].includes(id) ? 'PARTIAL' : 'SUPPORTED',
    details: ({ pdf: 'PDF font maps, filters, encryption, OCR not implemented',
      docx: 'Paragraphs, heading styles, list markers and tables; no drawings, formulas, tracked changes or pagination',
      xlsx: 'Sheet order, strings and cached cell values; no formula evaluation or style/date rendering',
      pptx: 'Slide order and paragraph text; no drawings, notes, charts or visual layout',
      html: 'Inert text, headings, lists, tables, code and safe HTTP/mailto links; no DOM/CSS execution',
      zip: 'Stored/deflated members only, one level, supported text members, no executable contents' })[id] ?? 'Offline native text conversion',
  })), limits: DOCUMENT_LIMITS, memoryPolicy: 'V8 worker heap cap plus bounded input/inflation; not an operating-system RSS quota',
  network: false, plugins: false, ocr: false, untrusted: true };
}

function boundedLimits(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('DOCUMENT_TRUSTED_POLICY_REQUIRED');
  const limits = { ...DOCUMENT_LIMITS };
  for (const [name, value] of Object.entries(policy.limits ?? {})) {
    if (!Object.hasOwn(limits, name) || !Number.isSafeInteger(value) || value <= 0 || value > limits[name]) throw new Error('DOCUMENT_LIMIT_POLICY_INVALID');
    limits[name] = value;
  }
  return limits;
}
function safeFile(path, policy, limits) {
  if (!isAbsolute(policy.workspaceRoot ?? '')) throw new Error('DOCUMENT_WORKSPACE_REQUIRED');
  const root = resolve(policy.workspaceRoot); const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('DOCUMENT_PATH_OUTSIDE_WORKSPACE');
  if (/[\x00-\x1f:]/.test(rel)) throw new Error('DOCUMENT_PATH_INVALID');
  let cursor = target;
  for (;;) {
    const info = lstatSync(cursor);
    if (info.isSymbolicLink()) throw new Error('DOCUMENT_SYMLINK_FORBIDDEN');
    if (cursor === dirname(cursor)) break;
    cursor = dirname(cursor);
  }
  const realRoot = realpathSync(root); const realTarget = realpathSync(target);
  const realRel = relative(realRoot, realTarget);
  if (realRel.startsWith('..') || isAbsolute(realRel)) throw new Error('DOCUMENT_PATH_OUTSIDE_WORKSPACE');
  const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) throw new Error('DOCUMENT_FILE_NOT_PRIVATE_REGULAR');
    if (before.size > limits.maxInputBytes) throw new Error('DOCUMENT_INPUT_LIMIT');
    const buffer = Buffer.alloc(before.size); let read = 0;
    while (read < buffer.length) {
      const count = readSync(fd, buffer, read, buffer.length - read, read);
      if (!count) throw new Error('DOCUMENT_FILE_CHANGED');
      read += count;
    }
    const after = fstatSync(fd); const current = lstatSync(target);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev || current.nlink !== 1) throw new Error('DOCUMENT_FILE_CHANGED');
    return { bytes: buffer, name: basename(target), path: realTarget };
  } finally { closeSync(fd); }
}
async function collect(input, policy, limits) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('DOCUMENT_INPUT_INVALID');
  if (['path', 'bytes', 'stream'].filter((key) => input[key] !== undefined).length !== 1) throw new Error('DOCUMENT_EXACTLY_ONE_INPUT_REQUIRED');
  if (input.path !== undefined) {
    if (typeof input.path !== 'string' || !input.path || input.path.includes('\0')) throw new Error('DOCUMENT_PATH_INVALID');
    return safeFile(input.path, policy, limits);
  }
  const name = typeof input.name === 'string' ? input.name : 'document.txt';
  if (!name || name.length > 256 || /[\x00-\x1f]/.test(name) || basename(name) !== name || name.includes('\\')) throw new Error('DOCUMENT_NAME_INVALID');
  if (input.bytes !== undefined) {
    if (!(input.bytes instanceof Uint8Array)) throw new Error('DOCUMENT_BYTES_REQUIRED');
    if (input.bytes.byteLength > limits.maxInputBytes) throw new Error('DOCUMENT_INPUT_LIMIT');
    return { bytes: Buffer.from(input.bytes), name };
  }
  if (!input.stream?.[Symbol.asyncIterator]) throw new Error('DOCUMENT_STREAM_INVALID');
  const iterator = input.stream[Symbol.asyncIterator](); const chunks = []; let size = 0;
  const deadline = Date.now() + limits.maxTimeMs;
  try {
    for (;;) {
      let timer;
      const item = await Promise.race([iterator.next(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DOCUMENT_TIME_LIMIT')), Math.max(1, deadline - Date.now()));
      })]).finally(() => clearTimeout(timer));
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) throw new Error('DOCUMENT_STREAM_BYTES_REQUIRED');
      size += item.value.byteLength;
      if (size > limits.maxInputBytes) throw new Error('DOCUMENT_INPUT_LIMIT');
      chunks.push(Buffer.from(item.value));
      if (Date.now() > deadline) throw new Error('DOCUMENT_TIME_LIMIT');
    }
  } catch (error) {
    // Do not await an untrusted iterator's potentially non-terminating return().
    try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* best-effort iterator release */ }
    throw error;
  }
  return { bytes: Buffer.concat(chunks, size), name };
}

function runWorker(data, deadline) {
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(new URL('./afyx-document-worker.mjs', import.meta.url), {
      workerData: data, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: data.limits.maxMemoryMb,
        maxYoungGenerationSizeMb: Math.min(16, data.limits.maxMemoryMb), stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      worker.terminate().finally(() => error ? reject(error) : resolveResult(result));
    };
    const timer = setTimeout(() => finish(new Error('DOCUMENT_TIME_LIMIT')), Math.max(1, deadline - Date.now()));
    worker.once('message', (result) => finish(null, result));
    worker.once('error', (error) => finish(new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'DOCUMENT_MEMORY_LIMIT' : 'DOCUMENT_WORKER_FAILED')));
    worker.once('exit', (code) => { if (!settled) finish(new Error(`DOCUMENT_WORKER_EXIT:${code}`)); });
  });
}

export async function convertDocument(input, policy = {}) {
  let source = null;
  try {
    const limits = boundedLimits(policy); const deadline = Date.now() + limits.maxTimeMs;
    const admission = await collect(input, policy, limits);
    source = { name: admission.name, sha256: hex(admission.bytes), bytes: admission.bytes.length,
      ...(admission.path ? { path: admission.path } : {}) };
    if (input.mime !== undefined && (typeof input.mime !== 'string' || input.mime.length > 256)) throw new Error('DOCUMENT_MIME_INVALID');
    if (Date.now() >= deadline) throw new Error('DOCUMENT_TIME_LIMIT');
    const result = await runWorker({ bytes: admission.bytes, name: admission.name, mime: input.mime, limits }, deadline);
    if (!result.ok) {
      const error = new Error(result.error); error.unsupported = result.unsupported;
      return errorResult(error, source);
    }
    return { contract: DOCUMENT_CONTRACT, status: 'SUCCEEDED', format: result.format, source,
      markdown: result.markdown, metadata: { converter: 'AFYX-native', network: false, macrosExecuted: false,
        ...result.metadata }, references: result.references.map((ref) => ({ ...ref, sourceSha256: source.sha256 })),
      untrusted: true, diagnostics: [] };
  } catch (error) { return errorResult(error, source); }
}

export async function inspectDocument(input, policy = {}) {
  const { markdown, ...result } = await convertDocument(input, policy);
  return { ...result, outputBytes: Buffer.byteLength(markdown, 'utf8') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, path, root] = process.argv.slice(2);
  let result;
  if (command === 'formats' || command === '--help' || command === '-h') result = listSupportedFormats();
  else if (['convert', 'inspect'].includes(command) && path && root) {
    result = await (command === 'convert' ? convertDocument : inspectDocument)({ path }, { workspaceRoot: resolve(root) });
  } else result = errorResult(new Error('USAGE: formats | convert <file> <trusted-workspace-root> | inspect <file> <trusted-workspace-root>'));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status && result.status !== 'SUCCEEDED') process.exitCode = 2;
}
