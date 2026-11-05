/**
 * AFYX Graph Engine - UI Symbol View Model & Code Projection
 *
 * Implements code windowing around outgoing call sites, source reference resolution,
 * caller/callee rail models, member outline grouping, and grammatical pluralization
 * for the focal symbol inspector in the AFYX viewer.
 */

import type {
  WireEdge,
  WireMember,
  WireOutsideIndex,
  WireRelation,
  WireSymbolPayload,
} from './api';

// =============================================================================
// Windowing Thresholds & Configuration
// =============================================================================

export const FULL_BODY_LINES = 260;
export const HEAD_LINES = 80;
export const WINDOW_CONTEXT = 4;
const WINDOW_MERGE_GAP = 2;
const MAX_WINDOWS = 30;
export const CONTAINER_BODY_LINES = 80;

export const CONTAINER_KINDS: ReadonlySet<string> = new Set([
  'file',
  'module',
  'namespace',
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'enum',
  'union',
]);

const QUIET_MEMBER_KINDS: ReadonlySet<string> = new Set([
  'property',
  'field',
  'enum_member',
  'constant',
  'variable',
]);

// =============================================================================
// Relationship Labeling & Formatter Helpers
// =============================================================================

export function edgeWord(edge: WireEdge): string {
  switch (edge.kind) {
    case 'calls':
      return '';
    case 'instantiates':
      return 'creates';
    case 'navigates':
      return 'navigates to';
    case 'references':
      return edge.valueRef ? 'passes as value' : 'uses type';
    default:
      return edge.kind;
  }
}

export function relationWords(relation: WireRelation): string[] {
  const words: string[] = [];
  for (const edge of relation.edges) {
    const word = edgeWord(edge);
    if (word && !words.includes(word)) {
      words.push(word);
    }
  }
  return words;
}

export function relationWhens(relation: WireRelation): string[] {
  const conditions: string[] = [];
  for (const edge of relation.edges) {
    if (edge.when && !conditions.includes(edge.when)) {
      conditions.push(edge.when);
    }
    if (conditions.length === 3) {
      break;
    }
  }
  return conditions;
}

export function synthesizedBy(relation: WireRelation): string | null {
  if (!relation.synthesized) {
    return null;
  }
  const heuristicEdge = relation.edges.find((e) => e.provenance === 'heuristic');
  return heuristicEdge?.synthesizedBy ?? heuristicEdge?.via ?? 'synthesized';
}

export function basename(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/');
  return lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;
}

export function lastSegment(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex < 0 ? name : name.slice(dotIndex + 1);
}

// =============================================================================
// Source Code Windowing Synthesis
// =============================================================================

export interface SourceWindow {
  start: number;
  lines: string[];
}

export interface CodeBlock {
  windows: SourceWindow[];
  gapsAfter: number[];
  tailGap: number;
  whole: boolean;
}

export function buildCodeBlock(
  startLine: number,
  lines: readonly string[],
  callLines: readonly number[],
): CodeBlock {
  const endLine = startLine + lines.length - 1;
  const extractSlice = (from: number, to: number): SourceWindow => ({
    start: from,
    lines: lines.slice(from - startLine, to - startLine + 1),
  });

  if (lines.length <= FULL_BODY_LINES) {
    return {
      windows: lines.length > 0 ? [extractSlice(startLine, endLine)] : [],
      gapsAfter: [],
      tailGap: 0,
      whole: true,
    };
  }

  const headEnd = Math.min(endLine, startLine + HEAD_LINES - 1);
  const rawIntervals: Array<[number, number]> = [[startLine, headEnd]];

  const sortedSites = [...new Set(callLines)]
    .filter((line) => line > headEnd && line <= endLine)
    .sort((a, b) => a - b);

  for (const line of sortedSites) {
    rawIntervals.push([
      Math.max(startLine, line - WINDOW_CONTEXT),
      Math.min(endLine, line + WINDOW_CONTEXT),
    ]);
  }

  const mergedIntervals: Array<[number, number]> = [];
  for (const interval of rawIntervals) {
    const previous = mergedIntervals[mergedIntervals.length - 1];
    if (previous && interval[0] <= previous[1] + WINDOW_MERGE_GAP) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      mergedIntervals.push([...interval] as [number, number]);
    }
  }

  const boundedWindows = mergedIntervals.slice(0, MAX_WINDOWS);
  const windows = boundedWindows.map(([from, to]) => extractSlice(from, to));
  const gapsAfter = boundedWindows
    .slice(0, -1)
    .map((range, idx) => (boundedWindows[idx + 1] as [number, number])[0] - range[1] - 1);

  const finalWindowEnd = boundedWindows[boundedWindows.length - 1]?.[1] ?? endLine;

  return {
    windows,
    gapsAfter,
    tailGap: Math.max(0, endLine - finalWindowEnd),
    whole: false,
  };
}

