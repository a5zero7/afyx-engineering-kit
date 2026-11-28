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
import { parseArgs } from 'node:util';
import { StringDecoder } from 'node:string_decoder';

import {
  LEGACY_COMPONENT_ALIASES,
  loadComponentsContract,
  resolveComponentId as resolveCanonicalComponentId,
} from './afyx-installer-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PACKAGE_ROOT = resolve(__dirname, '..');
const componentIds = new Set(loadComponentsContract(join(__dirname, 'components.json')).components.map((entry) => entry.id));
const legacyAliases = LEGACY_COMPONENT_ALIASES;

function checkedComponents(values, actions = false) {
  if (!Array.isArray(values)) throw new Error('Component selections must be an array.');
  for (const value of values) {
    const match = typeof value === 'string' && (actions
      ? /^([a-z][a-z0-9-]*)=(skip|install|update|repair|adopt)$/.exec(value)
      : /^([a-z][a-z0-9-]*)$/.exec(value));
    if (!match || (!componentIds.has(match[1]) && !legacyAliases.has(match[1]))) throw new Error(`Unknown or malformed component selection: ${String(value)}`);
  }
  return values;
}

export function subprocessEnvironment(executable, env = process.env) {
  if (!/^powershell(?:\.exe)?$/i.test(basename(executable))) return env;
  const windowsRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR;
  if (!windowsRoot) return env;
  const nativeModules = join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  // Windows names are case-insensitive, but a spread object is not. Node sends
  // only the first case variant to the child (some hosts use PSMODULEPATH).
  const moduleEntries = Object.entries(env).filter(([key]) => key.toLowerCase() === 'psmodulepath');
  const modulePaths = [nativeModules, ...moduleEntries.flatMap(([, value]) => (value || '').split(';').filter(Boolean))];
  const childEnvironment = Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  return { ...childEnvironment, PSModulePath: [...new Set(modulePaths)].join(';') };
}

let cachedVersion = null;
export function getPackageVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgJsonPath = join(PACKAGE_ROOT, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const data = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      cachedVersion = data.version || '1.2.0';
      return cachedVersion;
    }
  } catch {
    // fallback
  }
  return '1.2.0';
}

export const SUPPORTED_COMMANDS = ['install', 'verify', 'doctor', 'update', 'uninstall', 'clean', 'trace'];

// Explicit per-command option allowlist
export const COMMAND_ALLOWED_OPTIONS = {
  install: new Set([
    'preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
    'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot',
    'customComponents', 'componentActions',
    'dryRun', 'validateOnly', 'force', 'allowDowngrade', 'offline', 'noBuildFallback', 'verifyAttestation',
    'skipProviderConfiguration', 'nonInteractive', 'ui'
  ]),
  verify: new Set([
    'preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
    'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot',
    'customComponents', 'skipProviderConfiguration'
  ]),
  clean: new Set(['dryRun', 'json', 'maxAgeHours']),
  trace: new Set(['json', 'limit', 'traceComponent', 'traceFile', 'traceSubcommand']),
  doctor: new Set([
    'skillsRoot', 'project'
  ]),
  update: new Set([
    'preset', 'provider', 'providerScope', 'workspaceRoot', 'skillsRoot',
    'contextRuntimeRoot', 'forgeRuntimeRoot', 'graphRuntimeRoot',
    'customComponents', 'componentActions',
    'dryRun', 'allowDowngrade', 'offline', 'noBuildFallback', 'verifyAttestation', 'skipProviderConfiguration',
    'skipSelfUpdate', 'nonInteractive'
  ]),
  uninstall: new Set([
    'skillsRoot', 'provider', 'providerScope', 'workspaceRoot',
    'graphRuntimeRoot', 'contextRuntimeRoot', 'forgeRuntimeRoot',
    'componentActions',
    'removeProviderConfiguration', 'removeAfyxGraph', 'removeAfyxContext', 'removeAfyxForge',
    'all', 'purgeBackups', 'pruneBackups',
    'dryRun', 'nonInteractive'
  ])
};

