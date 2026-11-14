import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT, subprocessEnvironment } from '../afyx-npm-installer.mjs';
import { decodeContract } from '../afyx-install-contract.mjs';
import { installHostBridge } from '../afyx-host-bridge-lifecycle.mjs';

for (const shell of ['pwsh', 'powershell']) {
  for (const scenario of ['valid comma-separated providers', 'unknown provider', 'bridge without Graph or Claude']) {
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
      const bridgeOnly = scenario === 'bridge without Graph or Claude';
      if (bridgeOnly) installHostBridge({ sourceRoot: join(PACKAGE_ROOT, 'scripts'),
        runtimeRoot: profileEnv.AFYX_HOST_BRIDGE_RUNTIME_ROOT, sourceRevision: 'DISPOSABLE_TEST' });
      const provider = scenario === 'unknown provider' ? 'codex,unrecognized-host'
        : bridgeOnly ? 'antigravity' : ' codex, antigravity,codex ';
      const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        join(PACKAGE_ROOT, 'verify.ps1'), '-Provider', provider, '-Preset', 'minimal',
        '-SkillsRoot', join(root, 'skills'), ...(!bridgeOnly ? ['-SkipProviderConfiguration'] : []), '-ReportJson'], {
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
        if (bridgeOnly) {
          assert.doesNotMatch(result.stderr, /claudeCommand/);
          assert.ok(contract.rows.some(row => row.name === 'Afyx Universal Host Bridge' && row.state === 'OK'));
          const workflow = contract.rows.find(row => row.name === 'Afyx workflow MCP');
          assert.ok(workflow, 'workflow verification must reach the structured report');
          assert.equal(workflow.detail, 'PARTIAL', 'no registration must not be reported READY');
        }
        assert.equal(result.status, 1, 'isolated profile with missing core skills must remain unhealthy');
      }
    });
  }
}
