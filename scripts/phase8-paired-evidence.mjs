#!/usr/bin/env node
// Phase 8 paired evidence intake. No provider execution, repository writes, or raw trace publication.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const legacyCoverage = ['toolEvents', 'humanEvents', 'reworkEvents', 'providerUsage'];
const evidenceMetrics = {
  human_intervention: ['humanEvents', 'humanInterventions', 'human', 'human_observation'],
  policy_denial: ['policyEvents', 'policyDenials', 'policy', 'policy_event'],
  agent_fallback: ['fallbackEvents', 'agentFallbacks', 'agent', 'agent_event'],
  agent_recovery: ['recoveryEvents', 'agentRecoveries', 'agent', 'agent_event'],
  explicit_retry: ['retryEvents', 'explicitRetries', 'agent', 'agent_event'],
  rework: ['reworkEvents', 'reworkEvents', null, 'artifact_revision'],
};
const coverageKeys = [...new Set([...legacyCoverage, ...Object.values(evidenceMetrics).map(([key]) => key)])];
const hash = value => typeof value === 'string' && SHA.test(value);
const envelope = ['id', 'runId', 'at'];
function check(ok, why) { if (!ok) throw Error(why); }
function required(obj, fields, label) {
  check(obj && typeof obj === 'object' && !Array.isArray(obj), label + ' must be an object');
  fields.forEach(key => check(Object.hasOwn(obj, key), label + ' missing ' + key));
}
function readFile(file) {
  const cap = 4 * 1024 * 1024;
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.size <= cap, 'file exceeds 4 MiB or is not regular');
    const bytes = Buffer.allocUnsafe(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    check(length === stat.size, 'evidence file size changed while reading');
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
export function parseEvidenceJson(text) {
  const value = JSON.parse(text);
  // JSON.parse accepts duplicate names. Scan object keys after syntax checking
  // so contradictory fields cannot silently collapse to the last value.
  const stack = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"(\s*:)?|[{}\[\]]/g)) {
    if (match[0] === '{' || match[0] === '[') stack.push(new Set());
    else if (match[0] === '}' || match[0] === ']') stack.pop();
    else if (match[1]) {
      const key = JSON.parse(match[0].slice(0, -match[1].length));
      const current = stack.at(-1);
      check(!current.has(key), 'duplicate JSON property');
      current.add(key);
    }
  }
  return value;
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
  const match = typeof at === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(at);
  check(match, 'timestamp requires ISO timezone');
  const local = Date.parse(match[1] + 'Z');
  check(Number.isFinite(local) && new Date(local).toISOString().slice(0, 19) === match[1] &&
    !match[1].startsWith('0000'), 'invalid timestamp calendar');
  const value = Date.parse(at);
  check(Number.isFinite(value), 'invalid timestamp');
  return value;
}
function exact(obj, fields) {
  required(obj, fields, 'event');
  check(Object.keys(obj).length === fields.length, 'unsupported event fields: capture only typed telemetry, no text or secrets');
}

