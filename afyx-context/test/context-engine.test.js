import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ACE_LIMITS, AfyxContextEngine, AceError, classifyContent } from '../src/index.js';

function lab(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-context-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const longContent = 'stable source evidence line\n'.repeat(20);

test('classifies sensitive evidence conservatively without unsafe downgrade', () => {
  assert.equal(classifyContent('ERROR E_BOUNDARY at owned.js:7'), 'diagnostic');
  assert.equal(classifyContent('permission denied for credential store'), 'security');
  assert.equal(classifyContent('exact bytes', undefined, { exactSource: true }), 'source-evidence');
  assert.equal(classifyContent('ERROR cannot be downgraded', 'normal'), 'diagnostic');
});

test('deduplicates repeated normal content and restores exact originals after reopen', (t) => {
  const stateDir = lab(t);
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner-a', sessionId: 'session-a' });
  const result = engine.reduce({
    budgetChars: 10_000,
    segments: [
      { id: 'first', content: longContent, provenance: { source: 'synthetic-a' } },
      { id: 'repeat', content: longContent, provenance: { source: 'synthetic-b' } },
    ],
  });
  assert.equal(result.mode, 'optimized');
  assert.equal(result.items[0].disposition, 'original');
  assert.equal(result.items[1].disposition, 'reference');
  assert.ok(result.metrics.savedChars > 0);
  assert.ok(result.metrics.reductionRatio > 0);

  const reopened = new AfyxContextEngine({ stateDir, ownerId: 'owner-a', sessionId: 'session-a' });
  assert.equal(reopened.retrieve(result.items[1].reference), longContent);
  const record = reopened.retrieveRecord(result.items[1].reference);
  assert.deepEqual(record.observations.map((item) => item.provenance.source), ['synthetic-a', 'synthetic-b']);
});

test('uses a recoverable reference to satisfy a smaller context budget', (t) => {
  const engine = new AfyxContextEngine({ stateDir: lab(t), ownerId: 'owner', sessionId: 'budget' });
  const result = engine.reduce({
    budgetChars: 180,
    segments: [{ id: 'large-normal', content: 'ordinary context '.repeat(80) }],
  });
  assert.equal(result.mode, 'optimized');
  assert.equal(result.items[0].disposition, 'reference');
  assert.equal(engine.retrieve(result.items[0].reference), 'ordinary context '.repeat(80));
  assert.ok(result.metrics.outputChars <= 180);
});

test('preserves diagnostics, security content and exact source evidence inline', (t) => {
  const engine = new AfyxContextEngine({ stateDir: lab(t), ownerId: 'owner', sessionId: 'protected' });
  const result = engine.reduce({
    budgetChars: 10_000,
    segments: [
      { id: 'diagnostic', classification: 'diagnostic', content: longContent },
      { id: 'security', classification: 'security', content: longContent },
      { id: 'evidence', classification: 'source-evidence', content: longContent },
    ],
  });
  assert.deepEqual(result.items.map((item) => item.disposition), ['original', 'original', 'original']);
  assert.ok(result.renderedContext.includes(longContent));
});

test('falls back to byte-complete originals when protected content exceeds budget', (t) => {
  const engine = new AfyxContextEngine({ stateDir: lab(t), ownerId: 'owner', sessionId: 'fallback' });
  const segments = [{ id: 'security', classification: 'security', content: longContent }];
  const result = engine.reduce({ budgetChars: 10, segments });
  assert.equal(result.mode, 'passthrough');
  assert.equal(result.reason, 'protected-content-exceeds-budget');
  assert.equal(result.items[0].content, longContent);
  assert.equal(result.metrics.savedChars, 0);
});

test('rejects relative, ambiguous, foreign and cross-session state', (t) => {
  assert.throws(
    () => new AfyxContextEngine({ stateDir: 'relative', ownerId: 'owner', sessionId: 'session' }),
    (error) => error instanceof AceError && error.code === 'UNSAFE_STATE_PATH',
  );
  const ambiguous = lab(t);
  fs.writeFileSync(path.join(ambiguous, 'foreign.txt'), 'foreign');
  assert.throws(
    () => new AfyxContextEngine({ stateDir: ambiguous, ownerId: 'owner', sessionId: 'session' }),
    (error) => error instanceof AceError && error.code === 'AMBIGUOUS_STATE',
  );

  const owned = lab(t);
  const first = new AfyxContextEngine({ stateDir: owned, ownerId: 'owner-a', sessionId: 'session-a' });
  const result = first.reduce({ segments: [{ id: 'content', content: longContent }] });
  assert.throws(
    () => new AfyxContextEngine({ stateDir: owned, ownerId: 'owner-b', sessionId: 'session-a' }),
    (error) => error instanceof AceError && error.code === 'FOREIGN_STATE',
  );
  const otherSession = new AfyxContextEngine({ stateDir: owned, ownerId: 'owner-a', sessionId: 'session-b' });
  assert.throws(
    () => otherSession.retrieve(result.items[0].reference),
    (error) => error instanceof AceError && error.code === 'REFERENCE_BOUNDARY',
  );
});

test('rejects a state root alias without touching its target', (t) => {
  const parent = lab(t);
  const target = path.join(parent, 'target');
  const alias = path.join(parent, 'alias');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sentinel.txt'), 'unchanged');
  try {
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('host does not permit disposable symlink/junction creation');
      return;
    }
    throw error;
  }
  assert.throws(
    () => new AfyxContextEngine({ stateDir: alias, ownerId: 'owner', sessionId: 'session' }),
    (error) => error instanceof AceError && error.code === 'UNSAFE_STATE_PATH',
  );
  assert.equal(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'unchanged');
  assert.deepEqual(fs.readdirSync(target), ['sentinel.txt']);
});

