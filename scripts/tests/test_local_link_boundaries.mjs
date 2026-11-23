import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('local linker checks exact Node 22.5 boundary before any npm write', (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-link-boundary-'));
  t.after(() => rmSync(root, { recursive: true }));
  const bin = join(root, 'bin'), source = join(root, 'source'), modules = join(root, 'modules');
  mkdirSync(bin); mkdirSync(source); mkdirSync(modules); mkdirSync(join(source, 'bin'));
  writeFileSync(join(source, 'package.json'), '{"name":"afyx-engineering-kit"}');
  writeFileSync(join(source, 'bin', 'afyx-engineering-kit.mjs'), '// disposable boundary fixture\n');
  const sentinel = join(root, 'npm-write.txt');
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'node.cmd'), '@echo off\r\nif "%~1"=="--version" (echo %AFYX_LINK_BOUNDARY_VERSION%& exit /b 0)\r\necho {"status":"NOT_INSTALLED"}\r\n');
    writeFileSync(join(bin, 'npm.cmd'), '@echo off\r\nif "%~1"=="root" (echo %AFYX_LINK_BOUNDARY_MODULES%& exit /b 0)\r\nif "%~1"=="unlink" (echo owned>"%AFYX_LINK_BOUNDARY_SENTINEL%"& exit /b 0)\r\nexit /b 99\r\n');
  } else {
    for (const [name, script] of [
      ['node', '#!/bin/sh\nif [ "$1" = --version ]; then echo "$AFYX_LINK_BOUNDARY_VERSION"; else printf \'%s\\n\' \'{"status":"NOT_INSTALLED"}\'; fi\n'],
      ['npm', '#!/bin/sh\ncase "$1" in root) echo "$AFYX_LINK_BOUNDARY_MODULES";; unlink) echo owned > "$AFYX_LINK_BOUNDARY_SENTINEL";; *) exit 99;; esac\n'],
    ]) { const path = join(bin, name); writeFileSync(path, script); chmodSync(path, 0o755); }
  }
  const command = process.platform === 'win32' ? 'pwsh.exe' : '/bin/bash';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-File', join(repo, 'scripts', 'link-global-dev.ps1'), '-Uninstall', '-RepositoryRoot', source]
    : [join(repo, 'scripts', 'link-global-dev.sh'), '--uninstall', `--root=${source}`];
  const run = (version) => spawnSync(command, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true,
    env: { ...process.env, PATH: bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH,
      AFYX_LINK_BOUNDARY_VERSION: version, AFYX_LINK_BOUNDARY_MODULES: modules,
      AFYX_LINK_BOUNDARY_SENTINEL: sentinel } });
  const rejected = run('v22.4.9');
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stdout + rejected.stderr, /22\.5/);
  assert.equal(existsSync(sentinel), false);
  const accepted = run('v22.5.0');
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.equal(readFileSync(sentinel, 'utf8').trim(), 'owned');
  // The shims test version parsing and ordering, not execution on Node 22.5.
});
