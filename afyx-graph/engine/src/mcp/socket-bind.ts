/**
 * Socket-candidate binding policy.
 *
 * The daemon walks an ORDERED list of socket paths (see daemon-paths.ts) and
 * binds the first that works, relocating past any path that fails to bind for
 * a non-conflict reason — a filesystem that can't host an AF_UNIX node at all
 * (ExFAT/FAT, network mounts, WSL2 DrvFs), which reports a DIFFERENT errno per
 * OS (ENOTSUP macOS, EPERM Linux; #997). Enumerating those codes is
 * whack-a-mole, so this relocates on anything-but-conflict instead.
 */
import type * as net from 'net';

/**
 * The one `listen()` error we must NOT relocate past. EADDRINUSE means the
 * path is genuinely occupied — a racing daemon that legitimately owns it, or a
 * leftover node we couldn't clear (the #974 planted-dir case) — so relocating
 * would abandon a path another daemon owns; the caller instead releases its
 * lock and falls back to direct mode. Every other bind error just means "this
 * path didn't work" and is safe to relocate past. (ENAMETOOLONG never reaches
 * here — the candidate list already routes over-long paths straight to
 * tmpdir.)
 */
const SOCKET_BIND_CONFLICT_CODE = 'EADDRINUSE';

export interface BoundSocket {
  server: net.Server;
  socketPath: string;
}

export interface BindRelocationHooks {
  onRelocate?: (from: string, to: string, code: string) => void;
}

/**
 * Bind the first usable socket from an ordered candidate list, relocating past
 * any path that fails to bind for a non-conflict reason. The injected `listen`
 * does the real `net.Server.listen` (and any stale-socket clear); abstracted
 * so the relocation policy is unit-testable without a real unsupported
 * filesystem. Returns the server plus the path actually bound. An
 * EADDRINUSE, or any error on the LAST candidate, propagates — the caller
 * releases the lockfile and falls back to direct mode (#974).
 */
export async function bindFirstUsableSocket(
  candidates: string[],
  listen: (socketPath: string) => Promise<net.Server>,
  hooks: BindRelocationHooks = {},
): Promise<BoundSocket> {
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const socketPath = candidates[i]!; // i < length, so always defined
    const isLastCandidate = i === candidates.length - 1;
    try {
      const server = await listen(socketPath);
      return { server, socketPath };
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      const shouldRelocate = !isLastCandidate && code !== SOCKET_BIND_CONFLICT_CODE;
      if (!shouldRelocate) throw err;
      hooks.onRelocate?.(socketPath, candidates[i + 1]!, code ?? '');
    }
  }
  // Only reachable with an empty candidate list — a programmer error.
  throw lastErr ?? new Error('no socket candidates to bind');
}