test('fails closed when original content is corrupted', (t) => {
  const stateDir = lab(t);
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'integrity' });
  const result = engine.reduce({ segments: [{ id: 'content', content: longContent }] });
  const digest = result.items[0].digest;
  fs.writeFileSync(path.join(stateDir, 'content', `${digest}.txt`), 'tampered');
  assert.throws(
    () => engine.retrieve(result.items[0].reference),
    (error) => error instanceof AceError && error.code === 'CONTENT_INTEGRITY',
  );
});

test('validates all segments before writing content', (t) => {
  const stateDir = lab(t);
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'validation' });
  const before = fs.readdirSync(path.join(stateDir, 'content'));
  assert.throws(
    () => engine.reduce({ segments: [{ id: 'good', content: 'valid' }, { id: 'bad', content: 7 }] }),
    (error) => error instanceof AceError && error.code === 'INVALID_INPUT',
  );
  assert.deepEqual(fs.readdirSync(path.join(stateDir, 'content')), before);
});

test('rejects oversized content before writing original blobs', (t) => {
  const stateDir = lab(t);
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'limits' });
  const contentDir = path.join(stateDir, 'content');
  assert.throws(
    () => engine.reduce({ segments: [{ id: 'large', content: 'x'.repeat(ACE_LIMITS.maxSegmentBytes + 1) }] }),
    (error) => error instanceof AceError && error.code === 'RESOURCE_LIMIT',
  );
  assert.deepEqual(fs.readdirSync(contentDir), []);
});

test('recovers complete orphan blob after injected metadata-commit interruption', (t) => {
  const stateDir = lab(t);
  const ownerId = 'owner';
  const sessionId = 'interrupted';
  const engine = new AfyxContextEngine({ stateDir, ownerId, sessionId });
  const content = 'complete original written before interrupted session commit\n'.repeat(3);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  const blob = path.join(stateDir, 'content', `${digest}.txt`);
  const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
  const sessionPath = path.join(stateDir, 'sessions', sessionHash, 'session.json');
  const sessionBefore = fs.readFileSync(sessionPath);
  const renameSync = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, destination) => {
    if (!injected && destination === sessionPath) {
      injected = true;
      throw new Error('synthetic metadata commit interruption');
    }
    return renameSync(source, destination);
  };
  try {
    assert.throws(
      () => engine.reduce({ segments: [{ id: 'interrupted', content }] }),
      /synthetic metadata commit interruption/,
    );
  } finally {
    fs.renameSync = renameSync;
  }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(blob, 'utf8'), content);
  assert.deepEqual(fs.readFileSync(sessionPath), sessionBefore);
  assert.equal(fs.readdirSync(path.dirname(sessionPath)).some((entry) => entry.endsWith('.tmp')), false);

  // The complete orphan is safe to adopt; the retry commits ownership metadata.
  const reopened = new AfyxContextEngine({ stateDir, ownerId, sessionId });
  const result = reopened.reduce({ segments: [{ id: 'recovered', content }] });
  assert.equal(reopened.retrieve(result.items[0].reference), content);
  assert.equal(fs.readFileSync(blob, 'utf8'), content);
});

test('fails closed on truncated session metadata without rewriting it', (t) => {
  const stateDir = lab(t);
  const ownerId = 'owner';
  const sessionId = 'truncated';
  new AfyxContextEngine({ stateDir, ownerId, sessionId });
  const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
  const sessionPath = path.join(stateDir, 'sessions', sessionHash, 'session.json');
  fs.writeFileSync(sessionPath, '{"format":"ace.session/v1"');
  const before = fs.readFileSync(sessionPath);
  assert.throws(
    () => new AfyxContextEngine({ stateDir, ownerId, sessionId }),
    (error) => error instanceof AceError && error.code === 'INVALID_SESSION',
  );
  assert.deepEqual(fs.readFileSync(sessionPath), before);
});

