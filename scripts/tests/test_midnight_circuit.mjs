import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseCliArgs } from '../afyx-npm-installer.mjs';
import { presetComponents, providerSelectable, renderFrame, runMidnightCircuit, runtimeSupport, terminalMode } from '../afyx-midnight-circuit.mjs';

function fakeTerminal(keys) {
  const input = new EventEmitter();
  input.isTTY = true;
  input.rawMode = false;
  input.setRawMode = (enabled) => { input.rawMode = enabled; };
  input.resume = () => {};
  input.pause = () => {};
  input.on('newListener', (name) => {
    if (name === 'keypress') setImmediate(() => input.emit('keypress', '', { name: keys.shift() }));
  });
  const output = new EventEmitter();
  output.isTTY = true;
  output.columns = 100;
  output.rows = 30;
  output.write = () => {};
  return { input, output };
}

test('terminal selection respects TTY, CI, plain output, width, and explicit TUI', () => {
  const input = { isTTY: true };
  const output = { isTTY: true, columns: 120 };
  assert.equal(terminalMode({ input, output, env: { TERM: 'xterm-256color' } }), 'tui');
  assert.equal(terminalMode({ input, output, env: { CI: '1', TERM: 'xterm' } }), 'plain');
  assert.equal(terminalMode({ input, output, env: { NO_COLOR: '1', TERM: 'xterm' } }), 'plain');
  assert.equal(terminalMode({ input, output: { ...output, columns: 45 }, env: { TERM: 'xterm' } }), 'plain');
  assert.throws(() => terminalMode({ input: { isTTY: false }, output, env: {}, requested: 'tui' }), /interactive ANSI terminal/);
});

test('UI option is limited to install and validates its values', () => {
  assert.equal(parseCliArgs(['install', '--ui', 'plain']).options.ui, 'plain');
  assert.equal(parseCliArgs(['install', '--ui=tui']).options.ui, 'tui');
  assert.ok(parseCliArgs(['verify', '--ui=tui']).errors.length);
  assert.ok(parseCliArgs(['install', '--ui=unknown']).errors.length);
});

test('presets derive membership from components.json and unsupported Full is explicit', () => {
  assert.deepEqual(presetComponents('recommended'), ['efficient-coding', 'odoo-engineering', 'afyx-engineering-expert']);
  assert.ok(presetComponents('full').includes('afyx-graph'));
  assert.deepEqual(presetComponents('custom', ['afyx-context']), ['afyx-context']);
  assert.equal(runtimeSupport('full', 'darwin', 'arm64').supported, false);
  assert.equal(runtimeSupport('full', 'linux', 'arm64').supported, false);
  assert.equal(runtimeSupport('full', 'linux', 'x64').supported, true);
});

test('provider selection distinguishes supported hosts from extension-only Antigravity', () => {
  assert.equal(providerSelectable({ id: 'antigravity', products: [{ type: 'VS Code Extension' }] }, 'linux'), false);
  assert.equal(providerSelectable({ id: 'antigravity', products: [{ type: 'CLI' }] }, 'linux'), true);
  assert.equal(providerSelectable({ id: 'antigravity', products: [{ type: 'IDE/Desktop' }] }, 'win32'), true);
  assert.equal(providerSelectable({ id: 'codex', products: [{ type: 'VS Code Extension' }] }, 'win32'), true);
  assert.equal(providerSelectable({ id: 'opencode', products: [{ type: 'CLI' }] }, 'linux'), false);
});

test('wide layout has three aligned panels and narrow layout stacks them', () => {
  const args = { stage: 2, providers: [{ name: 'Codex', products: [{ type: 'CLI' }] }], selection: ['Recommended'], activity: ['Ready'] };
  const wide = renderFrame({ ...args, width: 120 });
  assert.match(wide, /PROVIDERS \/ HOST.*SELECTION \/ STATUS.*PLAN \/ ACTIVITY/);
  const narrow = renderFrame({ ...args, width: 65 });
  assert.ok(narrow.indexOf('PROVIDERS / HOST') < narrow.indexOf('SELECTION / STATUS'));
  assert.ok(narrow.indexOf('SELECTION / STATUS') < narrow.indexOf('PLAN / ACTIVITY'));
});

test('multiple extension installations remain grouped under one provider', () => {
  const frame = renderFrame({ width: 120, providers: [{ name: 'Claude Code', products: [
    { type: 'VS Code Extension', version: '2.1.300' },
    { type: 'VS Code Extension', version: '2.1.322' },
  ] }] });
  assert.equal(frame.split('Claude Code:').length - 1, 1);
  assert.match(frame, /2\.1\.300/);
  assert.match(frame, /2\.1\.322/);
});

test('cancellation restores terminal mode before any platform installer call', async () => {
  const terminal = fakeTerminal(['escape']);
  assert.equal(await runMidnightCircuit({ ...terminal, hosts: [] }), null);
  assert.equal(terminal.input.rawMode, false);
});

test('Ctrl+C restores terminal mode and reports cancellation', async () => {
  const terminal = fakeTerminal(['c']);
  terminal.input.on('newListener', (name) => {
    if (name === 'keypress') setImmediate(() => terminal.input.emit('keypress', '', { name: 'c', ctrl: true }));
  });
  await assert.rejects(() => runMidnightCircuit({ ...terminal, hosts: [] }), /Ctrl\+C/);
  assert.equal(terminal.input.rawMode, false);
});

test('five-stage no-provider flow returns explicit safe backend options', async () => {
  const terminal = fakeTerminal(['return', 'return', 'return', 'return', 'return']);
  const result = await runMidnightCircuit({ ...terminal, hosts: [] });
  assert.equal(result.preset, 'recommended');
  assert.equal(result.provider, '');
  assert.equal(result.skipProviderConfiguration, true);
  assert.equal(result.nonInteractive, true);
  assert.equal(terminal.input.rawMode, false);
});
