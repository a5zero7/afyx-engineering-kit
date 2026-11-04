/**
 * Afyx Graph MCP server.
 *
 * Exposes Afyx Graph's code-intelligence functionality as Model Context
 * Protocol tools for AI assistants.
 *
 * @module mcp
 *
 * @example
 * ```typescript
 * import { MCPServer } from 'afyx-graph';
 *
 * const server = new MCPServer('/path/to/project');
 * await server.start();
 * ```
 *
 * `MCPServer.start()` picks one of three runtime modes:
 *
 * - **Direct** — one process serves one MCP client over stdio. This is the
 *   original pre-#411 shape; it's used when the operator opts out
 *   (`AFYX_GRAPH_NO_DAEMON=1`), no `.afyx-graph/` is reachable, or the daemon
 *   machinery fails for any reason.
 * - **Proxy** — what an MCP host actually talks to whenever sharing is on: a
 *   thin stdio↔socket pipe to the shared daemon, carrying its own #277 PPID
 *   watchdog so a SIGKILL'd host still reaps its proxy promptly. See
 *   {@link ./proxy.ts}.
 * - **Daemon** — a detached background process (its own session/process
 *   group) serving N proxies over one Unix-domain socket or named pipe,
 *   sharing a single Afyx Graph engine + watcher + SQLite handle. Spawned on
 *   demand, never a child of any host, so it survives individual sessions
 *   and is reaped by client-refcount + idle timeout. See {@link ./daemon.ts}
 *   and issue #411.
 *
 * The detached-daemon-plus-always-proxy split exists because the original
 * in-process daemon (a) was the first host's own child, so closing that
 * terminal severed every other attached client, and (b) had its PPID
 * watchdog disabled, regressing #277 (an orphaned daemon surviving a
 * SIGKILL'd host).
 */

import * as fs from 'fs';
import * as path from 'path';
import type * as net from 'net';
import { spawn, StdioOptions } from 'child_process';
import { resolveServerRoot, getAfyxGraphDir, getDatabasePath, usesExternalStateDir } from '../directory';
import { StdioTransport } from './transport';
import { MCPEngine } from './engine';
import { MCPSession } from './session';
import {
  AcquireResult,
  Daemon,
  clearStaleDaemonLock,
  tryAcquireDaemonLock,
} from './daemon';
import { isProcessAlive } from './process-liveness';
import { clearStaleDaemonArtifacts } from './daemon-registry';
import { connectWithHello, runLocalHandshakeProxy } from './proxy';
import {
  getWriterPidPath,
  readWriterLock,
  releaseWriterLock,
  tryAcquireWriterLock,
  writerLockHeldMessage,
} from './writer-lock';
import {
  canProbeDaemonIdentity,
  decodeLockInfo,
  getDaemonPidPath,
  getDaemonSocketCandidates,
  probeDaemonIdentity,
} from './daemon-paths';
import { EARLY_PPID } from './early-ppid';
import { HOST_PPID_ENV, installPpidWatchdog, parseHostPpid } from './ppid-watchdog';
import { installMainThreadWatchdog, WatchdogHandle } from './liveness-watchdog';
import { armStartupHandshakeTimeout } from './startup-handshake';
import { treatStdinFailureAsShutdown } from './stdin-teardown';

/**
 * Env var {@link spawnDetachedDaemon} sets when it re-invokes the CLI to mark
 * the resulting process as the detached daemon itself, rather than a
 * launcher. A `serve --mcp` invocation without it is a launcher that
 * connects-or-spawns; with it, this process IS the daemon and must never
 * try to spawn another one (which would spawn forever).
 */
const DAEMON_INTERNAL_ENV = 'AFYX_GRAPH_DAEMON_INTERNAL';

/**
 * Retry budget for a freshly-detached daemon arbitrating the O_EXCL lock
 * against a racing sibling launcher. Small on purpose — the lock resolves on
 * the very first round in the overwhelming common case; the retries exist
 * only to cover clearing a genuinely stale (dead-pid) lockfile first.
 */
const TAKEOVER_MAX_RETRIES = 5;
const TAKEOVER_RETRY_DELAY_MS = 100;

