import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createInstalledAfyxRuntime,
  runInstalledAfyxWorkflow,
} from '../afyx-universal-runtime.mjs';
import {
  executeAfyxCapabilityRoute,
  resolveAfyxCapabilityRoute,
} from '../afyx-capability-orchestrator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = JSON.parse(readFileSync(resolve(HERE, '..', 'components.json'), 'utf8')).components;

function write(path, value = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-graph-jit-'));
  const installRoot = join(root, 'install');
  const projectRoot = join(root, 'project');
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  return {
    root,
    installRoot,
    projectRoot,
    stateRoot: join(root, 'context-state'),
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    },
  };
}

function installRegistrySkeleton(fx, id) {
  const component = COMPONENTS.find((item) => item.id === id);
  assert.ok(component, `Missing registry component ${id}`);
  const root = component.type === 'skill'
    ? join(fx.installRoot, 'skills', component.install_path)
    : join(fx.installRoot, component.id.replace(/^afyx-/, ''));
  const platformRequired = process.platform === 'win32'
    ? component.required_files_windows
    : component.required_files_unix;
  const required = [component.required_files, platformRequired]
    .filter((value) => typeof value === 'string')
    .flatMap((value) => value.split(';'))
    .filter(Boolean);
  if (id === 'afyx-graph') required.push('current/lib/dist/bin/afyx-graph.js');
  for (const relativePath of new Set(required)) {
    const path = join(root, ...relativePath.split('/'));
    const content = relativePath.endsWith('.json') ? '{}' : '';
    write(path, content);
  }
  return root;
}

function installMockGraph(fx, { shouldFailInit = false } = {}) {
  installRegistrySkeleton(fx, 'afyx-graph');
  write(join(fx.installRoot, 'graph', 'metadata.json'), JSON.stringify({
    product_name: 'Afyx Graph',
    source_revision: 'graph-jit-source-1',
  }));

  const logFile = join(fx.root, 'graph-ops.log');
  const mockScript = `
const fs = require('node:fs');
const path = require('node:path');

const cmd = process.argv[2];
const logFile = ${JSON.stringify(logFile)};
fs.appendFileSync(logFile, cmd + '\\n');

if (cmd === 'status') {
  const proj = ${JSON.stringify(fx.projectRoot)};
  const indexDir = path.join(proj, '.afyx-graph');
  const dbFile = path.join(indexDir, 'afyx-graph.db');
  const freshnessFile = path.join(indexDir, 'freshness.json');
  const isInitialized = fs.existsSync(dbFile);
  let isFresh = true;
  if (isInitialized && fs.existsSync(freshnessFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(freshnessFile, 'utf8'));
      if (parsed.stale === true) isFresh = false;
    } catch {}
  }
  console.log(JSON.stringify({
    initialized: isInitialized,
    projectPath: proj,
    indexPath: isInitialized ? indexDir : null,
    index: {
      state: isInitialized ? 'complete' : 'uninitialized',
      pendingRefs: 0,
      reindexRecommended: !isFresh,
    },
    health: {
      pendingChanges: { state: isFresh ? 'CURRENT' : 'MODIFIED' },
      compatibility: { reindexRecommended: !isFresh },
      gitFreshness: { state: isFresh ? 'CURRENT' : 'STALE' },
    },
  }));
} else if (cmd === 'init') {
  if (${shouldFailInit}) {
    console.error('Simulated Graph initialization error');
    process.exit(1);
  }
  const proj = ${JSON.stringify(fx.projectRoot)};
  const indexDir = path.join(proj, '.afyx-graph');
  fs.mkdirSync(indexDir, { recursive: true });
  fs.writeFileSync(path.join(indexDir, 'afyx-graph.db'), 'mock-db-data');
  fs.writeFileSync(path.join(indexDir, 'freshness.json'), JSON.stringify({
    schema_version: 1,
    indexed_at: new Date().toISOString(),
    git_head: 'mock-head',
    tracked_clean: true,
  }));
  console.log('Graph successfully initialized');
} else {
  console.log(JSON.stringify({ result: 'ok', command: cmd }));
}
`;

  write(join(fx.installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js'), mockScript);
  return { logFile };
}

// 1. Graph not installed: skip transparently without error
test('Graph JIT 1: Graph not installed skips transparently without error', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());

  const runtime = createInstalledAfyxRuntime({
    installRoot: fx.installRoot,
    projectRoot: fx.projectRoot,
    provider: 'codex',
    probeGraph: false,
    authorizations: { 'afyx-graph': true },
  });

  const state = await runtime.prepareCapabilityState('afyx-graph', {
    jitInitialize: true,
    relationalDemand: true,
  });

  assert.equal(state.installed, false);
  assert.equal(runtime.preparationEvents.length, 0);

  const route = resolveAfyxCapabilityRoute({
    task: { taskType: 'relational-impact', needsRelationalEvidence: true },
    provider: 'codex',
    componentStates: runtime.componentStates,
  });
  const hasGraphRequest = route.requests.some((r) => r.targetComponentId === 'afyx-graph');
  assert.equal(hasGraphRequest, false);
});

