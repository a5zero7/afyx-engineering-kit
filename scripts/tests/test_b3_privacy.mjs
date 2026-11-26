import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AfyxContextEngine, MassiveContextNavigator, WorkLedger } from '../../afyx-context/src/index.js';

test('sensitive ACE input stays original in the response and out of persistent state', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'afyx-b3-privacy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const engine = new AfyxContextEngine({ stateDir, ownerId: 'fixture', sessionId: 'fixture' });
  const value = 'task fixture Authorization: Bearer fixture-b3-do-not-store';
  const report = engine.reduce({ segments: [{ id: 'secure', content: value }] });
  assert.equal(report.items[0].content, value);
  assert.equal(report.items[0].reference, undefined);
  assert.deepEqual(readdirSync(join(stateDir, 'content')), []);
});

test('work ledger redacts repeated assignments and nested sensitive keys and retains corrupt evidence', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'afyx-b3-ledger-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = new WorkLedger(root);
  const input = {
    ledgerId: 'fixture',
    taskObjective: 'token=B3-fixture-one token=B3-fixture-two',
    evidence: [{ summary: 'Only test data', detail: { nested: { apiKey: 'B3-fixture-three' }, line: 'Bearer B3-fixture-four' } }],
  };
  const report = ledger.recordEntry(input);
  assert.equal(report.evidence[0].detail.nested.apiKey, '[REDACTED]');
  const file = join(root, '.afyx-ledger', 'ledger_fixture.json');
  assert.doesNotMatch(readFileSync(file, 'utf8'), /B3-fixture/);
  writeFileSync(file, '{"invalid record"}');
  assert.throws(() => ledger.recordEntry(input));
  assert.equal(readFileSync(file, 'utf8'), '{"invalid record"}');
});

test('Context indexes keyboard and keymap files and excludes credentials and state directories', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'afyx-b3-keys-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['keyboard.ts', 'keymap.js', '.envrc', 'example.PEM', 'id_rsa_backup']) {
    writeFileSync(join(root, name), 'Fixture contents for ' + name);
  }
  mkdirSync(join(root, '.afyx-ledger'));
  writeFileSync(join(root, '.afyx-ledger', 'notes.md'), 'Runtime state fixture');
  assert.equal(new MassiveContextNavigator(root).indexWorkspace().indexedFiles, 2);
});

test('ACE garbage collection preserves an original still referenced by another session', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'afyx-b3-retention-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { stateDir: join(root, 'state'), ownerId: 'fixture' };
  const short = new AfyxContextEngine({ ...options, sessionId: 'short', contentTtlMs: 10 });
  const long = new AfyxContextEngine({ ...options, sessionId: 'long', contentTtlMs: 60000 });
  const content = 'shared fixture\r\n';
  const request = { segments: [{ id: 'shared', content }] };
  const a = short.reduce(request).items[0].reference;
  const b = long.reduce(request).items[0].reference;
  const lone = short.reduce({ segments: [{ id: 'lone', content: 'unshared fixture' }] }).items[0].reference;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.throws(() => short.retrieve(a), (error) => error.code === 'REFERENCE_EXPIRED');
  assert.equal(short.collectExpired().removed, 1);
  assert.throws(() => short.retrieve(lone), (error) => error.code === 'REFERENCE_EXPIRED');
  assert.equal(long.retrieve(b), content);
});
