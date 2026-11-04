#!/usr/bin/env node
// Phase 8 local-only typed event recorder. No agent execution, network or customer content capture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA = input => crypto.createHash('sha256').update(input).digest('hex');
const COVERAGE = { toolEvents: false, humanEvents: false, reworkEvents: false, providerUsage: false };
const QUALITY = { correctness: 'NOT_RUN', tests: 'NOT_RUN', security: 'NOT_RUN', evaluatorReceiptSha256: null };
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS = 20000;
const MAX_INPUT_LINE = 4096;

class CaptureError extends Error {}
function requireCapture(condition, reason) {
  if (!condition) throw new CaptureError(reason);
}
function identity(candidate) {
  requireCapture(typeof candidate === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(candidate), 'invalid run ID');
  return candidate;
}
function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function privateRoot(candidate, workspace) {
  requireCapture(typeof candidate === 'string' && path.isAbsolute(candidate), 'capture root must be absolute');
  requireCapture(fs.lstatSync(candidate).isDirectory() && !fs.lstatSync(candidate).isSymbolicLink(),
    'capture root must be a physical directory');
  const canonical = fs.realpathSync.native(candidate);
  requireCapture(!contained(SOURCE_ROOT, canonical), 'capture must remain outside source repository');
  if (workspace) {
    requireCapture(path.isAbsolute(workspace), 'workspace root must be absolute');
    requireCapture(!contained(fs.realpathSync.native(workspace), canonical),
      'capture must remain outside application repository');
  }
  return canonical;
}
function parseOptions(args) {
  const allowed = new Set(['--mode', '--root', '--run-id', '--workspace-root']);
  const out = {};
  requireCapture(args.length % 2 === 0, 'expected paired argument/value options');
  for (let i = 0; i < args.length; i += 2) {
    requireCapture(allowed.has(args[i]) && !Object.hasOwn(out, args[i]), 'invalid or repeated option');
    out[args[i]] = args[i + 1];
  }
  requireCapture(['OFF','ON'].includes(out['--mode']), 'mode must be OFF or ON');
  identity(out['--run-id']);
  requireCapture(typeof out['--root'] === 'string', 'missing root');
  return out;
}
function exactKeys(input, keys) {
  requireCapture(input && typeof input === 'object' && !Array.isArray(input), 'event must be an object');
  requireCapture(Object.keys(input).sort().join('|') === keys.slice().sort().join('|'),
    'unsupported event fields: capture only typed telemetry, no text or secrets');
}
function safeEvent(input) {
  requireCapture(input && typeof input.kind === 'string', 'missing event kind');
  if (input.kind === 'tool_call') {
    exactKeys(input, ['kind','actor']);
    requireCapture(input.actor === 'agent', 'tool call must be emitted by agent');
    return {kind:'tool_call',actor:'agent'};
  }
  if (input.kind === 'human_intervention') {
    exactKeys(input, ['kind','actor']);
    requireCapture(input.actor === 'human', 'human intervention requires observed human actor');
    return {kind:'human_intervention',actor:'human'};
  }
  if (input.kind === 'rework') {
    exactKeys(input, ['kind','actor']);
    requireCapture(input.actor === 'agent' || input.actor === 'human', 'invalid rework actor');
    return {kind:'rework',actor:input.actor};
  }
  if (input.kind === 'provider_usage') {
    exactKeys(input, ['kind','source','usageSemantics','inputTokens','cachedInputTokens','outputTokens']);
    requireCapture(input.source === 'provider_report', 'provider counter provenance missing');
    requireCapture(input.usageSemantics === 'per_turn_delta',
      'provider counters must be independently verified per-turn deltas, not cumulative snapshots');
    for (const k of ['inputTokens','cachedInputTokens','outputTokens']) {
      requireCapture(Number.isSafeInteger(input[k]) && input[k] >= 0, 'invalid provider counter');
    }
    requireCapture(input.cachedInputTokens <= input.inputTokens, 'cached input exceeds total input');
    return {kind:'provider_usage',source:'provider_report',usageSemantics:'per_turn_delta',inputTokens:input.inputTokens,
      cachedInputTokens:input.cachedInputTokens,outputTokens:input.outputTokens};
  }
  throw new CaptureError('unrecognized event kind');
}
export async function recordEvents({mode, runId, root, workspaceRoot, input}) {
  requireCapture(['OFF','ON'].includes(mode), 'invalid mode');
  identity(runId);
  requireCapture(input && typeof input[Symbol.asyncIterator] === 'function', 'input must be an async iterator');
  const outputRoot = privateRoot(root, workspaceRoot);
  const filename = mode.toLowerCase() + '.ndjson';
  const dest = path.join(outputRoot, filename);
  let fd = null, complete = false, bytes = 0, events = 0;
  const hash = crypto.createHash('sha256');
  const add = record => {
    const buffer = Buffer.from(JSON.stringify(record) + '\n');
    requireCapture(bytes + buffer.length <= MAX_BYTES, 'trace exceeds 4 MiB');
    fs.writeSync(fd, buffer);
    hash.update(buffer);
    bytes += buffer.length;
  };
  try {
    fd = fs.openSync(dest, 'wx', 0o600);
    add({id:'evt-0',runId,at:new Date().toISOString(),kind:'start'});
    for await (const line of input) {
      requireCapture(typeof line === 'string' && Buffer.byteLength(line,'utf8') <= MAX_INPUT_LINE,
        'event line exceeds 4096 bytes');
      if (!line.trim()) continue;
      requireCapture(events < MAX_EVENTS - 2, 'too many telemetry events');
      let raw;
      try { raw = JSON.parse(line); } catch { throw new CaptureError('invalid telemetry JSON'); }
      add({id:'evt-' + (events+1),runId,at:new Date().toISOString(),...safeEvent(raw)});
      events++;
    }
    add({id:'evt-' + (events+1),runId,at:new Date().toISOString(),kind:'end'});
    fs.fsyncSync(fd);
    complete = true;
    return {
      contract:'afyx.phase8.local-capture/v1',
      run:{mode,runId,eventsFile:filename,eventsSha256:hash.digest('hex'),
        quality:{...QUALITY},coverage:{...COVERAGE},
        timing:{capture:'REPLAY_OR_UNVERIFIED',liveReceiptSha256:null}},
      capturedEvents:events,
      declaredCoverage:'ALL_UNVERIFIED',
      advisory:'Private descriptor only. Confirm complete event-category coverage and independent evaluator quality evidence before paired intake.',
    };
  } finally {
    if (fd !== null) fs.closeSync(fd);
    if (!complete && fd !== null) {
      try { fs.unlinkSync(dest); } catch { /* do not mask the original error */ }
    }
  }
}
async function main() {
  try {
    const opts = parseOptions(process.argv.slice(2));
    const lines = readline.createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
    const result = await recordEvents({
      mode:opts['--mode'],runId:opts['--run-id'],root:opts['--root'],
      workspaceRoot:opts['--workspace-root'],input:lines,
    });
    process.stdout.write(JSON.stringify(result,null,2) + '\n');
  } catch (error) {
    // Neither private paths nor trace contents must be reflected to logs.
    const reason = error instanceof CaptureError ? error.message : 'private evidence I/O failed';
    process.stderr.write('Phase 8 capture rejected: ' + reason + '\n');
    process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
