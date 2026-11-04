#!/usr/bin/env node
/**
 * Deterministic Afyx Graph benchmark. Generates a synthetic TypeScript project
 * from a fixed seed, then reports medians over repeated runs for:
 * cold index, warm incremental sync, query latency, database size, peak RSS,
 * MCP first-response time and bundle size.
 *
 * usage: node scripts/benchmark.mjs [--files N] [--runs R] [--out file.json]
 * Requires a built dist/ (npm run build:clean). Zero-model, local only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const FILES = Number(arg('files', 300));
const RUNS = Number(arg('runs', 5));
const OUT = arg('out', null);
const distRoot = path.resolve('dist');
const cli = path.join(distRoot, 'bin', 'afyx-graph.js');
if (!fs.existsSync(cli)) throw new Error('dist/ is not built: run `npm run build:clean` first');

process.env.AFYX_GRAPH_NO_WATCH = '1';
process.env.AFYX_GRAPH_NO_DAEMON = '1';

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
};
const round = (value) => Math.round(value * 100) / 100;

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function writeProject(dir) {
  const random = seeded(20260926);
  const groups = Math.max(1, Math.floor(FILES / 10));
  for (let index = 0; index < FILES; index++) {
    const group = index % groups;
    const previous = index >= groups ? index - groups : null;
    const lines = [];
    if (previous !== null) lines.push(`import { Service${previous}, helper${previous} } from './service${previous}';`);
    lines.push(`export function helper${index}(value: number): number { return value + ${index}; }`);
    lines.push(`export class Service${index}${previous !== null ? ` extends Service${previous}` : ''} {`);
    for (let method = 0; method < 4; method++) {
      const callee = previous !== null && random() > 0.4 ? `helper${previous}(value)` : `helper${index}(value)`;
      lines.push(`  run${method}(value: number): number { return ${callee} + ${method}; }`);
    }
    lines.push('}');
    fs.mkdirSync(path.join(dir, 'src', `g${group}`), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', `g${group}`, `service${index}.ts`), lines.join('\n') + '\n');
  }
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'service0.test.ts'), "import { helper0 } from '../src/g0/service0';\nexport const result = helper0(1);\n");
}

// Runs one cold index in a fresh process so peak RSS belongs to that run alone.
function coldIndex(dir) {
  const script = `
    const { performance } = require('node:perf_hooks');
    (async () => {
      const mod = await import(${JSON.stringify(pathToFileURL(path.join(distRoot, 'index.js')).href)});
      const Graph = mod.default?.default ?? mod.default;
      const start = performance.now();
      const graph = await Graph.init(${JSON.stringify(dir)});
      await graph.indexAll();
      const ms = performance.now() - start;
      const stats = graph.getStats();
      graph.close();
      process.stdout.write(JSON.stringify({ ms, maxRssKb: process.resourceUsage().maxRSS, nodes: stats.nodeCount, edges: stats.edgeCount, files: stats.fileCount }));
    })();`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 600_000 });
  if (result.status !== 0) throw new Error(`cold index failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function timeQueries(dir) {
  const mod = await import(pathToFileURL(path.join(distRoot, 'index.js')).href);
  const Graph = mod.default?.default ?? mod.default;
  const graph = await Graph.open(dir);
  const target = graph.searchNodes(`helper${Math.floor(FILES / 2)}`, { limit: 5 }).find(({ node }) => node.kind === 'function')?.node;
  const method = graph.searchNodes('run0', { limit: 5 })[0]?.node;
  const measure = async (fn, repeat = 20) => {
    const samples = [];
    for (let i = 0; i < repeat; i++) {
      const start = performance.now();
      await fn();
      samples.push(performance.now() - start);
    }
    return round(median(samples));
  };
  const latency = {
    search_ms: await measure(() => graph.searchNodes('helper', { limit: 20 })),
    callers_ms: target ? await measure(() => graph.getCallers(target.id)) : null,
    callees_ms: method ? await measure(() => graph.getCallees(method.id)) : null,
    impact_ms: target ? await measure(() => graph.getImpactRadius(target.id, 3)) : null,
    dependents_ms: await measure(() => graph.getFileDependents('src/g0/service0.ts')),
    context_ms: await measure(() => graph.findRelevantContext('change helper and its callers', { searchLimit: 5, traversalDepth: 1 }), 5),
  };
  latency.result_counts = {
    search: graph.searchNodes('helper', { limit: 20 }).length,
    callers: target ? graph.getCallers(target.id).length : 0,
    callees: method ? graph.getCallees(method.id).length : 0,
    impact_nodes: target ? graph.getImpactRadius(target.id, 3).nodes.size ?? graph.getImpactRadius(target.id, 3).nodes.length : 0,
    dependents: graph.getFileDependents('src/g0/service0.ts').length,
  };
  graph.close();
  return latency;
}

async function warmSync(dir) {
  const mod = await import(pathToFileURL(path.join(distRoot, 'index.js')).href);
  const Graph = mod.default?.default ?? mod.default;
  const graph = await Graph.open(dir);
  for (let i = 0; i < 5; i++) {
    const file = path.join(dir, 'src', `g${i % Math.max(1, Math.floor(FILES / 10))}`, `service${i}.ts`);
    fs.appendFileSync(file, `export const touched${i}_${Date.now()} = ${i};\n`);
  }
  const start = performance.now();
  await graph.sync();
  const ms = performance.now() - start;
  graph.close();
  return ms;
}

function mcpFirstResponse(dir) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [cli, 'serve', '--mcp'], { cwd: dir, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let responseComplete = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('MCP timed out')), 60_000);
    child.once('error', (error) => fail(error));
    child.once('close', (code) => {
      if (!responseComplete) {
        fail(new Error(`MCP closed before first tool result (code ${code ?? 'unknown'})`));
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(marks);
    });
    let buffer = '';
    let stage = 0;
    const marks = {};
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          marks.initialize_ms = performance.now() - start;
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'afyx_graph_explore', arguments: { query: 'helper run0' } } }) + '\n');
          stage = 1;
        } else if (message.id === 2 && stage === 1) {
          marks.first_tool_result_ms = performance.now() - start;
          responseComplete = true;
          child.stdin.end();
          child.kill();
        }
      }
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bench', version: '0' }, rootUri: `file://${dir.replace(/\\/g, '/')}` },
    }) + '\n');
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-bench-'));
try {
  const cold = [];
  let indexedDir = null;
  for (let run = 0; run < RUNS; run++) {
    const dir = path.join(root, `cold${run}`);
    writeProject(dir);
    cold.push(coldIndex(dir));
    indexedDir = dir;
  }
  const dbPath = path.join(indexedDir, '.afyx-graph', 'afyx-graph.db');
  const latency = await timeQueries(indexedDir);
  const mcp = [];
  for (let run = 0; run < Math.min(RUNS, 3); run++) mcp.push(await mcpFirstResponse(indexedDir));
  const syncs = [];
  for (let run = 0; run < RUNS; run++) syncs.push(await warmSync(indexedDir));
  const bundle = path.resolve('release', 'afyx-graph-win32-x64.zip');
  const report = {
    generated_by: 'scripts/benchmark.mjs',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpus: os.cpus().length,
    files: FILES,
    runs: RUNS,
    project: { files: cold[0].files, nodes: cold[0].nodes, edges: cold[0].edges },
    cold_index_ms: round(median(cold.map((sample) => sample.ms))),
    cold_index_p95_ms: round(p95(cold.map((sample) => sample.ms))),
    cold_index_peak_rss_mb: round(median(cold.map((sample) => sample.maxRssKb)) / 1024),
    cold_index_peak_rss_p95_mb: round(p95(cold.map((sample) => sample.maxRssKb)) / 1024),
    warm_sync_5_files_ms: round(median(syncs)),
    warm_sync_5_files_p95_ms: round(p95(syncs)),
    query_latency: latency,
    db_size_mb: round(fs.statSync(dbPath).size / 1024 / 1024),
    mcp_initialize_ms: round(median(mcp.map((sample) => sample.initialize_ms))),
    mcp_initialize_p95_ms: round(p95(mcp.map((sample) => sample.initialize_ms))),
    mcp_first_tool_result_ms: round(median(mcp.map((sample) => sample.first_tool_result_ms))),
    mcp_first_tool_result_p95_ms: round(p95(mcp.map((sample) => sample.first_tool_result_ms))),
    dist_size_mb: round(directorySize(distRoot) / 1024 / 1024),
    bundle_size_mb: fs.existsSync(bundle) ? round(fs.statSync(bundle).size / 1024 / 1024) : null,
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (OUT) fs.writeFileSync(OUT, text + '\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function directorySize(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const full = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? directorySize(full) : fs.statSync(full).size);
  }, 0);
}
