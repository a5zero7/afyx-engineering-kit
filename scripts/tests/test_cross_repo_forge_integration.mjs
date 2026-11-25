import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createInstalledHostAdapters } from '../afyx-host-adapters.mjs';
import { executeAfyxCapabilityRoute } from '../afyx-capability-orchestrator.mjs';

const require = createRequire(import.meta.url);
const engine = new URL('../../afyx-graph/engine/dist/index.js', import.meta.url);
const { AfyxGraph } = require(fileURLToPath(engine));

test('installed Graph → Context → Forge and bounded Context OFF fallback', { timeout: 45000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-cross-repo-forge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const installRoot = join(root, 'install');
  const write = (folder, file, text) => {
    const path = join(folder, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const init = async (name, files, consumes = []) => {
    const folder = join(root, name);
    for (const [file, source] of Object.entries(files)) write(folder, file, source);
    write(folder, 'afyx-contracts.json', JSON.stringify({ repository: name, consumes }));
    const git = (...args) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' });
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
    const graph = AfyxGraph.initSync(folder);
    try { assert.ok((await graph.indexAll()).success); } finally { graph.close(); }
    return folder;
  };
  const producer = await init('producer', { 'schema.graphql': 'type Query {\n lookup: String\n}' });
  const count = 60;
  const consumerNames = Array.from({ length: count }, (_, i) => 'lookupFromConsumer' + i);
  const consumer = await init('consumer', {
    'use.ts': consumerNames.map(name => 'export function ' + name + '() {}').join('\n'),
  }, consumerNames.map(symbol => ({ producer:'producer',
    contract:{ file:'schema.graphql', symbol:'Query.lookup' }, consumer:{ file:'use.ts', symbol },
  })));
  const graphCLI = new URL('../../afyx-graph/engine/dist/bin/afyx-graph.js', import.meta.url);
  write(installRoot, 'graph/current/lib/dist/bin/afyx-graph.js', 'import(' + JSON.stringify(graphCLI.href) + ')');
  write(installRoot, 'context/current/dist/cli.js', '');
  write(installRoot, 'context/current/dist/index.js', 'export * from ' + JSON.stringify(new URL('../../afyx-context/src/index.js', import.meta.url).href));
  write(installRoot, 'forge/current/src/index.js', 'export * from ' + JSON.stringify(new URL('../../afyx-forge/src/index.js', import.meta.url).href));
  write(installRoot, 'package.json', '{"type":"module"}');

  for (const enabled of [true, false]) {
    const environment = { ...process.env, AFYX_CONTEXT_OPT_IN: enabled ? '1' : '0', AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1' };
    const componentStates = Object.fromEntries(['afyx-graph', 'afyx-context', 'afyx-forge'].map(id => [id, {
      installed: true, enabled: true, healthy: true, compatible: true, authorized: true,
      sourceIdentity: 'fixture', indexReady: true, indexFresh: true,
    }]));
    const adapters = createInstalledHostAdapters({
      installRoot, projectRoot: producer, environment, trustedCapabilities: { graph: { peerProjectPaths: [consumer] } },
    });
    const task = { taskType:'impact', forgeAdvice:true, needsRelationalEvidence:true,
      payload:{ file:'schema.graphql', symbol:'Query.lookup', peerProjectPaths:[consumer] },
    };
    const result = await executeAfyxCapabilityRoute({
      task, provider:'codex', componentStates, adapters, environment, providerPermissions: { 'afyx-forge': true },
      budgetLimits:{ maxExecutionMs:20000 },
    });
    const executed = result.results.filter(item => item.status === 'EXECUTED');
    assert.deepEqual(executed.map(item => item.componentId),
      enabled ? ['afyx-graph', 'afyx-context', 'afyx-forge'] : ['afyx-graph', 'afyx-forge'],
      JSON.stringify(result.results.map(item => [item.componentId, item.status, item.reason])));
    const plan = executed.at(-1).output;
    assert.equal(plan.mode, enabled ? 'CONTEXT_DIGEST' : 'BOUNDED_GRAPH_EVIDENCE');
    assert.equal(plan.stages[1].scope[0].repository, 'consumer');
    if (enabled) {
      assert.ok(executed[1].output.truncated);
      assert.ok(executed[1].output.citations.includes('producer/schema.graphql:2'));
    }
    const refused = await adapters['afyx-graph']({ taskType:'impact',
      payload:{ ...task.payload, peerProjectPaths:[join(root, 'unauthorized')] } });
    assert.equal(refused.reason, 'GRAPH_PEER_SCOPE_NOT_AUTHORIZED');
  }
});
