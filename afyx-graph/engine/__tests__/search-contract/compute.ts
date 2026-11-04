import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NODE_KINDS, LANGUAGES } from '../../src/types';
import {
  splitIdentifierSegments, normalizeProseWord, extractProseCandidates, extractSegmentSearchWords, segmentLookupVariants,
} from '../../src/search/identifier-segments';
import { parseQuery, boundedEditDistance } from '../../src/search/query-parser';
import { queryMightContainPaths, extractQueryPaths } from '../../src/search/query-paths';
import {
  normalizeNameToken, deriveProjectNameTokens, STOP_WORDS, getStemVariants, extractSearchTerms, scorePathRelevance,
  isTestFile, isTestPath, nameMatchBonus, kindBonus, isDistinctiveIdentifier,
} from '../../src/search/query-utils';
import {
  IDENTIFIERS, PROSE, QUERIES, NODE_NAMES, PATHS, SCORING_PATHS, SCORING_QUERIES, PROJECT_TOKEN_SETS, INDEXED_PATHS,
  IDENTIFIER_PAIRS, STEM_WORDS, KIND_SAMPLES, PROJECT_CASES, nameDerivedQueries,
} from './corpus';

/** Runs every exported search function over the corpus; the result is the observable contract. */
export function computeSearchContract(): Record<string, unknown> {
  const words = [...new Set([...IDENTIFIERS, ...STEM_WORDS, ...PROSE.flatMap((line) => line.split(/\s+/))])];
  const kindQueries = [...NODE_KINDS.map((kind) => `kind:${kind} sample`), ...LANGUAGES.map((language) => `lang:${language} sample`)];

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-search-contract-'));
  let projectTokens: Record<string, string[]> = {};
  try {
    projectTokens = Object.fromEntries(PROJECT_CASES.map((entry) => {
      const dir = path.join(projectRoot, entry.dir);
      fs.mkdirSync(dir, { recursive: true });
      if (entry.goMod !== undefined) fs.writeFileSync(path.join(dir, 'go.mod'), entry.goMod);
      if (entry.packageJson !== undefined) fs.writeFileSync(path.join(dir, 'package.json'), entry.packageJson);
      return [entry.dir, [...deriveProjectNameTokens(dir)].sort()];
    }));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }

  const scoring: number[] = [];
  for (const tokens of PROJECT_TOKEN_SETS) {
    const set = tokens ? new Set(tokens) : undefined;
    for (const query of SCORING_QUERIES) {
      for (const filePath of SCORING_PATHS) {
        scoring.push(scorePathRelevance(filePath, query, set, false));
        if (tokens === undefined) scoring.push(scorePathRelevance(filePath, query, set, true));
      }
    }
  }

  return {
    splitIdentifierSegments: IDENTIFIERS.map(splitIdentifierSegments),
    normalizeProseWord: words.map(normalizeProseWord),
    extractProseCandidates: [...PROSE, ...QUERIES].map(extractProseCandidates),
    extractSegmentSearchWords: [...PROSE, ...QUERIES, ...IDENTIFIERS].map(extractSegmentSearchWords),
    segmentLookupVariants: words.map(segmentLookupVariants),
    parseQuery: [...QUERIES, ...kindQueries].map(parseQuery),
    boundedEditDistance: [0, 1, 2, 3].flatMap((max) => IDENTIFIER_PAIRS.map(([a, b]) => boundedEditDistance(a, b, max))),
    queryMightContainPaths: [...QUERIES, ...IDENTIFIERS].map(queryMightContainPaths),
    extractQueryPaths: QUERIES.flatMap((query) => [
      extractQueryPaths(query, INDEXED_PATHS),
      extractQueryPaths(query, INDEXED_PATHS, { maxPins: 2, maxMatchesPerSpan: 1 }),
      extractQueryPaths(query, []),
    ]),
    normalizeNameToken: [...IDENTIFIERS, ...QUERIES].map(normalizeNameToken),
    deriveProjectNameTokens: projectTokens,
    STOP_WORDS: [...STOP_WORDS].sort(),
    getStemVariants: words.map(getStemVariants),
    extractSearchTerms: [...QUERIES, ...IDENTIFIERS].flatMap((query) => [
      extractSearchTerms(query),
      extractSearchTerms(query, { stems: false }),
      extractSearchTerms(query, { stems: true }),
    ]),
    scorePathRelevance: scoring,
    isTestFile: PATHS.map(isTestFile),
    isTestPath: PATHS.map(isTestPath),
    nameMatchBonus: NODE_NAMES.flatMap((name) => [...QUERIES, ...SCORING_QUERIES, ...nameDerivedQueries(name)].map((query) => nameMatchBonus(name, query))),
    kindBonus: KIND_SAMPLES.map((kind) => kindBonus(kind as never)),
    isDistinctiveIdentifier: [...IDENTIFIERS, ...words].map(isDistinctiveIdentifier),
  };
}
