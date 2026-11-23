/**
 * AFYX Engineering Kit - Synthesis Utilities
 *
 * Fast newline indexing and binary-search line lookup, coupled with AST node
 * enclosure detection (functions, methods, variables, components) for edge attribution.
 */

import type { Node } from '../types';

/** Callable node kinds to which call sites and invocations are attributed. */
export const FN_KINDS: ReadonlySet<string> = new Set(['method', 'function', 'component']);

/**
 * Creates an O(log N) line number resolver from character offset index.
 */
export function makeLineAt(src: string, baseLine: number): (idx: number) => number {
  let newlinePositions: number[] | null = null;

  return (idx: number): number => {
    if (!newlinePositions) {
      newlinePositions = [];
      for (let pos = src.indexOf('\n'); pos !== -1; pos = src.indexOf('\n', pos + 1)) {
        newlinePositions.push(pos);
      }
    }

    let left = 0;
    let right = newlinePositions.length;

    while (left < right) {
      const mid = (left + right) >> 1;
      if (newlinePositions[mid]! < idx) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return baseLine + left;
  };
}

/**
 * Finds the innermost function, method, or component containing the specified line.
 */
export function enclosingFn(nodesInFile: readonly Node[], line: number): Node | null {
  let innermost: Node | null = null;

  for (const node of nodesInFile) {
    if (!FN_KINDS.has(node.kind)) continue;
    const end = node.endLine ?? node.startLine;
    if (node.startLine <= line && end >= line) {
      if (!innermost || node.startLine >= innermost.startLine) {
        innermost = node;
      }
    }
  }

  return innermost;
}

/**
 * Finds the innermost constant or variable node containing the specified line.
 */
export function enclosingValue(nodesInFile: readonly Node[], line: number): Node | null {
  let innermost: Node | null = null;

  for (const node of nodesInFile) {
    if (node.kind !== 'constant' && node.kind !== 'variable') continue;
    const end = node.endLine ?? node.startLine;
    if (node.startLine <= line && end >= line) {
      if (!innermost || node.startLine >= innermost.startLine) {
        innermost = node;
      }
    }
  }

  return innermost;
}