const OPTIONS = {
  'dry-run': { key: 'dryRun', type: 'boolean', aliases: ['-n', '--what-if'] },
  'validate-only': { key: 'validateOnly', type: 'boolean' },
  force: { key: 'force', type: 'boolean' },
  'allow-downgrade': { key: 'allowDowngrade', type: 'boolean' },
  offline: { key: 'offline', type: 'boolean' },
  'no-build-fallback': { key: 'noBuildFallback', type: 'boolean' },
  'verify-attestation': { key: 'verifyAttestation', type: 'boolean' },
  'skip-provider-configuration': { key: 'skipProviderConfiguration', type: 'boolean' },
  'skip-self-update': { key: 'skipSelfUpdate', type: 'boolean' },
  'remove-provider-configuration': { key: 'removeProviderConfiguration', type: 'boolean' },
  'remove-afyx-graph': { key: 'removeAfyxGraph', type: 'boolean' },
  'remove-afyx-context': { key: 'removeAfyxContext', type: 'boolean' },
  'remove-afyx-forge': { key: 'removeAfyxForge', type: 'boolean' },
  all: { key: 'all', type: 'boolean' },
  'prune-backups': { key: 'pruneBackups', type: 'boolean' },
  'purge-backups': { key: 'purgeBackups', type: 'boolean' },
  'non-interactive': { key: 'nonInteractive', type: 'boolean', aliases: ['-y', '--yes'] },
  json: { key: 'json', type: 'boolean' },
  ui: { key: 'ui', type: 'string' },
  preset: { key: 'preset', type: 'string', allowEmpty: true },
  provider: { key: 'provider', type: 'string' },
  'provider-scope': { key: 'providerScope', type: 'string' },
  'workspace-root': { key: 'workspaceRoot', type: 'string' },
  'skills-root': { key: 'skillsRoot', type: 'string' },
  'context-runtime-root': { key: 'contextRuntimeRoot', type: 'string' },
  'forge-runtime-root': { key: 'forgeRuntimeRoot', type: 'string' },
  'graph-runtime-root': { key: 'graphRuntimeRoot', type: 'string' },
  project: { key: 'project', type: 'string' },
  'custom-component': { key: 'customComponents', type: 'string', repeat: resolveComponentId },
  component: { key: 'componentActions', type: 'string', repeat: value => {
    const [id, action] = value.split('=');
    return action === undefined ? value : resolveComponentId(id) + '=' + action;
  } },
  'max-age-hours': { key: 'maxAgeHours', type: 'string' },
  limit: { key: 'limit', type: 'string' },
  'trace-component': { key: 'traceComponent', type: 'string' },
  'trace-file': { key: 'traceFile', type: 'string' },
};
const PARSE_OPTIONS = Object.fromEntries(Object.entries(OPTIONS).map(([name, spec]) => [name, { type: spec.type }]));
const OPTION_NAMES = new Map(Object.entries(OPTIONS).flatMap(([name, spec]) =>
  ['--' + name, ...(spec.aliases ?? [])].map(flag => [flag, name])));

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
  clean         Remove inactive, verified AFYX temporary artifacts

Universal Native Capabilities:
  afyx-work-ledger             Cryptographic task ledger and execution receipts
  afyx-migration-planner       Multi-tier migration and rollback planning
  afyx-impact-simulator        Deterministic change blast radius simulation
  afyx-db-inspector            Read-only contained SQLite schema & data inspection
  afyx-api-contract-validator  Multi-spec API contract validator (OpenAPI, GraphQL, Protobuf)
  afyx-env-preflight           Host and workspace environment prerequisite preflight
  afyx-cli-compactor           Lossless CLI output compaction with recoverable spills
  afyx-massive-context         Zero-memory streaming navigation & slice extraction

