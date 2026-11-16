import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bash = process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe') : 'bash';
const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30000,
  env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
const available = (command) => !run(command, ['--version'], root).error;

function fixture(t, shell) {
  const temp = mkdtempSync(join(tmpdir(), 'afyx-updater-portability-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const extension = shell === 'bash' ? 'sh' : 'ps1';
  copyFileSync(join(root, `update.${extension}`), join(temp, `update.${extension}`));
  writeFileSync(join(temp, `install.${extension}`), shell === 'bash'
    ? '#!/usr/bin/env bash\nprintf "FIXTURE_INSTALLER_ONLY\\n"\n'
    : 'Write-Output "FIXTURE_INSTALLER_ONLY"\nexit 0\n');
  return temp;
}

for (const shell of ['bash', 'powershell']) {
  const command = shell === 'bash' ? bash : powershell;
  test(`${shell} updater skips self-update for detached or no-upstream checkout`,
    { skip: !available(command) }, (t) => {
      const temp = fixture(t, shell);
      assert.equal(run('git', ['init', '-q', temp], temp).status, 0);
      assert.equal(run('git', ['add', '.'], temp).status, 0);
      assert.equal(run('git', ['commit', '-qm', 'fixture'], temp).status, 0);
      for (const detached of [false, true]) {
        if (detached) assert.equal(run('git', ['checkout', '--detach', '-q'], temp).status, 0);
        const args = shell === 'bash' ? ['update.sh'] : ['-NoProfile', '-File', 'update.ps1'];
        const result = run(command, args, temp);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /No upstream branch (?:is )?configured/);
        assert.match(result.stdout, /FIXTURE_INSTALLER_ONLY/);
      }
      writeFileSync(join(temp, 'user-change.txt'), 'preserve');
      const result = run(command, shell === 'bash' ? ['update.sh'] : ['-NoProfile', '-File', 'update.ps1'], temp);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /Local changes detected/);
      assert.doesNotMatch(result.stdout, /FIXTURE_INSTALLER_ONLY/);
      assert.equal(readFileSync(join(temp, 'user-change.txt'), 'utf8'), 'preserve');
    });
}

test('pre-push selects a usable Python 3 interpreter and fails closed when neither is valid',
  { skip: !available(bash) }, (t) => {
    const temp = mkdtempSync(join(tmpdir(), 'afyx-hook-interpreters-'));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const bin = join(temp, 'bin'); mkdirSync(bin);
    mkdirSync(join(temp, 'afyx-graph', 'engine'), { recursive: true });
    const hook = join(temp, 'pre-push');
    copyFileSync(join(root, '.githooks', 'pre-push'), hook);
    const command = (name, content) => {
      const path = join(bin, name);
      writeFileSync(path, '#!/bin/sh\n' + content + '\n'); chmodSync(path, 0o755);
    };
    // Stubs validate hook command dispatch, not actual product gates.
    command('uname', 'printf "Linux\\n"');
    command('git', 'case "$*" in "rev-parse --show-toplevel") printf "%s\\n" "$FIXTURE_ROOT";; "rev-parse --local-env-var") :;; *) exit 9;; esac');
    command('node', 'printf "node\\n" >> "$FIXTURE_LOG"');
    command('npm', 'printf "npm\\n" >> "$FIXTURE_LOG"');
    for (const [python3Status, pythonStatus, expected] of [[0, 0, 'python3'], [1, 0, 'python'], [1, 1, null]]) {
      for (const [name, status] of [['python3', python3Status], ['python', pythonStatus]]) {
        command(name, `if [ "$1" = -c ]; then exit ${status}; fi\nprintf "${name} %s\\n" "$1" >> "$FIXTURE_LOG"`);
      }
      const log = join(temp, `commands-${python3Status}-${pythonStatus}`);
      const result = spawnSync(bash, ['--noprofile', '--norc', '-c', 'PATH="$FIXTURE_BIN"; export PATH; exec /bin/sh "$1"', 'fixture', hook], { cwd: temp, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, FIXTURE_BIN: bin.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase()), FIXTURE_ROOT: temp.replaceAll('\\', '/'),
          FIXTURE_LOG: log.replaceAll('\\', '/') } });
      if (expected) {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const calls = readFileSync(log, 'utf8').trim().split(/\r?\n/);
        assert.equal(calls.filter((line) => line.startsWith(expected + ' ')).length, 2);
        assert.equal(calls.filter((line) => line === 'node').length, 2);
        assert.equal(calls.filter((line) => line === 'npm').length, 5);
      } else {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Python 3.10 or newer is required/);
      }
    }
  });

test('Bash packaged updater does not pull an enclosing unrelated repository',
  { skip: !available(bash) }, (t) => {
    const temp = fixture(t, 'bash');
    const packageDir = join(temp, 'node_modules', 'kit');
    mkdirSync(packageDir, { recursive: true });
    for (const file of ['update.sh', 'install.sh']) copyFileSync(join(temp, file), join(packageDir, file));
    assert.equal(run('git', ['init', '-q', temp], temp).status, 0);
    writeFileSync(join(temp, 'owner-file'), 'uncommitted user data');
    const result = run(bash, ['update.sh'], packageDir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /not a Git repository/);
    assert.match(result.stdout, /FIXTURE_INSTALLER_ONLY/);
    assert.equal(readFileSync(join(temp, 'owner-file'), 'utf8'), 'uncommitted user data');
  });

for (const shell of ['bash', 'powershell']) {
  const command = shell === 'bash' ? bash : powershell;
  test(`${shell} doctor identifies extension-only Antigravity without changing its configuration`,
    { skip: !available(command) }, (t) => {
      const temp = mkdtempSync(join(tmpdir(), 'afyx-doctor-antigravity-'));
      t.after(() => rmSync(temp, { recursive: true, force: true }));
      const extension = join(temp, '.vscode', 'extensions', 'google.google-antigravity-fixture');
      mkdirSync(extension, { recursive: true });
      const config = join(extension, 'package.json');
      writeFileSync(config, '{"publisher":"google","name":"google-antigravity","version":"1.12.0"}');
      const project = join(temp, 'project');
      const skills = join(temp, 'skills');
      mkdirSync(project); mkdirSync(skills);
      const args = shell === 'bash'
        ? [join(root, 'scripts', 'afyx-doctor.sh'), '--skills-root', skills, '--project', project]
        : ['-NoProfile', '-File', join(root, 'scripts', 'afyx-doctor.ps1'), '-SkillsRoot', skills, '-ProjectPath', project];
      const result = spawnSync(command, args, { cwd: project, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, HOME: temp, USERPROFILE: temp, AFYX_GRAPH_ROOT: join(temp, 'graph'),
          AFYX_CONTEXT_RUNTIME_ROOT: join(temp, 'context'), AFYX_FORGE_RUNTIME_ROOT: join(temp, 'forge') } });
      assert.ok(!result.error, String(result.error));
      assert.match(result.stdout, /\[OK\].*Antigravity host/, result.stdout + result.stderr);
      assert.equal(readFileSync(config, 'utf8'), '{"publisher":"google","name":"google-antigravity","version":"1.12.0"}');
    });
}
