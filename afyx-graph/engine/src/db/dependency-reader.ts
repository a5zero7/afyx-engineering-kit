/** Persisted dependency facts and aggregates. Graph traversal stays in `src/graph`. */

import type { Edge, EdgeKind, Language, Node, NodeKind } from '../types';
import { chunked, placeholders, QuerySession } from './query-session';
import { rowToEdge, rowToNode, type EdgeRow, type NodeRow } from './row-mappers';

type GeneratedNodeRow = NodeRow & { file_generated: number };
type NameRow = { name: string };
type LanguageExportRow = { language: string; any_exported: number };
type RankedTargetRow = { nodeId: string; dependents: number };
type RankedFileRow = { nodeId: string; filePath: string; calls: number; reaches: number; score: number };
type FileDependentsRow = { filePath: string; dependents: number };
type FileReachRow = { filePath: string; reaches: number; refs: number };
type FilePairRow = { source: string; target: string };
type FilePathRow = { filePath: string };
type IncomingDependencyRow = EdgeRow & {
  target_name: string;
  target_kind: NodeKind;
  source_file_path: string;
  source_language: Language;
};

interface ModuleFactRow {
  sourceModule: string;
  targetModule: string;
  kind: EdgeKind;
  sourceName: string;
  targetName: string;
  confidentCount: number;
  declaredCount: number;
  uncertainCount: number;
}

interface ModuleLinkTotal {
  source: string;
  target: string;
  kind: EdgeKind;
  count: number;
  declared: number;
  uncertain: number;
}

interface ModulePairTotal {
  source: string;
  target: string;
  from: string;
  to: string;
  count: number;
  declared: number;
}

const SQL = {
  topDependedOn: `
    SELECT target AS nodeId, COUNT(DISTINCT source) AS dependents
      FROM edges
     WHERE kind <> 'contains' AND source <> target
  GROUP BY target
  ORDER BY dependents DESC, nodeId
     LIMIT ?`,

  topCallingFiles: `
    WITH executable_sources(file_id, source_id) AS (
      SELECT id, id FROM nodes WHERE kind = 'file'
      UNION ALL
      SELECT containment.source, containment.target
        FROM edges AS containment
        JOIN nodes AS file_node ON file_node.id = containment.source
        JOIN nodes AS value_node ON value_node.id = containment.target
       WHERE containment.kind = 'contains'
         AND file_node.kind = 'file'
         AND value_node.kind IN ('variable', 'constant')
    ), execution_counts(file_id, calls) AS (
      SELECT roots.file_id, COUNT(*)
        FROM executable_sources AS roots
        JOIN edges AS dependency ON dependency.source = roots.source_id
       WHERE dependency.kind IN ('calls', 'instantiates')
    GROUP BY roots.file_id
    ), candidates(nodeId, filePath, calls) AS (
      SELECT execution_counts.file_id, nodes.file_path, execution_counts.calls
        FROM execution_counts JOIN nodes ON nodes.id = execution_counts.file_id
    ), reach_counts(filePath, reaches) AS (
      SELECT source_node.file_path, COUNT(DISTINCT target_node.file_path)
        FROM edges AS dependency
        JOIN nodes AS source_node ON source_node.id = dependency.source
        JOIN nodes AS target_node ON target_node.id = dependency.target
       WHERE dependency.kind <> 'contains'
         AND source_node.file_path <> target_node.file_path
         AND source_node.file_path IN (SELECT filePath FROM candidates)
    GROUP BY source_node.file_path
    )
    SELECT candidates.nodeId,
           candidates.filePath,
           candidates.calls,
           COALESCE(reach_counts.reaches, 0) AS reaches,
           candidates.calls * (1 + COALESCE(reach_counts.reaches, 0)) AS score
      FROM candidates LEFT JOIN reach_counts USING (filePath)
  ORDER BY score DESC, calls DESC, filePath
     LIMIT ?`,

  fileDependentCounts: `
    SELECT target_node.file_path AS filePath,
           COUNT(DISTINCT source_node.file_path) AS dependents
      FROM edges AS dependency
      JOIN nodes AS target_node ON target_node.id = dependency.target
      JOIN nodes AS source_node ON source_node.id = dependency.source
     WHERE dependency.kind <> 'contains'
       AND target_node.file_path IN (SELECT value FROM json_each(?))
       AND source_node.file_path <> target_node.file_path
  GROUP BY target_node.file_path
  ORDER BY target_node.file_path`,

  fileReachCounts: `
    SELECT source_node.file_path AS filePath,
           COUNT(DISTINCT target_node.file_path) AS reaches,
           COUNT(*) AS refs
      FROM nodes AS source_node
      JOIN edges AS dependency ON dependency.source = source_node.id
      JOIN nodes AS target_node ON target_node.id = dependency.target
     WHERE source_node.file_path IN (SELECT value FROM json_each(?))
       AND dependency.kind <> 'contains'
       AND target_node.file_path <> source_node.file_path
  GROUP BY source_node.file_path
  ORDER BY source_node.file_path`,

  crossFilePairs: `
    SELECT DISTINCT source_node.file_path AS source, target_node.file_path AS target
      FROM edges AS dependency
      JOIN nodes AS source_node ON source_node.id = dependency.source
      JOIN nodes AS target_node ON target_node.id = dependency.target
     WHERE dependency.kind <> 'contains'
       AND source_node.file_path <> target_node.file_path
       AND COALESCE(json_extract(dependency.metadata, '$.confidence'), 1) >= ?`,

  dependentFiles: `
    SELECT DISTINCT source_node.file_path AS filePath
      FROM edges AS dependency
      JOIN nodes AS target_node ON target_node.id = dependency.target
      JOIN nodes AS source_node ON source_node.id = dependency.source
     WHERE target_node.file_path = ?
       AND dependency.kind <> 'contains'
       AND source_node.file_path <> ?`,

  dependencyFiles: `
    SELECT DISTINCT target_node.file_path AS filePath
      FROM edges AS dependency
      JOIN nodes AS source_node ON source_node.id = dependency.source
      JOIN nodes AS target_node ON target_node.id = dependency.target
     WHERE source_node.file_path = ?
       AND dependency.kind <> 'contains'
       AND target_node.file_path <> ?`,

  incomingAcrossFiles: `
    SELECT dependency.*,
           target_node.name AS target_name,
           target_node.kind AS target_kind,
           source_node.file_path AS source_file_path,
           source_node.language AS source_language
      FROM edges AS dependency
      JOIN nodes AS target_node ON target_node.id = dependency.target
      JOIN nodes AS source_node ON source_node.id = dependency.source
     WHERE target_node.file_path = ?
       AND dependency.kind <> 'contains'
       AND source_node.file_path <> ?`,
} as const;

