import { spawnSync } from 'node:child_process';
import { buildSubprocessCall, PACKAGE_ROOT, subprocessEnvironment } from './afyx-npm-installer.mjs';
import { decodeContract } from './afyx-install-contract.mjs';

function capture(call) {
  const invoke = (program) => spawnSync(program, call.args, {
    encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: 8 * 1024 * 1024,
    env: subprocessEnvironment(program, { ...call.env, CI: '1', NO_COLOR: '1' }),
  });
  let result = invoke(call.executable);
  if (result.error?.code === 'ENOENT' && call.fallbackExecutable) result = invoke(call.fallbackExecutable);
  if (result.error) throw result.error;
  return { exitCode: result.status ?? 1, output: `${result.stdout || ''}\n${result.stderr || ''}` };
}

export function createBackendAdapter({ platform = process.platform, pkgRoot = PACKAGE_ROOT } = {}) {
  return {
    plan(options) {
      const { expectedPlan: _expectedPlan, ...query } = options;
      const result = capture(buildSubprocessCall('install', { ...query, planJson: true, nonInteractive: true }, platform, pkgRoot));
      if (result.exitCode !== 0) throw new Error(`Backend plan failed (${result.exitCode}): ${result.output}`);
      return decodeContract(result.output, 'AfyxInstallPlan/v1');
    },
    verify(options) {
      const allowed = ['preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
        'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot', 'customComponents', 'skipProviderConfiguration'];
      const query = Object.fromEntries(allowed.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]));
      const result = capture(buildSubprocessCall('verify', { ...query, reportJson: true }, platform, pkgRoot));
      return { ...decodeContract(result.output, 'AfyxVerification/v1'), exitCode: result.exitCode };
    },
  };
}

export function summarizeExecution(plan, verification, installerExit, reviewedPlan = plan) {
  const rows = Array.isArray(verification.rows) ? verification.rows : [];
  const components = plan.components.map((entry) => {
    const reviewed = reviewedPlan.components.find((item) => item.id === entry.id);
    const status = !entry.desired ? 'SKIPPED' : entry.compatibility === 'NOT SUPPORTED' ? 'NOT SUPPORTED'
      : entry.currentState === 'HEALTHY' ? 'PASS' : 'FAILED';
    const completed = { install: 'INSTALLED', update: 'UPDATED', downgrade: 'UPDATED', repair: 'REPAIRED', adopt: 'ADOPTED', skip: 'SKIPPED' };
    const outcome = status === 'PASS' ? completed[reviewed?.backendAction] || 'VERIFIED' : status;
    return { id: entry.id, name: entry.name, version: entry.version, status, outcome, detail: entry.detail };
  });
  const failed = installerExit !== 0 || verification.exitCode !== 0 || components.some((entry) => entry.status === 'FAILED');
  return { status: failed ? 'FAILED' : 'PASS', components, rows };
}
