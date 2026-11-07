#!/usr/bin/env node

/** Native installed-component discovery and execution for AfyxUniversalInterop/v1. */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyTaskIntent,
  executeAfyxCapabilityRoute,
} from './afyx-capability-orchestrator.mjs';
import { createInstalledHostAdapters } from './afyx-host-adapters.mjs';
import { createNativeSkillHostAdapter } from './afyx-native-skill-host.mjs';

export const AFYX_UNIVERSAL_RUNTIME_CONTRACT = 'AfyxUniversalRuntime/v1';
export const AFYX_COMPONENT_MANIFEST_CONTRACT = 'AfyxComponentManifest/v1';

const COMPONENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const DYNAMIC_PROTOCOL = 'AfyxCapabilityRequest/v1-json-stdio';
const COMPONENT_REGISTRY = JSON.parse(
  readFileSync(new URL('./components.json', import.meta.url), 'utf8'),
);
const HOST_RUNTIME_ENTRYPOINTS = Object.freeze({
  'afyx-graph': Object.freeze(['current/lib/dist/bin/afyx-graph.js']),
});

function splitRequiredFiles(value) {
  return typeof value === 'string' ? value.split(';').filter(Boolean) : [];
}

const KNOWN_LAYOUT = Object.freeze(Object.fromEntries(
  COMPONENT_REGISTRY.components.map((component) => {
    const platformRequired = process.platform === 'win32'
      ? component.required_files_windows
      : component.required_files_unix;
    const required = [
      ...splitRequiredFiles(component.required_files),
      ...splitRequiredFiles(platformRequired),
      ...(HOST_RUNTIME_ENTRYPOINTS[component.id] ?? []),
    ];
    const codexTools = component.type === 'toolset';
    const root = component.type === 'skill'
      ? ['skills', component.install_path]
      : (component.type === 'runtime' ? [component.id.replace(/^afyx-/, '')] : []);
    return [component.id, Object.freeze({
      root: Object.freeze(root),
      required: Object.freeze([...new Set(required)]),
      identity: component.marker_file || component.version_source?.split('#')[0] || required[0],
      codexTools,
    })];
  }),
));

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function metadataIdentity(root, identityFile) {
  const path = join(root, identityFile);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  if (identityFile.endsWith('.json')) {
    const metadata = readJson(path);
    if (!metadata) return null;
    const declared = metadata?.source_revision ?? metadata?.sourceRevision ??
      metadata?.artifact_digest ?? metadata?.artifactDigest ??
      metadata?.requested_checkout_revision;
    if (typeof declared === 'string' && declared.trim() && declared !== 'UNKNOWN') {
      return declared.trim();
    }
  }
  return `sha256:${sha256File(path)}`;
}

function componentEnabled(componentId, settings, environment) {
  if (settings?.enabled === false) return false;
  const envName = `AFYX_${componentId.replaceAll('-', '_').toUpperCase()}_ENABLED`;
  if (String(environment?.[envName] ?? '').trim() === '0') return false;
  if (componentId === 'afyx-context' && String(environment?.AFYX_CONTEXT_OPT_IN ?? '').trim() === '0') {
    return false;
  }
  return true;
}

