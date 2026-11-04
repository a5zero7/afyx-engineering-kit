/**
 * MCP proxy mode (issue #411).
 *
 * The proxy is a near-transparent stdio↔socket pipe: once it has confirmed
 * the daemon's hello (an exact major.minor.patch match), it stops parsing
 * protocol at all — every byte the MCP host writes to its stdin goes
 * straight to the daemon socket, and every byte the daemon emits goes
 * straight back to the host's stdout, including server-initiated requests
 * like `roots/list`.
 *
 * Lifecycle:
 *   - Exits the moment either side closes: host stdin closing ends the
 *     daemon socket, and the daemon-side socket closing ends host stdout.
 *   - Closing the proxy's own socket is exactly what tells the daemon to
 *     decrement its connected-client count.
 *   - A parent death that never closes stdin (e.g. the MCP host getting
 *     SIGKILL'd) is caught by the proxy's own PPID watchdog — the same
 *     logic direct mode uses; see issue #277.
 */

import * as fs from 'fs';
import * as net from 'net';
import { randomUUID } from 'crypto';
import { DaemonClientHello, DaemonClientReady, DaemonHello, MAX_HELLO_LINE_BYTES } from './daemon';
import { EARLY_PPID } from './early-ppid';
import { HOST_PPID_ENV, installPpidWatchdog, parseHostPpid } from './ppid-watchdog';
import { isProcessAlive } from './process-liveness';
import { armStartupHandshakeTimeout } from './startup-handshake';
import { treatStdinFailureAsShutdown } from './stdin-teardown';
import { AfyxGraphPackageVersion } from './version';
import { SERVER_INFO, PROTOCOL_VERSION } from './session';
import { SERVER_INSTRUCTIONS } from './server-instructions';
import { getStaticTools, type ToolHandler } from './tools';
import { AfyxSessionContext } from './session-context';
import type { MCPEngine } from './engine';
import { ErrorCodes } from './transport';
import { parseToolCallParams } from './tool-registry';
import { lifecycleTrace } from './lifecycle-trace';

/**
 * Env var that opts INTO the "attached to shared daemon" log line, off by
 * default. The line is benign info, but MCP hosts render any server stderr
 * output at error level (appending a stray `undefined` data field), so every
 * healthy attach was showing up as `[error] … undefined`. Set to `1` to
 * surface it while debugging an attach. (#618; approach from #640 by @mturac)
 */
const LOG_ATTACH_ENV = 'AFYX_GRAPH_MCP_LOG_ATTACH';

/** Log a successful daemon attach, gated behind {@link LOG_ATTACH_ENV} (#618). Exported for tests. */
export function logAttachedDaemon(socketPath: string, hello: DaemonHello): void {
  if (process.env[LOG_ATTACH_ENV] !== '1') return;
  process.stderr.write(
    `[Afyx Graph MCP] Attached to shared daemon on ${socketPath} (pid ${hello.pid}, v${hello.afyxGraph}).\n`
  );
}

export interface ProxyResult {
  /**
   * `proxied` — attached to a same-version daemon and piped stdio; the
   * process stays alive until either side closes.
   * `fallback-needed` — the daemon refused us (a version mismatch, or the
   * socket was unreachable), and the caller should run direct mode instead.
   */
  outcome: 'proxied' | 'fallback-needed';
  reason?: string;
}

function daemonVersionMismatchMessage(socketPath: string, foundVersion: string, expectedVersion: string, resolution: string): string {
  return `[Afyx Graph MCP] Found a daemon on ${socketPath} but version (${foundVersion}) ` +
    `differs from ours (${expectedVersion}); ${resolution}.\n`;
}

/**
 * Attempt to attach to the daemon at `socketPath` and pipe stdio through it
 * for the rest of the process's life.
 *
 * Resolves once either: the connection succeeded and one side has since
 * closed (the caller should exit), or the connection never got far enough to
 * pipe anything, in which case the caller can still fall back to direct
 * mode. `expectedVersion` defaults to this package's own version — daemon and
 * proxy must match EXACTLY; a mismatch resolves `fallback-needed` so the
 * caller starts its own server rather than risk a subtle wire
 * incompatibility (accepting two concurrent servers as the price of never
 * silently running a stale daemon against newer client code).
 */
