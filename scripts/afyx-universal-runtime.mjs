#!/usr/bin/env node

/** Native installed-component discovery and execution for AfyxUniversalInterop/v1. */

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
  DEFAULT_BUDGET_LIMITS,
  executeAfyxCapabilityRoute,
} from './afyx-capability-orchestrator.mjs';
import { createInstalledHostAdapters } from './afyx-host-adapters.mjs';
import { createNativeSkillHostAdapter } from './afyx-native-skill-host.mjs';
import { ACCEPTED_PROVIDERS } from './afyx-modular-runtime.mjs';

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

function inspectGraphIndex(projectRoot, entrypoint, nodePath, environment, timeoutMs = 10_000) {
  // Graph's status command is the authority for ancestor resolution, ownership,
  // extraction compatibility, pending changes and incomplete indexes.
  const result = spawnSync(nodePath, [entrypoint, 'status', projectRoot, '--json'], {
    encoding: 'utf8', windowsHide: true, timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024, env: environment,
  });
  if (result.status !== 0 || result.error) return { indexReady: false, indexFresh: false, initialized: false };
  let status;
  try { status = JSON.parse(result.stdout); } catch { return { indexReady: false, indexFresh: false, initialized: false }; }
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
  } catch { return { indexReady: false, indexFresh: false, initialized: status?.initialized === true }; }
  const indexReady = status.initialized === true && trustedRoot && safeState
    && !status.worktreeMismatch && status.index?.state === 'complete'
    && status.index?.pendingRefs === 0;
  const health = status.health ?? {};
  const indexFresh = Boolean(indexReady && status.index?.reindexRecommended === false
    && health.pendingChanges?.state === 'CURRENT'
    && health.compatibility?.reindexRecommended === false
    && health.gitFreshness?.state !== 'STALE');
  return {
    indexReady: Boolean(indexReady),
    indexFresh,
    indexRoot: indexReady ? indexRoot : null,
    initialized: status.initialized === true,
  };
}

const activeGraphInits = new Map();