const MODULE_TABLE = 'temp.afyx_dependency_modules';
const MODULE_PATH_COLUMN = 'file_path';

function unreferencedNodesSql(kindCount: number): string {
  return `
    SELECT candidate.*, COALESCE(file.generated, 0) AS file_generated
      FROM nodes AS candidate
      LEFT JOIN files AS file ON file.path = candidate.file_path
     WHERE candidate.kind IN (${placeholders(kindCount)})
       AND NOT EXISTS (
         SELECT 1
           FROM edges AS incoming
          WHERE incoming.target = candidate.id
            AND incoming.kind <> 'contains'
            AND incoming.source <> candidate.id
       )
  ORDER BY candidate.file_path, candidate.start_line, candidate.name
     LIMIT ?`;
}

function ambiguousNamesSql(nameCount: number): string {
  return `
    SELECT candidate_name AS name
      FROM (
        SELECT candidate.name AS candidate_name,
               EXISTS (
                 SELECT 1 FROM edges AS incoming
                  WHERE incoming.target = candidate.id AND incoming.kind <> 'contains'
               ) AS has_reference
          FROM nodes AS candidate
         WHERE candidate.name IN (${placeholders(nameCount)})
      )
  GROUP BY candidate_name
    HAVING COUNT(*) > 1 AND SUM(has_reference) > 0
  ORDER BY candidate_name`;
}

function exportedLanguagesSql(languageCount: number): string {
  return `
    SELECT language, MAX(is_exported) AS any_exported
      FROM nodes
     WHERE language IN (${placeholders(languageCount)})
  GROUP BY language
  ORDER BY language`;
}

