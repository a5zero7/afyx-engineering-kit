#!/usr/bin/env node

/**
 * AFYX Universal Cross-Platform npm CLI Installer (Core Adapter)
 *
 * Exposes universal CLI entrypoint for AFYX Engineering Kit across Windows, Linux, and macOS.
 * Bridges npm invocation to underlying PowerShell/Bash lifecycle scripts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PACKAGE_ROOT = resolve(__dirname, '..');

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
      result.options.dryRun = true;
    } else if (arg === '--validate-only') {
      result.options.validateOnly = true;
    } else if (arg === '--force') {
      result.options.force = true;
    } else if (arg === '--offline') {
      result.options.offline = true;
    } else if (arg === '--no-build-fallback') {
      result.options.noBuildFallback = true;
    } else if (arg === '--skip-provider-configuration') {
      result.options.skipProviderConfiguration = true;
    } else if (arg === '--skip-self-update') {
      result.options.skipSelfUpdate = true;
    } else if (arg === '--remove-provider-configuration') {
      result.options.removeProviderConfiguration = true;
    } else if (arg === '--remove-afyx-graph') {
      result.options.removeAfyxGraph = true;
    } else if (arg === '--remove-afyx-context') {
      result.options.removeAfyxContext = true;
    } else if (arg === '--remove-afyx-forge') {
      result.options.removeAfyxForge = true;
    } else if (arg === '--non-interactive' || arg === '-y' || arg === '--yes') {
      result.options.nonInteractive = true;
    } else if (arg === '--preset' || arg.startsWith('--preset=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--preset requires a value');
      else result.options.preset = val;
    } else if (arg === '--provider' || arg.startsWith('--provider=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--provider requires a value');
      else result.options.provider = val;
    } else if (arg === '--provider-scope' || arg.startsWith('--provider-scope=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--provider-scope requires a value');
      else result.options.providerScope = val;
    } else if (arg === '--workspace-root' || arg.startsWith('--workspace-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--workspace-root requires a value');
      else result.options.workspaceRoot = val;
    } else if (arg === '--skills-root' || arg.startsWith('--skills-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--skills-root requires a value');
      else result.options.skillsRoot = val;
    } else if (arg === '--context-runtime-root' || arg.startsWith('--context-runtime-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--context-runtime-root requires a value');
      else result.options.contextRuntimeRoot = val;
    } else if (arg === '--forge-runtime-root' || arg.startsWith('--forge-runtime-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--forge-runtime-root requires a value');
      else result.options.forgeRuntimeRoot = val;
    } else if (arg === '--graph-runtime-root' || arg.startsWith('--graph-runtime-root=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--graph-runtime-root requires a value');
      else result.options.graphRuntimeRoot = val;
    } else if (arg === '--project' || arg.startsWith('--project=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--project requires a value');
      else result.options.project = val;
    } else if (arg === '--custom-component' || arg.startsWith('--custom-component=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--custom-component requires a value');
      else result.options.customComponents.push(val);
    } else if (arg === '--component' || arg.startsWith('--component=')) {
      const val = arg.includes('=') ? arg.split('=')[1] : args[++i];
      if (!val) result.errors.push('--component requires a value');
      else result.options.componentActions.push(val);
    } else {
      result.errors.push(`Unknown option: "${arg}"`);
    }
  }

  return result;
}

export function buildSubprocessCall(command, options = {}, platform = process.platform, pkgRoot = PACKAGE_ROOT) {
  const isWindows = platform === 'win32';

  if (isWindows) {
    let scriptName;
    if (command === 'doctor') scriptName = join('scripts', 'afyx-doctor.ps1');
    else scriptName = `${command}.ps1`;

    const scriptPath = join(pkgRoot, scriptName);
    const psArgs = [];

    if (options.preset) psArgs.push('-Preset', options.preset);
    if (options.provider) psArgs.push('-Provider', options.provider);
    if (options.providerScope) psArgs.push('-ProviderScope', options.providerScope);
    if (options.workspaceRoot) psArgs.push('-WorkspaceRoot', options.workspaceRoot);
    if (options.skillsRoot) psArgs.push('-SkillsRoot', options.skillsRoot);
    if (options.contextRuntimeRoot) psArgs.push('-ContextRuntimeRoot', options.contextRuntimeRoot);
    if (options.forgeRuntimeRoot) psArgs.push('-ForgeRuntimeRoot', options.forgeRuntimeRoot);
    if (options.graphRuntimeRoot) psArgs.push('-GraphRuntimeRoot', options.graphRuntimeRoot);
    if (options.project) psArgs.push('-ProjectPath', options.project);

    if (options.customComponents && options.customComponents.length > 0) {
      for (const comp of options.customComponents) {
        psArgs.push('-CustomComponent', comp);
      }
    }
    if (options.componentActions && options.componentActions.length > 0) {
      for (const act of options.componentActions) {
        if (command === 'uninstall') {
          psArgs.push('-Component', act);
        } else {
          psArgs.push('-ComponentAction', act);
        }
      }
    }

    if (options.dryRun) {
      if (command === 'install' || command === 'uninstall') {
        psArgs.push('-WhatIf');
      }
    }
    if (options.validateOnly) psArgs.push('-ValidateOnly');
    if (options.force && command === 'install') psArgs.push('-Force');
    if (options.offline) psArgs.push('-Offline');
    if (options.noBuildFallback) psArgs.push('-NoBuildFallback');
    if (options.skipProviderConfiguration && command === 'install') psArgs.push('-SkipProviderConfiguration');
    if (options.skipSelfUpdate && command === 'update') psArgs.push('-SkipSelfUpdate');
    if (options.removeProviderConfiguration && command === 'uninstall') psArgs.push('-RemoveProviderConfiguration');
    if (options.removeAfyxGraph && command === 'uninstall') psArgs.push('-RemoveAfyxGraph');
    if (options.removeAfyxContext && command === 'uninstall') psArgs.push('-RemoveAfyxContext');
    if (options.removeAfyxForge && command === 'uninstall') psArgs.push('-RemoveAfyxForge');
    if (options.nonInteractive && (command === 'install' || command === 'uninstall')) {
      psArgs.push('-Confirm:$false');
    }

    // Prefer PowerShell 7+ (pwsh), fall back to Windows PowerShell (powershell.exe)
    const executable = 'pwsh';
    const invocationArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...psArgs];

    return {
      executable,
      fallbackExecutable: 'powershell.exe',
      args: invocationArgs,
      scriptPath,
    };
  }

  // Linux & macOS (Bash)
  let scriptName;
  if (command === 'doctor') scriptName = join('scripts', 'afyx-doctor.sh');
  else scriptName = `${command}.sh`;

  const scriptPath = join(pkgRoot, scriptName);
  const shArgs = [scriptPath];

  if (options.preset) shArgs.push('--preset', options.preset);
  if (options.provider) shArgs.push('--provider', options.provider);
  if (options.providerScope) shArgs.push('--provider-scope', options.providerScope);
  if (options.workspaceRoot) shArgs.push('--workspace-root', options.workspaceRoot);
  if (options.skillsRoot) shArgs.push('--skills-root', options.skillsRoot);
  if (options.contextRuntimeRoot) shArgs.push('--context-runtime-root', options.contextRuntimeRoot);
  if (options.forgeRuntimeRoot) shArgs.push('--forge-runtime-root', options.forgeRuntimeRoot);
  if (options.project) shArgs.push('--project', options.project);

  if (options.customComponents && options.customComponents.length > 0) {
    for (const comp of options.customComponents) {
      shArgs.push('--custom-component', comp);
    }
  }
  if (options.componentActions && options.componentActions.length > 0) {
    for (const act of options.componentActions) {
      shArgs.push('--component', act);
    }
  }

  if (options.dryRun) shArgs.push('--dry-run');
  if (options.validateOnly) shArgs.push('--validate-only');
  if (options.force && command === 'install') shArgs.push('--force');
  if (options.offline) shArgs.push('--offline');
  if (options.noBuildFallback) shArgs.push('--no-build-fallback');
  if (options.skipProviderConfiguration && command === 'install') shArgs.push('--skip-provider-configuration');
  if (options.skipSelfUpdate && command === 'update') shArgs.push('--skip-self-update');
  if (options.removeProviderConfiguration && command === 'uninstall') shArgs.push('--remove-provider-configuration');
  if (options.removeAfyxGraph && command === 'uninstall') shArgs.push('--remove-afyx-graph');
  if (options.removeAfyxContext && command === 'uninstall') shArgs.push('--remove-afyx-context');
  if (options.removeAfyxForge && command === 'uninstall') shArgs.push('--remove-afyx-forge');

  return {
    executable: 'bash',
    args: shArgs,
    scriptPath,
  };
}

export function executeSubprocess(callInfo, { onExit = null } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;

    const trySpawn = (exe, args) => {
      try {
        child = spawn(exe, args, {
          stdio: 'inherit',
          cwd: process.cwd(),
          env: process.env,
        });

        child.on('error', (err) => {
          if (callInfo.fallbackExecutable && exe !== callInfo.fallbackExecutable) {
            trySpawn(callInfo.fallbackExecutable, args);
            return;
          }
          rejectPromise(err);
        });

        child.on('close', (code, signal) => {
          const finalCode = signal ? 1 : (code ?? 0);
          if (onExit) onExit(finalCode);
          resolvePromise(finalCode);
        });
      } catch (err) {
        if (callInfo.fallbackExecutable && exe !== callInfo.fallbackExecutable) {
          trySpawn(callInfo.fallbackExecutable, args);
          return;
        }
        rejectPromise(err);
      }
    };

    trySpawn(callInfo.executable, callInfo.args);

    const forwardSignal = (sig) => {
      if (child && !child.killed) {
        child.kill(sig);
      }
    };

    process.on('SIGINT', () => forwardSignal('SIGINT'));
    process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  });
}
