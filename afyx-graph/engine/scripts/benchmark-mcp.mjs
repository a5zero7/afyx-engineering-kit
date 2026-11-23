#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';

const valueAfter = (flag, fallback = null) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const bin = path.resolve(valueAfter('--bin', 'dist/bin/afyx-graph.js'));
const project = path.resolve(valueAfter('--project', '.'));
const rounds = Number(valueAfter('--rounds', '5'));
const outputPath = valueAfter('--out');

if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error('--rounds must be a positive integer');
}
if (!fs.existsSync(bin)) throw new Error(`MCP binary does not exist: ${bin}`);
if (!fs.existsSync(path.join(project, '.afyx-graph'))) {
  throw new Error(`Benchmark project is not indexed: ${project}`);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function waitForExit(child, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function runRound(round) {
  const started = performance.now();
  const child = spawn(process.execPath, [
    bin, 'serve', '--mcp', '--path', project,
  ], {
    cwd: project,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AFYX_GRAPH_NO_DAEMON: '1',
      AFYX_GRAPH_NO_WATCHDOG: '1',
      AFYX_GRAPH_MCP_TOOLS: 'explore,search,status',
    },
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const pending = new Map();
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  stdout.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  });

  let nextId = 1;
  const request = (method, params) => {
    const id = nextId++;
    const sentAt = performance.now();
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}; stderr=${stderr}`));
      }, 15_000);
      pending.set(id, { resolve, reject, timer });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return response.then((message) => ({ message, elapsedMs: performance.now() - sentAt }));
  };

  try {
    const initialize = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'afyx-mcp-benchmark', version: '1' },
      rootUri: `file://${project.replace(/\\/g, '/')}`,
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);

    const list = await request('tools/list', {});
    const valid = await request('tools/call', {
      name: 'afyx_graph_search',
      arguments: { query: 'benchmarkMcpFixture', limit: 10 },
    });
    const invalidTool = await request('tools/call', {
      name: 'afyx_graph_missing', arguments: {},
    });
    const invalidArguments = await request('tools/call', {
      name: 'afyx_graph_search', arguments: {},
    });
    const repeat = await request('tools/call', {
      name: 'afyx_graph_search',
      arguments: { query: 'benchmarkMcpFixture', limit: 10 },
    });

    if (JSON.stringify(valid.message.result) !== JSON.stringify(repeat.message.result)) {
      throw new Error('Sequential identical requests returned different semantic results');
    }

    const contract = {
      initialize: initialize.message,
      toolsList: list.message,
      validCall: valid.message,
      invalidTool: invalidTool.message,
      invalidArguments: invalidArguments.message,
      repeatCall: repeat.message,
    };
    const payloadBytes = Object.fromEntries(
      Object.entries(contract).map(([name, value]) => [name, byteLength(value)]),
    );

    const shutdownStarted = performance.now();
    child.stdin.end();
    let exitCode = await waitForExit(child);
    if (exitCode === null) {
      child.kill('SIGTERM');
      exitCode = await waitForExit(child);
    }
    if (exitCode !== 0) throw new Error(`MCP process exited ${exitCode}; stderr=${stderr}`);

    return {
      round,
      timingsMs: {
        initialize: initialize.elapsedMs,
        toolsList: list.elapsedMs,
        validCall: valid.elapsedMs,
        invalidTool: invalidTool.elapsedMs,
        invalidArguments: invalidArguments.elapsedMs,
        repeatCall: repeat.elapsedMs,
        shutdown: performance.now() - shutdownStarted,
        lifecycle: performance.now() - started,
      },
      payloadBytes,
      contract,
    };
  } finally {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('MCP benchmark stopped'));
    }
    pending.clear();
    stdout.close();
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}

const observations = [];
for (let round = 1; round <= rounds; round += 1) {
  observations.push(await runRound(round));
}

const referenceContract = JSON.stringify(observations[0].contract);
if (observations.some((observation) => JSON.stringify(observation.contract) !== referenceContract)) {
  throw new Error('MCP contract was not deterministic across benchmark rounds');
}

const metricNames = Object.keys(observations[0].timingsMs);
const timingSummaryMs = Object.fromEntries(metricNames.map((name) => {
  const values = observations.map((observation) => observation.timingsMs[name]);
  return [name, {
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    samples: values,
  }];
}));

const report = {
  generatedBy: 'scripts/benchmark-mcp.mjs',
  node: process.version,
  platform: process.platform,
  bin,
  project,
  rounds,
  timingSummaryMs,
  payloadBytes: observations[0].payloadBytes,
  contract: observations[0].contract,
};
const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(path.resolve(outputPath), rendered);
process.stdout.write(rendered);
