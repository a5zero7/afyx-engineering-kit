import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { AfyxContextEngine } from '../src/index.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-context-benchmark-'));
try {
  const repeated = [
    'Synthetic repository inventory follows.',
    ...Array.from({ length: 80 }, (_, index) => `owned/module-${index + 1}.js synthetic entry`),
  ].join('\n');
  const segments = [
    { id: 'diagnostic', classification: 'diagnostic', content: 'SECURITY: retain the exact failure code E_BOUNDARY.' },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `log-${index + 1}`, content: repeated, provenance: { fixture: 'synthetic-repeat-v1' } })),
  ];
  const started = performance.now();
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'benchmark-owner', sessionId: 'benchmark-session' });
  const result = engine.reduce({ segments, budgetChars: 100_000 });
  const elapsedMs = performance.now() - started;
  for (const item of result.items) {
    if (item.disposition === 'reference' && engine.retrieve(item.reference) !== repeated) {
      throw new Error(`recovery mismatch for ${item.id}`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    fixture: 'synthetic-repeat-v1',
    rawBaselineChars: result.metrics.rawChars,
    nativeAceChars: result.metrics.outputChars,
    savedChars: result.metrics.savedChars,
    reductionRatio: result.metrics.reductionRatio,
    elapsedMs,
    processRssBytes: process.memoryUsage().rss,
    recovery: 'PASS',
    headroomComparison: 'NOT_RUN',
  }, null, 2)}\n`);
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}
