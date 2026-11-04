/**
 * Shared MCP daemon (issue #411).
 *
 * A project gets exactly one detached `afyx-graph serve --mcp` daemon, and
 * every concurrent MCP client attaches to it over a Unix-domain socket (a
 * named pipe on Windows). Each accepted connection becomes its own
 * {@link MCPSession}, but all sessions on a given daemon share one
 * {@link MCPEngine} — one file watcher, one SQLite WAL writer, one
 * tree-sitter warm-up, paid once and amortized across every attached agent.
 *
 * Lifecycle notes (the fuller picture lives in `./index.ts` and `./proxy.ts`):
 *   - Spawned **detached**: its own session/process group, stdio decoupled,
 *     by whichever launcher first finds nothing listening. It is not a child
 *     of any MCP host, so one terminal closing (or one session's Ctrl-C)
 *     can't sever the others — which is also why this process runs with no
 *     PPID watchdog of its own: outliving every individual client is the point.
 *   - Hosts never talk to this process directly; they talk to a thin `proxy`
 *     that pipes to it. The proxy keeps the #277 PPID watchdog, so a
 *     SIGKILL'd host still gets reaped promptly, and that proxy's socket
 *     close decrements this daemon's connected-client count.
 *   - Once the last client leaves, the daemon lingers for
 *     `AFYX_GRAPH_DAEMON_IDLE_TIMEOUT_MS` (300s by default) before exiting —
 *     long enough that back-to-back agent runs in the same project reuse a
 *     warm engine instead of repaying startup, short enough that a
 *     single abandoned session doesn't leak a daemon forever (#277).
 *
 * Owned here: the listening socket and per-connection session spawn, the
 * version-gated hello handshake, the `.afyx-graph/daemon.pid` lockfile
 * (atomic create, no empty-file window, cleanup on exit), the connected-client
 * refcount and idle/inactivity timeout, and graceful shutdown on SIGTERM/SIGINT.
 *
 * NOT owned here: the proxy side (`./proxy.ts`), the decision of whether to
 * run as a daemon at all (`MCPServer` in `./index.ts`), and the MCP protocol
 * state machine itself (`./session.ts`).
 */

import * as fs from 'fs';
import * as net from 'net';
import { MCPEngine } from './engine';
import { MCPSession } from './session';
import { SocketTransport } from './transport';
import {
  type DaemonLockInfo,
  type DaemonControlRequest,
  decodeLockInfo,
  encodeLockInfo,
  getDaemonPidPath,
  getDaemonControlSocketPath,
  getDaemonSocketCandidates,
  getDaemonSocketPath,
  parseDaemonControlRequestLine,
} from './daemon-paths';
import { AfyxGraphPackageVersion } from './version';
import {
  releaseWriterLock,
  tryAcquireWriterLock,
  writerLockHeldMessage,
} from './writer-lock';
import { registerDaemon, deregisterDaemon } from './daemon-registry';
import { isProcessAlive } from './process-liveness';
import { acquireAtomicLockfile, acquireExclusiveFile } from './atomic-lockfile';
import {
  ActivityTimers,
  resolveIdleTimeoutMs,
  resolveMaxIdleMs,
  resolveClientSweepMs,
} from './activity-policy';
import { parseClientHelloLine, peerIsDead, type ClientPeerInfo } from './client-registry';
import { lifecycleTrace } from './lifecycle-trace';
import { bindFirstUsableSocket } from './socket-bind';

/**
 * Grace period for a Windows-only shutdown hazard: calling `process.exit()`
 * while a recursive `fs.watch` handle is still tearing down aborts the
 * process with a libuv `UV_HANDLE_CLOSING` assertion (`0xC0000409`) — hit
 * reliably whenever the watched tree contains a nested repo (a submodule or
 * embedded clone keeps a watch active right through shutdown). The fix lets
 * the loop drain so libuv finishes closing those handles before exiting
 * naturally; this timer is only the backstop for a stray handle that would
 * otherwise hang shutdown indefinitely, so it stays short. See
 * {@link finalizeDaemonExit}.
 */
const WINDOWS_EXIT_DRAIN_GRACE_MS = 2_000;

/**
 * Finalize daemon shutdown. Exits immediately on POSIX — nothing there needs
 * a drain. On Windows, exiting is deferred to a natural loop drain instead of
 * forced (see {@link WINDOWS_EXIT_DRAIN_GRACE_MS}), with an unref'd backstop
 * that only fires if some other handle is still keeping the process alive.
 * Pure and platform/exit-injected so both branches are unit-testable off of
 * an actual Windows box; returns the backstop timer (or null on POSIX) so a
 * caller/test can clear it.
 */