/** Best-effort read of the daemon lockfile; rethrows on anything other than "file doesn't exist yet". */
function readDaemonLockOrThrow(root: string): ReturnType<typeof decodeLockInfo> {
  try {
    return decodeLockInfo(fs.readFileSync(getDaemonPidPath(root), 'utf8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new Error(`The daemon lock could not be read (${code ?? 'unknown error'}); refusing an in-process fallback.`);
  }
}

/**
 * Build an in-process fallback engine, but only when doing so cannot
 * conflict with a live writer. A plain-PID (legacy) lock can't prove daemon
 * identity by itself, but it does still prove some process owns that legacy
 * writer slot, so an ambiguous live legacy holder blocks the fallback rather
 * than risk a second writer.
 */
function makeFallbackEngine(root: string): MCPEngine {
  const existingDaemonLock = readDaemonLockOrThrow(root);
  if (existingDaemonLock && isProcessAlive(existingDaemonLock.pid) && !canProbeDaemonIdentity(existingDaemonLock)) {
    throw new Error(
      `Cannot start an in-process fallback while live legacy daemon pid ${existingDaemonLock.pid} holds the project lock.`
    );
  }
  const writer = readWriterLock(root);
  if (writer && writer.pid > 0 && isProcessAlive(writer.pid)) {
    throw new Error(writerLockHeldMessage(writer, getWriterPidPath(root)));
  }
  if (existingDaemonLock && isProcessAlive(existingDaemonLock.pid)) {
    throw new Error(
      `Cannot start an in-process fallback while live daemon pid ${existingDaemonLock.pid} holds the project lock.`
    );
  }
  return new MCPEngine({ writerLockRoot: root });
}

/**
 * Poll budget for a launcher waiting on a freshly-spawned daemon to bind its
 * socket before giving up and serving in-process instead. The daemon binds
 * the socket BEFORE its own backgrounded engine/grammar warm-up, so this only
 * needs to cover Node process startup — 240 × 25ms is 6s of headroom for a
 * cold/slow box, while the common path connects within the first few rounds.
 * The cadence is fine (25ms, not a coarser 100ms) specifically so the proxy
 * attaches the instant the daemon binds rather than up to 100ms late,
 * shaving the cold-start handshake an agent might otherwise race against.
 */
const DAEMON_CONNECT_MAX_RETRIES = 240;
const DAEMON_CONNECT_RETRY_DELAY_MS = 25;

function isTruthyEnvFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

/** Whether `AFYX_GRAPH_NO_DAEMON` was set to a truthy value. */
function daemonOptOutSet(): boolean {
  return isTruthyEnvFlag(process.env.AFYX_GRAPH_NO_DAEMON);
}

/** Whether this process was spawned to BE the detached daemon. */
function daemonInternalSet(): boolean {
  return isTruthyEnvFlag(process.env[DAEMON_INTERNAL_ENV]);
}

/**
 * Prepend an ISO-8601 timestamp to every `process.stderr.write` chunk from
 * here on. Called exactly once, only once this process has become the
 * detached daemon, whose stderr is appended to `.afyx-graph/daemon.log`.
 * Before #1431 no log line carried a timestamp at all, so a watchdog kill or
 * restart could be counted but never placed in time. (The watchdog's own
 * child process writes its kill notice through its inherited fd 2, bypassing
 * this wrapper entirely — it stamps that one line itself.)
 */
export function timestampStderrLines(): void {
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    return (originalWrite as (...args: unknown[]) => boolean)(stampLogChunk(chunk), ...rest);
  }) as typeof process.stderr.write;
}

/** Prepend `[<ISO-8601>] ` to a log chunk. Chunk types other than string/Buffer pass through untouched. */
export function stampLogChunk(chunk: string | Uint8Array): string | Uint8Array {
  try {
    const stamp = `[${new Date().toISOString()}] `;
    if (typeof chunk === 'string') return stamp + chunk;
    if (Buffer.isBuffer(chunk)) return Buffer.concat([Buffer.from(stamp), chunk]);
  } catch { /* stamping is best-effort — never block the write itself */ }
  return chunk;
}