export async function runProxy(
  socketPath: string,
  expectedVersion: string = AfyxGraphPackageVersion,
): Promise<ProxyResult> {
  // POSIX only: a cheap pre-check against a stale socket file pointing at no
  // listening process. A real ECONNREFUSED below still catches the rarer
  // "exists but unbound" race.
  if (process.platform !== 'win32' && !fs.existsSync(socketPath)) {
    return { outcome: 'fallback-needed', reason: 'socket file missing' };
  }

  const socket = net.createConnection(socketPath);
  socket.setEncoding('utf8');

  const hello = await readHelloLine(socket).catch((err) => new Error(String(err)));
  if (hello instanceof Error) {
    return { outcome: 'fallback-needed', reason: hello.message };
  }
  if (hello.afyxGraph !== expectedVersion) {
    process.stderr.write(daemonVersionMismatchMessage(socketPath, hello.afyxGraph, expectedVersion, 'falling back to direct mode'));
    socket.destroy();
    return { outcome: 'fallback-needed', reason: 'version mismatch' };
  }

  const sessionId = randomUUID();
  const readyPromise = hello.protocol >= 2 ? readClientReadyLine(socket, sessionId) : null;
  sendClientHello(socket, sessionId);
  if (hello.protocol >= 2) {
    const ready = await readyPromise!.catch((err) => new Error(String(err)));
    if (ready instanceof Error) {
      socket.destroy();
      return { outcome: 'fallback-needed', reason: ready.message };
    }
    lifecycleTrace('client_registration_acknowledged', {
      sessionId,
      daemonPid: ready.daemonPid,
      daemonStartedAt: ready.daemonStartedAt,
      activeClients: ready.activeClients,
    });
  }
  logAttachedDaemon(socketPath, hello);
  startPpidWatchdog(socket);
  await pipeUntilClose(socket);
  // The host disconnected, or the daemon went away. Piping IS this process's
  // whole job, so exit right now — otherwise stdin's own 'data' listener
  // keeps the loop alive and leaves a zombie launcher behind.
  process.exit(0);
}

/**
 * Connect to the daemon at `socketPath` and verify its hello (an exact
 * version match), WITHOUT piping — the caller owns the returned socket.
 * Resolves null when unreachable/stale (keep polling) or the string
 * `'version-mismatch'` when a daemon answered but isn't ours (a definitive,
 * non-retryable outcome). Used by the local-handshake proxy's background
 * connect attempt.
 */
export async function connectWithHello(
  socketPath: string,
  expectedVersion: string = AfyxGraphPackageVersion,
): Promise<net.Socket | 'version-mismatch' | null> {
  if (process.platform !== 'win32' && !fs.existsSync(socketPath)) return null;

  const socket = net.createConnection(socketPath);
  socket.setEncoding('utf8');
  // Keep an 'error' listener attached for this socket's WHOLE life.
  // `readHelloLine` installs its own and removes it once it settles, which
  // left a window — between that removal and the caller installing its own
  // onDaemonLost handler — where a socket 'error' had no listener at all. An
  // unhandled socket 'error' in Node is rethrown as an uncaughtException,
  // which the global fatal handler turns into `process.exit(1)`; to an MCP
  // client that surfaces as a bare "Transport closed" (#974). Rare on a
  // healthy filesystem, common on flaky AF_UNIX-over-DrvFs (WSL2 /mnt
  // drives). This no-op guard makes the error recoverable — the 'close' that
  // follows drives the caller's normal fallback instead.
  socket.on('error', () => { /* absorbed — see #974; 'close' drives the fallback */ });

  const hello = await readHelloLine(socket).catch(() => null);
  if (!hello) {
    socket.destroy();
    return null; // nothing listening yet — caller keeps polling
  }
  if (hello.afyxGraph !== expectedVersion) {
    // A daemon IS up, just the wrong one — definitive, so don't poll further;
    // the caller serves in-process instead of ever running stale-vs-new.
    process.stderr.write(daemonVersionMismatchMessage(socketPath, hello.afyxGraph, expectedVersion, 'serving this session in-process'));
    socket.destroy();
    return 'version-mismatch';
  }

  const sessionId = randomUUID();
  const readyPromise = hello.protocol >= 2 ? readClientReadyLine(socket, sessionId) : null;
  sendClientHello(socket, sessionId);
  if (hello.protocol >= 2) {
    const ready = await readyPromise!.catch(() => null);
    if (!ready) {
      socket.destroy();
      return null;
    }
    lifecycleTrace('client_registration_acknowledged', {
      sessionId,
      daemonPid: ready.daemonPid,
      daemonStartedAt: ready.daemonStartedAt,
      activeClients: ready.activeClients,
    });
  }
  logAttachedDaemon(socketPath, hello);
  return socket;
}

