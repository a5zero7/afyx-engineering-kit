import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEncoding } from 'js-tiktoken';
import { createGraphAceConsumer, deriveGraphAceIdentity } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(root, '..');
const fixtureSource = path.join(root, 'test-fixtures', 'graph-consumer-repo');
const graphDist = path.join(repositoryRoot, 'afyx-graph', 'engine', 'dist');
const encoder = getEncoding('o200k_base');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  const content = files.map((file) => `${file}\0${sha256(fs.readFileSync(path.join(directory, file)))}`).join('\n');
  return { files, sha256: sha256(content) };
}

function tokens(value) {
  return encoder.encode(value).length;
}

function outputPath(args) {
  const index = args.indexOf('--output');
  if (index === -1) return null;
  if (!args[index + 1]) throw new Error('--output requires a path');
  return path.resolve(args[index + 1]);
}

async function main() {
  if (!fs.existsSync(path.join(graphDist, 'index.js'))) {
    throw new Error('Afyx Graph dist is missing; run its clean build before this E2E');
  }
  // macOS exposes /var as an alias to /private/var. Graph correctly rejects
  // aliased external-state ancestors, so create the disposable lab beneath the
  // canonical temp root rather than weakening that safety boundary.
  const canonicalTempRoot = fs.realpathSync.native(os.tmpdir());
  const lab = fs.mkdtempSync(path.join(canonicalTempRoot, 'afyx-293-real-consumer-'));
  const projectRoot = path.join(lab, 'tracked-fixture-copy');
  const graphState = path.join(lab, 'graph-state');
  const trackedFixtureBefore = fingerprint(fixtureSource);
  fs.cpSync(fixtureSource, projectRoot, { recursive: true, errorOnExist: true });
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
    await graph.indexAll();
    const handler = new toolsModule.ToolHandler(graph);
    const executeGraph = (toolName, args) => handler.execute(toolName, args);
    const inventoryArgs = { declaration: '_inherit', value: 'sale.order', limit: 100 };
    const matchingArgs = { query: 'SaleOrder synthetic_total', limit: 100 };
    const uniqueArgs = { query: 'SyntheticSaleExtensionManifest', limit: 100 };
    const inventory = await executeGraph('afyx_graph_inventory', inventoryArgs);
    assert.equal(inventory.isError, undefined);
    assert.match(inventory.content[0].text, /sale_extension\/models\/sale_order\.py/);
    assert.match(inventory.content[0].text, /COMPLETE FOR SUPPORTED LITERAL DECLARATIONS/);
    const raw = await executeGraph('afyx_graph_search', matchingArgs);
    assert.equal(raw.isError, undefined);
    assert.match(raw.content[0].text, /sale_order\.py/);

    const makeConsumer = (scenario) => {
      const identity = deriveGraphAceIdentity({ projectRoot, sourceIdentity, consumerId: `afyx-293-${scenario}` });
      return createGraphAceConsumer({
        enabled: true,
        stateDir: path.join(lab, `ace-${scenario}`),
        ...identity,
        timeoutMs: 5_000,
      });
    };
    const base = { executeGraph, toolName: 'afyx_graph_search', projectRoot, sourceIdentity };

    const repeatedConsumer = makeConsumer('repeated');
    await repeatedConsumer.execute({ ...base, args: matchingArgs });
    const repeated = await repeatedConsumer.execute({ ...base, args: matchingArgs });
    const repeatedReference = repeated.ace.items.find((item) => item.disposition === 'reference');
    assert.ok(repeatedReference);
    const recovered = await repeatedConsumer.recover(repeatedReference.reference);
    assert.equal(recovered.content, raw.content[0].text);
    assert.ok(recovered.observations.some((observation) =>
      observation.provenance?.sourceIdentity === sourceIdentity
      && observation.provenance?.projectRoot === fs.realpathSync.native(projectRoot)));

    const uniqueConsumer = makeConsumer('unique');
    await uniqueConsumer.execute({ ...base, args: matchingArgs });
    const mostlyUnique = await uniqueConsumer.execute({ ...base, args: uniqueArgs });
    assert.equal(mostlyUnique.ace.items[0].disposition, 'original');

    const protectedConsumer = makeConsumer('protected');
    const protectedResult = await protectedConsumer.execute({
      ...base,
      toolName: 'afyx_graph_explore',
      args: { query: 'SaleOrder synthetic_total' },
    });
    assert.equal(protectedResult.status, 'bypassed');
    assert.equal(protectedResult.ace, null);
    assert.match(protectedResult.consumerResult.content[0].text, /synthetic_total/);

    const off = createGraphAceConsumer();
    const offResult = await off.execute({ ...base, args: matchingArgs });
    assert.deepEqual(offResult.consumerResult, raw);

    const rawText = raw.content.map((item) => item.text).join('\n');
    const reducedText = repeated.consumerResult.content.map((item) => item.text).join('\n');
    const recoveryRequest = JSON.stringify({ operation: 'ace.get/v1', reference: repeatedReference.reference });
    const rawTokens = tokens(rawText);
    const grossTokens = tokens(reducedText);
    const recoveryTokens = tokens(recoveryRequest) + tokens(recovered.content);
    const netTokens = grossTokens + recoveryTokens;
    const sourceAfter = fingerprint(projectRoot);
    assert.deepEqual(sourceAfter, sourceBefore);
    assert.deepEqual(fingerprint(fixtureSource), trackedFixtureBefore);

    const report = {
      contract: 'afyx-293.graph-ace-evidence/v1',
      source: {
        stackHead: process.env.AFYX_SOURCE_SHA ?? null,
        fixtureIdentity: sourceIdentity,
        fixtureFiles: sourceBefore.files,
        sourcePreserved: true,
        trackedFixturePreserved: true,
      },
      graph: {
        runtimeVersion: graphModule.VERSION ?? null,
        externalState: true,
        query: { toolName: 'afyx_graph_search', args: matchingArgs },
        inventoryQuery: { toolName: 'afyx_graph_inventory', args: inventoryArgs },
        inventoryComplete: true,
      },
      scenarios: {
        off: offResult.status,
        repeated: repeated.status,
        mostlyUniqueDisposition: mostlyUnique.ace.items[0].disposition,
        protectedStatus: protectedResult.status,
        recoveryExact: recovered.content === rawText,
      },
      cost: {
        tokenizer: { package: 'js-tiktoken', version: '1.0.21', encoding: 'o200k_base' },
        rawTokens,
        grossTokens,
        grossReductionTokens: rawTokens - grossTokens,
        recoveryTokens,
        netTokens,
        netReductionTokens: rawTokens - netTokens,
        disclaimer: 'Counts are tokenizer context accounting, not provider billing, cache savings, or generalized performance.',
      },
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const destination = outputPath(process.argv.slice(2));
    if (destination) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, serialized, { encoding: 'utf8', flag: 'wx' });
    }
    process.stdout.write(serialized);
  } finally {
    try { graph?.close(); } catch {}
    if (priorGraphState === undefined) delete process.env.AFYX_GRAPH_STATE_DIR;
    else process.env.AFYX_GRAPH_STATE_DIR = priorGraphState;
    fs.rmSync(lab, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