Options:
  --preset <name>                 Component preset (minimal, recommended, full, custom)
                                  Recommended leaves Graph MCP opt-in.
  --ui <auto|tui|plain>           Installer terminal interface (install only)
  --provider <names>              Target AI provider host(s) (codex, antigravity, claude)
  --provider-scope <scope>        Integration scope (global for Codex/Antigravity MCP; global or workspace for Claude Code MCP)
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
  --all                           Remove all AFYX runtimes (Graph, Context, Forge) during uninstall
  --purge-backups                 Remove all verified, completed AFYX backups in scope
  --prune-backups                 Keep the newest five verified backups per component
  --dry-run, --what-if, -n        Preview planned changes without modifying system
  --validate-only                 Check prerequisites and component status without mutating
  --force                         Force adoption or replacement where supported
  --allow-downgrade               Allow replacing a higher-version installation with this package
  --offline                       Disable network requests during installation
  --no-build-fallback             Fail if pre-packaged binary archive is unavailable
  --verify-attestation            Require GitHub provenance before Graph installation
  --max-age-hours <hours>         Clean retention (default and minimum 6 hours)
  --json                          Output cleanup counts as JSON
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

export function resolveComponentId(id) {
  return resolveCanonicalComponentId(id);
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
    if (first === 'trace' && args.length > 0 && args[0] === 'summary') {
      result.options.traceSubcommand = 'summary';
      args.shift();
    }
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
    if (typeof result.options[key] === 'string') {
      result.errors.push(`Option "${flagName}" may only be specified once.`);
      result.errorExitCode = 2;
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

    const equal = arg.indexOf('=');
    const name = OPTION_NAMES.get(equal < 0 ? arg : arg.slice(0, equal));
    if (!name || (equal >= 0 && OPTIONS[name].type !== 'string')) {
      result.errors.push(`Unknown option: "${arg}"`);
      continue;
    }
    const spec = OPTIONS[name];
    const flag = '--' + name;
    let normalized = flag;
    if (spec.type === 'string') {
      if (equal < 0 && (i + 1 >= args.length || args[i + 1].startsWith('-'))) {
        result.errors.push(flag + ' requires a value');
        continue;
      }
      normalized += '=' + (equal < 0 ? args[++i] : arg.slice(equal + 1));
    }
    const value = parseArgs({ args: [normalized], options: PARSE_OPTIONS }).values[name];
    if (spec.type === 'string' && !value && !spec.allowEmpty && name !== 'ui') {
      result.errors.push(flag + ' requires a value');
    } else if (name === 'ui' && !['auto', 'tui', 'plain'].includes(value)) {
      result.errors.push('--ui requires auto, tui, or plain');
    } else if (recordOption(spec.key, spec.type === 'boolean' ? arg : flag)) {
      if (spec.repeat) result.options[spec.key].push(spec.repeat(value));
      else result.options[spec.key] = value;
    }
  }

  if (result.command === 'clean' && result.options.maxAgeHours !== undefined &&
      (!/^\d{1,5}$/.test(result.options.maxAgeHours) || Number(result.options.maxAgeHours) < 6 ||
          Number(result.options.maxAgeHours) > 8760)) result.errors.push('--max-age-hours requires an integer from 6 to 8760');

  // Cross-option validation
  if (result.options.offline && result.options.verifyAttestation) {
    result.errors.push('--verify-attestation requires verification and cannot be used with --offline');
  }
  if (result.options.skipProviderConfiguration && result.options.provider) {
    result.errors.push('--skip-provider-configuration cannot be used together with --provider');
  }

  if (result.options.purgeBackups && result.options.pruneBackups) {
    result.errors.push('Choose either --purge-backups or --prune-backups.');
  }

  if (result.errors.length > 0) {
    result.options = {};
  }

  return result;
}

