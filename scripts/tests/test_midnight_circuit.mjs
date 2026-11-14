import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseCliArgs } from '../afyx-npm-installer.mjs';
import { presetComponents, providerSelectable, renderFrame, runMidnightCircuit, runtimeSupport, terminalMode } from '../afyx-midnight-circuit.mjs';

function fakeTerminal(keys) {
  const input = new EventEmitter();
  input.isTTY = true;
  input.rawMode = false;
  input.setRawMode = (enabled) => { input.rawMode = enabled; };
  input.resume = () => {};
  input.pause = () => {};
  const sendNext = () => {
    const name = keys.shift();
    if (name === undefined) { input.emit('end'); return; }
    input.emit('keypress', '', { name });
    // Navigation keys remain in the same choose() call; Enter creates the
    // next listener, whose newListener event schedules its own first key.
    if (input.listenerCount('keypress')) setImmediate(sendNext);
  };
  input.on('newListener', (name) => {
    if (name === 'keypress') setImmediate(sendNext);
  });
  const output = new EventEmitter();
  output.isTTY = true;
  output.columns = 100;
  output.rows = 30;
  output.text = '';
  output.write = (text) => { output.text += text; };
  return { input, output };
}

function backendFixture() {
  const plan = { schema: 'AfyxInstallPlan/v1', fingerprint: 'fixture-plan', blockers: [], components: [{
    id: 'efficient-coding', name: 'Efficient Coding', desired: true, backendAction: 'install',
    currentState: 'NOT INSTALLED', target: '/isolated/skills/efficient-coding', ownership: 'NONE',
    version: '', availableVersion: '1.2.2', compatibility: 'SUPPORTED', detail: 'not installed',
  }] };
  return { plan: () => plan, verify: () => ({ rows: [], exitCode: 0 }) };
}

test('custom provider keyboard selection cannot include detected unsupported products', { timeout: 5000 }, async () => {
  const terminal = fakeTerminal(['return', 'down', 'down', 'return', 'space', 'return', 'return', 'return', 'return']);
  const hosts = [
    { id: 'codex', name: 'Codex', supported: true, products: [{ type: 'CLI' }] },
    { id: 'opencode', name: 'OpenCode', supported: false, products: [{ type: 'CLI' }] },
  ];
  const result = await runMidnightCircuit({ ...terminal, hosts, backend: backendFixture() });
  assert.equal(result.provider, 'codex');
  assert.equal(result.skipProviderConfiguration, false);
  assert.equal(terminal.input.rawMode, false);
});

test('review activity keyboard scrolling preserves selection and requires explicit apply', { timeout: 5000 }, async () => {
  const terminal = fakeTerminal(['return', 'return', 'return', 'return', 'tab', 'down', 'return', 'return']);
  terminal.output.columns = 80; terminal.output.rows = 24;
  const result = await runMidnightCircuit({ ...terminal, hosts: [], backend: backendFixture() });
  assert.equal(result.expectedPlan, 'fixture-plan');
  assert.equal(result.skipProviderConfiguration, true);
  assert.match(terminal.output.text, /ACTIVITY FOCUS/);
  assert.equal(terminal.input.rawMode, false);
});

test('asynchronous planning keeps feedback alive and releases animation and signal handlers on failure', async () => {
  const terminal = fakeTerminal(['return', 'return', 'return', 'return']);
  const before = ['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name));
  let observedSignal;
  await assert.rejects(runMidnightCircuit({ ...terminal, hosts: [], backend: {
    plan: async (_, { signal }) => {
      observedSignal = signal;
      await new Promise((resolve) => setTimeout(resolve, 190));
      throw new Error('Reproduced planning failure');
    },
  } }), /Backend plan failed/);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.match(terminal.output.text, /INDETERMINATE/);
  assert.match(terminal.output.text, /FAILED/);
  assert.doesNotMatch(terminal.output.text, /VERIFIED RECEIPT/);
  assert.equal(terminal.input.rawMode, false);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name)), before);
  const final = terminal.output.text;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(terminal.output.text, final);
});

test('stale plans require another review and can be cancelled before any apply', async () => {
  const terminal = fakeTerminal(['return', 'return', 'return', 'return', 'return', 'down', 'return']);
  const base = backendFixture().plan();
  let plans = 0;
  const result = await runMidnightCircuit({ ...terminal, hosts: [], backend: {
    plan: async () => ({ ...base, fingerprint: ++plans === 1 ? 'old' : 'new' }),
  } });
  assert.equal(result, null);
  assert.equal(plans, 3);
  assert.match(terminal.output.text, /PLAN CHANGED/);
  assert.doesNotMatch(terminal.output.text, /VERIFIED RECEIPT/);
});

test('malformed or completed progress cannot override failed backend verification', async () => {
  const terminal = fakeTerminal(['return', 'return', 'return', 'return', 'return']);
  const base = backendFixture().plan();
  let plans = 0;
  const candidate = await runMidnightCircuit({ ...terminal, hosts: [], backend: {
    plan: async () => ++plans > 2 ? { ...base, components: base.components.map((item) => ({ ...item, currentState: 'HEALTHY' })) } : base,
    verify: async () => ({ rows: [{ name: 'Core readiness', state: 'FAILED' }], exitCode: 1 }),
  } });
  const event = 'AFYX_PROGRESS ' + JSON.stringify({ contract: 'AfyxInstallerProgress/v1', operationId: 'test:install',
    componentId: 'efficient-coding', phase: 'install', state: 'completed', completed: 1, total: 1, message: 'Installed' });
  candidate.onOutput(event.slice(0, 30));
  candidate.onOutput(event.slice(30) + '\nAFYX_PROGRESS {invalid}\n');
  terminal.input.isTTY = false;
  candidate.startProgress();
  assert.equal(await candidate.finish(0), 1);
  assert.match(terminal.output.text, /FAILED/);
  assert.doesNotMatch(terminal.output.text, /VERIFIED RECEIPT/);
  const final = terminal.output.text;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(terminal.output.text, final);
});

