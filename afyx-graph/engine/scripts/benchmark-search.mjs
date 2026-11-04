#!/usr/bin/env node
/**
 * Micro-benchmark for the search layer (dist/search/*): per-call cost of each
 * exported function over fixed inputs, and the cost of ranking a candidate set
 * the way a search does (name bonus + path relevance + kind bonus per candidate).
 * Reports medians over repeated timed rounds. Zero-model, local only.
 *
 * usage: node scripts/benchmark-search.mjs [--rounds R] [--out file.json]
 * Requires a built dist/ (npm run build:clean).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const ROUNDS = Number(arg('rounds', 15));
const OUT = arg('out', null);
const dist = path.resolve('dist', 'search');
if (!fs.existsSync(dist)) throw new Error('dist/ is not built: run `npm run build:clean` first');
const require = createRequire(import.meta.url);
const utils = require(path.join(dist, 'query-utils.js'));
const parser = require(path.join(dist, 'query-parser.js'));
const segments = require(path.join(dist, 'identifier-segments.js'));
const paths = require(path.join(dist, 'query-paths.js'));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const QUERIES = [
  'how is caching implemented', 'scrapeLoop and UserService', 'getUserName from get_user_name.py', 'kind:function name:auth path:src/api authenticate',
  'error handling in the parser', 'CacheBuilder build', 'OrderStateMachine transitions', 'test coverage for cache eviction', 'src/routes/[id]/+page.svelte scroll',
  'where does the http response get parsed', 'base64Encode utf8Decode', 'management of connection pooling and handlers',
];
const NAMES = ['CacheBuilder', 'build', 'getUserName', 'OrderStateMachine', 'parseHTMLString', 'scrape_loop', 'UserService', 'handleConnectionPool', 'x', 'evictEntries'];
const KINDS = ['function', 'method', 'class', 'interface', 'variable', 'constant', 'import', 'property'];
const DIRS = ['src/core', 'src/cache', 'src/api/routes', 'lib/util', 'tests/unit', 'examples/demo', 'packages/parser/src', 'app/services'];
const FILES = ['CacheBuilder.ts', 'user_service.py', 'index.ts', 'parser.test.ts', 'OrderStateMachine.java', 'get_user_name.go', 'handler.rs', 'README.md'];
const CANDIDATES = Array.from({ length: 2000 }, (_, index) => ({
  name: NAMES[index % NAMES.length] + (index % 7 === 0 ? String(index) : ''),
  kind: KINDS[index % KINDS.length],
  filePath: `${DIRS[index % DIRS.length]}/${FILES[(index * 3) % FILES.length]}`,
}));
const INDEXED = CANDIDATES.slice(0, 400).map((candidate) => candidate.filePath);
// A large index and queries that only resolve through segment-aligned suffixes (absolute or prefixed paths).
const LARGE_INDEX = Array.from({ length: 20000 }, (_, index) => `packages/pkg${index % 200}/src/module${index % 97}/file${index}.ts`);
const PLAIN_QUERIES = ['how does non-blocking io work', 'the quick-fix flow for failures', 'update the pre-commit hook logic'];
const SUFFIX_QUERIES = ['/Users/dev/work/repo/packages/pkg7/src/module7/file7.ts', 'repo/packages/pkg150/src/module55/file19950.ts open', 'see /a/b/c/d/packages/pkg3/src/module3/file3003.ts and file9999.ts'];

const CASES = {
  extractSearchTerms: () => { for (const q of QUERIES) utils.extractSearchTerms(q); },
  parseQuery: () => { for (const q of QUERIES) parser.parseQuery(q); },
  splitIdentifierSegments: () => { for (const n of NAMES) segments.splitIdentifierSegments(n); },
  extractSegmentSearchWords: () => { for (const q of QUERIES) segments.extractSegmentSearchWords(q); },
  extractQueryPaths: () => { for (const q of QUERIES) paths.extractQueryPaths(q, INDEXED); },
  extractQueryPaths_20k_no_path_spans: () => { for (const q of PLAIN_QUERIES) paths.extractQueryPaths(q, LARGE_INDEX); },
  extractQueryPaths_20k_paths: () => { for (const q of SUFFIX_QUERIES) paths.extractQueryPaths(q, LARGE_INDEX); },
  isTestFile: () => { for (const c of CANDIDATES) utils.isTestFile(c.filePath); },
  rank_2000_candidates: () => {
    let total = 0;
    for (const q of QUERIES) {
      for (const c of CANDIDATES) {
        total += utils.nameMatchBonus(c.name, q) + utils.kindBonus(c.kind) + utils.scorePathRelevance(c.filePath, q);
      }
    }
    return total;
  },
};

const results = {};
for (const [name, fn] of Object.entries(CASES)) {
  const perCall = name === 'rank_2000_candidates' ? QUERIES.length : 1;
  for (let warm = 0; warm < 3; warm++) fn();
  // Calibrate: enough back-to-back invocations that one timed round lasts >= 5 ms.
  let inner = 1;
  for (;;) {
    const start = performance.now();
    for (let i = 0; i < inner; i++) fn();
    if (performance.now() - start >= 5 || inner >= 1 << 16) break;
    inner *= 2;
  }
  const samples = [];
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now();
    for (let i = 0; i < inner; i++) fn();
    samples.push(((performance.now() - start) / inner / perCall) * 1000);
  }
  results[name] = Math.round(median(samples) * 100) / 100;
}

const report = { generated_by: 'scripts/benchmark-search.mjs', node: process.version, rounds: ROUNDS, unit: 'microseconds per invocation over the fixed query/name/path set (rank_2000_candidates: per query over 2000 candidates)', median_us: results };
const text = JSON.stringify(report, null, 2);
console.log(text);
if (OUT) fs.writeFileSync(OUT, text + '\n');
