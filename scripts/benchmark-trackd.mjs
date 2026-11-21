#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const engineDir = path.join(repoRoot, 'afyx-graph', 'engine');
const cliBin = path.join(engineDir, 'dist', 'bin', 'afyx-graph.js');

const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};

const label = argValue('--label', 'baseline');
const outputFile = argValue('--out', path.join(repoRoot, 'benchmark', 'runs', `trackd-${label}.json`));
const rounds = parseInt(argValue('--rounds', '5'), 10);
const filesCount = parseInt(argValue('--files', '60'), 10);

console.log(`[benchmark-trackd] Running Track D benchmark (${label})...`);
console.log(`[benchmark-trackd] Repo Root: ${repoRoot}`);
console.log(`[benchmark-trackd] Engine: ${engineDir}`);
console.log(`[benchmark-trackd] Rounds: ${rounds}, Files: ${filesCount}`);

const runCommand = (cmd, args, cwd = repoRoot, env = {}) => {
  const start = performance.now();
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = performance.now() - start;
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}\n${res.stderr || res.stdout}`);
    throw new Error(`Command ${cmd} exited with status ${res.status}`);
  }
  return { stdout: res.stdout, stderr: res.stderr, durationMs };
};

// 1. Run DB Micro-benchmarks
console.log('[benchmark-trackd] Step 1/4: Running DB Persistence benchmarks...');
const dbResult = runCommand(process.execPath, [
  path.join(engineDir, 'scripts', 'benchmark-db.mjs'),
  '--files', String(filesCount),
  '--rounds', String(rounds),
], engineDir);
const dbMetrics = JSON.parse(dbResult.stdout);

// 2. Run Graph Traversal Micro-benchmarks
console.log('[benchmark-trackd] Step 2/4: Running Graph Traversal benchmarks...');
const graphResult = runCommand(process.execPath, [
  path.join(engineDir, 'scripts', 'benchmark-graph.mjs'),
  '--files', String(filesCount),
  '--rounds', String(rounds),
], engineDir);
const graphMetrics = JSON.parse(graphResult.stdout);

// 3. Run Cold Indexing, Warm Sync, and No-op Sync on a synthetic project
console.log('[benchmark-trackd] Step 3/4: Running Indexing & Sync Lifecycle benchmarks...');
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-trackd-bench-'));

function createSyntheticProject(targetDir, count) {
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  for (let i = 0; i < count; i++) {
    const prev = i > 0 ? i - 1 : null;
    const content = `// Synthetic Source File ${i}
${prev !== null ? `import { Item${prev} } from './item${prev}';\n` : ''}
export class Item${i} ${prev !== null ? `extends Item${prev} ` : ''}{
  public id: number = ${i};
  public compute(val: number): number {
    return val + ${i} ${prev !== null ? `+ new Item${prev}().compute(val)` : ''};
  }
}
export function helper${i}(x: number): number {
  return new Item${i}().compute(x);
}
`;
    fs.writeFileSync(path.join(targetDir, 'src', `item${i}.ts`), content, 'utf8');
  }
}

createSyntheticProject(scratchDir, filesCount);

const env = {
  AFYX_GRAPH_NO_WATCH: '1',
  AFYX_GRAPH_NO_DAEMON: '1',
  AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1',
  NO_COLOR: '1',
};

// Cold Index
const coldRuns = [];
for (let r = 0; r < rounds; r++) {
  // Clear any existing index
  const indexPath = path.join(scratchDir, '.afyx-graph');
  if (fs.existsSync(indexPath)) fs.rmSync(indexPath, { recursive: true, force: true });
  const run = runCommand(process.execPath, [cliBin, 'init', scratchDir], repoRoot, env);
  coldRuns.push(run.durationMs);
}
coldRuns.sort((a, b) => a - b);
const coldIndexMedianMs = coldRuns[Math.floor(coldRuns.length / 2)];

// No-op Sync
const noopRuns = [];
for (let r = 0; r < rounds; r++) {
  const run = runCommand(process.execPath, [cliBin, 'sync', scratchDir], repoRoot, env);
  noopRuns.push(run.durationMs);
}
noopRuns.sort((a, b) => a - b);
const noopSyncMedianMs = noopRuns[Math.floor(noopRuns.length / 2)];

// Incremental Sync (modify 1 file)
const incrementalRuns = [];
for (let r = 0; r < rounds; r++) {
  const targetFile = path.join(scratchDir, 'src', 'item0.ts');
  const prevContent = fs.readFileSync(targetFile, 'utf8');
  fs.writeFileSync(targetFile, prevContent + `\n// modified ${Date.now()}\nexport const mod${r} = ${r};\n`, 'utf8');
  const run = runCommand(process.execPath, [cliBin, 'sync', scratchDir], repoRoot, env);
  incrementalRuns.push(run.durationMs);
}
incrementalRuns.sort((a, b) => a - b);
const incrementalSyncMedianMs = incrementalRuns[Math.floor(incrementalRuns.length / 2)];

// Query Latency
const queryRuns = [];
for (let r = 0; r < rounds; r++) {
  const run = runCommand(process.execPath, [cliBin, 'query', 'Item0', '--path', scratchDir], repoRoot, env);
  queryRuns.push(run.durationMs);
}
queryRuns.sort((a, b) => a - b);
const queryMedianMs = queryRuns[Math.floor(queryRuns.length / 2)];

// Cleanup scratch project
try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch {}

// 4. Run Capability Orchestrator Benchmark
console.log('[benchmark-trackd] Step 4/4: Running Orchestrator & Memory benchmarks...');
const orchResult = runCommand(process.execPath, [
  path.join(repoRoot, 'scripts', 'benchmark_capability_orchestrator.mjs'),
], repoRoot);

const memoryUsage = process.memoryUsage();

const consolidatedReport = {
  contract: 'AfyxTrackDBenchmark/v1',
  label,
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    gitRevision: runCommand('git', ['rev-parse', 'HEAD'], repoRoot).stdout.trim(),
  },
  lifecycle: {
    coldIndexMedianMs: Math.round(coldIndexMedianMs * 100) / 100,
    noopSyncMedianMs: Math.round(noopSyncMedianMs * 100) / 100,
    incrementalSyncMedianMs: Math.round(incrementalSyncMedianMs * 100) / 100,
    queryMedianMs: Math.round(queryMedianMs * 100) / 100,
    rounds,
    filesCount,
  },
  persistence: dbMetrics,
  traversal: graphMetrics,
  memory: {
    rssMb: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100,
    heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100,
    heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100,
  },
  orchestratorStdout: orchResult.stdout.trim(),
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(consolidatedReport, null, 2), 'utf8');
console.log(`[benchmark-trackd] Benchmark run complete! Report written to: ${outputFile}`);
console.log(JSON.stringify({
  label,
  coldIndexMedianMs: consolidatedReport.lifecycle.coldIndexMedianMs,
  noopSyncMedianMs: consolidatedReport.lifecycle.noopSyncMedianMs,
  incrementalSyncMedianMs: consolidatedReport.lifecycle.incrementalSyncMedianMs,
  queryMedianMs: consolidatedReport.lifecycle.queryMedianMs,
  bfsDeepMedianUs: graphMetrics.cases.bfs_deep_both?.median_us,
  dbBatchInsertNodesUs: dbMetrics.cases.insert_nodes_batch?.median_us_per_op,
  dbTransactionCommitUs: dbMetrics.cases.transaction_commit?.median_us_per_op,
}, null, 2));
