import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOptionalCapabilityHost } from '../afyx-optional-capabilities.mjs';

test('optional browser/document tools default OFF; discovery never activates a component', async () => {
  const host = createOptionalCapabilityHost();
  assert.deepEqual(host.tools(), []);
  assert.deepEqual(host.discover({ intent: 'source-code' }), []);
  assert.deepEqual(host.discover({ intent: 'browser' }), []);
  await assert.rejects(host.call('afyx_document', { action: 'convert_document', enabled: true }), /NOT_AUTHORIZED/);
  await assert.rejects(host.call('afyx_browser', { action: 'launch', allowedOrigins: ['http://localhost'] }), /NOT_AUTHORIZED/);
  await host.close();
});

test('document tool is workspace-confined and tool input cannot supply host permissions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-optional-doc-'));
  const policy = { enabled: true };
  const host = createOptionalCapabilityHost({ projectRoot: root, document: policy });
  try {
    policy.enabled = false; // The admitted trusted snapshot is immutable from outside.
    writeFileSync(join(root, 'facts.json'), '{"topic":"bounded-original"}');
    assert.deepEqual(host.tools().map((tool) => tool.name), ['afyx_document']);
    assert.deepEqual(host.discover({ intent: 'browser' }), []);
    assert.equal(host.discover({ intent: 'document-conversion' })[0].status, 'CONFIGURED_NOT_STARTED');
    const result = await host.call('afyx_document', { action: 'convert_document', path: 'facts.json' });
    assert.equal(result.status, 'SUCCEEDED'); assert.match(result.markdown, /bounded-original/);
    const rejected = await host.call('afyx_document', { action: 'convert_document', path: '../foreign.txt', workspaceRoot: '..', limits: { maxInputBytes: Infinity } });
    assert.notEqual(rejected.status, 'SUCCEEDED');
    await assert.rejects(host.call('afyx_document', { action: 'run_plugin', path: 'facts.json' }), /UNKNOWN_DOCUMENT_ACTION/);
  } finally { await host.close(); rmSync(root, { recursive: true, force: true }); }
});
