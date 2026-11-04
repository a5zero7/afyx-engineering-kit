import type AfyxGraph from '../index';
import { textToolResult, type ToolResult } from './tool-results';
import { buildIndexHealth } from '../index-health';

export type StatusToolSource = Pick<
  AfyxGraph,
  | 'getStats'
  | 'getProjectRoot'
  | 'getJournalMode'
  | 'getIndexState'
  | 'getIndexAccounting'
  | 'getIndexBuildInfo'
  | 'isIndexStale'
  | 'getPendingReferenceCount'
  | 'isWatching'
  | 'isWatcherDegraded'
  | 'getWatcherDegradedReason'
  | 'getPendingFiles'
>;

export interface StatusToolContext {
  worktreeWarning?: string;
  nowMs: number;
}

/** Render the MCP Status contract from already-selected live graph state. */
export function executeStatusTool(
  source: StatusToolSource,
  context: StatusToolContext,
): ToolResult {
  const stats = source.getStats();
  const pendingFiles = source.getPendingFiles();
  const health = buildIndexHealth(source, source.getProjectRoot(), { pendingFiles });
  const lines: string[] = ['**Afyx Graph Status**', ''];

  if (context.worktreeWarning) {
    lines.push(`> ⚠ ${context.worktreeWarning.replace(/\n/g, '\n> ')}`, '');
  }

  lines.push(
    `**Files indexed:** ${stats.fileCount}`,
    `**Total nodes:** ${stats.nodeCount}`,
    `**Total edges:** ${stats.edgeCount}`,
    `**Database size:** ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
    '**Backend:** node:sqlite (Node built-in) — full WAL + FTS5',
  );

  const accounting = health.extraction.accounting;
  lines.push(
    '',
    '**Index Health:**',
    `- Git freshness: ${health.gitFreshness.state} — ${health.gitFreshness.detail}`,
    `- Filesystem/content: ${health.pendingChanges.state}` +
      (health.pendingChanges.count === null ? ' (no live watcher or filesystem scan)' : ` (${health.pendingChanges.count} pending)`),
    `- Extraction: ${health.extraction.state.toUpperCase()}`,
    `- Extraction version: ${health.compatibility.builtWithExtractionVersion ?? 'unknown'}/${health.compatibility.currentExtractionVersion}` +
      (health.compatibility.reindexRecommended ? ' — re-index recommended' : ''),
    `- Pending references: ${health.pendingReferences}`,
    `- Watcher: ${health.watcher.state}` + (health.watcher.reason ? ` — ${health.watcher.reason}` : ''),
  );
  if (accounting) {
    lines.push(
      `- Last full index: ${accounting.indexed} indexed, ${accounting.skipped} skipped, ` +
        `${accounting.unsupported} unsupported, ${accounting.failed} failed; ignored NOT ENUMERATED`,
    );
    if (accounting.metadataIndexed !== null) {
      lines.push(
        `- Catalog depth: ${accounting.metadataIndexed} metadata-indexed, ` +
          `${accounting.contentIndexed ?? 0} content-indexed, ` +
          `${accounting.structurallyIndexed ?? 0} structurally indexed`,
      );
    }
    if (accounting.skippedReasons && Object.keys(accounting.skippedReasons).length > 0) {
      lines.push(`- Skipped reasons: ${Object.entries(accounting.skippedReasons).map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
    }
  } else {
    lines.push('- Last full index accounting: unavailable');
  }

  const journalMode = source.getJournalMode();
  if (journalMode === 'wal') {
    lines.push('**Journal mode:** wal (concurrent reads safe)');
  } else {
    lines.push(
      `**Journal mode:** ⚠ ${journalMode || 'unknown'} — WAL not active, so reads ` +
      'can block on a concurrent write (WAL appears unsupported on this filesystem)',
    );
  }

  const pendingReferences = health.pendingReferences;
  if (pendingReferences > 0) {
    lines.push(
      `**Pending resolution:** ⚠ ${pendingReferences} references from an interrupted ` +
      'index run — some caller/impact edges are missing until the next sync ' +
      '(any file change triggers it, or run `afyx-graph sync`)',
    );
  }

  lines.push('', '**Nodes by Kind:**');
  for (const [kind, count] of Object.entries(stats.nodesByKind)) {
    if (count > 0) lines.push(`- ${kind}: ${count}`);
  }

  lines.push('', '**Languages:**');
  for (const [language, count] of Object.entries(stats.filesByLanguage)) {
    if (count > 0) lines.push(`- ${language}: ${count}`);
  }

  if (health.watcher.state === 'DEGRADED') {
    lines.push(
      '',
      '**Auto-sync disabled:**',
      `- ${health.watcher.reason ?? 'live file watching stopped'}`,
      '- The index is frozen; Read files directly for current content.',
    );
  }

  if (pendingFiles.length > 0) {
    lines.push('', '**Pending sync:**');
    for (const pending of pendingFiles) {
      const ageMs = Math.max(0, context.nowMs - pending.lastSeenMs);
      const label = pending.indexing ? 'indexing in progress' : 'pending sync';
      lines.push(`- ${pending.path} (edited ${ageMs}ms ago, ${label})`);
    }
  }

  return textToolResult(lines.join('\n'));
}
