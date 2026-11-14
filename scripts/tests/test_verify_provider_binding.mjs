import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT, subprocessEnvironment } from '../afyx-npm-installer.mjs';
import { decodeContract } from '../afyx-install-contract.mjs';

for (const shell of ['pwsh', 'powershell']) {
  for (const scenario of ['valid comma-separated providers', 'unknown provider']) {
    test(`${shell} -File verify: ${scenario}`, { skip: process.platform !== 'win32' }, t => {
      const root = mkdtempSync(join(tmpdir(), 'afyx-verify-binding-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const profileEnv = { ...process.env, USERPROFILE: root,
        APPDATA: join(root, 'roaming'), LOCALAPPDATA: join(root, 'local'),
        CODEX_HOME: join(root, '.codex'), AFYX_GEMINI_HOME: join(root, '.gemini'),
        CLAUDE_CONFIG_DIR: join(root, '.claude'), AFYX_INSTALL_ROOT: join(root, '.afyx'),
        AFYX_GRAPH_RUNTIME_ROOT: join(root, '.afyx/graph'),
        AFYX_CONTEXT_RUNTIME_ROOT: join(root, '.afyx/context'),
        AFYX_FORGE_RUNTIME_ROOT: join(root, '.afyx/forge'),
        AFYX_HOST_BRIDGE_RUNTIME_ROOT: join(root, '.afyx/host-bridge'), CI: '1', NO_COLOR: '1' };
      // This exercises parameter binding, not the owner's installed provider
      // executables. Keep real external host probes out of the fixture.
      const pathKey = Object.keys(profileEnv).find(key => key.toLowerCase() === 'path') || 'Path';
      profileEnv[pathKey] = [dirname(process.execPath),
        join(process.env.ProgramFiles, 'PowerShell/7'),
        join(process.env.SystemRoot, 'System32'),
        join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';');
      mkdirSync(root, { recursive: true });
      const provider = scenario === 'unknown provider' ? 'codex,unrecognized-host' : ' codex, antigravity,codex ';
      const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        join(PACKAGE_ROOT, 'verify.ps1'), '-Provider', provider, '-Preset', 'minimal',
        '-SkillsRoot', join(root, 'skills'), '-SkipProviderConfiguration', '-ReportJson'], {
        encoding: 'utf8', timeout: 60000, windowsHide: true,
        env: subprocessEnvironment(shell, profileEnv),
      });
      assert.ifError(result.error);
      if (scenario === 'unknown provider') {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unknown provider\(s\): unrecognized-host/);
        assert.doesNotMatch(result.stderr, /Unknown provider\(s\): codex/);
      } else {
        assert.doesNotMatch(result.stderr, /Unknown provider/);
        const contract = decodeContract(result.stdout, 'AfyxVerification/v1');
        assert.ok(contract.rows.some(row => row.name === 'Core readiness'));
        assert.equal(result.status, 1, 'isolated profile with missing core skills must remain unhealthy');
      }
    });
  }
}