/**
 * Tell the daemon our own pids right after verifying its hello, so its
 * liveness sweep can reap this client if our process dies WITHOUT the socket
 * ever signalling close (the Windows named-pipe hazard behind #692).
 * Best-effort and sent ahead of any piped byte, so it's always our first
 * line — a write failure here is harmless, the daemon just falls back to the
 * plain socket-close lifecycle. `hostPid` mirrors the PPID watchdog's own
 * choice: the threaded host pid if one was set, else our own captured parent.
 */
function sendClientHello(socket: net.Socket, sessionId: string): void {
  const clientHello: DaemonClientHello = {
    afyx_graph_client: 1,
    pid: process.pid,
    hostPid: parseHostPpid(process.env[HOST_PPID_ENV]) ?? EARLY_PPID,
    sessionId,
  };
  try { socket.write(JSON.stringify(clientHello) + '\n'); } catch { /* best-effort */ }
  lifecycleTrace('client_hello_sent', {
    sessionId,
    proxyPid: process.pid,
    hostPid: clientHello.hostPid,
  });
}

type JsonRpc = Record<string, unknown>;

/** What the local-handshake proxy needs from `MCPServer`, which owns the daemon-spawn machinery and the engine factory. */
export interface LocalHandshakeDeps {
  /** Probe → spawn → retry → verify-hello; resolves a connected daemon socket, or null once the daemon path is genuinely unavailable. */
  getDaemonSocket(): Promise<net.Socket | null>;
  /** Lazily build an in-process engine — used ONLY if the daemon never comes up, so the handshake speedup never costs the old fall-back robustness. */
  makeEngine(): MCPEngine;
  /** Project root for that fallback engine's lazy init. */
  root: string;
}

/** Static local answers keyed by method — everything here is content the client can have before any daemon exists. */
const STATIC_LOCAL_RESULTS: Record<string, () => JsonRpc> = {
  'tools/list': () => ({ tools: getStaticTools() }),
  // No resources exposed — answered locally so the probe never reaches the
  // daemon as an unhandled method and logs a stray -32601 (#621).
  'resources/list': () => ({ resources: [] }),
  'resources/templates/list': () => ({ resourceTemplates: [] }),
  'prompts/list': () => ({ prompts: [] }),
};

function buildInitializeResult(): JsonRpc {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  };
}

type RuntimeToolHandler = Pick<ToolHandler, 'executeRuntime'>;

/** Execute one request after the daemon has become unavailable. */
export async function handleLocalFallbackMessage(
  msg: JsonRpc,
  context: AfyxSessionContext,
  getToolHandler: () => Promise<RuntimeToolHandler>,
): Promise<JsonRpc | null> {
  const id = msg.id;
  if (msg.method === 'tools/call' && id !== undefined) {
    const parsed = parseToolCallParams(msg.params);
    if (!parsed.ok) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: ErrorCodes.InvalidParams, message: parsed.message },
      };
    }
    try {
      const handler = await getToolHandler();
      const { name, args } = parsed.call;
      const result = await context.execute(
        name,
        args,
        (toolName, prepared) => handler.executeRuntime(toolName, prepared),
      );
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: ErrorCodes.InternalError, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
  if (msg.method === 'ping' && id !== undefined) {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (id !== undefined && msg.method !== 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: ErrorCodes.MethodNotFound, message: `Method not found: ${String(msg.method)}` },
    };
  }
  return null;
}

/**
 * Session state for the local-handshake proxy (the cold-start fix): answers
 * `initialize`/`tools/list`/etc. from static constants the instant the
 * client asks, instead of waiting on the daemon to spawn and bind (~600ms),
 * which used to produce a "No such tool available" race that made headless
 * agents flail into grep/Read before tools registered. Tool CALLS still
 * forward to the shared daemon, connected in the background; that daemon's
 * own reply to the `initialize` this class forwards to prime it is
 * suppressed, since the client already has the local one. If the daemon
 * never comes up at all (a version mismatch or a spawn failure), a lazily
 * created in-process engine serves calls instead, so the handshake speedup
 * never costs the old fall-back-to-direct robustness.
 */