function moduleFactsSql(): string {
  const confidence = `COALESCE(json_extract(dependency.metadata, '$.confidence'), 1)`;
  const declared = `(json_extract(dependency.metadata, '$.resolvedBy') IN ('import', 'qualified-name')
    OR dependency.kind IN ('extends', 'implements')
    OR (json_extract(dependency.metadata, '$.resolvedBy') = 'instance-method' AND ${confidence} >= 0.9))`;
  return `
    SELECT source_module.module_name AS sourceModule,
           target_module.module_name AS targetModule,
           dependency.kind AS kind,
           source_node.name AS sourceName,
           target_node.name AS targetName,
           SUM(CASE WHEN ${confidence} >= ? THEN 1 ELSE 0 END) AS confidentCount,
           SUM(CASE WHEN ${confidence} >= ? AND ${declared} THEN 1 ELSE 0 END) AS declaredCount,
           SUM(CASE WHEN ${confidence} < ? THEN 1 ELSE 0 END) AS uncertainCount
      FROM edges AS dependency
      JOIN nodes AS source_node ON source_node.id = dependency.source
      JOIN nodes AS target_node ON target_node.id = dependency.target
      JOIN ${MODULE_TABLE} AS source_module ON source_module.${MODULE_PATH_COLUMN} = source_node.file_path
      JOIN ${MODULE_TABLE} AS target_module ON target_module.${MODULE_PATH_COLUMN} = target_node.file_path
     WHERE dependency.kind IN (SELECT value FROM json_each(?))
       AND source_module.module_name <> target_module.module_name
  GROUP BY sourceModule, targetModule, dependency.kind, sourceName, targetName
  ORDER BY sourceModule, targetModule, dependency.kind, sourceName, targetName`;
}

function uniqueNonEmpty(values: Iterable<string>): string[] {
  return [...new Set(values)].filter((value) => value.length > 0);
}

function moduleKey(...parts: string[]): string {
  return parts.join('\u0000');
}

function summarizeModules(
  facts: readonly ModuleFactRow[],
  options: { topPairsPerLink: number; pairKinds: readonly EdgeKind[] }
): { links: ModuleLinkTotal[]; pairs: ModulePairTotal[] } {
  const links = new Map<string, ModuleLinkTotal>();
  const pairsByIdentity = new Map<string, ModulePairTotal>();
  const eligiblePairKinds = new Set(options.pairKinds);

  for (const fact of facts) {
    const linkIdentity = moduleKey(fact.sourceModule, fact.targetModule, fact.kind);
    const existingLink = links.get(linkIdentity);
    if (existingLink) {
      existingLink.count += fact.confidentCount;
      existingLink.declared += fact.declaredCount;
      existingLink.uncertain += fact.uncertainCount;
    } else {
      links.set(linkIdentity, {
        source: fact.sourceModule,
        target: fact.targetModule,
        kind: fact.kind,
        count: fact.confidentCount,
        declared: fact.declaredCount,
        uncertain: fact.uncertainCount,
      });
    }

    if (options.topPairsPerLink <= 0 || fact.confidentCount === 0 || !eligiblePairKinds.has(fact.kind)) continue;
    const pairIdentity = moduleKey(fact.sourceModule, fact.targetModule, fact.sourceName, fact.targetName);
    const existingPair = pairsByIdentity.get(pairIdentity);
    if (existingPair) {
      existingPair.count += fact.confidentCount;
      existingPair.declared += fact.declaredCount;
    } else {
      pairsByIdentity.set(pairIdentity, {
        source: fact.sourceModule,
        target: fact.targetModule,
        from: fact.sourceName,
        to: fact.targetName,
        count: fact.confidentCount,
        declared: fact.declaredCount,
      });
    }
  }

  const pairsByLink = new Map<string, ModulePairTotal[]>();
  for (const pair of pairsByIdentity.values()) {
    const identity = moduleKey(pair.source, pair.target);
    const candidates = pairsByLink.get(identity);
    if (candidates) candidates.push(pair);
    else pairsByLink.set(identity, [pair]);
  }

  const pairs: ModulePairTotal[] = [];
  for (const candidates of pairsByLink.values()) {
    candidates.sort((left, right) =>
      right.declared - left.declared ||
      right.count - left.count ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to)
    );
    pairs.push(...candidates.slice(0, options.topPairsPerLink));
  }
  return { links: [...links.values()], pairs };
}

export class DependencyReader {
  constructor(private readonly session: QuerySession) {}

  getUnreferencedNodes(kinds: readonly string[], limit: number): Array<{ node: Node; generated: boolean }> {
    if (kinds.length === 0 || limit <= 0) return [];
    const rows = this.session.db.prepare(unreferencedNodesSql(kinds.length)).all(...kinds, limit) as GeneratedNodeRow[];
    return rows.map((row) => ({ node: rowToNode(row), generated: row.file_generated === 1 }));
  }

