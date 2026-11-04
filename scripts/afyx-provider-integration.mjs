#!/usr/bin/env node
/** Provider-aware, consent-safe Afyx Graph MCP lifecycle. */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { integrate as integrateCodex, probeMcp } from './afyx-mcp-integration.mjs';
import { inspectClaude, integrateClaude } from './afyx-claude-integration.mjs';
import {
  discoverProviderCapabilities,
  negotiateProviderCapabilities,
} from './afyx-integration-contracts.mjs';

const SERVER = 'afyx_graph';
const COMPONENT_CONTRACT = JSON.parse(readFileSync(fileURLToPath(new URL('./components.json', import.meta.url)), 'utf8'));
const PROVIDER_DEFINITIONS = new Map(COMPONENT_CONTRACT.providers.map((definition) => [definition.provider, definition]));

export const PROVIDER_ADAPTER_CONTRACT = Object.freeze({
  name: 'ProviderAdapter',
  version: 1,
  operations: Object.freeze(['inspect', 'plan', 'apply', 'verify', 'uninstall']),
});

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizedPath(value) {
  const absolute = canonicalPath(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function canonicalPath(value) {
  const absolute = resolve(String(value || ''));
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}

function entryEquivalent(actual, expected) {
  return actual && typeof actual === 'object' && !Array.isArray(actual)
    && normalizedPath(actual.command) === normalizedPath(expected.command)
    && Array.isArray(actual.args) && actual.args.length === 3
    && normalizedPath(actual.args[0]) === normalizedPath(expected.args[0])
    && actual.args[1] === 'serve' && actual.args[2] === '--mcp';
}

function inside(base, candidate) {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertSafePath(base, candidate) {
  if (!inside(base, candidate)) throw new Error(`PROVIDER_PATH_OUTSIDE_SCOPE: ${candidate}`);
  const boundary = resolve(base);
  let cursor = resolve(candidate);
  for (;;) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`PROVIDER_PATH_REPARSE_BLOCKED: ${cursor}`);
    }
    if (cursor === boundary) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function parseObject(file, optional = true) {
  if (!existsSync(file)) {
    if (optional) return {};
    throw new Error(`PROVIDER_FILE_MISSING: ${file}`);
  }
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`PROVIDER_INVALID_JSON: ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`PROVIDER_INVALID_JSON_ROOT: ${file}`);
  }
  return value;
}

function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.afyx-tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function snapshot(file) {
  return existsSync(file) ? readFileSync(file) : null;
}

function restore(file, bytes) {
  if (bytes === null) rmSync(file, { force: true });
  else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
}

function restoreGuarded(file, before, lastKnown) {
  if (!sameBytes(snapshot(file), lastKnown)) return false;
  restore(file, before);
  return sameBytes(snapshot(file), before);
}

function antigravityPaths(options) {
  const scope = options.scope || 'global';
  if (scope === 'workspace') {
    const base = resolve(options.workspaceRoot);
    return { base, config: resolve(base, '.agents', 'mcp_config.json') };
  }
  if (scope !== 'global') throw new Error(`PROVIDER_SCOPE_UNSUPPORTED: ${scope}`);
  const base = resolve(options.geminiHome || resolve(homedir(), '.gemini'));
  return { base, config: resolve(base, 'config', 'mcp_config.json') };
}

function expectedEntry(options) {
  return { command: canonicalPath(options.node), args: [canonicalPath(options.entry), 'serve', '--mcp'] };
}

function inspectAntigravity(options) {
  const paths = antigravityPaths(options);
  const ownership = `${paths.config}.afyx-ownership.json`;
  assertSafePath(paths.base, paths.config);
  assertSafePath(paths.base, ownership);
  const document = parseObject(paths.config);
  if (document.mcpServers !== undefined && (!document.mcpServers || Array.isArray(document.mcpServers) || typeof document.mcpServers !== 'object')) {
    throw new Error(`PROVIDER_INVALID_MCP_SERVERS: ${paths.config}`);
  }
  const marker = parseObject(ownership);
  if ((options.scope || 'global') === 'global') {
    const legacy = resolve(options.geminiHome || resolve(homedir(), '.gemini'), 'antigravity', 'mcp_config.json');
    assertSafePath(paths.base, legacy);
    const legacyDocument = parseObject(legacy);
    if (legacyDocument.mcpServers?.[SERVER]) {
      return { paths, ownership, document, marker, actual: null, expected: expectedEntry(options), claim: null, state: 'MCP_BLOCKED_LEGACY_DUPLICATE', owned: false, legacy };
    }
  }
  const actual = document.mcpServers?.[SERVER] ?? null;
  const expected = expectedEntry(options);
  const claim = marker.entries?.[SERVER] ?? null;
  const claimValid = claim?.provider === 'antigravity' && resolve(claim.configPath || '') === paths.config;
  let state = 'MCP_NOT_CONFIGURED';
  let owned = false;
  if (actual) {
    if (entryEquivalent(actual, expected)) {
      state = claimValid && same(claim.entry, actual) ? 'MCP_CONFIGURED' : 'MCP_CONFIGURED_UNOWNED';
      owned = state === 'MCP_CONFIGURED';
    } else if (claimValid && same(claim.entry, actual)) {
      state = 'MCP_STALE_OWNED';
      owned = true;
    } else {
      state = 'MCP_BLOCKED';
    }
  }
  return { paths, ownership, document, marker, actual, expected, claim, state, owned };
}

function planForAntigravity(options, inspection) {
  const action = options.uninstall
    ? (inspection.state === 'MCP_NOT_CONFIGURED' ? 'NONE' : inspection.owned ? 'REMOVE' : 'PRESERVE_FOREIGN')
    : (inspection.state === 'MCP_NOT_CONFIGURED' ? 'CREATE' : inspection.state === 'MCP_STALE_OWNED' ? 'UPDATE' : 'NONE');
  return {
    provider: 'antigravity',
    scope: options.scope,
    configPath: inspection.paths.config,
    ownershipPath: inspection.ownership,
    state: inspection.state,
    action,
  };
}

export async function integrateAntigravity(options) {
  let inspection;
  try {
    inspection = inspectAntigravity(options);
  } catch (error) {
    return { provider: 'antigravity', status: 'BLOCKED', changed: false, reason: 'INSPECTION_FAILED', detail: error instanceof Error ? error.message : String(error) };
  }
  const plan = planForAntigravity(options, inspection);
  const result = { ...plan, status: 'CONFIGURED_RESTART_REQUIRED', changed: false, reason: '', detail: '' };
  if (inspection.state === 'MCP_BLOCKED' || inspection.state === 'MCP_BLOCKED_LEGACY_DUPLICATE') {
    const legacy = inspection.state === 'MCP_BLOCKED_LEGACY_DUPLICATE';
    return { ...result, status: 'BLOCKED', reason: legacy ? 'LEGACY_DUPLICATE' : 'FOREIGN_ENTRY', detail: legacy ? `Legacy afyx_graph entry at ${inspection.legacy} was preserved; resolve it explicitly before unified registration.` : 'Existing unowned afyx_graph entry was preserved.' };
  }
  if (options.uninstall) {
    if (inspection.state === 'MCP_NOT_CONFIGURED') return { ...result, status: 'UNAVAILABLE', detail: 'No provider entry is configured.' };
    if (!inspection.owned) return { ...result, status: 'BLOCKED', reason: 'UNOWNED_ENTRY', detail: 'Matching but unowned entry was preserved.' };
    if (!options.apply) return { ...result, status: 'CONFIGURED', detail: 'Removal is planned but not consented.' };
    const configBefore = snapshot(inspection.paths.config);
    const markerBefore = snapshot(inspection.ownership);
    let configKnown = configBefore;
    let markerKnown = markerBefore;
    try {
      delete inspection.document.mcpServers[SERVER];
      if (Object.keys(inspection.document.mcpServers).length === 0) delete inspection.document.mcpServers;
      if (inspection.marker.entries) {
        delete inspection.marker.entries[SERVER];
        if (Object.keys(inspection.marker.entries).length === 0) delete inspection.marker.entries;
      }
      atomicJson(inspection.paths.config, inspection.document);
      configKnown = snapshot(inspection.paths.config);
      if (inspection.marker.entries) atomicJson(inspection.ownership, inspection.marker);
      else rmSync(inspection.ownership, { force: true });
      markerKnown = snapshot(inspection.ownership);
      const after = inspectAntigravity(options);
      if (after.state !== 'MCP_NOT_CONFIGURED') throw new Error('Provider removal read-back failed.');
      return { ...result, status: 'UNAVAILABLE', changed: true, detail: 'Owned provider entry removed; unrelated configuration preserved.' };
    } catch (error) {
      const configRestored = restoreGuarded(inspection.paths.config, configBefore, configKnown);
      const markerRestored = restoreGuarded(inspection.ownership, markerBefore, markerKnown);
      const restored = configRestored && markerRestored;
      return {
        ...result,
        status: 'BLOCKED',
        changed: !restored,
        reason: restored ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_INCOMPLETE',
        detail: `${error instanceof Error ? error.message : String(error)}${restored ? '' : ' Exact-byte rollback was refused because provider state changed outside the last known Afyx mutation.'}`,
      };
    }
  }
  if (!existsSync(options.node) || !existsSync(options.entry)) {
    return { ...result, status: 'BLOCKED', reason: 'GRAPH_RUNTIME_UNAVAILABLE', detail: 'Absolute Node.js or Graph MCP entry is unavailable.' };
  }
  if (!options.apply && ['MCP_NOT_CONFIGURED', 'MCP_STALE_OWNED'].includes(inspection.state)) {
    return { ...result, status: 'DETECTED', detail: 'Configuration change is planned but not consented.' };
  }
  const probe = await probeMcp(resolve(options.node), resolve(options.entry));
  if (!probe.ok) return { ...result, status: 'BLOCKED', reason: 'MCP_HANDSHAKE_FAILED', detail: probe.detail };
  if (options.apply && ['MCP_NOT_CONFIGURED', 'MCP_STALE_OWNED'].includes(inspection.state)) {
    const configBefore = snapshot(inspection.paths.config);
    const markerBefore = snapshot(inspection.ownership);
    let configKnown = configBefore;
    let markerKnown = markerBefore;
    try {
      inspection.document.mcpServers ||= {};
      inspection.document.mcpServers[SERVER] = inspection.expected;
      inspection.marker.schemaVersion = 1;
      inspection.marker.entries ||= {};
      inspection.marker.entries[SERVER] = {
        provider: 'antigravity',
        configPath: inspection.paths.config,
        entry: inspection.expected,
      };
      atomicJson(inspection.paths.config, inspection.document);
      configKnown = snapshot(inspection.paths.config);
      atomicJson(inspection.ownership, inspection.marker);
      markerKnown = snapshot(inspection.ownership);
      const after = inspectAntigravity(options);
      if (after.state !== 'MCP_CONFIGURED' || !after.owned) throw new Error('Provider configuration read-back failed.');
      result.changed = true;
    } catch (error) {
      const configRestored = restoreGuarded(inspection.paths.config, configBefore, configKnown);
      const markerRestored = restoreGuarded(inspection.ownership, markerBefore, markerKnown);
      const restored = configRestored && markerRestored;
      return {
        ...result,
        status: 'BLOCKED',
        changed: !restored,
        reason: restored ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_INCOMPLETE',
        detail: `${error instanceof Error ? error.message : String(error)}${restored ? '' : ' Exact-byte rollback was refused because provider state changed outside the last known Afyx mutation.'}`,
      };
    }
  }
  result.status = options.scope === 'global' ? 'CONFIGURED_RESTART_REQUIRED' : 'READY';
  result.detail = `${probe.detail} Provider configuration read-back matched the absolute runtime entry.`;
  return result;
}

async function integrateCodexAdapter(options) {
  if (options.scope !== 'global') {
    return {
      provider: 'codex', status: 'INCOMPATIBLE', changed: false,
      reason: 'SCOPE_UNSUPPORTED',
      detail: 'Codex adapter currently supports its user-scoped native CLI configuration.',
    };
  }
  const codex = await integrateCodex({
    node: resolve(options.node), entry: resolve(options.entry), codex: options.codex,
    codexHome: resolve(options.codexHome), apply: Boolean(options.apply), uninstall: Boolean(options.uninstall),
    providerTimeoutMs: options.providerTimeoutMs,
  });
  return {
    provider: 'codex',
    status: codex.mcp === 'MCP_REACHABLE' ? 'READY'
      : codex.mcp === 'MCP_NOT_CONFIGURED' ? (options.uninstall ? 'UNAVAILABLE' : 'DETECTED')
        : options.uninstall && codex.mcp === 'MCP_CONFIGURED' ? 'CONFIGURED'
        : 'BLOCKED',
    configPath: resolve(options.codexHome, 'config.toml'),
    ownershipPath: resolve(options.codexHome, '.afyx-provider-ownership.json'),
    ...codex,
  };
}

function defineProviderAdapter(provider, scopes, execute) {
  const definition = PROVIDER_DEFINITIONS.get(provider);
  const invoke = (operation, options) => {
    const lifecycle = {
      ...options,
      operation,
      apply: operation === 'apply' || (operation === 'uninstall' && Boolean(options.apply)),
      uninstall: operation === 'uninstall',
    };
    return execute(lifecycle);
  };
  const capabilities = Object.freeze({
    scopes: Object.freeze([...scopes]),
    operations: PROVIDER_ADAPTER_CONTRACT.operations,
    configurationPolicy: 'merge-afyx-owned-entries-only',
  });
  const observeHost = (options = {}) => {
    if (options.host !== undefined) return options.host;
    const candidate = provider === 'codex' ? options.codex
      : provider === 'claude' ? options.claude : options.antigravity;
    if (!candidate) return undefined;
    return {
      detected: existsSync(candidate),
      command: basename(candidate),
      version: options.hostVersion ?? null,
      evidence: 'FILESYSTEM',
    };
  };
  const discover = (options = {}) => discoverProviderCapabilities(definition, capabilities, { host: observeHost(options) });
  return Object.freeze({
    provider,
    contract: PROVIDER_ADAPTER_CONTRACT,
    capabilities,
    discover,
    negotiate: (requirements, options = {}) => negotiateProviderCapabilities(discover(options), requirements),
    inspect: (options) => invoke('inspect', options),
    plan: (options) => invoke('plan', options),
    apply: (options) => invoke('apply', options),
    verify: (options) => invoke('verify', options),
    uninstall: (options) => invoke('uninstall', options),
  });
}

export const providerAdapters = Object.freeze({
  codex: defineProviderAdapter('codex', ['global'], integrateCodexAdapter),
  antigravity: defineProviderAdapter('antigravity', ['global', 'workspace'], integrateAntigravity),
  claude: defineProviderAdapter('claude', ['global', 'workspace'], integrateClaude),
});

export function getProviderAdapter(provider) {
  return Object.hasOwn(providerAdapters, provider) ? providerAdapters[provider] : null;
}

function unsupportedScopeResult(provider, scope) {
  return {
    provider, status: 'INCOMPATIBLE', changed: false, reason: 'SCOPE_UNSUPPORTED',
    detail: provider === 'codex'
      ? 'Codex adapter currently supports its user-scoped native CLI configuration.'
      : `Provider ${provider} does not support the requested ${scope} scope.`,
  };
}

function prevalidateProviderSelection(selected, scope) {
  return selected.map((provider) => {
    const adapter = getProviderAdapter(provider);
    if (!adapter) {
      return {
        provider,
        adapter: null,
        failure: { provider, status: 'BLOCKED', changed: false, reason: 'UNKNOWN_PROVIDER', detail: `Unknown provider: ${provider}` },
      };
    }
    if (!adapter.capabilities.scopes.includes(scope)) {
      return { provider, adapter, failure: unsupportedScopeResult(provider, scope) };
    }
    return { provider, adapter, failure: null };
  });
}

function prevalidationBlockedResult(provider) {
  return {
    provider, status: 'BLOCKED', changed: false, reason: 'PREVALIDATION_FAILED',
    detail: 'No provider mutation was executed because the selected provider set failed prevalidation.',
  };
}

function sameBytes(left, right) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function providerRecoveryFiles(provider, options) {
  if (provider === 'codex') {
    const base = resolve(options.codexHome);
    const files = [resolve(base, 'config.toml'), resolve(base, '.afyx-provider-ownership.json')];
    for (const file of files) assertSafePath(base, file);
    return { base, files };
  }
  if (provider === 'antigravity') {
    const inspection = inspectAntigravity(options);
    return { base: inspection.paths.base, files: [inspection.paths.config, inspection.ownership] };
  }
  if (provider === 'claude') {
    const inspection = inspectClaude(options);
    return { base: inspection.paths.base, files: [inspection.paths.config, inspection.paths.ownership] };
  }
  throw new Error(`UNKNOWN_PROVIDER: ${provider}`);
}

function captureProviderState(provider, options) {
  const recovery = providerRecoveryFiles(provider, options);
  return {
    provider,
    base: recovery.base,
    files: recovery.files.map((file) => ({ file, before: snapshot(file), after: null })),
  };
}

function sealProviderState(capture) {
  let changed = false;
  for (const item of capture.files) {
    item.after = snapshot(item.file);
    changed ||= !sameBytes(item.before, item.after);
  }
  return changed;
}

function rollbackProviderState(capture) {
  try {
    for (const item of capture.files) {
      assertSafePath(capture.base, item.file);
      if (!sameBytes(snapshot(item.file), item.after)) {
        return { status: 'INCOMPLETE', detail: 'Configuration changed after provider execution; exact-byte rollback was refused.' };
      }
    }
    for (const item of [...capture.files].reverse()) restore(item.file, item.before);
    if (capture.files.some((item) => !sameBytes(snapshot(item.file), item.before))) {
      return { status: 'INCOMPLETE', detail: 'Configuration rollback read-back did not match the captured state.' };
    }
    return { status: 'RESTORED', detail: 'Owned configuration changes were restored to the exact captured bytes.' };
  } catch (error) {
    return { status: 'INCOMPLETE', detail: `Configuration rollback failed closed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function validateRecoveryPathIsolation(captures) {
  const owners = new Map();
  for (const capture of captures) {
    for (const item of capture.files) {
      const key = normalizedPath(item.file);
      const owner = owners.get(key);
      if (owner && owner !== capture.provider) {
        throw new Error(`RECOVERY_PATH_CONFLICT: ${owner} and ${capture.provider}`);
      }
      owners.set(key, capture.provider);
    }
  }
}

function operationSucceeded(result, uninstall) {
  const accepted = uninstall
    ? new Set(['UNAVAILABLE'])
    : new Set(['READY', 'CONFIGURED_RESTART_REQUIRED']);
  return accepted.has(result.status);
}

function aggregateStatus(results, uninstall = false) {
  if (results.some((item) => item.status === 'BLOCKED')) return 'BLOCKED';
  if (uninstall) {
    return results.every((item) => item.status === 'UNAVAILABLE') ? 'READY' : 'PARTIAL';
  }
  return results.some((item) => item.status === 'CONFIGURED_RESTART_REQUIRED') ? 'CONFIGURED_RESTART_REQUIRED'
    : results.every((item) => item.status === 'READY') ? 'READY' : 'PARTIAL';
}

function recoveryBlockedResult(provider, reason, detail) {
  return { provider, status: 'BLOCKED', changed: false, reason, detail };
}

async function runTransactionalLifecycle(options, selection) {
  const operation = options.uninstall ? 'uninstall' : 'apply';
  const preflightOperation = options.uninstall ? 'uninstall' : 'plan';
  const preflightOptions = { ...options, apply: false };
  const preflights = [];
  for (const item of selection) preflights.push(await item.adapter[preflightOperation](preflightOptions));
  const failedPreflight = preflights.findIndex((result) => ['BLOCKED', 'INCOMPATIBLE'].includes(result.status));
  if (failedPreflight >= 0) {
    return {
      providers: selection.map((item, index) => ['BLOCKED', 'INCOMPATIBLE'].includes(preflights[index].status)
        ? preflights[index]
        : recoveryBlockedResult(item.provider, 'PREFLIGHT_FAILED', 'No provider mutation was executed because cross-provider preflight failed.')),
      status: 'BLOCKED',
      recovery: { status: 'NOT_STARTED', failedProvider: selection[failedPreflight].provider },
    };
  }

  const captures = [];
  try {
    for (const item of selection) captures.push(captureProviderState(item.provider, options));
    validateRecoveryPathIsolation(captures);
  } catch (error) {
    return {
      providers: selection.map((item) => recoveryBlockedResult(
        item.provider,
        'RECOVERY_SNAPSHOT_FAILED',
        `No provider mutation was executed: ${error instanceof Error ? error.message : String(error)}`,
      )),
      status: 'BLOCKED',
      recovery: { status: 'NOT_STARTED' },
    };
  }

  const results = [];
  const changedIndexes = [];
  for (let index = 0; index < selection.length; index += 1) {
    const item = selection[index];
    let result;
    try {
      result = await item.adapter[operation](options);
    } catch (error) {
      result = recoveryBlockedResult(item.provider, 'PROVIDER_EXECUTION_FAILED', error instanceof Error ? error.message : String(error));
    }
    const observedChanged = sealProviderState(captures[index]);
    if (observedChanged !== Boolean(result.changed)) {
      result = {
        ...result,
        status: 'BLOCKED',
        changed: observedChanged || Boolean(result.changed),
        reason: 'CHANGE_REPORT_MISMATCH',
        detail: 'Provider-reported mutation did not match its declared configuration recovery boundary.',
      };
    }
    results.push(result);
    if (selection.length === 1 && result.status === 'UNVERIFIED' && !observedChanged) continue;
    if (operationSucceeded(result, options.uninstall)) {
      if (observedChanged) changedIndexes.push(index);
      continue;
    }

    const recoveryByIndex = new Map();
    let recoveryStatus = observedChanged ? 'INCOMPLETE' : 'NOT_REQUIRED';
    if (observedChanged) {
      recoveryByIndex.set(index, {
        status: 'INCOMPLETE',
        detail: 'The failing provider changed its recovery boundary; automatic restoration was refused because ownership of the unexpected bytes is unproven.',
      });
    }
    for (const changedIndex of [...changedIndexes].reverse()) {
      const recovery = rollbackProviderState(captures[changedIndex]);
      recoveryByIndex.set(changedIndex, recovery);
      if (recovery.status === 'INCOMPLETE') recoveryStatus = 'INCOMPLETE';
      else if (recoveryStatus === 'NOT_REQUIRED') recoveryStatus = 'RESTORED';
    }
    const failedProvider = item.provider;
    const completed = results.map((providerResult, resultIndex) => {
      const recovery = recoveryByIndex.get(resultIndex);
      if (!recovery) return providerResult;
      if (resultIndex === index) {
        return { ...providerResult, changed: recovery.status !== 'RESTORED', recovery };
      }
      return {
        ...providerResult,
        status: 'BLOCKED',
        changed: recovery.status !== 'RESTORED',
        reason: recovery.status === 'RESTORED' ? 'BATCH_ROLLED_BACK' : 'BATCH_ROLLBACK_INCOMPLETE',
        detail: recovery.detail,
        originalStatus: providerResult.status,
        originalReason: providerResult.reason || '',
        recovery,
      };
    });
    for (let remaining = index + 1; remaining < selection.length; remaining += 1) {
      completed.push({
        ...recoveryBlockedResult(selection[remaining].provider, 'BATCH_ABORTED', `Provider was not executed after ${failedProvider} failed.`),
        recovery: { status: 'NOT_RUN' },
      });
    }
    return {
      providers: completed,
      status: 'BLOCKED',
      recovery: { status: recoveryStatus, failedProvider },
    };
  }
  return { providers: results, status: aggregateStatus(results, Boolean(options.uninstall)), recovery: { status: 'NOT_REQUIRED' } };
}

export async function runProviderLifecycle(options) {
  const selected = [...new Set(options.providers?.length ? options.providers : ['codex'])];
  const selection = prevalidateProviderSelection(selected, options.scope);
  if (options.apply && selection.some((item) => item.failure)) {
    return {
      providers: selection.map((item) => item.failure ?? prevalidationBlockedResult(item.provider)),
      status: 'BLOCKED',
      recovery: { status: 'NOT_STARTED' },
    };
  }
  if (options.apply) return runTransactionalLifecycle(options, selection);
  const results = [];
  for (const item of selection) {
    if (item.failure) {
      results.push(item.failure);
      continue;
    }
    const operation = options.uninstall ? 'uninstall' : options.apply ? 'apply' : 'plan';
    results.push(await item.adapter[operation](options));
  }
  return {
    providers: results,
    status: aggregateStatus(results, Boolean(options.uninstall)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const scope = argument('--scope', 'global');
  const workspaceRoot = resolve(argument('--workspace-root', process.cwd()));
  const options = {
    providers: argument('--providers', 'codex').split(',').filter(Boolean),
    scope,
    workspaceRoot,
    node: argument('--node'),
    entry: argument('--entry'),
    codex: argument('--codex'),
    codexHome: argument('--codex-home', resolve(homedir(), '.codex')),
    geminiHome: argument('--gemini-home', resolve(homedir(), '.gemini')),
    claude: argument('--claude'),
    claudeConfigDir: argument('--claude-config-dir') || undefined,
    providerTimeoutMs: Number(argument('--provider-timeout-ms', '15000')),
    apply: process.argv.includes('--apply'),
    uninstall: process.argv.includes('--uninstall'),
  };
  runProviderLifecycle(options).then((result) => {
    console.log(JSON.stringify(result));
    if (result.status === 'BLOCKED') process.exitCode = 2;
  }).catch((error) => {
    console.error(`[provider-integration] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