export function finalizeDaemonExit(
  platform: NodeJS.Platform,
  exit: (code: number) => void,
): NodeJS.Timeout | null {
  if (platform !== 'win32') {
    exit(0);
    return null;
  }
  process.exitCode = 0;
  const backstop = setTimeout(() => exit(0), WINDOWS_EXIT_DRAIN_GRACE_MS);
  // Unref so a clean drain (handles closed, nothing else pending) exits on
  // its own well before this fires; it only matters when something else is
  // keeping the loop alive, which is exactly the case it exists to catch.
  backstop.unref?.();
  return backstop;
}

/** How long a connection gets to send its optional client-hello before the daemon gives up waiting. */
const CLIENT_HELLO_TIMEOUT_MS = 3_000;

/** Ceiling on an unterminated hello line — bounds memory against a hostile or broken peer. */
const MAX_HELLO_LINE_BYTES = 4096;

/**
 * The one-shot line the daemon writes to every freshly-accepted connection,
 * before any application byte. Carries the package's own semver so a 0.9.x
 * proxy can refuse to pipe through a 0.10.x daemon (and vice versa) rather
 * than risk a subtle wire mismatch — the proxy falls back to direct mode
 * instead.
 */
export interface DaemonHello {
  afyxGraph: string; // this daemon's package version; must equal the proxy's own
  pid: number;       // informational — useful when eyeballing `ps` output
  socketPath: string; // echoed back purely so the proxy can log where it attached
  protocol: 1 | 2;   // v2 adds a server-side client-registration acknowledgement
}

/**
 * The optional reverse handshake a proxy sends right after accepting the
 * daemon's hello, giving the daemon the proxy's own pids so it can notice
 * that connection's peer dying even when the socket itself never signals
 * close (the Windows named-pipe hazard behind #692). A connection that skips
 * this (a legacy or direct client) just falls back to socket-close lifecycle
 * — nothing here is load-bearing for a well-behaved modern client. The
 * `afyx_graph_client` marker distinguishes it from an ordinary first
 * JSON-RPC message.
 */
export interface DaemonClientHello {
  afyx_graph_client: 1;
  pid: number;             // the proxy process itself
  hostPid: number | null;  // the MCP host, past any launcher shim, if known
  sessionId: string;
}

/** Server-side proof that a proxy is counted as a live daemon client. */
export interface DaemonClientReady {
  afyx_graph_client_ready: 1;
  sessionId: string;
  daemonPid: number;
  daemonStartedAt: number;
  activeClients: number;
}

export interface DaemonStartResult {
  /** Never null once `start()` has resolved successfully. */
  socketPath: string;
  /** The lockfile record as written. */
  lock: DaemonLockInfo;
}

/**
 * The shared daemon for one project root. `start()` resolves once the socket
 * is bound; from then on the instance owns the socket, the engine, and the
 * lockfile until either `stop()` runs or an idle/signal exit fires.
 *
 * Callers must win {@link tryAcquireDaemonLock} for `projectRoot` BEFORE
 * constructing one of these — the atomic create/link inside that helper is
 * what elects a single daemon among racing candidates. The project writer
 * lock (acquired in `start()`) then fences the bind/ownership-refresh window
 * against a concurrent stale-artifact sweep.
 */
export class Daemon {
  private server: net.Server | null = null;
  private controlServer: net.Server | null = null;
  private clients = new Set<MCPSession>();
  /** Per-client peer pids from that connection's optional client-hello, for the liveness sweep. */
  private clientPeers = new Map<MCPSession, ClientPeerInfo>();
  private lastActivityAt = Date.now();
  private readonly activityTimers: ActivityTimers;
  private readonly idleTimeoutMs: number;
  private readonly maxIdleMs: number;
  private engine: MCPEngine;
  private stopping = false;
  private socketPath: string;
  private controlSocketPath: string | null = null;
  private pidPath: string;
  private startedAt = 0;

  constructor(
    private projectRoot: string,
    opts: { idleTimeoutMs?: number; maxIdleMs?: number } = {},
  ) {
    this.socketPath = getDaemonSocketPath(projectRoot);
    this.pidPath = getDaemonPidPath(projectRoot);
    this.idleTimeoutMs = opts.idleTimeoutMs ?? resolveIdleTimeoutMs();
    this.maxIdleMs = opts.maxIdleMs ?? resolveMaxIdleMs();
    this.activityTimers = new ActivityTimers({
      idleTimeoutMs: this.idleTimeoutMs,
      maxIdleMs: this.maxIdleMs,
      clientSweepMs: resolveClientSweepMs(),
    });
    // A daemon serves many concurrent clients on one event loop, so read-tool
    // dispatch is off-loaded to a worker pool here — without it, concurrent
    // explores serialize and starve the transport until clients time out.
    // Direct mode (a single stdio client) leaves the pool off; setting
    // `AFYX_GRAPH_QUERY_POOL_SIZE=0` disables it here too.
    this.engine = new MCPEngine({ queryPool: true });
    this.engine.setProjectPathHint(projectRoot);
  }

