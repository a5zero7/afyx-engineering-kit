/** Consent-safe Claude Code MCP registration through the native `claude mcp` CLI. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { probeMcp } from './afyx-mcp-integration.mjs';

const SERVER = 'afyx_graph';
const MAX_DIAGNOSTIC = 2_000;

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalPath(value) {
  const absolute = resolve(String(value || ''));
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}

function normalizedPath(value) {
  const absolute = canonicalPath(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function entryEquivalent(actual, expected) {
  return actual && typeof actual === 'object' && !Array.isArray(actual)
    && (actual.type === undefined || actual.type === 'stdio')
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

function parseObject(file) {
  if (!existsSync(file)) return {};
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

function sameBytes(left, right) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
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

function expectedEntry(options) {
  return {
    type: 'stdio',
    command: canonicalPath(options.node),
    args: [canonicalPath(options.entry), 'serve', '--mcp'],
  };
}

function claudePaths(options) {
  const scope = options.scope || 'global';
  const configured = options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR;
  if (configured !== undefined && (!String(configured).trim() || !isAbsolute(String(configured)))) {
    throw new Error('PROVIDER_CLAUDE_CONFIG_DIR_MUST_BE_ABSOLUTE');
  }
  const overridden = configured !== undefined;
  const configDir = overridden ? resolve(String(configured)) : resolve(homedir(), '.claude');
  const stateConfig = overridden
    ? resolve(configDir, '.claude.json')
    : resolve(homedir(), '.claude.json');
  const workspace = resolve(options.workspaceRoot);
  if (scope === 'workspace') {
    return {
      base: workspace,
      config: resolve(workspace, '.mcp.json'),
      ownership: resolve(workspace, '.claude', '.afyx-provider-ownership.json'),
      nativeScope: 'project',
      configDir,
      configDirOverridden: overridden,
      stateConfig,
      workspace,
    };
  }
  if (scope !== 'global') throw new Error(`PROVIDER_SCOPE_UNSUPPORTED: ${scope}`);
  return {
    base: overridden ? configDir : resolve(homedir()),
    config: stateConfig,
    ownership: resolve(configDir, '.afyx-provider-ownership.json'),
    nativeScope: 'user',
    configDir,
    configDirOverridden: overridden,
    stateConfig,
    workspace,
  };
}

function mcpServers(document, file) {
  if (document.mcpServers !== undefined && (!document.mcpServers || Array.isArray(document.mcpServers) || typeof document.mcpServers !== 'object')) {
    throw new Error(`PROVIDER_INVALID_MCP_SERVERS: ${file}`);
  }
  return document.mcpServers || {};
}

function localEntry(stateDocument, stateConfig, workspace) {
  if (stateDocument.projects === undefined) return null;
  if (!stateDocument.projects || Array.isArray(stateDocument.projects) || typeof stateDocument.projects !== 'object') {
    throw new Error(`PROVIDER_INVALID_PROJECTS: ${stateConfig}`);
  }
  for (const [projectPath, project] of Object.entries(stateDocument.projects)) {
    if (normalizedPath(projectPath) !== normalizedPath(workspace)) continue;
    if (!project || Array.isArray(project) || typeof project !== 'object') {
      throw new Error(`PROVIDER_INVALID_PROJECT_ENTRY: ${stateConfig}`);
    }
    return mcpServers(project, stateConfig)[SERVER] ?? null;
  }
  return null;
}

export function inspectClaude(options) {
  const paths = claudePaths(options);
  assertSafePath(paths.base, paths.config);
  assertSafePath(paths.base, paths.ownership);
  assertSafePath(paths.configDirOverridden ? paths.configDir : resolve(homedir()), paths.stateConfig);
  const document = parseObject(paths.config);
  const stateDocument = paths.stateConfig === paths.config ? document : parseObject(paths.stateConfig);
  const projectConfig = resolve(paths.workspace, '.mcp.json');
  const projectDocument = projectConfig === paths.config ? document : parseObject(projectConfig);
  const targetServers = mcpServers(document, paths.config);
  const user = mcpServers(stateDocument, paths.stateConfig)[SERVER] ?? null;
  const project = mcpServers(projectDocument, projectConfig)[SERVER] ?? null;
  const local = localEntry(stateDocument, paths.stateConfig, paths.workspace);
  const effective = local ? { scope: 'local', entry: local }
    : project ? { scope: 'project', entry: project }
      : user ? { scope: 'user', entry: user } : null;
  const precedence = { local: 0, project: 1, user: 2 };
  const higherPrecedence = effective !== null
    && precedence[effective.scope] < precedence[paths.nativeScope];
  const marker = parseObject(paths.ownership);
  const actual = targetServers[SERVER] ?? null;
  const expected = expectedEntry(options);
  const claim = marker.entries?.[SERVER] ?? null;
  const claimValid = claim?.provider === 'claude'
    && claim.scope === paths.nativeScope
    && resolve(claim.configPath || '') === paths.config;
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
  return {
    paths, document, stateDocument, projectDocument, marker, actual, expected,
    claim, claimValid, state, owned, effective, higherPrecedence,
  };
}

function planForClaude(options, inspection) {
  const action = options.uninstall
    ? (inspection.state === 'MCP_NOT_CONFIGURED' ? (inspection.claimValid ? 'REMOVE_MARKER' : 'NONE') : inspection.owned ? 'REMOVE' : 'PRESERVE_FOREIGN')
    : (inspection.state === 'MCP_NOT_CONFIGURED' ? 'CREATE' : inspection.state === 'MCP_STALE_OWNED' ? 'UPDATE' : 'NONE');
  return {
    provider: 'claude',
    scope: options.scope,
    nativeScope: inspection.paths.nativeScope,
    configPath: inspection.paths.config,
    ownershipPath: inspection.paths.ownership,
    state: inspection.state,
    effectiveScope: inspection.effective?.scope ?? null,
    action,
  };
}

const cmdMetaCharacters = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdCommand(value) {
  return String(value).replace(cmdMetaCharacters, '^$1');
}

function escapeCmdArgument(value) {
  let escaped = String(value)
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, '$1$1');
  escaped = `"${escaped}"`.replace(cmdMetaCharacters, '^$1');
  return escaped.replace(cmdMetaCharacters, '^$1');
}

function claudeRun(options, args) {
  const claude = options.claude;
  const paths = claudePaths(options);
  const isWindowsCmd = process.platform === 'win32' && extname(claude).toLowerCase() === '.cmd';
  const command = isWindowsCmd ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe') : claude;
  const commandArgs = isWindowsCmd
    ? ['/d', '/s', '/c', `"${[escapeCmdCommand(claude), ...args.map(escapeCmdArgument)].join(' ')}"`]
    : args;
  const configuredTimeout = Number(options.providerTimeoutMs);
  const timeout = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0
    ? Math.min(configuredTimeout, 60_000) : 15_000;
  const env = { ...process.env };
  if (paths.configDirOverridden) env.CLAUDE_CONFIG_DIR = paths.configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  return spawnSync(command, commandArgs, {
    cwd: resolve(options.workspaceRoot),
    encoding: 'utf8',
    env,
    timeout,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: isWindowsCmd,
  });
}

function diagnostic(result) {
  return String(result.stderr || result.stdout || result.error?.message || '').trim().slice(0, MAX_DIAGNOSTIC);
}

function requireClaudeSuccess(result, action) {
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
    throw new Error(`${action} timed out within the bounded provider execution window.`);
  }
  if (result.error || result.status === null) {
    throw new Error(`${action} could not launch Claude Code CLI: ${diagnostic(result) || 'unknown launch failure'}`);
  }
  if (result.status !== 0) {
    throw new Error(`${action} failed with exit code ${result.status}: ${diagnostic(result) || 'no diagnostic output'}`);
  }
}

function reportedEffectiveEntry(result) {
  try {
    const value = JSON.parse(String(result.stdout || '').trim());
    if (!value || Array.isArray(value) || typeof value !== 'object') return null;
    if (!value.entry || Array.isArray(value.entry) || typeof value.entry !== 'object') return null;
    if (typeof value.name !== 'string' || typeof value.scope !== 'string') return null;
    return { name: value.name, scope: value.scope, entry: value.entry };
  } catch {
    return null;
  }
}

function withoutAfyxServer(document) {
  const copy = JSON.parse(JSON.stringify(document));
  if (copy.mcpServers) {
    delete copy.mcpServers[SERVER];
    if (Object.keys(copy.mcpServers).length === 0) delete copy.mcpServers;
  }
  return copy;
}

function writeClaim(inspection) {
  inspection.marker.schemaVersion = 1;
  inspection.marker.entries ||= {};
  inspection.marker.entries[SERVER] = {
    provider: 'claude',
    scope: inspection.paths.nativeScope,
    configPath: inspection.paths.config,
    entry: inspection.expected,
  };
  atomicJson(inspection.paths.ownership, inspection.marker);
}

function removeClaim(inspection) {
  if (inspection.marker.entries) {
    delete inspection.marker.entries[SERVER];
    if (Object.keys(inspection.marker.entries).length === 0) delete inspection.marker.entries;
  }
  if (inspection.marker.entries) atomicJson(inspection.paths.ownership, inspection.marker);
  else rmSync(inspection.paths.ownership, { force: true });
}

async function verifyClaude(options, inspection, result) {
  if (inspection.higherPrecedence) {
    return { ...result, status: 'BLOCKED', reason: 'HIGHER_PRECEDENCE_ENTRY', detail: `Claude Code ${inspection.effective.scope}-scope entry overrides the managed ${inspection.paths.nativeScope}-scope entry.` };
  }
  if (!inspection.actual || !entryEquivalent(inspection.actual, inspection.expected)
      || inspection.effective?.scope !== inspection.paths.nativeScope
      || !entryEquivalent(inspection.effective?.entry, inspection.expected)) {
    return { ...result, status: 'BLOCKED', reason: 'MCP_CONFIGURATION_MISMATCH', detail: 'The effective Claude Code MCP entry does not match the approved Afyx Graph runtime and scope.' };
  }
  const native = claudeRun(options, ['mcp', 'get', SERVER]);
  try {
    requireClaudeSuccess(native, 'Claude Code MCP verification');
  } catch (error) {
    return { ...result, status: 'BLOCKED', reason: 'CLAUDE_RUNTIME_UNVERIFIED', detail: error instanceof Error ? error.message : String(error) };
  }
  const reported = reportedEffectiveEntry(native);
  if (!reported) {
    return { ...result, status: 'UNVERIFIED', reason: 'CLAUDE_EFFECTIVE_ENTRY_UNPROVEN', detail: 'Claude Code CLI succeeded but did not provide structured effective-entry identity evidence.' };
  }
  if (reported.name !== SERVER || reported.scope !== inspection.paths.nativeScope
      || !entryEquivalent(reported.entry, inspection.expected)) {
    return { ...result, status: 'BLOCKED', reason: 'CLAUDE_EFFECTIVE_ENTRY_MISMATCH', detail: 'Claude Code CLI reported an effective entry that differs from the approved scope or runtime.' };
  }
  const probe = await probeMcp(resolve(options.node), resolve(options.entry));
  if (!probe.ok) return { ...result, status: 'BLOCKED', reason: 'MCP_HANDSHAKE_FAILED', detail: probe.detail };
  return { ...result, status: 'READY', detail: `${probe.detail} Claude Code CLI confirmed the configured server.` };
}

export async function integrateClaude(options) {
  let inspection;
  try {
    inspection = inspectClaude(options);
  } catch (error) {
    return { provider: 'claude', status: 'BLOCKED', changed: false, reason: 'INSPECTION_FAILED', detail: error instanceof Error ? error.message : String(error) };
  }
  const plan = planForClaude(options, inspection);
  const result = { ...plan, status: 'DETECTED', changed: false, reason: '', detail: '' };
  if (inspection.state === 'MCP_BLOCKED') {
    return { ...result, status: 'BLOCKED', reason: 'FOREIGN_ENTRY', detail: 'Existing unowned afyx_graph entry was preserved.' };
  }
  if (inspection.higherPrecedence && !options.uninstall) {
    return { ...result, status: 'BLOCKED', reason: 'HIGHER_PRECEDENCE_ENTRY', detail: `Claude Code ${inspection.effective.scope}-scope entry overrides the managed ${inspection.paths.nativeScope}-scope entry; no mutation was attempted.` };
  }
  if (options.operation === 'inspect') return { ...result, detail: 'Claude Code configuration was inspected without mutation.' };
  if (options.operation === 'verify') return verifyClaude(options, inspection, result);
  if (!options.apply && !options.uninstall) {
    return {
      ...result,
      status: ['MCP_CONFIGURED', 'MCP_CONFIGURED_UNOWNED'].includes(inspection.state) ? 'CONFIGURED' : 'DETECTED',
      detail: inspection.state === 'MCP_CONFIGURED' || inspection.state === 'MCP_CONFIGURED_UNOWNED'
        ? 'Claude Code configuration already matches; no runtime process was started during planning.'
        : 'Claude Code configuration change is planned but not consented.',
    };
  }
  if (options.uninstall) {
    if (inspection.state === 'MCP_NOT_CONFIGURED' && !inspection.claimValid) {
      return { ...result, status: 'UNAVAILABLE', detail: 'No Claude Code provider entry is configured.' };
    }
    if (inspection.actual && !inspection.owned) {
      return { ...result, status: 'BLOCKED', reason: 'UNOWNED_ENTRY', detail: 'Matching but unowned entry was preserved.' };
    }
    if (!options.apply) return { ...result, status: 'CONFIGURED', detail: 'Removal is planned but not consented.' };
    const configBefore = snapshot(inspection.paths.config);
    const markerBefore = snapshot(inspection.paths.ownership);
    let configKnown = configBefore;
    let markerKnown = markerBefore;
    try {
      if (inspection.actual) {
        requireClaudeSuccess(
          claudeRun(options, ['mcp', 'remove', SERVER, '--scope', inspection.paths.nativeScope]),
          'Claude Code MCP removal',
        );
        configKnown = snapshot(inspection.paths.config);
      }
      removeClaim(inspection);
      markerKnown = snapshot(inspection.paths.ownership);
      const after = inspectClaude(options);
      if (after.actual) throw new Error('Claude Code provider removal read-back failed.');
      if (!same(withoutAfyxServer(after.document), withoutAfyxServer(inspection.document))) {
        throw new Error('Claude Code CLI changed unrelated configuration during removal.');
      }
      if (after.effective) {
        return { ...result, status: 'BLOCKED', changed: true, reason: 'EFFECTIVE_ENTRY_REMAINS', detail: `Owned ${inspection.paths.nativeScope}-scope entry was removed, but a ${after.effective.scope}-scope entry with the same name remains effective.` };
      }
      return { ...result, status: 'UNAVAILABLE', changed: true, detail: 'Owned Claude Code entry removed; unrelated configuration preserved.' };
    } catch (error) {
      const configRestored = restoreGuarded(inspection.paths.config, configBefore, configKnown);
      const markerRestored = restoreGuarded(inspection.paths.ownership, markerBefore, markerKnown);
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
  const probe = await probeMcp(resolve(options.node), resolve(options.entry));
  if (!probe.ok) return { ...result, status: 'BLOCKED', reason: 'MCP_HANDSHAKE_FAILED', detail: probe.detail };
  if (['MCP_NOT_CONFIGURED', 'MCP_STALE_OWNED'].includes(inspection.state)) {
    const configBefore = snapshot(inspection.paths.config);
    const markerBefore = snapshot(inspection.paths.ownership);
    let configKnown = configBefore;
    let markerKnown = markerBefore;
    try {
      if (inspection.state === 'MCP_STALE_OWNED') {
        requireClaudeSuccess(
          claudeRun(options, ['mcp', 'remove', SERVER, '--scope', inspection.paths.nativeScope]),
          'Claude Code stale MCP removal',
        );
        configKnown = snapshot(inspection.paths.config);
      }
      requireClaudeSuccess(
        claudeRun(options, ['mcp', 'add-json', SERVER, JSON.stringify(inspection.expected), '--scope', inspection.paths.nativeScope]),
        'Claude Code MCP registration',
      );
      configKnown = snapshot(inspection.paths.config);
      writeClaim(inspection);
      markerKnown = snapshot(inspection.paths.ownership);
      const after = inspectClaude(options);
      if (after.state !== 'MCP_CONFIGURED' || !after.owned) throw new Error('Claude Code provider configuration read-back failed.');
      if (!same(withoutAfyxServer(after.document), withoutAfyxServer(inspection.document))) {
        throw new Error('Claude Code CLI changed unrelated configuration during registration.');
      }
      result.changed = true;
      inspection = after;
    } catch (error) {
      const configRestored = restoreGuarded(inspection.paths.config, configBefore, configKnown);
      const markerRestored = restoreGuarded(inspection.paths.ownership, markerBefore, markerKnown);
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
  return verifyClaude(options, inspection, result);
}
