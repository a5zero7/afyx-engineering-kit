#!/usr/bin/env node
/** Provider-aware, consent-safe Afyx MCP lifecycle. */
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
import { isDeepStrictEqual } from 'node:util';
import { integrate as integrateCodex, probeMcp } from './afyx-mcp-integration.mjs';
import { inspectClaude, integrateClaude } from './afyx-claude-integration.mjs';
import {
  createConfigurationBackup,
  updateKnownState,
  rollbackConfiguration,
} from './afyx-provider-backup.mjs';
import {
  discoverProviderCapabilities,
  negotiateProviderCapabilities,
} from './afyx-integration-contracts.mjs';

function serverName(options) {
  return options.server || 'afyx_graph';
}

function launchArgs(options, provider) {
  if (Array.isArray(options.args)) return options.args.map(String);
  if (options.mode === 'workflow') {
    const args = [
      canonicalPath(options.entry), 'serve', '--mcp',
      '--install-root', canonicalPath(options.installRoot),
    ];
    if (options.scope === 'workspace' && options.workspaceRoot) {
      args.push('--project-root', canonicalPath(options.workspaceRoot));
    }
    args.push(
      '--provider', provider,
      '--authorize', options.authorize || 'afyx-graph,afyx-context',
    );
    return args;
  }
  return [canonicalPath(options.entry), 'serve', '--mcp'];
}

function expectedTool(options) {
  return options.tool || (options.mode === 'workflow' ? 'afyx_workflow' : 'afyx_graph_explore');
}
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
  return isDeepStrictEqual(left, right);
}

function claimedEntryEquivalent(actual, claimed) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  if (actual.disabled !== undefined && typeof actual.disabled !== 'boolean') return false;
  const { disabled: _disabled, ...nativeEntry } = actual;
  return same(claimed, nativeEntry);
}

function normalizedPath(value) {
  const absolute = canonicalPath(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function canonicalPath(value) {
  const absolute = resolve(String(value || ''));
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}

export function isAfyxServerEntry(serverKey, entry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.args)) return false;
  const entryName = serverKey === 'afyx_graph' ? 'afyx-graph.js'
    : serverKey === 'afyx_workflow' ? 'afyx-host-bridge.mjs' : null;
  return entryName !== null && typeof entry.args[0] === 'string'
    && entry.args[0].split(/[\\/]/).at(-1) === entryName
    && entry.args[1] === 'serve' && entry.args[2] === '--mcp';
}

