#!/usr/bin/env node
// Phase 8 paired evidence intake. No provider execution, repository writes, or raw trace publication.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const coverageKeys = ['toolEvents', 'humanEvents', 'reworkEvents', 'providerUsage'];
function check(ok, why) { if (!ok) throw Error(why); }
function required(obj, fields, label) {
  check(obj && typeof obj === 'object' && !Array.isArray(obj), label + ' must be an object');
  fields.forEach(key => check(Object.hasOwn(obj, key), label + ' missing ' + key));
}
function readFile(file) {
  check(fs.statSync(file).size <= 4 * 1024 * 1024, 'file exceeds 4 MiB');
  return fs.readFileSync(file);
}
function localTrace(root, name) {
  check(typeof name === 'string' && name.length > 0 && name.length < 1024, 'invalid trace filename');
  check(!path.isAbsolute(name) && !/^[A-Za-z]:/.test(name) && !name.includes('\\'), 'trace must be relative');
  const parts = name.split('/');
  check(parts.every(part => part && part !== '..' && part !== '.'), 'trace traversal is forbidden');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    check(!fs.lstatSync(current).isSymbolicLink(), 'symlink trace forbidden');
  }
  check(fs.statSync(current).isFile(), 'trace must be a regular file');
  return current;
}
function parseTime(at) {
  check(typeof at === 'string' && /^\d{4}-\d\d-\d\dT/.test(at) && /(?:Z|[+-]\d\d:\d\d)$/.test(at), 'timestamp requires ISO timezone');
  const value = Date.parse(at);
  check(Number.isFinite(value), 'invalid timestamp');
  return value;
}
function integer(value, name) {
  check(Number.isSafeInteger(value) && value >= 0, name + ' must be nonnegative integer');
  return value;
}
function capture(run, root) {
  required(run, ['mode', 'runId', 'eventsFile', 'eventsSha256', 'quality', 'coverage', 'timing'], 'run');
  check(typeof run.runId === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(run.runId), 'invalid runId');
  check(SHA.test(run.eventsSha256), 'invalid trace digest');
  required(run.timing, ['capture','liveReceiptSha256'], 'timing');
  check(['LIVE_MONITORED','REPLAY_OR_UNVERIFIED'].includes(run.timing.capture), 'invalid timing capture');
  check(run.timing.capture === 'LIVE_MONITORED'
    ? SHA.test(run.timing.liveReceiptSha256)
    : run.timing.liveReceiptSha256 === null, 'live timing requires external receipt digest; replay must not claim one');
  required(run.coverage, coverageKeys, 'coverage');
  coverageKeys.forEach(k => check(typeof run.coverage[k] === 'boolean', 'coverage flag must be boolean: ' + k));
  required(run.quality, ['correctness', 'tests', 'security', 'evaluatorReceiptSha256'], 'quality');
  ['correctness', 'tests', 'security'].forEach(k => check(['PASS','FAIL','NOT_RUN'].includes(run.quality[k]), 'invalid quality: ' + k));
  const receipt = run.quality.evaluatorReceiptSha256;
  check(receipt === null || SHA.test(receipt), 'invalid evaluator receipt digest');
  check(receipt !== null || ['correctness','tests','security'].every(k => run.quality[k] === 'NOT_RUN'), 'quality claims without evaluator receipt');

  const bytes = readFile(localTrace(root, run.eventsFile));
  check(digest(bytes) === run.eventsSha256, run.mode + ': trace SHA256 mismatch');
  const lines = bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
  check(lines.length >= 2 && lines.length <= 20000, 'trace event count out of bounds');
  const ids = new Set();
  let start = null, end = null, previous = null, calls = 0, humans = 0, rework = 0;
  let usageEvents = 0, input = 0, cached = 0, output = 0;
  for (let i = 0; i < lines.length; i++) {
    let e; try { e = JSON.parse(lines[i]); } catch { throw Error('invalid event JSON at line ' + (i + 1)); }
    required(e, ['id', 'kind', 'at', 'runId'], 'event');
    check(e.runId === run.runId && typeof e.id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(e.id) && !ids.has(e.id), 'duplicate/foreign event identity');
    ids.add(e.id);
    const at = parseTime(e.at);
    check(previous === null || at >= previous, 'nonmonotonic event timeline');
    previous = at;
    if (e.kind === 'start') {
      check(i === 0 && start === null, 'start must be unique and first'); start = at;
    } else if (e.kind === 'end') {
      check(i === lines.length - 1 && end === null, 'end must be unique and last'); end = at;
    } else if (e.kind === 'tool_call') {
      check(e.actor === 'agent', 'tool_call must identify agent actor'); calls++;
    } else if (e.kind === 'human_intervention') {
      check(e.actor === 'human', 'human action requires human actor'); humans++;
    } else if (e.kind === 'rework') {
      check(['agent','human'].includes(e.actor), 'invalid rework actor'); rework++;
    } else if (e.kind === 'provider_usage') {
      check(e.source === 'provider_report', 'provider usage provenance missing');
      check(e.usageSemantics === 'per_turn_delta', 'cumulative usage snapshots cannot be summed as per-turn deltas');
      input += integer(e.inputTokens, 'inputTokens');
      cached += integer(e.cachedInputTokens, 'cachedInputTokens');
      output += integer(e.outputTokens, 'outputTokens'); usageEvents++;
    } else throw Error('unknown event kind');
    check(start !== null, 'event before start');
  }
  check(start !== null && end !== null && end >= start, 'invalid start/end');
  check(cached <= input, 'cached token count exceeds input');
  check(!run.coverage.providerUsage || usageEvents > 0, 'declared provider coverage without usage');
  const observed = (key, value) => run.coverage[key] ? value : null;
  return {
    mode: run.mode,
    runIdDigest: digest(run.runId),
    traceSha256: run.eventsSha256,
    quality: run.quality,
    declaredCoverage: run.coverage,
    timing: run.timing,
    observations: {
      wallMs: run.timing.capture === 'LIVE_MONITORED' ? end - start : null,
      toolCalls: observed('toolEvents', calls),
      humanInterventions: observed('humanEvents', humans),
      reworkEvents: observed('reworkEvents', rework),
      inputTokens: observed('providerUsage', input),
      cachedInputTokens: observed('providerUsage', cached),
      outputTokens: observed('providerUsage', output),
    },
  };
}
export function evaluateManifest(manifest, file) {
  required(manifest, ['contract','evidenceClass','caseId','taskSha256','oracleSha256','sourceRevision',
    'permissionsSha256','environmentSha256','model','effort','runs'], 'manifest');
  check(manifest.contract === 'afyx.phase8.paired-evidence/v1', 'unsupported contract');
  check(['owner_observed','synthetic_fixture'].includes(manifest.evidenceClass), 'invalid evidenceClass');
  check(typeof manifest.caseId === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(manifest.caseId), 'invalid caseId');
  for (const key of ['taskSha256','oracleSha256','permissionsSha256','environmentSha256']) check(SHA.test(manifest[key]), 'invalid digest: ' + key);
  check(GIT.test(manifest.sourceRevision), 'invalid source revision');
  for (const key of ['model','effort']) check(typeof manifest[key] === 'string' && manifest[key].trim().length > 0 && manifest[key].length < 200, 'invalid ' + key);
  check(Array.isArray(manifest.runs) && manifest.runs.length === 2 &&
    manifest.runs[0].mode === 'OFF' && manifest.runs[1].mode === 'ON', 'requires ordered OFF and ON runs');
  check(manifest.runs[0].runId !== manifest.runs[1].runId, 'paired run identities must differ');
  const root = fs.realpathSync.native(path.dirname(path.resolve(file)));
  const [off, on] = manifest.runs.map(run => capture(run, root));
  const metrics = {};
  for (const key of Object.keys(off.observations)) {
    const a = off.observations[key], b = on.observations[key];
    metrics[key] = a !== null && b !== null
      ? {off:a,on:b,deltaOnMinusOff:b-a,percentOnMinusOff:a>0?Number(((b-a)*100/a).toFixed(2)):null}
      : {off:a,on:b,deltaOnMinusOff:null,percentOnMinusOff:null,status:'NOT_AVAILABLE'};
  }
  const qualities = [off,on].flatMap(run => ['correctness','tests','security'].map(k => run.quality[k]));
  const verdict = manifest.evidenceClass === 'synthetic_fixture' ? 'SYNTHETIC_ONLY'
    : qualities.includes('FAIL') ? 'HARD_GATE_FAILED'
    : qualities.includes('NOT_RUN') ? 'QUALITY_EVIDENCE_INCOMPLETE' : 'ELIGIBLE_FOR_INDEPENDENT_REVIEW';
  return {
    contract:'afyx.phase8.paired-summary/v1',
    caseId:manifest.caseId,
    evidenceClass:manifest.evidenceClass,
    sourceRevision:manifest.sourceRevision,
    pairing:{
      taskSha256:manifest.taskSha256,
      oracleSha256:manifest.oracleSha256,
      permissionsSha256:manifest.permissionsSha256,
      environmentSha256:manifest.environmentSha256,
      model:manifest.model, effort:manifest.effort,
    },
    off,on,comparativeMetrics:metrics,verdict,
    independentAcceptance:'NOT_VERIFIED',
    provenance:'Local structured trace hashes verified; evaluator receipts and capture completeness are declared, not independently authenticated.',
    warnings:[
      'Valid intake does not prove engineering correctness, provider billing, or installed Alpha acceptance.',
      'Timing receipts and per-turn token semantics are asserted by the source host; independent reviewer must verify provenance.',
      ...(off.observations.wallMs === null || on.observations.wallMs === null ? ['wallMs: NOT_AVAILABLE; replay/receipt times are not agent execution duration'] : []),
      ...coverageKeys.filter(k => !off.declaredCoverage[k] || !on.declaredCoverage[k]).map(k => k + ': NOT_AVAILABLE for complete paired comparison'),
    ],
  };
}
export function loadManifest(file) {
  const absolute = path.resolve(file), stat = fs.lstatSync(absolute);
  check(stat.isFile() && !stat.isSymbolicLink(), 'manifest must be a regular file');
  let input;
  try { input = JSON.parse(readFile(absolute).toString('utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) throw Error('manifest JSON invalid');
    throw error;
  }
  return evaluateManifest(input, absolute);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--input') {
    process.stderr.write('Usage: node scripts/phase8-paired-evidence.mjs --input LOCAL_MANIFEST_JSON\n');
    process.exitCode = 2;
  } else {
    try {
      const report = loadManifest(process.argv[3]);
      process.stdout.write(JSON.stringify(report,null,2) + '\n');
      if (['HARD_GATE_FAILED','QUALITY_EVIDENCE_INCOMPLETE'].includes(report.verdict)) process.exitCode = 1;
    } catch (error) {
      // Filesystem and parser errors may embed private paths or excerpts.
      // Print only sanitized reasons for errors whose payload is not controlled here.
      const reason = error && typeof error.code === 'string'
        ? 'local evidence file unavailable or inaccessible'
        : error.message;
      process.stderr.write('Phase 8 evidence rejected: ' + reason + '\n');
      process.exitCode = 2;
    }
  }
}