/**
 * `progressPaths` for the #850 liveness watchdog, keyed on `root`'s index:
 * the SQLite DB file and its WAL. Passing these means the watchdog only
 * SIGKILLs on heartbeat silence when those files are ALSO not advancing —
 * the same slow-disk deferral the CLI's `index`/`init` path got in #1231.
 * Without it, one single-statement operation that runs long on a multi-GB
 * index (behind, say, Windows Defender) SIGKILLs an otherwise perfectly
 * healthy daemon — and killing a daemon at the end of nearly every session
 * is exactly what ratcheted the WAL leak in #1431. A genuinely wedged loop
 * still dies: it isn't writing anything, so the files stay still too.
 */
export function watchdogProgressPaths(root: string | null): { progressPaths?: string[] } {
  if (!root) return {};
  const dbPath = getDatabasePath(root);
  return { progressPaths: [dbPath, `${dbPath}-wal`] };
}

/**
 * Resolve the project root the daemon machinery should key on, or null when
 * no `.afyx-graph/` is reachable from the candidate path — direct mode is the
 * only option there, since the daemon's lockfile and socket both live under
 * `.afyx-graph/`.
 *
 * Resolution matches the engine's own (#1606): an up-walk first, then the
 * bounded workspace down-scan that adopts a SINGLE indexed sub-project, so a
 * workspace root sitting above one indexed child still gets the shared
 * daemon (one watcher, one writer, keyed on that child) instead of a
 * direct-mode server per host.
 *
 * The result is realpath'd so every client converges on the same socket/lock
 * path regardless of how it phrased the path — a client launched with a cwd
 * under a symlink (macOS's `/var` → `/private/var`; a spawned
 * `process.cwd()` is already realpath'd there) alongside one that passed a
 * symlinked `rootUri` would otherwise hash to two different sockets and
 * silently fail to share the daemon at all.
 */
function resolveDaemonRoot(explicitPath: string | null): string | null {
  const candidate = explicitPath ?? process.cwd();
  const root = resolveServerRoot(candidate).root;
  if (!root) return null;
  try { return fs.realpathSync(root); } catch { return root; }
}

/**
 * Spawn the shared daemon as a fully detached background process: its own
 * session/process group (so a SIGHUP/SIGINT delivered to the launcher's
 * terminal can't reach it), stdio decoupled from the launcher and instead
 * appended to `.afyx-graph/daemon.log`. Re-invokes the SAME CLI faithfully
 * across both dev and bundled launches, by reusing `process.argv[0]` (the
 * right node binary), the current `process.execArgv`, and `process.argv[1]`
 * (this very script). The spawned process arbitrates its
 * own O_EXCL lock, so racing launchers may each spawn one — every loser just
 * exits, and every launcher ends up proxying through the single winner.
 */
function spawnDetachedDaemon(root: string): void {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    // No resolvable CLI entry point to re-invoke — the caller should fall
    // back to direct mode rather than spawn something broken.
    throw new Error('cannot resolve CLI script path to spawn the daemon');
  }

  const [stdio, logFd] = openDaemonLogStdio(root);
  try {
    const child = spawn(
      process.execPath,
      [...process.execArgv, scriptPath, 'serve', '--mcp', '--path', root],
      { detached: true, stdio, windowsHide: true, env: detachedDaemonEnv() },
    );
    child.unref();
  } finally {
    // The child holds its own dup of the log fd now; the launcher itself has no further use for it.
    if (logFd !== null) {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    }
  }
}

function openDaemonLogStdio(root: string): [StdioOptions, number | null] {
  try {
    const logFd = fs.openSync(path.join(getAfyxGraphDir(root), 'daemon.log'), 'a');
    return [['ignore', logFd, logFd], logFd];
  } catch {
    return ['ignore', null]; // no log file — discard daemon output rather than fail the spawn
  }
}

/**
 * Env for the detached daemon: identical to ours, plus the internal marker,
 * minus the threaded host pid. The daemon has no host of its own, so that pid
 * must not leak into its environment (and from there into anything IT
 * spawns), where a long-dead session's host pid would otherwise trigger a
 * spurious shutdown.
 */
function detachedDaemonEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, [DAEMON_INTERNAL_ENV]: '1' };
  delete env[HOST_PPID_ENV];
  if (usesExternalStateDir()) {
    delete env.NODE_COMPILE_CACHE;
    env.NODE_DISABLE_COMPILE_CACHE = '1';
  }
  return env;
}

/**
 * The MCP server entry point for Afyx Graph.
 *
 * Implements the Model Context Protocol, exposing Afyx Graph's
 * code-intelligence functionality as tools an AI assistant can call.
 *
 * Constructor and `start()` signature are unchanged from the pre-#411
 * implementation — `new MCPServer(path).start()` still works exactly as
 * before; picking direct vs. proxy vs. daemon now happens internally, inside
 * `start()`.
 */
export class MCPServer {
  private projectPath: string | null;
  // Direct-mode-only state: in daemon mode the per-connection sessions live
  // inside the Daemon instance instead, and proxy mode has no session at all.
  private session: MCPSession | null = null;
  private engine: MCPEngine | null = null;
  private daemon: Daemon | null = null;
  private ppidWatchdog: ReturnType<typeof setInterval> | null = null;
  // Worker-thread liveness watchdog (#850) for the long-lived modes; SIGKILLs
  // this process if its main thread wedges in a non-yielding sync loop.
  private livenessWatchdog: WatchdogHandle | null = null;
  // Baseline for the PPID watchdog, from the CLI entry's earliest-possible
  // capture (early-ppid.ts) rather than `process.ppid` read here — capturing
  // it at construction time has already lost the race if the launcher was
  // killed during module loading (#1185).
  private originalPpid: number = EARLY_PPID;
  private hostPpid: number | null = parseHostPpid(process.env[HOST_PPID_ENV]);
  private stopped = false; // idempotency guard for stop()
  private mode: 'unstarted' | 'direct' | 'proxy' | 'daemon' = 'unstarted';
  /** Project root whose writer.pid this instance holds in direct mode (#1740); released on stop. */
  private writerLockRoot: string | null = null;

  constructor(projectPath?: string) {
    this.projectPath = projectPath || null;
  }

  /**
   * Start the MCP server. Decision order:
   *   1. `AFYX_GRAPH_DAEMON_INTERNAL=1` → this process IS the detached daemon; listen.
   *   2. `AFYX_GRAPH_NO_DAEMON=1` → direct mode (the unchanged pre-#411 behavior).
   *   3. No `.afyx-graph/` reachable → direct mode (the daemon's lockfile and socket both live under it).
   *   4. Otherwise: connect to (or spawn) the shared daemon and proxy to it.
   * Any unexpected failure while setting up step 4 falls back to direct mode
   * transparently — a misbehaving daemon must never block a session from starting.
   */
  async start(): Promise<void> {
    // Checked first so the daemon process honors the exact env it was
    // spawned with — it never itself sets NO_DAEMON, but must still not
    // re-interpret its own internal marker as an opt-out signal.
    if (daemonInternalSet()) {
      return this.startDaemonProcess();
    }
    if (daemonOptOutSet()) {
      return this.startDirect('AFYX_GRAPH_NO_DAEMON set');
    }

    const root = resolveDaemonRoot(this.projectPath);
    if (!root) {
      // No initialized project found — daemon mode has nowhere to put its
      // socket. This is the fresh-checkout / outside-project case, and
      // behaves exactly as it always has.
      return this.startDirect('no .afyx-graph/ root found');
    }

    this.mode = 'proxy';
    try {
      // Answers the MCP handshake LOCALLY — instant tool registration
      // instead of waiting ~600ms for the daemon to spawn and bind, which is
      // what produced the cold-start "No such tool available" race. Runs
      // until the host disconnects; the local-handshake proxy installs its
      // own watchdog and falls back to an in-process engine on its own if
      // the daemon never comes up.
      await this.runProxyWithLocalHandshake(root);
    } catch (err) {
      // Belt-and-braces: a throw during proxy SETUP (before any client byte
      // was served) is still perfectly safe to recover from with direct mode.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[Afyx Graph MCP] Proxy path failed (${message}); falling back to direct mode.\n`);
      return this.startDirect('proxy path threw');
    }
  }

