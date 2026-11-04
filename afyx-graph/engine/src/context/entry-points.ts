/**
 * From ranked candidates to the entry points a context is built around, and how
 * much to trust them.
 *
 * Selection: rank, keep a bounded pool, drop weak scores, replace import/export
 * statements by the definitions they point at, and cap the count so expansion
 * budget is not spread too thin.
 */

import path from 'path';
import type { EdgeKind, SearchResult } from '../types';
import type { QueryBuilder } from '../db/queries';
import { extractSearchTerms } from '../search/query-utils';
import { logDebug } from '../errors';
import type { Request } from './request';
import { byScoreDescending } from './rerank';

const POOL_FACTOR = 3;
const MIN_CONFIDENCE_TERM = 3;

/**
 * Someone searching "terminal" and hitting `import { TerminalPanel }` wants the
 * class, not the statement. Imports/exports are followed to their definitions;
 * one that resolves to nothing is dropped. Nodes appear at most once, keeping the
 * score of the statement that led to them.
 */
function resolveStatements(queries: QueryBuilder, candidates: SearchResult[]): SearchResult[] {
  const resolved: SearchResult[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const { node, score } = candidate;
    if (node.kind !== 'import' && node.kind !== 'export') {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        resolved.push(candidate);
      }
      continue;
    }
    const relation: EdgeKind = node.kind === 'import' ? 'imports' : 'exports';
    let followed = false;
    for (const edge of queries.getOutgoingEdges(node.id, [relation])) {
      const definition = queries.getNodeById(edge.target);
      if (!definition || seen.has(definition.id)) continue;
      seen.add(definition.id);
      resolved.push({ node: definition, score });
      followed = true;
      logDebug('Resolved import to definition', { import: node.name, definition: definition.name, kind: definition.kind });
    }
    if (!followed) logDebug('Skipping unresolved import', { name: node.name, file: node.filePath });
  }
  return resolved;
}

export function selectEntryPoints(req: Request, queries: QueryBuilder, ranked: SearchResult[]): SearchResult[] {
  const { searchLimit, minScore } = req.settings;
  const pool = [...ranked].sort(byScoreDescending).slice(0, searchLimit * POOL_FACTOR);
  const strong = pool.filter((candidate) => candidate.score >= minScore);
  return resolveStatements(queries, strong).slice(0, searchLimit);
}

/**
 * 'low' when a multi-term prose query resolved only to isolated common-word
 * matches: no entry point is corroborated by two distinct query terms, and none is
 * a distinctive identifier the user named. Single-keyword and symbol-name queries
 * are exempt (their one match IS the answer). Callers use it to hand the reader
 * precise follow-up tools instead of a false claim of completeness.
 */
export function assessConfidence(req: Request, entries: readonly SearchResult[]): 'high' | 'low' {
  const terms = extractSearchTerms(req.query, { stems: false }).filter((term) => term.length >= MIN_CONFIDENCE_TERM);
  if (terms.length < 2 || entries.length === 0) return 'high';

  const corroborated = (name: string, filePath: string): boolean => {
    const directories = path.dirname(filePath).toLowerCase().split('/');
    let hits = 0;
    for (const term of terms) {
      if ((name.includes(term) || directories.includes(term)) && ++hits >= 2) return true;
    }
    return false;
  };
  const anyStrong = entries.some(({ node }) => {
    const name = node.name.toLowerCase();
    return req.distinctiveNames.has(name) || corroborated(name, node.filePath);
  });
  return anyStrong ? 'high' : 'low';
}
