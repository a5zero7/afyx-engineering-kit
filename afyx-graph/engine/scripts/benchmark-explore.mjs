#!/usr/bin/env node
/**
 * Product-level explore benchmark for first-call delivery and session-scoped
 * cross-call deduplication. Uses the existing payroll fixture and allocation
 * diagnostic; it does not modify ranking, allocation, or rendering behavior.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const ROUNDS = Number(arg('rounds', 9));
const OUT = arg('out', null);
const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.resolve(arg('dist', path.join(engineRoot, 'dist')));
const fixtureRoot = path.join(engineRoot, '__tests__', 'fixtures', 'payroll-go');
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) throw new Error('--rounds must be a positive integer');
if (!fs.existsSync(path.join(distRoot, 'index.js'))) throw new Error('dist/ is not built: run `npm run build:clean` first');
if (!fs.existsSync(fixtureRoot)) throw new Error(`fixture is missing: ${fixtureRoot}`);

process.env.AFYX_GRAPH_NO_WATCH = '1';
process.env.AFYX_GRAPH_NO_DAEMON = '1';
process.env.AFYX_GRAPH_ALLOW_UNSAFE_NODE = '1';
process.env.AFYX_GRAPH_EXPLORE_DEDUP = '1';

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];
const round = (value) => Math.round(value * 100) / 100;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

function deliveredSource(text) {
  const files = new Map();
  let current = null;
  let inFence = false;
  for (const line of text.split('\n')) {
    const header = /^\*\*`([^`]+)`\*\*/.exec(line);
    if (header && !inFence) { current = header[1]; continue; }
    if (!inFence && current && line.startsWith('```')) { inFence = true; continue; }
    if (inFence && line === '```') { inFence = false; continue; }
    if (!inFence || !current) continue;
    const numbered = /^(\d+)\t(.*)$/.exec(line);
    if (!numbered) continue;
    if (!files.has(current)) files.set(current, new Map());
    files.get(current).set(Number(numbered[1]), numbered[2]);
  }
  return files;
}

function sourceSummary(text, prior = new Map()) {
  const files = deliveredSource(text);
  let lines = 0;
  let ranges = 0;
  let duplicateBytes = 0;
  for (const [file, delivered] of files) {
    const ordered = [...delivered].sort((left, right) => left[0] - right[0]);
    let previous = null;
    for (const [line, content] of ordered) {
      lines += 1;
      if (previous === null || line !== previous + 1) ranges += 1;
      previous = line;
      if (prior.get(file)?.has(line)) duplicateBytes += Buffer.byteLength(`${content}\n`, 'utf8');
    }
  }
  return { files, distinct_files: files.size, lines, ranges, duplicate_bytes: duplicateBytes };
}

