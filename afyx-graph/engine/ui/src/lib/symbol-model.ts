/**
 * AFYX Graph Native UI Symbol View Model & Code Windowing Projection
 *
 * Implements deterministic code windowing around outbound call sites, source line
 * reference mapping, caller/callee relation rails, member hierarchy outlines, and
 * grammatical categorization for the focal symbol inspector in the AFYX viewer.
 *
 * Architecture Highlights:
 * - Pure DOM-independent view models decoupled from rendering surfaces.
 * - Call-site driven context windowing: preserves whole bodies for concise functions (<= 260 lines),
 *   while generating focused head windows and call-site clusters for expansive implementations.
 * - Precise token reference binding: maps syntactic tokens to verified graph nodes and outside calls.
 * - Deterministic rail partitioning: separates confirmed relations from heuristic/uncertain edges.
 *
 * Part of AFYX Native UI System (AFYX-5, AFYX-157, AFYX-320).
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

/** Threshold in line count below which an entire function body is presented without cuts. */
export const FULL_BODY_LINES = 260;

/** Size of the introductory code window when body windowing is activated. */
export const HEAD_LINES = 80;

/** Padding lines included before and after each call site. */
export const WINDOW_CONTEXT = 4;

/** Maximum gap between adjacent intervals before they are coalesced. */
const WINDOW_MERGE_GAP = 2;

/** Absolute ceiling on the number of discrete code windows presented. */
const MAX_WINDOWS = 30;

/** Maximum line count for container symbols before their body is collapsed. */
export const CONTAINER_BODY_LINES = 80;

/** Kinds classified as structural containers rather than individual callable units. */
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

/** Member kinds visually dimmed as state or declarative metadata rather than logic. */
const QUIET_MEMBER_KINDS: ReadonlySet<string> = new Set([
  'property',
  'field',
  'enum_member',
  'constant',
  'variable',
]);

// =============================================================================
// Relation Formatting & Edge Semantics
// =============================================================================

/**
 * Maps a graph edge kind into a concise human-readable relation descriptor.
 */
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

/**
 * Extracts unique relation descriptors across all edges in a relation.
 */
export function relationWords(relation: WireRelation): string[] {
  const result: string[] = [];
  for (const edge of relation.edges) {
    const word = edgeWord(edge);
    if (word && !result.includes(word)) {
      result.push(word);
    }
  }
  return result;
}

/**
 * Extracts unique execution condition qualifiers, capped at 3 conditions.
 */
export function relationWhens(relation: WireRelation): string[] {
  const conditions: string[] = [];
  for (const edge of relation.edges) {
    if (edge.when && !conditions.includes(edge.when)) {
      conditions.push(edge.when);
      if (conditions.length === 3) {
        break;
      }
    }
  }
  return conditions;
}

/**
 * Returns heuristic synthesizer attribution for synthesized relations, or null if grounded.
 */
export function synthesizedBy(relation: WireRelation): string | null {
  if (!relation.synthesized) {
    return null;
  }
  const heuristicEdge = relation.edges.find((e) => e.provenance === 'heuristic');
  return heuristicEdge?.synthesizedBy ?? heuristicEdge?.via ?? 'synthesized';
}

/**
 * Extracts the file basename from a path string.
 */
export function basename(path: string): string {
  const slashPos = path.lastIndexOf('/');
  return slashPos >= 0 ? path.slice(slashPos + 1) : path;
}

/**
 * Extracts the trailing segment of a qualified name separated by dots.
 */
export function lastSegment(name: string): string {
  const dotPos = name.lastIndexOf('.');
  return dotPos < 0 ? name : name.slice(dotPos + 1);
}

// =============================================================================
// Source Code Windowing Projection
// =============================================================================

/** Continuous segment of source code lines positioned at an explicit starting line. */
export interface SourceWindow {
  start: number;
  lines: string[];
}

/** Structured presentation of a code block with windowed segments and gaps. */
export interface CodeBlock {
  windows: SourceWindow[];
  gapsAfter: number[];
  tailGap: number;
  whole: boolean;
}

/**
 * Assembles a deterministic CodeBlock projecting source lines around relevant call sites.
 */