function inspectGraphIndex(projectRoot, entrypoint, nodePath, environment) {
  // Graph's status command is the authority for ancestor resolution, ownership,
  // extraction compatibility, pending changes and incomplete indexes.
  const result = spawnSync(nodePath, [entrypoint, 'status', projectRoot, '--json'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024, env: environment,
  });
  if (result.status !== 0 || result.error) return { indexReady: false, indexFresh: false };
  let status;
  try { status = JSON.parse(result.stdout); } catch { return { indexReady: false, indexFresh: false }; }
  let indexRoot;
  let trustedRoot = false;
  let safeState = false;
  try {
    indexRoot = status.projectPath && resolve(status.projectPath);
    const project = realpathSync(projectRoot);
    // Only the project or its immediate workspace parent may own an implicit index.
    // Reject aliases, unrelated worktrees and reparse-point state directories.
    trustedRoot = Boolean(indexRoot && [project, resolve(project, '..')].includes(indexRoot)
      && realpathSync(indexRoot) === indexRoot);
    const statePath = status.indexPath && resolve(status.indexPath);
    const database = statePath && join(statePath, 'afyx-graph.db');
    safeState = Boolean(statePath && existsSync(statePath)
      && !lstatSync(statePath).isSymbolicLink()
      && realpathSync(statePath) === statePath
      && database && existsSync(database) && lstatSync(database).isFile());
  } catch { return { indexReady: false, indexFresh: false }; }
  const indexReady = status.initialized === true && trustedRoot && safeState
    && !status.worktreeMismatch && status.index?.state === 'complete'
    && status.index?.pendingRefs === 0;
  const health = status.health ?? {};
  const indexFresh = Boolean(indexReady && status.index?.reindexRecommended === false
    && health.pendingChanges?.state === 'CURRENT'
    && health.compatibility?.reindexRecommended === false
    && health.gitFreshness?.state !== 'STALE');
  return { indexReady: Boolean(indexReady), indexFresh, indexRoot: indexReady ? indexRoot : null };
}

function skillRootFor(provider, componentId, providerSkillRoots) {
  const explicit = providerSkillRoots?.[provider];
  const base = explicit ?? (provider === 'codex' ? join(homedir(), '.agents', 'skills')
    : provider === 'antigravity' ? join(homedir(), '.gemini', 'config', 'skills')
      : provider === 'antigravity-cli' ? join(homedir(), '.gemini', 'antigravity-cli', 'skills') : null);
  return base ? join(resolve(base), componentId) : null;
}

function ownedSkill(root, componentId) {
  if (!root || !existsSync(root) || lstatSync(root).isSymbolicLink()) return false;
  const marker = readJson(join(root, '.afyx-install.json'));
  if (marker?.schema !== 1 || marker.product !== 'Afyx Codex Engineering Kit'
    || marker.component !== componentId || marker.owner !== 'afyx'
    || !/^[0-9a-f]{64}$/.test(marker.content_sha256 ?? '')) return false;
  const files = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.afyx-install.json' || entry.name === '.git') continue;
      const path = join(dir, entry.name);
      if (lstatSync(path).isSymbolicLink()) throw new Error('UNSAFE_SKILL_REPARSE_POINT');
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  try { visit(root); } catch { return false; }
  files.sort((a, b) => {
    const left = a.toUpperCase();
    const right = b.toUpperCase();
    return left < right ? -1 : (left > right ? 1 : 0);
  });
  const lines = files.map((path) => `${sha256File(path).toUpperCase()}  ./${relative(root, path).replaceAll('\\', '/')}`);
  const digest = createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
  return digest === marker.content_sha256;
}

