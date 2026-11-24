import { basename } from 'node:path';
import type { AfyxGraph } from '../../index';
import { buildIndexHealth } from '../../index-health';
import { BLAST_DEPTH, HUB_THRESHOLD, UNCERTAIN_BELOW } from './wire';

const MAX_BLAST_SAMPLE_SIZE = 24;

export interface WireBlastScale {
  maxDirect: number;
  maxWithinHops: number;
  hops: number;
  sampled: number;
  estimated: boolean;
}

let cachedScaleEntry: { cacheKey: string; scale: WireBlastScale } | null = null;

export function resetBlastScaleCache(): void {
  cachedScaleEntry = null;
}

export function blastScaleFor(
  cg: AfyxGraph,
  projectRoot: string,
  edgeCount: number,
): WireBlastScale {
  const cacheKey = `${projectRoot}\u0000${cg.getLastIndexedAt() ?? 0}:${edgeCount}`;
  if (cachedScaleEntry?.cacheKey === cacheKey) {
    return cachedScaleEntry.scale;
  }

  const topSymbols = cg.getTopDependedOn(MAX_BLAST_SAMPLE_SIZE);
  let widestRadius = 0;

  for (const symbol of topSymbols) {
    try {
      const impact = cg.getImpactRadius(symbol.nodeId, BLAST_DEPTH);
      const reachableCount = Math.max(0, impact.nodes.size - 1);
      if (reachableCount > widestRadius) widestRadius = reachableCount;
    } catch {
      continue;
    }
  }

  const scale: WireBlastScale = {
    maxDirect: topSymbols[0]?.dependents ?? 0,
    maxWithinHops: widestRadius,
    hops: BLAST_DEPTH,
    sampled: topSymbols.length,
    estimated: true,
  };
  cachedScaleEntry = { cacheKey, scale };
  return scale;
}

export function buildStats(cg: AfyxGraph, projectRoot: string): unknown {
  const stats = cg.getStats();
  const buildInfo = cg.getIndexBuildInfo();
  const health = buildIndexHealth(cg, projectRoot);

  return {
    project: {
      root: projectRoot,
      name: basename(projectRoot) || projectRoot,
    },
    index: {
      state: cg.getIndexState(),
      lastIndexedAt: cg.getLastIndexedAt(),
      stale: cg.isIndexStale(),
      version: buildInfo.version,
      extractionVersion: buildInfo.extractionVersion,
      backend: cg.getBackend(),
      journalMode: cg.getJournalMode(),
      pendingReferences: cg.getPendingReferenceCount(),
      generatedFiles: cg.getGeneratedFileCount(),
      watching: cg.isWatching(),
      watcherDegraded: cg.isWatcherDegraded(),
    },
    health,
    graph: {
      nodes: stats.nodeCount,
      edges: stats.edgeCount,
      files: stats.fileCount,
      nodesByKind: stats.nodesByKind,
      edgesByKind: stats.edgesByKind,
      filesByLanguage: stats.filesByLanguage,
      dbSizeBytes: stats.dbSizeBytes,
      walSizeBytes: stats.walSizeBytes,
    },
    frameworks: cg.getDetectedFrameworks(),
    thresholds: {
      hub: HUB_THRESHOLD,
      uncertainBelow: UNCERTAIN_BELOW,
    },
    blastScale: blastScaleFor(cg, projectRoot, stats.edgeCount),
  };
}
