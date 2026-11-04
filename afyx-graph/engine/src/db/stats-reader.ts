/**
 * Whole-graph statistics and project metadata reads.
 */

import type { EdgeKind, GraphStats, Language, NodeKind } from '../types';
import { QuerySession } from './query-session';

interface TotalsRow {
  node_count: number;
  edge_count: number;
  file_count: number;
}

type DistributionDimension = 'node' | 'edge' | 'file';

interface DistributionRow {
  dimension: DistributionDimension;
  label: string;
  total: number;
}

const READ_TOTALS = `
  SELECT (SELECT COUNT(*) FROM nodes) AS node_count,
         (SELECT COUNT(*) FROM edges) AS edge_count,
         (SELECT COUNT(*) FROM files) AS file_count`;

/* One ordered result set makes grouping order explicit and avoids three query round trips. */
const READ_DISTRIBUTIONS = `
  SELECT 'node' AS dimension, kind AS label, COUNT(*) AS total FROM nodes GROUP BY kind
  UNION ALL
  SELECT 'edge' AS dimension, kind AS label, COUNT(*) AS total FROM edges GROUP BY kind
  UNION ALL
  SELECT 'file' AS dimension, language AS label, COUNT(*) AS total FROM files GROUP BY language
  ORDER BY dimension, label`;

const READ_METADATA_VALUE = 'SELECT value FROM project_metadata WHERE key = ?';
const READ_ALL_METADATA = 'SELECT key, value FROM project_metadata ORDER BY rowid';

export class StatsReader {
  constructor(private readonly session: QuerySession) {}

  /** Lightweight (nodes, edges) count snapshot, used around an index/sync run to compute true additions across extraction + resolution + synthesis. */
  getNodeAndEdgeCount(): { nodes: number; edges: number } {
    const row = this.session.statement(READ_TOTALS).get() as TotalsRow;
    return { nodes: row.node_count, edges: row.edge_count };
  }

  getStats(): GraphStats {
    const totals = this.session.statement(READ_TOTALS).get() as TotalsRow;
    const distributions = {
      node: {} as Record<NodeKind, number>,
      edge: {} as Record<EdgeKind, number>,
      file: {} as Record<Language, number>,
    };
    const rows = this.session.statement(READ_DISTRIBUTIONS).all() as DistributionRow[];
    for (const row of rows) {
      if (row.dimension === 'node') distributions.node[row.label as NodeKind] = row.total;
      else if (row.dimension === 'edge') distributions.edge[row.label as EdgeKind] = row.total;
      else distributions.file[row.label as Language] = row.total;
    }

    return {
      nodeCount: totals.node_count,
      edgeCount: totals.edge_count,
      fileCount: totals.file_count,
      nodesByKind: distributions.node,
      edgesByKind: distributions.edge,
      filesByLanguage: distributions.file,
      dbSizeBytes: 0, // set by the caller from DatabaseConnection.getSize()
      walSizeBytes: 0, // set by the caller from DatabaseConnection.getWalSizeBytes()
      lastUpdated: Date.now(),
    };
  }

  getMetadata(key: string): string | null {
    const row = this.session.statement(READ_METADATA_VALUE).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  getAllMetadata(): Record<string, string> {
    const rows = this.session.statement(READ_ALL_METADATA).all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  }
}
