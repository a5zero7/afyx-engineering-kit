#!/usr/bin/env node
/**
 * AFYX Graph Memory Profiling & Benchmark Harness
 * Measures memory (RSS), CPU time, duration, and correctness on a repository workload.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(testDir, '..');
const graphDist = path.join(kitRoot, 'afyx-graph', 'engine', 'dist');

async function runBenchmark(targetRepo, options = {}) {
  const graphModule = await import(pathToFileURL(path.join(graphDist, 'index.js')).href);
  const GraphClass = graphModule.default?.default ?? graphModule.default ?? graphModule.AfyxGraph;

  const tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-mem-bench-'));
  const priorGraphState = process.env.AFYX_GRAPH_STATE_DIR;
  process.env.AFYX_GRAPH_STATE_DIR = tempStateDir;

  let peakRss = 0;
  const initialRss = process.memoryUsage().rss;
  const startCpu = process.cpuUsage();
  const startTime = performance.now();

  const sampler = setInterval(() => {
    const current = process.memoryUsage().rss;
    if (current > peakRss) peakRss = current;
  }, 25);

  let graph;
  let indexResult;
  try {
    graph = GraphClass.initSync(targetRepo);
    indexResult = await graph.indexAll({ verbose: false });
  } finally {
    clearInterval(sampler);
    const endRss = process.memoryUsage().rss;
    if (endRss > peakRss) peakRss = endRss;

    const durationMs = performance.now() - startTime;
    const cpuDiff = process.cpuUsage(startCpu);
    const totalCpuSec = (cpuDiff.user + cpuDiff.system) / 1_000_000;

    let nodeCount = 0;
    let edgeCount = 0;
    if (graph) {
      try {
        nodeCount = graph.queries.getNodesCount ? graph.queries.getNodesCount() : indexResult?.nodesCreated ?? 0;
        edgeCount = graph.queries.getEdgesCount ? graph.queries.getEdgesCount() : indexResult?.edgesCreated ?? 0;
      } catch {
        // fallback to indexResult counts
        nodeCount = indexResult?.nodesCreated ?? 0;
        edgeCount = indexResult?.edgesCreated ?? 0;
      }
      try { graph.close(); } catch {}
    }

    if (priorGraphState !== undefined) {
      process.env.AFYX_GRAPH_STATE_DIR = priorGraphState;
    } else {
      delete process.env.AFYX_GRAPH_STATE_DIR;
    }

    if (fs.existsSync(tempStateDir)) {
      try { fs.rmSync(tempStateDir, { recursive: true, force: true }); } catch {}
    }

    return {
      targetRepo,
      durationMs: Number(durationMs.toFixed(2)),
      durationSec: Number((durationMs / 1000).toFixed(2)),
      initialRssMiB: Number((initialRss / (1024 * 1024)).toFixed(2)),
      peakRssMiB: Number((peakRss / (1024 * 1024)).toFixed(2)),
      deltaRssMiB: Number(((peakRss - initialRss) / (1024 * 1024)).toFixed(2)),
      cpuSec: Number(totalCpuSec.toFixed(2)),
      filesIndexed: indexResult?.filesIndexed ?? 0,
      nodesCreated: nodeCount,
      edgesCreated: edgeCount,
      success: indexResult?.success ?? false,
    };
  }
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(kitRoot, 'afyx-context');
console.log(`[mem-bench] Benchmarking target: ${target}`);
runBenchmark(target).then((metrics) => {
  console.log(JSON.stringify(metrics, null, 2));
}).catch((err) => {
  console.error('[mem-bench] Failed:', err);
  process.exit(1);
});
