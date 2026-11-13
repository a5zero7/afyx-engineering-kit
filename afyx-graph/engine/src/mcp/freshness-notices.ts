import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import type AfyxGraph from '../index';
import type { PendingFile } from '../sync';
import { validatePathWithinRoot } from '../utils';
import type { ToolResult } from './tool-catalog';

/** Formats source code slices with 1-based line numbers (`<line>\t<code>`). */
export function formatLineNumberedSource(slice: string, startLine: number): string {
  return slice
    .split('\n')
    .map((line, idx) => `${startLine + idx}\t${line}`)
    .join('\n');
}

/** Builds the top warning banner for files currently pending watcher sync. */
export function formatStaleBanner(pendingFiles: PendingFile[]): string {
  const now = Date.now();
  const entries = pendingFiles.map((file) => {
    const elapsedMs = Math.max(0, now - file.lastSeenMs);
    const state = file.indexing ? 'indexing in progress' : 'pending sync';
    return `  - ${file.path} (edited ${elapsedMs}ms ago, ${state})`;
  });
  return [
    '⚠️ Some files referenced below were edited since the last index sync — their afyx-graph entries may be stale:',
    ...entries,
    'For accurate content of those specific files, Read them directly. The rest of this response is fresh.',
  ].join('\n');
}

/** Builds a bounded footer summarizing pending edits outside the response. */
export function formatStaleFooter(otherPending: PendingFile[]): string {
  const MAX_LISTED = 5;
  const now = Date.now();
  const lines = otherPending.slice(0, MAX_LISTED).map((file) => {
    const elapsedMs = Math.max(0, now - file.lastSeenMs);
    return `  - ${file.path} (edited ${elapsedMs}ms ago)`;
  });
  if (otherPending.length > MAX_LISTED) {
    lines.push(`  - …and ${otherPending.length - MAX_LISTED} more`);
  }
  return `(Note: ${otherPending.length} file(s) elsewhere in this project are pending index sync but were not referenced above:\n${lines.join('\n')})`;
}

/** Builds the top-level notice emitted when live file watching has halted. */
export function formatDegradedBanner(reason: string | null): string {
  const base =
    '⚠️ Afyx Graph auto-sync is DISABLED — live file watching stopped, so the index is ' +
    'frozen and any file edited since then is stale here. Read files directly to confirm ' +
    'current content before relying on it.';
  return reason ? `${base}\n  Reason: ${reason}` : base;
}

/** Prepends a notice string ahead of the first text block of a successful result. */
export function prependToolNotice(result: ToolResult, notice: string): ToolResult {
  if (result.isError || !notice) return result;
  const [first, ...rest] = result.content;
  if (!first || first.type !== 'text') return result;
  return {
    ...result,
    content: [{ type: 'text', text: `${notice}\n\n${first.text}` }, ...rest],
  };
}

/** Applies watcher degradation or pending-file staleness notices to a response. */
export function attachFreshnessNotices(result: ToolResult, graph: AfyxGraph): ToolResult {
  if (result.isError) return result;

  try {
    if (graph.isWatcherDegraded?.()) {
      let reason: string | null = null;
      try {
        reason = graph.getWatcherDegradedReason?.() ?? null;
      } catch {
        reason = null;
      }
      return prependToolNotice(result, formatDegradedBanner(reason));
    }
  } catch {
    // Ignore watcher inspection failures on partial test doubles.
  }

  let pending: PendingFile[] = [];
  try {
    pending = graph.getPendingFiles?.() ?? [];
  } catch {
    return result;
  }
  if (pending.length === 0) return result;

  const [first, ...rest] = result.content;
  if (!first || first.type !== 'text') return result;

  const referenced: PendingFile[] = [];
  const elsewhere: PendingFile[] = [];
  for (const item of pending) {
    if (first.text.includes(item.path)) referenced.push(item);
    else elsewhere.push(item);
  }

  const sections = [
    referenced.length > 0 ? formatStaleBanner(referenced) : '',
    first.text,
    elsewhere.length > 0 ? formatStaleFooter(elsewhere) : '',
  ].filter(Boolean);

  if (sections.length <= 1) return result;
  return {
    ...result,
    content: [{ type: 'text', text: sections.join('\n\n') }, ...rest],
  };
}

/**
 * Verifies whether an indexed file has diverged on disk using stat metadata
 * first and SHA-256 comparison only when size/mtime changed, with brief memoization.
 */
export class DiskDriftMonitor {
  private readonly cache = new Map<string, { checkedAt: number; drifted: boolean }>();

  constructor(private readonly ttlMs: number = 2000) {}

  clear(): void {
    this.cache.clear();
  }

  isDrifted(graph: AfyxGraph, relPath: string, preloadedText?: string): boolean {
    let root: string;
    try {
      root = graph.getProjectRoot();
    } catch {
      return false;
    }

    const key = `${root}\0${relPath}`;
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && now - entry.checkedAt < this.ttlMs) {
      return entry.drifted;
    }

    const drifted = this.probeFile(graph, root, relPath, preloadedText);
    this.cache.set(key, { checkedAt: now, drifted });
    return drifted;
  }

  private probeFile(
    graph: AfyxGraph,
    root: string,
    relPath: string,
    preloadedText?: string,
  ): boolean {
    try {
      const record = graph.getFile(relPath);
      if (!record) return false;
      const absPath = validatePathWithinRoot(root, relPath);
      if (!absPath || !existsSync(absPath)) return false;

      const stat = statSync(absPath);
      if (
        stat.size === record.size &&
        Math.floor(stat.mtimeMs) === Math.floor(record.modifiedAt)
      ) {
        return false;
      }

      const body = preloadedText ?? readFileSync(absPath, 'utf-8');
      const digest = createHash('sha256').update(body).digest('hex');
      return digest !== record.contentHash;
    } catch {
      return false;
    }
  }
}
