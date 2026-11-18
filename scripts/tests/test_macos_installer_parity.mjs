import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { buildSubprocessCall } from '../afyx-npm-installer.mjs';
import { decodeContract } from '../afyx-install-contract.mjs';

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

test('Original Alpha.8 ordering fails under set -u when Claude CLI is absent and VS Code extension exists, while Hotfix succeeds with exact same fixture', (t) => {
  if (!bashExe) {
    t.skip('Bash executable not available');
    return;
  }

  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'afyx-alpha8-repro-'));
  try {
    const dummyHome = join(tempDir, 'home');
    const extDir = join(dummyHome, '.vscode', 'extensions', 'anthropic.claude-code-1.0.0');
    fs.mkdirSync(extDir, { recursive: true });

    const graphDir = join(tempDir, 'graph');
    setupMockGraphRuntime(graphDir);

    const cleanPath = createCleanPathWithoutBinary('claude');
    const sharedEnv = {
      HOME: toPosixPath(dummyHome),
      USERPROFILE: toPosixPath(dummyHome),
      PATH: cleanPath,
      AFYX_GRAPH_RUNTIME_ROOT: toPosixPath(graphDir),
      CI: '1',
      NO_COLOR: '1',
    };

    // Reconstruct the pre-hotfix Alpha.8 ordering in a temporary script next to install.sh
    // so PACKAGE_ROOT resolves identically to the real package root.
    const hotfixContent = fs.readFileSync(INSTALL_SH, 'utf8');
    const detectBlock = [
      'codex_cli_detected=false; command -v codex >/dev/null 2>&1 && codex_cli_detected=true',
      'antigravity_detected=false; { command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; } && antigravity_detected=true',
      'claude_cli_detected=false; command -v claude >/dev/null 2>&1 && claude_cli_detected=true',
      'claude_vscode_detected=false',
      'for extension in "$HOME"/.vscode/extensions/anthropic.claude-code-*; do [[ -d "$extension" ]] && { claude_vscode_detected=true; break; }; done',
      'vscode_extension_detected=false',
      'for extension in "$HOME"/.vscode/extensions/openai.chatgpt-*; do [[ -d "$extension" ]] && { vscode_extension_detected=true; break; }; done',
    ].join('\n');

    const normalized = hotfixContent.replace(/\r\n/g, '\n');
    assert.ok(normalized.includes(detectBlock), 'Expected host detection block in install.sh');
    const alpha8Reconstructed = normalized
      .replace(`${detectBlock}\n\nprintf '\\nProvider Plan\\n'`, `printf '\\nProvider Plan\\n'`)
      .replace(
        'if "$codex_cli_detected" || "$vscode_extension_detected"; then provider_detected=true; else provider_detected=false; fi',
        'command -v codex >/dev/null 2>&1 && provider_detected=true || provider_detected=false'
      )
      .replace(
        'provider_detected="$antigravity_detected"',
        '{ command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; } && provider_detected=true || provider_detected=false'
      )
      .replace(
        'if "$claude_cli_detected" || "$claude_vscode_detected"; then provider_detected=true; else provider_detected=false; fi',
        'command -v claude >/dev/null 2>&1 && provider_detected=true || provider_detected=false'
      )
      .replace(`printf '\\nPrerequisite Inventory\\n'`, `${detectBlock}\n\nprintf '\\nPrerequisite Inventory\\n'`);

    const tempAlpha8Script = join(tempDir, 'alpha8-repro-install.sh');
    // Rewrite PACKAGE_ROOT in the temp copy so it points to PACKAGE_ROOT
    const alpha8ExecutableContent = alpha8Reconstructed.replace(
      'PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
      `PACKAGE_ROOT="${toPosixPath(PACKAGE_ROOT)}"`
    );
    fs.writeFileSync(tempAlpha8Script, alpha8ExecutableContent, { mode: 0o755 });

    const runAlpha8 = spawnSync(
      bashExe,
      [tempAlpha8Script, '--dry-run', '--preset', 'recommended', '--provider', 'claude', '--validate-only'],
      { encoding: 'utf8', cwd: PACKAGE_ROOT, env: sharedEnv }
    );

    assert.notEqual(runAlpha8.status, 0, 'Original Alpha.8 ordering must fail when Claude CLI is absent');
    assert.match(runAlpha8.stderr, /claude_vscode_detected: unbound variable/);

    const runHotfix = spawnSync(
      bashExe,
      [INSTALL_SH, '--dry-run', '--preset', 'recommended', '--provider', 'claude', '--validate-only'],
      { encoding: 'utf8', cwd: PACKAGE_ROOT, env: sharedEnv }
    );

    assert.equal(runHotfix.status, 0, `Hotfix install.sh failed: ${runHotfix.stderr}\n${runHotfix.stdout}`);
    assert.doesNotMatch(runHotfix.stderr, /unbound variable/i);
    assert.match(runHotfix.stdout, /Claude Code: detected=true/);
    assert.match(runHotfix.stdout, /Claude Code host: detected \(VS Code extension\)/);
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
    assert.match(run.stdout, /Claude Code: detected=true/);
    assert.match(run.stdout, /Claude Code host: detected \(CLI\)/);
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
    assert.match(run.stdout, /Claude Code: detected=false/);
    assert.match(run.stdout, /Claude Code host: not detected/);
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

test('Node TUI and Bash backend compatibility: darwin subprocess call and plan-json contract execute under extension-only fixture', (t) => {
  if (!bashExe) {
    t.skip('Bash executable not available');
    return;
  }

  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'afyx-tui-bash-compat-'));
  try {
    const dummyHome = join(tempDir, 'home');
    const extDir = join(dummyHome, '.vscode', 'extensions', 'anthropic.claude-code-1.0.0');
    fs.mkdirSync(extDir, { recursive: true });

    const cleanPath = createCleanPathWithoutBinary('claude');

    const call = buildSubprocessCall(
      'install',
      {
        preset: 'recommended',
        provider: 'claude',
        planJson: true,
        nonInteractive: true,
      },
      'darwin',
      PACKAGE_ROOT
    );

    assert.equal(call.executable, 'bash');
    assert.ok(call.args[0].endsWith('install.sh'));
    assert.ok(call.args.includes('--plan-json'));
    assert.ok(call.args.includes('--provider'));
    assert.ok(call.args.includes('claude'));

    const run = spawnSync(bashExe, call.args, {
      encoding: 'utf8',
      cwd: PACKAGE_ROOT,
      env: {
        ...call.env,
        HOME: toPosixPath(dummyHome),
        USERPROFILE: toPosixPath(dummyHome),
        PATH: cleanPath,
        NO_COLOR: '1',
      },
    });

    assert.equal(run.status, 0, `Backend plan-json failed: ${run.stderr}\n${run.stdout}`);
    assert.doesNotMatch(run.stderr, /unbound variable/i);
    const decoded = decodeContract(run.stdout, 'AfyxInstallPlan/v1');
    assert.equal(decoded.schema, 'AfyxInstallPlan/v1');
    assert.equal(decoded.preset, 'recommended');
    assert.deepEqual(decoded.providers, ['claude']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
