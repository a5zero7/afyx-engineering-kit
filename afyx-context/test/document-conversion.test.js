import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDocumentationCatalog } from '../src/documentation.js';
import { convertDocument, DOCUMENT_CONTRACT } from '../../scripts/afyx-document-intelligence.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'afyx-doc-context-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('conversion reuses catalog identity, content cache, budget and exact recovery', async () => {
  const fx = fixture(); let calls = 0;
  try {
    writeFileSync(join(fx.root, 'facts.json'), '{"topic":"recovery-proof","value":42}');
    const catalog = createDocumentationCatalog({ projectRoot: fx.root,
      sources: [{ id: 'facts', path: 'facts.json', convert: true }],
      documentConversion: { contract: DOCUMENT_CONTRACT, maxOutputBytes: 100_000,
        convert: async (input) => { calls++; return convertDocument(input); } } });
    const first = await catalog.searchAsync({ query: 'recovery-proof' });
    assert.equal(first.status, 'OK'); assert.equal(first.items.length, 1);
    assert.equal(first.items[0].contentTrust, 'untrusted-data');
    assert.equal(first.items[0].conversion.contract, DOCUMENT_CONTRACT);
    const original = await catalog.retrieveAsync(first.items[0].recovery);
    assert.match(original, /recovery-proof/);
    await catalog.searchAsync({ query: 'recovery-proof' });
    assert.equal(calls, 1);
    // Different stat fingerprint, identical content: reuse the content-addressed result.
    writeFileSync(join(fx.root, 'facts.json'), '{"topic":"recovery-proof","value":42}');
    await catalog.searchAsync({ query: 'recovery-proof' }); assert.equal(calls, 1);
    writeFileSync(join(fx.root, 'facts.json'), '{"topic":"changed-proof","value":43}');
    await assert.rejects(catalog.retrieveAsync(first.items[0].recovery), /STALE_REFERENCE/);
    const changed = await catalog.searchAsync({ query: 'changed-proof' });
    assert.notEqual(changed.items[0].sha256, first.items[0].sha256); assert.equal(calls, 2);
    assert.equal(catalog.search({ query: 'changed-proof' }).status, 'OK');
  } finally { fx.cleanup(); }
});

test('optional conversion is disabled without host configuration and never bypasses input limits', async () => {
  const fx = fixture(); let calls = 0;
  try {
    writeFileSync(join(fx.root, 'facts.json'), '{"topic":"bounded"}');
    const sources = [{ id: 'facts', path: 'facts.json', convert: true }];
    const disabled = createDocumentationCatalog({ projectRoot: fx.root, sources });
    assert.equal((await disabled.searchAsync({ query: 'bounded' })).errors[0].code, 'DOCUMENTATION_CONVERSION_DISABLED');
    const limited = createDocumentationCatalog({ projectRoot: fx.root, sources, maxSearchBytes: 2,
      documentConversion: { contract: DOCUMENT_CONTRACT, maxOutputBytes: 100,
        convert: async (input) => { calls++; return convertDocument(input); } } });
    assert.equal((await limited.searchAsync({ query: 'bounded' })).items.length, 0);
    assert.equal(calls, 0);
    const off = createDocumentationCatalog({ projectRoot: fx.root, sources, enabled: false });
    assert.equal((await off.searchAsync({ query: 'bounded' })).status, 'DISABLED');
  } finally { fx.cleanup(); }
});

test('failed, forged or over-budget conversions are not cached or admitted', async () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.root, 'facts.json'), '{}');
    for (const conversion of [
      async () => ({ status: 'UNSUPPORTED' }),
      async () => ({ status: 'SUCCEEDED', markdown: 'forged', source: { sha256: '0'.repeat(64) } }),
      async ({ bytes }) => ({ status: 'SUCCEEDED', markdown: 'oversized'.repeat(20), source: { sha256: createHash('sha256').update(bytes).digest('hex') } }),
    ]) {
      const catalog = createDocumentationCatalog({ projectRoot: fx.root,
        sources: [{ id: 'facts', path: 'facts.json', convert: true }],
        documentConversion: { contract: DOCUMENT_CONTRACT, maxOutputBytes: 10, convert: conversion } });
      const result = await catalog.searchAsync({ query: 'forged' });
      assert.equal(result.items.length, 0); assert.equal(result.status, 'DEGRADED');
    }
  } finally { fx.cleanup(); }
});