  /**
   * Claim the writer lock, bind the socket, refresh the lockfile with the
   * bound path, background engine init, and register the signal handlers.
   * Resolves once listening; the instance then runs until idle or shutdown.
   */
  async start(): Promise<DaemonStartResult> {
    const initialLockContents = this.claimWriterLockAndOwnLockfile();
    const bound = await this.bindSocket();
    this.server = bound.server;
    // Adopt whichever path actually got bound — it may be the tmpdir fallback
    // past an unusable in-project location. Lockfile, registry, permissions,
    // cleanup and status all key off this real path from here on, never the
    // original preferred guess.
    this.socketPath = bound.socketPath;

    // Native Windows keeps lifecycle traffic off the long-lived MCP data
    // pipe. This avoids a busy data-pipe instance making a healthy daemon
    // unmanageable while preserving the original endpoint on POSIX.
    this.controlSocketPath = getDaemonControlSocketPath(this.projectRoot);
    if (this.controlSocketPath) {
      try {
        this.controlServer = await this.listenOnControl(this.controlSocketPath);
      } catch (err) {
        await new Promise<void>((resolve) => bound.server.close(() => resolve()));
        this.cleanupLockfile();
        throw err;
      }
    }

    const lock = this.refreshLockfileAfterBind(bound.server, initialLockContents);
    this.startedAt = lock.startedAt;

    // Backgrounded (see #172): only starts after bind + ownership refresh, so
    // a delayed daemon that already lost the election can never open a
    // second watcher or writer.
    void this.engine.ensureInitialized(this.projectRoot);

    // Best-effort discovery record for `afyx-graph list` / `stop --all`; a
    // missed write only means list's own liveness prune covers it later.
    registerDaemon({ root: this.projectRoot, ...lock });

    process.stderr.write(
      `[Afyx Graph daemon] Listening on ${this.socketPath} (pid ${process.pid}, v${AfyxGraphPackageVersion}). Idle timeout ${this.idleTimeoutMs}ms.\n`
    );
    lifecycleTrace('daemon_started', {
      daemonStartedAt: this.startedAt,
      idleTimeoutMs: this.idleTimeoutMs,
      maxIdleMs: this.maxIdleMs,
    });
    process.once('beforeExit', (code) => lifecycleTrace('daemon_before_exit', { code }));
    process.once('exit', (code) => lifecycleTrace('daemon_process_exit', { code }));

    // No clients yet: arm the idle timer right away so a daemon nobody ever
    // connects to (spawned, then abandoned because its launcher died) can't
    // pin resources forever.
    this.armIdleTimer();
    this.startLivenessTimers();

    process.on('SIGINT', () => this.stop('SIGINT'));
    process.on('SIGTERM', () => this.stop('SIGTERM'));

    return { socketPath: this.socketPath, lock };
  }

  /**
   * #1740: claim the project writer lock before opening/watching, so a
   * concurrent direct-mode `serve --mcp` can't start a second watcher, then
   * confirm the daemon lockfile this process already holds (from
   * `tryAcquireDaemonLock`, run by the caller before construction) is still
   * intact. Returns that lockfile's raw bytes, needed later as the exact
   * compare-and-swap snapshot for the post-bind refresh.
   */
  private claimWriterLockAndOwnLockfile(): string {
    const writer = tryAcquireWriterLock(this.projectRoot, 'daemon');
    if (writer.kind === 'taken') {
      const msg = writerLockHeldMessage(writer.existing, writer.pidPath);
      process.stderr.write(`[Afyx Graph daemon] ${msg}\n`);
      this.cleanupLockfile();
      throw new Error(msg);
    }
    try {
      const raw = fs.readFileSync(this.pidPath, 'utf8');
      if (decodeLockInfo(raw)?.pid !== process.pid) {
        throw new Error('daemon lock belongs to another process');
      }
      return raw;
    } catch {
      releaseWriterLock(this.projectRoot);
      throw new Error('Lost daemon lock ownership before startup.');
    }
  }

  /**
   * Walk the ordered socket candidates (see `daemon-paths.ts`) and bind the
   * first one that works, relocating past anything that can't host an
   * AF_UNIX node at all (ExFAT/FAT external volumes, some network mounts,
   * WSL2 DrvFs → ENOTSUP/EACCES; #997, #974). On total failure this releases
   * the lockfile and every partial socket before rethrowing, so the caller
   * (the bin's own try/catch) exits this detached daemon cleanly and every
   * launcher falls back to direct mode (#974) instead of spinning against a
   * lock that points at our now-dead pid.
   */
  private async bindSocket(): Promise<{ server: net.Server; socketPath: string }> {
    const candidates = getDaemonSocketCandidates(this.projectRoot);
    try {
      return await bindFirstUsableSocket(candidates, (socketPath) => this.listenOn(socketPath), {
        onRelocate: (from, to, code) =>
          process.stderr.write(
            `[Afyx Graph daemon] Socket ${from} unusable (${code}); relocating to ${to}.\n`
          ),
      });
    } catch (err) {
      this.cleanupLockfile();
      if (process.platform !== 'win32') {
        for (const candidate of candidates) {
          try { fs.unlinkSync(candidate); } catch { /* may not exist */ }
        }
      }
      throw err;
    }
  }

