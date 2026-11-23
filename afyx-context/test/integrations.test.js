import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ACE_INTEGRATION_CONTRACT,
  SUPPORTED_COMPONENTS,
  ACE_LIMITS,
  createOptionalIntegrationAdapter,
} from '../src/index.js';

const request = {
  contract: ACE_INTEGRATION_CONTRACT,
  component: 'graph',
  stateDir: 'not-used-by-failing-engine',
  ownerId: 'owner',
  sessionId: 'session',
  segments: [{ id: 'critical', classification: 'security', content: 'retain this exactly' }],
};

test('declares one versioned optional contract for all planned consumers', () => {
  assert.equal(ACE_INTEGRATION_CONTRACT, 'ace.integration/v1');
  assert.deepEqual(SUPPORTED_COMPONENTS, ['graph', 'engineering-expert', 'forge', 'kit']);
});

test('consumer remains functional with exact original content when ACE fails', () => {
  for (const component of SUPPORTED_COMPONENTS) {
    const adapter = createOptionalIntegrationAdapter({
      component,
      createEngine: () => { throw new Error('synthetic unavailable engine'); },
    });
    const result = adapter.process({ ...request, component });
    assert.equal(result.status, 'fallback');
    assert.equal(result.failureCode, 'ACE_UNAVAILABLE');
    assert.ok(result.renderedContext.includes('retain this exactly'));
    assert.equal(result.originalInput, request.segments);
    assert.equal(result.originalComplete, true);
  }
});

test('malformed adapter requests never throw before original fallback', () => {
  const adapter = createOptionalIntegrationAdapter({ component: 'graph' });
  const stringInput = adapter.process({
    contract: ACE_INTEGRATION_CONTRACT,
    component: 'graph',
    segments: 'original bytes',
  });
  assert.equal(stringInput.status, 'fallback');
  assert.equal(stringInput.failureCode, 'INVALID_INPUT');
  assert.equal(stringInput.renderedContext, 'original bytes');
  assert.equal(stringInput.originalInput, 'original bytes');
  assert.equal(stringInput.originalComplete, true);

  const malformed = [null, { id: 'kept', content: 'recoverable original' }];
  const partial = adapter.process({
    contract: ACE_INTEGRATION_CONTRACT,
    component: 'graph',
    segments: malformed,
  });
  assert.equal(partial.status, 'fallback');
  assert.equal(partial.failureCode, 'INVALID_INPUT');
  assert.equal(partial.originalInput, malformed);
  assert.equal(partial.originalComplete, false);
  assert.match(partial.renderedContext, /recoverable original/);

  const incompatible = adapter.process({ ...request, contract: 'ace.integration/v2' });
  assert.equal(incompatible.status, 'fallback');
  assert.equal(incompatible.failureCode, 'INVALID_INTEGRATION');
  assert.match(incompatible.renderedContext, /retain this exactly/);
  assert.doesNotThrow(() => adapter.process(null));

  const throwingRequest = new Proxy({}, { get() { throw new Error('synthetic getter failure'); } });
  assert.doesNotThrow(() => adapter.process(throwingRequest));
  assert.equal(adapter.process(throwingRequest).status, 'fallback');

  const repeated = 'x'.repeat(ACE_LIMITS.maxSegmentBytes);
  const oversized = Array.from({ length: 9 }, (_, index) => ({ id: `item-${index}`, content: repeated }));
  const bounded = adapter.process({
    contract: ACE_INTEGRATION_CONTRACT,
    component: 'graph',
    segments: oversized,
  });
  assert.equal(bounded.status, 'fallback');
  assert.equal(bounded.failureCode, 'RESOURCE_LIMIT');
  assert.equal(bounded.renderedContext, '');
  assert.equal(bounded.originalInput, oversized);
  assert.equal(bounded.originalComplete, false);
});

test('adapter uses native ACE when the optional engine is available', (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-context-adapter-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const adapter = createOptionalIntegrationAdapter({ component: 'graph' });
  const content = 'repeated adapter payload '.repeat(20);
  const result = adapter.process({
    ...request,
    stateDir,
    segments: [{ id: 'first', content }, { id: 'repeat', content }],
  });
  assert.equal(result.status, 'optimized');
  assert.equal(result.result.items[1].disposition, 'reference');
  assert.equal(result.renderedContext, result.result.renderedContext);
});

test('adapter construction rejects an unknown component', () => {
  assert.throws(() => createOptionalIntegrationAdapter({ component: 'unknown' }), /unsupported optional component/);
  assert.throws(() => createOptionalIntegrationAdapter(), /unsupported optional component/);
});
