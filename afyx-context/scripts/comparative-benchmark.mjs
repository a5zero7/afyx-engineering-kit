import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { getEncoding } from 'js-tiktoken';
import { BENCHMARK_FIXTURES, rawContext } from '../benchmark/fixtures.mjs';
import { ACE_INTEGRATION_CONTRACT, AceError, AfyxContextEngine, createOptionalIntegrationAdapter } from '../src/index.js';

const SOURCE_SHA = '594452d4722d4135ef04643639c1ad16c2c5e681';
const DEFAULT_SAMPLE_COUNT = 7;
const TOKENIZER = Object.freeze({ package: 'js-tiktoken', version: '1.0.21', encoding: 'o200k_base', license: 'MIT' });
const encoder = getEncoding(TOKENIZER.encoding);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function utf8Bytes(value) {
  return Buffer.byteLength(value, 'utf8');
}

function tokens(value) {
  return encoder.encode(value).length;
}

function parseOptions(args) {
  const options = { output: null, sampleCount: DEFAULT_SAMPLE_COUNT, summaryOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output') options.output = args[++index];
    else if (argument === '--samples') options.sampleCount = Number(args[++index]);
    else if (argument === '--summary') options.summaryOnly = true;
    else if (!argument.startsWith('-') && options.output === null) options.output = argument;
    else throw new Error(`unknown benchmark argument: ${argument}`);
  }
  if (!Number.isSafeInteger(options.sampleCount) || options.sampleCount < 1 || options.sampleCount > 20) {
    throw new Error('--samples must be a safe integer from 1 to 20');
  }
  if (options.output !== null && (typeof options.output !== 'string' || options.output.length === 0)) {
    throw new Error('--output requires a path');
  }
  return options;
}

function metric(value) {
  return { chars: value.length, utf8Bytes: utf8Bytes(value), tokens: tokens(value) };
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function aggregate(values) {
  return { min: Math.min(...values), median: median(values), max: Math.max(...values) };
}

function cpuSnapshot() {
  return os.cpus().reduce((totals, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: totals.idle + cpu.times.idle, total: totals.total + total };
  }, { idle: 0, total: 0 });
}

async function sampleHostLoad(sampleCount = 5, intervalMs = 250) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const before = cpuSnapshot();
    const startedAt = new Date().toISOString();
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const after = cpuSnapshot();
    const actualCadenceMs = performance.now() - started;
    const totalDelta = after.total - before.total;
    const idleDelta = after.idle - before.idle;
    samples.push({
      startedAt,
      actualCadenceMs,
      utilizationPercent: totalDelta === 0 ? 0 : ((totalDelta - idleDelta) / totalDelta) * 100,
    });
  }
  return {
    requestedSampleCount: sampleCount,
    requestedIntervalMs: intervalMs,
    samples,
    meanUtilizationPercent: samples.reduce((sum, sample) => sum + sample.utilizationPercent, 0) / samples.length,
    freeMemoryBytes: os.freemem(),
  };
}