  /**
   * Bind one candidate path. Clears a stale socket left by a SIGKILL'd
   * predecessor first — safe because holding the lockfile means no live
   * daemon can own it, and skipping this clear would wedge `listen()` on
   * EADDRINUSE. POSIX permissions are tightened to user-only once bound,
   * since the socket lives under a possibly-shared `.afyx-graph/` or tmpdir.
   */
  private listenOn(socketPath: string): Promise<net.Server> {
    return new Promise<net.Server>((resolve, reject) => {
      if (process.platform !== 'win32') {
        try { fs.unlinkSync(socketPath); } catch { /* not-exists is fine */ }
      }
      const server = net.createServer((socket) => this.handleConnection(socket));
      server.once('error', reject);
      server.listen(socketPath, () => {
        if (process.platform !== 'win32') {
          try { fs.chmodSync(socketPath, 0o600); } catch { /* best-effort */ }
        }
        resolve(server);
      });
    });
  }

  /** Bind the Windows-only lifecycle endpoint; it never accepts MCP traffic. */
  private listenOnControl(socketPath: string): Promise<net.Server> {
    return new Promise<net.Server>((resolve, reject) => {
      const server = net.createServer((socket) => this.handleControlConnection(socket));
      server.once('error', reject);
      server.listen(socketPath, () => resolve(server));
    });
  }

  /**
   * Rewrite the lockfile with the socket path actually bound (which may be a
   * relocated fallback). Refreshed on every successful bind, not only a
   * relocation. The writer lock already fences this against a concurrent
   * stale-artifact sweep; comparing against the exact snapshot read before
   * binding catches the rarer case of a replacement record appearing in
   * between, so this refresh never clobbers someone else's win.
   */
  private refreshLockfileAfterBind(server: net.Server, expectedPriorContents: string): DaemonLockInfo {
    const lock: DaemonLockInfo = {
      pid: process.pid,
      version: AfyxGraphPackageVersion,
      socketPath: this.socketPath,
      ...(this.controlSocketPath ? { controlSocketPath: this.controlSocketPath } : {}),
      startedAt: Date.now(),
    };
    try {
      if (fs.readFileSync(this.pidPath, 'utf8') !== expectedPriorContents) {
        throw new Error('Lost daemon lock ownership after binding.');
      }
      const tempPath = `${this.pidPath}.${process.pid}.bound`;
      fs.writeFileSync(tempPath, encodeLockInfo(lock), { mode: 0o600 });
      fs.renameSync(tempPath, this.pidPath);
      return lock;
    } catch (err) {
      try { server.close(); } catch { /* best-effort */ }
      try { this.controlServer?.close(); } catch { /* best-effort */ }
      this.controlServer = null;
      this.cleanupLockfile();
      throw err;
    }
  }

  /** Currently-connected client count. Exposed for tests / status output. */
  getClientCount(): number {
    return this.clients.size;
  }

  /** The socket path the daemon is (or will be) listening on. */
  getSocketPath(): string {
    return this.socketPath;
  }

  /** Graceful shutdown: stop every session, close the engine, and clear ownership. */
  async stop(reason: string = 'stop'): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    lifecycleTrace('daemon_shutdown_requested', { reason, activeClients: this.clients.size });
    this.activityTimers.stopAll();
    process.stderr.write(`[Afyx Graph daemon] Shutting down (${reason}; clients=${this.clients.size}).\n`);

