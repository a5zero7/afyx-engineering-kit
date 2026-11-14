import { spawn } from 'node:child_process';
import { buildSubprocessCall, PACKAGE_ROOT, subprocessEnvironment } from './afyx-npm-installer.mjs';
import { decodeContract } from './afyx-install-contract.mjs';

function capture(call, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const invoke = (program) => {
      const child = spawn(program, call.args, { windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'],
        env: subprocessEnvironment(program, { ...call.env, CI: '1', NO_COLOR: '1', AFYX_PLAIN_OUTPUT: '1' }) });
      const chunks = [];
      let bytes = 0, failed = false;
      const timer = setTimeout(() => { failed = true; child.kill(); reject(new Error('Backend inspection exceeded 300 seconds')); }, 300_000);
      child.on('error', (error) => {
        failed = true; clearTimeout(timer);
        if (error.code === 'ENOENT' && call.fallbackExecutable && program !== call.fallbackExecutable) invoke(call.fallbackExecutable);
        else reject(error);
      });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        if (failed) return;
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { failed = true; child.kill(); clearTimeout(timer); reject(new Error('Backend inspection exceeded output limit')); }
        else chunks.push(chunk);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (!failed) resolve({ exitCode: code ?? 1, output: Buffer.concat(chunks).toString('utf8') });
      });
    };
    invoke(call.executable);
  });
}

export function createBackendAdapter({ platform = process.platform, pkgRoot = PACKAGE_ROOT } = {}) {
  return {
    async plan(options, controls) {
      const { expectedPlan: _expectedPlan, ...query } = options;
      const result = await capture(buildSubprocessCall('install', { ...query, planJson: true, nonInteractive: true }, platform, pkgRoot), controls);
      if (result.exitCode !== 0) throw new Error(`Backend plan failed (${result.exitCode}): ${result.output}`);
      return decodeContract(result.output, 'AfyxInstallPlan/v1');
    },
    async verify(options, controls) {
      const allowed = ['preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
        'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot', 'customComponents', 'skipProviderConfiguration'];
      const query = Object.fromEntries(allowed.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]));
      const result = await capture(buildSubprocessCall('verify', { ...query, reportJson: true }, platform, pkgRoot), controls);
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
