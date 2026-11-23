/**
 * AFYX Graph Native UI Search Palette Presentation Model & Navigation
 *
 * Implements search result categorisation, flow query intent parsing, ranked result
 * interleaving, entry-point candidate integration, and circular keyboard selection
 * for the interactive command palette in the AFYX viewer.
 *
 * Architecture Highlights:
 * - Pure DOM-independent view models decoupled from component rendering.
 * - Natural flow intent extraction: translates relational syntax ("A -> B", "how does A reach B")
 *   into structured flow exploration queries.
 * - Deterministic kind grouping: clusters symbol search results by semantic node kind
 *   preserving arrival ranking order.
 * - Flat item projection: guarantees palette items array matches visual section draw order
 *   for 1:1 parity with keyboard navigation.
 *
 * Part of AFYX Native UI System (AFYX-5, AFYX-157, AFYX-320).
 */

import type {
  WireEntryPoints,
  WireNodeRef,
  WireSearch,
  WireSearchResult,
} from './api';
import { matchEntries, originLabel, type EntryRow } from './entry-model';
import { basename, plural } from './symbol-model';

// =============================================================================
// Flow Query Intent Parsing
// =============================================================================

/** Parsed relational flow intent between two distinct symbols. */
export interface FlowQuery {
  from: string;
  to: string;
}

/** Regular expression patterns recognizing natural language or symbolic flow queries. */
const FLOW_INTENT_PATTERNS = [
  /^\s*(?:how\s+(?:does|do|would|can)\s+)?([\w$.]+)\s+(?:reach|reaches|call|calls|hit|hits|get\s+to|end\s+up\s+(?:in|at))\s+([\w$.]+)\s*\??\s*$/i,
  /^\s*([\w$.]+)\s*(?:->|→|=>)\s*([\w$.]+)\s*\??\s*$/,
];

/**
 * Extracts the terminal identifier from a qualified path string.
 */
function extractTerminalName(qualifiedPath: string): string {
  const dotIndex = qualifiedPath.lastIndexOf('.');
  return dotIndex < 0 ? qualifiedPath : qualifiedPath.slice(dotIndex + 1);
}

/**
 * Parses user input query to determine if it expresses a flow trajectory request.
 */
export function parseFlowQuery(query: string): FlowQuery | null {
  for (const pattern of FLOW_INTENT_PATTERNS) {
    const match = pattern.exec(query);
    if (match) {
      const sourceSymbol = extractTerminalName(match[1] as string);
      const targetSymbol = extractTerminalName(match[2] as string);

      if (sourceSymbol && targetSymbol && sourceSymbol !== targetSymbol) {
        return { from: sourceSymbol, to: targetSymbol };
      }
    }
  }
  return null;
}

// =============================================================================
// Palette Item & Section Types
// =============================================================================

/** Unified item representation across symbol, route, flow, and entry categories. */
export type PaletteItem =
  | { type: 'symbol'; id: string; node: WireNodeRef; name: string; meta: string; location: string }
  | { type: 'route'; id: string; url: string; handler: string; location: string; nodeId: string | null }
  | { type: 'flow'; id: string; from: string; to: string; name: string; meta: string; location: string }
  | { type: 'entry'; id: string; row: EntryRow; name: string; meta: string; location: string };

/** Grouped section of items displayed under a category header. */
export interface PaletteSection {
  title: string;
  note?: string;
  items: PaletteItem[];
}

/** Aggregate presentation model for the command palette. */
export interface Palette {
  sections: PaletteSection[];
  items: PaletteItem[];
  hint: string | null;
  empty: string | null;
}

// =============================================================================
// Header Formatting & Location Helpers
// =============================================================================

/**
 * Formats a pluralized section title for a given node kind.
 */
export function kindGroupTitle(kind: string, count: number): string {
  const cleanKind = kind.replace(/_/g, ' ');
  const pluralSuffix = cleanKind.endsWith('s') ? `${cleanKind}es` : `${cleanKind}s`;
  const baseLabel = count === 1 ? cleanKind : pluralSuffix;
  return baseLabel.charAt(0).toUpperCase() + baseLabel.slice(1);
}

/**
 * Derives the location badge for a graph node reference.
 */
export function locationOf(node: WireNodeRef): string {
  if (node.kind !== 'file') {
    return `${basename(node.file)}:${node.line}`;
  }
  const slashPos = node.file.lastIndexOf('/');
  return slashPos < 0 ? 'project root' : node.file.slice(0, slashPos);
}

/**
 * Creates a standard PaletteItem for a symbol node.
 */
function createSymbolItem(node: WireNodeRef, customMeta = ''): PaletteItem {
  return {
    type: 'symbol',
    id: node.id,
    node,
    name: node.kind === 'file' ? basename(node.file) : node.name,
    meta: customMeta || formatTruncatedSignature(node),
    location: locationOf(node),
  };
}

/**
 * Formats a single-line truncated signature string for symbol previews.
 */
function formatTruncatedSignature(node: WireNodeRef): string {
  if (!node.signature) {
    return '';
  }
  const collapsed = node.signature.replace(/\s+/g, ' ').trim();
  return collapsed.length > 72 ? `${collapsed.slice(0, 71)}…` : collapsed;
}

// =============================================================================
// Search Results Organization
// =============================================================================

/**
 * Interleaves two ranked search result lists preserving alternating priority.
 */
export function interleaveResults(
  left: readonly WireSearchResult[],
  right: readonly WireSearchResult[],
): WireSearchResult[] {
  const combined: WireSearchResult[] = [];
  const seenIds = new Set<string>();
  const maxBound = Math.max(left.length, right.length);

  for (let idx = 0; idx < maxBound; idx++) {
    for (const source of [left, right]) {
      const item = source[idx];
      if (item && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        combined.push(item);
      }
    }
  }

  return combined;
}