    // Snapshot before stopping: a session's own teardown must never be able
    // to mutate the Set this loop is iterating.
    for (const session of [...this.clients]) {
      try { session.stop(); } catch { /* best-effort */ }
    }
    this.clients.clear();

    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (this.controlServer) {
      const server = this.controlServer;
      this.controlServer = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    this.engine.stop();
    this.cleanupLockfile();
    deregisterDaemon(this.projectRoot);
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(this.socketPath); } catch { /* may already be gone */ }
    }
    // POSIX exits right here. Windows drains first — `engine.stop()` above
    // already began tearing down the file watcher, and exiting mid-teardown
    // is exactly the hazard `finalizeDaemonExit` exists to avoid.
    finalizeDaemonExit(process.platform, (code) => process.exit(code));
  }

  private handleConnection(socket: net.Socket): void {
    // Hello goes out before anything else, so the proxy can verify versions
    // ahead of any application byte — it reads exactly one line, then forwards.
    const hello: DaemonHello = {
      afyxGraph: AfyxGraphPackageVersion,
      pid: process.pid,
      socketPath: this.socketPath,
      protocol: 2,
    };
    socket.write(JSON.stringify(hello) + '\n');

    lifecycleTrace('connection_accepted', { daemonStartedAt: this.startedAt });
    void readConnectionPreface(socket).then((preface) => {
      if (preface.control) this.handleControlRequest(socket, preface.control);
      else this.acceptSession(socket, preface.peers);
    });
  }

  /**
   * Management-only connection handler for the dedicated Windows pipe.
   * Identity probes read the hello and disconnect; shutdown callers then send
   * exactly one validated control request. Other traffic is rejected.
   */
  private handleControlConnection(socket: net.Socket): void {
    const hello: DaemonHello = {
      afyxGraph: AfyxGraphPackageVersion,
      pid: process.pid,
      socketPath: this.controlSocketPath ?? this.socketPath,
      protocol: 2,
    };
    socket.write(JSON.stringify(hello) + '\n');
    void readConnectionPreface(socket).then((preface) => {
      if (preface.control) this.handleControlRequest(socket, preface.control);
      else if (!socket.destroyed) socket.end();
    });
  }

  /**
   * Accept shutdown only for the exact PID/start identity in our live lock.
   * Host IPC permissions remain the caller-authorization boundary.
   */
  private handleControlRequest(socket: net.Socket, request: DaemonControlRequest): void {
    const matches = request.pid === process.pid && request.startedAt === this.startedAt;
    const reply = {
      afyx_graph_control: 1,
      status: matches ? 'accepted' : 'rejected',
      pid: process.pid,
      startedAt: this.startedAt,
      ...(matches ? {} : { detail: 'control identity does not match the running daemon' }),
    };
    socket.end(JSON.stringify(reply) + '\n', () => {
      if (matches) void this.stop('management request');
    });
  }

  /**
   * Hand a connection, past its optional client-hello, to a fresh session.
   * Fail-safe by construction: `readClientHello` never rejects, so a timeout,
   * an early close, or a non-hello first line all just arrive here as null
   * pids, which falls back to the plain socket-close lifecycle (#692).
   */
  private acceptSession(socket: net.Socket, peers: ClientPeerInfo): void {
    if (socket.destroyed) {
      lifecycleTrace('client_registration_aborted', {
        sessionId: peers.sessionId ?? null,
        proxyPid: peers.pid,
        reason: 'socket-destroyed-before-registration',
      });
      return;
    }
    const transport = new SocketTransport(socket);
    const session = new MCPSession(transport, this.engine, {
      explicitProjectPath: this.projectRoot,
    });
    transport.onClose(() => this.dropClient(session));
    this.clients.add(session);
    this.clientPeers.set(session, peers);
    this.disarmIdleTimer();
    // Legacy same-version proxies do not send sessionId and would forward an
    // acknowledgement as an invalid MCP message. Only v2-aware proxies opt in.
    if (peers.sessionId) {
      const ready: DaemonClientReady = {
        afyx_graph_client_ready: 1,
        sessionId: peers.sessionId,
        daemonPid: process.pid,
        daemonStartedAt: this.startedAt,
        activeClients: this.clients.size,
      };
      socket.write(JSON.stringify(ready) + '\n');
    }
    lifecycleTrace('client_registered', {
      sessionId: peers.sessionId ?? null,
      proxyPid: peers.pid,
      hostPid: peers.hostPid,
      activeClients: this.clients.size,
      daemonStartedAt: this.startedAt,
    });
    session.start();
    // A second 'data' listener, added after the transport's own, that reads
    // nothing — it exists purely to feed the inactivity backstop's clock.
    // Attaching it after the transport's listener means the unshifted
    // client-hello tail still reaches the transport intact.
    socket.on('data', () => { this.lastActivityAt = Date.now(); });
  }

  private dropClient(session: MCPSession): void {
    if (!this.clients.delete(session)) return;
    const peers = this.clientPeers.get(session);
    this.clientPeers.delete(session);
    lifecycleTrace('client_dropped', {
      sessionId: peers?.sessionId ?? null,
      proxyPid: peers?.pid ?? null,
      activeClients: this.clients.size,
    });
    if (this.clients.size === 0) this.armIdleTimer();
  }

  private armIdleTimer(): void {
    lifecycleTrace('idle_timer_arm_requested', {
      activeClients: this.clients.size,
      idleTimeoutMs: this.idleTimeoutMs,
    });
    this.activityTimers.armIdle(this.stopping, () => {
      lifecycleTrace('idle_timer_fired', { activeClients: this.clients.size });
      // Last-second sanity check: a connection landing between the timer
      // firing and now (the only way this races is setImmediate ordering)
      // must not be exited out from under.
      if (this.clients.size > 0) {
        this.armIdleTimer();
        return;
      }
      void this.stop('idle timeout');
    });
  }

  private disarmIdleTimer(): void {
    lifecycleTrace('idle_timer_disarm_requested', { activeClients: this.clients.size });
    this.activityTimers.disarmIdle();
  }

  /**
   * Defense-in-depth against a daemon outliving its clients (#692), covering
   * the cases the plain refcount + idle timer miss because a socket close
   * never arrives:
   *   - **Inactivity backstop** — after `maxIdleMs` of no inbound traffic,
   *     reap the daemon, but only when no connected client can be PROVEN
   *     alive (see {@link backstopShouldExit}); this is the one phantom class
   *     the sweep below can't catch on its own, a connection whose
   *     client-hello never arrived at all, so there is no pid to check.
   *   - **Liveness sweep** — drop any client whose peer process has died
   *     (per its client-hello pids), which re-arms the idle timer the moment
   *     the last real client is gone; this catches a dead peer within one
   *     sweep interval instead of waiting out the whole backstop window.
   * Both timers are unref'd: the listening server is what keeps the loop
   * alive, and neither timer should hold it open by itself.
   */
  private startLivenessTimers(): void {
    this.activityTimers.startLiveness(
      () => {
        if (this.backstopShouldExit(isProcessAlive)) void this.stop('inactivity backstop');
      },
      () => this.reapDeadClients(isProcessAlive),
    );
  }

  /**
   * Decide whether the inactivity backstop should reap the daemon right now.
   * `isAlive` is injected so tests can drive this deterministically; the live
   * timer calls it every tick with the real liveness probe.
   *
   * This backstop exists ONLY for a **phantom** client (#692) — one still
   * counted but actually gone, whose socket close was never delivered. It
   * must never reap a **live-but-quiet** session (connected, peer alive,
   * simply not issuing queries right now): doing so would silently sever the
   * shared daemon out from under that session — and any others sharing it —
   * degrading them all to an in-process engine. `lastActivityAt` only tracks
   * inbound query bytes, and MCP itself has no keepalive, so a perfectly
   * healthy but quiet session does trip the raw inactivity window eventually
   * (~30 minutes by default).
   *
   * So: once that window has elapsed, first drop every provably-dead peer
   * (the same check the periodic sweep runs — a real side effect, not just a
   * probe), then reap the daemon only if NOT ONE remaining client can be
   * proven alive, i.e. every survivor is an unknown-pid connection the sweep
   * has no way to verify. A single provably-alive client is enough to keep
   * the daemon up.
   */
  backstopShouldExit(isAlive: (pid: number) => boolean): boolean {
    if (this.stopping || this.clients.size === 0) return false; // the idle timer owns the no-client case
    if (Date.now() - this.lastActivityAt < this.maxIdleMs) return false; // still inside the window

    this.reapDeadClients(isAlive);
    if (this.clients.size === 0) return false; // the sweep just emptied it — idle timer takes over

    for (const session of this.clients) {
      const peers = this.clientPeers.get(session);
      if (peers != null && peers.pid !== null && !peerIsDead(peers, isAlive)) return false; // one alive client is enough
    }
    return true;
  }

  /**
   * Drop every connected client whose peer process is confirmed gone.
   * `isAlive` is injected for deterministic tests. A client with no known pid
   * (its client-hello never arrived) is left alone here — it depends on the
   * plain socket-close path instead. Returns how many were reaped.
   */
  reapDeadClients(isAlive: (pid: number) => boolean): number {
    if (this.clients.size === 0) return 0;
    const dead: MCPSession[] = [];
    for (const session of this.clients) {
      const peers = this.clientPeers.get(session);
      if (peers && peerIsDead(peers, isAlive)) dead.push(session);
    }
    for (const session of dead) {
      const peers = this.clientPeers.get(session)!;
      process.stderr.write(
        `[Afyx Graph daemon] Reaping client with dead peer (pid ${peers.pid}); clients=${this.clients.size - 1}.\n`
      );
      lifecycleTrace('client_reaped', {
        sessionId: peers.sessionId ?? null,
        proxyPid: peers.pid,
        hostPid: peers.hostPid,
        activeClientsAfter: this.clients.size - 1,
      });
      try { session.stop(); } catch { /* best-effort */ }
      this.dropClient(session);
    }
    return dead.length;
  }

  private cleanupLockfile(): void {
    releaseWriterLock(this.projectRoot);
    try {
      if (!fs.existsSync(this.pidPath)) return;
      // Only remove the lockfile if it still names us — a rare race where
      // another daemon already took over mid-shutdown must not lose its record.
      const info = decodeLockInfo(fs.readFileSync(this.pidPath, 'utf8'));
      if (info && info.pid === process.pid) fs.unlinkSync(this.pidPath);
    } catch { /* best-effort; the process is exiting regardless */ }
  }
}