class LocalHandshakeSession {
  private daemonStatus: 'connecting' | 'ready' | 'failed' = 'connecting';
  private daemonSocket: net.Socket | null = null;
  private clientInitId: unknown = undefined; // suppresses the daemon's reply to the initialize forwarded to prime it
  private readonly pending: string[] = []; // client lines buffered until the daemon resolves one way or the other
  private engine: MCPEngine | null = null;
  private engineReady: Promise<void> | null = null;
  private shuttingDown = false;
  // Forwarded-to-the-daemon requests not yet answered, keyed by JSON-RPC id.
  // If the daemon dies mid-session (#662 — an MCP host may SIGTERM the shared
  // daemon exactly when a new session starts), these would otherwise hang
  // forever; re-serving them in-process means the host always gets a reply.
  private readonly inflight = new Map<unknown, string>();
  // Per-host state for daemon-unavailable fallback. Daemon-backed calls use the
  // daemon connection's independent context and the two histories never merge.
  private readonly context = new AfyxSessionContext();

  constructor(private readonly deps: LocalHandshakeDeps) {}

  private writeClient(obj: JsonRpc | string): void {
    try { process.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n'); } catch { /* host gone */ }
  }

  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    lifecycleTrace('proxy_shutdown_requested', {
      daemonReady: this.daemonStatus === 'ready',
      hasDaemonSocket: this.daemonSocket !== null,
    });
    try { this.daemonSocket?.destroy(); } catch { /* ignore */ }
    try { this.engine?.stop(); } catch { /* ignore */ }
    process.exit(0);
  }

  private ensureEngine(): Promise<void> {
    if (!this.engine) this.engine = this.deps.makeEngine();
    if (!this.engineReady) this.engineReady = this.engine.ensureInitialized(this.deps.root).catch(() => { /* degraded */ });
    return this.engineReady;
  }

  private trackInflight(line: string): void {
    try {
      const msg = JSON.parse(line) as JsonRpc;
      if (msg && msg.id !== undefined && typeof msg.method === 'string' && msg.method !== 'initialize') {
        this.inflight.set(msg.id, line);
      }
    } catch { /* unparseable — nothing we could re-serve anyway */ }
  }

  /** Daemon-unavailable fallback: serve one client message entirely in-process. */
  private async handleLocally(line: string): Promise<void> {
    let msg: JsonRpc;
    try { msg = JSON.parse(line) as JsonRpc; } catch { return; }
    const response = await handleLocalFallbackMessage(
      msg,
      this.context,
      async () => {
        await this.ensureEngine();
        return this.engine!.getToolHandler();
      },
    );
    if (response) this.writeClient(response);
  }

  private routeToDaemon(line: string): void {
    if (this.daemonStatus === 'ready' && this.daemonSocket) {
      this.trackInflight(line);
      if (process.env.AFYX_GRAPH_MCP_DEBUG) process.stderr.write(`[mcp-debug] proxy->daemon ${line.slice(0, 80)}\n`);
      try { this.daemonSocket.write(line.endsWith('\n') ? line : line + '\n'); } catch { /* close path */ }
      return;
    }
    if (this.daemonStatus === 'failed') {
      void this.handleLocally(line);
      return;
    }
    if (process.env.AFYX_GRAPH_MCP_DEBUG) process.stderr.write(`[mcp-debug] proxy-buffer(${this.daemonStatus}) ${line.slice(0, 80)}\n`);
    this.pending.push(line);
  }

  /** Handle one already-trimmed, non-empty line from the client's stdin. */
  private handleClientLine(line: string): void {
    let msg: JsonRpc;
    try { msg = JSON.parse(line) as JsonRpc; } catch { this.routeToDaemon(line); return; }

    if (msg.method === 'initialize') {
      this.clientInitId = msg.id;
      this.writeClient({ jsonrpc: '2.0', id: msg.id, result: buildInitializeResult() });
      this.routeToDaemon(line); // primes the daemon so it resolves the project; its reply is suppressed below
      return;
    }
    const method = typeof msg.method === 'string' ? msg.method : undefined;
    const staticResult = method ? STATIC_LOCAL_RESULTS[method] : undefined;
    if (staticResult) {
      this.writeClient({ jsonrpc: '2.0', id: msg.id, result: staticResult() });
      return;
    }
    this.routeToDaemon(line);
  }

