#!/usr/bin/env node
/**
 * Micro-benchmark for the context engine (findRelevantContext / buildContext).
 *
 * Builds a seeded synthetic TypeScript project (class hierarchies, mutually recursive
 * clusters, a high-degree hub, many callers, test files), indexes it with the built
 * library, then times realistic context requests. Every case reports a digest and
 * counts of what it returned next to its timing, so fast-but-empty work cannot pass
 * for an optimization. Timings are medians over calibrated rounds.
 *
 * usage: node scripts/benchmark-context.mjs [--files N] [--rounds R] [--out file.json]
 * Requires a built dist/ (npm run build:clean). Zero-model, local only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const FILES = Number(arg('files', 240));
const ROUNDS = Number(arg('rounds', 9));
const OUT = arg('out', null);
const distRoot = path.resolve('dist');
if (!fs.existsSync(path.join(distRoot, 'index.js'))) throw new Error('dist/ is not built: run `npm run build:clean` first');

process.env.AFYX_GRAPH_NO_WATCH = '1';
process.env.AFYX_GRAPH_NO_DAEMON = '1';
process.env.AFYX_GRAPH_ALLOW_UNSAFE_NODE = '1';

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 12);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function writeProject(dir) {
  const random = seeded(20260927);
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const groups = Math.max(4, Math.floor(FILES / 12));
  for (let group = 0; group < groups; group++) {
    write(`src/g${group}/Base${group}.ts`, `export class Base${group} {\n  init${group}(value: number): number { return value + ${group}; }\n  teardown${group}(): void {}\n}\n`);
  }
  for (let index = 0; index < FILES; index++) {
    const group = index % groups;
    const peer = (index + 1 + Math.floor(random() * 5)) % FILES;
    write(`src/g${group}/Service${index}.ts`, [
      `import { Base${group} } from './Base${group}';`,
      `import { dispatch } from '../core/hub';`,
      `export class Service${index} extends Base${group} {`,
      `  handle${index}(value: number): number { return this.init${group}(value) + dispatch(value); }`,
      `  route${index}(value: number): number { return this.handle${index}(value) + this.compute${index}(value); }`,
      `  compute${index}(value: number): number { return value * ${index + 1}; }`,
      `}`,
      `export function run${index}(value: number): number { return new Service${index}().route${index}(value) + ${peer}; }`,
      '',
    ].join('\n'));
  }
  write('src/core/hub.ts', [
    ...Array.from({ length: 40 }, (_, i) => `export function listener${i}(value: number): number { return value + ${i}; }`),
    'export function dispatch(value: number): number {',
    `  return ${Array.from({ length: 40 }, (_, i) => `listener${i}(value)`).join(' + ')};`,
    '}',
    '',
  ].join('\n'));
  write('src/core/cycle.ts', [
    'export function ping(n: number): number { return n <= 0 ? 0 : pong(n - 1) + 1; }',
    'export function pong(n: number): number { return n <= 0 ? 0 : pang(n - 1) + 1; }',
    'export function pang(n: number): number { return n <= 0 ? 0 : ping(n - 1) + 1; }',
    '',
  ].join('\n'));
  for (let index = 0; index < Math.min(30, FILES); index++) {
    write(`tests/g${index % groups}/service${index}.test.ts`, `import { run${index} } from '../../src/g${index % groups}/Service${index}';\nexport const result${index} = run${index}(1);\n`);
  }
}

const CASES = [
  { name: 'shallow_single_seed', call: (g) => g.findRelevantContext('Service3', { traversalDepth: 1 }) },
  { name: 'multi_seed', call: (g) => g.findRelevantContext('Service3 Service7 Service11 Base2', { searchLimit: 6 }) },
  { name: 'hub_high_degree', call: (g) => g.findRelevantContext('dispatch listener5 listener9', { searchLimit: 5, traversalDepth: 2, maxNodes: 60 }) },
  { name: 'callers_heavy', call: (g) => g.findRelevantContext('who calls dispatch', { traversalDepth: 2 }) },
  { name: 'cyclic', call: (g) => g.findRelevantContext('ping pong pang', { searchLimit: 3, traversalDepth: 3 }) },
  { name: 'truncated_max_nodes', call: (g) => g.findRelevantContext('Service5 dispatch', { searchLimit: 8, traversalDepth: 3, maxNodes: 6 }) },
  { name: 'dedup_heavy', call: (g) => g.findRelevantContext('handle route compute Service', { searchLimit: 8, traversalDepth: 2, maxNodes: 50 }) },
  { name: 'prose_architecture', call: (g) => g.findRelevantContext('how does a service handle a request and reach the hub dispatcher', { traversalDepth: 2 }) },
  { name: 'build_markdown_code', call: (g) => g.buildContext('Service4 route4 dispatch', { format: 'markdown' }) },
  { name: 'build_markdown_no_code', call: (g) => g.buildContext('Service4 route4 dispatch', { format: 'markdown', includeCode: false }) },
  { name: 'build_json', call: (g) => g.buildContext('Service9 handle9 Base9', { format: 'json' }) },
  { name: 'build_structured', call: (g) => g.buildContext('Service2 compute2 ping', { format: undefined }) },
];

function summarize(result) {
  if (typeof result === 'string') {
    return { digest: digest(result), size: result.length, response_bytes: Buffer.byteLength(result, 'utf8') };
  }
  if (result.nodes instanceof Map) {
    return { digest: digest([result.roots, [...result.nodes.keys()], result.edges.map((edge) => `${edge.source}>${edge.target}:${edge.kind}`)]), roots: result.roots.length, nodes: result.nodes.size, edges: result.edges.length };
  }
  const ranges = result.codeBlocks.map((block) => `${block.filePath}\0${block.startLine}\0${block.endLine}`);
  const seenRanges = new Set();
  let duplicateSourceBytes = 0;
  result.codeBlocks.forEach((block, index) => {
    if (seenRanges.has(ranges[index])) duplicateSourceBytes += Buffer.byteLength(block.content, 'utf8');
    seenRanges.add(ranges[index]);
  });
  return {
    digest: digest([result.entryPoints.map((node) => node.id), [...result.subgraph.nodes.keys()], result.codeBlocks.map((block) => block.content)]),
    nodes: result.subgraph.nodes.size,
    codeBlocks: result.codeBlocks.length,
    source_bytes: result.codeBlocks.reduce((total, block) => total + Buffer.byteLength(block.content, 'utf8'), 0),
    files: new Set(result.codeBlocks.map((block) => block.filePath)).size,
    file_paths: [...new Set(result.codeBlocks.map((block) => block.filePath))],
    ranges: ranges.length,
    duplicate_ranges: ranges.length - new Set(ranges).size,
    duplicate_source_bytes: duplicateSourceBytes,
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-ctxbench-'));
try {
  writeProject(root);
  const mod = await import(pathToFileURL(path.join(distRoot, 'index.js')).href);
  const Graph = mod.default?.default ?? mod.default;
  const graph = await Graph.init(root);
  await graph.indexAll();
  const stats = graph.getStats();

  const results = {};
  for (const { name, call } of CASES) {
    const first = summarize(await call(graph));
    for (let warm = 0; warm < 3; warm++) await call(graph);
    let inner = 1;
    for (;;) {
      const start = performance.now();
      for (let i = 0; i < inner; i++) await call(graph);
      if (performance.now() - start >= 20 || inner >= 1 << 12) break;
      inner *= 2;
    }
    const samples = [];
    for (let round = 0; round < ROUNDS; round++) {
      const start = performance.now();
      for (let i = 0; i < inner; i++) await call(graph);
      samples.push(((performance.now() - start) / inner) * 1000);
    }
    results[name] = {
      median_us: Math.round(median(samples) * 10) / 10,
      p95_us: Math.round(p95(samples) * 10) / 10,
      ...first,
    };
  }
  graph.close();

  const report = {
    generated_by: 'scripts/benchmark-context.mjs',
    node: process.version,
    files: FILES,
    rounds: ROUNDS,
    project: { files: stats.fileCount, nodes: stats.nodeCount, edges: stats.edgeCount },
    cases: results,
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (OUT) fs.writeFileSync(OUT, text + '\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
