import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..', '..');
const INSTALL_SH = join(PACKAGE_ROOT, 'install.sh');

function resolveBashExecutable() {
  const candidates = [
    'bash',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

const bashExe = resolveBashExecutable();

function toPosixPath(p) {
  return p.replace(/\\/g, '/');
}

function createCleanPathWithoutBinary(binaryName) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const currentDirs = (process.env.PATH || '').split(sep).filter(Boolean);
  const filtered = currentDirs.filter((dir) => {
    try {
      const entries = fs.readdirSync(dir);
      return !entries.some((entry) => {
        const lower = entry.toLowerCase();
        if (process.platform === 'win32') {
          return lower === binaryName.toLowerCase() ||
                 lower === `${binaryName.toLowerCase()}.exe` ||
                 lower === `${binaryName.toLowerCase()}.cmd` ||
                 lower === `${binaryName.toLowerCase()}.bat`;
        }
        return entry === binaryName;
      });
    } catch {
      return true;
    }
  });
  return filtered.join(sep);
}

function setupMockGraphRuntime(targetDir) {
  const entryDir = join(targetDir, 'current', 'lib', 'dist', 'bin');
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(join(entryDir, 'afyx-graph.js'), 'console.log("mock graph entry");\n');
}

test('install.sh static ordering invariant: host detection variables declared before preflight usage', () => {
  const content = fs.readFileSync(INSTALL_SH, 'utf8');
  const lines = content.split('\n');

  let declLine = -1;
  let usageLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('claude_vscode_detected=false')) {
      declLine = i + 1;
    }
    if (line.includes('elif "$claude_vscode_detected"')) {
      usageLine = i + 1;
      break;
    }
  }

  assert.ok(declLine > 0, 'claude_vscode_detected=false declaration must exist');
  assert.ok(usageLine > 0, 'usage of claude_vscode_detected must exist');
  assert.ok(
    declLine < usageLine,
    `Declaration of claude_vscode_detected at line ${declLine} must occur BEFORE usage at line ${usageLine}`
  );
});