function inspectKnownComponents({
  installRoot,
  projectRoot,
  provider,
  providerSkillRoots,
  codexToolsRoot,
  nodePath,
  componentSettings,
  authorizations,
  environment,
  componentStateOverrides,
}) {
  const states = {};
  const evidence = [];
  for (const [componentId, layout] of Object.entries(KNOWN_LAYOUT)) {
    const providerRoot = layout.root[0] === 'skills'
      ? skillRootFor(provider, componentId, providerSkillRoots) : null;
    const root = layout.codexTools
      ? codexToolsRoot
      : (providerRoot && existsSync(providerRoot) ? providerRoot : join(installRoot, ...layout.root));
    const requiredPaths = root
      ? layout.required.map((item) => join(root, ...item.split('/')))
      : [];
    const installed = Boolean(root) && (!providerRoot || root !== providerRoot || ownedSkill(root, componentId))
      && requiredPaths.every((path) => existsSync(path) && statSync(path).isFile());
    const sourceIdentity = installed ? metadataIdentity(root, layout.identity) : null;
    const enabled = installed && componentEnabled(
      componentId,
      componentSettings?.[componentId],
      environment,
    );
    const graph = componentId === 'afyx-graph' && installed
      ? inspectGraphIndex(projectRoot, join(root, 'current', 'lib', 'dist', 'bin', 'afyx-graph.js'), nodePath, environment)
      : (componentId === 'afyx-graph' ? { indexReady: false, indexFresh: false } : {});
    const override = componentStateOverrides?.[componentId] ?? {};
    states[componentId] = {
      installed,
      enabled,
      healthy: installed && override.healthy !== false,
      compatible: installed && override.compatible !== false,
      authorized: authorizations?.[componentId] === true,
      sourceIdentity: installed
        ? (typeof override.sourceIdentity === 'string' ? override.sourceIdentity : sourceIdentity)
        : null,
      observationSource: override.observationSource ?? 'NATIVE_FILESYSTEM_DISCOVERY',
      ...graph,
      ...(componentId === 'afyx-graph' ? {
        indexReady: override.indexReady ?? graph.indexReady,
        indexFresh: override.indexFresh ?? graph.indexFresh,
      } : {}),
    };
    evidence.push(Object.freeze({
      componentId,
      root,
      requiredFiles: Object.freeze(requiredPaths),
      installed,
      sourceIdentity,
    }));
  }
  return { states, evidence };
}

function dynamicAdapter(entrypoint, nodePath) {
  return async (request) => {
    const result = spawnSync(nodePath, [entrypoint], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      windowsHide: true,
      timeout: Math.min(60_000, Math.max(1, request.budgetLimits?.maxExecutionMs ?? 5_000)),
      maxBuffer: Math.min(
        16 * 1_048_576,
        Math.max(1_048_576, request.budgetLimits?.maxContextBytes ?? 65_536),
      ),
    });
    if (result.error || result.status !== 0) {
      return {
        status: 'FAILED',
        reason: result.error?.message || result.stderr?.trim() || `Exit code ${result.status}`,
        output: null,
      };
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      return { status: 'FAILED', reason: 'INVALID_COMPONENT_JSON_RESULT', output: null };
    }
  };
}

function discoverDynamicComponents({
  installRoot,
  componentSettings,
  authorizations,
  environment,
  nodePath,
}) {
  const componentsRoot = join(installRoot, 'components');
  const states = {};
  const adapters = {};
  const evidence = [];
  if (!existsSync(componentsRoot) || !statSync(componentsRoot).isDirectory()) {
    return { states, adapters, evidence };
  }

  for (const entry of readdirSync(componentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !COMPONENT_ID_PATTERN.test(entry.name)) continue;
    const root = join(componentsRoot, entry.name);
    const manifestPath = join(root, 'afyx-component.json');
    const manifest = readJson(manifestPath);
    const relativeEntrypoint = manifest?.runtime?.entrypoint;
    const entrypoint = typeof relativeEntrypoint === 'string'
      ? resolve(root, relativeEntrypoint)
      : null;
    const rootRealPath = realpathSync(root);
    const entrypointRealPath = entrypoint && existsSync(entrypoint)
      ? realpathSync(entrypoint)
      : null;
    const valid = !Object.hasOwn(KNOWN_LAYOUT, entry.name) &&
      manifest?.contract === AFYX_COMPONENT_MANIFEST_CONTRACT &&
      manifest.id === entry.name && manifest.ownershipClass === 'AFYX' &&
      typeof manifest.primaryCapability === 'string' && manifest.primaryCapability.length > 0 &&
      manifest.runtime?.protocol === DYNAMIC_PROTOCOL && entrypoint !== null &&
      entrypointRealPath !== null && isWithin(rootRealPath, entrypointRealPath) &&
      statSync(entrypointRealPath).isFile();
    if (!valid) {
      evidence.push(Object.freeze({
        componentId: entry.name,
        root,
        installed: false,
        reason: 'INVALID_COMPONENT_MANIFEST',
      }));
      continue;
    }

    const sourceIdentity = typeof manifest.sourceIdentity === 'string' && manifest.sourceIdentity
      ? manifest.sourceIdentity
      : `sha256:${sha256File(manifestPath)}`;
    states[manifest.id] = {
      installed: true,
      enabled: componentEnabled(manifest.id, componentSettings?.[manifest.id], environment),
      healthy: true,
      compatible: true,
      authorized: authorizations?.[manifest.id] === true,
      sourceIdentity,
      observationSource: 'NATIVE_COMPONENT_MANIFEST',
      canonicalName: manifest.canonicalName ?? manifest.id,
      type: manifest.type ?? 'runtime',
      capability: manifest.primaryCapability,
      domainAuthority: manifest.domainAuthority ?? `${manifest.id} authoritative domain`,
      ownershipClass: manifest.ownershipClass,
    };
    adapters[manifest.id] = dynamicAdapter(entrypointRealPath, nodePath);
    evidence.push(Object.freeze({
      componentId: manifest.id,
      root,
      manifestPath,
      entrypoint: entrypointRealPath,
      installed: true,
      sourceIdentity,
    }));
  }
  return { states, adapters, evidence };
}

