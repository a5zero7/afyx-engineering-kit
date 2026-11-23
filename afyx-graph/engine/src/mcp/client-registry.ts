/**
 * Client-hello parsing and peer-liveness decisions for the shared daemon.
 *
 * Pure functions only — no Set/Map bookkeeping here. The daemon keeps its own
 * connected-client set and per-client peer-pid map directly (see daemon.ts):
 * both are exercised by whitebox unit tests that construct fake sessions and
 * poke the daemon's internal state directly to test the reap/backstop
 * decisions in isolation, without spinning up a real socket — a deliberate,
 * pre-existing testing strategy this rewrite preserves rather than disturbs.
 */

/** Per-client peer pids from the optional client-hello. */
export interface ClientPeerInfo {
  pid: number | null;
  hostPid: number | null;
  sessionId?: string;
}

const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Parse one client-hello line. Returns the peer pids if `line` is a well-formed
 * client-hello (carries the `afyx_graph_client` marker), or null otherwise — in
 * which case the caller treats the bytes as ordinary JSON-RPC.
 */
export function parseClientHelloLine(line: string): ClientPeerInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.afyx_graph_client !== 1 || typeof o.pid !== 'number') return null;
  const sessionId = typeof o.sessionId === 'string' && SESSION_ID_RE.test(o.sessionId)
    ? o.sessionId
    : null;
  return {
    pid: o.pid,
    hostPid: typeof o.hostPid === 'number' ? o.hostPid : null,
    ...(sessionId ? { sessionId } : {}),
  };
}

/**
 * A client's peer is dead when its proxy process is gone, or when its known
 * host process is gone. Unknown pid (no client-hello) is never "dead" on this
 * basis — those clients rely on the socket-close path.
 */
export function peerIsDead(peers: ClientPeerInfo, isAlive: (pid: number) => boolean): boolean {
  if (peers.pid === null) return false;
  if (!isAlive(peers.pid)) return true;
  if (peers.hostPid !== null && !isAlive(peers.hostPid)) return true;
  return false;
}