/**
 * Outcome of {@link tryAcquireDaemonLock}: either the lockfile was won (the
 * caller is now the daemon-elect, free to construct a {@link Daemon}), or it
 * was already held (the caller should proxy to whatever holds it, or — if
 * that holder is dead — clear the lock and retry).
 */
export type AcquireResult =
  | { kind: 'acquired'; pidPath: string; info: DaemonLockInfo }
  | {
      kind: 'taken';
      existing: DaemonLockInfo | null;
      /** The exact bytes read after losing the race; null when unreadable. */
      lockContents: string | null;
      pidPath: string;
    };

/**
 * Atomically create the daemon lockfile with its full record already
 * in place — one candidate wins outright ({@link AcquireResult} `acquired`),
 * everyone else reads back a complete record and gets `taken`.
 *
 * The original naive approach (`O_EXCL` create, then a separate `writeSync`)
 * left a microsecond window where the file existed but was still empty;
 * under concurrent daemon startup a third candidate could read that empty
 * file, decode it as nothing, and unlink the actual winner's lock — the
 * result being two daemons, two watchers, two writers. That window was
 * ordinarily too narrow to hit, until the file watcher's own startup cost
 * widened it enough to reproduce reliably (issue #411 review, must-fix 1).
 *
 * The fix (now shared as {@link acquireAtomicLockfile}) writes the complete
 * record to a private temp file first, then hard-links it into place —
 * `link()` is atomic AND exclusive (EEXIST when the target already exists),
 * so the target becomes visible in one step, already holding a full record.
 * There is no empty-file window left to hit.
 *
 * Filesystems without hard links (#997) — ExFAT/FAT external volumes, some
 * network mounts — can't `link()` at all (ENOTSUP/EPERM), which would
 * otherwise kill the daemon before it ever reached the socket bind.
 * {@link acquireAtomicLockfile} falls back there to an O_EXCL create (still
 * "first writer wins", but the record lands through the fd in a second step,
 * reopening a narrower empty-file window only on those filesystems, only for
 * the few microseconds between create and write). The worst case there is
 * two daemons briefly — strictly better than the daemon never starting.
 */