  /**
   * Stop the server. Daemon mode triggers graceful shutdown of every
   * connected session; direct mode mirrors the pre-#411 behavior (stop the
   * engine, exit). Proxy mode never reaches here — that process exits itself.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;

    if (this.writerLockRoot) {
      releaseWriterLock(this.writerLockRoot);
      this.writerLockRoot = null;
    }
    if (this.ppidWatchdog) {
      clearInterval(this.ppidWatchdog);
      this.ppidWatchdog = null;
    }
    if (this.livenessWatchdog) {
      this.livenessWatchdog.stop();
      this.livenessWatchdog = null;
    }
    if (this.daemon) {
      void this.daemon.stop('stop()'); // Daemon.stop() itself calls process.exit(); nothing else to do
      return;
    }
    this.session?.stop();
    this.session = null;
    this.engine?.stop();
    this.engine = null;
    process.exit(0);
  }

  /** Single-process stdio MCP session — the pre-issue-#411 code path. */
  private async startDirect(reason: string): Promise<void> {
    if (reason && process.env.AFYX_GRAPH_MCP_DEBUG) {
      process.stderr.write(`[Afyx Graph MCP] Direct mode: ${reason}.\n`);
    }
    this.claimDirectWriterLock();

    this.engine = new MCPEngine();
    this.session = new MCPSession(new StdioTransport(), this.engine, {
      explicitProjectPath: this.projectPath,
    });
    if (this.projectPath) {
      void this.engine.ensureInitialized(this.projectPath); // backgrounded so the initialize reply stays fast (#172)
    }
    this.session.start();

    // Parent-process death detection, unchanged from before this rewrite.
    // Stdin closing already routes through StdioTransport's own
    // `process.exit(0)`, but SIGKILL of the parent doesn't reliably close
    // stdin on Linux (#277). A stdin 'error' (a socket-backed stdin can fail
    // with ECONNRESET/hangup instead of a clean close) is treated the same
    // way, destroying the stream so a hung fd can't busy-spin the event loop
    // (#799).
    treatStdinFailureAsShutdown(() => this.stop());
    // Backstop for a launch abandoned during startup (#1185): the launcher
    // was killed before EARLY_PPID could observe it, and the host is still
    // holding our pipes open. A server that never receives one byte of MCP
    // traffic isn't serving anyone. Armed after `session.start()` attached
    // the real stdin consumer above.
    armStartupHandshakeTimeout(() => {
      process.stderr.write(
        '[Afyx Graph MCP] No MCP traffic since startup; assuming an abandoned launch and shutting down (#1185). ' +
        'Tune with AFYX_GRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS (0 disables).\n'
      );
      this.stop();
    });

    this.mode = 'direct';
    this.installSignalHandlers();
    this.installPpidWatchdog();
    this.livenessWatchdog = installMainThreadWatchdog(watchdogProgressPaths(resolveDaemonRoot(this.projectPath)));
  }

  /**
   * #1740: refuse a second direct writer on an already-initialized project.
   * Daemon mode multiplexes many clients over one writer; direct mode is
   * single-writer-per-project, so a second one must exit rather than race
   * the first over the file watcher / SQLite WAL.
   */
  private claimDirectWriterLock(): void {
    const writerRoot = resolveDaemonRoot(this.projectPath);
    if (!writerRoot) return;
    const writer = tryAcquireWriterLock(writerRoot, 'direct');
    if (writer.kind === 'taken') {
      process.stderr.write(`[Afyx Graph MCP] ${writerLockHeldMessage(writer.existing, writer.pidPath)}\n`);
      process.exit(1);
    }
    this.writerLockRoot = writerRoot;
  }

