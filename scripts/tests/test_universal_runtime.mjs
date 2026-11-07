import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { discoverAfyxCapabilities } from '../afyx-capability-orchestrator.mjs';
import { createInstalledHostAdapters } from '../afyx-host-adapters.mjs';
import {
  AFYX_COMPONENT_MANIFEST_CONTRACT,
  createInstalledAfyxRuntime,
  runInstalledAfyxWorkflow,
} from '../afyx-universal-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = resolve(HERE, '..', 'afyx-universal-runtime.mjs');
const COMPONENTS = JSON.parse(readFileSync(resolve(HERE, '..', 'components.json'), 'utf8')).components;

function write(path, value = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'afyx-universal-runtime-'));
  const installRoot = join(root, 'install');
  const projectRoot = join(root, 'project');
  const codexToolsRoot = join(root, 'codex-tools');
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  return {
    root,
    installRoot,
    projectRoot,
    codexToolsRoot,
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
    : (component.type === 'runtime'
      ? join(fx.installRoot, component.id.replace(/^afyx-/, ''))
      : fx.codexToolsRoot);
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

function installSkill(fx, id) {
  installRegistrySkeleton(fx, id);
  write(join(fx.installRoot, 'skills', id, 'SKILL.md'), `# ${id}\n`);
}

function installContext(fx) {
  installRegistrySkeleton(fx, 'afyx-context');
  write(join(fx.installRoot, 'context', 'metadata.json'), JSON.stringify({
    product_name: 'Afyx Context Engine',
    source_revision: 'context-source-1',
  }));
  write(join(fx.installRoot, 'context', 'current', 'identity.json'), '{}');
  write(join(fx.installRoot, 'context', 'current', 'dist', 'cli.js'),
    `import(${JSON.stringify(pathToFileURL(resolve(HERE, '..', '..', 'afyx-context', 'src', 'cli.js')).href)});\n`);
}

function installGraph(fx, outputBytes = 256) {
  installRegistrySkeleton(fx, 'afyx-graph');
  write(join(fx.installRoot, 'graph', 'metadata.json'), JSON.stringify({
    product_name: 'Afyx Graph',
    source_revision: 'graph-source-1',
  }));
  write(
    join(fx.installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js'),
    `if (process.argv[2] === 'status') console.log(JSON.stringify({initialized:true,projectPath:${JSON.stringify(fx.projectRoot)},indexPath:${JSON.stringify(join(fx.projectRoot, '.afyx-graph'))},index:{state:'complete',pendingRefs:0,reindexRecommended:false},health:{pendingChanges:{state:'CURRENT'},compatibility:{reindexRecommended:false},gitFreshness:{state:'CURRENT'}}})); else process.stdout.write('G'.repeat(${outputBytes}));\n`,
  );
  write(join(fx.projectRoot, '.afyx-graph', 'afyx-graph.db'), 'disposable-db');
  write(join(fx.projectRoot, '.afyx-graph', 'freshness.json'), JSON.stringify({
    schema_version: 1,
    indexed_at: '2026-11-06T00:00:00.000Z',
    git_head: null,
    tracked_clean: null,
  }));
}

function installForge(fx, source = "console.log('{}');\n") {
  installRegistrySkeleton(fx, 'afyx-forge');
  write(join(fx.installRoot, 'forge', 'metadata.json'), JSON.stringify({
    product_name: 'Afyx Forge Core',
    source_revision: 'forge-source-1',
  }));
  write(join(fx.installRoot, 'forge', 'current', 'bin', 'afyx-forge.js'), source);
}

function installDynamic(fx, id = 'afyx-review-assistant', entrypoint = 'current/interop.mjs') {
  const root = join(fx.installRoot, 'components', id);
  const manifest = {
    contract: AFYX_COMPONENT_MANIFEST_CONTRACT,
    id,
    canonicalName: 'Afyx Review Assistant',
    ownershipClass: 'AFYX',
    primaryCapability: 'review-assistance',
    domainAuthority: 'Review assistance authority',
    sourceIdentity: 'review-assistant-source-1',
    runtime: {
      protocol: 'AfyxCapabilityRequest/v1-json-stdio',
      entrypoint,
    },
  };
  write(join(root, 'afyx-component.json'), JSON.stringify(manifest));
  if (!entrypoint.startsWith('..')) {
    write(join(root, ...entrypoint.split('/')), `
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { input += chunk; });
      process.stdin.on('end', () => {
        const request = JSON.parse(input);
        process.stdout.write(JSON.stringify({
          status: 'SUCCESS',
          output: { reviewedTask: request.taskId },
          evidence: [{ kind: 'native-dynamic-component' }],
          contextBytes: 32,
        }));
      });
    `);
  }
  return { id, root };
}

test('Context explicit OFF does not disable unrelated discovered components', () => {
  const fx = fixture();
  try {
    installSkill(fx, 'efficient-coding');
    installSkill(fx, 'odoo-engineering');
    installSkill(fx, 'afyx-engineering-expert');
    installGraph(fx);
    installContext(fx);
    const runtime = createInstalledAfyxRuntime({
      ...fx,
      authorizations: {
        'efficient-coding': true,
        'odoo-engineering': true,
        'afyx-engineering-expert': true,
        'afyx-graph': true,
        'afyx-context': true,
      },
      environment: { AFYX_CONTEXT_OPT_IN: '0' },
    });
    try {
      assert.equal(runtime.componentStates['efficient-coding'].enabled, true);
      assert.equal(runtime.componentStates['odoo-engineering'].enabled, true);
      assert.equal(runtime.componentStates['afyx-engineering-expert'].enabled, true);
      assert.equal(runtime.componentStates['afyx-graph'].enabled, true);
      assert.equal(runtime.componentStates['afyx-context'].enabled, false);
      const discovery = discoverAfyxCapabilities({
        componentStates: runtime.componentStates,
        provider: 'codex',
        environment: { AFYX_CONTEXT_OPT_IN: '0' },
      });
      assert.equal(discovery.capabilities['efficient-coding'].available, true);
      assert.equal(discovery.capabilities['odoo-engineering'].available, true);
      assert.equal(discovery.capabilities['afyx-engineering-expert'].available, true);
      assert.equal(discovery.capabilities['afyx-graph'].available, true);
      assert.equal(discovery.capabilities['afyx-context'].available, false);
      assert.equal(discovery.capabilities['afyx-context'].reason, 'EXPLICITLY_DISABLED');
    } finally {
      runtime.dispose();
    }
  } finally {
    fx.cleanup();
  }
});

test('health overrides cannot fabricate installation or authorization', () => {
  const fx = fixture();
  try {
    const runtime = createInstalledAfyxRuntime({
      ...fx,
      componentStateOverrides: {
        'efficient-coding': {
          installed: true,
          enabled: true,
          authorized: true,
          healthy: true,
          compatible: true,
          sourceIdentity: 'override-identity',
        },
      },
    });
    try {
      assert.equal(runtime.componentStates['efficient-coding'].installed, false);
      assert.equal(runtime.componentStates['efficient-coding'].enabled, false);
      assert.equal(runtime.componentStates['efficient-coding'].authorized, false);
      assert.equal(runtime.componentStates['efficient-coding'].healthy, false);
      assert.equal(runtime.componentStates['efficient-coding'].sourceIdentity, null);
    } finally {
      runtime.dispose();
    }
  } finally {
    fx.cleanup();
  }
});

test('direct-source workflow executes zero optional capabilities', async () => {
  const result = await runInstalledAfyxWorkflow({
    provider: 'codex',
    task: { id: 'direct-1', taskType: 'known-file', exactKnownSource: true },
  });
  assert.equal(result.executionStatus, 'DIRECT_SOURCE');
  assert.equal(result.metrics.toolCalls, 0);
  assert.equal(result.results.length, 0);
});

test('missing optional Graph degrades relational workflow without breaking coding skill', async () => {
  const fx = fixture();
  try {
    installSkill(fx, 'efficient-coding');
    const result = await runInstalledAfyxWorkflow({
      ...fx,
      provider: 'codex',
      authorizations: { 'efficient-coding': true, 'afyx-graph': true },
      task: { id: 'impact-1', taskType: 'impact-analysis', needsRelationalEvidence: true },
    });
    assert.equal(result.status, 'DEGRADED');
    assert.equal(result.degradations.some((item) =>
      item.componentId === 'afyx-graph' && item.reason === 'NOT_INSTALLED'), true);
    assert.equal(result.results.some((item) =>
      item.componentId === 'efficient-coding' && item.executionStatus === 'EXECUTED'), true);
  } finally {
    fx.cleanup();
  }
});

test('installed Graph executes and lazily requests Context only for large evidence', async () => {
  const fx = fixture();
  try {
    installGraph(fx, 21_000);
    installContext(fx);
    const result = await runInstalledAfyxWorkflow({
      ...fx,
      provider: 'codex',
      authorizations: { 'afyx-graph': true, 'afyx-context': true },
      task: {
        id: 'graph-context-1',
        taskType: 'impact-analysis',
        needsRelationalEvidence: true,
        intent: 'impact analysis OrderService',
      },
    });
    const graph = result.results.find((item) => item.componentId === 'afyx-graph');
    const context = result.results.find((item) => item.componentId === 'afyx-context');
    assert.equal(graph?.executionStatus, 'EXECUTED');
    assert.equal(context?.executionStatus, 'EXECUTED');
    assert.equal(result.metrics.toolCalls, 2);
    assert.equal(graph?.provenance.componentSourceIdentity, 'graph-source-1');
    assert.equal(context?.provenance.componentSourceIdentity, 'context-source-1');
    assert.equal(context.output.mode, 'optimized');
    assert.ok(context.output.metrics.savedChars > 0);
    const reference = context.output.items[0].reference;
    const recovery = context.output.recovery;
    const recovered = spawnSync(process.execPath, [resolve(HERE, '..', '..', 'afyx-context', 'src', 'cli.js'),
      'get', '--state', recovery.stateRoot, '--owner', recovery.owner,
      '--session', recovery.session, '--reference', reference], { encoding: 'utf8' });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(recovered.stdout, graph.output);
  } finally {
    fx.cleanup();
  }
});

test('Odoo impact request preserves task type for Graph structural inventory', async () => {
  const fx = fixture();
  try {
    installGraph(fx);
    installSkill(fx, 'odoo-engineering');
    const result = await runInstalledAfyxWorkflow({
      ...fx, provider: 'codex',
      authorizations: { 'afyx-graph': true, 'odoo-engineering': true },
      task: { taskType: 'odoo-impact-analysis', needsRelationalEvidence: true,
        intent: 'inspect Odoo sale.order inheritance' },
    });
    const graph = result.results.find((item) => item.componentId === 'afyx-graph');
    assert.equal(graph?.executionStatus, 'EXECUTED');
    assert.equal(graph.evidence.find((item) => item.kind === 'graph-tool')?.command, 'inventory');
  } finally { fx.cleanup(); }
});

test('Graph discovers an immediate workspace index and rejects stale or foreign status', () => {
  const fx = fixture();
  try {
    installGraph(fx);
    const entry = join(fx.installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');
    const state = join(fx.root, '.afyx-graph');
    write(join(state, 'afyx-graph.db'), 'disposable-db');
    const status = (projectPath, reindexRecommended = false) =>
      `if (process.argv[2] === 'status') console.log(JSON.stringify({initialized:true,projectPath:${JSON.stringify(projectPath)},indexPath:${JSON.stringify(state)},index:{state:'complete',pendingRefs:0,reindexRecommended:${reindexRecommended}},health:{pendingChanges:{state:'CURRENT'},compatibility:{reindexRecommended:${reindexRecommended}},gitFreshness:{state:'CURRENT'}}}));\n`;
    write(entry, status(fx.root));
    const options = { ...fx, authorizations: { 'afyx-graph': true } };
    const healthy = createInstalledAfyxRuntime(options).componentStates['afyx-graph'];
    assert.equal(healthy.indexReady, true);
    assert.equal(healthy.indexFresh, true);
    assert.equal(healthy.indexRoot, fx.root);
    write(entry, status(fx.root, true));
    assert.equal(createInstalledAfyxRuntime(options).componentStates['afyx-graph'].indexFresh, false);
    write(entry, status(fx.installRoot));
    assert.equal(createInstalledAfyxRuntime(options).componentStates['afyx-graph'].indexReady, false);
  } finally { fx.cleanup(); }
});

test('provider-managed skill requires matching ownership marker and unchanged content', () => {
  const fx = fixture();
  try {
    const component = COMPONENTS.find((item) => item.id === 'efficient-coding');
    const providerRoot = join(fx.root, 'provider-skills');
    const skillRoot = join(providerRoot, 'efficient-coding');
    const files = component.required_files.split(';');
    for (const file of files) write(join(skillRoot, ...file.split('/')), file === 'SKILL.md' ? '# Efficient Coding\n' : 'reference\n');
    const ordered = files.map((file) => join(skillRoot, ...file.split('/'))).sort((a, b) => {
      const left = a.toUpperCase(); const right = b.toUpperCase();
      return left < right ? -1 : (left > right ? 1 : 0);
    });
    const lines = ordered.map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase()}  ./${file.slice(skillRoot.length + 1).replaceAll('\\', '/')}`);
    const digest = createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
    write(join(skillRoot, '.afyx-install.json'), JSON.stringify({ schema: 1, product: 'Afyx Codex Engineering Kit', component: 'efficient-coding', owner: 'afyx', content_sha256: digest }));
    const options = { ...fx, provider: 'codex', providerSkillRoots: { codex: providerRoot } };
    assert.equal(createInstalledAfyxRuntime(options).componentStates['efficient-coding'].installed, true);
    write(join(skillRoot, 'SKILL.md'), '# Modified\n');
    assert.equal(createInstalledAfyxRuntime(options).componentStates['efficient-coding'].installed, false);
  } finally { fx.cleanup(); }
});

test('Codex Usage Tracking discovery is provider and permission scoped', () => {
  const fx = fixture();
  try {
    installRegistrySkeleton(fx, 'codex-usage-tracking');
    const codex = createInstalledAfyxRuntime({ ...fx, provider: 'codex' });
    const antigravity = createInstalledAfyxRuntime({ ...fx, provider: 'antigravity' });
    assert.equal(codex.componentStates['codex-usage-tracking'].installed, process.platform === 'win32');
    if (process.platform === 'win32') {
      assert.match(codex.componentStates['codex-usage-tracking'].sourceIdentity, /^sha256:[0-9a-f]{64}$/);
    }
    assert.equal(codex.componentStates['codex-usage-tracking'].authorized, false);
    assert.equal(antigravity.componentStates['codex-usage-tracking'].installed, false);
  } finally { fx.cleanup(); }
});

test('dynamic AFYX manifest is discovered and executed through bounded JSON stdio', async () => {
  const fx = fixture();
  const { id } = installDynamic(fx);
  try {
    const result = await runInstalledAfyxWorkflow({
      ...fx,
      provider: 'codex',
      authorizations: { [id]: true },
      providerPermissions: { [id]: true },
      task: {
        id: 'dynamic-1',
        taskType: 'review',
        customComponentId: id,
        needsCustomCapability: 'review-assistance',
      },
    });
    const execution = result.results.find((item) => item.componentId === id);
    assert.equal(execution?.executionStatus, 'EXECUTED');
    assert.deepEqual(execution?.output, { reviewedTask: 'dynamic-1' });
    assert.equal(execution?.provenance.componentSourceIdentity, 'review-assistant-source-1');
  } finally {
    fx.cleanup();
  }
});

test('disabled dynamic component is discovered but never invoked', async () => {
  const fx = fixture();
  const { id } = installDynamic(fx);
  try {
    const result = await runInstalledAfyxWorkflow({
      ...fx,
      provider: 'codex',
      authorizations: { [id]: true },
      providerPermissions: { [id]: true },
      componentSettings: { [id]: { enabled: false } },
      task: { id: 'dynamic-off', customComponentId: id, needsCustomCapability: 'review-assistance' },
    });
    assert.equal(result.results.some((item) => item.componentId === id), false);
    assert.equal(result.degradations.some((item) =>
      item.componentId === id && item.reason === 'EXPLICITLY_DISABLED'), true);
  } finally {
    fx.cleanup();
  }
});

test('dynamic manifest entrypoint cannot escape its component root', () => {
  const fx = fixture();
  installDynamic(fx, 'afyx-invalid-component', '../outside.mjs');
  write(join(fx.installRoot, 'components', 'outside.mjs'), "console.log('{}');\n");
  try {
    const runtime = createInstalledAfyxRuntime({
      ...fx,
      authorizations: { 'afyx-invalid-component': true },
    });
    try {
      assert.equal(runtime.componentStates['afyx-invalid-component'], undefined);
      assert.equal(runtime.discoveryEvidence.some((item) =>
        item.componentId === 'afyx-invalid-component' &&
        item.reason === 'INVALID_COMPONENT_MANIFEST'), true);
    } finally {
      runtime.dispose();
    }
  } finally {
    fx.cleanup();
  }
});

test('dynamic manifest cannot replace a canonical component identity', () => {
  const fx = fixture();
  installDynamic(fx, 'afyx-graph');
  try {
    const runtime = createInstalledAfyxRuntime({
      ...fx,
      authorizations: { 'afyx-graph': true },
    });
    try {
      assert.equal(runtime.componentStates['afyx-graph'].installed, false);
      assert.equal(runtime.discoveryEvidence.some((item) =>
        item.componentId === 'afyx-graph' && item.reason === 'INVALID_COMPONENT_MANIFEST'), true);
    } finally {
      runtime.dispose();
    }
  } finally {
    fx.cleanup();
  }
});

test('host adapters validate roots and report Forge and telemetry outcomes honestly', async () => {
  assert.throws(() => createInstalledHostAdapters({}), /installRoot and projectRoot/);
  const fx = fixture();
  try {
    installForge(fx, 'process.exit(3);\n');
    const adapters = createInstalledHostAdapters({ ...fx });
    const forge = await adapters['afyx-forge']({ intent: 'doctor' });
    assert.equal(forge.status, 'FAILED');
    assert.match(forge.reason, /FORGE_EXECUTION_ERROR/);
    const telemetry = await adapters['codex-usage-tracking']({ candidateProviders: ['codex'] });
    assert.equal(telemetry.status, 'FAILED');
    assert.equal(telemetry.reason, 'USAGE_TRACKING_TOOL_NOT_FOUND');
  } finally {
    fx.cleanup();
  }
});

test('host runtime invocation obeys the route execution-time budget', async () => {
  const fx = fixture();
  try {
    installForge(fx, "setTimeout(() => console.log('{}'), 2000);\n");
    const adapters = createInstalledHostAdapters({ ...fx });
    const started = Date.now();
    const forge = await adapters['afyx-forge']({
      intent: 'doctor',
      budgetLimits: { maxExecutionMs: 40 },
    });
    assert.equal(forge.status, 'FAILED');
    assert.match(forge.reason, /FORGE_EXECUTION_ERROR/);
    assert.equal(Date.now() - started < 1_000, true);
  } finally {
    fx.cleanup();
  }
});

test('CLI performs the same real dynamic discovery and selective execution', () => {
  const fx = fixture();
  const { id } = installDynamic(fx);
  const taskFile = join(fx.root, 'task.json');
  write(taskFile, JSON.stringify({
    id: 'cli-dynamic-1',
    customComponentId: id,
    needsCustomCapability: 'review-assistance',
  }));
  try {
    const result = spawnSync(process.execPath, [
      RUNTIME,
      '--install-root', fx.installRoot,
      '--project-root', fx.projectRoot,
      '--task-file', taskFile,
      '--provider', 'codex',
      '--authorize', id,
    ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.results.some((item) =>
      item.componentId === id && item.executionStatus === 'EXECUTED'), true);
    assert.equal(payload.metrics.toolCalls, 1);
  } finally {
    fx.cleanup();
  }
});

test('direct-source fast path completely bypasses discovery even with nonexistent roots', async () => {
  const result = await runInstalledAfyxWorkflow({
    installRoot: 'Z:\\definitely\\nonexistent\\install\\path',
    projectRoot: 'Z:\\definitely\\nonexistent\\project\\path',
    provider: 'codex',
    task: { id: 'fast-path-exact', taskType: 'string-replacement', exactKnownSource: true },
  });
  assert.equal(result.executionStatus, 'DIRECT_SOURCE');
  assert.equal(result.directSourceFastPath, true);
  assert.equal(result.metrics.toolCalls, 0);
  assert.equal(result.results.length, 0);
});

test('complex task with relational need is never diverted to direct-source fast path', async () => {
  const fx = fixture();
  try {
    installGraph(fx, 256);
    const result = await runInstalledAfyxWorkflow({
      ...fx,
      provider: 'codex',
      authorizations: { 'afyx-graph': true },
      task: {
        id: 'complex-relational-1',
        taskType: 'known-file',
        exactKnownSource: true,
        needsRelationalEvidence: true,
        intent: 'exact source edit with dependency analysis',
      },
    });
    assert.equal(result.directSourceFastPath, false);
    assert.notEqual(result.executionStatus, 'DIRECT_SOURCE');
    const graphExec = result.results.find((item) => item.componentId === 'afyx-graph');
    assert.equal(graphExec?.executionStatus, 'EXECUTED');
  } finally {
    fx.cleanup();
  }
});

test('parallel per-request workflows with distinct dynamic components do not collide', async () => {
  const fxA = fixture();
  const fxB = fixture();
  const dynA = installDynamic(fxA, 'afyx-alpha-review');
  const dynB = installDynamic(fxB, 'afyx-beta-review');
  try {
    const [resA, resB] = await Promise.all([
      runInstalledAfyxWorkflow({
        ...fxA,
        provider: 'codex',
        authorizations: { [dynA.id]: true },
        providerPermissions: { [dynA.id]: true },
        task: {
          id: 'task-parallel-A',
          taskType: 'review',
          customComponentId: dynA.id,
          needsCustomCapability: 'review-assistance',
        },
      }),
      runInstalledAfyxWorkflow({
        ...fxB,
        provider: 'codex',
        authorizations: { [dynB.id]: true },
        providerPermissions: { [dynB.id]: true },
        task: {
          id: 'task-parallel-B',
          taskType: 'review',
          customComponentId: dynB.id,
          needsCustomCapability: 'review-assistance',
        },
      }),
    ]);
    assert.equal(resA.results.some((item) => item.componentId === dynA.id), true);
    assert.equal(resA.results.some((item) => item.componentId === dynB.id), false);
    assert.equal(resB.results.some((item) => item.componentId === dynB.id), true);
    assert.equal(resB.results.some((item) => item.componentId === dynA.id), false);
  } finally {
    fxA.cleanup();
    fxB.cleanup();
  }
});