export function tryAcquireDaemonLock(projectRoot: string): AcquireResult {
  const pidPath = getDaemonPidPath(projectRoot);
  const info: DaemonLockInfo = {
    pid: process.pid,
    version: AfyxGraphPackageVersion,
    socketPath: getDaemonSocketPath(projectRoot),
    startedAt: Date.now(),
  };

  const result = acquireAtomicLockfile(pidPath, encodeLockInfo(info));
  if (result.acquired) return { kind: 'acquired', pidPath, info };

  // Lost the race. Because the winning write was atomic and link'd whole,
  // the file always holds a complete record here — `existing` comes back
  // null only for a genuinely corrupt leftover, never a mid-write straggler.
  const lockContents = result.existingContents;
  const existing = lockContents !== null ? decodeLockInfo(lockContents) : null;
  return { kind: 'taken', existing, lockContents, pidPath };
}

/**
 * Exclusive-create the lockfile (`O_CREAT|O_EXCL`) and write the full record
 * through that same fd — the hard-link-free fallback {@link
 * tryAcquireDaemonLock} uses via {@link acquireAtomicLockfile} on filesystems
 * without `link()`. True means this call won the race and created it; false
 * means EEXIST, another candidate already holds it. Any other error
 * propagates. Exclusivity ("first writer wins") is identical to the link
 * path; the only difference is the brief empty-file window between create
 * and write. Exported so the fallback itself is directly testable.
 */
export function acquireLockViaExclusiveOpen(pidPath: string, info: DaemonLockInfo): boolean {
  return acquireExclusiveFile(pidPath, encodeLockInfo(info));
}

/**
 * Remove a stale lockfile — but only after re-reading it immediately before
 * the unlink, so a different daemon that won the lock in the meantime is
 * never disturbed.
 *
 * The original version of this unconditionally unlinked, which let a racing
 * candidate delete a perfectly healthy daemon's lock (issue #411 review,
 * must-fix 1). Passing `expectedDeadPid` (the pid the caller believed dead)
 * turns the clear into a compare-and-delete: it bails if the file now names
 * a different pid. A live pid is preserved by default too; `allowLivePid` is
 * reserved for a caller that has already disproved daemon identity via the
 * socket hello (#1553), not for ordinary staleness checks. Returns true once
 * the stale lock is confirmed gone (including "was already gone").
 */
export function clearStaleDaemonLock(
  pidPath: string,
  expectedDeadPid?: number,
  opts: { allowLivePid?: boolean; expectedLockContents?: string } = {}
): boolean {
  try {
    const raw = fs.readFileSync(pidPath, 'utf8');
    // The record changed since the caller inspected it — even a same-pid
    // record may now advertise a newly-bound socket, so this snapshot was
    // never actually disproved and must not be deleted.
    if (opts.expectedLockContents !== undefined && raw !== opts.expectedLockContents) return false;

    const info = decodeLockInfo(raw);
    if (info) {
      if (expectedDeadPid !== undefined && info.pid !== expectedDeadPid) return false; // someone else took over
      if (!opts.allowLivePid && info.pid > 0 && isProcessAlive(info.pid)) return false; // liveness alone is normally decisive
    }
    fs.unlinkSync(pidPath);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'; // already gone counts as success
  }
}

