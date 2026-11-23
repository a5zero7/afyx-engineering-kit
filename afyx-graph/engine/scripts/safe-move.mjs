import { spawnSync } from 'node:child_process';
import { lstatSync, renameSync } from 'node:fs';

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function literal(path) {
  return `'${String(path).replaceAll("'", "''")}'`;
}

export function safeMove(from, to, { rename = renameSync, spawn = spawnSync, platform = process.platform } = {}) {
  if (!exists(from)) throw new Error(`move source is missing: ${from}`);
  if (exists(to)) throw new Error(`move destination already exists: ${to}`);

  try {
    rename(from, to);
    return;
  } catch (error) {
    if (platform !== 'win32' || error?.code !== 'EPERM') throw error;
  }

  const command = [
    "$ErrorActionPreference = 'Stop'",
    `if (Test-Path -LiteralPath ${literal(to)}) { throw 'move destination already exists' }`,
    `Move-Item -LiteralPath ${literal(from)} -Destination ${literal(to)} -Force -ErrorAction Stop`,
  ].join('; ');
  const result = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { shell: false, windowsHide: true, encoding: 'utf8' });
  if (result.error) throw new Error('PowerShell move could not start', { cause: result.error });
  if (result.status !== 0) throw new Error(`PowerShell move failed (exit ${result.status ?? 'unknown'})`);
  if (exists(from) || !exists(to)) throw new Error('PowerShell move did not preserve source/destination state');
}