  /**
   * Run as the detached shared daemon (spawned with
   * `AFYX_GRAPH_DAEMON_INTERNAL=1`). Arbitrates the O_EXCL lock across
   * possibly-racing siblings, then either becomes the daemon (binds the
   * socket, serves forever) or — if a live daemon already holds the lock —
   * exits cleanly so it doesn't leak a redundant process.
   *
   * No PPID watchdog and no stdin handlers here: the daemon is detached on
   * purpose and reaps itself via client-refcount + idle timeout instead (see
   * {@link Daemon}).
   */
  private async startDaemonProcess(): Promise<void> {
    // In daemon mode stderr IS `.afyx-graph/daemon.log`; timestamp every
    // line so a watchdog kill or restart can be placed in time (#1431 — the
    // log used to be undatable).
    timestampStderrLines();
    const root = resolveDaemonRoot(this.projectPath) ?? this.projectPath ?? process.cwd();

    for (let attempt = 0; attempt < TAKEOVER_MAX_RETRIES; attempt++) {
      if (await this.tryElectSelfAsDaemon(root)) return; // the net.Server keeps the process alive from here
      await sleep(TAKEOVER_RETRY_DELAY_MS);
    }

    process.stderr.write('[Afyx Graph daemon] Could not acquire the daemon lock; exiting.\n');
    process.exit(0);
  }

  /** One arbitration round. Returns true once THIS process has become the daemon. */
  private async tryElectSelfAsDaemon(root: string): Promise<boolean> {
    const lock = tryAcquireDaemonLock(root);
    if (lock.kind === 'acquired') {
      await this.becomeDaemon(root);
      return true;
    }
    await this.yieldToOrClearExistingLock(root, lock);
    return false;
  }

  private async becomeDaemon(root: string): Promise<void> {
    const daemon = new Daemon(root);
    await daemon.start();
    this.daemon = daemon;
    this.mode = 'daemon';
    // The detached daemon has no PPID watchdog or stdin lifeline of its own,
    // so a wedged main thread would otherwise pin a core forever (#850); the
    // liveness watchdog is its only recovery path.
    this.livenessWatchdog = installMainThreadWatchdog(watchdogProgressPaths(root));
  }

  /**
   * The lock was already taken. If its holder is alive, another daemon
   * already serves (or is mid-bind) and this process is redundant — exit
   * cleanly so its launcher proxies to the winner instead. Otherwise the
   * holder is dead, its record is unreadable, or its identity was actively
   * disproved, and the stale lock is cleared so the NEXT arbitration round
   * can win it.
   */
  private async yieldToOrClearExistingLock(root: string, lock: Extract<AcquireResult, { kind: 'taken' }>): Promise<void> {
    const existing = lock.existing;
    const disprovedLiveIdentity = existing && existing.pid > 0 && isProcessAlive(existing.pid)
      ? await this.confirmOrDisproveLiveHolder(existing)
      : false;

    if (disprovedLiveIdentity) {
      // Re-probed and about to clear — claim writer.pid first. A daemon
      // that's merely delayed (not dead) already owns that writer lock, and
      // a paired live-PID record is ambiguous under the legacy lock format,
      // so both cases must fail closed rather than race a cleanup.
      await clearStaleDaemonArtifacts(root);
    } else if (lock.lockContents !== null) {
      clearStaleDaemonLock(lock.pidPath, existing?.pid, { expectedLockContents: lock.lockContents });
    }
  }

  /**
   * A live-PID lock holder needs its identity CONFIRMED, not just its PID —
   * PID existence alone would accept an unrelated process after OS PID reuse
   * and permanently wedge startup (#1553). Exits the process outright when
   * the holder is confirmed (or presumed, for a legacy record with no socket
   * identity to test, or one still within its startup grace period); returns
   * true only once identity has been actively DISPROVED by a completed
   * socket-hello probe, meaning the stale lock is now safe to clear.
   */
  private async confirmOrDisproveLiveHolder(existing: NonNullable<Extract<AcquireResult, { kind: 'taken' }>['existing']>): Promise<boolean> {
    const ageMs = Date.now() - existing.startedAt;
    const startupGraceMs = 10_000;
    const stillWithinStartupGrace = existing.startedAt > 0 && ageMs >= 0 && ageMs < startupGraceMs;
    // A legacy plain-PID lock has no socket identity to test at all — an
    // inconclusive probe there is not permission to create a second writer,
    // so it's presumed live rather than actively disproved.
    const presumedLive = !canProbeDaemonIdentity(existing) || stillWithinStartupGrace || await probeDaemonIdentity(existing);
    if (presumedLive) {
      process.stderr.write(`[Afyx Graph daemon] Another daemon (pid ${existing.pid}) already holds the lock; exiting.\n`);
      process.exit(0);
    }
    return true; // disproved — safe for the caller to clear
  }