function entryEquivalent(actual, expected) {
  return actual && typeof actual === 'object' && !Array.isArray(actual)
    && typeof actual.command === 'string'
    && normalizedPath(actual.command) === normalizedPath(expected.command)
    && Array.isArray(actual.args) && actual.args.length === expected.args.length
    && actual.args.every((value, index) => typeof value === 'string'
      && (isAbsolute(expected.args[index])
        ? isAbsolute(value) && normalizedPath(value) === normalizedPath(expected.args[index])
        : value === expected.args[index]));
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

function antigravityHistoricalWorkspacePaths(options) {
  if (!options.workspaceRoot) return null;
  const base = resolve(options.workspaceRoot);
  return { base, config: resolve(base, '.agents', 'mcp_config.json') };
}

function antigravityPaths(options) {
  const scope = options.scope || 'global';
  if (scope === 'workspace') {
    if (options.uninstall && options.allowHistoricalWorkspaceUninstall !== false) {
      const historical = antigravityHistoricalWorkspacePaths(options);
      if (historical) return historical;
    }
    throw new Error(
      `PROVIDER_SCOPE_UNSUPPORTED: Antigravity MCP registration only supports global scope (~/.gemini/config/mcp_config.json); workspace MCP configuration (.agents/mcp_config.json) is not discovered by Antigravity (requested scope: ${scope}).`,
    );
  }
  if (scope !== 'global') throw new Error(`PROVIDER_SCOPE_UNSUPPORTED: ${scope}`);
  const base = resolve(options.geminiHome || resolve(homedir(), '.gemini'));
  return { base, config: resolve(base, 'config', 'mcp_config.json') };
}

export function inspectHistoricalAntigravityWorkspace(options) {
  const server = serverName(options);
  const paths = antigravityHistoricalWorkspacePaths(options);
  if (!paths || !existsSync(paths.config)) {
    return {
      paths,
      ownership: paths ? `${paths.config}.afyx-ownership.json` : null,
      state: 'HISTORICAL_ABSENT',
      owned: false,
      actual: null,
      hasForeignEntries: false,
      server,
    };
  }
  const ownership = `${paths.config}.afyx-ownership.json`;
  assertSafePath(paths.base, paths.config);
  assertSafePath(paths.base, ownership);
  const document = parseObject(paths.config);
  if (document.mcpServers !== undefined && (!document.mcpServers || Array.isArray(document.mcpServers) || typeof document.mcpServers !== 'object')) {
    throw new Error(`PROVIDER_INVALID_MCP_SERVERS: ${paths.config}`);
  }
  const marker = parseObject(ownership);
  const actual = document.mcpServers?.[server] ?? null;
  const otherKeys = Object.keys(document.mcpServers || {}).filter((key) => key !== server);
  const hasForeignEntries = otherKeys.length > 0;
  if (!actual) {
    return { paths, ownership, document, marker, state: 'HISTORICAL_ABSENT', owned: false, actual: null, hasForeignEntries, server };
  }
  const claim = marker.entries?.[server] ?? null;
  const claimValid = claim?.provider === 'antigravity' && resolve(claim.configPath || '') === paths.config;
  const claimed = claimValid && claimedEntryEquivalent(actual, claim.entry);
  const isAfyx = isAfyxServerEntry(server, actual);
  const owned = claimed || (!claim && isAfyx);
  return {
    paths,
    ownership,
    document,
    marker,
    state: owned ? 'HISTORICAL_OWNED' : 'HISTORICAL_FOREIGN',
    owned,
    actual,
    claim,
    hasForeignEntries,
    server,
  };
}

function removeHistoricalWorkspaceEntry(options, historical) {
  if (!historical || historical.state === 'HISTORICAL_ABSENT') {
    return { removed: false, state: 'HISTORICAL_ABSENT', detail: 'No historical workspace MCP entry found.' };
  }
  if (!historical.owned) {
    return { removed: false, blocked: true, reason: 'FOREIGN_ENTRY', state: 'HISTORICAL_FOREIGN', detail: `Foreign entry '${historical.server}' in ${historical.paths.config} was preserved unchanged.` };
  }
  const backup = createConfigurationBackup({
    provider: 'antigravity',
    configPath: historical.paths.config,
    operation: 'antigravity-historical-workspace-mcp-remove',
  });
  const markerBefore = snapshot(historical.ownership);
  let markerKnown = markerBefore;
  try {
    delete historical.document.mcpServers[historical.server];
    if (Object.keys(historical.document.mcpServers).length === 0) delete historical.document.mcpServers;
    if (historical.marker.entries) {
      delete historical.marker.entries[historical.server];
      if (Object.keys(historical.marker.entries).length === 0) delete historical.marker.entries;
    }
    atomicJson(historical.paths.config, historical.document);
    updateKnownState(backup);
    if (historical.marker.entries) atomicJson(historical.ownership, historical.marker);
    else rmSync(historical.ownership, { force: true });
    markerKnown = snapshot(historical.ownership);
    const after = inspectHistoricalAntigravityWorkspace(options);
    if (after.state !== 'HISTORICAL_ABSENT') throw new Error('Historical workspace MCP removal read-back failed.');
    return { removed: true, state: 'HISTORICAL_REMOVED', configPath: historical.paths.config, detail: `Removed historical AFYX-owned workspace MCP entry from ${historical.paths.config}; foreign entries preserved.` };
  } catch (error) {
    const rollback = rollbackConfiguration(backup, { reason: error instanceof Error ? error.message : String(error) });
    const markerRestored = restoreGuarded(historical.ownership, markerBefore, markerKnown);
    const restored = rollback.restored && markerRestored;
    throw new Error(`${error instanceof Error ? error.message : String(error)}${restored ? ' (historical workspace config restored safely)' : '; historical workspace rollback incomplete'}`);
  }
}

function expectedEntry(options, provider = 'antigravity') {
  return { command: canonicalPath(options.node), args: launchArgs(options, provider) };
}

export function inspectAntigravity(options) {
  const server = serverName(options);
  const paths = antigravityPaths(options);
  const ownership = `${paths.config}.afyx-ownership.json`;
  assertSafePath(paths.base, paths.config);
  assertSafePath(paths.base, ownership);
  const document = parseObject(paths.config);
  if (document.mcpServers !== undefined && (!document.mcpServers || Array.isArray(document.mcpServers) || typeof document.mcpServers !== 'object')) {
    throw new Error(`PROVIDER_INVALID_MCP_SERVERS: ${paths.config}`);
  }
  const marker = parseObject(ownership);
  let historicalWorkspace = null;
  if ((options.scope || 'global') === 'global') {
    const legacy = resolve(options.geminiHome || resolve(homedir(), '.gemini'), 'antigravity', 'mcp_config.json');
    assertSafePath(paths.base, legacy);
    const legacyDocument = parseObject(legacy);
    if (legacyDocument.mcpServers?.[server]) {
      const legacyOwnership = `${legacy}.afyx-ownership.json`;
      const legacyMarker = parseObject(legacyOwnership);
      const isLegacyOwned = legacyMarker.entries?.[server]?.provider === 'antigravity';
      const isLegacyAfyx = isLegacyOwned || isAfyxServerEntry(server, legacyDocument.mcpServers[server]);
      if (!isLegacyAfyx) {
        return { paths, ownership, document, marker, actual: null, expected: expectedEntry(options), claim: null, state: 'MCP_BLOCKED_LEGACY_DUPLICATE', owned: false, legacy, server, historicalWorkspace: null };
      }
    }
    if (options.workspaceRoot) {
      historicalWorkspace = inspectHistoricalAntigravityWorkspace(options);
    }
  }
  const actual = document.mcpServers?.[server] ?? null;
  const expected = expectedEntry(options);
  const claim = marker.entries?.[server] ?? null;
  const claimValid = claim?.provider === 'antigravity' && resolve(claim.configPath || '') === paths.config;
  let state = 'MCP_NOT_CONFIGURED';
  let owned = false;
  if (actual) {
    const isAfyx = isAfyxServerEntry(server, actual);
    const claimed = claimValid && claimedEntryEquivalent(actual, claim.entry);
    if (actual.disabled === true) {
      state = claimed ? 'MCP_DISABLED_OWNED' : 'MCP_DISABLED_UNOWNED';
      owned = claimed;
    } else if (entryEquivalent(actual, expected)) {
      state = claimed ? 'MCP_CONFIGURED' : 'MCP_CONFIGURED_UNOWNED';
      owned = claimed;
    } else if (claimed || (!claim && isAfyx)) {
      state = 'MCP_STALE_OWNED';
      owned = true;
    } else {
      state = 'MCP_BLOCKED';
    }
  }
  return { paths, ownership, document, marker, actual, expected, claim, state, owned, server, historicalWorkspace };
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
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.startsWith('PROVIDER_SCOPE_UNSUPPORTED')) {
      return { provider: 'antigravity', scope: options.scope, status: 'INCOMPATIBLE', changed: false, reason: 'PROVIDER_SCOPE_UNSUPPORTED', detail };
    }
    return { provider: 'antigravity', status: 'BLOCKED', changed: false, reason: 'INSPECTION_FAILED', detail };
  }
  const plan = planForAntigravity(options, inspection);
  const historicalSummary = inspection.historicalWorkspace && inspection.historicalWorkspace.state !== 'HISTORICAL_ABSENT'
    ? {
      configPath: inspection.historicalWorkspace.paths.config,
      state: inspection.historicalWorkspace.state,
      owned: inspection.historicalWorkspace.owned,
      hasForeignEntries: inspection.historicalWorkspace.hasForeignEntries,
    }
    : undefined;
  const result = {
    ...plan,
    ...(historicalSummary ? { historicalWorkspace: historicalSummary } : {}),
    status: 'CONFIGURED_RESTART_REQUIRED',
    changed: false,
    reason: '',
    detail: '',
  };
  if (inspection.state === 'MCP_BLOCKED' || inspection.state === 'MCP_BLOCKED_LEGACY_DUPLICATE') {
    const legacy = inspection.state === 'MCP_BLOCKED_LEGACY_DUPLICATE';
    return { ...result, status: 'BLOCKED', reason: legacy ? 'LEGACY_DUPLICATE' : 'FOREIGN_ENTRY', detail: legacy ? `Legacy afyx_graph entry at ${inspection.legacy} was preserved; resolve it explicitly before unified registration.` : 'Existing unowned afyx_graph entry was preserved.' };
  }
  if (!options.uninstall && inspection.state.startsWith('MCP_DISABLED_')) {
    return {
      ...result,
      status: 'BLOCKED',
      reason: 'EXPLICITLY_DISABLED',
      detail: 'The native provider entry is explicitly disabled and was preserved unchanged.',
    };
  }
  if (options.uninstall) {
    const hasHistoricalOwned = (options.scope || 'global') === 'global' && inspection.historicalWorkspace?.state === 'HISTORICAL_OWNED';
    if (inspection.state === 'MCP_NOT_CONFIGURED' && !hasHistoricalOwned) return { ...result, status: 'UNAVAILABLE', detail: 'No provider entry is configured.' };
    if (inspection.state !== 'MCP_NOT_CONFIGURED' && !inspection.owned) return { ...result, status: 'BLOCKED', reason: 'UNOWNED_ENTRY', detail: 'Matching but unowned entry was preserved.' };
    if (!options.apply) return { ...result, status: 'CONFIGURED', detail: 'Removal is planned but not consented.' };
    if (inspection.state === 'MCP_NOT_CONFIGURED' && hasHistoricalOwned) {
      try {
        const cleaned = removeHistoricalWorkspaceEntry(options, inspection.historicalWorkspace);
        return { ...result, status: 'UNAVAILABLE', changed: cleaned.removed, detail: cleaned.detail };
      } catch (error) {
        return { ...result, status: 'BLOCKED', changed: false, reason: 'HISTORICAL_CLEANUP_FAILED', detail: error instanceof Error ? error.message : String(error) };
      }
    }
    const backup = createConfigurationBackup({
      provider: 'antigravity',
      configPath: inspection.paths.config,
      operation: 'antigravity-mcp-remove',
    });
    const markerBefore = snapshot(inspection.ownership);
    let markerKnown = markerBefore;
    try {
      delete inspection.document.mcpServers[inspection.server];
      if (Object.keys(inspection.document.mcpServers).length === 0) delete inspection.document.mcpServers;
      if (inspection.marker.entries) {
        delete inspection.marker.entries[inspection.server];
        if (Object.keys(inspection.marker.entries).length === 0) delete inspection.marker.entries;
      }
      atomicJson(inspection.paths.config, inspection.document);
      if ((options.scope || 'global') === 'global') {
        const legacy = resolve(options.geminiHome || resolve(homedir(), '.gemini'), 'antigravity', 'mcp_config.json');
        if (existsSync(legacy)) {
          const legacyDoc = parseObject(legacy);
          const legacyOwnership = `${legacy}.afyx-ownership.json`;
          const legacyMarker = parseObject(legacyOwnership);
          const isLegacyOwned = legacyMarker.entries?.[inspection.server]?.provider === 'antigravity';
          const isLegacyAfyx = isLegacyOwned || isAfyxServerEntry(inspection.server, legacyDoc.mcpServers?.[inspection.server]);
          if (isLegacyAfyx && legacyDoc.mcpServers?.[inspection.server]) {
            delete legacyDoc.mcpServers[inspection.server];
            if (Object.keys(legacyDoc.mcpServers).length === 0) delete legacyDoc.mcpServers;
            atomicJson(legacy, legacyDoc);
            if (legacyMarker.entries?.[inspection.server]) {
              delete legacyMarker.entries[inspection.server];
              atomicJson(legacyOwnership, legacyMarker);
            }
          }
        }
        if (hasHistoricalOwned) {
          removeHistoricalWorkspaceEntry(options, inspection.historicalWorkspace);
        }
      }
      updateKnownState(backup);
      if (inspection.marker.entries) atomicJson(inspection.ownership, inspection.marker);
      else rmSync(inspection.ownership, { force: true });
      markerKnown = snapshot(inspection.ownership);
      const after = inspectAntigravity(options);
      if (after.state !== 'MCP_NOT_CONFIGURED') throw new Error('Provider removal read-back failed.');
      return { ...result, status: 'UNAVAILABLE', changed: true, detail: 'Owned provider entry removed; unrelated configuration preserved.' };
    } catch (error) {
      const rollback = rollbackConfiguration(backup, { reason: error instanceof Error ? error.message : String(error) });
      const markerRestored = restoreGuarded(inspection.ownership, markerBefore, markerKnown);
      const restored = rollback.restored && markerRestored;
      return {
        ...result,
        status: 'BLOCKED',
        changed: !restored,
        reason: rollback.conflict ? 'CONCURRENT_MODIFICATION_DETECTED' : (restored ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_INCOMPLETE'),
        detail: `${error instanceof Error ? error.message : String(error)}${restored ? ' (configuration restored safely)' : (rollback.conflict ? '; ' + rollback.reason : '; rollback was incomplete')}`,
      };
    }
  }
  if (!existsSync(options.node) || !existsSync(options.entry)) {
    return { ...result, status: 'BLOCKED', reason: 'MCP_RUNTIME_UNAVAILABLE', detail: 'Absolute Node.js or MCP entry is unavailable.' };
  }
  if (!options.apply && ['MCP_NOT_CONFIGURED', 'MCP_STALE_OWNED'].includes(inspection.state)) {
    return { ...result, status: 'DETECTED', detail: 'Configuration change is planned but not consented.' };
  }
  const probe = await probeMcp(resolve(options.node), resolve(options.entry), {
    args: launchArgs(options, 'antigravity'), tool: expectedTool(options),
  });
  if (!probe.ok) return { ...result, status: 'BLOCKED', reason: 'MCP_HANDSHAKE_FAILED', detail: probe.detail };
  if (options.apply && ['MCP_NOT_CONFIGURED', 'MCP_STALE_OWNED'].includes(inspection.state)) {
    const backup = createConfigurationBackup({
      provider: 'antigravity',
      configPath: inspection.paths.config,
      operation: 'antigravity-mcp-register',
    });
    const markerBefore = snapshot(inspection.ownership);
    let markerKnown = markerBefore;
    try {
      inspection.document.mcpServers ||= {};
      inspection.document.mcpServers[inspection.server] = inspection.expected;
      inspection.marker.schemaVersion = 1;
      inspection.marker.entries ||= {};
      inspection.marker.entries[inspection.server] = {
        provider: 'antigravity',
        configPath: inspection.paths.config,
        entry: inspection.expected,
      };
      atomicJson(inspection.paths.config, inspection.document);
      if ((options.scope || 'global') === 'global') {
        const legacy = resolve(options.geminiHome || resolve(homedir(), '.gemini'), 'antigravity', 'mcp_config.json');
        if (existsSync(legacy)) {
          const legacyDoc = parseObject(legacy);
          const legacyOwnership = `${legacy}.afyx-ownership.json`;
          const legacyMarker = parseObject(legacyOwnership);
          const isLegacyOwned = legacyMarker.entries?.[inspection.server]?.provider === 'antigravity';
          const isLegacyAfyx = isLegacyOwned || isAfyxServerEntry(inspection.server, legacyDoc.mcpServers?.[inspection.server]);
          if (isLegacyAfyx && legacyDoc.mcpServers?.[inspection.server]) {
            delete legacyDoc.mcpServers[inspection.server];
            if (Object.keys(legacyDoc.mcpServers).length === 0) delete legacyDoc.mcpServers;
            atomicJson(legacy, legacyDoc);
            if (legacyMarker.entries?.[inspection.server]) {
              delete legacyMarker.entries[inspection.server];
              atomicJson(legacyOwnership, legacyMarker);
            }
          }
        }
      }
      updateKnownState(backup);
      atomicJson(inspection.ownership, inspection.marker);
      markerKnown = snapshot(inspection.ownership);
      const after = inspectAntigravity(options);
      if (after.state !== 'MCP_CONFIGURED' || !after.owned) throw new Error('Provider configuration read-back failed.');
      result.changed = true;
    } catch (error) {
      const rollback = rollbackConfiguration(backup, { reason: error instanceof Error ? error.message : String(error) });
      const markerRestored = restoreGuarded(inspection.ownership, markerBefore, markerKnown);
      const restored = rollback.restored && markerRestored;
      return {
        ...result,
        status: 'BLOCKED',
        changed: !restored,
        reason: rollback.conflict ? 'CONCURRENT_MODIFICATION_DETECTED' : (restored ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_INCOMPLETE'),
        detail: `${error instanceof Error ? error.message : String(error)}${restored ? ' (configuration restored safely)' : (rollback.conflict ? '; ' + rollback.reason : '; rollback was incomplete')}`,
      };
    }
  }
  if (options.apply && options.migrateHistoricalWorkspace && inspection.historicalWorkspace) {
    if (inspection.historicalWorkspace.state === 'HISTORICAL_FOREIGN') {
      return {
        ...result,
        status: 'BLOCKED',
        reason: 'FOREIGN_ENTRY',
        detail: `Historical workspace entry at ${inspection.historicalWorkspace.paths.config} is not AFYX-owned and was preserved unchanged.`,
      };
    }
    if (inspection.historicalWorkspace.state === 'HISTORICAL_OWNED') {
      try {
        const cleaned = removeHistoricalWorkspaceEntry(options, inspection.historicalWorkspace);
        if (cleaned.removed) {
          result.changed = true;
          result.historicalWorkspace = { ...historicalSummary, state: 'HISTORICAL_MIGRATED' };
        }
      } catch (error) {
        return { ...result, status: 'BLOCKED', reason: 'HISTORICAL_MIGRATION_FAILED', detail: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  result.status = 'CONFIGURED_RESTART_REQUIRED';
  const historicalNote = result.historicalWorkspace?.state === 'HISTORICAL_OWNED'
    ? ` Historical AFYX-owned workspace MCP entry detected at ${result.historicalWorkspace.configPath}; run with --migrate-historical-workspace or uninstall to clean it safely.`
    : result.historicalWorkspace?.state === 'HISTORICAL_MIGRATED'
      ? ` Historical AFYX-owned workspace MCP entry at ${result.historicalWorkspace.configPath} migrated safely.`
      : '';
  result.detail = `${probe.detail} Provider configuration read-back matched the absolute runtime entry.${historicalNote}`;
  return result;
}

export async function migrateHistoricalAntigravityWorkspace(options) {
  return integrateAntigravity({
    ...options,
    scope: 'global',
    apply: Boolean(options.apply),
    migrateHistoricalWorkspace: true,
  });
}

async function integrateCodexAdapter(options) {
  if (options.scope !== 'global') {
    return {
      provider: 'codex', status: 'INCOMPATIBLE', changed: false,
      reason: 'SCOPE_UNSUPPORTED',
      detail: 'Codex direct MCP registration is user-scoped; use a session override or an installed plugin for isolated project acceptance.',
    };
  }
  const codexConfigRoot = resolve(options.codexHome);
  const codex = await integrateCodex({
    node: resolve(options.node), entry: resolve(options.entry), codex: options.codex,
    codexHome: codexConfigRoot, apply: Boolean(options.apply), uninstall: Boolean(options.uninstall),
    providerTimeoutMs: options.providerTimeoutMs, server: serverName(options),
    args: launchArgs(options, 'codex'), tool: expectedTool(options),
  });
  return {
    provider: 'codex',
    status: codex.mcp === 'MCP_REACHABLE' ? 'READY'
      : codex.mcp === 'MCP_NOT_CONFIGURED' ? (options.uninstall ? 'UNAVAILABLE' : 'DETECTED')
      : codex.mcp === 'MCP_STALE_OWNED' ? (options.uninstall ? 'CONFIGURED' : 'DETECTED')
      : options.uninstall && codex.mcp === 'MCP_CONFIGURED' ? 'CONFIGURED'
      : 'BLOCKED',
    configPath: resolve(codexConfigRoot, 'config.toml'),
    ownershipPath: resolve(codexConfigRoot, '.afyx-provider-ownership.json'),
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
    if (provider === 'claude' && (options.extensionOnly || options.claudeExtension)) {
      return {
        detected: true,
        command: 'extension',
        version: options.hostVersion ?? null,
        evidence: 'CALLER',
      };
    }
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
  antigravity: defineProviderAdapter('antigravity', ['global'], integrateAntigravity),
  claude: defineProviderAdapter('claude', ['global', 'workspace'], integrateClaude),
});

export function getProviderAdapter(provider) {
  return Object.hasOwn(providerAdapters, provider) ? providerAdapters[provider] : null;
}

function unsupportedScopeResult(provider, scope) {
  return {
    provider,
    status: 'INCOMPATIBLE',
    changed: false,
    reason: provider === 'antigravity' ? 'PROVIDER_SCOPE_UNSUPPORTED' : 'SCOPE_UNSUPPORTED',
    detail: provider === 'codex'
      ? 'Codex adapter currently supports its user-scoped native CLI configuration.'
      : provider === 'antigravity'
        ? `Antigravity direct MCP registration only supports global scope (~/.gemini/config/mcp_config.json); workspace MCP configuration (.agents/mcp_config.json) is not discovered by Antigravity (requested scope: ${scope}).`
        : `Provider ${provider} does not support the requested ${scope} scope.`,
  };
}

function prevalidateProviderSelection(selected, scope, options = {}) {
  return selected.map((provider) => {
    const adapter = getProviderAdapter(provider);
    if (!adapter) {
      return {
        provider,
        adapter: null,
        failure: { provider, status: 'BLOCKED', changed: false, reason: 'UNKNOWN_PROVIDER', detail: `Unknown provider: ${provider}` },
      };
    }
    const allowHistoricalAntigravityUninstall = provider === 'antigravity' && scope === 'workspace' && Boolean(options?.uninstall);
    if (!adapter.capabilities.scopes.includes(scope) && !allowHistoricalAntigravityUninstall) {
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
    const files = [inspection.paths.config, inspection.ownership];
    if (inspection.historicalWorkspace?.paths?.config && (options.uninstall || options.migrateHistoricalWorkspace)) {
      files.push(inspection.historicalWorkspace.paths.config, inspection.historicalWorkspace.ownership);
    }
    return { base: inspection.paths.base, files };
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
  const plans = [];
  for (const item of selection) {
    try {
      const result = await item.adapter[preflightOperation](preflightOptions);
      const blocked = ['BLOCKED', 'INCOMPATIBLE'].includes(result.status);
      plans.push({ item, result, capture: blocked ? null : captureProviderState(item.provider, options) });
    } catch {
      plans.push({ item, result: recoveryBlockedResult(item.provider, 'RECOVERY_SNAPSHOT_FAILED',
        'Provider recovery boundary could not be established.') });
    }
  }
  try {
    validateRecoveryPathIsolation(plans.flatMap(({ capture }) => capture ? [capture] : []));
  } catch {
    return {
      providers: selection.map(({ provider }) => recoveryBlockedResult(provider, 'RECOVERY_PATH_CONFLICT',
        'Selected provider recovery boundaries overlap.')),
      status: 'BLOCKED',
      recovery: { status: 'NOT_STARTED' },
    };
  }

  const results = [];
  for (const { item, result: preflight, capture } of plans) {
    if (!capture || ['BLOCKED', 'INCOMPATIBLE'].includes(preflight.status)) {
      results.push(preflight);
      continue;
    }
    let result;
    try {
      result = await item.adapter[operation](options);
    } catch {
      result = recoveryBlockedResult(item.provider, 'PROVIDER_EXECUTION_FAILED', 'Provider execution failed.');
    }
    try {
      const observedChanged = sealProviderState(capture);
      if (observedChanged !== Boolean(result.changed)) {
        result = { ...result, status: 'BLOCKED', changed: observedChanged,
          reason: 'CHANGE_REPORT_MISMATCH', detail: 'Provider mutation did not match its recovery boundary.' };
      }
      if (observedChanged && !operationSucceeded(result, options.uninstall)) {
        result = { ...result, recovery: { status: 'INCOMPLETE',
          detail: 'Provider left changes inside its recovery boundary. Unproven bytes were preserved.' } };
      }
    } catch {
      result = { ...result, status: 'BLOCKED', reason: 'RECOVERY_SNAPSHOT_FAILED',
        detail: 'Provider configuration read-back failed.' };
    }
    results.push(result);
  }
  return { providers: results, status: aggregateStatus(results, Boolean(options.uninstall)),
    recovery: { status: results.some((item) => item.recovery?.status === 'INCOMPLETE') ? 'INCOMPLETE'
      : results.some((item) => item.recovery?.status === 'RESTORED') ? 'RESTORED' : 'NOT_REQUIRED' } };
}

export async function runProviderLifecycle(options) {
  const selected = [...new Set(options.providers?.length ? options.providers : ['codex'])];
  const selection = prevalidateProviderSelection(selected, options.scope, options);
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
    const operation = options.uninstall ? 'uninstall' : options.verify ? 'verify' : options.apply ? 'apply' : 'plan';
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
    server: argument('--server', 'afyx_graph'),
    mode: argument('--mode', 'graph'),
    installRoot: resolve(argument('--install-root', resolve(homedir(), '.afyx'))),
    authorize: argument('--authorize', 'afyx-graph,afyx-context'),
    tool: argument('--tool'),
    codex: argument('--codex'),
    codexHome: argument('--codex-home', resolve(homedir(), '.codex')),
    geminiHome: argument('--gemini-home', resolve(homedir(), '.gemini')),
    claude: argument('--claude'),
    claudeConfigDir: argument('--claude-config-dir') || undefined,
    claudeExtension: process.argv.includes('--claude-extension'),
    extensionOnly: process.argv.includes('--extension-only'),
    providerTimeoutMs: Number(argument('--provider-timeout-ms', '15000')),
    apply: process.argv.includes('--apply'),
    verify: process.argv.includes('--verify'),
    uninstall: process.argv.includes('--uninstall'),
    migrateHistoricalWorkspace: process.argv.includes('--migrate-historical-workspace'),
  };
  runProviderLifecycle(options).then((result) => {
    console.log(JSON.stringify(result));
    if (result.status === 'BLOCKED' || (result.status === 'PARTIAL' && (options.apply || options.uninstall))) process.exitCode = 2;
  }).catch((error) => {
    console.error(`[provider-integration] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