// 2. Graph installed, indexed and fresh: reuse existing index without reinit
test('Graph JIT 2: Graph installed, indexed and fresh reuses existing index without reinit', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  const { logFile } = installMockGraph(fx);

  // Pre-initialize index
  const indexDir = join(fx.projectRoot, '.afyx-graph');
  write(join(indexDir, 'afyx-graph.db'), 'existing-db');
  write(join(indexDir, 'freshness.json'), JSON.stringify({ stale: false }));

  const runtime = createInstalledAfyxRuntime({
    installRoot: fx.installRoot,
    projectRoot: fx.projectRoot,
    provider: 'codex',
    probeGraph: false,
    authorizations: { 'afyx-graph': true },
  });

  const state = await runtime.prepareCapabilityState('afyx-graph', {
    jitInitialize: true,
    relationalDemand: true,
  });

  assert.equal(state.installed, true);
  assert.equal(state.indexReady, true);
  assert.equal(state.indexFresh, true);
  assert.deepEqual(runtime.preparationEvents, ['afyx-graph/status']);

  const ops = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.deepEqual(ops, ['status']);
});

// 3. Graph installed, workspace uninitialized, explicit relational demand: initialize JIT
test('Graph JIT 3: Graph installed, uninitialized with relational demand triggers JIT init', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  const { logFile } = installMockGraph(fx);

  const runtime = createInstalledAfyxRuntime({
    installRoot: fx.installRoot,
    projectRoot: fx.projectRoot,
    provider: 'codex',
    probeGraph: false,
    authorizations: { 'afyx-graph': true },
  });

  assert.equal(runtime.componentStates['afyx-graph'].indexReady, false);

  const state = await runtime.prepareCapabilityState('afyx-graph', {
    jitInitialize: true,
    relationalDemand: true,
  });

  assert.equal(state.installed, true);
  assert.equal(state.indexReady, true);
  assert.equal(state.indexFresh, true);
  assert.deepEqual(runtime.preparationEvents, ['afyx-graph/status', 'afyx-graph/init']);

  const ops = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.deepEqual(ops, ['status', 'init', 'status']);
  assert.ok(existsSync(join(fx.projectRoot, '.afyx-graph', 'afyx-graph.db')));
});

// 4. Ordinary tasks: never initialize or invoke Graph unnecessarily
test('Graph JIT 4: ordinary non-relational tasks never trigger Graph JIT initialization', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  const { logFile } = installMockGraph(fx);

  const route = resolveAfyxCapabilityRoute({
    task: { taskType: 'syntax-lookup', payload: 'how to filter an array in typescript' },
    provider: 'codex',
    componentStates: {
      'afyx-graph': { installed: true, enabled: true, authorized: true, indexReady: false },
      'efficient-coding': { installed: true, enabled: true, authorized: true, healthy: true, compatible: true },
    },
  });

  const hasGraphRequest = route.requests.some((r) => r.targetComponentId === 'afyx-graph');
  assert.equal(hasGraphRequest, false);
  assert.equal(existsSync(logFile), false, 'Graph executable must not be run for ordinary syntax tasks');
});

// 5. Explicitly disabled or unauthorized Graph: never initialize
test('Graph JIT 5: disabled or unauthorized Graph is never initialized', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  const { logFile } = installMockGraph(fx);

  const runtime = createInstalledAfyxRuntime({
    installRoot: fx.installRoot,
    projectRoot: fx.projectRoot,
    provider: 'codex',
    probeGraph: false,
    authorizations: { 'afyx-graph': false }, // Unauthorized
  });

  const state = await runtime.prepareCapabilityState('afyx-graph', {
    jitInitialize: true,
    relationalDemand: true,
  });

  assert.equal(state.authorized, false);
  assert.equal(runtime.preparationEvents.length, 0);
  assert.equal(existsSync(logFile), false, 'Unauthorized Graph must not invoke probe or init');
});