/** Discover installed components and construct executable host adapters. */
export function createInstalledAfyxRuntime({
  installRoot,
  projectRoot,
  provider = null,
  providerSkillRoots = {},
  stateRoot = null,
  codexToolsRoot = null,
  componentSettings = {},
  authorizations = {},
  componentStateOverrides = {},
  environment = process.env,
  nodePath = process.execPath,
  trustedSkillEngineering = null,
} = {}) {
  if (typeof installRoot !== 'string' || !installRoot.trim() ||
      typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new TypeError('installRoot and projectRoot are required non-empty paths');
  }
  const resolvedInstallRoot = resolve(installRoot);
  const resolvedProjectRoot = resolve(projectRoot);
  // Usage Tracking is a Codex/Windows toolset installed under the provider's
  // tools root, outside the shared AFYX runtime directory.
  const resolvedToolsRoot = provider === 'codex' && process.platform === 'win32'
    ? resolve(codexToolsRoot ?? join(homedir(), '.codex', 'tools')) : null;
  const known = inspectKnownComponents({
    installRoot: resolvedInstallRoot,
    projectRoot: resolvedProjectRoot,
    provider,
    providerSkillRoots,
    codexToolsRoot: resolvedToolsRoot,
    nodePath,
    componentSettings,
    authorizations,
    environment,
    componentStateOverrides,
  });
  const dynamic = discoverDynamicComponents({
    installRoot: resolvedInstallRoot,
    componentSettings,
    authorizations,
    environment,
    nodePath,
  });
  // A native skill adapter exists only when a trusted in-process host supplies
  // the complete write plan and a callable owner-approval boundary. Never infer
  // this from an agent task or the general AFYX source inventory.
  if (trustedSkillEngineering && trustedSkillEngineering.provider !== provider) {
    throw new Error('TRUSTED_SKILL_PROVIDER_MISMATCH');
  }
  const nativeSkill = trustedSkillEngineering
    ? createNativeSkillHostAdapter(trustedSkillEngineering) : null;
  const nativeSkillState = nativeSkill ? {
    installed: true,
    enabled: componentEnabled('afyx-skill-engineering', componentSettings?.['afyx-skill-engineering'], environment),
    healthy: true, compatible: true,
    authorized: authorizations?.['afyx-skill-engineering'] === true,
    sourceIdentity: nativeSkill.sourceIdentity,
    observationSource: 'TRUSTED_HOST_ADAPTER',
  } : null;
  const adapters = {
    ...createInstalledHostAdapters({
      installRoot: resolvedInstallRoot,
      projectRoot: resolvedProjectRoot,
      graphIndexRoot: known.states['afyx-graph']?.indexRoot ?? null,
      skillRoots: Object.fromEntries(known.evidence
        .filter((item) => KNOWN_LAYOUT[item.componentId]?.root[0] === 'skills' && item.installed)
        .map((item) => [item.componentId, item.root])),
      stateRoot,
      codexToolsRoot: resolvedToolsRoot,
      nodePath,
      environment,
    }),
    ...dynamic.adapters,
    ...(nativeSkill ? { 'afyx-skill-engineering': nativeSkill.adapter } : {}),
  };
  return Object.freeze({
    contract: AFYX_UNIVERSAL_RUNTIME_CONTRACT,
    installRoot: resolvedInstallRoot,
    projectRoot: resolvedProjectRoot,
    provider,
    providerSkillRoots,
    componentStates: Object.freeze({ ...known.states, ...dynamic.states,
      ...(nativeSkillState ? { 'afyx-skill-engineering': nativeSkillState } : {}) }),
    adapters: Object.freeze(adapters),
    discoveryEvidence: Object.freeze([...known.evidence, ...dynamic.evidence,
      ...(nativeSkill ? [Object.freeze({ componentId: 'afyx-skill-engineering',
        installed: true, sourceIdentity: nativeSkill.sourceIdentity,
        observationSource: 'TRUSTED_HOST_ADAPTER' })] : [])]),
    dispose() {},
  });
}