export function buildSubprocessCall(command, options = {}, platform = process.platform, pkgRoot = PACKAGE_ROOT) {
  const isWindows = platform === 'win32';
  const env = { ...process.env };
  if (options.verifyAttestation) env.AFYX_GRAPH_ATTESTATION_MODE = 'required';

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
  if (effectiveOptions.customComponents) checkedComponents(effectiveOptions.customComponents);
  if (effectiveOptions.componentActions) checkedComponents(effectiveOptions.componentActions, command !== 'uninstall');
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
      // -File binds one string per named parameter on both Windows PS 5.1 and
      // PS 7. The native entrypoints expand this validated comma-separated list.
      psArgs.push('-CustomComponent', effectiveOptions.customComponents.join(','));
    }
    if (effectiveOptions.componentActions && effectiveOptions.componentActions.length > 0) {
      psArgs.push(command === 'uninstall' ? '-Component' : '-ComponentAction', effectiveOptions.componentActions.join(','));
    }

    // SupportsShouldProcess commands (install, update, uninstall)
    if (effectiveOptions.dryRun && (command === 'install' || command === 'update' || command === 'uninstall')) {
      psArgs.push('-WhatIf');
    }
    if (effectiveOptions.nonInteractive && (command === 'install' || command === 'update' || command === 'uninstall')) {
      env.AFYX_NONINTERACTIVE = '1';
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
    if (effectiveOptions.all && command === 'uninstall') psArgs.push('-All');
    if (effectiveOptions.purgeBackups && command === 'uninstall') psArgs.push('-PurgeBackups');
    if (effectiveOptions.pruneBackups && command === 'uninstall') psArgs.push('-PruneBackups');

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

  if (effectiveOptions.nonInteractive) {
    env.AFYX_NONINTERACTIVE = '1';
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
  if (effectiveOptions.skipProviderConfiguration && (command === 'install' || command === 'update' || command === 'verify')) shArgs.push('--skip-provider-configuration');
  if (effectiveOptions.skipSelfUpdate && command === 'update' && isGitRepo) shArgs.push('--skip-self-update');
  if (effectiveOptions.removeProviderConfiguration && command === 'uninstall') shArgs.push('--remove-provider-configuration');
  if (effectiveOptions.removeAfyxGraph && command === 'uninstall') shArgs.push('--remove-afyx-graph');
  if (effectiveOptions.removeAfyxContext && command === 'uninstall') shArgs.push('--remove-afyx-context');
  if (effectiveOptions.removeAfyxForge && command === 'uninstall') shArgs.push('--remove-afyx-forge');
  if (effectiveOptions.all && command === 'uninstall') shArgs.push('--all');
  if (effectiveOptions.purgeBackups && command === 'uninstall') shArgs.push('--purge-backups');
  if (effectiveOptions.pruneBackups && command === 'uninstall') shArgs.push('--prune-backups');
  if (effectiveOptions.nonInteractive && command === 'uninstall') shArgs.push('--non-interactive');

  return {
    executable: 'bash',
    args: shArgs,
    scriptPath,
    env,
  };
}

export function executeSubprocess(callInfo, { onExit = null, onOutput = null } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let currentChild = null;
    let resolved = false;

    const cleanupSignalHandlers = () => {
      process.removeListener('SIGINT', handleSigInt);
      process.removeListener('SIGTERM', handleSigTerm);
    };

    const handleSigInt = () => {
      if (currentChild && !currentChild.killed) {
        if (onOutput) currentChild.kill('SIGINT');
      } else {
        process.exit(130);
      }
    };
    const handleSigTerm = () => {
      if (currentChild && !currentChild.killed) currentChild.kill('SIGTERM');
      else process.exit(143);
    };

    process.once('SIGINT', handleSigInt);
    process.once('SIGTERM', handleSigTerm);

    const run = (exe, args) => {
      let child;
      try {
        child = spawn(exe, args, {
          stdio: onOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
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
      if (onOutput) {
        for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
          const decoder = new StringDecoder('utf8');
          const deliver = (text) => {
            if (!text || hasErrored) return;
            try { onOutput(text, name); }
            catch (error) {
              hasErrored = true;
              child.kill('SIGTERM'); cleanupSignalHandlers(); rejectPromise(error);
            }
          };
          stream.on('data', (bytes) => deliver(decoder.write(bytes)));
          stream.on('end', () => deliver(decoder.end()));
        }
      }

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
