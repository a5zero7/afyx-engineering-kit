/**
 * Query → full-text search terms.
 *
 * Pipeline (all lowercase, first-seen order, no duplicates):
 *   1. compound identifiers kept whole (camelCase / PascalCase, then snake_case),
 *   2. the same text split into words at humps, underscores, dots and punctuation,
 *      dropping short words and stop words,
 *   3. optionally, stem variants of everything above (see stemming.ts).
 * Keeping the compound next to its parts lets full-text search match both the
 * whole symbol name and a single word inside it.
 */

import { STOP_WORDS } from './vocabulary';
import { getStemVariants } from './stemming';

const MIN_COMPOUND = 3;
const MIN_WORD = 3;

const CAMEL_COMPOUND = /\b([a-zA-Z][a-zA-Z0-9]*(?:[A-Z][a-z]+)+|[A-Z][a-z]+(?:[A-Z][a-z]*)+)\b/g;
const SNAKE_COMPOUND = /\b([a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+)\b/g;

function addCompounds(query: string, into: Set<string>): void {
  for (const pattern of [CAMEL_COMPOUND, SNAKE_COMPOUND]) {
    // Shared global regexes: rewind before use and scan synchronously to completion.
    pattern.lastIndex = 0;
    for (let match = pattern.exec(query); match !== null; match = pattern.exec(query)) {
      const compound = match[1];
      if (compound && compound.length >= MIN_COMPOUND) into.add(compound.toLowerCase());
    }
  }
}

function addWords(query: string, into: Set<string>): void {
  const spaced = query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ');
  for (const piece of spaced.split(/[^a-zA-Z0-9]+/)) {
    if (piece.length < MIN_WORD) continue;
    const word = piece.toLowerCase();
    if (!STOP_WORDS.has(word)) into.add(word);
  }
}

export function extractSearchTerms(query: string, options?: { stems?: boolean }): string[] {
  const terms = new Set<string>();
  addCompounds(query, terms);
  addWords(query, terms);
  if (options?.stems === false) return [...terms];

  const expansions = new Set<string>();
  for (const term of terms) {
    for (const variant of getStemVariants(term)) {
      if (!terms.has(variant) && !STOP_WORDS.has(variant)) expansions.add(variant);
    }
  }
  return [...terms, ...expansions];
}
