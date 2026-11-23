import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fixtureById } from '../benchmark/fixtures.mjs';
import { AfyxContextEngine } from '../src/index.js';

function readRequest() {
  const source = fs.readFileSync(0, 'utf8');
  const request = JSON.parse(source);
  if (!['cold', 'warm'].includes(request.mode)) throw new Error(`invalid worker mode: ${request.mode}`);
  return request;
}

function selectRecoveryItems(fixture, items) {
  const references = items.filter((item) => item.disposition === 'reference');
  if (fixture.recovery === 'all-references') return references;
  if (fixture.recovery === 'first-reference') return references.slice(0, 1);
  return [];
}

const request = readRequest();
const fixture = fixtureById(request.fixtureId);
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-291-worker-'));

try {
  const ownerId = 'afyx-291-benchmark-owner';
  const sessionId = `${fixture.id}-${request.mode}`;
  const rssBefore = process.memoryUsage().rss;
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const constructStarted = performance.now();
  const engine = new AfyxContextEngine({ stateDir, ownerId, sessionId });
  const constructionMs = performance.now() - constructStarted;
  const reduceRequest = { segments: fixture.segments, budgetChars: fixture.budgetChars };
  if (request.mode === 'warm') engine.reduce(reduceRequest);
  const reduceStarted = performance.now();
  const result = engine.reduce(reduceRequest);
  const reduceMs = performance.now() - reduceStarted;
  const recoveryStarted = performance.now();
  const recoveries = selectRecoveryItems(fixture, result.items).map((item) => {
    const content = engine.retrieve(item.reference);
    const expected = fixture.segments.find((segment) => segment.id === item.id)?.content;
    if (content !== expected) throw new Error(`recovery mismatch for ${fixture.id}/${item.id}`);
    return {
      id: item.id,
      reference: item.reference,
      content,
      digest: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });
  const recoveryMs = performance.now() - recoveryStarted;
  const cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  process.stdout.write(JSON.stringify({
    fixtureId: fixture.id,
    mode: request.mode,
    result,
    recoveries,
    timing: { constructionMs, reduceMs, recoveryMs },
    process: {
      rssBeforeBytes: rssBefore,
      rssAfterBytes: memoryAfter.rss,
      rssTwoPointObservedMaxBytes: Math.max(rssBefore, memoryAfter.rss),
      heapUsedBeforeBytes: heapBefore,
      heapUsedAfterBytes: memoryAfter.heapUsed,
      cpuUserMicroseconds: cpu.user,
      cpuSystemMicroseconds: cpu.system,
    },
  }));
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}