function runSafeGraphInit(projectRoot, entrypoint, nodePath, environment, timeoutMs = 15_000) {
  let safeProject;
  try {
    safeProject = realpathSync(projectRoot);
  } catch {
    return { initialized: false, error: 'INVALID_PROJECT_ROOT' };
  }

  if (!safeProject || !existsSync(safeProject) || lstatSync(safeProject).isSymbolicLink()) {
    return { initialized: false, error: 'UNSAFE_WORKSPACE_ROOT' };
  }

  // Check daemon ownership: respect writer.pid if an active daemon is running
  const writerPidFile = join(safeProject, '.afyx-graph', 'writer.pid');
  if (existsSync(writerPidFile)) {
    try {
      const pidData = JSON.parse(readFileSync(writerPidFile, 'utf8'));
      if (pidData?.pid) {
        try {
          process.kill(pidData.pid, 0);
          return { initialized: false, error: 'ACTIVE_DAEMON_PRESENT' };
        } catch {}
      }
    } catch {}
  }

  try {
    const result = spawnSync(nodePath, [entrypoint, 'init', safeProject, '--yes'], {
      cwd: safeProject,
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: environment,
    });
    if (result.status === 0 && !result.error) {
      return { initialized: true };
    }
    return {
      initialized: false,
      error: result.error?.message || (result.stderr || '').trim() || `Exit code ${result.status}`,
    };
  } catch (err) {
    return { initialized: false, error: err.message };
  }
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
  probeGraph = true,
  preparationEvents = [],
  probeTimeoutMs = 10_000,
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
    const override = componentStateOverrides?.[componentId] ?? {};
    const inspectGraph = componentId === 'afyx-graph' && installed && enabled && sourceIdentity !== null &&
      override.healthy !== false && override.compatible !== false && authorizations?.[componentId] === true && probeGraph;
    if (inspectGraph) preparationEvents.push('afyx-graph/status');
    const graph = inspectGraph
      ? inspectGraphIndex(projectRoot, join(root, 'current', 'lib', 'dist', 'bin', 'afyx-graph.js'), nodePath, environment, probeTimeoutMs)
      : (componentId === 'afyx-graph' ? { indexReady: false, indexFresh: false } : {});
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
  const bundledStates = Object.fromEntries(['afyx-native-execution', 'afyx-native-github', 'afyx-security-auditor'].map((id) => [id, {
    installed: true, enabled: componentEnabled(id, componentSettings?.[id], environment), healthy: true, compatible: true,
    authorized: authorizations[id] === true, sourceIdentity: sha256File(fileURLToPath(new URL(`./${id}.mjs`, import.meta.url))), observationSource: 'BUNDLED_HOST_CAPABILITY',
  }]));
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
  trustedCapabilities = {},
  probeGraph = true,
  providerPermissions = {},
  hostAuthorizations = {},
  probeTimeoutMs = 10_000,
} = {}) {
  if (typeof installRoot !== 'string' || !installRoot.trim() ||
      typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new TypeError('installRoot and projectRoot are required non-empty paths');
  }
  const resolvedInstallRoot = resolve(installRoot);
  const resolvedProjectRoot = resolve(projectRoot);
  const preparationEvents = [];
  const graphProbeAuthorized = (provider === null || ACCEPTED_PROVIDERS.includes(provider)) &&
    providerPermissions['afyx-graph'] !== false && providerPermissions['repository-graph-evidence'] !== false &&
    hostAuthorizations[provider] !== false && hostAuthorizations.providers?.[provider] !== false &&
    hostAuthorizations.enabledProviders?.[provider] !== false &&
    (hostAuthorizations.mcpEnabled !== false || hostAuthorizations.cliBypassAllowed === true);
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
    probeGraph: probeGraph && graphProbeAuthorized,
    preparationEvents,
    probeTimeoutMs,
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
  const bundledStates = Object.fromEntries(['afyx-native-execution', 'afyx-native-github', 'afyx-security-auditor'].map((id) => [id, {
    installed: true, enabled: componentEnabled(id, componentSettings?.[id], environment), healthy: true, compatible: true,
    authorized: authorizations[id] === true, sourceIdentity: sha256File(fileURLToPath(new URL(`./${id}.mjs`, import.meta.url))), observationSource: 'BUNDLED_HOST_CAPABILITY',
  }]));
  const adapterOptions = {
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
      trustedCapabilities,
  };
  const hostAdapters = createInstalledHostAdapters(adapterOptions);
  let graphAdapter = hostAdapters['afyx-graph'];
  const adapters = {
    ...hostAdapters,
    'afyx-graph': (...args) => graphAdapter(...args),
    ...dynamic.adapters,
    ...(nativeSkill ? { 'afyx-skill-engineering': nativeSkill.adapter } : {}),
  };
  return Object.freeze({
    contract: AFYX_UNIVERSAL_RUNTIME_CONTRACT,
    installRoot: resolvedInstallRoot,
    projectRoot: resolvedProjectRoot,
    provider,
    providerSkillRoots,
    get preparationEvents() { return Object.freeze([...preparationEvents]); },
    async prepareCapabilityState(componentId, controls = {}) {
      const original = known.states[componentId];
      if (componentId !== 'afyx-graph' || !graphProbeAuthorized || !original?.installed || !original.enabled || !original.authorized) return original;
      const root = known.evidence.find((item) => item.componentId === componentId).root;
      const entrypoint = join(root, 'current/lib/dist/bin/afyx-graph.js');
      preparationEvents.push('afyx-graph/status');
      const timeoutMs = Math.max(1, Math.min(10_000, controls.maxExecutionMs || 10_000));
      let observed = inspectGraphIndex(resolvedProjectRoot, entrypoint, nodePath, environment, timeoutMs);

      // Safe Stale Index Policy: report status, do not silently destroy owner data
      if (observed.indexReady && !observed.indexFresh) {
        const override = componentStateOverrides[componentId] || {};
        if (observed.indexRoot) graphAdapter = createInstalledHostAdapters({ ...adapterOptions, graphIndexRoot: observed.indexRoot })['afyx-graph'];
        return {
          ...original,
          ...observed,
          indexReady: override.indexReady ?? observed.indexReady,
          indexFresh: override.indexFresh ?? observed.indexFresh,
          reindexPolicy: 'SAFE_REPORT_STATUS',
        };
      }

      // Graph installed, workspace uninitialized, explicit relational demand:
      // Initialize just in time before Graph MCP invocation
      const isUninitialized = observed.initialized === false || !observed.indexReady;
      const explicitRelationalDemand = controls.jitInitialize === true || controls.relationalDemand === true;

      if (isUninitialized && explicitRelationalDemand && original.healthy !== false && original.compatible !== false) {
        let canonicalKey;
        try { canonicalKey = realpathSync(resolvedProjectRoot); } catch { canonicalKey = resolvedProjectRoot; }

        let initPromise = activeGraphInits.get(canonicalKey);
        if (!initPromise) {
          preparationEvents.push('afyx-graph/init');
          initPromise = Promise.resolve().then(() => runSafeGraphInit(resolvedProjectRoot, entrypoint, nodePath, environment, Math.min(30_000, controls.maxExecutionMs || 15_000)));
          activeGraphInits.set(canonicalKey, initPromise);
        }

        try {
          const initRes = await initPromise;
          if (initRes.initialized) {
            observed = inspectGraphIndex(resolvedProjectRoot, entrypoint, nodePath, environment, timeoutMs);
          } else {
            observed = { ...observed, jitError: initRes.error, indexReady: false, indexFresh: false };
          }
        } finally {
          activeGraphInits.delete(canonicalKey);
        }
      }

      const override = componentStateOverrides[componentId] || {};
      if (observed.indexRoot) graphAdapter = createInstalledHostAdapters({ ...adapterOptions, graphIndexRoot: observed.indexRoot })['afyx-graph'];
      return { ...original, ...observed, indexReady: override.indexReady ?? observed.indexReady, indexFresh: override.indexFresh ?? observed.indexFresh };
    },
    componentStates: Object.freeze({ ...known.states, ...dynamic.states, ...bundledStates,
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
  const startedAt = performance.now();
  const task = options.task ?? {};
  const routeOptions = {
    task,
    provider: options.provider ?? null,
    providerPermissions: options.providerPermissions ?? {},
    hostAuthorizations: options.hostAuthorizations ?? {},
    userPreferences: options.userPreferences ?? {},
    budgetLimits: options.budgetLimits,
    environment: options.environment ?? process.env,
    hostMetadata: options.hostMetadata,
    loadCapabilityDetails: options.loadCapabilityDetails,
  };
  if (classifyTaskIntent(task, options.hostMetadata).directSource) {
    return executeAfyxCapabilityRoute({
      ...routeOptions,
      componentStates: {},
      adapters: {},
    });
  }
  const classification = classifyTaskIntent(task, options.hostMetadata);
  const exclusive = classification.odoo || classification.forgeAdvice || classification.documentation || classification.usageAnalytics ||
    classification.github || classification.nativeExecution || classification.securityAudit || classification.unknownDomain || classification.ambiguousDomain;
  const runtime = createInstalledAfyxRuntime({ ...options, probeTimeoutMs: Math.max(1, Math.min(10_000, options.budgetLimits?.maxExecutionMs || DEFAULT_BUDGET_LIMITS.maxExecutionMs)),
    probeGraph: options.budgetLimits?.maxToolCalls !== 0 && options.budgetLimits?.maxCapabilities !== 0 &&
    (classification.relational && (!exclusive || task.needsRelationalEvidence === true) ||
    classification.manualSelection.includes('afyx-graph') || classification.customComponentId === 'afyx-graph' ||
    classification.customCapability === 'repository-graph-evidence') });
  try {
    const result = await executeAfyxCapabilityRoute({
      ...routeOptions,
      componentStates: runtime.componentStates,
      adapters: runtime.adapters,
      prepareCapabilityState: runtime.prepareCapabilityState,
      preparationElapsedMs: performance.now() - startedAt,
    });
    return { ...result, metrics: { ...result.metrics, runtimeDiscoveryToolCalls: runtime.preparationEvents.length,
      runtimeDiscoveryInvocations: [...runtime.preparationEvents] } };
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
