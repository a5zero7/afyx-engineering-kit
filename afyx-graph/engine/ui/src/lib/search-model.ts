/**
 * AFYX Graph Engine - UI Search Palette Model & Keyboard Navigation
 *
 * Implements search result categorization, flow query parsing, ranked item
 * interleaving, entry point synthesis, and circular keyboard selection for the
 * interactive palette view.
 */

import type {
  WireEntryPoints,
  WireNodeRef,
  WireSearch,
  WireSearchResult,
} from './api';
import { matchEntries, originLabel, type EntryRow } from './entry-model';
import { basename, plural } from './symbol-model';

export interface FlowQuery {
  from: string;
  to: string;
}

const FLOW_QUERY_PATTERNS = [
  /^\s*(?:how\s+(?:does|do|would|can)\s+)?([\w$.]+)\s+(?:reach|reaches|call|calls|hit|hits|get\s+to|end\s+up\s+(?:in|at))\s+([\w$.]+)\s*\??\s*$/i,
  /^\s*([\w$.]+)\s*(?:->|→|=>)\s*([\w$.]+)\s*\??\s*$/,
];

function extractTerminalIdentifier(symbolPath: string): string {
  const dotIndex = symbolPath.lastIndexOf('.');
  return dotIndex < 0 ? symbolPath : symbolPath.slice(dotIndex + 1);
}

export function parseFlowQuery(query: string): FlowQuery | null {
  for (const regex of FLOW_QUERY_PATTERNS) {
    const matched = regex.exec(query);
    if (matched) {
      const startSym = extractTerminalIdentifier(matched[1] as string);
      const endSym = extractTerminalIdentifier(matched[2] as string);
      if (startSym && endSym && startSym !== endSym) {
        return { from: startSym, to: endSym };
      }
    }
  }
  return null;
}

export type PaletteItem =
  | { type: 'symbol'; id: string; node: WireNodeRef; name: string; meta: string; location: string }
  | { type: 'route'; id: string; url: string; handler: string; location: string; nodeId: string | null }
  | { type: 'flow'; id: string; from: string; to: string; name: string; meta: string; location: string }
  | { type: 'entry'; id: string; row: EntryRow; name: string; meta: string; location: string };

export interface PaletteSection {
  title: string;
  note?: string;
  items: PaletteItem[];
}

export interface Palette {
  sections: PaletteSection[];
  items: PaletteItem[];
  hint: string | null;
  empty: string | null;
}

export function kindGroupTitle(kind: string, count: number): string {
  const formattedKind = kind.replace(/_/g, ' ');
  const pluralForm = formattedKind.endsWith('s') ? `${formattedKind}es` : `${formattedKind}s`;
  const baseTitle = count === 1 ? formattedKind : pluralForm;
  return baseTitle.charAt(0).toUpperCase() + baseTitle.slice(1);
}

export function locationOf(node: WireNodeRef): string {
  if (node.kind !== 'file') {
    return `${basename(node.file)}:${node.line}`;
  }
  const lastSlash = node.file.lastIndexOf('/');
  return lastSlash < 0 ? 'project root' : node.file.slice(0, lastSlash);
}

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

function formatTruncatedSignature(node: WireNodeRef): string {
  if (!node.signature) {
    return '';
  }
  const cleanLine = node.signature.replace(/\s+/g, ' ').trim();
  return cleanLine.length > 72 ? `${cleanLine.slice(0, 71)}…` : cleanLine;
}

export function interleaveResults(
  left: readonly WireSearchResult[],
  right: readonly WireSearchResult[],
): WireSearchResult[] {
  const interleaved: WireSearchResult[] = [];
  const registeredIds = new Set<string>();
  const maxLength = Math.max(left.length, right.length);

  for (let idx = 0; idx < maxLength; idx++) {
    for (const sourceList of [left, right]) {
      const candidate = sourceList[idx];
      if (candidate && !registeredIds.has(candidate.id)) {
        registeredIds.add(candidate.id);
        interleaved.push(candidate);
      }
    }
  }

  return interleaved;
}

