import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
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
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AFYX_HOST_BRIDGE_CONTRACT,
  invokeHostWorkflow,
} from '../afyx-host-bridge.mjs';
import { createInstalledHostAdapters } from '../afyx-host-adapters.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_BRIDGE = resolve(HERE, '..', 'afyx-host-bridge.mjs');
const COMPONENTS = JSON.parse(readFileSync(resolve(HERE, '..', 'components.json'), 'utf8')).components;

function write(path, value = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'afyx-host-bridge-test-'));
  const installRoot = join(root, 'install');
  const projectRoot = join(root, 'project');
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  return {
    root,
    installRoot,
    projectRoot,
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
      : join(fx.root, 'codex-tools'));
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

function installGraph(fx, outputBytes = 256) {
  installRegistrySkeleton(fx, 'afyx-graph');
  write(join(fx.installRoot, 'graph', 'metadata.json'), JSON.stringify({
    product_name: 'Afyx Graph',
    source_revision: 'graph-rev-1',
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

function installContext(fx) {
  installRegistrySkeleton(fx, 'afyx-context');
  write(join(fx.installRoot, 'context', 'metadata.json'), JSON.stringify({
    product_name: 'Afyx Context Engine',
    source_revision: 'context-rev-1',
  }));
  write(join(fx.installRoot, 'context', 'current', 'identity.json'), '{}');
  write(
    join(fx.installRoot, 'context', 'current', 'dist', 'cli.js'),
    `import(${JSON.stringify(pathToFileURL(resolve(HERE, '..', '..', 'afyx-context', 'src', 'cli.js')).href)});\n`,
  );
}

test('generic file inventory uses Graph files while Odoo impact keeps declaration inventory', async () => {
  const fx = fixture();
  try {
    installGraph(fx);
    write(
      join(fx.installRoot, 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js'),
      'process.stdout.write(process.argv.slice(2).join("|"));\n',
    );
    const graph = createInstalledHostAdapters({
      installRoot: fx.installRoot,
      projectRoot: fx.projectRoot,
    })['afyx-graph'];
    const generic = await graph({ taskType: 'impact-analysis', intent: 'inventory source files' });
    assert.equal(generic.status, 'SUCCESS');
    assert.match(generic.output, /^files\|--format\|tree\|--max-depth\|2\|--path\|/);
    assert.equal(generic.evidence[0].command, 'files');
    assert.doesNotMatch(generic.output, /sale\.order/);

    const odoo = await graph({ taskType: 'odoo-impact-analysis', intent: 'inventory Odoo inheritance' });
    assert.equal(odoo.status, 'SUCCESS');
    assert.match(odoo.output, /^inventory\|_inherit\|sale\.order\|--path\|/);
    assert.equal(odoo.evidence[0].command, 'inventory');
  } finally {
    fx.cleanup();
  }
});

test('host bridge API: direct-source negative case executes 0 tool calls with DIRECT_SOURCE status', async () => {
  const fx = fixture();
  try {
    write(join(fx.projectRoot, 'src', 'index.ts'), 'export const greeting = "hi";');
    const result = await invokeHostWorkflow({
      task: {
        taskType: 'string-replacement',
        exactKnownSource: true,
        path: 'src/index.ts',
        prompt: 'fix typo in greeting',
      },
      projectRoot: fx.projectRoot,
      installRoot: fx.installRoot,
      provider: 'antigravity',
    });

    assert.equal(result.bridgeContract, AFYX_HOST_BRIDGE_CONTRACT);
    assert.equal(result.host.provider, 'antigravity');
    assert.equal(result.executionStatus, 'DIRECT_SOURCE');
    assert.equal(result.metrics.toolCalls, 0);
    assert.deepEqual(result.results, []);
  } finally {
    fx.cleanup();
  }
});

test('host bridge API: relational Graph/Context case discovers and executes components delivering result', async () => {
  const fx = fixture();
  try {
    installGraph(fx, 25_000); // Trigger Context follow-up
    installContext(fx);
    write(join(fx.projectRoot, 'src', 'order.ts'), 'export class OrderService {}');

    const result = await invokeHostWorkflow({
      task: {
        taskType: 'impact-analysis',
        needsRelationalEvidence: true,
        intent: 'explore OrderService relations',
      },
      projectRoot: fx.projectRoot,
      installRoot: fx.installRoot,
      provider: 'antigravity',
      authorizations: { 'afyx-graph': true, 'afyx-context': true },
    });

    assert.equal(result.bridgeContract, AFYX_HOST_BRIDGE_CONTRACT);
    assert.equal(result.host.provider, 'antigravity');
    const graphResult = result.results.find((item) => item.componentId === 'afyx-graph');
    assert.ok(graphResult, 'afyx-graph result must exist');
    assert.equal(graphResult.executionStatus, 'EXECUTED');
    assert.ok(result.metrics.toolCalls >= 1, 'At least 1 tool call executed');
  } finally {
    fx.cleanup();
  }
});

test('host bridge CLI: executes direct-source negative case and relational workflow via --task JSON', () => {
  const fx = fixture();
  try {
    write(join(fx.projectRoot, 'src', 'math.ts'), 'export function add(a, b) { return a + b; }');
    installGraph(fx, 500);
    installContext(fx);

    // 1. Direct source negative case via CLI
    const dsRun = spawnSync(
      process.execPath,
      [
        HOST_BRIDGE,
        '--task',
        JSON.stringify({
          taskType: 'string-replacement',
          exactKnownSource: true,
          path: 'src/math.ts',
        }),
        '--project-root',
        fx.projectRoot,
        '--install-root',
        fx.installRoot,
        '--provider',
        'antigravity',
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    assert.equal(dsRun.status, 0, `Direct source run failed: ${dsRun.stderr}`);
    const dsResult = JSON.parse(dsRun.stdout);
    assert.equal(dsResult.bridgeContract, AFYX_HOST_BRIDGE_CONTRACT);
    assert.equal(dsResult.executionStatus, 'DIRECT_SOURCE');
    assert.equal(dsResult.metrics.toolCalls, 0);

    // 2. Relational case via CLI
    const relRun = spawnSync(
      process.execPath,
      [
        HOST_BRIDGE,
        '--task',
        JSON.stringify({
          taskType: 'impact-analysis',
          needsRelationalEvidence: true,
          intent: 'explore MathService',
        }),
        '--project-root',
        fx.projectRoot,
        '--install-root',
        fx.installRoot,
        '--provider',
        'antigravity',
        '--authorize',
        'afyx-graph,afyx-context',
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    assert.equal(relRun.status, 0, `Relational run failed: ${relRun.stderr}`);
    const relResult = JSON.parse(relRun.stdout);
    assert.equal(relResult.bridgeContract, AFYX_HOST_BRIDGE_CONTRACT);
    const graphResult = relResult.results.find((item) => item.componentId === 'afyx-graph');
    assert.ok(graphResult, 'afyx-graph result must exist');
    assert.equal(graphResult.executionStatus, 'EXECUTED');
  } finally {
    fx.cleanup();
  }
});

test('host bridge MCP: stdio MCP server supports initialize, tools/list, and tools/call', async () => {
  const fx = fixture();
  const child = spawn(
    process.execPath,
    [HOST_BRIDGE, 'serve', '--mcp', '--install-root', fx.installRoot, '--project-root', fx.projectRoot],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  try {
    installGraph(fx, 500);
    installContext(fx);

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString('utf8');
    });

    const sendRpc = (obj) => {
      child.stdin.write(JSON.stringify(obj) + '\n');
    };

    const waitForMessage = async (timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const newlineIdx = output.indexOf('\n');
        if (newlineIdx >= 0) {
          const line = output.slice(0, newlineIdx).trim();
          output = output.slice(newlineIdx + 1);
          if (line) return JSON.parse(line);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`Timeout waiting for MCP message. Output so far: ${output}`);
    };

    // 1. Initialize
    sendRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} },
    });
    const initRes = await waitForMessage();
    assert.equal(initRes.id, 1);
    assert.equal(initRes.result?.serverInfo?.name, 'afyx-universal-host-bridge');

    // 2. Initialized notification
    sendRpc({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    // 3. Tools list
    sendRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const listRes = await waitForMessage();
    assert.equal(listRes.id, 2);
    const tools = listRes.result?.tools;
    assert.ok(Array.isArray(tools));
    const workflowTool = tools.find((t) => t.name === 'afyx_workflow');
    assert.ok(workflowTool, 'afyx_workflow tool must be present');
    assert.deepEqual(Object.keys(workflowTool.inputSchema.properties), ['task']);

    // 4. Tools call direct source
    sendRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'afyx_workflow',
        arguments: {
          task: {
            taskType: 'string-replacement',
            exactKnownSource: true,
          },
          provider: 'antigravity',
        },
      },
    });
    const callRes = await waitForMessage();
    assert.equal(callRes.id, 3);
    const textContent = callRes.result?.content?.[0]?.text;
    assert.ok(textContent, 'Must contain text response');
    const workflowPayload = JSON.parse(textContent);
    assert.equal(workflowPayload.bridgeContract, AFYX_HOST_BRIDGE_CONTRACT);
    assert.equal(workflowPayload.executionStatus, 'DIRECT_SOURCE');
    assert.equal(workflowPayload.metrics.toolCalls, 0);
  } finally {
    child.stdin.end();
    child.kill();
    fx.cleanup();
  }
});

test('host bridge MCP: trusted launch authorization cannot be supplied or overridden by tool input', async () => {
  const fx = fixture();
  installGraph(fx, 500);

  const invoke = (extraArgs, suppliedArguments) => new Promise((accept, reject) => {
    const child = spawn(process.execPath, [
      HOST_BRIDGE,
      'serve',
      '--mcp',
      '--install-root', fx.installRoot,
      '--project-root', fx.projectRoot,
      '--provider', 'antigravity',
      ...extraArgs,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout waiting for MCP response: ${stdout} ${stderr}`));
    }, 5_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      try {
        accept(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'afyx_workflow', arguments: suppliedArguments },
    })}\n`);
  });

  const task = {
    id: 'trusted-auth-1',
    taskType: 'impact-analysis',
    needsRelationalEvidence: true,
    intent: 'impact analysis OrderService',
  };
  try {
    const denied = await invoke([], {
      task,
      projectRoot: 'D:/model-controlled-project',
      installRoot: 'D:/model-controlled-install',
      provider: 'codex',
      authorizations: { 'afyx-graph': true },
    });
    const deniedPayload = JSON.parse(denied.result.content[0].text);
    assert.equal(deniedPayload.host.provider, 'antigravity');
    assert.equal(deniedPayload.host.projectRoot, resolve(fx.projectRoot));
    assert.equal(deniedPayload.results.some((item) => item.componentId === 'afyx-graph'), false);
    assert.equal(deniedPayload.degradations.some((item) =>
      item.componentId === 'afyx-graph' && item.reason === 'UNAUTHORIZED_OR_UNVERIFIED'), true);

    const allowed = await invoke(['--authorize', 'afyx-graph'], { task });
    const allowedPayload = JSON.parse(allowed.result.content[0].text);
    assert.equal(allowedPayload.results.some((item) =>
      item.componentId === 'afyx-graph' && item.executionStatus === 'EXECUTED'), true);
  } finally {
    fx.cleanup();
  }
});
