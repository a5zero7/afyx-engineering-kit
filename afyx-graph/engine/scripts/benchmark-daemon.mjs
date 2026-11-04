#!/usr/bin/env node
/**
 * Micro-benchmark for the shared MCP daemon/proxy lifecycle (dist/mcp,
 * dist/bin): cold start, attach-to-existing, a second concurrent client
 * attaching, a request/response round trip, client detach, graceful shutdown,
 * and restart-after-a-stale-lock (the PID-reuse-safety recovery path).
 *
 * Deliberately drives REAL subprocesses (`dist/bin/afyx-graph.js serve --mcp`
 * with `AFYX_GRAPH_DAEMON_INTERNAL=1`, the same invocation `spawnDetachedDaemon`
 * uses) rather than an in-process `new Daemon().start()` — the daemon's own
 * `stop()` calls `process.exit()`, which would kill an in-process benchmark
 * script outright, and subprocess timings are what actually matters here (real
 * process spawn + socket bind + IPC round trip), not function-call overhead.
 *
 * Reports medians (+ min/max spread) over repeated rounds plus a digest of
 * each round's observable outcome, for correctness cross-checking between
 * OLD/NEW builds.
 *
 * usage: node scripts/benchmark-daemon.mjs [--rounds R] [--out file.json]
 * Requires a built dist/ (npm run build:clean).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const ROUNDS = Number(arg('rounds', 5));
const OUT = arg('out', null);

const BIN = path.resolve('dist', 'bin', 'afyx-graph.js');
const MCP_DIST = path.resolve('dist', 'mcp');
if (!fs.existsSync(BIN)) throw new Error('dist/ is not built: run `npm run build:clean` first');

const { connectWithHello } = await import(pathToFileURL(path.join(MCP_DIST, 'proxy.js')).href);
const { getDaemonSocketCandidates, getDaemonPidPath } = await import(pathToFileURL(path.join(MCP_DIST, 'daemon-paths.js')).href);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value) => Math.round(value * 1000) / 1000;
const digestOf = (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12);

function summarize(samples, digestInputs) {
  return {
    median_ms: round(median(samples)),
    min_ms: round(Math.min(...samples)),
    max_ms: round(Math.max(...samples)),
    n: samples.length,
    digest: digestOf(digestInputs),
  };
}

function makeRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-daemon-bench-')));
  fs.mkdirSync(path.join(root, '.afyx-graph'), { recursive: true });
  return root;
}

function firstSocketCandidate(root) {
  return getDaemonSocketCandidates(root)[0];
}

/** Spawn a detached daemon subprocess for `root`; resolves once its "Listening on" line appears. */
function spawnDaemon(root) {
  return new Promise((resolve, reject) => {
    let stderrBuf = '';
    const child = spawn(process.execPath, [BIN, 'serve', '--mcp', '--path', root], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, AFYX_GRAPH_DAEMON_INTERNAL: '1' },
    });
    const onData = (chunk) => {
      stderrBuf += chunk.toString('utf8');
      if (/Listening on/.test(stderrBuf)) {
        child.stderr.off('data', onData);
        resolve(child);
      }
    };
    child.stderr.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => {
      child.stderr.off('data', onData);
      reject(new Error(`daemon exited before binding (code ${code}); stderr:\n${stderrBuf}`));
    });
    setTimeout(() => reject(new Error(`daemon did not bind within 10s; stderr so far:\n${stderrBuf}`)), 10_000).unref?.();
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

async function killAndWait(child, signal, timeoutMs = 5000) {
  if (child.exitCode !== null) return true;
  try { child.kill(signal); } catch { /* already gone */ }
  return waitForExit(child, timeoutMs);
}

async function withRoot(fn) {
  const root = makeRoot();
  try {
    return await fn(root);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

async function sendPing(socket, id) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      socket.off('data', onData);
      try {
        resolve(JSON.parse(buf.slice(0, nl)));
      } catch (err) {
        reject(err);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
    socket.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }) + '\n');
  });
}

const results = {};

// ---- cold_daemon_start: spawn -> "Listening on" observed ----
{
  const samples = [];
  const digests = [];
  for (let i = 0; i < ROUNDS; i++) {
    await withRoot(async (root) => {
      const start = performance.now();
      const child = await spawnDaemon(root);
      samples.push(performance.now() - start);
      digests.push({ pidPathExists: fs.existsSync(getDaemonPidPath(root)) });
      await killAndWait(child, 'SIGTERM');
    });
  }
  results.cold_daemon_start = summarize(samples, digests);
}

// ---- attach_to_existing / second_client_attach / request_round_trip / detach ----
{
  const attachSamples = [];
  const secondAttachSamples = [];
  const roundTripSamples = [];
  const detachSamples = [];
  const digests = [];
  for (let i = 0; i < ROUNDS; i++) {
    await withRoot(async (root) => {
      const child = await spawnDaemon(root);
      try {
        const socketPath = firstSocketCandidate(root);

        let start = performance.now();
        const first = await connectWithHello(socketPath);
        attachSamples.push(performance.now() - start);
        if (!first || first === 'version-mismatch') throw new Error('first attach failed');

        start = performance.now();
        const second = await connectWithHello(socketPath);
        secondAttachSamples.push(performance.now() - start);
        if (!second || second === 'version-mismatch') throw new Error('second attach failed');

        start = performance.now();
        const pong = await sendPing(first, 1);
        roundTripSamples.push(performance.now() - start);
        digests.push({ hasResult: 'result' in pong, id: pong.id });

        start = performance.now();
        await new Promise((resolve) => { first.once('close', resolve); first.end(); });
        detachSamples.push(performance.now() - start);

        second.destroy();
      } finally {
        await killAndWait(child, 'SIGTERM');
      }
    });
  }
  results.attach_to_existing = summarize(attachSamples, digests);
  results.second_client_attach = summarize(secondAttachSamples, digests);
  results.request_round_trip = summarize(roundTripSamples, digests);
  results.detach = summarize(detachSamples, digests);
}

// ---- shutdown: SIGTERM -> process exit ----
{
  const samples = [];
  const digests = [];
  for (let i = 0; i < ROUNDS; i++) {
    await withRoot(async (root) => {
      const child = await spawnDaemon(root);
      const start = performance.now();
      const exited = await killAndWait(child, 'SIGTERM');
      samples.push(performance.now() - start);
      digests.push({ exited, pidfileGone: !fs.existsSync(getDaemonPidPath(root)) });
    });
  }
  results.shutdown = summarize(samples, digests);
}

// ---- restart_after_stale_lock: SIGKILL (no cleanup) -> new daemon on same root ----
{
  const samples = [];
  const digests = [];
  for (let i = 0; i < ROUNDS; i++) {
    await withRoot(async (root) => {
      const first = await spawnDaemon(root);
      // SIGKILL: no graceful shutdown runs, so the lockfile/socket are left
      // behind exactly as a real crash would leave them (the PID-reuse-safety
      // recovery path this case exercises).
      await killAndWait(first, 'SIGKILL');
      const start = performance.now();
      const second = await spawnDaemon(root);
      samples.push(performance.now() - start);
      digests.push({ pidPathExists: fs.existsSync(getDaemonPidPath(root)) });
      await killAndWait(second, 'SIGTERM');
    });
  }
  results.restart_after_stale_lock = summarize(samples, digests);
}

const report = {
  generated_by: 'scripts/benchmark-daemon.mjs',
  node: process.version,
  platform: process.platform,
  rounds: ROUNDS,
  cases: results,
};
const text = JSON.stringify(report, null, 2);
console.log(text);
if (OUT) fs.writeFileSync(OUT, text + '\n');
