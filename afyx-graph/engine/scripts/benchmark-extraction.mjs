#!/usr/bin/env node
/**
 * Deterministic micro-benchmark for the Afyx-native reconciliation core.
 *
 * This complements the integration benchmark captured during Phase 3B.10. It
 * keeps DB/parser cost out of the measurement so regressions in change
 * classification remain visible, and emits a digest to reject faster wrong
 * answers.
 *
 * usage: node scripts/benchmark-extraction.mjs [--rounds N] [--out report.json]
 * Requires a built dist/ (`npx tsc`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rounds = Number(arg('rounds', 15));
const output = arg('out', null);
const dist = path.resolve('dist', 'extraction');
if (!fs.existsSync(dist)) throw new Error('dist/ is not built: run `npx tsc` first');

const { reconcileSources } = await import(pathToFileURL(path.join(dist, 'reconciliation.js')).href);
const { hashContent } = await import(pathToFileURL(path.join(dist, 'content-hash.js')).href);

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const quartiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return [sorted[Math.floor(sorted.length / 4)], sorted[Math.floor(3 * sorted.length / 4)]];
};
const round = (value) => Math.round(value * 1000) / 1000;

function fixture(count, mutations = {}) {
  const disk = new Map();
  const tracked = [];
  for (let i = 0; i < count; i++) {
    const filePath = `src/file-${String(i).padStart(5, '0')}.ts`;
    const content = `export const value${i} = ${i};\n`;
    disk.set(filePath, content);
    tracked.push({
      path: filePath,
      contentHash: hashContent(content),
      language: 'typescript',
      size: Buffer.byteLength(content),
      modifiedAt: 1,
      indexedAt: 1,
      nodeCount: 2,
    });
  }
  for (const filePath of mutations.deleted ?? []) disk.delete(filePath);
  for (const [filePath, content] of Object.entries(mutations.changed ?? {})) disk.set(filePath, content);
  for (const [filePath, content] of Object.entries(mutations.added ?? {})) disk.set(filePath, content);
  return { disk, tracked };
}

async function runCase(makeFixture) {
  const samples = [];
  let semanticResult;
  for (let i = 0; i < rounds; i++) {
    const { disk, tracked } = makeFixture();
    const trackedByPath = new Map(tracked.map((file) => [file.path, file]));
    const removed = [];
    const start = performance.now();
    const result = await reconcileSources({
      currentFiles: [...disk.keys()],
      trackedFiles: tracked,
      filesChecked: disk.size,
      hash: hashContent,
      io: {
        exists: (filePath) => disk.has(filePath),
        stat: (filePath) => ({
          size: Buffer.byteLength(disk.get(filePath)),
          mtimeMs: trackedByPath.get(filePath)?.contentHash === hashContent(disk.get(filePath)) ? 1 : 2,
        }),
        read: (filePath) => disk.get(filePath),
      },
      onRemove: (file) => removed.push(file.path),
    });
    samples.push(performance.now() - start);
    semanticResult = { ...result, removed };
  }
  const [q1, q3] = quartiles(samples);
  return {
    median_ms: round(median(samples)),
    iqr_ms: [round(q1), round(q3)],
    digest: createHash('sha256').update(JSON.stringify(semanticResult)).digest('hex').slice(0, 16),
    result: semanticResult,
  };
}

const p = (i) => `src/file-${String(i).padStart(5, '0')}.ts`;
const cases = {
  no_op_full_2000: () => fixture(2000),
  one_modification: () => fixture(2000, { changed: { [p(10)]: 'export const changed = 10;\n' } }),
  one_addition: () => fixture(2000, { added: { 'src/added.ts': 'export const added = 1;\n' } }),
  one_deletion: () => fixture(2000, { deleted: [p(10)] }),
  rename_move: () => fixture(2000, {
    deleted: [p(10)],
    added: { 'src/moved.ts': 'export const value10 = 10;\n' },
  }),
  small_batch: () => fixture(2000, {
    changed: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [p(i), `export const batch${i} = ${i};\n`])),
  }),
  larger_batch: () => fixture(2000, {
    changed: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [p(i), `export const batch${i} = ${i};\n`])),
  }),
};

const results = {};
for (const [name, makeFixture] of Object.entries(cases)) results[name] = await runCase(makeFixture);
const report = { generated_by: 'scripts/benchmark-extraction.mjs', node: process.version, rounds, cases: results };
const text = JSON.stringify(report, null, 2);
console.log(text);
if (output) fs.writeFileSync(output, `${text}\n`);
