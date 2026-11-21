import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInstallerEnvironment, terminalIdentity, recordBackendExecution } from '../afyx-installer-environment.mjs';
import { renderFrame } from '../afyx-midnight-circuit.mjs';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const files = async (path) => path.endsWith('package.json') ? '{"version":"0.1.0-alpha.12"}'
  : path.endsWith('.afyx-source-revision') ? 'a'.repeat(40) : 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\n';
test('Windows product, invoking PS5.1, terminal and backend PS7 remain distinct', async () => {
  const observed = await detectInstallerEnvironment({ platform: 'win32', arch: 'x64', pkgRoot: '/fixture', env: { WT_SESSION: 'observed' },
    parentPid: 123, readText: files, executeCommand: async (program, args) => {
      if (args.includes('-Command') && args.at(-1).includes('Win32_OperatingSystem')) {
        assert.match(args.at(-1), /cursorPid=123/);
        return JSON.stringify({ caption: 'Microsoft Windows 11 Pro', version: '10.0.26100', shell: 'powershell.exe' });
      }
      return program === 'pwsh' ? '7.6.9' : '5.1.26100.1';
    } });
  assert.equal(observed.os.name, 'Microsoft Windows 11 Pro');
  assert.equal(observed.invokingShell.name, 'Windows PowerShell');
  assert.equal(observed.invokingShell.version, '5.1.26100.1');
  assert.equal(observed.backendShell.name, 'PowerShell');
  assert.equal(observed.terminal.name, 'Windows Terminal');
  recordBackendExecution(observed, 'powershell.exe');
  assert.equal(observed.backendShell.name, 'Windows PowerShell');
  assert.equal(observed.backendShell.version, null, 'a different backend cannot inherit PS7 version');
});
for (const shell of ['bash', 'zsh']) test(`observed Linux ${shell} executable beats unrelated SHELL hint`, async () => {
  const observed = await detectInstallerEnvironment({ platform: 'linux', pkgRoot: '/fixture', env: { SHELL: '/bin/fish' },
    parentPid: 123, readText: files, readLink: async (path) => { assert.equal(path, '/proc/123/exe'); return '/bin/' + shell; },
    executeCommand: async (program) => program === 'ps' ? `1 ${shell}` : program.endsWith('zsh') ? 'zsh 5.9' : 'GNU bash, version 5.2.1(1)-release' });
  assert.equal(observed.os.name, 'Ubuntu 24.04.3 LTS');
  assert.equal(observed.invokingShell.name, shell === 'bash' ? 'Bash' : 'Zsh');
  assert.equal(observed.invokingShell.executable, '/bin/' + shell);
});
test('macOS uses sw_vers and observed Zsh while backend can remain Bash 3.2', async () => {
  const observed = await detectInstallerEnvironment({ platform: 'darwin', arch: 'arm64', pkgRoot: '/fixture', env: { TERM_PROGRAM: 'Apple_Terminal' },
    parentPid: 123, readText: files, executeCommand: async (program) => ({ sw_vers: '15.7', ps: '1 /bin/zsh', '/bin/zsh': 'zsh 5.9', bash: 'GNU bash, version 3.2.57(1)-release' })[program] });
  assert.equal(observed.os.version, '15.7'); assert.equal(observed.invokingShell.name, 'Zsh');
  assert.equal(observed.backendShell.version, '3.2.57(1)-release'); assert.equal(observed.terminal.name, 'Terminal.app');
});
for (const shell of ['bash', 'zsh']) test(`Darwin relative ${shell} comm uses a unique observed executable, never /proc or PATH guesses`, async () => {
  const path = '/observed/bin/' + shell;
  const observed = await detectInstallerEnvironment({ platform: 'darwin', arch: 'arm64', pkgRoot: '/fixture', readText: files, env: {}, parentPid: 123,
    readLink: () => { throw Error('Darwin has no procfs'); }, executeCommand: async (program, args) => {
      if (program === 'sw_vers') return '15.7';
      if (program === 'ps') return '1 ' + shell;
      if (program === '/usr/sbin/lsof') { assert.deepEqual(args, ['-a', '-p', '123', '-d', 'txt', '-Fn']); return 'p123\nn' + path + '\nn/usr/lib/cache\n'; }
      return program.endsWith('zsh') ? 'zsh 5.9' : 'GNU bash, version 3.2.57(1)-release';
    } });
  assert.equal(observed.invokingShell.executable, path); assert.equal(observed.invokingShell.name, shell === 'bash' ? 'Bash' : 'Zsh');
});
test('unobservable identities stay Unknown; SHELL and ComSpec do not prove an invoker', async () => {
  const observed = await detectInstallerEnvironment({ platform: 'linux', pkgRoot: '/missing', env: { SHELL: '/bin/bash', ComSpec: 'cmd.exe' },
    readText: async () => { throw Error('missing'); }, executeCommand: async () => { throw Error('missing'); } });
  assert.equal(observed.os.name, 'Unknown'); assert.equal(observed.invokingShell.name, 'Unknown');
  assert.equal(observed.backendShell.name, 'Unknown'); assert.equal(observed.package.sourceRevision, 'Unknown');
  assert.equal(terminalIdentity({ TERM_PROGRAM: 'iTerm.app' }).name, 'iTerm2');
  assert.equal(terminalIdentity({ WT_SESSION: 'inherited', TERM_PROGRAM: 'vscode' }).name, 'Visual Studio Code Terminal');
});
test('checkout identity beats an ignored marker and unstamped packages do not inherit ancestor Git identity', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-environment-source-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'); mkdirSync(checkout); writeFileSync(join(checkout, '.git'), 'fixture metadata');
  const run = async (program, args) => program === 'git' ? (args.includes('status') ? ' M owned.mjs' : 'b'.repeat(40)) : '';
  const state = await detectInstallerEnvironment({ platform: 'unknown', pkgRoot: checkout, readText: files, executeCommand: run });
  assert.equal(state.package.sourceRevision, 'b'.repeat(40)); assert.equal(state.package.dirty, true);
  let gitCalls = 0;
  const unpacked = await detectInstallerEnvironment({ platform: 'unknown', pkgRoot: join(root, 'unpacked'),
    readText: async () => { throw Error('unstamped'); }, executeCommand: async (program) => { if (program === 'git') gitCalls++; return ''; } });
  assert.equal(unpacked.package.sourceRevision, 'Unknown'); assert.equal(gitCalls, 0);
});
test('aborted environment detection does not continue as successful Unknown metadata', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(detectInstallerEnvironment({ platform: 'unknown', pkgRoot: '/fixture', signal: controller.signal,
    readText: files, executeCommand: async () => '' }), /canceled/);
});
for (const width of [40, 80, 120, 180]) test(`environment header remains bounded at ${width} columns`, async () => {
  const environment = await detectInstallerEnvironment({ platform: 'win32', pkgRoot: '/fixture', readText: files, env: {},
    executeCommand: async () => { throw Error('unobserved'); } });
  const frame = renderFrame({ width, height: 24, environment, selection: ['Continue'], hint: 'Enter: continue' });
  assert.ok(frame.split('\n').every((line) => Array.from(line).length <= width));
  assert.ok(frame.split('\n').length <= 24);
  assert.match(frame, /Shell: Unknown/); assert.match(frame, /Terminal:/);
});