// =============================================================================
// Source Line Reference Mapping
// =============================================================================

export interface LineRef {
  ident: string;
  col: number | null;
  targetId: string | null;
  uncertain: boolean;
  outside: boolean;
  title: string;
}

export function refsByLine(payload: WireSymbolPayload): Map<number, LineRef[]> {
  const lineReferenceMap = new Map<number, LineRef[]>();
  const appendReference = (lineNum: number, item: LineRef): void => {
    const bucket = lineReferenceMap.get(lineNum);
    if (bucket) {
      bucket.push(item);
    } else {
      lineReferenceMap.set(lineNum, [item]);
    }
  };

  const allRelations = [...payload.outgoing.items, ...payload.typesUsed];
  for (const relation of allRelations) {
    for (const edge of relation.edges) {
      if (!edge.line) {
        continue;
      }
      const word = edgeWord(edge);
      appendReference(edge.line, {
        ident: lastSegment(relation.node.name),
        col: typeof edge.col === 'number' ? edge.col : null,
        targetId: relation.node.id,
        uncertain: relation.uncertain,
        outside: false,
        title:
          `${word || 'calls'} ${relation.node.qualifiedName} — ${relation.node.file}:${relation.node.line}` +
          (edge.confidence != null ? ` · confidence ${edge.confidence}` : '') +
          (edge.resolvedBy ? ` · resolved by ${edge.resolvedBy}` : ''),
      });
    }
  }

  for (const unindexed of outsideRefs(payload.outsideIndex)) {
    appendReference(unindexed.line, unindexed.ref);
  }

  return lineReferenceMap;
}

export function graphCallLines(payload: WireSymbolPayload): number[] {
  const callLineSet = new Set<number>();
  const activeRelations = [...payload.outgoing.items, ...payload.typesUsed];

  for (const relation of activeRelations) {
    for (const line of relation.lines) {
      callLineSet.add(line);
    }
  }

  return [...callLineSet].sort((a, b) => a - b);
}

function outsideRefs(outside: WireOutsideIndex): Array<{ line: number; ref: LineRef }> {
  const results: Array<{ line: number; ref: LineRef }> = [];

  for (const sample of outside.samples) {
    if (!sample.line) {
      continue;
    }
    const ident = lastSegment(sample.name ?? '');
    if (!/^[A-Za-z_$][\w$]*$/.test(ident)) {
      continue;
    }
    results.push({
      line: sample.line,
      ref: {
        ident,
        col: typeof sample.col === 'number' ? sample.col : null,
        targetId: null,
        uncertain: false,
        outside: true,
        title: `${sample.name} is not in the index — nothing here resolves it`,
      },
    });
  }

  return results;
}

export function assignRefs(
  tokens: ReadonlyArray<{ cls: string; text: string; col: number }>,
  refs: readonly LineRef[],
): Map<number, LineRef> {
  const claimedTokenMap = new Map<number, LineRef>();

  for (const ref of refs) {
    const candidateIndices: number[] = [];
    tokens.forEach((token, index) => {
      if (token.cls === 'comment' || token.cls === 'string') {
        return;
      }
      if (token.text === ref.ident) {
        candidateIndices.push(index);
      }
    });

    if (candidateIndices.length === 0) {
      continue;
    }

    let selectedIndex: number | undefined;

    if (ref.col !== null) {
      const targetCol = ref.col;
      selectedIndex = candidateIndices.find((i) => {
        const token = tokens[i] as { text: string; col: number };
        return token.col <= targetCol && targetCol < token.col + token.text.length;
      });
      if (selectedIndex === undefined) {
        selectedIndex = candidateIndices.find(
          (i) => (tokens[i] as { col: number }).col >= targetCol,
        );
      }
    }

    if (selectedIndex === undefined) {
      selectedIndex = candidateIndices.find((i) => !claimedTokenMap.has(i));
    }
    if (selectedIndex === undefined) {
      selectedIndex = candidateIndices[candidateIndices.length - 1];
    }
    if (selectedIndex === undefined || claimedTokenMap.has(selectedIndex)) {
      continue;
    }

    claimedTokenMap.set(selectedIndex, ref);
  }

  return claimedTokenMap;
}

// =============================================================================
// Callee Rail Synthesis
// =============================================================================

export interface CalleeRow {
  relation: WireRelation;
  anchor: number | null;
  lines: number[];
  words: string[];
  via: string | null;
  when: string[];
}