export function groupByKind(results: readonly WireSearchResult[]): PaletteSection[] {
  const sectionList: PaletteSection[] = [];
  const kindToSectionMap = new Map<string, PaletteSection>();

  for (const item of results) {
    let section = kindToSectionMap.get(item.kind);
    if (!section) {
      section = { title: '', items: [] };
      kindToSectionMap.set(item.kind, section);
      sectionList.push(section);
    }
    section.items.push(createSymbolItem(item));
  }

  for (const [kindKey, sectionRef] of kindToSectionMap) {
    sectionRef.title = kindGroupTitle(kindKey, sectionRef.items.length);
  }

  return sectionList;
}

export function buildSearchPalette(
  answers: readonly WireSearch[],
  flow: FlowQuery | null,
  entryOpts: { entries: WireEntryPoints | null; query: string; entryRows: number } | null = null,
): Palette {
  const aggregatedResults =
    answers.length > 1
      ? interleaveResults(answers[0]?.results.items ?? [], answers[1]?.results.items ?? [])
      : answers[0]?.results.items ?? [];

  const sections = groupByKind(aggregatedResults);

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

  if (entryOpts) {
    const presentResultIds = new Set(aggregatedResults.map((r) => r.id));
    const matchingEntries = matchEntries(entryOpts.entries, entryOpts.query, entryOpts.entryRows).filter(
      (m) => !(m.row.target?.type === 'symbol' && presentResultIds.has(m.row.target.id)),
    );

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

  const flattenedItems = sections.flatMap((section) => section.items);
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

export function buildEntryPalette(
  entries: WireEntryPoints | null,
  opts: { perSection?: number } = {},
): Palette {
  if (!entries) {
    return { sections: [], items: [], hint: null, empty: null };
  }

  const limitThreshold = opts.perSection ?? Number.POSITIVE_INFINITY;
  const truncateList = <T>(collection: readonly T[]): T[] =>
    Number.isFinite(limitThreshold) ? collection.slice(0, limitThreshold) : [...collection];

  const sections: PaletteSection[] = [];

  if (entries.routes.routed && entries.routes.items.items.length > 0) {
    sections.push({
      title: 'Routes',
      note: entries.routes.items.items.every((r) => !r.method)
        ? 'A screen of the app.'
        : 'A request from outside arrives here.',
      items: truncateList(entries.routes.items.items).map((route) => ({
        type: 'route',
        id: `route:${route.routeId}`,
        url: route.url,
        handler: route.handler,
        location: `${basename(route.file)}:${route.line}`,
        nodeId: route.handlerId,
      })),
    });
  }

  if (entries.files.items.length > 0) {
    sections.push({
      title: 'Files that run something',
      note: 'Statements at the top level of the file — a CLI, a worker entry, a script.',
      items: truncateList(entries.files.items).map((file) =>
        createSymbolItem(
          file,
          `${plural(file.calls, 'call')} at module level · reaches ${plural(file.reaches, 'file')}`,
        ),
      ),
    });
  }

  if (entries.tests.items.length > 0) {
    sections.push({
      title: 'Tests',
      note: 'What already exercises this code, widest reach first.',
      items: truncateList(entries.tests.items).map((test) =>
        createSymbolItem(test, `exercises ${plural(test.reaches, 'file')}`),
      ),
    });
  }

  if (entries.hubs.items.length > 0) {
    sections.push({
      title: 'Most depended on',
      note: 'The symbols a change radiates furthest from.',
      items: truncateList(entries.hubs.items).map((hub) =>
        createSymbolItem(hub, `${plural(hub.dependents, 'dependent')}`),
      ),
    });
  }

  const flattened = sections.flatMap((section) => section.items);

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

export function moveSelection(index: number, delta: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}