  private attachStdin(): void {
    let stdinBuffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      stdinBuffer += chunk;
      let newlineAt: number;
      while ((newlineAt = stdinBuffer.indexOf('\n')) !== -1) {
        const line = stdinBuffer.slice(0, newlineAt).trim();
        stdinBuffer = stdinBuffer.slice(newlineAt + 1);
        if (line) this.handleClientLine(line);
      }
    });
  }

  /** Fall back to in-process for the rest of the session (#662): the daemon going away must never end it. */
  private handleDaemonLost(): void {
    if (this.shuttingDown || this.daemonStatus !== 'ready') return; // host teardown, or already handled
    lifecycleTrace('daemon_connection_lost', { inflightRequests: this.inflight.size });
    this.daemonStatus = 'failed';
    try { this.daemonSocket?.destroy(); } catch { /* ignore */ }
    this.daemonSocket = null;
    process.stderr.write(
      `[Afyx Graph MCP] Shared daemon connection lost; serving this session in-process (degraded), re-serving ${this.inflight.size} in-flight request(s).\n`
    );
    const orphaned = [...this.inflight.values()];
    this.inflight.clear();
    for (const line of orphaned) void this.handleLocally(line);
  }

  private attachDaemonSocket(socket: net.Socket): void {
    this.daemonSocket = socket;
    this.daemonStatus = 'ready';

    let socketBuffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      socketBuffer += chunk;
      let newlineAt: number;
      while ((newlineAt = socketBuffer.indexOf('\n')) !== -1) {
        const line = socketBuffer.slice(0, newlineAt);
        socketBuffer = socketBuffer.slice(newlineAt + 1);
        if (!line.trim()) continue;
        let resp: JsonRpc | null = null;
        try { resp = JSON.parse(line) as JsonRpc; } catch { /* not JSON — relay verbatim */ }
        if (process.env.AFYX_GRAPH_MCP_DEBUG) process.stderr.write(`[mcp-debug] daemon->proxy ${line.slice(0, 80)}\n`);
        if (resp && resp.id !== undefined && ('result' in resp || 'error' in resp)) {
          this.inflight.delete(resp.id); // answered — no longer in flight
          // Suppress the daemon's reply to the priming initialize — the
          // client already received the local handshake response for it.
          if (this.clientInitId !== undefined && resp.id === this.clientInitId) continue;
        }
        this.writeClient(line);
      }
    });

    socket.on('close', () => this.handleDaemonLost());
    socket.on('error', () => this.handleDaemonLost());

    while (this.pending.length > 0) {
      const line = this.pending.shift()!;
      this.trackInflight(line);
      if (process.env.AFYX_GRAPH_MCP_DEBUG) process.stderr.write(`[mcp-debug] proxy-flush ${line.slice(0, 80)}\n`);
      try { socket.write(line + '\n'); } catch { /* ignore */ }
    }
  }

  private async failDaemonAndDrainPending(): Promise<void> {
    if (this.shuttingDown) return;
    this.daemonStatus = 'failed';
    process.stderr.write('[Afyx Graph MCP] Shared daemon unavailable; serving this session in-process (degraded).\n');
    while (this.pending.length > 0) {
      await this.handleLocally(this.pending.shift()!);
    }
  }

  /** Run the session until `shutdown()` exits the process. */
  async run(): Promise<void> {
    this.attachStdin();
    // Shut down when stdin ends/closes — and also on a stdin 'error', which a
    // socket-backed stdin (the VS Code stdio shape) can emit on client death
    // instead of a clean close; destroying it stops a hung fd from
    // busy-spinning the event loop (#799).
    treatStdinFailureAsShutdown(() => this.shutdown());
    installLocalHandshakePpidWatchdog(() => this.shutdown());
    // Backstop for a launch abandoned before any of the above could see it:
    // a killed launcher + held-open pipes + a reparent that beat the
    // EARLY_PPID capture (#1185). A server that never receives a single byte
    // isn't serving anyone. Armed after the stdin consumer above, so no
    // bytes are emitted while only the backstop's own listener exists.
    armStartupHandshakeTimeout(() => {
      process.stderr.write(
        '[Afyx Graph MCP] No MCP traffic since startup; assuming an abandoned launch and shutting down (#1185). ' +
        'Tune with AFYX_GRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS (0 disables).\n'
      );
      this.shutdown();
    });

    let socket: net.Socket | null = null;
    try { socket = await this.deps.getDaemonSocket(); } catch { socket = null; }

    // `!socket.destroyed`: the connect-window error guard in `connectWithHello`
    // can absorb an 'error' that already destroyed the socket before we got
    // here (#974) — treat a dead socket the same as "no daemon" so this
    // falls back cleanly to the in-process engine.
    if (socket && !socket.destroyed && !this.shuttingDown) {
      this.attachDaemonSocket(socket);
    } else if (!this.shuttingDown) {
      await this.failDaemonAndDrainPending();
    }

    await new Promise<void>(() => { /* stdin keeps the loop alive; exit only via shutdown() */ });
  }
}

