#!/usr/bin/env node
/**
 * Micro-benchmark for the graph model and traversal core.
 *
 * Builds a seeded synthetic TypeScript project (class hierarchies, a deep inheritance
 * chain, a linear call chain, a layered diamond, a mutually recursive cycle, a
 * high-degree hub, wide file fan-out and fan-in), indexes it with the built library and
 * times the graph operations every consumer relies on. Each case reports the size of
 * what it returned and a digest of the ordered result next to its timing, so fast but
 * different (or empty) work cannot pass for an optimization. Timings are medians over
 * calibrated rounds, in microseconds.
 *
 * usage: node scripts/benchmark-graph.mjs [--files N] [--rounds R] [--dist dir] [--out file.json]
 * Requires a built dist/ (npm run build:clean), or --dist pointing at another build.
 * Zero-model, local only.
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
const distRoot = path.resolve(arg('dist', 'dist'));
if (!fs.existsSync(path.join(distRoot, 'index.js'))) throw new Error('dist/ is not built: run `npm run build:clean` first');

process.env.AFYX_GRAPH_NO_WATCH = '1';
process.env.AFYX_GRAPH_NO_DAEMON = '1';
process.env.AFYX_GRAPH_ALLOW_UNSAFE_NODE = '1';

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const CHAIN = 120;
const LAYERS = 30;
const LEVELS = 24;
const FAN = 60;

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
  // Linear chain: step0 -> step1 -> ... -> stepN, one file per link so file dependencies chain too.
  for (let step = 0; step < CHAIN; step++) {
    const next = step + 1 < CHAIN ? [`import { step${step + 1} } from './step${step + 1}';`, `export function step${step}(n: number): number { return step${step + 1}(n) + 1; }`] : [`export function step${step}(n: number): number { return n; }`];
    write(`src/chain/step${step}.ts`, [...next, ''].join('\n'));
  }
  // Layered diamond: every layer has a left and right function calling both of the next layer's.
  for (let layer = 0; layer < LAYERS; layer++) {
    const lines = [];
    if (layer + 1 < LAYERS) lines.push(`import { left${layer + 1}, right${layer + 1} } from './layer${layer + 1}';`);
    const tail = layer + 1 < LAYERS ? ` + left${layer + 1}(n) + right${layer + 1}(n)` : '';
    lines.push(`export function left${layer}(n: number): number { return n${tail}; }`);
    lines.push(`export function right${layer}(n: number): number { return n * 2${tail}; }`);
    write(`src/diamond/layer${layer}.ts`, lines.concat('').join('\n'));
  }
  // Deep inheritance chain plus interfaces.
  for (let level = 0; level < LEVELS; level++) {
    const parent = level === 0 ? '' : `import { Level${level - 1} } from './Level${level - 1}';\n`;
    const extend = level === 0 ? '' : ` extends Level${level - 1}`;
    write(`src/inherit/Level${level}.ts`, `${parent}export interface Marker${level} { mark${level}(): number; }\nexport class Level${level}${extend} implements Marker${level} { mark${level}(): number { return ${level}; } }\n`);
  }
  // Wide file fan-out (one file importing many) and fan-in (many files importing one).
  write('src/app/all.ts', [
    ...Array.from({ length: FAN }, (_, i) => `import { run${i} } from '../g${i % groups}/Service${i}';`),
    `export const total = ${Array.from({ length: FAN }, (_, i) => `run${i}(1)`).join(' + ')};`,
    '',
  ].join('\n'));
  for (let index = 0; index < 30; index++) {
    write(`tests/g${index % groups}/service${index}.test.ts`, `import { run${index} } from '../../src/g${index % groups}/Service${index}';\nexport const result${index} = run${index}(1);\n`);
  }
}

const CASES = [
  { name: 'direct_outgoing', call: (g, id) => g.getOutgoingEdges(id('dispatch')) },
  { name: 'direct_incoming', call: (g, id) => g.getIncomingEdges(id('dispatch')) },
  { name: 'callers_hub_d1', call: (g, id) => g.getCallers(id('dispatch'), 1) },
  { name: 'callers_hub_d3', call: (g, id) => g.getCallers(id('dispatch'), 3) },
  { name: 'callees_hub_d2', call: (g, id) => g.getCallees(id('dispatch'), 2) },
  { name: 'callees_service_d4', call: (g, id) => g.getCallees(id('run7'), 4) },
  { name: 'bfs_shallow', call: (g, id) => g.traverse(id('Service3'), { maxDepth: 1, direction: 'both' }) },
  { name: 'bfs_deep_both', call: (g, id) => g.traverse(id('Service3'), { maxDepth: 6, direction: 'both', limit: 800 }) },
  { name: 'bfs_calls_only', call: (g, id) => g.traverse(id('run5'), { maxDepth: 5, edgeKinds: ['calls'], direction: 'outgoing' }) },
  { name: 'dfs_outgoing', call: (g, id) => g.traverser.traverseDFS(id('run5'), { maxDepth: 6, direction: 'outgoing', limit: 500 }) },
  { name: 'linear_chain', call: (g, id) => g.traverse(id('step0'), { direction: 'outgoing', edgeKinds: ['calls'], limit: 500 }) },
  { name: 'diamond_layers', call: (g, id) => g.traverse(id('left0'), { direction: 'outgoing', edgeKinds: ['calls'], limit: 500 }) },
  { name: 'cyclic', call: (g, id) => g.traverse(id('ping'), { direction: 'both', limit: 100 }) },
  { name: 'hub_both', call: (g, id) => g.traverse(id('dispatch'), { direction: 'both', maxDepth: 2, limit: 500 }) },
  { name: 'call_graph', call: (g, id) => g.getCallGraph(id('route9'), 3) },
  { name: 'call_graph_hub', call: (g, id) => g.getCallGraph(id('dispatch'), 2) },
  { name: 'impact_leaf', call: (g, id) => g.getImpactRadius(id('listener3'), 3) },
  { name: 'impact_base_class', call: (g, id) => g.getImpactRadius(id('Base2'), 2) },
  { name: 'impact_chain_tail', call: (g, id) => g.getImpactRadius(id(`step${CHAIN - 1}`), 8) },
  { name: 'usages_hub', call: (g, id) => g.findUsages(id('dispatch')) },
  { name: 'file_dependencies_fan_out', call: (g) => g.getFileDependencies('src/app/all.ts') },
  { name: 'file_dependents_fan_in', call: (g) => g.getFileDependents('src/core/hub.ts') },
  { name: 'file_dependents_chain', call: (g) => g.getFileDependents(`src/chain/step${CHAIN - 1}.ts`) },
  { name: 'circular_dependencies', call: (g) => g.findCircularDependencies() },
  { name: 'hierarchy_deep_leaf', call: (g, id) => g.getTypeHierarchy(id(`Level${LEVELS - 1}`)) },
  { name: 'hierarchy_base', call: (g, id) => g.getTypeHierarchy(id('Level0')) },
  { name: 'inheritance_ancestors_walk', call: (g, id) => g.traverse(id(`Level${LEVELS - 1}`), { direction: 'outgoing', edgeKinds: ['extends', 'implements'] }) },
  { name: 'containment_ancestors', call: (g, id) => g.getAncestors(id('compute12')) },
  { name: 'containment_children', call: (g, id) => g.getChildren(id('Service12')) },
  { name: 'path_service_to_listener', call: (g, id) => g.findPath(id('run3'), id('listener5')) },
  { name: 'path_chain', call: (g, id) => g.findPath(id('step0'), id(`step${CHAIN - 1}`), ['calls']) },
  { name: 'path_unreachable', call: (g, id) => g.findPath(id('listener5'), id('run3')) },
  { name: 'context_of_class', call: (g, id) => g.getContext(id('Service12')) },
  { name: 'node_metrics', call: (g, id) => g.getNodeMetrics(id('dispatch')) },
];

const edgeText = (edge) => `${edge.source}>${edge.target}:${edge.kind}@${edge.line ?? '-'}:${edge.column ?? '-'}`;

function summarize(result) {
  if (result === null || result === undefined) return { digest: digest(null), nodes: 0, edges: 0 };
  if (Array.isArray(result)) {
    if (result.length && typeof result[0] === 'string') return { digest: digest(result), nodes: result.length, edges: 0 };
    if (result.length && Array.isArray(result[0])) return { digest: digest(result), nodes: result.reduce((sum, item) => sum + item.length, 0), edges: 0 };
    // Callers/callees/usages and paths (a path's first step has no edge).
    if (result.length && result[0].node) return { digest: digest(result.map(({ node, edge }) => [node.id, edge ? edgeText(edge) : null])), nodes: result.length, edges: result.filter((step) => step.edge).length };
    if (result.length && result[0].source && result[0].target) return { digest: digest(result.map(edgeText)), nodes: 0, edges: result.length };
    return { digest: digest(result.map((item) => item.id ?? item)), nodes: result.length, edges: 0 };
  }
  if (result.nodes instanceof Map) {
    return { digest: digest([result.roots, [...result.nodes.keys()], result.edges.map(edgeText)]), nodes: result.nodes.size, edges: result.edges.length };
  }
  if (result.focal) {
    const ids = (nodes) => nodes.map((node) => node.id);
    const refs = (list) => list.map(({ node, edge }) => [node.id, edgeText(edge)]);
    return { digest: digest([result.focal.id, ids(result.ancestors), ids(result.children), refs(result.incomingRefs), refs(result.outgoingRefs), ids(result.types), ids(result.imports)]), nodes: 1 + result.ancestors.length + result.children.length, edges: result.incomingRefs.length + result.outgoingRefs.length };
  }
  // Scalar records such as node metrics: one node's numbers.
  return { digest: digest(result), nodes: 1, edges: (result.incomingEdgeCount ?? 0) + (result.outgoingEdgeCount ?? 0) };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-gbench-'));
let graph;
try {
  writeProject(root);
  const mod = await import(pathToFileURL(path.join(distRoot, 'index.js')).href);
  const Graph = mod.default?.default ?? mod.default;
  graph = await Graph.init(root);
  await graph.indexAll();
  const stats = graph.getStats();

  const cache = new Map();
  const id = (name) => {
    if (!cache.has(name)) {
      const matches = graph.getNodesByName(name).filter((node) => node.kind !== 'import' && node.kind !== 'file');
      if (matches.length === 0) throw new Error(`benchmark symbol not indexed: ${name}`);
      cache.set(name, matches.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine)[0].id);
    }
    return cache.get(name);
  };

  const results = {};
  for (const { name, call } of CASES) {
    const first = summarize(call(graph, id));
    if (first.nodes + first.edges === 0 && !['path_unreachable', 'circular_dependencies'].includes(name)) throw new Error(`benchmark case returned nothing: ${name}`);
    for (let warm = 0; warm < 3; warm++) call(graph, id);
    let inner = 1;
    for (;;) {
      const start = performance.now();
      for (let i = 0; i < inner; i++) call(graph, id);
      if (performance.now() - start >= 20 || inner >= 1 << 14) break;
      inner *= 2;
    }
    const samples = [];
    for (let round = 0; round < ROUNDS; round++) {
      const start = performance.now();
      for (let i = 0; i < inner; i++) call(graph, id);
      samples.push(((performance.now() - start) / inner) * 1000);
    }
    results[name] = { median_us: Math.round(median(samples) * 10) / 10, spread_us: Math.round((Math.max(...samples) - Math.min(...samples)) * 10) / 10, ...first };
  }
  graph.close();
  graph = undefined;

  const report = {
    generated_by: 'scripts/benchmark-graph.mjs',
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
  try { graph?.close(); } catch { /* already closed */ }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
