#!/usr/bin/env node

/**
 * AFYX Universal Cross-Platform npm CLI Installer (Core Adapter)
 *
 * Exposes universal CLI entrypoint for AFYX Engineering Kit across Windows, Linux, and macOS.
 * Bridges npm invocation to underlying PowerShell/Bash lifecycle scripts with hardened
 * per-command argument allowlists, safety enforcement, deterministic fallback,
 * and clear packaged component asset boundaries.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PACKAGE_ROOT = resolve(__dirname, '..');

export function subprocessEnvironment(executable, env = process.env) {
  if (!/^powershell(?:\.exe)?$/i.test(basename(executable))) return env;
  const windowsRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR;
  if (!windowsRoot) return env;
  const nativeModules = join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  const modulePaths = [nativeModules, ...(env.PSModulePath || '').split(';').filter(Boolean)];
  return { ...env, PSModulePath: [...new Set(modulePaths)].join(';') };
}

let cachedVersion = null;
export function getPackageVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgJsonPath = join(PACKAGE_ROOT, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const data = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      cachedVersion = data.version || '0.1.0-alpha.1';
      return cachedVersion;
    }
  } catch {
    // fallback
  }
  return '0.1.0-alpha.1';
}

export const SUPPORTED_COMMANDS = ['install', 'verify', 'doctor', 'update', 'uninstall'];

// Explicit per-command option allowlist
export const COMMAND_ALLOWED_OPTIONS = {
  install: new Set([
    'preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
    'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot',
    'customComponents', 'componentActions',
    'dryRun', 'validateOnly', 'force', 'allowDowngrade', 'offline', 'noBuildFallback',
    'skipProviderConfiguration', 'nonInteractive', 'ui'
  ]),
  verify: new Set([
    'preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
    'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot',
    'customComponents'
  ]),
  doctor: new Set([
    'skillsRoot', 'project'
  ]),
  update: new Set([
    'preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
    'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot',
    'customComponents', 'componentActions',
    'dryRun', 'allowDowngrade', 'offline', 'noBuildFallback', 'skipProviderConfiguration',
    'skipSelfUpdate', 'nonInteractive'
  ]),
  uninstall: new Set([
    'skillsRoot', 'provider', 'providerScope', 'workspaceRoot',
    'graphRuntimeRoot', 'contextRuntimeRoot', 'forgeRuntimeRoot',
    'componentActions',
    'removeProviderConfiguration', 'removeAfyxGraph', 'removeAfyxContext', 'removeAfyxForge',
    'dryRun', 'nonInteractive'
  ])
};

export function getHelpText() {
  const version = getPackageVersion();
  return `AFYX Engineering Kit — Universal Cross-Platform CLI Installer v${version}

Usage:
  afyx-engineering-kit <command> [options]
  npx afyx-engineering-kit <command> [options]

Commands:
  install       Install AFYX components and provider integrations
  verify        Verify health and configuration of installed components
  doctor        Inspect environment readiness and diagnostic checks (read-only)
  update        Update installed AFYX components to the latest revision
  uninstall     Safely remove AFYX-managed components and provider entries

Options:
  --preset <name>                 Component preset (minimal, recommended, full, custom)
  --ui <auto|tui|plain>           Installer terminal interface (install only)
  --provider <names>              Target AI provider host(s) (codex, antigravity, claude)
  --provider-scope <scope>        Integration scope (global, workspace)
  --workspace-root <path>         Target project workspace root for local configuration
  --skills-root <path>            Explicit target directory for skill installations
  --context-runtime-root <path>   Explicit runtime root for Afyx Context Engine
  --forge-runtime-root <path>     Explicit runtime root for Afyx Forge Core
  --graph-runtime-root <path>     Explicit runtime root for Afyx Graph (Windows)
  --custom-component <id>         Specify individual component (repeatable)
  --component <id=action>         Individual component lifecycle action (repeatable)
  --skip-provider-configuration   Bypass AI provider host MCP and skill registration
  --skip-self-update              Skip git self-update during update command
  --remove-provider-configuration Remove configured provider entries during uninstall
  --remove-afyx-graph             Explicitly remove Afyx Graph runtime during uninstall
  --remove-afyx-context           Explicitly remove Afyx Context runtime during uninstall
  --remove-afyx-forge             Explicitly remove Afyx Forge runtime during uninstall
  --dry-run, --what-if, -n        Preview planned changes without modifying system
  --validate-only                 Check prerequisites and component status without mutating
  --force                         Force adoption or replacement where supported
  --allow-downgrade               Allow replacing a higher-version installation with this package
  --offline                       Disable network requests during installation
  --no-build-fallback             Fail if pre-packaged binary archive is unavailable
  --non-interactive, -y, --yes    Bypass interactive confirmations
  --project <path>                Target directory for doctor inspection
  --version, -v                   Display package version
  --help, -h                      Display this help message

Examples:
  npx afyx-engineering-kit install --preset recommended
  npx afyx-engineering-kit install --preset full --provider codex,antigravity --dry-run
  npx afyx-engineering-kit verify --preset recommended
  npx afyx-engineering-kit doctor
  npx afyx-engineering-kit update
  npx afyx-engineering-kit uninstall --component afyx-engineering-expert
`;
}

export function parseCliArgs(rawArgs) {
  const result = {
    command: null,
    options: {
      customComponents: [],
      componentActions: [],
    },
    errors: [],
    showHelp: false,
    showVersion: false,
  };

  const args = [...rawArgs];

  if (args.length === 0) {
    result.showHelp = true;
    return result;
  }

  const first = args[0];
  if (first === '--help' || first === '-h' || first === 'help') {
    result.showHelp = true;
    return result;
  }
  if (first === '--version' || first === '-v' || first === 'version') {
    result.showVersion = true;
    return result;
  }

  if (SUPPORTED_COMMANDS.includes(first)) {
    result.command = first;
    args.shift();
  } else if (first.startsWith('-')) {
    result.errors.push(`Missing command. Expected one of: ${SUPPORTED_COMMANDS.join(', ')}`);
    return result;
  } else {
    result.errors.push(`Unknown command: "${first}". Expected one of: ${SUPPORTED_COMMANDS.join(', ')}`);
    return result;
  }

  const recordOption = (key, flagName) => {
    const allowed = COMMAND_ALLOWED_OPTIONS[result.command];
    if (allowed && !allowed.has(key)) {
      result.errors.push(`Option "${flagName}" is not supported for command "${result.command}".`);
      return false;
    }
    return true;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.showHelp = true;
      return result;
    }
    if (arg === '--version' || arg === '-v') {
      result.showVersion = true;
      return result;
    }

    if (arg === '--dry-run' || arg === '-n' || arg === '--what-if') {
      if (recordOption('dryRun', arg)) result.options.dryRun = true;
    } else if (arg === '--validate-only') {
      if (recordOption('validateOnly', arg)) result.options.validateOnly = true;
    } else if (arg === '--force') {
      if (recordOption('force', arg)) result.options.force = true;
    } else if (arg === '--allow-downgrade') {
      if (recordOption('allowDowngrade', arg)) result.options.allowDowngrade = true;
    } else if (arg === '--offline') {
      if (recordOption('offline', arg)) result.options.offline = true;
    } else if (arg === '--no-build-fallback') {
      if (recordOption('noBuildFallback', arg)) result.options.noBuildFallback = true;
    } else if (arg === '--skip-provider-configuration') {
      if (recordOption('skipProviderConfiguration', arg)) result.options.skipProviderConfiguration = true;
    } else if (arg === '--skip-self-update') {
      if (recordOption('skipSelfUpdate', arg)) result.options.skipSelfUpdate = true;
    } else if (arg === '--remove-provider-configuration') {
      if (recordOption('removeProviderConfiguration', arg)) result.options.removeProviderConfiguration = true;
    } else if (arg === '--remove-afyx-graph') {
      if (recordOption('removeAfyxGraph', arg)) result.options.removeAfyxGraph = true;
    } else if (arg === '--remove-afyx-context') {
      if (recordOption('removeAfyxContext', arg)) result.options.removeAfyxContext = true;
    } else if (arg === '--remove-afyx-forge') {
      if (recordOption('removeAfyxForge', arg)) result.options.removeAfyxForge = true;
    } else if (arg === '--non-interactive' || arg === '-y' || arg === '--yes') {
      if (recordOption('nonInteractive', arg)) result.options.nonInteractive = true;
    } else if (arg === '--ui' || arg.startsWith('--ui=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!['auto', 'tui', 'plain'].includes(val)) result.errors.push('--ui requires auto, tui, or plain');
      else if (recordOption('ui', '--ui')) result.options.ui = val;
    } else if (arg === '--preset' || arg.startsWith('--preset=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--preset requires a value');
      else if (recordOption('preset', '--preset')) result.options.preset = val;
    } else if (arg === '--provider' || arg.startsWith('--provider=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--provider requires a value');
      else if (recordOption('provider', '--provider')) result.options.provider = val;
    } else if (arg === '--provider-scope' || arg.startsWith('--provider-scope=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--provider-scope requires a value');
      else if (recordOption('providerScope', '--provider-scope')) result.options.providerScope = val;
    } else if (arg === '--workspace-root' || arg.startsWith('--workspace-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--workspace-root requires a value');
      else if (recordOption('workspaceRoot', '--workspace-root')) result.options.workspaceRoot = val;
    } else if (arg === '--skills-root' || arg.startsWith('--skills-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--skills-root requires a value');
      else if (recordOption('skillsRoot', '--skills-root')) result.options.skillsRoot = val;
    } else if (arg === '--context-runtime-root' || arg.startsWith('--context-runtime-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--context-runtime-root requires a value');
      else if (recordOption('contextRuntimeRoot', '--context-runtime-root')) result.options.contextRuntimeRoot = val;
    } else if (arg === '--forge-runtime-root' || arg.startsWith('--forge-runtime-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--forge-runtime-root requires a value');
      else if (recordOption('forgeRuntimeRoot', '--forge-runtime-root')) result.options.forgeRuntimeRoot = val;
    } else if (arg === '--graph-runtime-root' || arg.startsWith('--graph-runtime-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--graph-runtime-root requires a value');
      else if (recordOption('graphRuntimeRoot', '--graph-runtime-root')) result.options.graphRuntimeRoot = val;
    } else if (arg === '--project' || arg.startsWith('--project=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--project requires a value');
      else if (recordOption('project', '--project')) result.options.project = val;
    } else if (arg === '--custom-component' || arg.startsWith('--custom-component=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--custom-component requires a value');
      else if (recordOption('customComponents', '--custom-component')) result.options.customComponents.push(val);
    } else if (arg === '--component' || arg.startsWith('--component=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--component requires a value');
      else if (recordOption('componentActions', '--component')) result.options.componentActions.push(val);
    } else {
      result.errors.push(`Unknown option: "${arg}"`);
    }
  }

  // Cross-option validation
  if (result.options.skipProviderConfiguration && result.options.provider) {
    result.errors.push('--skip-provider-configuration cannot be used together with --provider');
  }

  return result;
}

export function buildSubprocessCall(command, options = {}, platform = process.platform, pkgRoot = PACKAGE_ROOT) {
  const isWindows = platform === 'win32';
  const env = { ...process.env };

  // Graph runtime root is passed via environment variable across all backend scripts
  if (options.graphRuntimeRoot) {
    env.AFYX_GRAPH_RUNTIME_ROOT = options.graphRuntimeRoot;
  }

  // Handle outside-git-checkout update behavior
  let isGitRepo = true;
  try {
    isGitRepo = existsSync(join(pkgRoot, '.git'));
  } catch {
    isGitRepo = false;
  }
  const effectiveOptions = { ...options };
  if (command === 'update' && !isGitRepo && !effectiveOptions.skipSelfUpdate) {
    effectiveOptions.skipSelfUpdate = true;
  }

  if (isWindows) {
    let scriptName;
    if (command === 'doctor') scriptName = join('scripts', 'afyx-doctor.ps1');
    else if (command === 'update' && !isGitRepo) scriptName = 'install.ps1';
    else scriptName = `${command}.ps1`;

    const scriptPath = join(pkgRoot, scriptName);
    const psArgs = [];

    if (command === 'update' && !isGitRepo) {
      psArgs.push('-UpdateInstalled');
    }

    if (effectiveOptions.preset) psArgs.push('-Preset', effectiveOptions.preset);
    if (effectiveOptions.planJson && command === 'install') psArgs.push('-PlanJson');
    if (effectiveOptions.expectedPlan && command === 'install') psArgs.push('-ExpectedPlan', effectiveOptions.expectedPlan);
    if (effectiveOptions.reportJson && command === 'verify') psArgs.push('-ReportJson');
    if (effectiveOptions.provider) psArgs.push('-Provider', effectiveOptions.provider);
    if (effectiveOptions.providerScope) psArgs.push('-ProviderScope', effectiveOptions.providerScope);
    if (effectiveOptions.workspaceRoot) psArgs.push('-WorkspaceRoot', effectiveOptions.workspaceRoot);
    if (effectiveOptions.skillsRoot) psArgs.push('-SkillsRoot', effectiveOptions.skillsRoot);
    if (effectiveOptions.contextRuntimeRoot) psArgs.push('-ContextRuntimeRoot', effectiveOptions.contextRuntimeRoot);
    if (effectiveOptions.forgeRuntimeRoot) psArgs.push('-ForgeRuntimeRoot', effectiveOptions.forgeRuntimeRoot);
    if (effectiveOptions.graphRuntimeRoot && command === 'uninstall') psArgs.push('-GraphRuntimeRoot', effectiveOptions.graphRuntimeRoot);
    if (effectiveOptions.project) psArgs.push('-ProjectPath', effectiveOptions.project);

    if (effectiveOptions.customComponents && effectiveOptions.customComponents.length > 0) {
      for (const comp of effectiveOptions.customComponents) {
        psArgs.push('-CustomComponent', comp);
      }
    }
    if (effectiveOptions.componentActions && effectiveOptions.componentActions.length > 0) {
      for (const act of effectiveOptions.componentActions) {
        if (command === 'uninstall') {
          psArgs.push('-Component', act);
        } else {
          psArgs.push('-ComponentAction', act);
        }
      }
    }

    // SupportsShouldProcess commands (install, update, uninstall)
    if (effectiveOptions.dryRun && (command === 'install' || command === 'update' || command === 'uninstall')) {
      psArgs.push('-WhatIf');
    }
    if (effectiveOptions.nonInteractive && (command === 'install' || command === 'update' || command === 'uninstall')) {
      // Windows PowerShell 5.1 -File cannot bind a string Boolean to a switch.
      // These entrypoints use CI for prompt suppression and retain ShouldProcess.
      env.CI = '1';
    }

    if (effectiveOptions.validateOnly && command === 'install') psArgs.push('-ValidateOnly');
    if (effectiveOptions.force && command === 'install') psArgs.push('-Force');
    if (effectiveOptions.allowDowngrade && (command === 'install' || command === 'update')) psArgs.push('-AllowDowngrade');
    if (effectiveOptions.offline && (command === 'install' || command === 'update')) psArgs.push('-Offline');
    if (effectiveOptions.noBuildFallback && (command === 'install' || command === 'update')) psArgs.push('-NoBuildFallback');
    if (effectiveOptions.skipProviderConfiguration && (command === 'install' || command === 'update' || command === 'verify')) psArgs.push('-SkipProviderConfiguration');
    if (effectiveOptions.skipSelfUpdate && command === 'update' && isGitRepo) psArgs.push('-SkipSelfUpdate');
    if (effectiveOptions.removeProviderConfiguration && command === 'uninstall') psArgs.push('-RemoveProviderConfiguration');
    if (effectiveOptions.removeAfyxGraph && command === 'uninstall') psArgs.push('-RemoveAfyxGraph');
    if (effectiveOptions.removeAfyxContext && command === 'uninstall') psArgs.push('-RemoveAfyxContext');
    if (effectiveOptions.removeAfyxForge && command === 'uninstall') psArgs.push('-RemoveAfyxForge');

    // Prefer PowerShell 7+ (pwsh), fall back to Windows PowerShell (powershell.exe)
    const executable = 'pwsh';
    const invocationArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...psArgs];

    return {
      executable,
      fallbackExecutable: 'powershell.exe',
      args: invocationArgs,
      scriptPath,
      env,
    };
  }

  // Linux & macOS (Bash)
  let scriptName;
  if (command === 'doctor') scriptName = join('scripts', 'afyx-doctor.sh');
  else if (command === 'update' && !isGitRepo) scriptName = 'install.sh';
  else scriptName = `${command}.sh`;

  const scriptPath = join(pkgRoot, scriptName);
  const shArgs = [scriptPath];

  if (command === 'update' && !isGitRepo) {
    shArgs.push('--update-installed');
  }

  // In Linux/macOS bash scripts, non-interactive mode is activated by CI=1
  if (effectiveOptions.nonInteractive) {
    env.CI = '1';
  }

  if (effectiveOptions.preset) shArgs.push('--preset', effectiveOptions.preset);
  if (effectiveOptions.planJson && command === 'install') shArgs.push('--plan-json');
  if (effectiveOptions.expectedPlan && command === 'install') shArgs.push('--expected-plan', effectiveOptions.expectedPlan);
  if (effectiveOptions.reportJson && command === 'verify') shArgs.push('--report-json');
  if (effectiveOptions.provider) shArgs.push('--provider', effectiveOptions.provider);
  if (effectiveOptions.providerScope) shArgs.push('--provider-scope', effectiveOptions.providerScope);
  if (effectiveOptions.workspaceRoot) shArgs.push('--workspace-root', effectiveOptions.workspaceRoot);
  if (effectiveOptions.skillsRoot) shArgs.push('--skills-root', effectiveOptions.skillsRoot);
  if (effectiveOptions.contextRuntimeRoot) shArgs.push('--context-runtime-root', effectiveOptions.contextRuntimeRoot);
  if (effectiveOptions.forgeRuntimeRoot) shArgs.push('--forge-runtime-root', effectiveOptions.forgeRuntimeRoot);
  if (effectiveOptions.project) shArgs.push('--project', effectiveOptions.project);

  if (effectiveOptions.customComponents && effectiveOptions.customComponents.length > 0) {
    for (const comp of effectiveOptions.customComponents) {
      shArgs.push('--custom-component', comp);
    }
  }
  if (effectiveOptions.componentActions && effectiveOptions.componentActions.length > 0) {
    for (const act of effectiveOptions.componentActions) {
      shArgs.push('--component', act);
    }
  }

  if (effectiveOptions.dryRun && (command === 'install' || command === 'update' || command === 'uninstall')) {
    shArgs.push('--dry-run');
  }
  if (effectiveOptions.validateOnly && command === 'install') shArgs.push('--validate-only');
  if (effectiveOptions.force && command === 'install') shArgs.push('--force');
  if (effectiveOptions.allowDowngrade && (command === 'install' || command === 'update')) shArgs.push('--allow-downgrade');
  if (effectiveOptions.offline && (command === 'install' || command === 'update')) shArgs.push('--offline');
  if (effectiveOptions.noBuildFallback && (command === 'install' || command === 'update')) shArgs.push('--no-build-fallback');
  if (effectiveOptions.skipProviderConfiguration && (command === 'install' || command === 'update')) shArgs.push('--skip-provider-configuration');
  if (effectiveOptions.skipSelfUpdate && command === 'update' && isGitRepo) shArgs.push('--skip-self-update');
  if (effectiveOptions.removeProviderConfiguration && command === 'uninstall') shArgs.push('--remove-provider-configuration');
  if (effectiveOptions.removeAfyxGraph && command === 'uninstall') shArgs.push('--remove-afyx-graph');
  if (effectiveOptions.removeAfyxContext && command === 'uninstall') shArgs.push('--remove-afyx-context');
  if (effectiveOptions.removeAfyxForge && command === 'uninstall') shArgs.push('--remove-afyx-forge');

  return {
    executable: 'bash',
    args: shArgs,
    scriptPath,
    env,
  };
}

export function executeSubprocess(callInfo, { onExit = null } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let currentChild = null;
    let resolved = false;

    const cleanupSignalHandlers = () => {
      process.removeListener('SIGINT', handleSigInt);
      process.removeListener('SIGTERM', handleSigTerm);
    };

    const handleSigInt = () => {
      if (currentChild && !currentChild.killed) currentChild.kill('SIGINT');
    };
    const handleSigTerm = () => {
      if (currentChild && !currentChild.killed) currentChild.kill('SIGTERM');
    };

    process.on('SIGINT', handleSigInt);
    process.on('SIGTERM', handleSigTerm);

    const run = (exe, args) => {
      let child;
      try {
        child = spawn(exe, args, {
          stdio: 'inherit',
          cwd: process.cwd(),
          env: subprocessEnvironment(exe, callInfo.env || process.env),
        });
      } catch (err) {
        if (callInfo.fallbackExecutable && exe !== callInfo.fallbackExecutable) {
          run(callInfo.fallbackExecutable, args);
          return;
        }
        cleanupSignalHandlers();
        rejectPromise(err);
        return;
      }

      currentChild = child;
      let hasErrored = false;

      child.on('error', (err) => {
        hasErrored = true;
        child.removeAllListeners('close');
        if (callInfo.fallbackExecutable && exe !== callInfo.fallbackExecutable) {
          run(callInfo.fallbackExecutable, args);
          return;
        }
        cleanupSignalHandlers();
        rejectPromise(err);
      });

      child.on('close', (code, signal) => {
        if (hasErrored || resolved) return;
        resolved = true;
        cleanupSignalHandlers();
        const finalCode = signal ? 1 : (code ?? 0);
        if (onExit) onExit(finalCode);
        resolvePromise(finalCode);
      });
    };

    run(callInfo.executable, callInfo.args);
  });
}