test('POSIX Bash installer: extension-only detection under set -u without claude CLI', (t) => {
  if (!bashExe) {
    t.skip('Bash executable not available');
    return;
  }

  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'afyx-claude-ext-'));
  try {
    const dummyHome = join(tempDir, 'home');
    const extDir = join(dummyHome, '.vscode', 'extensions', 'anthropic.claude-code-1.0.0');
    fs.mkdirSync(extDir, { recursive: true });

    const graphDir = join(tempDir, 'graph');
    setupMockGraphRuntime(graphDir);

    const cleanPath = createCleanPathWithoutBinary('claude');

    const run = spawnSync(
      bashExe,
      [INSTALL_SH, '--dry-run', '--preset', 'recommended', '--provider', 'claude', '--validate-only'],
      {
        encoding: 'utf8',
        cwd: PACKAGE_ROOT,
        env: {
          HOME: toPosixPath(dummyHome),
          USERPROFILE: toPosixPath(dummyHome),
          PATH: cleanPath,
          AFYX_GRAPH_RUNTIME_ROOT: toPosixPath(graphDir),
          CI: '1',
          NO_COLOR: '1',
        },
      }
    );

    assert.equal(run.status, 0, `install.sh failed: ${run.stderr}\n${run.stdout}`);
    assert.doesNotMatch(run.stderr, /unbound variable/i);
    assert.ok(
      run.stdout.includes('Claude Code host: detected (VS Code extension)') ||
      run.stdout.includes('Claude Code: detected=true'),
      'Expected Claude Code extension detection in output'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POSIX Bash installer: CLI-installed detection when claude binary is present in PATH', (t) => {
  if (!bashExe) {
    t.skip('Bash executable not available');
    return;
  }

  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'afyx-claude-cli-'));
  try {
    const dummyHome = join(tempDir, 'home');
    fs.mkdirSync(dummyHome, { recursive: true });

    const dummyBinDir = join(tempDir, 'bin');
    fs.mkdirSync(dummyBinDir, { recursive: true });

    const graphDir = join(tempDir, 'graph');
    setupMockGraphRuntime(graphDir);

    fs.writeFileSync(join(dummyBinDir, 'claude'), '#!/bin/sh\necho "Claude CLI 1.0.0"\n', { mode: 0o755 });
    if (process.platform === 'win32') {
      fs.writeFileSync(join(dummyBinDir, 'claude.cmd'), '@echo Claude CLI 1.0.0\n', { mode: 0o755 });
      fs.writeFileSync(join(dummyBinDir, 'claude.exe'), '', { mode: 0o755 });
    }

    const sep = process.platform === 'win32' ? ';' : ':';
    const mockPath = `${dummyBinDir}${sep}${createCleanPathWithoutBinary('claude')}`;

    const run = spawnSync(
      bashExe,
      [INSTALL_SH, '--dry-run', '--preset', 'recommended', '--provider', 'claude', '--validate-only'],
      {
        encoding: 'utf8',
        cwd: PACKAGE_ROOT,
        env: {
          HOME: toPosixPath(dummyHome),
          USERPROFILE: toPosixPath(dummyHome),
          PATH: mockPath,
          AFYX_GRAPH_RUNTIME_ROOT: toPosixPath(graphDir),
          CI: '1',
          NO_COLOR: '1',
        },
      }
    );

    assert.equal(run.status, 0, `install.sh failed: ${run.stderr}\n${run.stdout}`);
    assert.doesNotMatch(run.stderr, /unbound variable/i);
    assert.ok(
      run.stdout.includes('Claude Code host: detected (CLI)') ||
      run.stdout.includes('Claude Code: detected=true'),
      'Expected Claude Code CLI detection in output'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POSIX Bash installer: neither CLI nor extension present reports not detected without crash', (t) => {
  if (!bashExe) {
    t.skip('Bash executable not available');
    return;
  }

  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'afyx-claude-none-'));
  try {
    const dummyHome = join(tempDir, 'home');
    fs.mkdirSync(dummyHome, { recursive: true });

    const graphDir = join(tempDir, 'graph');
    setupMockGraphRuntime(graphDir);

    const cleanPath = createCleanPathWithoutBinary('claude');

    const run = spawnSync(
      bashExe,
      [INSTALL_SH, '--dry-run', '--preset', 'recommended', '--provider', 'claude', '--validate-only'],
      {
        encoding: 'utf8',
        cwd: PACKAGE_ROOT,
        env: {
          HOME: toPosixPath(dummyHome),
          USERPROFILE: toPosixPath(dummyHome),
          PATH: cleanPath,
          AFYX_GRAPH_RUNTIME_ROOT: toPosixPath(graphDir),
          CI: '1',
          NO_COLOR: '1',
        },
      }
    );

    assert.equal(run.status, 0, `install.sh failed: ${run.stderr}\n${run.stdout}`);
    assert.doesNotMatch(run.stderr, /unbound variable/i);
    assert.ok(
      run.stdout.includes('Claude Code host: not detected') ||
      run.stdout.includes('Claude Code: detected=false'),
      'Expected Claude Code not detected in output'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POSIX Bash installer: all providers selected under extension-only environment executes cleanly', (t) => {
  if (!bashExe) {
    t.skip('Bash executable not available');
    return;
  }

  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'afyx-all-prov-'));
  try {
    const dummyHome = join(tempDir, 'home');
    const extDir = join(dummyHome, '.vscode', 'extensions', 'anthropic.claude-code-1.0.0');
    fs.mkdirSync(extDir, { recursive: true });

    const cleanPath = createCleanPathWithoutBinary('claude');

    // Gunakan --skip-graph-mcp untuk mengisolasi evaluasi provider parsing & detection plan
    const run = spawnSync(
      bashExe,
      [INSTALL_SH, '--dry-run', '--preset', 'recommended', '--provider', 'codex,antigravity,claude', '--skip-graph-mcp', '--validate-only'],
      {
        encoding: 'utf8',
        cwd: PACKAGE_ROOT,
        env: {
          HOME: toPosixPath(dummyHome),
          USERPROFILE: toPosixPath(dummyHome),
          PATH: cleanPath,
          CI: '1',
          NO_COLOR: '1',
        },
      }
    );

    assert.equal(run.status, 0, `install.sh failed: ${run.stderr}\n${run.stdout}`);
    assert.doesNotMatch(run.stderr, /unbound variable/i);
    assert.ok(run.stdout.includes('Codex:'));
    assert.ok(run.stdout.includes('Antigravity:'));
    assert.ok(run.stdout.includes('Claude Code:'));
    assert.ok(run.stdout.includes('Claude Code: detected=true'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POSIX Bash installer: Codex-only selection bypasses Claude preflight cleanly', (t) => {
  if (!bashExe) {
    t.skip('Bash executable not available');
    return;
  }

  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'afyx-codex-only-'));
  try {
    const dummyHome = join(tempDir, 'home');
    const extDir = join(dummyHome, '.vscode', 'extensions', 'anthropic.claude-code-1.0.0');
    fs.mkdirSync(extDir, { recursive: true });

    const graphDir = join(tempDir, 'graph');
    setupMockGraphRuntime(graphDir);

    const cleanPath = createCleanPathWithoutBinary('claude');

    const run = spawnSync(
      bashExe,
      [INSTALL_SH, '--dry-run', '--preset', 'recommended', '--provider', 'codex', '--validate-only'],
      {
        encoding: 'utf8',
        cwd: PACKAGE_ROOT,
        env: {
          HOME: toPosixPath(dummyHome),
          USERPROFILE: toPosixPath(dummyHome),
          PATH: cleanPath,
          AFYX_GRAPH_RUNTIME_ROOT: toPosixPath(graphDir),
          CI: '1',
          NO_COLOR: '1',
        },
      }
    );

    assert.equal(run.status, 0, `install.sh failed: ${run.stderr}\n${run.stdout}`);
    assert.doesNotMatch(run.stderr, /unbound variable/i);
    assert.ok(run.stdout.includes('Codex:'));
    assert.ok(!run.stdout.includes('Claude Code planned skills:'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