/**
 * Local-handshake proxy entry point: answer the MCP handshake locally for
 * instant tool registration while a shared-daemon connection resolves in the
 * background. See {@link LocalHandshakeSession} for the full behavior.
 */
export async function runLocalHandshakeProxy(deps: LocalHandshakeDeps): Promise<void> {
  await new LocalHandshakeSession(deps).run();
}

/**
 * PPID watchdog for the local-handshake proxy — the same #277 decision logic
 * every watchdog in this file shares, just with no socket of its own to
 * close (the caller's `shutdown()` handles teardown).
 */
function installLocalHandshakePpidWatchdog(onDeath: () => void): void {
  installPpidWatchdog(
    (reason) => {
      process.stderr.write(`[Afyx Graph MCP] Parent process exited (${reason}); shutting down.\n`);
      onDeath();
    },
    watchdogOptionsFromEnv(),
  );
}

/**
 * Shared option-building for both live PPID-watchdog installs in this file:
 * the baseline pid comes from the CLI entry's earliest capture rather than
 * `process.ppid` here, since a launcher killed during our first ~100ms would
 * otherwise leave that baseline at 1 and blind the divergence check forever
 * (#1185).
 */
function watchdogOptionsFromEnv() {
  return {
    originalPpid: EARLY_PPID,
    hostPpid: parseHostPpid(process.env[HOST_PPID_ENV]),
    isAlive: isProcessAlive,
    pollMsRaw: process.env.AFYX_GRAPH_PPID_POLL_MS,
  };
}

/**
 * Read one newline-terminated JSON line from `socket`, parse it as the
 * daemon's hello, and resolve it. Bounded to {@link MAX_HELLO_LINE_BYTES} so
 * a broken or hostile peer can't OOM this process. Times out after 3s — a
 * healthy daemon sends its hello the instant it accepts the connection.
 */
function readHelloLine(socket: net.Socket): Promise<DaemonHello> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const detach = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onSocketError);
      socket.removeListener('close', onSocketClose);
      clearTimeout(timer);
    };
    const onData = (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const newlineAt = buffer.indexOf('\n');
      if (newlineAt === -1) {
        if (buffer.length > MAX_HELLO_LINE_BYTES) {
          detach();
          reject(new Error('daemon hello line exceeded size limit'));
        }
        return;
      }
      const line = buffer.slice(0, newlineAt);
      const tail = buffer.slice(newlineAt + 1); // re-emitted below so the pipe stage still sees it
      detach();
      if (tail.length > 0) socket.unshift(tail); // net.Socket readables support unshift()
      try {
        const parsed = JSON.parse(line) as DaemonHello;
        if (typeof parsed.afyxGraph !== 'string' || typeof parsed.pid !== 'number') {
          reject(new Error('daemon hello missing required fields'));
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(new Error(`daemon hello not JSON: ${err instanceof Error ? err.message : String(err)}`));
      }
    };
    const onSocketError = (err: Error) => { detach(); reject(err); };
    const onSocketClose = () => { detach(); reject(new Error('daemon closed connection before hello')); };
    const timer = setTimeout(() => {
      detach();
      reject(new Error('timed out waiting for daemon hello'));
    }, 3000);
    timer.unref?.();
    socket.on('data', onData);
    socket.on('error', onSocketError);
    socket.on('close', onSocketClose);
  });
}

