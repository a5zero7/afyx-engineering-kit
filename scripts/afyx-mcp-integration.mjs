#!/usr/bin/env node
/** Consent-safe Codex MCP registration through the native `codex mcp` CLI. */
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalized(value) {
  return normalize(String(value || '')).toLowerCase();
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

export function classifyEntry(existing, expected) {
  if (!existing) return 'MCP_NOT_CONFIGURED';
  const transport = existing.transport || {};
  const args = Array.isArray(transport.args) ? transport.args : [];
  const expectedNode = normalized(expected.node);
  const actualNode = normalized(transport.command);
  const executableName = (value) => basename(value).replace(/\.exe$/i, '');
  const nodeMatches = actualNode === expectedNode || executableName(actualNode) === executableName(expectedNode);
  const afyxShape = transport.type === 'stdio' && args.length === 3 &&
    /(?:^|[\\/])lib[\\/]dist[\\/]bin[\\/]afyx-graph\.js$/i.test(String(args[0])) &&
    args[1] === 'serve' && args[2] === '--mcp';
  if (!afyxShape) return 'MCP_BLOCKED';
  if (nodeMatches && normalized(args[0]) === normalized(expected.entry)) return 'MCP_CONFIGURED';
  return 'MCP_STALE_OWNED';
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

function requireCodexSuccess(result, action) {
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
    throw new McpIntegrationError('CODEX_TIMEOUT', `${action} timed out within the bounded provider execution window.`);
  }
  if (result.error || result.status === null) {
    throw new McpIntegrationError(
      'CODEX_LAUNCH_FAILED',
      `${action} could not launch Codex CLI: ${commandDiagnostic(result) || 'unknown process launch failure'}`,
    );
  }
  if (result.status !== 0) {
    throw new McpIntegrationError(
      'MCP_REGISTRATION_FAILED',
      `${action} failed with exit code ${result.status}: ${commandDiagnostic(result) || 'no diagnostic output'}`,
    );
  }
  return result;
}

function readExisting(codex, codexHome, providerTimeoutMs) {
  const result = codexRun(codex, codexHome, ['mcp', 'get', 'afyx_graph', '--json'], providerTimeoutMs);
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
  if (!existsSync(config)) return { config, backup: null, existed: false, before: null, expected: null };
  const backup = `${config}.afyx-backup`;
  const before = readFileSync(config);
  copyFileSync(config, backup);
  return { config, backup, existed: true, before, expected: before };
}

function restoreBackup(backup) {
  if (!backup || !sameBytes(fileBytes(backup.config), backup.expected)) return false;
  if (backup.existed) {
    copyFileSync(backup.backup, backup.config);
    rmSync(backup.backup, { force: true });
  } else {
    rmSync(backup.config, { force: true });
  }
  return sameBytes(fileBytes(backup.config), backup.before);
}

function removeBackup(backup) {
  if (backup?.backup) rmSync(backup.backup, { force: true });
}

function fileBytes(file) {
  return existsSync(file) ? readFileSync(file) : null;
}

function sameBytes(left, right) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function markBackupState(backup) {
  if (backup) backup.expected = fileBytes(backup.config);
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

export async function probeMcp(node, entry) {
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
    const child = spawn(node, [entry, 'serve', '--mcp'], {
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
          finish(names.includes('afyx_graph_explore')
            ? { ok: true, detail: `${names.length} tools discovered.` }
            : { ok: false, detail: 'MCP tools/list did not expose afyx_graph_explore.' });
        }
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'afyx-installer', version: '1.0.0' } } })}\n`);
  });
}

export async function integrate(options) {
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
    result.reason = 'GRAPH_RUNTIME_UNAVAILABLE';
    result.detail = 'Installed entry point or Node.js executable is unavailable.';
    return result;
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
  let inspection;
  try {
    inspection = readExisting(options.codex, options.codexHome, options.providerTimeoutMs);
  } catch (error) {
    result.reason = error instanceof McpIntegrationError ? error.reason : 'MCP_INSPECTION_FAILED';
    result.detail = `Graph runtime is installed; MCP integration failed: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
  let existing = inspection.existing;
  result.reason = inspection.reason;
  let state = classifyEntry(existing, options);
  result.mcp = state;
  if (state === 'MCP_BLOCKED') {
    result.reason = 'MCP_INVALID_CONFIGURATION';
    result.detail = 'Conflicting or unproven afyx_graph entry was preserved.';
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
  if (options.uninstall) {
    if (!existing) {
      result.mcp = 'MCP_NOT_CONFIGURED';
      result.detail = 'No Codex MCP entry is configured.';
      return result;
    }
    const claim = ownership.document.entries?.afyx_graph;
    const claimedExpected = claim?.provider === 'codex' ? claim.expected : null;
    if (!claimedExpected || classifyEntry(existing, claimedExpected) !== 'MCP_CONFIGURED') {
      result.mcp = 'MCP_BLOCKED';
      result.reason = 'MCP_UNOWNED_ENTRY';
      result.detail = 'Codex afyx_graph entry lacks a matching Afyx ownership marker and was preserved.';
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
      requireCodexSuccess(codexRun(options.codex, options.codexHome, ['mcp', 'remove', 'afyx_graph'], options.providerTimeoutMs), 'Codex MCP removal');
      markBackupState(backup);
      if (readExisting(options.codex, options.codexHome, options.providerTimeoutMs).existing) throw new Error('Codex MCP removal did not persist.');
      delete ownership.document.entries.afyx_graph;
      if (Object.keys(ownership.document.entries).length) writeOwnership(ownership);
      else rmSync(ownership.file, { force: true });
      markerExpected = fileBytes(ownership.file);
      removeBackup(backup);
      result.mcp = 'MCP_NOT_CONFIGURED';
      result.changed = true;
      result.reason = '';
      result.detail = 'Owned Codex MCP entry removed; unrelated configuration preserved.';
      return result;
    } catch (error) {
      const configRestored = restoreBackup(backup);
      const markerRestored = restoreFileGuarded(ownership.file, markerBefore, markerExpected);
      const restored = configRestored && markerRestored;
      result.mcp = 'MCP_BLOCKED';
      result.changed = !restored;
      result.reason = restored ? 'MCP_REMOVAL_FAILED' : 'ROLLBACK_INCOMPLETE';
      result.detail = `Codex MCP removal failed${restored ? ' and configuration was restored' : '; exact-byte rollback was refused because provider state changed outside the last known Afyx mutation'}: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }
  }
  if (!options.apply && state !== 'MCP_CONFIGURED') {
    result.detail = 'Registration is available but was not consented.';
    return result;
  }
  if (options.apply && state !== 'MCP_CONFIGURED') {
    const preflightProbe = await probeMcp(options.node, options.entry);
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
      if (state === 'MCP_STALE_OWNED') {
        const removed = codexRun(options.codex, options.codexHome, ['mcp', 'remove', 'afyx_graph'], options.providerTimeoutMs);
        requireCodexSuccess(removed, 'Codex MCP removal');
        markBackupState(backup);
      }
      const added = codexRun(options.codex, options.codexHome, ['mcp', 'add', 'afyx_graph', '--', options.node, options.entry, 'serve', '--mcp'], options.providerTimeoutMs);
      requireCodexSuccess(added, 'Codex MCP registration');
      markBackupState(backup);
      inspection = readExisting(options.codex, options.codexHome, options.providerTimeoutMs);
      existing = inspection.existing;
      state = classifyEntry(existing, options);
      if (state !== 'MCP_CONFIGURED') throw new Error('Codex MCP registration did not persist the expected direct-Node entry.');
      result.changed = true;
      result.reason = '';
      ownership.document.entries.afyx_graph = { provider: 'codex', expected: { node: options.node, entry: options.entry } };
      writeOwnership(ownership);
      ownershipExpected = fileBytes(ownership.file);
      removeBackup(backup);
    } catch (error) {
      const configRestored = restoreBackup(backup);
      const ownershipRestored = restoreFileGuarded(ownership.file, ownershipBefore, ownershipExpected);
      const restored = configRestored && ownershipRestored;
      result.mcp = 'MCP_BLOCKED';
      result.changed = !restored;
      result.reason = restored
        ? (error instanceof McpIntegrationError ? error.reason : 'MCP_REGISTRATION_FAILED')
        : 'ROLLBACK_INCOMPLETE';
      result.detail = `Graph runtime is installed; MCP registration failed${restored ? ' and configuration was restored' : '; exact-byte rollback was refused because provider state changed outside the last known Afyx mutation'}: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }
  }
  const probe = await probeMcp(options.node, options.entry);
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