function pointerBytes(text) {
  return text.split('\n')
    .filter((line) => line.includes('Already sent earlier in this conversation'))
    .reduce((total, line) => total + Buffer.byteLength(`${line}\n`, 'utf8'), 0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-explore-bench-'));
const diagnostic = path.join(root, 'explore-diagnostic.jsonl');
process.env.AFYX_GRAPH_EXPLORE_DEBUG = diagnostic;
let graph;
try {
  fs.cpSync(fixtureRoot, root, { recursive: true });
  fs.rmSync(path.join(root, '.afyx-graph'), { recursive: true, force: true });
  const graphModule = await import(pathToFileURL(path.join(distRoot, 'index.js')).href);
  const { ToolHandler } = await import(pathToFileURL(path.join(distRoot, 'mcp', 'tools.js')).href);
  const { AfyxSessionContext } = await import(pathToFileURL(path.join(distRoot, 'mcp', 'session-context.js')).href);
  const Graph = graphModule.default?.default ?? graphModule.default;
  graph = Graph.initSync(root);
  await graph.indexAll();
  const handler = new ToolHandler(graph);
  const query = 'how does payroll cycle create and calculate payslips?';
  const firstTimes = [];
  const repeatTimes = [];
  const observations = [];

  for (let run = 0; run < ROUNDS; run += 1) {
    const session = new AfyxSessionContext();
    const execute = () => session.execute(
      'afyx_graph_explore',
      { query },
      (name, prepared) => handler.executeRuntime(name, prepared),
    ).then((result) => result.content[0].text);
    let started = performance.now();
    const first = await execute();
    firstTimes.push(performance.now() - started);
    started = performance.now();
    const repeat = await execute();
    repeatTimes.push(performance.now() - started);
    const firstSource = sourceSummary(first);
    const repeatSource = sourceSummary(repeat, firstSource.files);
    observations.push({
      first_digest: digest(first),
      repeat_digest: digest(repeat),
      first_response_bytes: Buffer.byteLength(first, 'utf8'),
      repeat_response_bytes: Buffer.byteLength(repeat, 'utf8'),
      first_source: firstSource,
      repeat_source: repeatSource,
      repeat_pointer_bytes: pointerBytes(repeat),
    });
  }

  const diagnosticRows = fs.readFileSync(diagnostic, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const firstDiagnostic = diagnosticRows[0];
  const repeatDiagnostic = diagnosticRows[1];
  const stable = observations.every((item) => item.first_digest === observations[0].first_digest
    && item.repeat_digest === observations[0].repeat_digest);
  if (!stable) throw new Error('explore output was not deterministic across rounds');
  if (observations.some((item) => item.repeat_source.duplicate_bytes !== 0)) {
    throw new Error('repeat explore response re-delivered source from the first call');
  }

  const report = {
    generated_by: 'scripts/benchmark-explore.mjs',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    rounds: ROUNDS,
    project: graph.getStats(),
    first_call_ms: { median: round(median(firstTimes)), p95: round(p95(firstTimes)) },
    repeat_call_ms: { median: round(median(repeatTimes)), p95: round(p95(repeatTimes)) },
    correctness: {
      first_digest: observations[0].first_digest,
      repeat_digest: observations[0].repeat_digest,
      deterministic: stable,
    },
    first_call: {
      response_bytes: observations[0].first_response_bytes,
      source_chars: firstDiagnostic.envelope.sourceChars,
      distinct_files: observations[0].first_source.distinct_files,
      files: [...observations[0].first_source.files.keys()],
      ranges: observations[0].first_source.ranges,
      duplicate_bytes: observations[0].first_source.duplicate_bytes,
      unused_allocation_chars: Math.max(0, firstDiagnostic.allocation.pool - firstDiagnostic.envelope.sourceChars),
      hard_cap_utilization: round(firstDiagnostic.envelope.chars / firstDiagnostic.budget.hardCeiling),
    },
    repeat_call: {
      response_bytes: observations[0].repeat_response_bytes,
      source_chars: repeatDiagnostic.envelope.sourceChars,
      distinct_files: observations[0].repeat_source.distinct_files,
      files: [...observations[0].repeat_source.files.keys()],
      ranges: observations[0].repeat_source.ranges,
      duplicate_bytes: observations[0].repeat_source.duplicate_bytes,
      withheld_source_chars: repeatDiagnostic.dedup.savedChars,
      back_referenced_files: repeatDiagnostic.dedup.backReferenced,
      pointer_bytes: observations[0].repeat_pointer_bytes,
      unused_allocation_chars: Math.max(0, repeatDiagnostic.allocation.pool - repeatDiagnostic.envelope.sourceChars),
      hard_cap_utilization: round(repeatDiagnostic.envelope.chars / repeatDiagnostic.budget.hardCeiling),
    },
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(text);
  if (OUT) fs.writeFileSync(path.resolve(OUT), text);
} finally {
  try { graph?.destroy(); } catch { /* already closed */ }
  delete process.env.AFYX_GRAPH_EXPLORE_DEBUG;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
