import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeExecution } from '../afyx-native-execution.mjs';

let root; let script; let outside;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'afyx-native-execution-'));
  outside = mkdtempSync(join(tmpdir(), 'afyx-native-external-'));
  script = join(root, 'fixture.cjs');
  writeFileSync(script, `const mode=process.argv[2];
if(mode==='echo') console.log(process.argv.slice(3).join('|'));
if(mode==='flood'){process.stdout.write('x'.repeat(8192));process.stderr.write('y'.repeat(8192));}
if(mode==='sleep') setTimeout(()=>console.log('late'),2000);
if(mode==='fail') process.exitCode=7;
if(mode==='env') console.log(JSON.stringify({secret:process.env.SECRET_TOKEN??null,nodeOptions:process.env.NODE_OPTIONS??null}));
`);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
const spec = (mode = 'echo', extra = {}) => ({ id: 'fixture', executable: process.execPath, argv: [script, mode], effect: 'read', ...extra });

test('default capability is native Node version and discovery invokes nothing', async () => {
  const executor = createNativeExecution({ projectRoot: root });
  assert.deepEqual(executor.discover().map((item) => item.id), ['node-version']);
  const result = await executor.execute({ capabilityId: 'node-version' });
  assert.equal(result.status, 'SUCCESS'); assert.equal(result.receipt.exitCode, 0);
  assert.equal(result.output.stdout.trim(), process.version); assert.ok(Object.isFrozen(result.receipt));
});
test('structured strings remain literal argv, not shell instructions', async () => {
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('echo', { argv: [script, 'echo', { parameter: 'message' }], parameters: { message: { type: 'string' } } })] });
  const input = 'hello; $(whoami) & echo unsafe';
  const result = await executor.execute({ capabilityId: 'fixture', arguments: { message: input } });
  assert.equal(result.status, 'SUCCESS'); assert.equal(result.output.stdout.trim(), input);
  assert.equal(result.receipt.argvDigest.length, 64); assert.ok(!JSON.stringify(result.receipt).includes(input));
});
test('enum and integer constraints reject before process execution', async () => {
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('echo', {
    argv: [script, 'echo', { parameter: 'count' }, { parameter: 'mode' }],
    parameters: { count: { type: 'integer', min: 1, max: 3 }, mode: { type: 'enum', values: ['safe'] } },
  })] });
  for (const arguments_ of [{ count: 0, mode: 'safe' }, { count: 1, mode: 'unsafe' }, { count: 1 }, { count: 1, mode: 'safe', extra: true }]) {
    assert.equal((await executor.execute({ capabilityId: 'fixture', arguments: arguments_ })).status, 'DENIED');
  }
  assert.equal((await executor.execute({ capabilityId: 'fixture', arguments: { count: 2, mode: 'safe' } })).output.stdout.trim(), '2|safe');
});
test('model-supplied approval, executable and environment fields cannot grant authority', async () => {
  const executor = createNativeExecution({ projectRoot: root });
  for (const field of ['approved', 'authorize', 'executable', 'env']) {
    assert.equal((await executor.execute({ capabilityId: 'node-version', [field]: true })).reason, 'INVALID_REQUEST');
  }
  assert.equal((await executor.execute({ capabilityId: 'missing' })).reason, 'CAPABILITY_UNAVAILABLE');
});
test('mutation and privileged capabilities each require host authorization', async () => {
  for (const extra of [{ effect: 'mutation' }, { privileged: true }]) {
    const catalog = [spec('echo', extra)];
    assert.equal((await createNativeExecution({ projectRoot: root, catalog }).execute({ capabilityId: 'fixture' })).reason, 'HOST_APPROVAL_REQUIRED');
    let approvals = 0;
    const allowed = createNativeExecution({ projectRoot: root, catalog, authorize: (proposal) => { approvals++; return proposal.capabilityId === 'fixture'; } });
    assert.equal((await allowed.execute({ capabilityId: 'fixture' })).status, 'SUCCESS'); assert.equal(approvals, 1);
  }
});
test('cwd traversal and physical junction escape are rejected', async () => {
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const executor = createNativeExecution({ projectRoot: root });
  for (const cwd of [outside, 'escape']) assert.equal((await executor.execute({ capabilityId: 'node-version', cwd })).reason, 'CWD_OUTSIDE_ROOT');
  assert.throws(() => createNativeExecution({ projectRoot: join(root, 'escape') }), /TRUSTED_PROJECT_ROOT_REQUIRED/);
});
test('environment excludes credentials and NODE_OPTIONS; known secrets are redacted from output', async () => {
  const environment = { ...process.env, SECRET_TOKEN: 'secret-fixture-value', NODE_OPTIONS: '--bad-node-option' };
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('env')], environment });
  assert.deepEqual(JSON.parse((await executor.execute({ capabilityId: 'fixture' })).output.stdout), { secret: null, nodeOptions: null });
  const echo = createNativeExecution({ projectRoot: root, environment, catalog: [spec('echo', { argv: [script, 'echo', 'secret-fixture-value'] })] });
  const result = await echo.execute({ capabilityId: 'fixture' });
  assert.equal(result.output.stdout.trim(), '[REDACTED]'); assert.ok(!JSON.stringify(result).includes('secret-fixture-value'));
});
test('unsafe catalog interpreter commands and environment grants fail closed', () => {
  assert.throws(() => createNativeExecution({ projectRoot: root, catalog: [spec('echo', { argv: ['--eval', 'process.exit()'] })] }), /INTERPRETER_COMMAND_DENIED/);
  assert.throws(() => createNativeExecution({ projectRoot: root, catalog: [spec('echo', { environmentKeys: ['SECRET_TOKEN'] })] }), /UNSAFE_ENVIRONMENT/);
  assert.throws(() => createNativeExecution({ projectRoot: root, catalog: [spec(), spec()] }), /DUPLICATE_CAPABILITY/);
});
test('model arguments cannot become interpreter options or executable script entrypoints', async () => {
  const marker = join(root, 'model-code-executed');
  const injection = `--eval=require('node:fs').writeFileSync(${JSON.stringify(marker)},'MODEL_CODE_EXECUTED')`;
  assert.throws(() => createNativeExecution({ projectRoot: root, catalog: [spec('echo', {
    argv: [{ parameter: 'script' }], parameters: { script: { type: 'string' } },
  })] }), /INTERPRETER_ENTRYPOINT_REQUIRED/);
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('echo', {
    argv: [script, 'echo', { parameter: 'message' }], parameters: { message: { type: 'string' } },
  })] });
  for (const message of [injection, '-p', '--print=process.version', '/c']) {
    const result = await executor.execute({ capabilityId: 'fixture', arguments: { message } });
    assert.equal(result.status, 'DENIED'); assert.equal(result.output.stdout, '');
  }
  assert.equal(existsSync(marker), false);
  for (const argument of ['--eval=process.exit()', '--print=process.version', '-p']) {
    assert.throws(() => createNativeExecution({ projectRoot: root, catalog: [spec('echo', { argv: [argument] })] }), /INTERPRETER_COMMAND_DENIED/);
  }
});
test('combined output is bounded and child is stopped on overflow', async () => {
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('flood', { maxOutputBytes: 2048 })] });
  const result = await executor.execute({ capabilityId: 'fixture' });
  assert.equal(result.status, 'OUTPUT_LIMIT');
  assert.ok(Buffer.byteLength(result.output.stdout + result.output.stderr) <= 2048);
  assert.ok(result.receipt.stdoutBytes + result.receipt.stderrBytes > 2048);
});
test('truncated output never returns a prefix of a known secret', async () => {
  const secret = 'synthetic-secret-do-not-use';
  const executor = createNativeExecution({ projectRoot: root, environment: { ...process.env, AFYX_TEST_TOKEN: secret },
    catalog: [spec('echo', { argv: [script, 'echo', secret], maxOutputBytes: 8 })] });
  const result = await executor.execute({ capabilityId: 'fixture' });
  assert.equal(result.status, 'OUTPUT_LIMIT'); assert.equal(result.receipt.truncated, true);
  assert.equal(result.output.stdout, ''); assert.equal(result.output.stderr, '');
  assert.ok(!JSON.stringify(result).includes('syntheti'));
});
test('timeout and cancellation stop owned native child and preserve truthful status', async () => {
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('sleep', { timeoutMs: 50 })] });
  assert.equal((await executor.execute({ capabilityId: 'fixture' })).status, 'TIMEOUT');
  const controller = new AbortController(); controller.abort();
  assert.equal((await executor.execute({ capabilityId: 'fixture' }, { signal: controller.signal })).status, 'CANCELLED');
  const live = new AbortController(); const pending = executor.execute({ capabilityId: 'fixture' }, { signal: live.signal });
  live.abort(); assert.equal((await pending).status, 'CANCELLED');
});
test('nonzero native exit is FAILED, never a successful receipt', async () => {
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('fail')] });
  const result = await executor.execute({ capabilityId: 'fixture' });
  assert.equal(result.status, 'FAILED'); assert.equal(result.receipt.exitCode, 7);
});
test('TERM-resistant native child cannot extend the timeout indefinitely', async () => {
  writeFileSync(script, "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),2000);console.log('ready');");
  const executor = createNativeExecution({ projectRoot: root, catalog: [spec('sleep', { timeoutMs: 200 })] });
  const started = performance.now();
  const result = await executor.execute({ capabilityId: 'fixture' });
  assert.equal(result.status, 'TIMEOUT'); assert.ok(performance.now() - started < 1500);
  assert.equal(result.output.stdout, ''); assert.equal(result.receipt.terminationGraceMs, 150);
});
