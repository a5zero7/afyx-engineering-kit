#!/usr/bin/env node
/** Consent-safe Codex MCP configuration and native read-back. */
import { sha256Bytes } from '../afyx-context/src/artifact-lineage.js';
import { StateCoordinator } from '../afyx-context/src/coordination.js';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createConfigurationBackup,
  updateKnownState,
  rollbackConfiguration,
  parseToml,
} from './afyx-provider-backup.mjs';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalized(value) {
  const path = normalize(String(value || ''));
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function inside(base, candidate) {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertSafePath(base, candidate) {
  if (!inside(base, candidate)) throw new McpIntegrationError('CODEX_PATH_UNSAFE', `Path outside Codex configuration boundary: ${candidate}`);
  const boundary = resolve(base);
  let cursor = resolve(candidate);
  for (;;) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new McpIntegrationError('CODEX_PATH_UNSAFE', `Symlinked Codex configuration path was refused: ${cursor}`);
    }
    if (cursor === boundary) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export function isAfyxTransport(server, transport) {
  if (typeof server === 'string' && /^(afyx[_-]|codex-usage)/i.test(server)) return true;
  if (!transport || typeof transport !== 'object') return false;
  const cmd = String(transport.command || '');
  if (/afyx/i.test(cmd)) return true;
  const args = Array.isArray(transport.args) ? transport.args : [];
  return args.some((arg) => typeof arg === 'string' && /afyx/i.test(arg));
}

export function classifyEntry(existing, expected, server = '') {
  if (!existing) return 'MCP_NOT_CONFIGURED';
  const transport = existing.transport || {};
  const args = Array.isArray(transport.args) ? transport.args : [];
  const expectedNode = normalized(expected.node);
  const actualNode = normalized(transport.command);
  const executableName = (value) => basename(value).replace(/\.exe$/i, '');
  const nodeMatches = actualNode === expectedNode || executableName(actualNode) === executableName(expectedNode);
  const explicitArgs = Array.isArray(expected.args);
  const expectedArgs = explicitArgs ? expected.args.map(String) : [expected.entry, 'serve', '--mcp'];
  const argsMatch = explicitArgs
    ? transport.type === 'stdio' && args.length === expectedArgs.length
      && args.every((value, index) => typeof value === 'string'
        && (isAbsolute(expectedArgs[index])
          ? isAbsolute(value) && normalized(value) === normalized(expectedArgs[index])
          : value === expectedArgs[index]))
    : transport.type === 'stdio' && args.length === 3
      && normalized(args[0]) === normalized(expected.entry)
      && args[1] === 'serve' && args[2] === '--mcp';
  if (argsMatch && nodeMatches) return 'MCP_CONFIGURED';
  if (explicitArgs && !server) return 'MCP_BLOCKED';
  const isAfyx = isAfyxTransport(server, transport)
    || (transport.type === 'stdio' && args.some((a) => typeof a === 'string' && /afyx/i.test(a)));
  if (isAfyx) return 'MCP_STALE_OWNED';
  return 'MCP_BLOCKED';
}

class McpIntegrationError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
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
  // npm .cmd shims add a second cmd.exe parsing boundary.
  return escaped.replace(cmdMetaCharacters, '^$1');
}

function codexRun(codex, codexHome, args, configuredTimeout) {
  const isWindowsCmd = process.platform === 'win32' && extname(codex).toLowerCase() === '.cmd';
  const command = isWindowsCmd ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe') : codex;
  const commandArgs = isWindowsCmd
    ? ['/d', '/s', '/c', `"${[escapeCmdCommand(codex), ...args.map(escapeCmdArgument)].join(' ')}"`]
    : args;
  const requested = Number(configuredTimeout);
  const timeout = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 60_000) : 15_000;
  return spawnSync(command, commandArgs, {
    encoding: 'utf8',
    env: { ...process.env, CODEX_HOME: codexHome },
    windowsHide: true,
    windowsVerbatimArguments: isWindowsCmd,
    timeout,
    maxBuffer: 1024 * 1024,
  });
}

function commandDiagnostic(result) {
  return String(result.stderr || result.stdout || result.error?.message || '').trim();
}