// Re-exported so the existing whitebox tests (`daemon-socket-fallback.test.ts`,
// `daemon-client-liveness.test.ts`) keep resolving these straight from
// `./daemon` — their actual homes are `./socket-bind` and `./client-registry`.
export { bindFirstUsableSocket } from './socket-bind';
export { parseClientHelloLine, peerIsDead } from './client-registry';

/**
 * Read the optional client-hello line a proxy sends right after the daemon's
 * own hello. Never rejects — every accepted connection funnels through here,
 * so any failure mode (timeout, an early close, a first line that isn't a
 * hello) resolves with null pids instead, falling back to the ordinary
 * socket-close lifecycle. Whatever bytes were already read past the hello
 * line are unshifted back onto the socket so the session transport sees them
 * as its own first message(s); buffering happens on raw Buffers and the
 * newline search is byte-based specifically so a UTF-8 sequence straddling a
 * chunk boundary in that unshifted tail can never be corrupted.
 */
function readConnectionPreface(socket: net.Socket): Promise<{
  peers: ClientPeerInfo;
  control: DaemonControlRequest | null;
}> {
  return new Promise((resolve) => {
    let buffered: Buffer[] = [];
    let bufferedLength = 0;
    let settled = false;

    const settle = (peers: ClientPeerInfo, putBack?: Buffer, control: DaemonControlRequest | null = null) => {
      if (settled) return;
      settled = true;
      // Pause BEFORE detaching: dropping the last 'data' listener does not
      // stop a flowing stream, so anything arriving (or unshifted) in the gap
      // before the session transport's own listener attaches was previously
      // emitted to zero listeners and silently lost — and left the stream's
      // flow state wedged, never delivering to the next listener either. A
      // proxy whose client-hello landed glued to its initialize hit this
      // roughly 1-in-5 under load: the daemon then answered nothing for the
      // whole session (the #662 flake, and real dead sessions behind it).
      // Pausing here means the unshifted tail and any new bytes just queue;
      // `SocketTransport.start()` resumes the flow explicitly afterward.
      try { socket.pause(); } catch { /* stream already gone */ }
      socket.removeListener('data', onData);
      socket.removeListener('error', onSocketGone);
      socket.removeListener('close', onSocketGone);
      clearTimeout(timer);
      if (process.env.AFYX_GRAPH_MCP_DEBUG) {
        process.stderr.write(`[mcp-debug] clientHello finish pid=${String(peers.pid)} putBack=${putBack ? putBack.length : 0} flowing=${String(socket.readableFlowing)}\n`);
      }
      if (putBack && putBack.length > 0 && !socket.destroyed) {
        try { socket.unshift(putBack); } catch { /* stream already gone */ }
      }
      resolve({ peers, control });
    };

    const onData = (chunk: Buffer | string) => {
      const piece = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      buffered.push(piece);
      bufferedLength += piece.length;
      const accumulated = buffered.length === 1 ? piece : Buffer.concat(buffered, bufferedLength);
      const newlineAt = accumulated.indexOf(0x0a);
      if (newlineAt === -1) {
        // Still no newline. Past the size bound this can't be a hello at
        // all — hand it all back as data; otherwise keep accumulating.
        if (bufferedLength > MAX_HELLO_LINE_BYTES) settle({ pid: null, hostPid: null }, accumulated);
        else buffered = [accumulated];
        return;
      }
      const line = accumulated.subarray(0, newlineAt).toString('utf8');
      const control = parseDaemonControlRequestLine(line);
      if (control) {
        settle({ pid: null, hostPid: null }, undefined, control);
        return;
      }
      const peers = parseClientHelloLine(line);
      if (!peers) {
        // Not a hello (a legacy or direct client) — return the whole buffer
        // untouched so the transport parses it as the real first message.
        settle({ pid: null, hostPid: null }, accumulated);
        return;
      }
      const tail = accumulated.subarray(newlineAt + 1);
      settle(peers, tail.length > 0 ? tail : undefined);
    };

    const onSocketGone = () => settle({ pid: null, hostPid: null });

    // Whatever partial bytes accumulated by the deadline are handed back
    // rather than discarded — dropping them would tear the first message the
    // transport is about to parse.
    const timer = setTimeout(() => {
      const partial = buffered.length === 0
        ? undefined
        : (buffered.length === 1 ? buffered[0] : Buffer.concat(buffered, bufferedLength));
      settle({ pid: null, hostPid: null }, partial);
    }, CLIENT_HELLO_TIMEOUT_MS);
    timer.unref?.();

    socket.on('data', onData);
    socket.on('error', onSocketGone);
    socket.on('close', onSocketGone);
  });
}

/** Exported for test stubs that need to bound the hello-line read. */
export { MAX_HELLO_LINE_BYTES };
