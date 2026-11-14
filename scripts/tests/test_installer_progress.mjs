import assert from 'node:assert/strict';
import test from 'node:test';
import { InstallerProgress, progressEvent } from '../afyx-install-progress.mjs';
import { renderFrame } from '../afyx-midnight-circuit.mjs';
import { buildSubprocessCall, parseCliArgs } from '../afyx-npm-installer.mjs';

test('Windows array parameters appear once and POSIX repeated arguments remain intact', () => {
  const customComponents = ['efficient-coding', 'odoo-engineering'];
  for (const command of ['install', 'verify', 'update']) {
    const call = buildSubprocessCall(command, { preset: 'custom', customComponents }, 'win32', '/fixture');
    assert.equal(call.args.filter((x) => x === '-CustomComponent').length, 1);
    assert.equal(call.args[call.args.indexOf('-CustomComponent') + 1], customComponents.join(','));
    const bash = buildSubprocessCall(command, { preset: 'custom', customComponents }, 'linux', '/fixture');
    assert.equal(bash.args.filter((x) => x === '--custom-component').length, 2);
  }
  const actions = ['efficient-coding=skip', 'odoo-engineering=install'];
  const actionCall = buildSubprocessCall('install', { componentActions: actions }, 'win32', '/fixture');
  assert.equal(actionCall.args.filter((x) => x === '-ComponentAction').length, 1);
  assert.equal(actionCall.args[actionCall.args.indexOf('-ComponentAction') + 1], actions.join(','));
  const remove = buildSubprocessCall('uninstall', { componentActions: customComponents }, 'win32', '/fixture');
  assert.equal(remove.args.filter((x) => x === '-Component').length, 1);
  assert.equal(remove.args[remove.args.indexOf('-Component') + 1], customComponents.join(','));
  assert.equal(parseCliArgs(['install', '--component=efficient-coding=skip']).options.componentActions[0], 'efficient-coding=skip');
  assert.equal(parseCliArgs(['install', '--skills-root=/tmp/a=b']).options.skillsRoot, '/tmp/a=b');
});

test('component serialization rejects unknown, malformed and injection-bearing selections', () => {
  for (const value of ['unknown', 'efficient-coding,odoo-engineering', '../escape', '$(write-file)', '-Preset', '', null]) {
    assert.throws(() => buildSubprocessCall('install', { customComponents: [value] }, 'win32'), /component selection/);
  }
  for (const value of ['efficient-coding=unknown', 'unknown=skip', 'efficient-coding=skip,odoo-engineering=install']) {
    assert.throws(() => buildSubprocessCall('install', { componentActions: [value] }, 'win32'), /component selection/);
  }
  for (const platform of ['win32', 'linux']) {
    const call = buildSubprocessCall('verify', { skipProviderConfiguration: true }, platform);
    assert.ok(call.args.includes(platform === 'win32' ? '-SkipProviderConfiguration' : '--skip-provider-configuration'));
  }
});

test('determinate percentages use actual units and malformed completion cannot invent progress', () => {
  let clock = 0;
  const model = new InstallerProgress({ clock: () => clock });
  model.accept({ operationId: 'bytes', componentId: 'afyx-graph', phase: 'download', state: 'running', completed: 25, total: 100 });
  assert.match(model.lines()[0], /25% 25\/100 RUNNING/);
  for (const units of [{ completed: 101, total: 100 }, { completed: 0, total: 0 }, { completed: 1 }, { completed: Infinity, total: 2 }]) {
    assert.throws(() => progressEvent({ operationId: 'bad', phase: 'install', state: 'running', ...units }), /progress units/);
  }
  assert.throws(() => progressEvent({ operationId: 'bad', phase: 'install', state: 'completed', completed: 64, total: 100 }), /all units/);
  clock = 1_250;
  const id = model.begin('verify', 'Real verification'); clock += 2_000;
  assert.match(model.current(), /INDETERMINATE 00:02/);
  assert.doesNotMatch(model.current(), /%|ETA/);
  model.end(id); assert.doesNotMatch(model.current(), /Real verification/);
});

test('progress transitions are bounded, final states cannot regress, cancellation closes running work', () => {
  const model = new InstallerProgress();
  const id = model.begin('install', 'Installing fixture');
  model.end(id);
  assert.equal(model.accept({ operationId: id, phase: 'install', state: 'running' }).state, 'completed');
  model.begin('verify', 'Verifying fixture'); model.stop('cancelled');
  assert.ok([...model.operations.values()].every((x) => x.state !== 'running'));
  for (let n = 0; n < 200; n++) model.begin('validation', `Bounded ${n}`);
  assert.equal(model.operations.size, 128); assert.equal(model.activity.length, 64);
  assert.throws(() => progressEvent({ operationId: 'x', phase: 'arbitrary-shell', state: 'running' }), /Invalid/);
});

test('canonical frames fit viewport, preserve text parity without color, and contain no terminal data injection', () => {
  const args = { providers: [{ id: 'codex', name: 'Codex', products: [{ type: 'CLI', version: '1' }] }],
    selection: ['> Recommended'], activity: ['Real operation INDETERMINATE 00:01', '\x1b[2Juntrusted control'], hint: 'Enter continue | Esc back | Ctrl+C cancel' };
  for (const [width, height] of [[65, 24], [80, 24], [100, 30], [140, 35]]) {
    const plain = renderFrame({ ...args, width, height });
    assert.ok(plain.split('\n').length <= height, `${width} rows`);
    assert.ok(plain.split('\n').every((line) => Array.from(line).length <= width), `${width} columns`);
    const colored = renderFrame({ ...args, width, height, color: true }).replace(/\x1b\[[0-9;]*m/g, '');
    assert.equal(colored, plain);
    assert.doesNotMatch(plain, /\x1b/);
  }
});
