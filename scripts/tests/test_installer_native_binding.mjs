import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildSubprocessCall, PACKAGE_ROOT, subprocessEnvironment } from '../afyx-npm-installer.mjs';
import { decodeContract } from '../afyx-install-contract.mjs';

for (const shell of process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['bash']) {
  test(`real ${shell} binding: custom plan, apply, verify and selective uninstall preserve both IDs`, { timeout: 120_000 }, (t) => {
    const probe = spawnSync(shell, shell === 'bash' ? ['--version'] : ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', timeout: 10_000 });
    if (probe.error?.code === 'ENOENT') { t.skip(`${shell} unavailable`); return; }
    assert.equal(probe.status, 0, probe.stderr);
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-native-binding-'));
    t.after(() => rmSync(root, { recursive: true }));
    const profile = join(root, 'profile'); mkdirSync(profile);
    const ids = ['efficient-coding', 'odoo-engineering'];
    const options = { preset: 'custom', customComponents: ids, skillsRoot: join(root, 'skills'),
      skipProviderConfiguration: true, nonInteractive: true };
    const env = { ...process.env, HOME: profile, USERPROFILE: profile, CODEX_HOME: join(profile, '.codex'),
      AFYX_GEMINI_HOME: join(profile, '.gemini'), CLAUDE_CONFIG_DIR: join(profile, '.claude'),
      AFYX_INSTALL_ROOT: join(profile, '.afyx'), AFYX_GRAPH_RUNTIME_ROOT: join(profile, '.afyx', 'graph'),
      AFYX_CONTEXT_RUNTIME_ROOT: join(profile, '.afyx', 'context'), AFYX_FORGE_RUNTIME_ROOT: join(profile, '.afyx', 'forge'),
      AFYX_HOST_BRIDGE_RUNTIME_ROOT: join(profile, '.afyx', 'host-bridge'), AFYX_BACKUP_ROOT: join(root, 'backups'),
      APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local'),
      CI: '1', NO_COLOR: '1', AFYX_INSTALL_PROGRESS: '0' };
    const run = (command, args, expected = 0) => {
      const call = buildSubprocessCall(command, args, process.platform, PACKAGE_ROOT);
      const result = spawnSync(shell, call.args, { cwd: root, encoding: 'utf8', timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024, env: subprocessEnvironment(shell, { ...call.env, ...env }) });
      assert.equal(result.status, expected, `${command}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(result.stderr || '', /specified more than once|parameter.*bound twice/i);
      return `${result.stdout}\n${result.stderr}`;
    };
    const plan = decodeContract(run('install', { ...options, planJson: true }), 'AfyxInstallPlan/v1');
    assert.deepEqual(plan.components.filter((c) => c.desired).map((c) => c.id).sort(), ids.slice().sort());
    if (process.platform === 'win32') {
      const full = decodeContract(run('install', { ...options, preset: 'full', customComponents: [], planJson: true }), 'AfyxInstallPlan/v1');
      const usage = full.components.find((component) => component.id === 'codex-usage-tracking');
      assert.equal(usage.desired, false, 'No-provider Full must not require the Codex-only toolset');
      assert.equal(usage.backendAction, 'skip');
      assert.equal(full.components.find((component) => component.id === 'afyx-graph').desired, true);
    }
    run('install', { ...options, expectedPlan: plan.fingerprint });
    const verify = decodeContract(run('verify', { ...options, reportJson: true }), 'AfyxVerification/v1');
    assert.ok(verify.rows.length > 0);
    for (const id of ids) assert.ok(readFileSync(join(options.skillsRoot, id, 'SKILL.md'), 'utf8').includes(id));
    // Native comma/repeated action normalization is exercised independently of presets.
    run('install', { skillsRoot: options.skillsRoot, componentActions: ids.map((id) => `${id}=skip`),
      validateOnly: true, skipProviderConfiguration: true, nonInteractive: true });
    run('uninstall', { skillsRoot: options.skillsRoot, componentActions: ids, nonInteractive: true });
    for (const id of ids) assert.equal(existsSync(join(options.skillsRoot, id)), false);
    const receipt = join(root, 'receipt.txt'); writeFileSync(receipt, `${shell}: real binding complete`);
    assert.match(readFileSync(receipt, 'utf8'), /complete/);
  });
}