  getAmbiguousReferencedNames(names: Iterable<string>): Set<string> {
    const requested = uniqueNonEmpty(names);
    const found = new Set<string>();
    for (const part of chunked(requested)) {
      const rows = this.session.db.prepare(ambiguousNamesSql(part.length)).all(...part) as NameRow[];
      for (const row of rows) found.add(row.name);
    }
    return found;
  }

  getLanguagesWithExports(languages: Iterable<string>): Set<string> {
    const requested = uniqueNonEmpty(languages);
    const found = new Set<string>();
    for (const part of chunked(requested)) {
      const rows = this.session.db.prepare(exportedLanguagesSql(part.length)).all(...part) as LanguageExportRow[];
      for (const row of rows) if (row.any_exported === 1) found.add(row.language);
    }
    return found;
  }

  getTopDependedOn(limit: number): RankedTargetRow[] {
    if (limit <= 0) return [];
    return this.session.statement(SQL.topDependedOn).all(limit) as RankedTargetRow[];
  }

  getTopCallingFiles(limit: number): RankedFileRow[] {
    if (limit <= 0) return [];
    return this.session.statement(SQL.topCallingFiles).all(limit) as RankedFileRow[];
  }

  getFileDependentCounts(filePaths: string[]): FileDependentsRow[] {
    if (filePaths.length === 0) return [];
    return this.session.statement(SQL.fileDependentCounts).all(JSON.stringify(filePaths)) as FileDependentsRow[];
  }

  getFileReachCounts(filePaths: string[]): FileReachRow[] {
    if (filePaths.length === 0) return [];
    return this.session.statement(SQL.fileReachCounts).all(JSON.stringify(filePaths)) as FileReachRow[];
  }

  aggregateModuleGraph(
    assignments: ReadonlyArray<{ filePath: string; module: string }>,
    options: { kinds: readonly EdgeKind[]; minConfidence: number; topPairsPerLink: number; pairKinds: readonly EdgeKind[] }
  ): { links: ModuleLinkTotal[]; pairs: ModulePairTotal[] } {
    if (assignments.length === 0 || options.kinds.length === 0) return { links: [], pairs: [] };

    const db = this.session.db;
    db.exec(`DROP TABLE IF EXISTS ${MODULE_TABLE}`);
    db.exec(`CREATE TEMP TABLE ${MODULE_TABLE} (${MODULE_PATH_COLUMN} TEXT PRIMARY KEY, module_name TEXT NOT NULL)`);
    try {
      const insert = db.prepare(`INSERT OR REPLACE INTO ${MODULE_TABLE} (${MODULE_PATH_COLUMN}, module_name) VALUES (?, ?)`);
      db.transaction(() => {
        for (const assignment of assignments) insert.run(assignment.filePath, assignment.module);
      })();
      const facts = db.prepare(moduleFactsSql()).all(
        options.minConfidence,
        options.minConfidence,
        options.minConfidence,
        JSON.stringify(options.kinds)
      ) as ModuleFactRow[];
      return summarizeModules(facts, options);
    } finally {
      db.exec(`DROP TABLE IF EXISTS ${MODULE_TABLE}`);
    }
  }

  getCrossFileDependencyPairs(minConfidence: number): FilePairRow[] {
    return this.session.statement(SQL.crossFilePairs).all(minConfidence) as FilePairRow[];
  }

  getDependentFilePaths(filePath: string): string[] {
    const rows = this.session.statement(SQL.dependentFiles).all(filePath, filePath) as FilePathRow[];
    return rows.map(({ filePath: dependencyPath }) => dependencyPath);
  }

  getDependencyFilePaths(filePath: string): string[] {
    const rows = this.session.statement(SQL.dependencyFiles).all(filePath, filePath) as FilePathRow[];
    return rows.map(({ filePath: dependencyPath }) => dependencyPath);
  }

  getCrossFileIncomingEdgesWithTarget(filePath: string): Array<Edge & {
    targetName: string;
    targetKind: NodeKind;
    sourceFilePath: string;
    sourceLanguage: Language;
  }> {
    const rows = this.session.statement(SQL.incomingAcrossFiles).all(filePath, filePath) as IncomingDependencyRow[];
    return rows.map((row) => ({
      ...rowToEdge(row),
      targetName: row.target_name,
      targetKind: row.target_kind,
      sourceFilePath: row.source_file_path,
      sourceLanguage: row.source_language,
    }));
  }
}