// 6. Stale existing index: report status, apply safe reindex policy, do not destroy owner data
test('Graph JIT 6: stale existing index returns SAFE_REPORT_STATUS without deleting index data', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  const { logFile } = installMockGraph(fx);

  // Pre-initialize with stale state
  const indexDir = join(fx.projectRoot, '.afyx-graph');
  write(join(indexDir, 'afyx-graph.db'), 'precious-owner-graph-db');
  write(join(indexDir, 'freshness.json'), JSON.stringify({ stale: true }));

  const runtime = createInstalledAfyxRuntime({
    installRoot: fx.installRoot,
    projectRoot: fx.projectRoot,
    provider: 'codex',
    probeGraph: false,
    authorizations: { 'afyx-graph': true },
  });

  const state = await runtime.prepareCapabilityState('afyx-graph', {
    jitInitialize: true,
    relationalDemand: true,
  });

  assert.equal(state.installed, true);
  assert.equal(state.indexReady, true);
  assert.equal(state.indexFresh, false);
  assert.equal(state.reindexPolicy, 'SAFE_REPORT_STATUS');
  assert.deepEqual(runtime.preparationEvents, ['afyx-graph/status']);

  // Ensure owner data was NOT wiped or re-initialized
  assert.equal(readFileSync(join(indexDir, 'afyx-graph.db'), 'utf8'), 'precious-owner-graph-db');
  const ops = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.deepEqual(ops, ['status'], 'must not execute init on stale index');
});

// 7. Concurrent requests: prevent duplicate initialization via activeGraphInits
test('Graph JIT 7: concurrent initialization requests share single init process', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  const { logFile } = installMockGraph(fx);

  const runtime = createInstalledAfyxRuntime({
    installRoot: fx.installRoot,
    projectRoot: fx.projectRoot,
    provider: 'codex',
    probeGraph: false,
    authorizations: { 'afyx-graph': true },
  });

  // Launch two concurrent prepareCapabilityState requests
  const [res1, res2] = await Promise.all([
    runtime.prepareCapabilityState('afyx-graph', { jitInitialize: true, relationalDemand: true }),
    runtime.prepareCapabilityState('afyx-graph', { jitInitialize: true, relationalDemand: true }),
  ]);

  assert.equal(res1.indexReady, true);
  assert.equal(res2.indexReady, true);

  // Verification: only ONE 'init' event was added to preparationEvents
  const initEvents = runtime.preparationEvents.filter((ev) => ev === 'afyx-graph/init');
  assert.equal(initEvents.length, 1, 'Only one init event must be emitted');

  const ops = readFileSync(logFile, 'utf8').trim().split('\n');
  const initCalls = ops.filter((cmd) => cmd === 'init');
  assert.equal(initCalls.length, 1, 'Only one init command should be executed concurrently');
});

// 8. Failure: degrade safely to direct-source behavior with a clear diagnostic
test('Graph JIT 8: init failure degrades safely without crashing', async (t) => {
  const fx = fixture();
  t.after(() => fx.cleanup());
  installMockGraph(fx, { shouldFailInit: true });

  const runtime = createInstalledAfyxRuntime({
    installRoot: fx.installRoot,
    projectRoot: fx.projectRoot,
    provider: 'codex',
    probeGraph: false,
    authorizations: { 'afyx-graph': true },
  });

  const state = await runtime.prepareCapabilityState('afyx-graph', {
    jitInitialize: true,
    relationalDemand: true,
  });

  assert.equal(state.installed, true);
  assert.equal(state.indexReady, false);
  assert.ok(state.jitError, 'jitError must be populated');
  assert.ok(state.jitError.includes('Simulated Graph initialization error') || state.jitError.includes('Exit code'));

  // Ensure routing continues gracefully
  const route = resolveAfyxCapabilityRoute({
    task: { intent: 'refactor code', needsRelationalEvidence: true },
    provider: 'codex',
    componentStates: {
      ...runtime.componentStates,
      'afyx-graph': state,
      'efficient-coding': { installed: true, enabled: true, authorized: true, healthy: true, compatible: true },
    },
  });

  // Graph is omitted from requests due to indexReady: false, falling back safely
  const hasGraphRequest = route.requests.some((r) => r.targetComponentId === 'afyx-graph');
  assert.equal(hasGraphRequest, false);
  const degradation = route.degradations.find((d) => d.componentId === 'afyx-graph');
  assert.ok(degradation, 'Graph must be recorded in degradations');
  assert.equal(degradation.fallback, 'DIRECT_SOURCE');
});