test('ASCII fallback contains no ANSI or unsupported glyphs and NO_COLOR presence is honored', () => {
  const screen = renderFrame({ ascii: true, color: true, selection: ['● Selected → ready — value'], hint: '↑/↓ Tab …' });
  assert.match(screen, /\* Selected > ready - value/);
  assert.doesNotMatch(screen, /[^\x20-\x7e\n]/);
  assert.equal(terminalMode({ input: { isTTY: true }, output: { isTTY: true, columns: 100, rows: 30 }, env: { NO_COLOR: '' } }), 'plain');
});

test('plain numbered menus expose every option including Finish after long component names', async () => {
  const input = new PassThrough(); input.isTTY = true;
  const output = new EventEmitter(); output.isTTY = true; output.columns = 80; output.rows = 24;
  output.text = '';
  output.write = (text) => {
    output.text += text;
    if (text.startsWith('Select number')) setImmediate(() => input.write('\n'));
  };
  const backend = backendFixture();
  const base = backend.plan(); base.components[0].name = 'Long component '.repeat(40);
  backend.plan = async () => base;
  const selection = await runMidnightCircuit({ input, output, hosts: [], backend, plain: true });
  assert.equal(await selection.finish(0), 1);
  assert.match(output.text, /2\. Finish - FAILED/);
  assert.doesNotMatch(output.text, /\x1b/);
  input.destroy();
});

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
  assert.equal(runtimeSupport('full', 'darwin', 'arm64').supported, true);
  assert.equal(runtimeSupport('full', 'darwin', 'x64').supported, true);
  assert.equal(runtimeSupport('full', 'darwin', 'unknown').supported, false);
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

test('wide layout has provider/main columns and narrow layout stacks content', () => {
  const args = { stage: 2, providers: [{ name: 'Codex', products: [{ type: 'CLI' }] }], selection: ['Recommended'], activity: ['Ready'] };
  const wide = renderFrame({ ...args, width: 120 });
  assert.match(wide, /PROVIDERS \/ HOST.*SELECTION \/ CONFIGURATION/);
  assert.match(wide, /RECENT ACTIVITY/);
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

test('long backend details remain scrollable within a 24-row review screen', () => {
  const args = { width: 80, height: 24, stage: 3, providerSummary: ['Selected: skipped'],
    selection: ['component 1', 'component 2', 'Apply'], activity: Array.from({ length: 14 }, (_, index) => `detail-${index}`) };
  const first = renderFrame(args);
  const later = renderFrame({ ...args, activityOffset: 8 });
  assert.ok(first.split('\n').length <= 24);
  assert.match(first, /RECENT ACTIVITY/);
  assert.match(later, /detail-8/);
  assert.doesNotMatch(later, /detail-0/);
});

test('a terminal resized below the supported dimensions can still cancel safely', async () => {
  const terminal = fakeTerminal(['escape']);
  terminal.output.columns = 60;
  assert.equal(await runMidnightCircuit({ ...terminal, hosts: [], backend: backendFixture() }), null);
  assert.match(terminal.output.text, /Resize the terminal/);
  assert.equal(terminal.input.rawMode, false);
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
  const result = await runMidnightCircuit({ ...terminal, hosts: [], backend: backendFixture() });
  assert.equal(result.preset, 'recommended');
  assert.equal(result.provider, '');
  assert.equal(result.skipProviderConfiguration, true);
  assert.equal(result.nonInteractive, true);
  assert.equal(result.expectedPlan, 'fixture-plan');
  assert.equal(terminal.input.rawMode, false);
});

test('a changed backend fingerprint requires a second explicit confirmation', async () => {
  const terminal = fakeTerminal(Array(6).fill('return'));
  const backend = backendFixture();
  const original = backend.plan();
  let calls = 0;
  backend.plan = () => ({ ...original, fingerprint: ++calls === 1 ? 'old' : 'new' });
  const result = await runMidnightCircuit({ ...terminal, hosts: [], backend });
  assert.equal(result.expectedPlan, 'new');
  assert.equal(calls, 4);
});

test('Finish fails when verification finds an unhealthy component despite installer exit zero', async () => {
  const terminal = fakeTerminal(Array(5).fill('return'));
  const backend = backendFixture();
  const result = await runMidnightCircuit({ ...terminal, hosts: [], backend });
  terminal.input.isTTY = false;
  assert.equal(await result.finish(0), 1);
});

test('Finish consumes backend states and verification before offering a successful receipt', async () => {
  const terminal = fakeTerminal(Array(6).fill('return'));
  const backend = backendFixture();
  const original = backend.plan();
  const result = await runMidnightCircuit({ ...terminal, hosts: [], backend });
  backend.plan = () => ({ ...original, components: original.components.map((item) => ({ ...item, currentState: 'HEALTHY', version: '1.2.2', ownership: 'AFYX', backendAction: 'skip' })) });
  backend.verify = () => ({ rows: [{ name: 'Core readiness', state: 'OK', detail: 'verified' }], exitCode: 0 });
  assert.equal(await result.finish(0), 0);
  assert.match(terminal.output.text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''), /Finish — PASS/);
  assert.equal(terminal.input.rawMode, false);
});
