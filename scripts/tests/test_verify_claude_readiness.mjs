import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildSubprocessCall, PACKAGE_ROOT, subprocessEnvironment } from '../afyx-npm-installer.mjs';
import { decodeContract } from '../afyx-install-contract.mjs';

const windows = process.platform === 'win32';
for (const shell of windows ? ['powershell.exe', 'pwsh.exe'] : ['bash']) {
  const scenarios = windows ? ['extension-only', 'cli-only', 'missing-host', 'broken-cli-with-extension', 'modified-skill']
    : ['extension-only', 'missing-host', 'modified-skill'];
  for (const scenario of scenarios) {
    test(`${shell}: Claude readiness ${scenario} preserves user configuration`, { timeout: 120_000 }, (t) => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-claude-readiness-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const profile = join(root, 'profile'), bin = join(root, 'bin'), project = join(root, 'project');
      for (const path of [profile, bin, project]) mkdirSync(path);
      copyFileSync(process.execPath, join(bin, windows ? 'node.exe' : 'node'));
      const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')),
        HOME: profile, USERPROFILE: profile, CODEX_HOME: join(profile, '.codex'), CLAUDE_CONFIG_DIR: '',
        XDG_CONFIG_HOME: join(profile, '.config'), AFYX_GEMINI_HOME: join(profile, '.gemini'),
        APPDATA: join(profile, 'AppData/Roaming'), LOCALAPPDATA: join(profile, 'AppData/Local'),
        AFYX_INSTALL_ROOT: join(profile, '.afyx'), AFYX_BACKUP_ROOT: join(root, 'backups'),
        AFYX_GRAPH_RUNTIME_ROOT: join(profile, '.afyx/graph'), AFYX_CONTEXT_RUNTIME_ROOT: join(profile, '.afyx/context'),
        AFYX_FORGE_RUNTIME_ROOT: join(profile, '.afyx/forge'), AFYX_HOST_BRIDGE_RUNTIME_ROOT: join(profile, '.afyx/host-bridge'),
        CI: '1', NO_COLOR: '1', AFYX_PLAIN_OUTPUT: '1', AFYX_INSTALL_PROGRESS: '0' };
      env.PATH = windows ? [bin, join(process.env.ProgramFiles, 'Git/cmd'), join(process.env.ProgramFiles, 'PowerShell/7'),
        join(process.env.SystemRoot, 'System32'), join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';')
        : `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`;
      const skillsRoot = join(profile, '.claude/skills');
      const options = { preset: 'minimal', provider: 'claude', providerScope: 'global', workspaceRoot: project, skillsRoot };
      const invoke = (command, extra = {}) => {
        const call = buildSubprocessCall(command, { ...options, ...extra }, process.platform, PACKAGE_ROOT);
        const result = spawnSync(shell, call.args, { cwd: project, env: subprocessEnvironment(shell, { ...call.env, ...env }),
          encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
        assert.ifError(result.error);
        return result;
      };
      const foreign = join(profile, '.claude.json');
      const originalConfig = Buffer.from('\uFEFF{\r\n  "user_owned": "keep exact bytes", "mcpServers": {"foreign": {"command": "foreign-tool"}}\r\n}\r\n');
      writeFileSync(foreign, originalConfig);
      const seeded = invoke('install', { skipProviderConfiguration: true, nonInteractive: true });
      assert.equal(seeded.status, 0, `${seeded.stdout}\n${seeded.stderr}`);
      if (scenario !== 'missing-host' && scenario !== 'cli-only') {
        const extension = join(profile, '.vscode/extensions/anthropic.claude-code-test');
        mkdirSync(extension, { recursive: true });
        writeFileSync(join(extension, 'package.json'), JSON.stringify({ publisher: 'anthropic', name: 'claude-code', version: '2.0.0' }));
      }
      if (scenario === 'cli-only' || scenario === 'broken-cli-with-extension') {
        writeFileSync(join(bin, 'claude.cmd'), `@echo off\r\necho Claude Code test CLI\r\nexit /b ${scenario === 'cli-only' ? 0 : 9}\r\n`);
      }
      const skill = join(skillsRoot, 'efficient-coding/SKILL.md');
      if (scenario === 'modified-skill') writeFileSync(skill, readFileSync(skill, 'utf8') + '\nUser-owned change must remain.\n');
      const beforeSkill = readFileSync(skill);
      const result = invoke('verify', { reportJson: true });
      const contract = decodeContract(`${result.stdout}\n${result.stderr}`, 'AfyxVerification/v1');
      const host = contract.rows.find((row) => /^Claude Code (host|provider)$/.test(row.name));
      const hostFailure = scenario === 'missing-host' || scenario === 'broken-cli-with-extension';
      assert.equal(host.state, hostFailure ? 'FAIL' : 'OK', JSON.stringify(contract.rows));
      const failure = hostFailure || scenario === 'modified-skill';
      assert.equal(result.status, failure ? 1 : 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(contract.rows.find((row) => row.name === 'Core readiness').state, failure ? 'FAIL' : 'OK');
      if (scenario === 'modified-skill') assert.ok(contract.rows.some((row) => row.state === 'FAIL' && /efficient.coding/i.test(row.name)));
      assert.deepEqual(readFileSync(foreign), originalConfig);
      assert.deepEqual(readFileSync(skill), beforeSkill);
    });
  }
}