/**
 * Wait for protocol-v2 proof that this exact proxy session is registered in
 * the daemon's live-client set. The listener is installed before the reverse
 * hello is written, so even a same-tick acknowledgement cannot be lost.
 */
function readClientReadyLine(socket: net.Socket, expectedSessionId: string): Promise<DaemonClientReady> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const detach = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onSocketError);
      socket.removeListener('close', onSocketClose);
      clearTimeout(timer);
    };
    const onData = (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const newlineAt = buffer.indexOf('\n');
      if (newlineAt === -1) {
        if (buffer.length > MAX_HELLO_LINE_BYTES) {
          detach();
          reject(new Error('daemon client-ready line exceeded size limit'));
        }
        return;
      }
      const line = buffer.slice(0, newlineAt);
      const tail = buffer.slice(newlineAt + 1);
      detach();
      if (tail.length > 0) socket.unshift(tail);
      try {
        const parsed = JSON.parse(line) as Partial<DaemonClientReady>;
        if (
          parsed.afyx_graph_client_ready !== 1 ||
          parsed.sessionId !== expectedSessionId ||
          typeof parsed.daemonPid !== 'number' ||
          typeof parsed.daemonStartedAt !== 'number' ||
          typeof parsed.activeClients !== 'number' ||
          parsed.activeClients < 1
        ) {
          reject(new Error('daemon client-ready identity did not match the proxy session'));
          return;
        }
        resolve(parsed as DaemonClientReady);
      } catch (err) {
        reject(new Error(`daemon client-ready not JSON: ${err instanceof Error ? err.message : String(err)}`));
      }
    };
    const onSocketError = (err: Error) => { detach(); reject(err); };
    const onSocketClose = () => { detach(); reject(new Error('daemon closed connection before client registration')); };
    const timer = setTimeout(() => {
      detach();
      reject(new Error('timed out waiting for daemon client registration'));
    }, 3000);
    timer.unref?.();
    socket.on('data', onData);
    socket.on('error', onSocketError);
    socket.on('close', onSocketClose);
  });
}

/**
 * Pipe stdin → socket and socket → stdout until either end closes, resolving
 * so the caller can exit. Deliberately not `process.stdin.pipe(socket)`:
 * pipe() propagates 'end' onto its downstream, which would close the socket
 * the moment stdin ends early — but the MCP spec allows stdin to stay open
 * across reconnects, so that propagation would be wrong here.
 */
function pipeUntilClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };

    process.stdin.on('data', (chunk) => {
      try { socket.write(chunk); } catch { /* the close path below catches a broken socket */ }
    });
    process.stdin.on('end', () => {
      try { socket.end(); } catch { /* ignore */ }
      finish();
    });
    // Both 'close' and 'error' tear down: a socket-backed stdin can fail with
    // an 'error' (ECONNRESET/hangup) instead of a clean close; destroying it
    // stops a hung fd from busy-spinning the event loop (#799).
    const teardown = () => {
      try { process.stdin.destroy(); } catch { /* ignore */ }
      try { socket.destroy(); } catch { /* ignore */ }
      finish();
    };
    process.stdin.on('close', teardown);
    process.stdin.on('error', teardown);

    socket.on('data', (chunk) => {
      try { process.stdout.write(chunk); } catch { /* ignore */ }
    });
    socket.on('end', finish);
    socket.on('close', finish);
    socket.on('error', (err) => {
      process.stderr.write(`[Afyx Graph MCP] daemon socket error: ${err.message}\n`);
      finish();
    });
  });
}

/**
 * PPID watchdog mirroring `MCPServer.start`'s own: kills the proxy if the MCP
 * host (or its proxy of a host — see `HOST_PPID_ENV`) disappears without
 * closing stdin. Issue #277 covers why stdin EOF alone can't be trusted on
 * Linux: a SIGKILL'd parent reparents without closing its pipes. The proxy's
 * own "kill" is cheap — just a socket close + `process.exit()`, no SQLite or
 * watchers to tear down.
 */
function startPpidWatchdog(socket: net.Socket): void {
  installPpidWatchdog(
    (reason) => {
      process.stderr.write(`[Afyx Graph MCP] Parent process exited (${reason}); shutting down.\n`);
      try { socket.destroy(); } catch { /* ignore */ }
      process.exit(0);
    },
    watchdogOptionsFromEnv(),
  );
}
