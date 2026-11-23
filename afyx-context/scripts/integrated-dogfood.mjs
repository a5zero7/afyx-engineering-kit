import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEncoding } from 'js-tiktoken';
import { AceError, createGraphAceConsumer, deriveGraphAceIdentity } from '../src/index.js';
import { nativeAceRunner } from '../src/graph-integration.js';

const contextRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(contextRoot, '..');
const fixtureSource = path.join(contextRoot, 'test-fixtures', 'integrated-dogfood-repo');
const graphDist = path.join(repositoryRoot, 'afyx-graph', 'engine', 'dist');
const encoder = getEncoding('o200k_base');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const tokens = (value) => encoder.encode(value).length;
const textOf = (result) => result.content.map((item) => item.text).join('\n');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a path`);
  return path.resolve(process.argv[index + 1]);
}

function fingerprint(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(path.relative(directory, target).replaceAll('\\', '/'));
    }
  };
  visit(directory);
  return {
    files,
    sha256: sha256(files.map((file) => `${file}\0${sha256(fs.readFileSync(path.join(directory, file)))}`).join('\n')),
  };
}

function entriesNamed(directory, suffix) {
  const found = [];
  const visit = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.name.endsWith(suffix)) found.push(path.relative(directory, target).replaceAll('\\', '/'));
      if (entry.isDirectory()) visit(target);
    }
  };
  visit(directory);
  return found.sort();
}

async function measured(action) {
  const started = performance.now();
  const value = await action();
  return { value, milliseconds: Number((performance.now() - started).toFixed(3)) };
}

async function main() {
  if (!fs.existsSync(path.join(graphDist, 'index.js'))) {
    throw new Error('Afyx Graph dist is missing; run its clean build before integrated dogfood');
  }
  const explicitLab = option('--lab');
  const lab = explicitLab ?? fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'afyx-296-integrated-'));
  if (explicitLab) fs.mkdirSync(lab, { recursive: false });
  const projectRoot = path.join(lab, 'source-fixture');
  const graphState = path.join(lab, 'graph-state');
  const aceRoot = path.join(lab, 'ace-state');
  const evidenceRoot = path.join(lab, 'evidence');
  fs.mkdirSync(evidenceRoot);
  fs.cpSync(fixtureSource, projectRoot, { recursive: true, errorOnExist: true });
  const fixtureBefore = fingerprint(fixtureSource);
  const sourceBefore = fingerprint(projectRoot);
  const sourceIdentity = `sha256:${sourceBefore.sha256}`;
  const priorGraphState = process.env.AFYX_GRAPH_STATE_DIR;
  process.env.AFYX_GRAPH_STATE_DIR = graphState;

  let graph;
  try {
    const graphModule = await import(pathToFileURL(path.join(graphDist, 'index.js')).href);
    const toolsModule = await import(pathToFileURL(path.join(graphDist, 'mcp', 'tools.js')).href);
    const Graph = graphModule.default?.default ?? graphModule.default;
    graph = Graph.initSync(projectRoot);
    const indexing = await measured(() => graph.indexAll());
    const handler = new toolsModule.ToolHandler(graph);
    const executeGraph = (toolName, args) => handler.execute(toolName, args);
    const repeatedArgs = { query: 'afyx_repeated_summary', limit: 100 };
    const uniqueArgs = { query: 'afyx_total_snapshot', limit: 100 };
    const inventoryArgs = { declaration: '_inherit', value: 'sale.order', limit: 100 };
    const raw = await executeGraph('afyx_graph_search', repeatedArgs);
    const uniqueRaw = await executeGraph('afyx_graph_search', uniqueArgs);
    const inventory = await executeGraph('afyx_graph_inventory', inventoryArgs);
    const inventoryPage = await executeGraph('afyx_graph_inventory', { ...inventoryArgs, limit: 1 });
    const xmlFiles = await executeGraph('afyx_graph_files', { pattern: '**/*.xml', format: 'flat' });
    assert.equal(raw.isError, undefined);
    assert.equal(uniqueRaw.isError, undefined);
    assert.match(textOf(raw), /sale_order\.py/);
    assert.match(textOf(inventory), /sale_order\.py/);
    assert.match(textOf(inventory), /sale_order_audit\.py/);
    assert.match(textOf(inventory), /COMPLETE FOR SUPPORTED LITERAL DECLARATIONS/);
    assert.match(textOf(inventoryPage), /PARTIAL PAGE|INCOMPLETE|TRUNCATED|remain/i);
    assert.match(textOf(xmlFiles), /sale_order_views\.xml/);

    const makeConsumer = (scenario, overrides = {}) => {
      const identity = deriveGraphAceIdentity({ projectRoot, sourceIdentity, consumerId: `afyx-296-${scenario}` });
      return createGraphAceConsumer({
        enabled: true,
        stateDir: path.join(aceRoot, scenario),
        ...identity,
        timeoutMs: 5_000,
        ...overrides,
      });
    };
    const base = { executeGraph, toolName: 'afyx_graph_search', projectRoot, sourceIdentity };
    const offMeasured = await measured(() => createGraphAceConsumer().execute({ ...base, args: repeatedArgs }));
    assert.equal(offMeasured.value.status, 'disabled');
    assert.deepEqual(offMeasured.value.consumerResult, raw);

    const repeatedConsumer = makeConsumer('session');
    const first = await measured(() => repeatedConsumer.execute({ ...base, args: repeatedArgs }));
    const repeated = await measured(() => repeatedConsumer.execute({ ...base, args: repeatedArgs }));
    const repeatedItem = repeated.value.ace.items.find((item) => item.disposition === 'reference');
    assert.ok(repeatedItem);
    const recovered = await measured(() => repeatedConsumer.recover(repeatedItem.reference));
    assert.equal(recovered.value.content, textOf(raw));
    assert.ok(recovered.value.observations.some((item) => item.provenance?.sourceIdentity === sourceIdentity));

    const unique = await makeConsumer('unique').execute({ ...base, args: uniqueArgs });
    assert.equal(unique.ace.items[0].disposition, 'original');
    const sourceProtected = await makeConsumer('source').execute({
      ...base,
      toolName: 'afyx_graph_explore',
      args: { query: 'SaleOrder afyx_total_snapshot' },
    });
    assert.equal(sourceProtected.status, 'bypassed');
    assert.equal(sourceProtected.ace, null);
    const diagnostic = await makeConsumer('diagnostic').execute({ ...base, toolName: 'afyx_graph_status', args: {} });
    assert.equal(diagnostic.status, 'bypassed');
    assert.equal(diagnostic.ace, null);
    const security = await makeConsumer('security').execute({
      ...base,
      args: { query: 'SECURITY', limit: 100 },
    });
    assert.equal(security.ace.items[0].classification, 'security');
    assert.equal(security.ace.items[0].disposition, 'original');

    const failures = {};
    for (const [name, runner, expected] of [
      ['unavailable', async () => { throw new Error('unavailable'); }, 'ACE_UNAVAILABLE'],
      ['malformed', async () => ({ unexpected: true }), 'INVALID_ACE_RESULT'],
      ['timeout', (_message, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new AceError('ACE_TIMEOUT', 'timeout')), { once: true });
      }), 'ACE_TIMEOUT'],
      ['incomplete', async () => ({ status: 'fallback', failureCode: 'INVALID_INPUT', originalComplete: false }), 'INVALID_INPUT'],
    ]) {
      const result = await makeConsumer(`failure-${name}`, { timeoutMs: name === 'timeout' ? 10 : 500, aceRunner: runner })
        .execute({ ...base, args: repeatedArgs });
      assert.equal(result.status, 'fallback');
      assert.equal(result.failureCode, expected);
      assert.deepEqual(result.consumerResult, raw);
      failures[name] = expected;
    }

    const concurrentConsumer = makeConsumer('concurrent');
    const concurrent = await Promise.all([
      concurrentConsumer.execute({ ...base, args: repeatedArgs }),
      concurrentConsumer.execute({ ...base, args: repeatedArgs }),
    ]);
    assert.ok(concurrent.every((item) => item.status === 'optimized'));

    const interruptionState = path.join(aceRoot, 'interrupted');
    const interruptionIdentity = deriveGraphAceIdentity({ projectRoot, sourceIdentity, consumerId: 'afyx-296-interrupted' });
    const readyPath = path.join(evidenceRoot, 'interrupted-lock-acquired');
    const interruptedConsumer = createGraphAceConsumer({
      enabled: true,
      stateDir: interruptionState,
      ...interruptionIdentity,
      timeoutMs: 500,
      aceRunner: (message, options) => nativeAceRunner({
        ...message,
        testControl: { phase: 'after-lock-acquired', readyPath },
      }, options),
    });
    const interrupted = await interruptedConsumer.execute({ ...base, args: repeatedArgs });
    assert.equal(interrupted.status, 'fallback');
    assert.equal(interrupted.failureCode, 'ACE_TIMEOUT');
    assert.deepEqual(interrupted.consumerResult, raw);
    assert.equal(fs.existsSync(readyPath), true);
    const retryConsumer = createGraphAceConsumer({ enabled: true, stateDir: interruptionState, ...interruptionIdentity });
    const retry = await retryConsumer.execute({ ...base, args: repeatedArgs });
    assert.equal(retry.status, 'optimized');

    const foreign = createGraphAceConsumer({
      enabled: true,
      stateDir: path.join(aceRoot, 'session'),
      ...deriveGraphAceIdentity({ projectRoot, sourceIdentity: `${sourceIdentity}-foreign`, consumerId: 'afyx-296-session' }),
    });
    await assert.rejects(foreign.recover(repeatedItem.reference), (error) => error.code === 'REFERENCE_BOUNDARY');
    const unsafe = createGraphAceConsumer({
      enabled: true,
      stateDir: path.join(projectRoot, '.unsafe-ace-state'),
      ...deriveGraphAceIdentity({ projectRoot, sourceIdentity, consumerId: 'afyx-296-unsafe' }),
    });
    const unsafeResult = await unsafe.execute({ ...base, args: repeatedArgs });
    assert.equal(unsafeResult.status, 'fallback');
    assert.equal(unsafeResult.failureCode, 'UNSAFE_STATE_PATH');
    assert.equal(fs.existsSync(path.join(projectRoot, '.unsafe-ace-state')), false);

    const rawText = textOf(raw);
    const grossText = textOf(repeated.value.consumerResult);
    const referenceRequest = JSON.stringify({ operation: 'ace.get/v1', reference: repeatedItem.reference });
    const rawTokens = tokens(rawText);
    const grossTokens = tokens(grossText);
    const referenceTokens = tokens(referenceRequest);
    const recoveredTokens = tokens(recovered.value.content);
    const netTokens = grossTokens + referenceTokens + recoveredTokens;
    const sourceAfter = fingerprint(projectRoot);
    assert.deepEqual(sourceAfter, sourceBefore);
    assert.deepEqual(fingerprint(fixtureSource), fixtureBefore);
    const locks = entriesNamed(aceRoot, '.ace-lock');
    const temporaries = entriesNamed(aceRoot, '.tmp');
    assert.deepEqual(locks, []);
    assert.deepEqual(temporaries, []);

    const report = {
      contract: 'afyx-296.integrated-dogfood/v1',
      source: {
        candidateHead: process.env.AFYX_SOURCE_SHA ?? null,
        baseHead: '54b4832204a9465d93e166ea780d07f39e0cdf25',
        fixtureIdentity: sourceIdentity,
        fixtureFiles: sourceBefore.files,
        sourcePreserved: true,
        trackedFixturePreserved: true,
      },
      isolation: {
        lab,
        sourceRoot: projectRoot,
        graphState,
        aceRoot,
        separateRoots: new Set([projectRoot, graphState, aceRoot]).size === 3,
        locksRemaining: locks,
        temporariesRemaining: temporaries,
      },
      graph: {
        externalState: true,
        indexingMilliseconds: indexing.milliseconds,
        inventoryComplete: true,
        boundedInventoryIncomplete: true,
        sourcePathEvidence: ['sale_order.py', 'sale_order_audit.py', 'sale_order_views.xml'],
      },
      scenarios: {
        off: offMeasured.value.status,
        repeated: repeated.value.status,
        uniqueDisposition: unique.ace.items[0].disposition,
        protected: {
          source: sourceProtected.status,
          diagnostic: diagnostic.status,
          security: security.ace.items[0].disposition,
        },
        recoveryExact: recovered.value.content === rawText,
        failures,
        concurrent: concurrent.map((item) => item.status),
        interrupted: interrupted.failureCode,
        sameStateRetry: retry.status,
        foreignRecovery: 'REFERENCE_BOUNDARY',
        unsafeState: unsafeResult.failureCode,
      },
      latencyMilliseconds: {
        off: offMeasured.milliseconds,
        firstOn: first.milliseconds,
        repeatedOn: repeated.milliseconds,
        recovery: recovered.milliseconds,
      },
      cost: {
        tokenizer: { package: 'js-tiktoken', version: '1.0.21', encoding: 'o200k_base' },
        rawTokens,
        grossTokens,
        grossReductionTokens: rawTokens - grossTokens,
        referenceRequestTokens: referenceTokens,
        recoveredOriginalTokens: recoveredTokens,
        netTokens,
        netReductionTokens: rawTokens - netTokens,
        disclaimer: 'Tokenizer context accounting only; not provider billing, cache savings, or generalized performance.',
      },
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const destination = option('--output') ?? path.join(evidenceRoot, 'integrated-dogfood.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(serialized);
  } finally {
    try { graph?.close(); } catch {}
    if (priorGraphState === undefined) delete process.env.AFYX_GRAPH_STATE_DIR;
    else process.env.AFYX_GRAPH_STATE_DIR = priorGraphState;
    if (!explicitLab) fs.rmSync(lab, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