function validateForeignCodexConfig(codexHome, server) {
  const configPath = resolve(codexHome, 'config.toml');
  if (!existsSync(configPath)) return;
  let raw;
  try {
    raw = readFileSync(configPath);
  } catch {
    return;
  }
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) {
    throw new McpIntegrationError('CODEX_CONFIG_UNPARSEABLE', 'Codex configuration is not valid UTF-8.');
  }
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  let parsed;
  try {
    parsed = parseToml(source);
  } catch {
    throw new McpIntegrationError('CODEX_CONFIG_UNPARSEABLE', 'Codex configuration could not be parsed safely.');
  }
  const servers = parsed?.mcp_servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return;
  for (const [name, entry] of Object.entries(servers)) {
    if (name === server) continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new McpIntegrationError(
        'CODEX_FOREIGN_CONFIG_INCOMPATIBLE',
        `Codex foreign MCP server "${name}" has an incompatible table definition and was preserved untouched.`,
      );
    }
    if (entry.args !== undefined && (!Array.isArray(entry.args) || !entry.args.every((item) => typeof item === 'string'))) {
      throw new McpIntegrationError(
        'CODEX_FOREIGN_CONFIG_INCOMPATIBLE',
        `Codex foreign MCP server "${name}" has a non-array args definition and was preserved untouched.`,
      );
    }
    if (entry.command !== undefined && typeof entry.command !== 'string') {
      throw new McpIntegrationError(
        'CODEX_FOREIGN_CONFIG_INCOMPATIBLE',
        `Codex foreign MCP server "${name}" has a non-string command definition and was preserved untouched.`,
      );
    }
  }
}

function readExisting(codex, codexHome, providerTimeoutMs, server = 'afyx_graph') {
  validateForeignCodexConfig(codexHome, server);
  const result = codexRun(codex, codexHome, ['mcp', 'get', server, '--json'], providerTimeoutMs);
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
    throw new McpIntegrationError('CODEX_TIMEOUT', 'Codex MCP inspection timed out within the bounded provider execution window.');
  }
  if (result.error || result.status === null) {
    throw new McpIntegrationError(
      'CODEX_LAUNCH_FAILED',
      `Codex MCP inspection could not launch: ${commandDiagnostic(result) || 'unknown process launch failure'}`,
    );
  }
  if (result.status !== 0) {
    const diagnostic = commandDiagnostic(result);
    if (/not found|not configured|no mcp server named/i.test(diagnostic)) {
      return { existing: null, reason: 'MCP_ENTRY_NOT_FOUND' };
    }
    throw new McpIntegrationError(
      'MCP_INSPECTION_FAILED',
      `Codex MCP inspection failed with exit code ${result.status}: ${diagnostic || 'no diagnostic output'}`,
    );
  }
  try {
    return { existing: JSON.parse(result.stdout), reason: '' };
  } catch {
    throw new McpIntegrationError('MCP_INVALID_CONFIGURATION', 'Codex returned invalid MCP configuration JSON.');
  }
}

function backupConfig(codexHome) {
  const config = resolve(codexHome, 'config.toml');
  return createConfigurationBackup({
    provider: 'codex',
    configPath: config,
    operation: 'codex-mcp',
  });
}

function fileBytes(file) {
  return existsSync(file) ? readFileSync(file) : null;
}

function sameBytes(left, right) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function restoreFileGuarded(file, before, expected) {
  if (!sameBytes(fileBytes(file), expected)) return false;
  if (before === null) rmSync(file, { force: true });
  else writeFileSync(file, before);
  return sameBytes(fileBytes(file), before);
}

function ownershipPath(codexHome) {
  return resolve(codexHome, '.afyx-provider-ownership.json');
}

