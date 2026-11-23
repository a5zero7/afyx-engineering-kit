/**
 * Deterministic policy for choosing among already-discovered resolution candidates.
 *
 * Candidate discovery and language/scope eligibility remain with their specialized
 * resolvers. This module owns only stable precedence: call-site locality, path
 * proximity, language/kind/export bonuses, and first-candidate tie behavior.
 */

import type { Node } from '../types';
import type { UnresolvedRef } from './types';

/** Prefer candidates declared in the call site's file without disturbing stable order. */
export function preferCallSiteFile(nodes: Node[], callSiteFile: string): Node[] {
  if (nodes.length < 2) return nodes;
  const same: Node[] = [];
  const other: Node[] = [];
  for (const node of nodes) {
    if (node.filePath === callSiteFile) same.push(node);
    else other.push(node);
  }
  return same.length > 0 ? [...same, ...other] : nodes;
}

/** Compute directory proximity from a pre-split source directory. */
export function pathProximityFromDirs(sourceDirs: string[], candidateFilePath: string): number {
  const candidateDirs = candidateFilePath.split('/');
  candidateDirs.pop();

  let shared = 0;
  const limit = Math.min(sourceDirs.length, candidateDirs.length);
  for (let index = 0; index < limit; index++) {
    if (sourceDirs[index] !== candidateDirs[index]) break;
    shared++;
  }
  return Math.min(shared * 15, 80);
}

/** Compute directory proximity between two file paths without array allocations. */
export function computePathProximity(sourceFilePath: string, candidateFilePath: string): number {
  const minLen = Math.min(sourceFilePath.length, candidateFilePath.length);
  const sourceLastSlash = sourceFilePath.lastIndexOf('/');
  const candLastSlash = candidateFilePath.lastIndexOf('/');
  const maxScan = Math.min(minLen, sourceLastSlash, candLastSlash);
  let sharedDepth = 0;
  for (let i = 0; i <= maxScan; i++) {
    const sc = sourceFilePath.charCodeAt(i);
    const cc = candidateFilePath.charCodeAt(i);
    if (sc !== cc) break;
    if (sc === 47 /* '/' */) sharedDepth++;
  }
  return Math.min(sharedDepth * 15, 80);
}

/**
 * Select the highest-scoring candidate. Callers that need fail-closed handling
 * for an unqualified lookup can require a unique winner; compatibility paths
 * with stronger language-specific evidence retain stable first-candidate ties.
 */
export function selectBestCandidate(
  ref: UnresolvedRef,
  candidates: Node[],
  requireUniqueBest = false,
): Node | null {
  let bestScore = -1;
  let bestNode: Node | null = null;
  let bestIsAmbiguous = false;

  // A same-language candidate always out-scores a cross-language candidate:
  // same-language starts at +50 while cross-language cannot exceed +35.
  const hasSameLanguage = candidates.some((candidate) => candidate.language === ref.language);

  for (const candidate of candidates) {
    if (hasSameLanguage && candidate.language !== ref.language) continue;

    let score = candidate.filePath === ref.filePath ? 100 : 0;
    score += computePathProximity(ref.filePath, candidate.filePath);
    score += candidate.language === ref.language ? 50 : -80;

    if (
      ref.referenceKind === 'calls' &&
      (candidate.kind === 'function' || candidate.kind === 'method')
    ) {
      score += 25;
    }
    if (
      ref.referenceKind === 'instantiates' &&
      (candidate.kind === 'class' ||
        candidate.kind === 'struct' ||
        candidate.kind === 'union' ||
        candidate.kind === 'interface')
    ) {
      score += 25;
    }
    if (ref.referenceKind === 'decorates') {
      if (candidate.kind === 'function' || candidate.kind === 'method') score += 25;
      else if (candidate.kind === 'class' || candidate.kind === 'interface') score += 15;
    }
    if (candidate.isExported) score += 10;

    if (candidate.filePath === ref.filePath && candidate.startLine) {
      const distance = Math.abs(candidate.startLine - ref.line);
      score += Math.max(0, 20 - distance / 10);
    }

    if (score > bestScore) {
      bestScore = score;
      bestNode = candidate;
      bestIsAmbiguous = false;
    } else if (score === bestScore) {
      bestIsAmbiguous = true;
    }
  }

  return requireUniqueBest && bestIsAmbiguous ? null : bestNode;
}
