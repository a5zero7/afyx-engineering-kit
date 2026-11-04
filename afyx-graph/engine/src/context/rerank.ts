/**
 * Merging and re-ranking of candidates from every channel.
 *
 * Stages operate on one shared candidate list and adjust scores in place, in this
 * order: merge duplicates (best score wins), demote test files, favour the project's
 * core directory, then re-rank by how many distinct query concepts each candidate
 * corroborates. Ordering ties always keep insertion order (stable sorts).
 */

import path from 'path';
import type { SearchResult } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { Request } from './request';

const TEST_FILE_DEMOTION = 0.3;
const CORE_DIRECTORY_BONUS = 25;
const DOMINANCE_RATIO = 3;
const CORROBORATED_STEP = 0.5;
const UNCORROBORATED_COMMON_WORD = 0.3;
const UNCORROBORATED_GENERIC = 0.6;

export const byScoreDescending = (a: SearchResult, b: SearchResult): number => b.score - a.score;

/** One entry per node across channels, in first-seen order, carrying the best score any channel gave it. */
export function mergeChannels(...channels: SearchResult[][]): SearchResult[] {
  const byNode = new Map<string, SearchResult>();
  const merged: SearchResult[] = [];
  for (const channel of channels) {
    for (const candidate of channel) {
      const known = byNode.get(candidate.node.id);
      if (known) {
        known.score = Math.max(known.score, candidate.score);
      } else {
        byNode.set(candidate.node.id, candidate);
        merged.push(candidate);
      }
    }
  }
  return merged;
}

/** Tests demoted early so they do not take slots meant for the multi-term boost. */
export function demoteTestFiles(req: Request, candidates: SearchResult[]): void {
  if (req.mentionsTests) return;
  for (const candidate of candidates) {
    if (req.isTestFile(candidate.node.filePath)) candidate.score *= TEST_FILE_DEMOTION;
  }
}

/**
 * When one file holds the dense majority of the project's internal edges (at least
 * three times the runner-up), questions are usually about that core, and small
 * sibling extension files would otherwise outrank it. Candidates in the core's
 * directory get a bonus.
 */
export function favourCoreDirectory(candidates: SearchResult[], queries: QueryBuilder): void {
  try {
    const dominant = queries.getDominantFile?.();
    if (!dominant || dominant.edgeCount < DOMINANCE_RATIO * dominant.nextEdgeCount) return;
    const slash = dominant.filePath.lastIndexOf('/');
    if (slash <= 0) return;
    const coreDirectory = dominant.filePath.slice(0, slash + 1);
    for (const candidate of candidates) {
      if (candidate.node.filePath.startsWith(coreDirectory)) candidate.score += CORE_DIRECTORY_BONUS;
    }
  } catch {
    // Without the dominant-file statistics ranking simply proceeds unboosted.
  }
}

/**
 * Terms that contain one another (stem variants of one root) are one concept, so
 * "indexed", "indexe" and "index" count once. Groups are seeded from the longest term.
 */
function conceptGroups(terms: readonly string[]): string[][] {
  const longestFirst = [...terms].sort((a, b) => b.length - a.length);
  const claimed = new Set<string>();
  const groups: string[][] = [];
  for (const term of longestFirst) {
    if (claimed.has(term)) continue;
    const group = [term];
    claimed.add(term);
    for (const other of longestFirst) {
      if (claimed.has(other)) continue;
      if (term.includes(other) || other.includes(term)) {
        group.push(other);
        claimed.add(other);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Re-rank by corroboration. A candidate matching two or more concepts (in its name,
 * or as an exact directory name) is multiplied up; one named by a distinctive
 * identifier the user typed keeps its score; an exact match on a common word is
 * demoted hard; anything else is dampened mildly. Applies to multi-term queries only.
 */
export function corroborate(req: Request, candidates: SearchResult[], exactNames: readonly SearchResult[]): void {
  if (req.terms.length < 2) return;

  const groups = conceptGroups(req.terms);
  const exactIds = new Set(exactNames.map((match) => match.node.id));
  const distinctiveIds = new Set(exactNames.filter((match) => req.distinctiveNames.has(match.node.name.toLowerCase())).map((match) => match.node.id));

  for (const candidate of candidates) {
    const name = candidate.node.name.toLowerCase();
    const directories = path.dirname(candidate.node.filePath).toLowerCase().split('/');
    let concepts = 0;
    for (const group of groups) {
      if (group.some((term) => name.includes(term) || directories.some((segment) => segment === term))) concepts++;
    }

    if (concepts >= 2) candidate.score *= 1 + concepts * CORROBORATED_STEP;
    else if (distinctiveIds.has(candidate.node.id)) continue;
    else if (exactIds.has(candidate.node.id)) candidate.score *= UNCORROBORATED_COMMON_WORD;
    else candidate.score *= UNCORROBORATED_GENERIC;
  }
  candidates.sort(byScoreDescending);
}