function readOwnership(codexHome) {
  const file = ownershipPath(codexHome);
  if (!existsSync(file)) return { file, document: { schemaVersion: 1, entries: {} } };
  try {
    const document = JSON.parse(readFileSync(file, 'utf8'));
    if (!document || Array.isArray(document) || typeof document !== 'object') throw new Error('root is not an object');
    document.entries ||= {};
    return { file, document };
  } catch (error) {
    throw new McpIntegrationError('MCP_INVALID_OWNERSHIP', `Codex ownership marker is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeOwnership(ownership) {
  mkdirSync(dirname(ownership.file), { recursive: true });
  const temporary = `${ownership.file}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(ownership.document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, ownership.file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function probeMcp(node, entry, options = {}) {
  return await new Promise((resolveHandshake) => {
    const probeRoot = mkdtempSync(join(tmpdir(), 'afyx-mcp-probe-'));
    const probeEnv = {
      ...process.env,
      AFYX_GRAPH_NO_DAEMON: '1',
      AFYX_GRAPH_NO_WATCH: '1',
      NODE_DISABLE_COMPILE_CACHE: '1',
      NO_COLOR: '1',
    };
    // The installer probe validates the stdio/tool contract, not any caller's
    // currently selected corpus. Inheriting an external-state binding here can
    // make an otherwise healthy runtime inspect or bind unrelated project
    // state before provider configuration has even been consented.
    delete probeEnv.AFYX_GRAPH_STATE_DIR;
    delete probeEnv.NODE_COMPILE_CACHE;
    const launchArgs = Array.isArray(options.args) ? options.args : [entry, 'serve', '--mcp'];
    const expectedTool = options.tool || 'afyx_graph_explore';
    const child = spawn(node, launchArgs, {
      cwd: probeRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: probeEnv,
    });
    let buffer = '';
    let stderr = '';
    let initialized = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      try { rmSync(probeRoot, { recursive: true, force: true }); } catch {
        child.once('close', () => {
          try { rmSync(probeRoot, { recursive: true, force: true }); } catch { /* best-effort temporary cleanup */ }
        });
      }
      resolveHandshake(result);
    };
    const configuredTimeout = Number.parseInt(process.env.AFYX_MCP_HANDSHAKE_TIMEOUT_MS || '', 10);
    const timeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15_000;
    const timer = setTimeout(() => finish({ ok: false, detail: 'MCP initialize/tool discovery timed out.' }), timeoutMs);
    child.on('error', (error) => finish({ ok: false, detail: error.message }));
    child.on('exit', (code) => finish({ ok: false, detail: `MCP process exited with ${code}: ${stderr.trim() || 'no diagnostic output'}` }));
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2_000); });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1 && !initialized) {
          initialized = true;
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
        } else if (message.id === 2) {
          const names = message.result?.tools?.map((tool) => tool.name) || [];
          finish(names.includes(expectedTool)
            ? { ok: true, detail: `${names.length} tools discovered.` }
            : { ok: false, detail: `MCP tools/list did not expose ${expectedTool}.` });
        }
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'afyx-installer', version: '1.0.0' } } })}\n`);
  });
}


export function editCodexToml(bytes, server, transport, hadEntry) {
  if (!['afyx_graph', 'afyx_workflow'].includes(server)) {
    throw new McpIntegrationError('MCP_UNOWNED_ENTRY', 'Server is outside the AFYX registration contract.');
  }
  const original = bytes?.toString('utf8') ?? '';
  if (bytes && !Buffer.from(original).equals(bytes)) throw new Error('Codex configuration must be valid UTF-8.');
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = original.slice(bom.length);
  const ranges = [];
  const headers = new Set();
  let ownedTable = false;
  let rootFound = false;
  const parsed = parseToml(source, ({ kind, keys, start, end }) => {
    const owned = keys[0] === 'mcp_servers' && keys[1] === server;
    if (kind !== 'value') {
      ownedTable = owned;
      if (kind === 'table' && owned) {
        const key = JSON.stringify(keys);
        if (headers.has(key)) throw new Error('Duplicate AFYX Codex table.');
        headers.add(key);
        rootFound ||= keys.length === 2;
      }
    }
    if (!owned) return;
    if (!ownedTable || kind === 'array-table') throw new Error('Unsupported AFYX Codex table declaration.');
    ranges.push({ start, end });
  });
  if (Object.hasOwn(parsed.mcp_servers ?? {}, server) !== hadEntry || rootFound !== hadEntry) {
    throw new Error('Codex inspection and explicit AFYX TOML table disagree.');
  }
  let offset = 0;
  let preserved = bom;
  for (const { start, end } of ranges) {
    preserved += source.slice(offset, start);
    offset = end;
  }
  preserved += source.slice(offset);
  const quote = (value) => JSON.stringify(value).replace(/\u007f/g, '\\u007f');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const declaration = transport
    ? ['[mcp_servers.' + server + ']', 'command = ' + quote(transport.node), 'args = [' + transport.args.map(quote).join(', ') + ']', ''].join(eol)
    : '';
  const result = preserved + (declaration && preserved !== bom && !preserved.endsWith('\n') ? eol : '') + declaration;
  const verified = parseToml(result).mcp_servers?.[server];
  if (transport ? verified?.command !== transport.node || JSON.stringify(verified?.args) !== JSON.stringify(transport.args) : verified !== undefined) {
    throw new Error('Surgical TOML validation failed.');
  }
  return Buffer.from(result);
}

function replaceCodexConfig(home, backup, bytes) {
  const file = backup.configPath;
  assertSafePath(home, file);
  const stat = backup.existed ? lstatSync(file) : null;
  if (stat && (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()))) {
    throw new McpIntegrationError('CODEX_PATH_UNSAFE', 'Codex configuration is not an exclusively owned regular file.');
  }
  const temporary = mkdtempSync(join(home, '.afyx-config-'));
  try {
    const staged = join(temporary, 'config.toml');
    writeFileSync(staged, bytes, { flag: 'wx', mode: 0o600, flush: true });
    if (stat) chmodSync(staged, stat.mode & 0o777);
    assertSafePath(home, file);
    if (!sameBytes(fileBytes(file), backup.originalBytes)) {
      throw new McpIntegrationError('CONCURRENT_MODIFICATION_DETECTED', 'Codex configuration changed after backup.');
    }
    renameSync(staged, file);
    updateKnownState(backup, bytes);
    if (!sameBytes(fileBytes(file), bytes)) throw new Error('Codex configuration read-back did not match.');
  } finally {
    rmSync(join(temporary, 'config.toml'), { force: true });
    rmdirSync(temporary);
  }
}

export async function integrate(options) {
  if (!options.apply) return integrateCodex(options);
  const home = resolve(options.codexHome);
  const lock = join(home, '.afyx-codex-mcp.lock');
  try {
    assertSafePath(home, lock);
    mkdirSync(home, { recursive: true });
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = lstatSync(lock);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new McpIntegrationError('MCP_LOCK_OWNERSHIP_UNKNOWN', 'Existing MCP lock has no verified ownership record.');
    }
    const stateDir = realpathSync(lock);
    const coordinator = new StateCoordinator({
      stateDir,
      ownerHash: sha256Bytes(stateDir),
      lockTimeoutMs: 1,
    });
    return await coordinator.withLockAsync(() => integrateCodex(options));
  } catch (error) {
    return {
      mcp: 'MCP_BLOCKED',
      changed: false,
      reason: error.code === 'LOCK_TIMEOUT' ? 'CONCURRENT_MODIFICATION_DETECTED' :
        (error.reason || error.code || 'MCP_TRANSACTION_FAILED'),
      detail: 'Codex configuration transaction could not complete. Check ownership of ' + lock + '.',
    };
  }
}

async function integrateCodex(options) {
  const server = options.server || 'afyx_graph';
  const launchArgs = Array.isArray(options.args) ? options.args.map(String) : [options.entry, 'serve', '--mcp'];
  const expectedTool = options.tool || 'afyx_graph_explore';
  const expected = Array.isArray(options.args)
    ? { node: options.node, entry: options.entry, args: launchArgs }
    : { node: options.node, entry: options.entry };
  const result = {
    graph: existsSync(options.entry) ? 'GRAPH_INSTALLED' : 'GRAPH_NOT_INSTALLED',
    cli: existsSync(options.entry) && existsSync(options.node) ? 'CLI_REACHABLE' : 'CLI_BLOCKED',
    mcp: 'MCP_BLOCKED',
    changed: false,
    reason: '',
    detail: '',
  };
  try {
    const codexHome = resolve(options.codexHome);
    assertSafePath(codexHome, resolve(codexHome, 'config.toml'));
    assertSafePath(codexHome, ownershipPath(codexHome));
  } catch (error) {
    result.reason = error instanceof McpIntegrationError ? error.reason : 'CODEX_PATH_UNSAFE';
    result.detail = error instanceof Error ? error.message : String(error);
    return result;
  }
  if (result.cli !== 'CLI_REACHABLE') {
    if (options.uninstall) {
      const codexHome = resolve(options.codexHome);
      if (!existsSync(codexHome) || !options.codex || !existsSync(options.codex)) {
        result.mcp = 'MCP_NOT_CONFIGURED';
        result.detail = 'No Codex home exists; no MCP entry to remove.';
        return result;
      }
      try {
        const inspection = readExisting(options.codex, codexHome, options.providerTimeoutMs, server);
        if (!inspection.existing) {
          result.mcp = 'MCP_NOT_CONFIGURED';
          result.detail = 'No Codex MCP entry is configured.';
          return result;
        }
      } catch {
        result.mcp = 'MCP_NOT_CONFIGURED';
        result.detail = 'No Codex MCP entry is configured.';
        return result;
      }
    } else {
      result.reason = 'MCP_RUNTIME_UNAVAILABLE';
      result.detail = 'Installed MCP entry point or Node.js executable is unavailable.';
      return result;
    }
  }
  if (!options.codex || !existsSync(options.codex)) {
    result.reason = 'CODEX_UNAVAILABLE';
    result.detail = 'Codex CLI is unavailable; Graph runtime remains healthy.';
    return result;
  }
  // Inspection/planning must not create provider state or invoke a provider
  // against a home that does not exist yet. Only an explicitly consented
  // apply may prepare the first CODEX_HOME.
  if (!existsSync(options.codexHome) && !options.apply) {
    result.mcp = 'MCP_NOT_CONFIGURED';
    result.reason = 'MCP_ENTRY_NOT_FOUND';
    result.detail = 'No Codex home exists; registration is available but was not consented.';
    return result;
  }
  if (options.apply) mkdirSync(options.codexHome, { recursive: true });
  const inspectedBytes = options.apply ? fileBytes(resolve(options.codexHome, 'config.toml')) : null;
  let inspection;
  try {
    inspection = readExisting(options.codex, options.codexHome, options.providerTimeoutMs, server);
  } catch (error) {
    result.reason = error instanceof McpIntegrationError ? error.reason : 'MCP_INSPECTION_FAILED';
    result.detail = `Graph runtime is installed; MCP integration failed: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
  let existing = inspection.existing;
  result.reason = inspection.reason;
  let state = classifyEntry(existing, expected, server);
  result.mcp = state;
  if (state === 'MCP_BLOCKED' || existing?.enabled === false) {
    result.mcp = 'MCP_BLOCKED';
    result.reason = 'MCP_INVALID_CONFIGURATION';
    result.detail = `Conflicting or unproven ${server} entry was preserved.`;
    return result;
  }
  let ownership;
  try {
    ownership = readOwnership(options.codexHome);
  } catch (error) {
    result.reason = error instanceof McpIntegrationError ? error.reason : 'MCP_INVALID_OWNERSHIP';
    result.detail = error instanceof Error ? error.message : String(error);
    return result;
  }
  const claim = ownership.document.entries?.[server];
  const matchesClaim = claim?.provider === 'codex' && claim.expected && classifyEntry(existing, claim.expected, server) === 'MCP_CONFIGURED';
  const knownLegacy = existing?.transport?.type === 'stdio' && existing.transport.args?.some((arg) => typeof arg === 'string' && /(?:^|[\\/])(?:afyx-graph|afyx-host-bridge)\.(?:m?js)$/i.test(arg));
  if (options.apply && existing && (options.uninstall || state !== 'MCP_CONFIGURED') && !matchesClaim && !knownLegacy) {
    return { ...result, mcp: 'MCP_BLOCKED', reason: 'MCP_UNOWNED_ENTRY', detail: 'Existing entry has no matching AFYX ownership evidence.' };
  }
  if (options.uninstall) {
    if (!existing) {
      result.mcp = 'MCP_NOT_CONFIGURED';
      result.detail = 'No Codex MCP entry is configured.';
      return result;
    }
    if (!options.apply) {
      result.detail = 'Owned Codex MCP removal is available but was not consented.';
      return result;
    }
    const backup = backupConfig(options.codexHome);
    const markerBefore = fileBytes(ownership.file);
    let markerExpected = markerBefore;
    try {
      if (!sameBytes(inspectedBytes, backup.originalBytes)) throw new McpIntegrationError('CONCURRENT_MODIFICATION_DETECTED', 'Codex configuration changed after inspection.');
      replaceCodexConfig(options.codexHome, backup, editCodexToml(backup.originalBytes, server, null, true));
      if (readExisting(options.codex, options.codexHome, options.providerTimeoutMs, server).existing) throw new Error('Codex MCP removal did not persist.');
      delete ownership.document.entries[server];
      if (Object.keys(ownership.document.entries).length) writeOwnership(ownership);
      else rmSync(ownership.file, { force: true });
      markerExpected = fileBytes(ownership.file);
      result.mcp = 'MCP_NOT_CONFIGURED';
      result.changed = true;
      result.reason = '';
      result.detail = `Owned Codex MCP entry removed; unrelated configuration bytes preserved.`;
      return result;
    } catch (error) {
      const rollback = rollbackConfiguration(backup, { reason: error instanceof Error ? error.message : String(error) });
      const markerRestored = restoreFileGuarded(ownership.file, markerBefore, markerExpected);
      const restored = rollback.restored && markerRestored;
      result.mcp = 'MCP_BLOCKED';
      result.changed = !restored;
      result.reason = rollback.conflict
        ? 'CONCURRENT_MODIFICATION_DETECTED'
        : (restored ? 'MCP_REMOVAL_FAILED' : 'ROLLBACK_INCOMPLETE');
      result.detail = `Codex MCP removal failed${restored ? ' and configuration was restored' : (rollback.conflict ? '; ' + rollback.reason : '; rollback was incomplete')}: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }
  }
  if (!options.apply && state !== 'MCP_CONFIGURED') {
    result.detail = 'Registration is available but was not consented.';
    return result;
  }
  if (options.apply && state !== 'MCP_CONFIGURED') {
    const preflightProbe = await probeMcp(options.node, options.entry, { args: launchArgs, tool: expectedTool });
    if (!preflightProbe.ok) {
      result.mcp = 'MCP_HANDSHAKE_FAILED';
      result.reason = 'MCP_HANDSHAKE_FAILED';
      result.detail = `MCP configuration was not changed: ${preflightProbe.detail}`;
      return result;
    }
    const backup = backupConfig(options.codexHome);
    const ownershipBefore = existsSync(ownership.file) ? readFileSync(ownership.file) : null;
    let ownershipExpected = ownershipBefore;
    try {
      if (!sameBytes(inspectedBytes, backup.originalBytes)) throw new McpIntegrationError('CONCURRENT_MODIFICATION_DETECTED', 'Codex configuration changed after inspection.');
      const edited = editCodexToml(backup.originalBytes, server, { node: options.node, args: launchArgs }, Boolean(existing));
      replaceCodexConfig(options.codexHome, backup, edited);
      inspection = readExisting(options.codex, options.codexHome, options.providerTimeoutMs, server);
      existing = inspection.existing;
      state = classifyEntry(existing, expected, server);
      if (state !== 'MCP_CONFIGURED') throw new Error('Codex MCP registration did not persist the expected direct-Node entry.');
      result.changed = true;
      result.reason = '';
      ownership.document.entries[server] = { provider: 'codex', expected };
      writeOwnership(ownership);
      ownershipExpected = fileBytes(ownership.file);
    } catch (error) {
      const rollback = rollbackConfiguration(backup, { reason: error instanceof Error ? error.message : String(error) });
      const ownershipRestored = restoreFileGuarded(ownership.file, ownershipBefore, ownershipExpected);
      const restored = rollback.restored && ownershipRestored;
      result.mcp = 'MCP_BLOCKED';
      result.changed = !restored;
      result.reason = rollback.conflict
        ? 'CONCURRENT_MODIFICATION_DETECTED'
        : (restored
          ? (error instanceof McpIntegrationError ? error.reason : 'MCP_REGISTRATION_FAILED')
          : 'ROLLBACK_INCOMPLETE');
      result.detail = `Graph runtime is installed; MCP registration failed${restored ? ' and configuration was restored' : (rollback.conflict ? '; ' + rollback.reason : '; rollback was incomplete')}: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }
  }
  const probe = await probeMcp(options.node, options.entry, { args: launchArgs, tool: expectedTool });
  result.mcp = probe.ok ? 'MCP_REACHABLE' : 'MCP_HANDSHAKE_FAILED';
  result.reason = probe.ok ? '' : 'MCP_HANDSHAKE_FAILED';
  result.detail = probe.detail;
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const options = {
    node: resolve(argument('--node')),
    entry: resolve(argument('--entry')),
    codex: argument('--codex') ? resolve(argument('--codex')) : '',
    codexHome: resolve(argument('--codex-home')),
    providerTimeoutMs: Number(argument('--provider-timeout-ms', '15000')),
    apply: process.argv.includes('--apply'),
    uninstall: process.argv.includes('--uninstall'),
  };
  integrate(options).then((result) => {
    console.log(JSON.stringify(result));
    if (result.mcp === 'MCP_BLOCKED' || result.mcp === 'MCP_HANDSHAKE_FAILED') process.exitCode = 2;
  }).catch((error) => {
    console.error(`[mcp-integration] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