/** Discover, select, and execute only the capabilities justified by one task. */
export async function runInstalledAfyxWorkflow(options = {}) {
  const task = options.task ?? {};
  const routeOptions = {
    task,
    provider: options.provider ?? null,
    providerPermissions: options.providerPermissions ?? {},
    hostAuthorizations: options.hostAuthorizations ?? {},
    userPreferences: options.userPreferences ?? {},
    budgetLimits: options.budgetLimits,
    environment: options.environment ?? process.env,
  };
  if (classifyTaskIntent(task).directSource) {
    return executeAfyxCapabilityRoute({
      ...routeOptions,
      componentStates: {},
      adapters: {},
    });
  }
  const runtime = createInstalledAfyxRuntime(options);
  try {
    return await executeAfyxCapabilityRoute({
      ...routeOptions,
      componentStates: runtime.componentStates,
      adapters: runtime.adapters,
    });
  } finally {
    runtime.dispose();
  }
}

export {
  AFYX_HOST_BRIDGE_CONTRACT,
  invokeHostWorkflow,
  serveHostMcpBridge,
} from './afyx-host-bridge.mjs';

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

async function main() {
  if (process.argv.includes('--mcp') || (process.argv.includes('serve') && process.argv.includes('--mcp'))) {
    const { serveHostMcpBridge } = await import('./afyx-host-bridge.mjs');
    const installRoot = argumentValue('--install-root');
    const projectRoot = argumentValue('--project-root');
    const provider = argumentValue('--provider') || 'antigravity';
    serveHostMcpBridge({ installRoot, projectRoot, provider });
    return;
  }

  const installRoot = argumentValue('--install-root') || process.env.AFYX_INSTALL_ROOT;
  const projectRoot = argumentValue('--project-root') || process.cwd();
  const taskFile = argumentValue('--task-file');
  const taskArg = argumentValue('--task');
  const provider = argumentValue('--provider');
  const authorizedIds = new Set((argumentValue('--authorize') ?? '').split(',').filter(Boolean));
  if (!installRoot || !projectRoot || (!taskFile && !taskArg)) {
    throw new Error('--install-root, --project-root, and either --task-file or --task are required');
  }
  let task = null;
  if (taskArg) {
    task = JSON.parse(taskArg);
  } else if (taskFile === '-') {
    task = JSON.parse(readFileSync(0, 'utf8'));
  } else {
    task = JSON.parse(readFileSync(resolve(taskFile), 'utf8'));
  }
  const authorizations = Object.fromEntries([...authorizedIds].map((id) => [id, true]));
  const result = await runInstalledAfyxWorkflow({
    installRoot,
    projectRoot,
    task,
    provider,
    authorizations,
    providerPermissions: authorizations,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'FAILED' || result.status === 'BLOCKED') process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
