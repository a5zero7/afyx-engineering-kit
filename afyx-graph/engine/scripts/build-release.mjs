#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEngineDistribution } from './distribution-contract.mjs';
import { releaseStamp, RELEASE_STAMP, sourceDigest, verifyReleaseReady } from './release-readiness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, `.afyx-build-${process.pid}`);
const stageDist = join(stage, 'dist');
const dist = join(root, 'dist');
const backup = join(root, '.afyx-dist-previous');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'no status'}`);
}

if (existsSync(stage)) throw new Error(`refusing existing build staging directory: ${stage}`);
if (existsSync(backup)) throw new Error(`refusing ambiguous previous dist backup: ${backup}`);

const before = sourceDigest(root);
mkdirSync(stageDist, { recursive: true });

try {
  run(process.execPath, [tsc, '--outDir', stageDist]);
  mkdirSync(join(stageDist, 'db'), { recursive: true });
  copyFileSync(join(root, 'src', 'db', 'schema.sql'), join(stageDist, 'db', 'schema.sql'));
  run(process.execPath, [
    vite,
    'build',
    join(root, 'ui'),
    '--config',
    join(root, 'ui', 'vite.config.ts'),
    '--outDir',
    join(stageDist, 'viewer'),
    '--emptyOutDir',
  ]);
  chmodSync(join(stageDist, 'bin', 'afyx-graph.js'), 0o755);

  const after = sourceDigest(root);
  if (before !== after) throw new Error('release inputs changed during build');
  writeFileSync(
    join(stageDist, RELEASE_STAMP),
    `${JSON.stringify(releaseStamp(after), null, 2)}\n`,
    'utf8',
  );
  verifyEngineDistribution(stage);

  function safeMove(from, to) {
    try {
      renameSync(from, to);
    } catch (err) {
      if (process.platform === 'win32' && err?.code === 'EPERM') {
        const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Move-Item -LiteralPath '${from}' -Destination '${to}' -Force`], { windowsHide: true });
        if (ps.status === 0 && existsSync(to)) return;
      }
      throw err;
    }
  }

  let movedOld = false;
  try {
    if (existsSync(dist)) {
      safeMove(dist, backup);
      movedOld = true;
    }
    safeMove(stageDist, dist);
    verifyReleaseReady(root);
  } catch (error) {
    if (existsSync(dist)) {
      try { safeMove(dist, stageDist); } catch {}
    }
    if (movedOld && existsSync(backup)) {
      try { safeMove(backup, dist); } catch {}
    }
    throw error;
  }
  if (movedOld) rmSync(backup, { recursive: true, force: false });
  console.log(`[build-release] PASS source=${after}`);
} finally {
  if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
}
