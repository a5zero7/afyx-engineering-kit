/**
 * Candidates the name and text channels cannot reach: symbols whose name merely
 * CONTAINS a query word ("Search" inside TransportSearchAction), found by substring
 * lookup because full-text search sees one token per name.
 *
 *   hump      the word sits at a CamelCase or acronym boundary inside the name;
 *             candidates accumulate across words so one matching several ranks higher
 *   compound  the name contains two or more distinct query words at any position
 *
 * Both append to the shared candidate list, skip nodes already present, skip test
 * files unless the query is about tests, and are rate-limited so they cannot crowd
 * out the primary channels.
 */

import type { NodeKind, SearchResult } from '../types';
import type { QueryBuilder } from '../db/queries';
import { scorePathRelevance } from '../search/query-utils';
import type { Request } from './request';
import { DEFINITION_KINDS, titleCase } from './seeding';
import { byScoreDescending } from './rerank';

const CALLABLE_KINDS: NodeKind[] = ['function', 'method', 'component'];
const LOOKUP_LIMIT = 200;
const MIN_WORD = 3;

const HUMP_BASE = 8;
const HUMP_BREVITY = 6;
const HUMP_BREVITY_SPAN = 4;
const HUMP_TERM_BONUS = 30;
const POOL_PER_SLOT = 4;

const COMPOUND_BASE = 10;
const COMPOUND_TERM_BONUS = 20;
const COMPOUND_BREVITY = 6;
const COMPOUND_BREVITY_SPAN = 8;

/** Types are fetched separately from callables so one hot word cannot crowd either out of the length-ordered batch. */
function lookup(queries: QueryBuilder, word: string, excludePrefix: boolean): SearchResult[] {
  return [
    ...queries.findNodesByNameSubstring(word, { limit: LOOKUP_LIMIT, kinds: DEFINITION_KINDS, excludePrefix }),
    ...queries.findNodesByNameSubstring(word, { limit: LOOKUP_LIMIT, kinds: CALLABLE_KINDS, excludePrefix }),
  ];
}

const pathScore = (req: Request, filePath: string): number => scorePathRelevance(filePath, req.query, undefined, req.isDeprioritized(filePath));

/** Where `word` first occurs inside `name` at a hump, or -1. The occurrence must land on a capital and follow a letter. */
function humpIndex(name: string, word: string): number {
  const at = name.toLowerCase().indexOf(word);
  if (at <= 0) return -1;
  if (!/[A-Z]/.test(name.charAt(at))) return -1;
  return /[a-zA-Z]/.test(name.charAt(at - 1)) ? at : -1;
}

export function addHumpMatches(req: Request, queries: QueryBuilder, into: SearchResult[], taken: Set<string>): void {
  const { settings, symbols } = req;
  const slots = Math.ceil(settings.searchLimit / 2);
  const searched = new Set<string>();
  const accumulated = new Map<string, { hit: SearchResult; words: number }>();

  for (const symbol of symbols) {
    const word = titleCase(symbol);
    if (word.length < MIN_WORD) continue;
    const key = word.toLowerCase();
    if (searched.has(key)) continue;
    searched.add(key);

    const candidates: SearchResult[] = [];
    for (const { node } of lookup(queries, word, true)) {
      if (humpIndex(node.name, key) < 0) continue;
      if (taken.has(node.id)) continue;
      if (req.isTestFile(node.filePath) && !req.mentionsTests) continue;
      const brevity = Math.max(0, HUMP_BREVITY - (node.name.length - word.length) / HUMP_BREVITY_SPAN);
      candidates.push({ node, score: HUMP_BASE + brevity + pathScore(req, node.filePath) });
    }
    candidates.sort(byScoreDescending);

    // A wider pool than the final slots, so matches to several words can surface.
    for (const hit of candidates.slice(0, slots * POOL_PER_SLOT)) {
      const seen = accumulated.get(hit.node.id);
      if (seen) seen.words++;
      else accumulated.set(hit.node.id, { hit, words: 1 });
    }
  }

  // A node matching several words is almost certainly the target: scale its score aggressively.
  const scaled = [...accumulated.values()].map(({ hit, words }) => {
    hit.score = hit.score * (1 + words) + (words - 1) * HUMP_TERM_BONUS;
    return hit;
  });
  for (const hit of scaled.sort(byScoreDescending).slice(0, settings.searchLimit)) {
    into.push(hit);
    taken.add(hit.node.id);
  }
}

export function addCompoundMatches(req: Request, queries: QueryBuilder, into: SearchResult[], taken: Set<string>): void {
  const { settings, symbols } = req;
  if (symbols.length < 2) return;

  const wordsByNode = new Map<string, { node: SearchResult['node']; words: Set<string> }>();
  const looked = new Set<string>();
  for (const symbol of symbols) {
    const word = titleCase(symbol);
    if (word.length < MIN_WORD || looked.has(word)) continue; // an identical lookup adds nothing new
    looked.add(word);
    for (const { node } of lookup(queries, word, false)) {
      if (taken.has(node.id)) continue;
      if (req.isTestFile(node.filePath) && !req.mentionsTests) continue;
      const entry = wordsByNode.get(node.id);
      if (entry) entry.words.add(word);
      else wordsByNode.set(node.id, { node, words: new Set([word]) });
    }
  }

  const matches: SearchResult[] = [];
  for (const { node, words } of wordsByNode.values()) {
    if (words.size < 2) continue;
    const brevity = Math.max(0, COMPOUND_BREVITY - node.name.length / COMPOUND_BREVITY_SPAN);
    matches.push({ node, score: COMPOUND_BASE + (words.size - 1) * COMPOUND_TERM_BONUS + pathScore(req, node.filePath) + brevity });
  }
  for (const hit of matches.sort(byScoreDescending).slice(0, Math.ceil(settings.searchLimit / 2))) {
    into.push(hit);
    taken.add(hit.node.id);
  }
}
