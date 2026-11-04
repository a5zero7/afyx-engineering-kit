import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AceError,
  GRAPH_ACE_CONSUMER_CONTRACT,
  createGraphAceConsumer,
  deriveGraphAceIdentity,
} from '../src/index.js';
import { nativeAceRunner } from '../src/graph-integration.js';

const graphText = 'Inventory fact line with stable provenance.\n'.repeat(80);
const graphResult = () => ({ content: [{ type: 'text', text: graphText }] });
const query = {
  toolName: 'afyx_graph_inventory',
  args: { declaration: '_inherit', value: 'sale.order' },
  projectRoot: process.cwd(),
  sourceIdentity: 'sha256:synthetic-source',
};

function lab(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-293-graph-ace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function enabledConsumer(t, overrides = {}) {
  const stateDir = path.join(lab(t), 'ace-state');
  return {
    stateDir,
    consumer: createGraphAceConsumer({
      enabled: true,
      stateDir,
      ownerId: 'graph-owner',
      sessionId: 'graph-session',
      ...overrides,
    }),
  };
}

test('standalone timeout remains live until exact fallback is produced', () => {
  const moduleUrl = new URL('../src/index.js', import.meta.url).href;
  const script = `
    import { AceError, createGraphAceConsumer } from ${JSON.stringify(moduleUrl)};
    const consumer = createGraphAceConsumer({
      enabled: true,
      stateDir: ${JSON.stringify(path.join(os.tmpdir(), 'afyx-296-standalone-timeout'))},
      ownerId: 'owner',
      sessionId: 'session',
      timeoutMs: 10,
      aceRunner: (_message, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new AceError('ACE_TIMEOUT', 'timeout')), { once: true });
      }),
    });
    const result = await consumer.execute({
      toolName: 'afyx_graph_search',
      args: { query: 'timeout' },
      projectRoot: process.cwd(),
      sourceIdentity: 'sha256:standalone-timeout',
      executeGraph: async () => ({ content: [{ type: 'text', text: 'authoritative graph result' }] }),
    });
    console.log(result.failureCode, result.consumerResult.content[0].text);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 3_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ACE_TIMEOUT authoritative graph result/);
});

async function waitFor(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('default OFF returns the exact Graph result and never invokes ACE', async () => {
  let aceCalls = 0;
  const consumer = createGraphAceConsumer({
    aceRunner: async () => { aceCalls += 1; throw new Error('must not run'); },
  });
  const original = graphResult();
  const result = await consumer.execute({ toolName: query.toolName, executeGraph: async () => original });
  assert.equal(consumer.contract, GRAPH_ACE_CONSUMER_CONTRACT);
  assert.equal(result.status, 'disabled');
  assert.deepEqual(result.consumerResult, original);
  assert.notEqual(result.consumerResult, original);
  assert.equal(aceCalls, 0);
});

test('invalid opt-in metadata cannot prevent an otherwise valid Graph operation', async () => {
  let graphCalls = 0;
  const consumer = createGraphAceConsumer({
    enabled: true,
    stateDir: path.join(os.tmpdir(), 'afyx-293-invalid-metadata-state'),
    ownerId: 'owner',
    sessionId: 'session',
  });
  const original = graphResult();
  const result = await consumer.execute({
    toolName: query.toolName,
    projectRoot: path.join(os.tmpdir(), 'missing-afyx-293-project'),
    sourceIdentity: query.sourceIdentity,
    executeGraph: async () => { graphCalls += 1; return original; },
  });
  assert.equal(graphCalls, 1);
  assert.equal(result.status, 'fallback');
  assert.equal(result.failureCode, 'INVALID_INTEGRATION');
  assert.deepEqual(result.consumerResult, original);
});

test('native opt-in reduces a repeated Graph result and recovers exact original under the same owner/session', async (t) => {
  const { consumer } = enabledConsumer(t);
  const executeGraph = async () => graphResult();
  const first = await consumer.execute({ ...query, executeGraph });
  const second = await consumer.execute({ ...query, executeGraph });
  assert.equal(first.status, 'optimized');
  assert.equal(second.status, 'optimized');
  const reference = second.ace.items.find((item) => item.disposition === 'reference')?.reference;
  assert.match(reference, /^ace:v1:/);
  assert.ok(second.ace.metrics.outputChars < second.ace.metrics.rawChars);
  const recovered = await consumer.recover(reference);
  assert.equal(recovered.content, graphText);
  assert.equal(recovered.observations[0].provenance.sourceIdentity, query.sourceIdentity);
  assert.equal(recovered.observations[0].provenance.projectRoot, fs.realpathSync.native(query.projectRoot));
});

for (const phase of ['after-lock-acquired', 'before-session-commit', 'after-session-commit']) {
  test(`actual native worker interruption at ${phase} permits safe same-state retry`, async (t) => {
    const root = lab(t);
    const stateDir = path.join(root, 'ace-state');
    const readyPath = path.join(root, `${phase}.ready`);
    const stable = graphResult();
    const interruptedOriginal = {
      content: [{ type: 'text', text: `${phase} interrupted original\n`.repeat(80) }],
    };
    const base = {
      enabled: true,
      stateDir,
      ownerId: 'graph-owner',
      sessionId: 'graph-session',
      timeoutMs: 2_000,
    };
    const healthy = createGraphAceConsumer(base);
    const established = await healthy.execute({ ...query, executeGraph: async () => stable });
    assert.equal(established.status, 'optimized');
    const stableReference = established.ace.items[0].reference;

    const interrupted = createGraphAceConsumer({
      ...base,
      aceRunner: (message, options) => nativeAceRunner({
        ...message,
        testControl: { phase, readyPath },
      }, options),
    });
    const pending = interrupted.execute({
      ...query,
      args: { ...query.args, interruption: phase },
      executeGraph: async () => interruptedOriginal,
    });
    await waitFor(() => fs.existsSync(readyPath), `worker did not reach ${phase}`);
    const lockOwner = JSON.parse(fs.readFileSync(path.join(stateDir, '.ace-lock', 'owner.json'), 'utf8'));
    assert.equal(lockOwner.pid, Number(fs.readFileSync(readyPath, 'utf8').trim()));
    assert.notEqual(lockOwner.pid, process.pid);
    const fallback = await pending;
    assert.equal(fallback.status, 'fallback');
    assert.equal(fallback.failureCode, 'ACE_TIMEOUT');
    assert.deepEqual(fallback.consumerResult, interruptedOriginal);

    const retried = await createGraphAceConsumer({ ...base, timeoutMs: 5_000 }).execute({
      ...query,
      args: { ...query.args, interruption: phase },
      executeGraph: async () => interruptedOriginal,
    });
    assert.equal(retried.status, 'optimized');
    const reference = retried.ace.items[0].reference;
    assert.equal((await healthy.recover(stableReference)).content, graphText);
    assert.equal((await healthy.recover(reference)).content, interruptedOriginal.content[0].text);
    assert.equal(fs.existsSync(path.join(stateDir, '.ace-lock')), false);
    assert.equal(fs.readdirSync(stateDir, { recursive: true }).some((entry) => String(entry).endsWith('.tmp')), false);
  });
}

test('protected Graph tools bypass ACE and preserve the exact result without state', async (t) => {
  let aceCalls = 0;
  const { consumer, stateDir } = enabledConsumer(t, {
    aceRunner: async () => { aceCalls += 1; throw new Error('must not run'); },
  });
  const original = graphResult();

  for (const toolName of ['afyx_graph_explore', 'afyx_graph_status']) {
    const result = await consumer.execute({
      ...query,
      toolName,
      executeGraph: async () => original,
    });
    assert.equal(result.status, 'bypassed');
    assert.deepEqual(result.consumerResult, original);
    assert.equal(result.ace, null);
  }

  assert.equal(aceCalls, 0);
  assert.equal(fs.existsSync(stateDir), false);
});

test('unavailable, throwing, timed-out, malformed, and incomplete ACE all preserve exact Graph output', async () => {
  const original = graphResult();
  const scenarios = [
    ['unavailable', async () => { throw new Error('unavailable'); }, 'ACE_UNAVAILABLE'],
    ['throwing', () => { throw new Error('throwing'); }, 'ACE_UNAVAILABLE'],
    ['timeout', (_message, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new AceError('ACE_TIMEOUT', 'timeout')), { once: true });
    }), 'ACE_TIMEOUT'],
    ['malformed', async () => ({ unexpected: true }), 'INVALID_ACE_RESULT'],
    ['incomplete', async () => ({ status: 'fallback', failureCode: 'INVALID_INPUT', originalComplete: false }), 'INVALID_INPUT'],
  ];
  for (const [name, aceRunner, failureCode] of scenarios) {
    const consumer = createGraphAceConsumer({
      enabled: true,
      stateDir: path.join(os.tmpdir(), `afyx-293-synthetic-${name}`),
      ownerId: 'owner',
      sessionId: 'session',
      timeoutMs: name === 'timeout' ? 10 : 100,
      aceRunner,
    });
    const result = await consumer.execute({ ...query, executeGraph: async () => original });
    assert.equal(result.status, 'fallback', name);
    assert.equal(result.failureCode, failureCode, name);
    assert.deepEqual(result.consumerResult, original, name);
  }
});

test('unconfirmed native child termination rejects instead of reporting fallback completion', async () => {
  const child = new EventEmitter();
  child.pid = 43;
  child.exitCode = null;
  child.signalCode = null;
  child.send = () => true;
  child.kill = () => false;
  const consumer = createGraphAceConsumer({
    enabled: true,
    stateDir: path.join(os.tmpdir(), 'afyx-295-unconfirmed-termination'),
    ownerId: 'owner',
    sessionId: 'session',
    timeoutMs: 10,
    aceRunner: (message, options) => nativeAceRunner(message, {
      ...options,
      spawnChild: () => child,
    }),
  });
  await assert.rejects(
    consumer.execute({ ...query, executeGraph: async () => graphResult() }),
    (error) => error instanceof AceError && error.code === 'ACE_TERMINATION_UNCONFIRMED',
  );
});

test('native lifecycle handles spawn failure without a child', async () => {
  await assert.rejects(
    nativeAceRunner({ operation: 'reduce' }, {
      spawnChild: () => { throw new Error('synthetic spawn failure'); },
    }),
    /synthetic spawn failure/,
  );
});

test('native lifecycle waits for a successful IPC child to close', async () => {
  const events = [];
  const child = new EventEmitter();
  child.pid = 41;
  child.exitCode = null;
  child.signalCode = null;
  child.send = () => {
    events.push('send');
    queueMicrotask(() => {
      events.push('message');
      child.emit('message', { status: 'optimized' });
      events.push('close');
      child.exitCode = 0;
      child.emit('close', 0, null);
    });
    return true;
  };
  child.kill = () => { throw new Error('successful child must not be killed'); };

  assert.deepEqual(
    await nativeAceRunner({ operation: 'reduce' }, { spawnChild: () => child }),
    { status: 'optimized' },
  );
  events.push('resolved');
  assert.deepEqual(events, ['send', 'message', 'close', 'resolved']);
});

test('native IPC send failure terminates and confirms child exit before rejecting', async () => {
  const events = [];
  const child = new EventEmitter();
  child.pid = 42;
  child.exitCode = null;
  child.signalCode = null;
  child.send = () => {
    events.push('send');
    throw new TypeError('synthetic IPC serialization failure');
  };
  child.kill = () => {
    events.push('kill');
    queueMicrotask(() => {
      events.push('close');
      child.signalCode = 'SIGKILL';
      child.emit('close', null, 'SIGKILL');
    });
    return true;
  };

  await assert.rejects(
    nativeAceRunner({ operation: 'reduce' }, { spawnChild: () => child }),
    (error) => {
      events.push('rejected');
      return error instanceof TypeError && /serialization failure/.test(error.message);
    },
  );
  assert.deepEqual(events, ['send', 'kill', 'close', 'rejected']);
});

for (const [name, fail] of [
  ['asynchronous send callback', (child, callback) => callback(new Error('synthetic send callback failure'))],
  ['child error event', (child) => child.emit('error', new Error('synthetic child error'))],
]) {
  test(`native lifecycle terminates and confirms close after ${name}`, async () => {
    const events = [];
    const child = new EventEmitter();
    child.pid = 44;
    child.exitCode = null;
    child.signalCode = null;
    child.send = (_message, callback) => {
      events.push('send');
      queueMicrotask(() => fail(child, callback));
      return true;
    };
    child.kill = () => {
      events.push('kill');
      queueMicrotask(() => {
        events.push('close');
        child.signalCode = 'SIGKILL';
        child.emit('close', null, 'SIGKILL');
      });
      return true;
    };

    await assert.rejects(
      nativeAceRunner({ operation: 'reduce' }, { spawnChild: () => child }),
      /synthetic/,
    );
    events.push('rejected');
    assert.deepEqual(events, ['send', 'kill', 'close', 'rejected']);
  });
}

test('native lifecycle rejects an unexpected exit only after close', async () => {
  const events = [];
  const child = new EventEmitter();
  child.pid = 45;
  child.exitCode = null;
  child.signalCode = null;
  child.send = () => {
    events.push('send');
    queueMicrotask(() => {
      events.push('close');
      child.exitCode = 7;
      child.emit('close', 7, null);
    });
    return true;
  };
  child.kill = () => { throw new Error('unexpected-exit path must not need termination'); };

  await assert.rejects(
    nativeAceRunner({ operation: 'reduce' }, { spawnChild: () => child }),
    /exited with code 7/,
  );
  events.push('rejected');
  assert.deepEqual(events, ['send', 'close', 'rejected']);
});

test('Graph error remains authoritative and bypasses ACE', async () => {
  let aceCalls = 0;
  const consumer = createGraphAceConsumer({
    enabled: true,
    stateDir: path.resolve('unused-state'),
    ownerId: 'owner',
    sessionId: 'session',
    aceRunner: async () => { aceCalls += 1; },
  });
  const original = { content: [{ type: 'text', text: 'Error: unavailable index' }], isError: true };
  const result = await consumer.execute({ ...query, executeGraph: async () => original });
  assert.equal(result.status, 'graph-error');
  assert.deepEqual(result.consumerResult, original);
  assert.equal(aceCalls, 0);
});

test('foreign session, invalid reference, and corrupt original recovery fail closed', async (t) => {
  const { stateDir, consumer } = enabledConsumer(t);
  const executeGraph = async () => graphResult();
  await consumer.execute({ ...query, executeGraph });
  const reduced = await consumer.execute({ ...query, executeGraph });
  const item = reduced.ace.items.find((candidate) => candidate.disposition === 'reference');
  assert.ok(item);

  const foreign = createGraphAceConsumer({
    enabled: true,
    stateDir,
    ownerId: 'graph-owner',
    sessionId: 'other-session',
  });
  await assert.rejects(foreign.recover(item.reference), (error) => error.code === 'REFERENCE_BOUNDARY');
  await assert.rejects(consumer.recover('ace:v1:invalid'), (error) => error.code === 'INVALID_REFERENCE');

  fs.writeFileSync(path.join(stateDir, 'content', `${item.digest}.txt`), 'corrupted original', 'utf8');
  await assert.rejects(consumer.recover(item.reference), (error) => error.code === 'CONTENT_INTEGRITY');
});

test('corrupted or foreign ACE state falls back without mutating Graph result', async (t) => {
  const { stateDir, consumer } = enabledConsumer(t);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'state.json'), '{"format":"foreign"}', 'utf8');
  const original = graphResult();
  const result = await consumer.execute({ ...query, executeGraph: async () => original });
  assert.equal(result.status, 'fallback');
  assert.equal(result.failureCode, 'FOREIGN_STATE');
  assert.deepEqual(result.consumerResult, original);
});

test('identity mapping is deterministic and source-sensitive', () => {
  const a = deriveGraphAceIdentity({ ...query, consumerId: 'local-agent' });
  const b = deriveGraphAceIdentity({ ...query, consumerId: 'local-agent' });
  const changed = deriveGraphAceIdentity({ ...query, sourceIdentity: 'sha256:changed', consumerId: 'local-agent' });
  assert.deepEqual(a, b);
  assert.equal(a.ownerId, changed.ownerId);
  assert.notEqual(a.sessionId, changed.sessionId);
  assert.ok(Object.isFrozen(a));
});

test('invalid configuration and malformed Graph payloads fail before ACE state use', async () => {
  assert.throws(() => createGraphAceConsumer({ enabled: true, stateDir: 'relative', ownerId: 'o', sessionId: 's' }), /absolute/);
  assert.throws(() => createGraphAceConsumer({ enabled: true, stateDir: path.resolve('x'), ownerId: '', sessionId: 's' }), /ownerId/);
  const consumer = createGraphAceConsumer();
  await assert.rejects(
    consumer.execute({ ...query, executeGraph: async () => ({ content: [{ type: 'image', data: 'x' }] }) }),
    /unsupported content block/,
  );

  const overlapping = createGraphAceConsumer({
    enabled: true,
    stateDir: path.join(process.cwd(), '.owned-test-state'),
    ownerId: 'owner',
    sessionId: 'session',
  });
  const result = await overlapping.execute({ ...query, executeGraph: async () => graphResult() });
  assert.equal(result.status, 'fallback');
  assert.equal(result.failureCode, 'UNSAFE_STATE_PATH');
  assert.equal(fs.existsSync(path.join(process.cwd(), '.owned-test-state')), false);

  const cyclic = {};
  cyclic.self = cyclic;
  const cyclicResult = await createGraphAceConsumer({
    enabled: true,
    stateDir: path.join(os.tmpdir(), 'afyx-293-cyclic-state'),
    ownerId: 'owner',
    sessionId: 'session',
    aceRunner: async () => { throw new Error('must not run'); },
  }).execute({ ...query, args: cyclic, executeGraph: async () => graphResult() });
  assert.equal(cyclicResult.status, 'fallback');
  assert.equal(cyclicResult.failureCode, 'INVALID_INTEGRATION');
});