// The recorder and intake use the same stateful checks. Hashes reference
// evidence kept by the operator and do not authenticate an actor by themselves.
export function validateTelemetry(event, state, enveloped = false) {
  const kind = event?.kind;
  const keys = fields => exact(event, ['kind', ...fields, ...(enveloped ? envelope : [])]);
  if (kind === 'start' || kind === 'end') {
    check(enveloped, 'unexpected capture boundary');
    keys([]);
    return;
  }
  if (kind === 'tool_call') {
    keys(['actor']);
    check(event.actor === 'agent', 'tool_call must identify agent actor');
    return;
  }
  if (kind === 'provider_usage') {
    keys(['source','usageSemantics','inputTokens','cachedInputTokens','outputTokens']);
    check(event.source === 'provider_report', 'provider usage provenance missing');
    check(event.usageSemantics === 'per_turn_delta', 'cumulative usage snapshots cannot be summed as per-turn deltas');
    for (const field of ['inputTokens','cachedInputTokens','outputTokens']) integer(event[field], field);
    check(event.cachedInputTokens <= event.inputTokens, 'cached token count exceeds input');
    return;
  }
  const contract = Object.hasOwn(evidenceMetrics, kind) ? evidenceMetrics[kind] : null;
  const first = kind === 'operation_attempt';
  check(contract || first, 'unknown event kind');
  const attempt = first || kind === 'explicit_retry';
  const revision = kind === 'rework';
  const extra = attempt ? ['operationSha256','attemptIndex']
    : revision ? ['artifactSha256','revisionBeforeSha256','revisionAfterSha256'] : [];
  keys(['actor','source','evidenceSha256', ...extra]);
  const actor = first ? 'agent' : contract[2];
  check(actor === null ? ['agent','human'].includes(event.actor) : event.actor === actor,
    'invalid actor attribution');
  check(event.source === (first ? 'agent_event' : contract[3]) && hash(event.evidenceSha256), 'event provenance missing');
  check(!state.references.has(event.evidenceSha256), 'duplicate evidence reference');
  state.references.add(event.evidenceSha256);
  if (attempt) {
    check(hash(event.operationSha256) && Number.isSafeInteger(event.attemptIndex), 'invalid attempt identity');
    const previous = state.attempts.get(event.operationSha256);
    check(first ? previous === undefined && event.attemptIndex === 1
      : previous !== undefined && event.attemptIndex === previous + 1, 'duplicate or unlinked attempt');
    state.attempts.set(event.operationSha256, event.attemptIndex);
  }
  if (revision) {
    const { artifactSha256, revisionBeforeSha256: before, revisionAfterSha256: after } = event;
    check(hash(artifactSha256) && hash(before) && hash(after) && before !== after, 'invalid rework lineage');
    const previous = state.revisions.get(artifactSha256);
    check(previous === undefined || previous === before, 'discontinuous rework lineage');
    state.revisions.set(artifactSha256, after);
  }
}
export function telemetryState() {
  return { references: new Set(), attempts: new Map(), revisions: new Map() };
}
function integer(value, name) {
  check(Number.isSafeInteger(value) && value >= 0, name + ' must be nonnegative integer');
  return value;
}
function capture(run, root, pairedReferences) {
  required(run, ['mode', 'runId', 'eventsFile', 'eventsSha256', 'quality', 'coverage', 'timing'], 'run');
  check(typeof run.runId === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(run.runId), 'invalid runId');
  check(hash(run.eventsSha256), 'invalid trace digest');
  required(run.timing, ['capture','liveReceiptSha256'], 'timing');
  check(['LIVE_MONITORED','REPLAY_OR_UNVERIFIED'].includes(run.timing.capture), 'invalid timing capture');
  check(run.timing.capture === 'LIVE_MONITORED'
    ? hash(run.timing.liveReceiptSha256)
    : run.timing.liveReceiptSha256 === null, 'live timing requires external receipt digest; replay must not claim one');
  required(run.coverage, legacyCoverage, 'coverage');
  const coverage = {};
  const coverageReceipts = {};
  const receipts = Object.hasOwn(run, 'coverageReceipts') ? run.coverageReceipts : {};
  required(receipts, [], 'coverage receipts');
  for (const k of Object.keys(receipts)) check(coverageKeys.includes(k), 'unknown coverage receipt category');
  for (const k of coverageKeys) {
    const declared = Object.hasOwn(run.coverage, k) ? run.coverage[k] : false;
    check(typeof declared === 'boolean', 'coverage flag must be boolean: ' + k);
    if (Object.hasOwn(receipts, k)) {
      const proof = receipts[k];
      required(proof, ['receiptSha256','traceSha256'], 'coverage receipt');
      check(declared && hash(proof.receiptSha256) && proof.traceSha256 === run.eventsSha256,
        'coverage receipt must bind a declared complete category to this trace');
      coverageReceipts[k] = {receiptSha256:proof.receiptSha256,traceSha256:proof.traceSha256};
    }
    coverage[k] = declared;
  }
  required(run.quality, ['correctness', 'tests', 'security', 'evaluatorReceiptSha256'], 'quality');
  ['correctness', 'tests', 'security'].forEach(k => check(['PASS','FAIL','NOT_RUN'].includes(run.quality[k]), 'invalid quality: ' + k));
  const receipt = run.quality.evaluatorReceiptSha256;
  check(receipt === null || hash(receipt), 'invalid evaluator receipt digest');
  check(receipt !== null || ['correctness','tests','security'].every(k => run.quality[k] === 'NOT_RUN'), 'quality claims without evaluator receipt');

  const bytes = readFile(localTrace(root, run.eventsFile));
  check(digest(bytes) === run.eventsSha256, run.mode + ': trace SHA256 mismatch');
  let lines;
  try { lines = new TextDecoder('utf-8', {fatal:true}).decode(bytes).split(/\r?\n/).filter(Boolean); }
  catch { throw Error('invalid trace UTF-8'); }
  check(lines.length >= 2 && lines.length <= 20000, 'trace event count out of bounds');
  const ids = new Set();
  let start = null, end = null, previous = null, calls = 0;
  const state = telemetryState();
  const counts = Object.fromEntries(Object.keys(evidenceMetrics).map(kind => [kind,0]));
  const legacy = new Set();
  let usageEvents = 0, input = 0, cached = 0, output = 0;
  for (let i = 0; i < lines.length; i++) {
    let e; try { e = parseEvidenceJson(lines[i]); } catch { throw Error('invalid event JSON at line ' + (i + 1)); }
    required(e, ['id', 'kind', 'at', 'runId'], 'event');
    check(e.runId === run.runId && typeof e.id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(e.id) && !ids.has(e.id), 'duplicate/foreign event identity');
    ids.add(e.id);
    const at = parseTime(e.at);
    check(previous === null || at >= previous, 'nonmonotonic event timeline');
    previous = at;
    // Older traces kept only actor labels. Preserve intake while leaving
    // attribution/lineage and completeness unknown for those categories.
    const old = ['human_intervention','rework'].includes(e.kind) && Object.keys(e).length === 5;
    if (old) {
      exact(e, ['kind','actor', ...envelope]);
      check(e.kind === 'human_intervention' ? e.actor === 'human' : ['agent','human'].includes(e.actor), 'invalid actor attribution');
      legacy.add(e.kind);
    } else validateTelemetry(e, state, true);
    if (e.kind === 'start') {
      check(i === 0 && start === null, 'start must be unique and first'); start = at;
    } else if (e.kind === 'end') {
      check(i === lines.length - 1 && end === null, 'end must be unique and last'); end = at;
    } else if (e.kind === 'tool_call') {
      calls++;
    } else if (Object.hasOwn(counts, e.kind) && !old) {
      counts[e.kind]++;
    } else if (e.kind === 'provider_usage') {
      check(e.source === 'provider_report', 'provider usage provenance missing');
      check(e.usageSemantics === 'per_turn_delta', 'cumulative usage snapshots cannot be summed as per-turn deltas');
      input = integer(input + e.inputTokens, 'aggregate inputTokens');
      cached = integer(cached + e.cachedInputTokens, 'aggregate cachedInputTokens');
      output = integer(output + e.outputTokens, 'aggregate outputTokens');
      usageEvents++;
    }
    check(start !== null, 'event before start');
  }
  check(start !== null && end !== null && end >= start, 'invalid start/end');
  check(cached <= input, 'cached token count exceeds input');
  check(!run.coverage.providerUsage || usageEvents > 0, 'declared provider coverage without usage');
  for (const ref of state.references) {
    check(!pairedReferences.has(ref), 'evidence reference reused across paired runs');
    pairedReferences.add(ref);
  }
  if (!calls && !coverageReceipts.toolEvents) coverage.toolEvents = false;
  const observed = (key, value) => coverage[key] ? value : null;
  const eventEvidence = {};
  for (const [kind, [key, metric]] of Object.entries(evidenceMetrics)) {
    const complete = Boolean(coverageReceipts[key]) && !legacy.has(kind);
    if (!complete) coverage[key] = false;
    eventEvidence[metric] = {availability:complete ? 'COMPLETE_CAPTURE_SCOPE_ONLY' : counts[kind] ? 'PARTIAL' : 'NOT_AVAILABLE',
      observedMinimum:counts[kind] || (complete ? 0 : null), total:complete ? counts[kind] : null};
  }
  return {
    mode: run.mode,
    runIdDigest: digest(run.runId),
    traceSha256: run.eventsSha256,
    quality: {correctness:run.quality.correctness,tests:run.quality.tests,security:run.quality.security,evaluatorReceiptSha256:receipt},
    declaredCoverage: Object.fromEntries(coverageKeys.map(k => [k,run.coverage[k] ?? false])),
    effectiveCoverage: coverage,
    coverageReceipts,
    timing: {capture:run.timing.capture,liveReceiptSha256:run.timing.liveReceiptSha256},
    eventEvidence,
    observations: {
      wallMs: run.timing.capture === 'LIVE_MONITORED' ? end - start : null,
      toolCalls: observed('toolEvents', calls),
      ...Object.fromEntries(Object.entries(eventEvidence).map(([metric, evidence]) => [metric,evidence.total])),
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
  for (const key of ['taskSha256','oracleSha256','permissionsSha256','environmentSha256']) check(hash(manifest[key]), 'invalid digest: ' + key);
  check(typeof manifest.sourceRevision === 'string' && GIT.test(manifest.sourceRevision), 'invalid source revision');
  for (const key of ['model','effort']) check(typeof manifest[key] === 'string' && manifest[key].trim().length > 0 && manifest[key].length < 200, 'invalid ' + key);
  check(Array.isArray(manifest.runs) && manifest.runs.length === 2 &&
    manifest.runs[0].mode === 'OFF' && manifest.runs[1].mode === 'ON', 'requires ordered OFF and ON runs');
  check(manifest.runs[0].runId !== manifest.runs[1].runId, 'paired run identities must differ');
  const root = fs.realpathSync.native(path.dirname(path.resolve(file)));
  const pairedReferences = new Set();
  const [off, on] = manifest.runs.map(run => capture(run, root, pairedReferences));
  const qualities = [off,on].flatMap(run => ['correctness','tests','security'].map(k => run.quality[k]));
  const synthetic = manifest.evidenceClass === 'synthetic_fixture';
  const failed = qualities.includes('FAIL');
  const incomplete = qualities.includes('NOT_RUN');
  const comparable = !failed && (synthetic || !incomplete);
  const metrics = {};
  for (const key of Object.keys(off.observations)) {
    const a = off.observations[key], b = on.observations[key];
    metrics[key] = comparable && a !== null && b !== null
      ? {off:a,on:b,deltaOnMinusOff:b-a,percentOnMinusOff:a>0?Number(((b-a)*100/a).toFixed(2)):null}
      : {off:a,on:b,deltaOnMinusOff:null,percentOnMinusOff:null,status:failed ? 'HARD_GATE_FAILED' : 'NOT_AVAILABLE'};
  }
  const verdict = failed ? 'HARD_GATE_FAILED' : synthetic ? 'SYNTHETIC_ONLY'
    : incomplete ? 'QUALITY_EVIDENCE_INCOMPLETE' : 'ELIGIBLE_FOR_INDEPENDENT_REVIEW';
  return {
    contract:'afyx.phase8.paired-summary/v1',
    caseIdDigest:digest(manifest.caseId),
    evidenceClass:manifest.evidenceClass,
    sourceRevision:manifest.sourceRevision,
    pairing:{
      taskSha256:manifest.taskSha256,
      oracleSha256:manifest.oracleSha256,
      permissionsSha256:manifest.permissionsSha256,
      environmentSha256:manifest.environmentSha256,
      modelDigest:digest(manifest.model), effortDigest:digest(manifest.effort),
    },
    off,on,comparativeMetrics:metrics,verdict,
    evidenceStatus:synthetic ? 'SYNTHETIC_ONLY'
      : Object.values(metrics).some(metric => metric.off !== null || metric.on !== null) ||
        [off,on].some(run => Object.values(run.eventEvidence).some(event => event.observedMinimum !== null))
        ? 'OBSERVED_PARTIAL' : 'NOT_AVAILABLE',
    measurementProvenance:{
      scope:synthetic ? 'SYNTHETIC_FIXTURE_PAIR' : 'DECLARED_LOCAL_PAIR',
      wallMs:'TRACE_BOUNDARIES_WITH_DECLARED_LIVE_RECEIPT',
      tokens:'PROVIDER_REPORTED_PER_TURN_DELTA_DECLARED_BY_HOST',
      toolCalls:'TYPED_CAPTURE_WITH_DECLARED_COVERAGE',
      interventionAndRework:'TYPED_CAPTURE_WITH_TRACE_BOUND_COVERAGE_RECEIPT',
      providerCost:'NOT_AVAILABLE',
    },
    independentAcceptance:'NOT_VERIFIED',
    provenance:'Local structured trace hashes verified; evaluator receipts and capture completeness are declared, not independently authenticated.',
    warnings:[
      'Valid intake does not prove engineering correctness, provider billing, or installed Alpha acceptance.',
      'Timing receipts and per-turn token semantics are asserted by the source host; independent reviewer must verify provenance.',
      ...(off.observations.wallMs === null || on.observations.wallMs === null ? ['wallMs: NOT_AVAILABLE; replay/receipt times are not agent execution duration'] : []),
      ...coverageKeys.filter(k => !off.effectiveCoverage[k] || !on.effectiveCoverage[k]).map(k => k + ': NOT_AVAILABLE for complete paired comparison'),
    ],
  };
}
export function loadManifest(file) {
  const absolute = path.resolve(file), stat = fs.lstatSync(absolute);
  check(stat.isFile() && !stat.isSymbolicLink(), 'manifest must be a regular file');
  let input;
  const bytes = readFile(absolute);
  try { input = parseEvidenceJson(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw Error('manifest JSON invalid'); }
  return {...evaluateManifest(input, absolute), manifestSha256:digest(bytes)};
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