function runWorker(fixtureId, mode) {
  const started = performance.now();
  const child = spawnSync(process.execPath, [path.join(import.meta.dirname, 'comparative-worker.mjs')], {
    input: JSON.stringify({ fixtureId, mode }),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const processWallMs = performance.now() - started;
  if (child.status !== 0) throw new Error(`worker failed for ${fixtureId}/${mode}: ${child.stderr || child.stdout}`);
  return { ...JSON.parse(child.stdout), processWallMs };
}

function accounting(fixture, worker) {
  const raw = rawContext(fixture);
  const rendered = worker.result.renderedContext;
  const recoveryExchange = worker.recoveries.map((recovery) => {
    const request = JSON.stringify({ operation: 'ace.get/v1', reference: recovery.reference });
    const response = recovery.content;
    return { id: recovery.id, reference: recovery.reference, digest: recovery.digest, request: metric(request), response: metric(response) };
  });
  const recoveryText = recoveryExchange.map((entry, index) => {
    const recovery = worker.recoveries[index];
    return `${JSON.stringify({ operation: 'ace.get/v1', reference: entry.reference })}\n${recovery.content}`;
  }).join('\n');
  const net = `${rendered}${recoveryText.length > 0 ? `\n${recoveryText}` : ''}`;
  const rawMetric = metric(raw);
  const aceMetric = metric(rendered);
  const netMetric = metric(net);
  return {
    raw: rawMetric,
    aceGross: aceMetric,
    recovery: {
      count: recoveryExchange.length,
      requestTokens: recoveryExchange.reduce((total, entry) => total + entry.request.tokens, 0),
      responseTokens: recoveryExchange.reduce((total, entry) => total + entry.response.tokens, 0),
      exchanges: recoveryExchange,
    },
    aceNetAfterRecovery: netMetric,
    grossSavedTokens: rawMetric.tokens - aceMetric.tokens,
    netSavedTokens: rawMetric.tokens - netMetric.tokens,
    grossReductionRatio: rawMetric.tokens === 0 ? 0 : (rawMetric.tokens - aceMetric.tokens) / rawMetric.tokens,
    netReductionRatio: rawMetric.tokens === 0 ? 0 : (rawMetric.tokens - netMetric.tokens) / rawMetric.tokens,
    serialization: {
      request: metric(JSON.stringify({ segments: fixture.segments, budgetChars: fixture.budgetChars })),
      result: metric(JSON.stringify(worker.result)),
    },
  };
}

function expectAceError(action, code) {
  try {
    action();
  } catch (error) {
    if (error instanceof AceError && error.code === code) return 'PASS';
    throw error;
  }
  throw new Error(`expected ${code}`);
}

function validateCallerFallback(result) {
  if (result.status !== 'fallback') return result.renderedContext;
  if (result.originalComplete) return result.renderedContext;
  if (Array.isArray(result.originalInput) && result.originalInput.every((item) => item && typeof item === 'object' && typeof item.content === 'string')) {
    return result.originalInput;
  }
  throw new AceError('INCOMPLETE_ORIGINAL', 'caller cannot safely reconstruct incomplete fallback');
}

function correctnessChecks() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-291-correctness-'));
  try {
    const fixture = BENCHMARK_FIXTURES.find((candidate) => candidate.id === 'repeat-heavy-v1');
    const engine = new AfyxContextEngine({ stateDir, ownerId: 'correctness-owner', sessionId: 'session-a' });
    const result = engine.reduce({ segments: fixture.segments, budgetChars: fixture.budgetChars });
    const references = result.items.filter((item) => item.disposition === 'reference');
    if (references.length === 0) throw new Error('correctness fixture emitted no references');
    for (const item of references) {
      const expected = fixture.segments.find((segment) => segment.id === item.id).content;
      if (engine.retrieve(item.reference) !== expected) throw new Error(`incorrect recovery for ${item.id}`);
    }
    const protectedItem = result.items.find((item) => item.classification === 'diagnostic');
    if (protectedItem?.disposition !== 'original' || !result.renderedContext.includes('E_REPEAT_BOUNDARY')) {
      throw new Error('protected diagnostic was not preserved');
    }
    const otherSession = new AfyxContextEngine({ stateDir, ownerId: 'correctness-owner', sessionId: 'session-b' });
    const crossSession = expectAceError(() => otherSession.retrieve(references[0].reference), 'REFERENCE_BOUNDARY');
    const foreignOwner = expectAceError(
      () => new AfyxContextEngine({ stateDir, ownerId: 'foreign-owner', sessionId: 'session-a' }),
      'FOREIGN_STATE',
    );

    const adapter = createOptionalIntegrationAdapter({ component: 'graph' });
    const validOversized = Array.from({ length: 9 }, (_, index) => ({ id: `large-${index}`, content: 'x'.repeat(1_048_576) }));
    const retained = adapter.process({
      contract: ACE_INTEGRATION_CONTRACT,
      component: 'graph',
      segments: validOversized,
    });
    if (retained.originalComplete !== false || validateCallerFallback(retained) !== validOversized) {
      throw new Error('caller did not retain valid originalInput when rendered fallback was incomplete');
    }
    const malformed = adapter.process({
      contract: ACE_INTEGRATION_CONTRACT,
      component: 'graph',
      segments: [null, { id: 'valid', content: 'retained synthetic content' }],
    });
    const malformedFailClosed = expectAceError(() => validateCallerFallback(malformed), 'INCOMPLETE_ORIGINAL');
    const passthroughFixture = BENCHMARK_FIXTURES.find((candidate) => candidate.id === 'protected-passthrough-v1');
    const passthroughState = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-291-passthrough-'));
    try {
      const passthroughEngine = new AfyxContextEngine({ stateDir: passthroughState, ownerId: 'passthrough-owner', sessionId: 'passthrough' });
      const passthrough = passthroughEngine.reduce({ segments: passthroughFixture.segments, budgetChars: passthroughFixture.budgetChars });
      if (passthrough.mode !== 'passthrough' || passthrough.renderedContext !== rawContext(passthroughFixture)) {
        throw new Error('passthrough was not byte-complete');
      }
    } finally {
      fs.rmSync(passthroughState, { recursive: true, force: true });
    }
    return {
      exactOriginalRecovery: 'PASS',
      protectedContentPreservation: 'PASS',
      crossSessionRejection: crossSession,
      foreignOwnerRejection: foreignOwner,
      incompleteFallbackRetainsValidOriginalInput: 'PASS',
      malformedIncompleteFallbackFailsClosed: malformedFailClosed,
      passthroughCompleteness: 'PASS',
    };
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

function summarize(samples) {
  return {
    constructionMs: aggregate(samples.map((sample) => sample.timing.constructionMs)),
    reduceMs: aggregate(samples.map((sample) => sample.timing.reduceMs)),
    recoveryMs: aggregate(samples.map((sample) => sample.timing.recoveryMs)),
    processWallMs: aggregate(samples.map((sample) => sample.processWallMs)),
    rssTwoPointObservedMaxBytes: aggregate(samples.map((sample) => sample.process.rssTwoPointObservedMaxBytes)),
    rssDeltaBytes: aggregate(samples.map((sample) => sample.process.rssAfterBytes - sample.process.rssBeforeBytes)),
    cpuUserMicroseconds: aggregate(samples.map((sample) => sample.process.cpuUserMicroseconds)),
    cpuSystemMicroseconds: aggregate(samples.map((sample) => sample.process.cpuSystemMicroseconds)),
  };
}

const options = parseOptions(process.argv.slice(2));
const hostLoadBefore = await sampleHostLoad();
const toolingFiles = [
  path.join(import.meta.dirname, 'comparative-benchmark.mjs'),
  path.join(import.meta.dirname, 'comparative-worker.mjs'),
  path.join(import.meta.dirname, '..', 'benchmark', 'fixtures.mjs'),
];
const toolingIdentity = sha256(toolingFiles.map((file) => `${path.basename(file)}\0${fs.readFileSync(file)}`).join('\0'));
const fixtureResults = [];
for (const fixture of BENCHMARK_FIXTURES) {
  const fixtureIdentity = sha256(JSON.stringify(fixture));
  const modes = {};
  for (const mode of ['cold', 'warm']) {
    const rawSamples = Array.from({ length: options.sampleCount }, () => runWorker(fixture.id, mode));
    const samples = rawSamples.map((sample, index) => ({
      sample: index + 1,
      mode,
      resultMode: sample.result.mode,
      resultReason: sample.result.reason ?? null,
      accounting: accounting(fixture, sample),
      timing: sample.timing,
      process: sample.process,
      processWallMs: sample.processWallMs,
      outputIdentity: sha256(JSON.stringify({ renderedContext: sample.result.renderedContext, items: sample.result.items })),
    }));
    if (new Set(samples.map((sample) => sample.outputIdentity)).size !== 1) {
      throw new Error(`non-deterministic ${fixture.id}/${mode} output`);
    }
    modes[mode] = { samples, aggregate: summarize(rawSamples) };
  }
  fixtureResults.push({
    id: fixture.id,
    description: fixture.description,
    fixtureIdentity,
    budgetChars: fixture.budgetChars,
    recoveryPolicy: fixture.recovery,
    coldAccounting: modes.cold.samples[0].accounting,
    warmAccounting: modes.warm.samples[0].accounting,
    modes,
  });
}

const evidence = {
  schema: 'afyx.ace.comparative-benchmark/v1',
  generatedAt: new Date().toISOString(),
  foundationSourceSha: SOURCE_SHA,
  benchmarkToolingIdentity: toolingIdentity,
  aceVersion: '0.1.0',
  methodology: {
    pairedPaths: ['raw-context', 'native-ace'],
    sampleCountPerFixtureMode: options.sampleCount,
    modes: {
      cold: 'fresh process, fresh state, one measured reduce',
      warm: 'fresh process and state, one unmeasured warm-up reduce, then one measured reduce',
    },
    tokenizer: TOKENIZER,
    tokenDisclaimer: 'Tokenizer counts are o200k_base encoding counts, not provider-billed usage, cache savings, or model/network cost.',
    resourceDisclaimer: 'RSS maximum is the larger of before/after observations, not a continuously sampled instantaneous peak or incremental ACE-only allocation.',
    serializationDisclaimer: 'Serialized request/result metrics are operational protocol overhead and are reported separately from model-context accounting.',
  },
  environment: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    cpuModel: os.cpus()[0]?.model ?? null,
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    hostLoadBefore,
  },
  correctness: correctnessChecks(),
  fixtures: fixtureResults,
  headroom: {
    version: '0.37.0',
    status: 'NOT_RUN',
    comparability: 'BLOCKED',
    reason: 'The installed interface exposes a provider proxy and evaluation commands over LLM or recorded-session workflows, not a standalone equivalent context transform. A run would require new proxy/upstream routing, credentials or a non-equivalent dummy protocol and could touch external model/cache state. Existing configured routing and private sessions were intentionally not used.',
  },
};
evidence.environment.hostLoadAfter = await sampleHostLoad();
evidence.evidenceIdentity = sha256(JSON.stringify({ ...evidence, generatedAt: null, environment: { ...evidence.environment, totalMemoryBytes: null } }));
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
const summary = JSON.stringify({
  schema: evidence.schema,
  foundationSourceSha: evidence.foundationSourceSha,
  benchmarkToolingIdentity: evidence.benchmarkToolingIdentity,
  fixtureCount: evidence.fixtures.length,
  sampleCount: evidence.fixtures.length * 2 * options.sampleCount,
  correctness: [...new Set(Object.values(evidence.correctness))],
  headroomComparability: evidence.headroom.comparability,
  evidenceIdentity: evidence.evidenceIdentity,
});
if (options.output) {
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(options.output, serialized, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${summary}\n`);
} else if (options.summaryOnly) {
  process.stdout.write(`${summary}\n`);
} else {
  process.stdout.write(serialized);
}
encoder.free?.();