export function buildCodeBlock(
  startLine: number,
  lines: readonly string[],
  callLines: readonly number[],
): CodeBlock {
  const lineCount = lines.length;
  const endLine = startLine + lineCount - 1;

  const sliceLines = (from: number, to: number): SourceWindow => ({
    start: from,
    lines: lines.slice(from - startLine, to - startLine + 1),
  });

  // Small bodies are rendered in their entirety
  if (lineCount <= FULL_BODY_LINES) {
    return {
      windows: lineCount > 0 ? [sliceLines(startLine, endLine)] : [],
      gapsAfter: [],
      tailGap: 0,
      whole: true,
    };
  }

  // Construct leading head window
  const headEnd = Math.min(endLine, startLine + HEAD_LINES - 1);
  const rawSpans: Array<[number, number]> = [[startLine, headEnd]];

  // Generate bounded windows around call sites beyond the head window
  const activeCallSites = Array.from(new Set(callLines))
    .filter((line) => line > headEnd && line <= endLine)
    .sort((a, b) => a - b);

  for (const callLine of activeCallSites) {
    rawSpans.push([
      Math.max(startLine, callLine - WINDOW_CONTEXT),
      Math.min(endLine, callLine + WINDOW_CONTEXT),
    ]);
  }

  // Merge overlapping or closely adjacent intervals
  const mergedSpans: Array<[number, number]> = [];
  for (const span of rawSpans) {
    const last = mergedSpans[mergedSpans.length - 1];
    if (last && span[0] <= last[1] + WINDOW_MERGE_GAP) {
      last[1] = Math.max(last[1], span[1]);
    } else {
      mergedSpans.push([span[0], span[1]]);
    }
  }

  // Enforce window limit
  const boundedSpans = mergedSpans.slice(0, MAX_WINDOWS);
  const windows = boundedSpans.map(([from, to]) => sliceLines(from, to));

  const gapsAfter = boundedSpans
    .slice(0, -1)
    .map((span, idx) => (boundedSpans[idx + 1] as [number, number])[0] - span[1] - 1);

  const lastSpanEnd = boundedSpans[boundedSpans.length - 1]?.[1] ?? endLine;

  return {
    windows,
    gapsAfter,
    tailGap: Math.max(0, endLine - lastSpanEnd),
    whole: false,
  };
}

// =============================================================================
// Source Line Reference Resolution
// =============================================================================

/** Annotated reference at a specific line in source code. */
export interface LineRef {
  ident: string;
  col: number | null;
  targetId: string | null;
  uncertain: boolean;
  outside: boolean;
  title: string;
}

/**
 * Builds a lookup map of line numbers to code references for outgoing relations.
 */
export function refsByLine(payload: WireSymbolPayload): Map<number, LineRef[]> {
  const referenceMap = new Map<number, LineRef[]>();

  const registerRef = (line: number, ref: LineRef): void => {
    const existing = referenceMap.get(line);
    if (existing) {
      existing.push(ref);
    } else {
      referenceMap.set(line, [ref]);
    }
  };

  const outboundRelations = [...payload.outgoing.items, ...payload.typesUsed];
  for (const relation of outboundRelations) {
    for (const edge of relation.edges) {
      if (!edge.line) {
        continue;
      }
      const descriptor = edgeWord(edge);
      const confDesc = edge.confidence != null ? ` · confidence ${edge.confidence}` : '';
      const resDesc = edge.resolvedBy ? ` · resolved by ${edge.resolvedBy}` : '';
      const actionTitle = `${descriptor || 'calls'} ${relation.node.qualifiedName} — ${relation.node.file}:${relation.node.line}${confDesc}${resDesc}`;

      registerRef(edge.line, {
        ident: lastSegment(relation.node.name),
        col: typeof edge.col === 'number' ? edge.col : null,
        targetId: relation.node.id,
        uncertain: relation.uncertain,
        outside: false,
        title: actionTitle,
      });
    }
  }

  // Include unresolved external package calls
  for (const unindexed of outsideRefs(payload.outsideIndex)) {
    registerRef(unindexed.line, unindexed.ref);
  }

  return referenceMap;
}

/**
 * Collects and sorts all distinct source lines with outgoing relations.
 */
export function graphCallLines(payload: WireSymbolPayload): number[] {
  const lineSet = new Set<number>();
  const activeRelations = [...payload.outgoing.items, ...payload.typesUsed];

  for (const relation of activeRelations) {
    for (const line of relation.lines) {
      lineSet.add(line);
    }
  }

  return Array.from(lineSet).sort((a, b) => a - b);
}

/**
 * Converts external index sample records into LineRef entries.
 */
