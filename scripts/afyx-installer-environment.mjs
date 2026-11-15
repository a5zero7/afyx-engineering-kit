import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { release } from 'node:os';
import { promisify } from 'node:util';

export const INSTALLER_ENVIRONMENT_CONTRACT = 'AfyxInstallerEnvironment/v1';
const execute = promisify(execFile);
const clean = (value) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160) : '';
const unknown = () => ({ name: 'Unknown', version: null, source: 'UNOBSERVED' });
async function run(program, args, { signal } = {}) {
  const result = await execute(program, args, { encoding: 'utf8', timeout: 4000, maxBuffer: 32 * 1024, windowsHide: true, signal });
  return result.stdout.trim();
}
export function terminalIdentity(env = {}) {
  const names = { 'iTerm.app': 'iTerm2', Apple_Terminal: 'Terminal.app', vscode: 'Visual Studio Code Terminal' };
  if (clean(env.TERM_PROGRAM)) return { name: names[env.TERM_PROGRAM] || clean(env.TERM_PROGRAM),
    version: clean(env.TERM_PROGRAM_VERSION) || null, source: 'TERM_PROGRAM' };
  return env.WT_SESSION ? { name: 'Windows Terminal', version: null, source: 'WT_SESSION' } : unknown();
}
export async function shellIdentity(program, executeCommand = run) {
  const name = basename(program || '').toLowerCase().replace(/\.exe$/, '');
  try {
    if (name === 'pwsh' || name === 'powershell') {
      const version = await executeCommand(program, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']);
      if (!/^\d+\.\d+(?:\.\d+){0,2}(?:[-\w.]*)?$/.test(version)) return unknown();
      return { name: name === 'powershell' ? 'Windows PowerShell' : 'PowerShell', version, executable: program, source: 'EXECUTABLE_VERSION' };
    }
    if (name === 'bash' || name === 'zsh') {
      const text = await executeCommand(program, ['--version']);
      const version = text.match(name === 'bash' ? /version\s+(\d+\.\d+[^\s]*)/i : /zsh\s+(\d+\.\d+[^\s]*)/i)?.[1];
      return version ? { name: name === 'bash' ? 'Bash' : 'Zsh', version, executable: program, source: 'EXECUTABLE_VERSION' } : unknown();
    }
    if (name === 'cmd') {
      const text = await executeCommand(program, ['/d', '/c', 'ver']);
      return { name: 'CMD', version: text.match(/\d+\.\d+\.\d+(?:\.\d+)?/)?.[0] || null, executable: program, source: 'EXECUTABLE_VERSION' };
    }
  } catch { /* An unavailable executable is not evidence of a shell version. */ }
  return unknown();
}

async function observeWindows(parentPid, executeCommand) {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return {};
  const script = `$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $shell=$null; $cursorPid=${parentPid}; ` +
    `for($i=0;$i -lt 10 -and $cursorPid -gt 0;$i++){ ` +
    `$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$cursorPid); if(-not $p){break}; ` +
    `if($p.Name -match '^(powershell|pwsh|bash|zsh|cmd)\\.exe$' -and -not ($p.Name -eq 'cmd.exe' -and $p.CommandLine -match '(?i)\\s/c(?:\\s|$)')){ $shell=$p.ExecutablePath; break }; $cursorPid=[int]$p.ParentProcessId }; ` +
    `[ordered]@{caption=$os.Caption; version=$os.Version; shell=$shell}|ConvertTo-Json -Compress`;
  return JSON.parse(await executeCommand('powershell.exe', ['-NoProfile', '-Command', script]));
}
async function observePosixShell(parentPid, executeCommand, readLink) {
  let pid = parentPid;
  for (let i = 0; i < 10 && Number.isSafeInteger(pid) && pid > 1; i++) {
    const row = await executeCommand('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'comm=']);
    const match = row.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) break;
    const command = match[2].trim().replace(/^-/, '');
    if (['bash', 'zsh'].includes(basename(command))) return isAbsolute(command) ? command : await readLink(`/proc/${pid}/exe`);
    pid = Number(match[1]);
  }
  return null;
}

/** Read-only local observations. SHELL/ComSpec alone are not invoking-shell proof. */
export async function detectInstallerEnvironment({ platform = process.platform, arch = process.arch,
  env = process.env, parentPid = process.ppid, pkgRoot, readText = (path) => readFile(path, 'utf8'),
  executeCommand = run, readLink = readlink, signal } = {}) {
  const command = (program, args) => executeCommand(program, args, { signal });
  const state = { contract: INSTALLER_ENVIRONMENT_CONTRACT, platform, architecture: arch,
    os: unknown(), invokingShell: unknown(), terminal: terminalIdentity(env), backendShell: unknown(),
    package: { version: 'Unknown', sourceRevision: 'Unknown' } };
  const jobs = [];
  jobs.push((async () => {
    try {
      if (platform === 'win32') {
        const observed = await observeWindows(parentPid, command);
        if (clean(observed.caption)) state.os = { name: clean(observed.caption), version: clean(observed.version) || null, source: 'WIN32_OPERATING_SYSTEM' };
        state.invokingShell = await shellIdentity(observed.shell, command);
      } else {
        if (platform === 'linux') {
          const text = await readText('/etc/os-release');
          const pretty = text.match(/^PRETTY_NAME=(?:"([^"\n]*)"|'([^'\n]*)'|([^\n]*))$/m);
          if (pretty) state.os = { name: clean(pretty[1] ?? pretty[2] ?? pretty[3]), version: null, source: 'OS_RELEASE' };
          state.subsystem = /wsl2/i.test(release()) ? 'WSL2' : /microsoft|wsl/i.test(release()) || env.WSL_DISTRO_NAME ? 'WSL' : null;
        } else if (platform === 'darwin') {
          const version = await command('sw_vers', ['-productVersion']);
          if (/^\d+(?:\.\d+){1,2}$/.test(version)) state.os = { name: 'macOS', version, source: 'SW_VERS' };
        }
        state.invokingShell = await shellIdentity(await observePosixShell(parentPid, command, readLink), command);
      }
    } catch { /* Leave only the fields not observed as Unknown. */ }
  })());
  jobs.push((async () => {
    if (platform === 'win32') {
      state.backendShell = await shellIdentity('pwsh', command);
      if (state.backendShell.name === 'Unknown') state.backendShell = await shellIdentity('powershell.exe', command);
    } else state.backendShell = await shellIdentity('bash', command);
    state.backendShell.executed = false;
  })());
  jobs.push((async () => {
    try { state.package.version = JSON.parse(await readText(join(pkgRoot, 'package.json'))).version || 'Unknown'; } catch { /* Unknown. */ }
    if (pkgRoot && existsSync(join(pkgRoot, '.git'))) {
      try {
        const revision = await command('git', ['-C', pkgRoot, 'rev-parse', 'HEAD']);
        if (/^[a-f0-9]{40}$/.test(revision)) {
          state.package.sourceRevision = revision;
          state.package.dirty = Boolean(await command('git', ['-C', pkgRoot, 'status', '--porcelain']));
          state.package.source = 'GIT_CHECKOUT';
        }
      } catch { /* Git evidence remains Unknown if unreadable. */ }
      return;
    }
    try {
      const marker = (await readText(join(pkgRoot, '.afyx-source-revision'))).trim();
      if (/^[a-f0-9]{40}$/.test(marker)) { state.package.sourceRevision = marker; state.package.source = 'PACKAGE_MARKER'; }
    } catch { /* No ancestor repository may claim an unstamped package's identity. */ }
  })());
  await Promise.all(jobs);
  if (signal?.aborted) throw new Error('Environment discovery canceled');
  return state;
}

export function environmentLines(state) {
  const display = (item) => `${clean(item?.name) || 'Unknown'}${item?.version ? ` ${clean(item.version)}` : ''}`;
  return [
    `OS: ${display(state?.os)} | ${state?.architecture || 'Unknown'}${state?.subsystem ? ` | ${state.subsystem}` : ''}`,
    `Shell: ${display(state?.invokingShell)} | Terminal: ${display(state?.terminal)} | Backend: ${display(state?.backendShell)}`,
  ];
}

export function recordBackendExecution(state, executable) {
  if (!state || !executable) return;
  const name = basename(executable).toLowerCase().replace(/\.exe$/, '');
  const previous = basename(state.backendShell?.executable || '').toLowerCase().replace(/\.exe$/, '');
  state.backendShell = name === previous ? { ...state.backendShell, executed: true }
    : { name: { pwsh: 'PowerShell', powershell: 'Windows PowerShell', bash: 'Bash' }[name] || 'Unknown',
      version: null, executable, executed: true, source: 'BACKEND_PROCESS' };
}