/**
 * Groups search results by node kind preserving initial arrival order.
 */
export function groupByKind(results: readonly WireSearchResult[]): PaletteSection[] {
  const sectionList: PaletteSection[] = [];
  const sectionIndex = new Map<string, PaletteSection>();

  for (const item of results) {
    let section = sectionIndex.get(item.kind);
    if (!section) {
      section = { title: '', items: [] };
      sectionIndex.set(item.kind, section);
      sectionList.push(section);
    }
    section.items.push(createSymbolItem(item));
  }

  for (const [kindKey, secRef] of sectionIndex) {
    secRef.title = kindGroupTitle(kindKey, secRef.items.length);
  }

  return sectionList;
}

// =============================================================================
// Palette Builders
// =============================================================================

/**
 * Assembles the full interactive search palette view model.
 */
export function buildSearchPalette(
  answers: readonly WireSearch[],
  flow: FlowQuery | null,
  entryOpts: { entries: WireEntryPoints | null; query: string; entryRows: number } | null = null,
): Palette {
  const mergedResults =
    answers.length > 1
      ? interleaveResults(answers[0]?.results.items ?? [], answers[1]?.results.items ?? [])
      : answers[0]?.results.items ?? [];

  const sections = groupByKind(mergedResults);

  // Prepend flow trajectory prompt when flow intent was detected
  if (flow) {
    sections.unshift({
      title: 'Flow',
      note: 'The call path between them, one card per hop.',
      items: [
        {
          type: 'flow',
          id: `flow:${flow.from}:${flow.to}`,
          from: flow.from,
          to: flow.to,
          name: `${flow.from} → ${flow.to}`,
          meta: '',
          location: 'read as a flow',
        },
      ],
    });
  }

  // Append entry-point suggestions if requested and distinct from direct search hits
  if (entryOpts) {
    const existingResultIds = new Set(mergedResults.map((r) => r.id));
    const matchingEntries = matchEntries(
      entryOpts.entries,
      entryOpts.query,
      entryOpts.entryRows,
    ).filter((m) => !(m.row.target?.type === 'symbol' && existingResultIds.has(m.row.target.id)));

    if (matchingEntries.length > 0) {
      sections.push({
        title: 'Entry points',
        note: 'Where a flow starts — routes, files that run something, tests.',
        items: matchingEntries.map(({ row, origin }) => ({
          type: 'entry',
          id: `entry:${row.id}`,
          row,
          name: row.method ? `${row.method} ${row.name}` : row.name,
          meta: row.meta,
          location: originLabel(origin),
        })),
      });
    }
  }

  const flattenedItems = sections.flatMap((sec) => sec.items);
  const narrativeHint = flow
    ? `Reading the path from ${flow.from} to ${flow.to}. Below it, what each name matches.`
    : null;

  return {
    sections,
    items: flattenedItems,
    hint: narrativeHint,
    empty: flattenedItems.length === 0 ? 'No symbol or file in the index matches that.' : null,
  };
}

/**
 * Assembles an initial entry-points palette when the search box is focused without a query.
 */
export function buildEntryPalette(
  entries: WireEntryPoints | null,
  opts: { perSection?: number } = {},
): Palette {
  if (!entries) {
    return { sections: [], items: [], hint: null, empty: null };
  }

  const limitThreshold = opts.perSection ?? Number.POSITIVE_INFINITY;
  const truncate = <T>(list: readonly T[]): T[] =>
    Number.isFinite(limitThreshold) ? list.slice(0, limitThreshold) : Array.from(list);

  const sections: PaletteSection[] = [];

  // Routes section
  if (entries.routes.routed && entries.routes.items.items.length > 0) {
    sections.push({
      title: 'Routes',
      note: entries.routes.items.items.every((r) => !r.method)
        ? 'A screen of the app.'
        : 'A request from outside arrives here.',
      items: truncate(entries.routes.items.items).map((route) => ({
        type: 'route',
        id: `route:${route.routeId}`,
        url: route.url,
        handler: route.handler,
        location: `${basename(route.file)}:${route.line}`,
        nodeId: route.handlerId,
      })),
    });
  }

  // Executable files with top-level calls
  if (entries.files.items.length > 0) {
    sections.push({
      title: 'Files that run something',
      note: 'Statements at the top level of the file — a CLI, a worker entry, a script.',
      items: truncate(entries.files.items).map((file) =>
        createSymbolItem(
          file,
          `${plural(file.calls, 'call')} at module level · reaches ${plural(file.reaches, 'file')}`,
        ),
      ),
    });
  }

  // Tests
  if (entries.tests.items.length > 0) {
    sections.push({
      title: 'Tests',
      note: 'What already exercises this code, widest reach first.',
      items: truncate(entries.tests.items).map((test) =>
        createSymbolItem(test, `exercises ${plural(test.reaches, 'file')}`),
      ),
    });
  }

  // Central dependency hubs
  if (entries.hubs.items.length > 0) {
    sections.push({
      title: 'Most depended on',
      note: 'The symbols a change radiates furthest from.',
      items: truncate(entries.hubs.items).map((hub) =>
        createSymbolItem(hub, `${plural(hub.dependents, 'dependent')}`),
      ),
    });
  }

  const flattened = sections.flatMap((sec) => sec.items);

  return {
    sections,
    items: flattened,
    hint: null,
    empty:
      sections.length === 0
        ? 'This index has no routes, no file that runs anything, no test that reaches outside itself, and nothing depended on yet.'
        : null,
  };
}

// =============================================================================
// Keyboard Navigation
// =============================================================================

/**
 * Calculates deterministic circular index navigation for palette keyboard selection.
 */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}
