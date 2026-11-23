/** Persisted project-shape facts used by routing-aware consumers. */

import { isGeneratedFile } from '../extraction/generated-detection';
import type { FileReader } from './file-reader';
import type { QuerySession } from './query-session';

type DominanceRow = { filePath: string; edgeCount: number };
type RouteCountRow = { filePath: string; routeCount: number };

interface RouteEntryRow {
  url: string;
  routeId: string;
  routeFile: string;
  routeLine: number;
  handlerName: string;
  handlerFile: string;
  handlerLine: number;
  handlerKind: string;
}

interface RouteEntry {
  url: string;
  handler: string;
  handlerFile: string;
  handlerLine: number;
  handlerKind: string;
  routeId: string;
  routeFile: string;
  routeLine: number;
}

interface RoutingManifest {
  entries: RouteEntry[];
  topHandlerFile: string | null;
  topHandlerFileCount: number;
  totalRoutes: number;
}

const CANDIDATE_LIMIT = 20;
const DOMINANT_EDGE_FLOOR = 20;
const ROUTE_COUNT_FLOOR = 3;
const ROUTE_SHARE_FLOOR = 0.3;

const LOW_VALUE_PATHS = [
  /(?:^|\/)(tests?|__tests?__|spec)\//,
  /_test\.go$/,
  /(?:^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /_(?:spec|test)\.rb$/,
  /\.(?:test|spec)\.[jt]sx?$/,
  /(?:test|spec|tests)\.(?:java|kt|scala)$/,
  /(?:tests?|spec)\.cs$/,
  /tests?\.swift$/,
  /_test\.dart$/,
] as const;

const ROUTING_SQL = {
  dominantCandidates: `
    SELECT source.file_path AS filePath, COUNT(*) AS edgeCount
      FROM edges AS relation
      JOIN nodes AS source ON source.id = relation.source
      JOIN nodes AS target ON target.id = relation.target
     WHERE source.file_path = target.file_path
  GROUP BY source.file_path
  ORDER BY edgeCount DESC
     LIMIT ${CANDIDATE_LIMIT}`,

  routeConcentration: `
    SELECT file_path AS filePath, COUNT(*) AS routeCount
      FROM nodes
     WHERE kind = 'route'
  GROUP BY file_path
  ORDER BY routeCount DESC
     LIMIT ${CANDIDATE_LIMIT}`,

  manifest: `
    SELECT route.name AS url,
           route.id AS routeId,
           route.file_path AS routeFile,
           route.start_line AS routeLine,
           handler.name AS handlerName,
           handler.file_path AS handlerFile,
           handler.start_line AS handlerLine,
           handler.kind AS handlerKind
      FROM nodes AS route
      JOIN edges AS relation ON relation.source = route.id
      JOIN nodes AS handler ON handler.id = relation.target
     WHERE route.kind = 'route'
       AND relation.kind IN ('references', 'calls')
       AND handler.kind IN ('function', 'method', 'class', 'constant', 'variable')
  ORDER BY route.file_path, route.start_line
     LIMIT ?`,
} as const;

function isEligibleSource(filePath: string, generatedPaths: ReadonlySet<string>): boolean {
  if (generatedPaths.has(filePath)) return false;
  const normalized = filePath.toLowerCase();
  return !LOW_VALUE_PATHS.some((pattern) => pattern.test(normalized)) && !isGeneratedFile(filePath);
}

function decodeRouteEntry(row: RouteEntryRow): RouteEntry {
  return {
    url: row.url,
    handler: row.handlerName,
    handlerFile: row.handlerFile,
    handlerLine: row.handlerLine,
    handlerKind: row.handlerKind,
    routeId: row.routeId,
    routeFile: row.routeFile,
    routeLine: row.routeLine,
  };
}

function leadingHandlerFile(rows: readonly RouteEntryRow[]): { filePath: string | null; count: number } {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.handlerFile, (counts.get(row.handlerFile) ?? 0) + 1);

  const winner = { filePath: null as string | null, count: 0 };
  for (const [filePath, count] of counts) {
    if (count > winner.count) {
      winner.filePath = filePath;
      winner.count = count;
    }
  }
  return winner;
}

export class RoutingReader {
  constructor(
    private readonly session: QuerySession,
    private readonly files: FileReader
  ) {}

  getDominantFile(): { filePath: string; edgeCount: number; nextEdgeCount: number } | null {
    const rows = this.session.statement(ROUTING_SQL.dominantCandidates).all() as DominanceRow[];
    const generatedPaths = this.files.getGeneratedPathsAmong(rows.map(({ filePath }) => filePath));
    const accepted = rows.filter(({ filePath }) => isEligibleSource(filePath, generatedPaths));
    const candidate = accepted[0];
    if (candidate === undefined || candidate.edgeCount < DOMINANT_EDGE_FLOOR) return null;
    return {
      filePath: candidate.filePath,
      edgeCount: candidate.edgeCount,
      nextEdgeCount: accepted[1]?.edgeCount ?? 0,
    };
  }

  getTopRouteFile(): { filePath: string; routeCount: number; totalRoutes: number } | null {
    const rows = this.session.statement(ROUTING_SQL.routeConcentration).all() as RouteCountRow[];
    const generatedPaths = this.files.getGeneratedPathsAmong(rows.map(({ filePath }) => filePath));
    const accepted = rows.filter(({ filePath }) => isEligibleSource(filePath, generatedPaths));
    if (accepted.length === 0) return null;

    const totalRoutes = accepted.reduce((total, row) => total + row.routeCount, 0);
    const candidate = accepted[0]!;
    if (
      totalRoutes < ROUTE_COUNT_FLOOR ||
      candidate.routeCount < ROUTE_COUNT_FLOOR ||
      candidate.routeCount / totalRoutes < ROUTE_SHARE_FLOOR
    ) return null;
    return { filePath: candidate.filePath, routeCount: candidate.routeCount, totalRoutes };
  }

  getRoutingManifest(limit = 40): RoutingManifest | null {
    const rows = this.session.statement(ROUTING_SQL.manifest).all(limit) as RouteEntryRow[];
    const generatedPaths = this.files.getGeneratedPathsAmong(rows.map(({ handlerFile }) => handlerFile));
    const accepted = rows.filter(({ handlerFile }) => isEligibleSource(handlerFile, generatedPaths));
    if (accepted.length < ROUTE_COUNT_FLOOR) return null;

    const leader = leadingHandlerFile(accepted);
    return {
      entries: accepted.map(decodeRouteEntry),
      topHandlerFile: leader.filePath,
      topHandlerFileCount: leader.count,
      totalRoutes: accepted.length,
    };
  }
}