function outsideRefs(outside: WireOutsideIndex): Array<{ line: number; ref: LineRef }> {
  const items: Array<{ line: number; ref: LineRef }> = [];

  for (const sample of outside.samples) {
    if (!sample.line) {
      continue;
    }
    const ident = lastSegment(sample.name ?? '');
    if (!/^[A-Za-z_$][\w$]*$/.test(ident)) {
      continue;
    }
    items.push({
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

  return items;
}

/**
 * Binds LineRef descriptors to matching syntax tokens on a rendered line.
 */
export function assignRefs(
  tokens: ReadonlyArray<{ cls: string; text: string; col: number }>,
  refs: readonly LineRef[],
): Map<number, LineRef> {
  const assigned = new Map<number, LineRef>();

  for (const ref of refs) {
    const candidateIndices: number[] = [];

    tokens.forEach((token, idx) => {
      // Disregard string literals and comments
      if (token.cls === 'comment' || token.cls === 'string') {
        return;
      }
      if (token.text === ref.ident) {
        candidateIndices.push(idx);
      }
    });

    if (candidateIndices.length === 0) {
      continue;
    }

    let matchIdx: number | undefined;

    if (ref.col !== null) {
      const targetCol = ref.col;
      // Prefer exact column span match
      matchIdx = candidateIndices.find((idx) => {
        const tok = tokens[idx] as { text: string; col: number };
        return tok.col <= targetCol && targetCol < tok.col + tok.text.length;
      });
      // Fallback to nearest following token
      if (matchIdx === undefined) {
        matchIdx = candidateIndices.find(
          (idx) => (tokens[idx] as { col: number }).col >= targetCol,
        );
      }
    }

    // Fallback to first unassigned candidate
    if (matchIdx === undefined) {
      matchIdx = candidateIndices.find((idx) => !assigned.has(idx));
    }
    // Fallback to last available candidate
    if (matchIdx === undefined) {
      matchIdx = candidateIndices[candidateIndices.length - 1];
    }

    if (matchIdx === undefined || assigned.has(matchIdx)) {
      continue;
    }

    assigned.set(matchIdx, ref);
  }

  return assigned;
}

// =============================================================================
// Callee Relation Rail
// =============================================================================

/** Presentation model for an individual outbound callee relation. */
export interface CalleeRow {
  relation: WireRelation;
  anchor: number | null;
  lines: number[];
  words: string[];
  via: string | null;
  when: string[];
}

/** Aggregate presentation model for outbound callee relations. */
export interface CalleeRailModel {
  rows: CalleeRow[];
  uncertain: CalleeRow[];
  hiddenGroups: number;
  outsideCalls: number;
  outsideTypeRefs: number;
}

/**
 * Builds the outbound callee rail, separating confirmed relations from uncertain candidates.
 */
export function buildCalleeRail(payload: WireSymbolPayload): CalleeRailModel {
  const confirmedList: CalleeRow[] = [];
  const uncertainList: CalleeRow[] = [];

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
      uncertainList.push(row);
    } else {
      confirmedList.push(row);
    }
  }

  const typeRefCount = payload.outsideIndex.byKind['references'] ?? 0;
  const outsideCallCount = Math.max(0, payload.outsideIndex.total - typeRefCount);

  return {
    rows: confirmedList,
    uncertain: uncertainList,
    hiddenGroups: payload.outgoing.total - payload.outgoing.shown,
    outsideCalls: outsideCallCount,
    outsideTypeRefs: typeRefCount,
  };
}

// =============================================================================
// Caller Relation Rail
// =============================================================================

/** Presentation model for an inbound caller relation. */
export interface CallerRow {
  relation: WireRelation;
  words: string[];
  lines: number[];
  via: string | null;
  when: string[];
}

/** Group of inbound caller relations originating from the same source file. */
export interface CallerFileGroup {
  file: string;
  same: boolean;
  rows: CallerRow[];
}

/** Aggregate presentation model for inbound caller relations. */
export interface CallerRailModel {
  groups: CallerFileGroup[];
  uncertain: CallerRow[];
  tests: { rows: CallerRow[]; calls: number; files: string[] };
  total: number;
  hiddenGroups: number;
}

/**
 * Builds the inbound caller rail, grouping by source file and isolating test callers.
 */
export function buildCallerRail(payload: WireSymbolPayload): CallerRailModel {
  const hostFile = payload.node.file;
  const fileGroups = new Map<string, CallerRow[]>();
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

    const file = relation.node.file;
    const bucket = fileGroups.get(file);
    if (bucket) {
      bucket.push(row);
    } else {
      fileGroups.set(file, [row]);
    }
  }

  // Sort groups: same-file callers precede external files, followed by alphabetical order
  const sortedGroups: CallerFileGroup[] = Array.from(fileGroups.entries())
    .map(([file, rows]) => ({ file, same: file === hostFile, rows }))
    .sort((a, b) => (a.same ? -1 : b.same ? 1 : a.file.localeCompare(b.file)));

  const testCallSum = testRows.reduce((acc, r) => acc + r.relation.edgeCount, 0);
  const testFilePaths = Array.from(new Set(testRows.map((r) => r.relation.node.file))).sort();

  return {
    groups: sortedGroups,
    uncertain: uncertainRows,
    tests: {
      rows: testRows,
      calls: testCallSum,
      files: testFilePaths,
    },
    total: payload.incoming.total,
    hiddenGroups: payload.incoming.total - payload.incoming.shown,
  };
}

// =============================================================================
// Visual Connectors & Outlines
// =============================================================================

/** Visual SVG path connector specification between code tokens and rail rows. */
export interface Connector {
  d: string;
  targetId: string;
  uncertain: boolean;
  heuristic: boolean;
  origin: boolean;
}

/** Single row item in a symbol container member outline. */
export interface OutlineRow {
  member: WireMember;
  nested: boolean;
  dimmed: boolean;
}

/**
 * Builds the member outline rows for container symbols with nesting and dimming flags.
 */
export function buildOutline(payload: WireSymbolPayload): OutlineRow[] {
  return payload.members.items.map((member) => ({
    member,
    nested: member.depth > 1,
    dimmed: QUIET_MEMBER_KINDS.has(member.kind),
  }));
}

/**
 * Determines whether the body of a symbol should be expanded by default.
 */
export function showsBody(kind: string, lines: number): boolean {
  return !(CONTAINER_KINDS.has(kind) && lines > CONTAINER_BODY_LINES);
}

/**
 * Formats symbol declaration modifiers into a human-readable title phrase.
 */
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

/**
 * Produces grammatically correct singular or plural phrasing.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
