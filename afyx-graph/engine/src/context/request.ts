/**
 * Everything about a query that is computed once per request and shared by every
 * stage: the symbols it names, its search terms, whether it is about tests, and
 * memoised path classification. Stages take the request instead of re-deriving
 * these facts, which is where the per-candidate cost used to go.
 */

import type { QueryBuilder } from '../db/queries';
import type { GraphTraverser } from '../graph';
import { extractSearchTerms, isDistinctiveIdentifier, isTestFile } from '../search/query-utils';
import type { FindSettings } from './settings';
import { symbolsNamedIn } from './query-symbols';

export interface Backend {
  queries: QueryBuilder;
  traverser: GraphTraverser;
}

export interface Request {
  readonly query: string;
  readonly settings: FindSettings;
  /** Symbol-shaped words the query names. */
  readonly symbols: readonly string[];
  /** Lowercased names of those symbols that were typed as deliberate identifiers. */
  readonly distinctiveNames: ReadonlySet<string>;
  /** Search terms including stem variants. */
  readonly terms: readonly string[];
  /** A query about tests keeps test files in play instead of demoting them. */
  readonly mentionsTests: boolean;
  isTestFile(filePath: string): boolean;
  isDeprioritized(filePath: string): boolean;
}

export function createRequest(query: string, settings: FindSettings, queries: QueryBuilder): Request {
  const symbols = symbolsNamedIn(query);
  const lowered = query.toLowerCase();
  const matcher = queries.getDeprioritizedPathMatcher();
  const testVerdicts = new Map<string, boolean>();
  return {
    query,
    settings,
    symbols,
    distinctiveNames: new Set(symbols.filter(isDistinctiveIdentifier).map((symbol) => symbol.toLowerCase())),
    terms: extractSearchTerms(query),
    mentionsTests: lowered.includes('test') || lowered.includes('spec'),
    isTestFile(filePath) {
      let verdict = testVerdicts.get(filePath);
      if (verdict === undefined) {
        verdict = isTestFile(filePath);
        testVerdicts.set(filePath, verdict);
      }
      return verdict;
    },
    isDeprioritized: (filePath) => matcher?.(filePath) ?? false,
  };
}
