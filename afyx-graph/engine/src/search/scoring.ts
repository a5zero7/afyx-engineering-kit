/**
 * Ranking signals applied to search candidates.
 *
 *   nameMatchBonus       how well a symbol NAME matches the query      (0 … 80)
 *   kindBonus            how useful a symbol KIND usually is             (0 … 10)
 *   scorePathRelevance   how well a file PATH matches the query   (−15 … +N)
 *   isDistinctiveIdentifier   did the user type this token as an identifier?
 *
 * All three scores are integers, pure functions of their arguments and
 * deterministic. A search scores thousands of candidates against ONE query, so the
 * query-only work (splitting, normalizing, term extraction) is compiled once per
 * distinct query string and reused: small bounded caches of derived values, which
 * never change a result.
 */

import * as nodePath from 'path';
import type { Node } from '../types';
import { extractSearchTerms } from './terms';
import { isTestFile } from './test-paths';
import { normalizeNameToken } from './project-names';

// ---- compiled-query cache ----------------------------------------------------------

const CACHE_LIMIT = 64;

/** Least-recently-inserted eviction is enough: queries repeat in bursts. */
class QueryCache<T> {
  private readonly entries = new Map<string, T>();
  constructor(private readonly build: (query: string) => T) {}

  get(query: string): T {
    let value = this.entries.get(query);
    if (value === undefined) {
      value = this.build(query);
      if (this.entries.size >= CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value as string);
      this.entries.set(query, value);
    }
    return value;
  }
}

// ---- symbol name ---------------------------------------------------------------------

interface NameProbe {
  /** Query with whitespace removed, lowercased: the whole query as one identifier. */
  joined: string;
  /** Whitespace-separated words of at least two characters, lowercased. */
  words: string[];
  /** Words after splitting camel humps and `_ . -`, at least two characters. */
  parts: string[];
}

const MIN_WORD = 2;

const nameProbes = new QueryCache<NameProbe>((query) => ({
  joined: query.replace(/\s+/g, '').toLowerCase(),
  words: query.split(/\s+/).map((word) => word.toLowerCase()).filter((word) => word.length >= MIN_WORD),
  parts: query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_.\-]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= MIN_WORD),
}));

const EXACT_NAME = 80;
const EXACT_WORD = 60;
const ALL_PARTS = 15;
const SUBSTRING = 10;
const PREFIX_BASE = 10;
const PREFIX_SPAN = 30;

/**
 * First rule that applies wins: exact name; exact word of a multi-word query;
 * name starting with the query (scaled by how much of the name it covers); every
 * part of a multi-part query inside the name; the query as a substring.
 */
export function nameMatchBonus(nodeName: string, query: string): number {
  const name = nodeName.toLowerCase();
  const probe = nameProbes.get(query);

  if (name === probe.joined) return EXACT_NAME;
  if (probe.words.length > 1 && probe.words.includes(name)) return EXACT_WORD;
  if (name.startsWith(probe.joined)) return Math.round(PREFIX_BASE + PREFIX_SPAN * (probe.joined.length / name.length));
  if (probe.parts.length > 1 && probe.parts.every((part) => name.includes(part))) return ALL_PARTS;
  return name.includes(probe.joined) ? SUBSTRING : 0;
}

// ---- symbol kind ---------------------------------------------------------------------

const KIND_WEIGHTS: ReadonlyMap<string, number> = new Map<string, number>([
  ['function', 10], ['method', 10],
  ['interface', 9], ['trait', 9], ['protocol', 9], ['route', 9],
  ['class', 8], ['component', 8],
  ['type_alias', 6], ['struct', 6], ['union', 6],
  ['enum', 5],
  ['module', 4], ['namespace', 4],
  ['property', 3], ['field', 3], ['constant', 3], ['enum_member', 3],
  ['variable', 2],
  ['import', 1], ['export', 1],
  ['parameter', 0], ['file', 0],
]);

export function kindBonus(kind: Node['kind']): number {
  return KIND_WEIGHTS.get(kind) ?? 0;
}

// ---- file path -----------------------------------------------------------------------

interface QueryWords {
  /** Each whitespace-separated word with the base terms it contributes (no stems). */
  words: Array<{ normalized: string; terms: string[] }>;
  /** A test-shaped query lifts the built-in penalty on test/fixture paths. */
  mentionsTests: boolean;
}

const queryWords = new QueryCache<QueryWords>((query) => {
  const lowered = query.toLowerCase();
  return {
    words: query
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .map((word) => ({ normalized: normalizeNameToken(word), terms: extractSearchTerms(word, { stems: false }) })),
    mentionsTests: lowered.includes('test') || lowered.includes('spec'),
  };
});

const FILE_NAME_HIT = 10;
const DIRECTORY_HIT = 5;
const ELSEWHERE_IN_PATH_HIT = 3;
const OFF_TARGET_PENALTY = 15;

/**
 * Each query WORD counts once per path level, however many sub-terms it splits into
 * (a PascalCase project name would otherwise score several times for one concept).
 * Words that merely name the project are ignored unless nothing else remains.
 * Test/fixture paths lose points unless the query is about tests; a path the
 * project itself declared peripheral (`isDeprioritized`) always does, and a path
 * that is both is docked once.
 */
export function scorePathRelevance(
  filePath: string,
  query: string,
  projectNameTokens?: Set<string>,
  isDeprioritized?: boolean,
): number {
  const compiled = queryWords.get(query);
  if (compiled.words.length === 0) return 0;

  const ignoring = projectNameTokens !== undefined && projectNameTokens.size > 0;
  const specific = ignoring ? compiled.words.filter((word) => !projectNameTokens.has(word.normalized)) : compiled.words;
  const scored = specific.length > 0 ? specific : compiled.words;

  const fullPath = filePath.toLowerCase();
  const fileName = nodePath.basename(filePath).toLowerCase();
  const directory = nodePath.dirname(filePath).toLowerCase();

  let score = 0;
  for (const { terms } of scored) {
    if (terms.length === 0) continue;
    if (terms.some((term) => fileName.includes(term))) score += FILE_NAME_HIT;
    if (terms.some((term) => directory.includes(term))) score += DIRECTORY_HIT;
    else if (terms.some((term) => fullPath.includes(term))) score += ELSEWHERE_IN_PATH_HIT;
  }

  const offTarget = (!compiled.mentionsTests && isTestFile(filePath)) || isDeprioritized === true;
  return offTarget ? score - OFF_TARGET_PENALTY : score;
}

// ---- identifier shape ----------------------------------------------------------------

/**
 * Does the token look like an identifier the user deliberately typed (snake_case,
 * an embedded digit, or a capital after the first character) rather than a plain
 * word? Judged on the token as typed, so "flat" is a word even though it matches
 * the constant FLAT, and a lone leading capital ("Screen") is not enough.
 */
export function isDistinctiveIdentifier(token: string): boolean {
  if (!token) return false;
  return /[_0-9]/.test(token) || /[A-Z]/.test(token.slice(1));
}