export interface CalleeRailModel {
  rows: CalleeRow[];
  uncertain: CalleeRow[];
  hiddenGroups: number;
  outsideCalls: number;
  outsideTypeRefs: number;
}

export function buildCalleeRail(payload: WireSymbolPayload): CalleeRailModel {
  const confirmedRows: CalleeRow[] = [];
  const uncertainRows: CalleeRow[] = [];

  for (const relation of payload.outgoing.items) {
    const row: CalleeRow = {
      relation,
      anchor: relation.lines[0] ?? null,
      lines: relation.lines,
      words: relationWords(relation),
      via: synthesizedBy(relation),
      when: relationWhens(relation),
    };
    if (relation.uncertain) {
      uncertainRows.push(row);
    } else {
      confirmedRows.push(row);
    }
  }

  const typeRefCount = payload.outsideIndex.byKind['references'] ?? 0;

  return {
    rows: confirmedRows,
    uncertain: uncertainRows,
    hiddenGroups: payload.outgoing.total - payload.outgoing.shown,
    outsideCalls: Math.max(0, payload.outsideIndex.total - typeRefCount),
    outsideTypeRefs: typeRefCount,
  };
}

// =============================================================================
// Caller Rail Synthesis
// =============================================================================

export interface CallerRow {
  relation: WireRelation;
  words: string[];
  lines: number[];
  via: string | null;
  when: string[];
}

export interface CallerFileGroup {
  file: string;
  same: boolean;
  rows: CallerRow[];
}

export interface CallerRailModel {
  groups: CallerFileGroup[];
  uncertain: CallerRow[];
  tests: { rows: CallerRow[]; calls: number; files: string[] };
  total: number;
  hiddenGroups: number;
}

export function buildCallerRail(payload: WireSymbolPayload): CallerRailModel {
  const currentFile = payload.node.file;
  const fileGroupingMap = new Map<string, CallerRow[]>();
  const uncertainRows: CallerRow[] = [];
  const testRows: CallerRow[] = [];

  for (const relation of payload.incoming.items) {
    const row: CallerRow = {
      relation,
      words: relationWords(relation),
      lines: relation.lines,
      via: synthesizedBy(relation),
      when: relationWhens(relation),
    };

    if (relation.uncertain) {
      uncertainRows.push(row);
      continue;
    }
    if (relation.node.test) {
      testRows.push(row);
      continue;
    }

    const group = fileGroupingMap.get(relation.node.file);
    if (group) {
      group.push(row);
    } else {
      fileGroupingMap.set(relation.node.file, [row]);
    }
  }

  const groups: CallerFileGroup[] = [...fileGroupingMap.entries()]
    .map(([file, rows]) => ({ file, same: file === currentFile, rows }))
    .sort((a, b) => (a.same ? -1 : b.same ? 1 : a.file.localeCompare(b.file)));

  return {
    groups,
    uncertain: uncertainRows,
    tests: {
      rows: testRows,
      calls: testRows.reduce((sum, r) => sum + r.relation.edgeCount, 0),
      files: [...new Set(testRows.map((r) => r.relation.node.file))].sort(),
    },
    total: payload.incoming.total,
    hiddenGroups: payload.incoming.total - payload.incoming.shown,
  };
}

// =============================================================================
// Connectors & Visual Outlines
// =============================================================================

export interface Connector {
  d: string;
  targetId: string;
  uncertain: boolean;
  heuristic: boolean;
  origin: boolean;
}

export interface OutlineRow {
  member: WireMember;
  nested: boolean;
  dimmed: boolean;
}

export function buildOutline(payload: WireSymbolPayload): OutlineRow[] {
  return payload.members.items.map((member) => ({
    member,
    nested: member.depth > 1,
    dimmed: QUIET_MEMBER_KINDS.has(member.kind),
  }));
}

export function showsBody(kind: string, lines: number): boolean {
  return !(CONTAINER_KINDS.has(kind) && lines > CONTAINER_BODY_LINES);
}

export function kindPhrase(node: {
  kind: string;
  async?: boolean;
  static?: boolean;
  abstract?: boolean;
  visibility?: string;
}): string {
  const parts = [node.kind === 'type_alias' ? 'type' : node.kind.replace(/_/g, ' ')];
  if (node.async) {
    parts.push('async');
  }
  if (node.static) {
    parts.push('static');
  }
  if (node.abstract) {
    parts.push('abstract');
  }
  if (node.visibility && node.visibility !== 'public') {
    parts.push(node.visibility);
  }
  return parts.join(' · ');
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