test('preflights corrupt existing blobs before writing unrelated originals', (t) => {
  const stateDir = lab(t);
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'preflight' });
  const expected = 'expected original content for preflight check\n'.repeat(3);
  const expectedDigest = crypto.createHash('sha256').update(expected).digest('hex');
  fs.writeFileSync(path.join(stateDir, 'content', `${expectedDigest}.txt`), 'corrupt bytes');
  const newContent = 'must not be written before preflight completes\n'.repeat(3);
  const newDigest = crypto.createHash('sha256').update(newContent).digest('hex');
  assert.throws(
    () => engine.reduce({ segments: [{ id: 'new', content: newContent }, { id: 'existing', content: expected }] }),
    (error) => error instanceof AceError && error.code === 'CONTENT_INTEGRITY',
  );
  assert.equal(fs.existsSync(path.join(stateDir, 'content', `${newDigest}.txt`)), false);
  assert.equal(fs.readFileSync(path.join(stateDir, 'content', `${expectedDigest}.txt`), 'utf8'), 'corrupt bytes');
});

test('skips persistence and duplicate item content for small, diagnostic, unicode, and source-evidence passthrough', (t) => {
  const stateDir = lab(t);
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'owner', sessionId: 'passthrough-opt' });
  const contentDir = path.join(stateDir, 'content');
  const sessionHash = crypto.createHash('sha256').update('passthrough-opt').digest('hex');
  const sessionPath = path.join(stateDir, 'sessions', sessionHash, 'session.json');
  const sessionBefore = fs.readFileSync(sessionPath, 'utf8');

  const cases = [
    { segments: [{ id: 'small-1', content: 'hello world short snippet' }] },
    {
      segments: [
        { id: 'diag-1', content: 'ERROR: connection refused\nTraceback: line 42' },
        { id: 'norm-1', content: 'normal status line' },
      ],
    },
    { segments: [{ id: 'uni-1', content: JSON.stringify({ pesan: 'Halo 🚀', status: 'ok', catatan: '测试' }) }] },
    { segments: [{ id: 'src-1', provenance: { exactSource: true, path: 'a.js' }, content: 'x'.repeat(3000) }] },
  ];

  for (const req of cases) {
    const res = engine.reduce(req, { benefitAware: true });
    assert.equal(res.mode, 'passthrough');
    assert.equal(res.reason, 'no-net-reduction');
    assert.equal(res.metrics.savedChars, 0);
    for (const item of res.items) {
      assert.equal(item.disposition, 'original');
      assert.equal(item.reference, undefined);
      assert.equal(item.content, undefined);
    }
  }
  assert.deepEqual(fs.readdirSync(contentDir), []);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), sessionBefore);

  // Eligible large normal content that remains inline does not persist under benefitAware.
  const inlineLarge = engine.reduce({ budgetChars: 32000, segments: [{ id: 'inline-large', content: 'ordinary inline text '.repeat(20) }] }, { benefitAware: true });
  assert.equal(inlineLarge.mode, 'passthrough');
  assert.equal(inlineLarge.reason, 'no-net-reduction');
  assert.equal(inlineLarge.items[0].content, undefined);
  assert.deepEqual(fs.readdirSync(contentDir), []);

  // Protected fallback under benefitAware omits duplicate item content and skips persistence.
  const protectedFallback = engine.reduce({ budgetChars: 10, segments: [{ id: 'sec', classification: 'security', content: longContent }] }, { benefitAware: true });
  assert.equal(protectedFallback.mode, 'passthrough');
  assert.equal(protectedFallback.reason, 'protected-content-exceeds-budget');
  assert.equal(protectedFallback.items[0].content, undefined);
  assert.deepEqual(fs.readdirSync(contentDir), []);

  // Mixed workload: inline segment must not emit a dangling reference or persist when another segment reduces.
  const inlineContent = 'unique inline large segment content '.repeat(15);
  const repeatedContent = 'repeated segment content '.repeat(15);
  const mixed = engine.reduce({
    budgetChars: 5000,
    segments: [
      { id: 'inline-1', content: inlineContent },
      { id: 'diag-1', content: 'ERROR: keep diagnostic inline' },
      { id: 'rep-1', content: repeatedContent },
      { id: 'rep-2', content: repeatedContent },
    ],
  }, { benefitAware: true });
  assert.equal(mixed.mode, 'optimized');
  const inlineItem = mixed.items.find((i) => i.id === 'inline-1');
  assert.equal(inlineItem.disposition, 'original');
  assert.equal(inlineItem.reference, undefined);
  const inlineDigest = crypto.createHash('sha256').update(inlineContent).digest('hex');
  assert.equal(fs.existsSync(path.join(contentDir, `${inlineDigest}.txt`)), false);
  for (const item of mixed.items) {
    if (item.reference) {
      assert.equal(engine.retrieve(item.reference), repeatedContent);
    }
  }
});
