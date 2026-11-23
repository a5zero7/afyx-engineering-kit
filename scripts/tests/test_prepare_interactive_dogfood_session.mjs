import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { prepareInteractiveDogfood } from '../prepare-interactive-dogfood-session.mjs';

test('menyiapkan fixture cold dan pasangan OFF/ON tanpa menjalankan agent', async (t) => {
  const { root, manifestPath } = await prepareInteractiveDogfood({ model: 'fixture-model', effort: 'medium' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(result.graph.status, 'ARCHIVE_REQUIRED');
  assert.equal(result.fixtureCold, true);
  assert.equal(result.agentAcceptance, 'NOT_RUN');
  assert.equal(result.phase8Acceptance, 'NOT_RUN');
  const { jit, off, on } = result.runs;
  assert.equal(new Set([jit, off, on].map((run) => run.fixtureRevision)).size, 1);
  assert.equal(new Set([jit, off, on].map((run) => run.env.CODEX_HOME)).size, 3);
  assert.deepEqual(readFileSync(off.promptPath), readFileSync(on.promptPath));
  assert.equal(off.bridgeArgs, null);
  assert.notEqual(jit.project, on.project);
  for (const run of [jit, off, on]) {
    const config = readFileSync(join(run.env.CODEX_HOME, 'config.toml'), 'utf8');
    assert.match(config, /approval_policy = "on-request"/);
    assert.equal(config.includes('[mcp_servers.'), run !== off);
    assert.equal(existsSync(join(run.project, '.afyx-graph')), false);
    const lines = readFileSync(join(run.project, 'src', 'actions.ts'), 'utf8').split('\n');
    for (const number of [39, 52]) assert.match(lines[number - 1], /return createProject\(/);
    assert.equal(existsSync(join(run.project, 'oracle.json')), false);
  }
  const readiness = JSON.parse(readFileSync(join(root, 'reviewer', 'paired-readiness.json'), 'utf8'));
  assert.equal(readiness.status, 'NOT_RUN');
  assert.equal(readiness.metrics.tokens, null);
});

test('arsip Graph disposable lulus discovery tanpa membuat indeks', {
  skip: process.env.AFYX_DOGFOOD_TEST_ARCHIVE ? false : 'arsip Graph platform tidak disediakan',
}, async (t) => {
  const { root, manifestPath } = await prepareInteractiveDogfood({
    graphArchive: process.env.AFYX_DOGFOOD_TEST_ARCHIVE,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(result.graph.status, 'DISCOVERED');
  assert.match(result.graph.entrySha256, /^[\da-f]{64}$/);
  assert.equal(result.fixtureCold, true);
  assert.equal(result.agentAcceptance, 'NOT_RUN');
});

