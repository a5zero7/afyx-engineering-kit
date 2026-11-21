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



async function profileMcp(project, env, probeUrl, samples) {
  const [{ spawn }, { createInterface }, { once }] = await Promise.all([
    import('node:child_process'), import('node:readline'), import('node:events'),
  ]);
  const started = performance.now();
  const child = spawn(process.execPath, ['--import', probeUrl, cliBin, 'serve', '--mcp'], {
    cwd: project, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  const closed = once(child, 'close');
  const readers = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  readers.on('line', (line) => {
    try {
      const packet = JSON.parse(line);
      pending.get(packet.id)?.(packet);
    } catch { /* Transport diagnostics do not resolve an RPC. */ }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const began = performance.now();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Batas waktu MCP: ' + method));
    }, 10_000);
    pending.set(id, (packet) => {
      clearTimeout(timer);
      pending.delete(id);
      if (packet.error || packet.result?.isError) reject(new Error('MCP gagal: ' + method));
      else resolve({ ms: performance.now() - began, result: packet.result });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  child.stdin.on('error', () => { /* Batas waktu RPC menangani transport yang terputus. */ });
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'afyx-trackd', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const startupMs = performance.now() - started;
    const query = () => request('tools/call', { name: 'afyx_graph_search', arguments: { query: 'item0' } });
    const warmup = await query();
    if (!JSON.stringify(warmup.result).includes('item0')) throw new Error('Simbol fixture tidak ditemukan.');
    const digest = crypto.createHash('sha256').update(JSON.stringify(warmup.result)).digest('hex');
    const latencies = [];
    let elapsed = 0;
    for (let i = 0; i < samples; i++) {
      const began = performance.now();
      const wave = await Promise.all(Array.from({ length: 8 }, query));
      elapsed += performance.now() - began;
      for (const entry of wave) {
        const actual = crypto.createHash('sha256').update(JSON.stringify(entry.result)).digest('hex');
        if (actual !== digest) throw new Error('Hasil MCP paralel berubah untuk input yang sama.');
        latencies.push(entry.ms);
      }
    }
    const sorted = latencies.sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
    const database = path.join(env.AFYX_GRAPH_STATE_DIR, 'afyx-graph.db');
    const sqliteBytes = Object.fromEntries([['db', ''], ['wal', '-wal'], ['shm', '-shm']].map(([key, suffix]) =>
      [key, fs.statSync(database + suffix, { throwIfNoEntry: false })?.size ?? null]));
    return { surface: 'MCP stdio langsung, daemon OFF', startupMs, concurrentRequests: 8, waves: samples,
      responses: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
      iqrMs: percentile(0.75) - percentile(0.25), responsesPerSecond: sorted.length * 1000 / elapsed,
      sqliteBytes, repeatabilityDigest: digest };
  } finally {
    readers.close();
    child.stdin.end();
    const timeout = setTimeout(() => child.kill(), 1000);
    await closed.finally(() => clearTimeout(timeout));
  }
}

async function runCertificationBaseline() {
  const { pathToFileURL } = await import('node:url');
  const count = Number(argValue('--files', '216'));
  const samples = Number(argValue('--rounds', '15'));
  const seed = Number(argValue('--seed', '23'));
  if (!Number.isInteger(count) || count < 200 || count > 2000 ||
      !Number.isInteger(samples) || samples < 15 || samples > 100 ||
      !Number.isSafeInteger(seed)) {
    throw new Error('Sertifikasi memerlukan 200–2.000 berkas, 15–100 sampel dan seed integer.');
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-trackd-cert-'));
  const project = path.join(scratch, 'fixture');
  const sampleFile = path.join(scratch, 'child.json');
  const probe = path.join(scratch, 'probe.mjs');
  const childEnv = { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_NO_WATCH: '1',
    AFYX_TRACKD_SAMPLE: sampleFile, NO_COLOR: '1' };
  const hash = crypto.createHash('sha256');
  try {
    fs.mkdirSync(project);
    fs.writeFileSync(probe, [
      "import { writeFileSync } from 'node:fs';",
      "process.once('exit', () => writeFileSync(process.env.AFYX_TRACKD_SAMPLE, JSON.stringify({",
      "  peakRssKiB: process.resourceUsage().maxRSS, heapUsedAtExitBytes: process.memoryUsage().heapUsed",
      "})));",
    ].join('\n'));
    for (let i = 0; i < count; i++) {
      const n = i + seed;
      const sources = [
        ['ts', 'export function item' + i + '() { return ' + n + '; }\n'],
        ['py', 'def item_' + i + '():\n    return ' + n + '\n'],
        ['go', 'package corpus\nfunc Item' + i + '() int { return ' + n + ' }\n'],
        ['sql', 'CREATE TABLE item_' + i + ' (id INTEGER PRIMARY KEY);\n'],
        ['yaml', 'fixture_' + i + ': ' + n + '\n'],
        ['json', JSON.stringify({ ['fixture_' + i]: n }) + '\n'],
      ];
      const [extension, contents] = sources[i % sources.length];
      const name = 'item-' + i + '.' + extension;
      hash.update(name + '\0' + contents + '\0');
      fs.writeFileSync(path.join(project, name), contents);
    }
    const run = (args) => {
      const started = performance.now();
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(probe).href, cliBin, ...args], {
        cwd: project, env: childEnv, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      if (result.status !== 0) throw new Error('Graph gagal: ' + (result.error?.code ?? result.stderr.trim()));
      return { ms: performance.now() - started, ...JSON.parse(fs.readFileSync(sampleFile, 'utf8')) };
    };
    function summary(records) {
      const sorted = records.map((sample) => sample.ms).sort((a, b) => a - b);
      const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
      return { count: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
        iqrMs: percentile(0.75) - percentile(0.25),
        maxChildPeakRssKiB: Math.max(...records.map((sample) => sample.peakRssKiB)),
        maxChildHeapUsedAtExitBytes: Math.max(...records.map((sample) => sample.heapUsedAtExitBytes)) };
    }
    const mcpOnly = process.argv.includes('--mcp-only');
    const cold = [];
    const warm = [];
    const query = [];
    for (let i = -1; i < (mcpOnly ? 0 : samples); i++) {
      const usingState = path.join(scratch, 'state-' + i);
      childEnv.AFYX_GRAPH_STATE_DIR = usingState;
      const indexed = run(['init', project]);
      if (i >= 0) cold.push(indexed);
    }
    if (!mcpOnly) {
      run(['sync', project]);
      run(['query', 'item0', '--path', project]);
      for (let i = 0; i < samples; i++) {
        warm.push(run(['sync', project]));
        query.push(run(['query', 'item0', '--path', project]));
      }
    }
    const mcp = await profileMcp(project, childEnv, pathToFileURL(probe).href, samples);
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    if (git.status !== 0) throw new Error('SHA sumber tidak tersedia.');
    const report = { contract: 'AfyxTrackDBaseline/v1', sourceRevision: git.stdout.trim(), seed,
      fixtureFiles: count, fixtureSha256: hash.digest('hex'), warmupsPerWorkload: 1,
      environment: { node: process.version, os: os.type(), release: os.release(), arch: process.arch,
        cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
      coldIndex: mcpOnly ? null : summary(cold), noopSync: mcpOnly ? null : summary(warm), query: mcpOnly ? null : summary(query), mcp,
      limitations: ['Cold berarti indeks baru per iterasi, cache OS tidak dikosongkan.',
        'Heap diukur saat proses keluar. Antrean daemon, kontensi writer, cancellation, dan mutu semantik belum diukur.'],
    };
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv.includes('--certification-baseline')) {
  await runCertificationBaseline();
  process.exit(0);
}

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
    timeout: 120_000,
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
  fs.writeFileSync(targetFile, prevContent + `\n// modified ${r}\nexport const mod${r} = ${r};\n`, 'utf8');
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
    source: 'benchmark-harness',
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
