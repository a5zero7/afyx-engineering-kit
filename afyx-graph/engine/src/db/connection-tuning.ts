/**
 * Per-connection settings applied every time a database is opened or created.
 */

import type { SqliteDatabase } from './sqlite-adapter';

/** WAL size (bytes) at which an open connection shrinks a leftover log; also the journal size limit. */
const DEFAULT_WAL_HEAL_MB = 64;

/**
 * Turn the `AFYX_GRAPH_WAL_HEAL_MB` override (megabytes) into bytes. Anything that is not a
 * positive finite number — unset, empty, text, zero, negative — means the default.
 */
export function resolveWalHealBytes(envValue: string | undefined): number {
  if (envValue !== undefined && envValue !== '') {
    const megabytes = Number(envValue);
    if (Number.isFinite(megabytes) && megabytes > 0) return Math.floor(megabytes * 1024 * 1024);
  }
  return DEFAULT_WAL_HEAL_MB * 1024 * 1024;
}

/**
 * The WAL size past which every `open` checkpoints and truncates the log, and to which
 * `journal_size_limit` clips it after any checkpoint that resets it.
 *
 * A process killed mid-index (the liveness watchdog, OOM, a crash) leaves its WAL behind
 * and the next session appends to it. Without a bound, that file only ever grew — one
 * report reached 25.6 GB (#1431). A clean close deletes the WAL, and a healthy open never
 * sees more than a few MB, so 64 MB separates the two cleanly.
 */
export const WAL_HEAL_THRESHOLD_BYTES = resolveWalHealBytes(process.env.AFYX_GRAPH_WAL_HEAL_MB);

/**
 * Apply the connection pragmas, in order.
 *
 * `busy_timeout` goes first: if another process holds the write lock while the later
 * pragmas (`journal_mode` touches the file) or the first query run, they wait it out
 * instead of failing at once with "database is locked" (#238). Five seconds rides out an
 * incremental sync; the earlier two-minute wait looked like a hung agent. In WAL mode
 * readers never block on a writer, so this only bounds cross-process write contention
 * (the git-hook sync racing the MCP server).
 */
export function tuneConnection(db: SqliteDatabase): void {
  const settings = [
    'busy_timeout = 5000',
    'foreign_keys = ON',
    'journal_mode = WAL',
    'synchronous = NORMAL', // safe with WAL
    'cache_size = -64000', // 64 MB page cache
    'temp_store = MEMORY',
    'mmap_size = 268435456', // 256 MB memory-mapped I/O
    // Without a limit the -wal file never shrinks below its high-water mark while a
    // connection lives; with one, any checkpoint that resets the log truncates it.
    `journal_size_limit = ${WAL_HEAL_THRESHOLD_BYTES}`,
  ];
  for (const setting of settings) db.pragma(setting);
}
