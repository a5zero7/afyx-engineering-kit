/**
 * Candidate entry points from three independent channels.
 *
 *   names        exact symbol names the query mentions (plus caller-supplied seed
 *                names at a discount), boosted when several land in one file
 *   definitions  type definitions whose name STARTS with a mentioned word ("REST"
 *                → RestController), favouring short names
 *   text         full-text search per query term, boosted when a node matches
 *                several terms
 *
 * Channels return scored candidates; merging and re-ranking happen elsewhere.
 * Each channel keeps the failure semantics the pipeline relies on: the name and
 * text channels swallow storage errors and contribute what they had, the
 * definition channel does not.
 */

import type { NodeKind, SearchResult } from '../types';
import { getStemVariants } from '../search/query-utils';
import { logDebug } from '../errors';
import type { Request } from './request';
import type { QueryBuilder } from '../db/queries';

const SEED_DISCOUNT = 0.6;
const CO_LOCATION_BONUS = 20;
const DEFINITION_BONUS = 15;
const MULTI_TERM_BONUS = 5;

/** Kinds that introduce a named type. */
export const DEFINITION_KINDS: NodeKind[] = ['class', 'interface', 'struct', 'union', 'trait', 'protocol', 'enum', 'type_alias'];

/** Kinds searched by text when the caller did not restrict them (imports excluded: they flood matches). */
const TEXT_SEARCH_KINDS: NodeKind[] = [
  'file', 'module', 'class', 'struct', 'union', 'interface', 'trait', 'protocol', 'function', 'method', 'property', 'field',
  'variable', 'constant', 'enum', 'enum_member', 'type_alias', 'namespace', 'export', 'route', 'component',
];

export const titleCase = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

const byScoreDescending = (a: SearchResult, b: SearchResult): number => b.score - a.score;

// ---- names -------------------------------------------------------------------------------

/** Several mentioned symbols defined in one file is strong evidence that file is the answer. */
function boostCoLocated(matches: SearchResult[]): SearchResult[] {
  const namesByFile = new Map<string, Set<string>>();
  for (const { node } of matches) {
    const names = namesByFile.get(node.filePath) ?? new Set<string>();
    names.add(node.name.toLowerCase());
    namesByFile.set(node.filePath, names);
  }
  return matches
    .map((match) => {
      const distinct = namesByFile.get(match.node.filePath)?.size || 1;
      return { ...match, score: distinct > 1 ? match.score + (distinct - 1) * CO_LOCATION_BONUS : match.score };
    })
    .sort(byScoreDescending);
}

export function nameSeeds(req: Request, queries: QueryBuilder): SearchResult[] {
  const { settings, symbols } = req;
  let matches: SearchResult[] = [];
  if (symbols.length === 0 && settings.seedNames.length === 0) return matches;

  const kinds = settings.nodeKinds && settings.nodeKinds.length > 0 ? settings.nodeKinds : undefined;
  try {
    if (symbols.length > 0) {
      // Fetch extra so the co-location boost can reorder before the cut.
      matches = queries.findNodesByExactName([...symbols], { limit: Math.ceil(settings.searchLimit * 5), kinds });
    }
    if (settings.seedNames.length > 0) {
      // Word-level terms cannot reach camelCase names through full-text search, so the caller resolves
      // them to names. They enter at a discount (a symbol the query names outright outranks one derived
      // from its segments) but before the co-location boost, which they help earn.
      const known = new Set(matches.map((match) => match.node.id));
      const seeded = [...matches];
      for (const found of queries.findNodesByExactName(settings.seedNames, { limit: Math.ceil(settings.searchLimit * 3), kinds })) {
        if (known.has(found.node.id)) continue;
        known.add(found.node.id);
        seeded.push({ ...found, score: found.score * SEED_DISCOUNT });
      }
      matches = seeded;
    }
    if (matches.length > 1) matches = boostCoLocated(matches);
    matches = matches.slice(0, Math.ceil(settings.searchLimit * 2));
  } catch (error) {
    logDebug('Exact symbol lookup failed', { error: String(error) });
  }
  return matches;
}

// ---- definitions -------------------------------------------------------------------------

/** Concise names are usually the core types; verbose ones are helpers and test doubles. */
const brevityBonus = (name: string, prefix: string): number => Math.max(0, 10 - (name.length - prefix.length) / 3);

export function withDefinitionSeeds(req: Request, queries: QueryBuilder, matches: SearchResult[]): SearchResult[] {
  const { settings, symbols } = req;
  if (symbols.length === 0) return matches;

  const words = new Set(symbols);
  for (const symbol of symbols) for (const variant of getStemVariants(symbol)) words.add(variant);

  const result = [...matches];
  const present = new Set(result.map((match) => match.node.id));
  for (const word of words) {
    const prefix = titleCase(word);
    if (prefix === word) continue; // already title-cased: the name channel handles it
    const wanted = prefix.toLowerCase();
    const candidates = queries.searchNodes(prefix, { limit: 30, kinds: DEFINITION_KINDS })
      .filter(({ node }) => node.name.toLowerCase().startsWith(wanted))
      .map((hit) => ({ ...hit, score: hit.score + DEFINITION_BONUS + brevityBonus(hit.node.name, prefix) }))
      .sort(byScoreDescending);
    for (const candidate of candidates.slice(0, Math.ceil(settings.searchLimit))) {
      if (present.has(candidate.node.id)) continue;
      present.add(candidate.node.id);
      result.push(candidate);
    }
  }
  return result.sort(byScoreDescending).slice(0, Math.ceil(settings.searchLimit * 3));
}

// ---- text --------------------------------------------------------------------------------

export function textSeeds(req: Request, queries: QueryBuilder): SearchResult[] {
  const { settings, terms } = req;
  if (terms.length === 0) return [];
  try {
    const kinds = settings.nodeKinds && settings.nodeKinds.length > 0 ? settings.nodeKinds : TEXT_SEARCH_KINDS;
    const bestByNode = new Map<string, { hit: SearchResult; terms: number }>();
    for (const term of terms) {
      for (const hit of queries.searchNodes(term, { limit: settings.searchLimit * 2, kinds })) {
        const seen = bestByNode.get(hit.node.id);
        if (seen) {
          seen.terms++;
          seen.hit.score = Math.max(seen.hit.score, hit.score);
        } else {
          bestByNode.set(hit.node.id, { hit, terms: 1 });
        }
      }
    }
    return [...bestByNode.values()]
      .map(({ hit, terms: matched }) => ({ ...hit, score: hit.score + (matched - 1) * MULTI_TERM_BONUS }))
      .sort(byScoreDescending)
      .slice(0, settings.searchLimit * 2);
  } catch (error) {
    logDebug('Text search failed', { query: req.query, error: String(error) });
    return [];
  }
}