  /**
   * Proxy mode (the common case): serve the MCP handshake LOCALLY for
   * instant tool registration, forwarding tool calls to the shared daemon
   * connected in the background (probed, then spawned + polled if absent),
   * so the handshake never waits on it. Runs until the host disconnects; the
   * local-handshake proxy falls back to an in-process engine on its own if
   * the daemon never binds, so this can never wedge a session.
   */
  private async runProxyWithLocalHandshake(root: string): Promise<void> {
    await runLocalHandshakeProxy({
      getDaemonSocket: () => this.attachOrSpawnDaemon(root),
      makeEngine: () => makeFallbackEngine(root),
      root,
    });
  }

  /**
   * Probe the daemon socket candidates (see `daemon-paths.ts`); if nothing
   * answers, spawn a detached daemon and poll the same candidates for its
   * bind. The daemon may relocate its socket past an in-project filesystem
   * that can't host one (ExFAT/FAT, WSL2 DrvFs; #997) to a deterministic
   * tmpdir fallback — the bound path is never read back from the lockfile;
   * both sides simply walk the SAME ordered candidate list and converge on
   * whichever the daemon bound, with zero coordination. The in-project
   * candidate is tried first, so a normal repo pays nothing extra (it
   * connects on the very first probe).
   */
  private async attachOrSpawnDaemon(root: string): Promise<net.Socket | null> {
    const candidates = getDaemonSocketCandidates(root);

    const probeCandidates = async (): Promise<Awaited<ReturnType<typeof connectWithHello>>> => {
      for (const candidate of candidates) {
        const socket = await connectWithHello(candidate);
        // A wrong-version daemon IS up — definitive, so propagate it and
        // stop probing fallbacks; the caller serves in-process instead of
        // spawning and polling for a further 6s.
        if (socket === 'version-mismatch' || socket) return socket;
      }
      return null;
    };

    const fastProbe = await probeCandidates();
    if (fastProbe === 'version-mismatch') return null;
    if (fastProbe) return fastProbe;

    spawnDetachedDaemon(root);
    for (let attempt = 0; attempt < DAEMON_CONNECT_MAX_RETRIES; attempt++) {
      await sleep(DAEMON_CONNECT_RETRY_DELAY_MS);
      const probe = await probeCandidates();
      if (probe === 'version-mismatch') return null;
      if (probe) return probe;
    }
    return null; // never bound — the caller serves this session in-process
  }

  /** Standard SIGINT/SIGTERM handlers routing to `stop()` (direct mode only). */
  private installSignalHandlers(): void {
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * PPID watchdog (#277), direct mode only: daemon mode is detached on
   * purpose and reaps via idle timeout instead, and proxy mode installs its
   * own inside `runLocalHandshakeProxy`. So this only ever runs for an
   * in-process direct session.
   */
  private installPpidWatchdog(): void {
    if (this.mode !== 'direct') return;
    this.ppidWatchdog = installPpidWatchdog(
      (reason) => {
        process.stderr.write(`[Afyx Graph MCP] Parent process exited (${reason}); shutting down.\n`);
        this.stop();
      },
      {
        originalPpid: this.originalPpid,
        hostPpid: this.hostPpid,
        isAlive: isProcessAlive,
        pollMsRaw: process.env.AFYX_GRAPH_PPID_POLL_MS,
      },
    );
  }
}

function sleep(ms: number): Promise<void> {
  // Deliberately NOT unref'd: during the daemon connect/takeover retry loop
  // there may be no socket bound and no transport or listener pinning the
  // event loop between processes. An unref'd timer would let Node drain the
  // loop and exit silently before the next retry ever gets a chance to run.
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Re-exported for the CLI's own use.
export { StdioTransport } from './transport';
export { tools, ToolHandler } from './tools';
// A few daemon-mode internals, surfaced for tests + diagnostics.
export { Daemon } from './daemon';
export { AfyxGraphPackageVersion } from './version';
