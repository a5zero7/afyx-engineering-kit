/**
 * AFYX Graph Native UI Entry Points Presentation Model
 *
 * Implements deterministic entry-points grouping, classification, routing presentation,
 * and command-palette candidate matching for graph exploration views.
 *
 * Design principles:
 * - Pure, DOM-independent view presentation model.
 * - Robust grouping preserving first-seen ranking order computed by the graph engine.
 * - Explicit accessibility: non-navigable rows are clearly presented without synthetic targets.
 * - Safe flow derivation: only named callable symbols can initiate graph flow exploration.
 *
 * Part of AFYX Native UI System (AFYX-5, AFYX-157, AFYX-320).
 */

import type {
  WireEntryFile,
  WireEntryHub,
  WireEntryPoints,
  WireEntryRoute,
  WireEntryTest,
  WireList,
} from './api';
import { basename, plural } from './symbol-model';

/* ------------------------------------------------------------------ Types -- */

/** Target specification when an entry row is activated or navigated. */
export type EntryTarget =
  | { type: 'symbol'; id: string; name: string; kind: string }
  | { type: 'file'; path: string }
  | null;

/** Single rendered item in an entry points panel section. */
export interface EntryRow {
  /** Deterministic identifier for stable keyed rendering across refreshes. */
  id: string;
  /** Primary label: URL route pattern, file basename, or symbol identifier. */
  name: string;
  /** HTTP method verb when applicable (routes only). */
  method: string | null;
  /** Secondary contextual metadata line (handler location, counts, dependencies). */
  meta: string;
  /** Visual category or NodeKind. */
  kind: string;
  /** Navigation destination target, or null if unresolvable. */
  target: EntryTarget;
  /** Origin symbol identifier for flow tracing, or null if non-callable/file. */
  flowFrom: string | null;
  /** Complete descriptive tooltip title. */
  title: string;
}

/** Grouped collection of rows sharing a common file or directory container. */
export interface EntryGroup {
  /** Common container path (directory or source file). */
  path: string;
  /** Source file to navigate when the group header is selected, if any. */
  file: string | null;
  /** Rows belonging to this group. */
  rows: EntryRow[];
}

/** Complete section representing an entry classification category. */
export interface EntrySection {
  id: 'routes' | 'files' | 'tests' | 'hubs';
  title: string;
  /** Right-hand descriptive count and optional framework badge. */
  meta: string;
  /** Explanatory description of section criteria. */
  note: string;
  /** Grouped row hierarchy. */
  groups: EntryGroup[];
  /** Count of rows currently displayed. */
  shown: number;
  /** Total matching items in graph index. */
  total: number;
  /** True when total represents a lower-bound estimate. */
  floor: boolean;
}

/** Aggregate presentation model for the entry points panel. */
export interface EntryPanel {
  sections: EntrySection[];
  /** Flattened list of all rows in visual draw sequence. */
  rows: EntryRow[];
  /** Empty state message when no entries match, or null when populated. */
  empty: string | null;
}

/* --------------------------------------------------------------- Grouping -- */

/**
 * Extracts directory component from a file path, defaulting to 'project root'.
 */
export function directoryOf(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash < 0 ? 'project root' : path.slice(0, lastSlash);
}

/**
 * Groups rows preserving arrival (first-seen) ranking order.
 */
export function groupRows(
  placed: ReadonlyArray<{ row: EntryRow; path: string; file: string | null }>
): EntryGroup[] {
  const groups: EntryGroup[] = [];
  const groupIndex = new Map<string, EntryGroup>();

  for (const item of placed) {
    let group = groupIndex.get(item.path);
    if (!group) {
      group = {
        path: item.path,
        file: item.file,
        rows: [],
      };
      groupIndex.set(item.path, group);
      groups.push(group);
    }
    group.rows.push(item.row);
  }

  return groups;
}

/* ------------------------------------------------------------- Row Builders - */

/**
 * Constructs an EntryRow representing an inbound route endpoint.
 */
export function routeRow(route: WireEntryRoute): EntryRow {
  const filePos = `${basename(route.file)}:${route.line}`;
  const meta = route.handlerId
    ? `${route.handler} · ${filePos}`
    : `${route.handler} · not in the index`;

  const target: EntryTarget = route.handlerId
    ? {
        type: 'symbol',
        id: route.handlerId,
        name: route.handler,
        kind: route.handlerKind,
      }
    : null;

  return {
    id: `route:${route.routeId}`,
    name: route.path,
    method: route.method,
    kind: 'route',
    meta,
    target,
    flowFrom: route.handlerId ? route.handler : null,
    title: `${route.url} → ${route.handler} (${route.file}:${route.line}), registered at ${route.routeFile}:${route.routeLine}`,
  };
}

/**
 * Constructs an EntryRow for a top-level executable module file.
 */
export function fileRow(file: WireEntryFile): EntryRow {
  const callsDesc = `${plural(file.calls, 'call')} at module level`;
  const reachesDesc = `reaches ${plural(file.reaches, 'file')}`;
  const unusedDesc = file.dependents === 0 ? ' · nothing imports it' : '';

  return {
    id: `file:${file.file}`,
    name: basename(file.file),
    method: null,
    kind: 'file',
    meta: `${callsDesc} · ${reachesDesc}${unusedDesc}`,
    target: { type: 'file', path: file.file },
    flowFrom: null,
    title: file.file,
  };
}

/**
 * Constructs an EntryRow for a test suite or verification file.
 */
export function testRow(test: WireEntryTest): EntryRow {
  return {
    id: `test:${test.file}`,
    name: basename(test.file),
    method: null,
    kind: 'file',
    meta: `exercises ${plural(test.reaches, 'file')} · ${plural(test.refs, 'reference')}`,
    target: { type: 'file', path: test.file },
    flowFrom: null,
    title: test.file,
  };
}

/**
 * Constructs an EntryRow for a high-centrality dependency hub symbol.
 */
export function hubRow(hub: WireEntryHub): EntryRow {
  return {
    id: `hub:${hub.id}`,
    name: hub.name,
    method: null,
    kind: hub.kind,
    meta: `${plural(hub.dependents, 'dependent')} · ${basename(hub.file)}:${hub.line}`,
    target: {
      type: 'symbol',
      id: hub.id,
      name: hub.name,
      kind: hub.kind,
    },
    flowFrom: hub.name,
    title: `${hub.qualifiedName} — ${hub.file}:${hub.line}`,
  };
}

/* ------------------------------------------------------------- Presentation - */

/**
 * Formats count summary, acknowledging lower bounds where applicable.
 */
function formatCountSummary(list: { shown: number; total: number }, floor: boolean): string {
  if (list.shown >= list.total) {
    return `${list.shown}`;
  }
  const prefix = floor ? 'at least ' : '';
  return `${list.shown} of ${prefix}${list.total}`;
}

/**
 * Joins framework identifiers into a natural readable list phrase.
 */
export function frameworkPhrase(frameworks: readonly string[]): string {
  const count = frameworks.length;
  if (count === 0) return '';
  if (count === 1) return frameworks[0] as string;
  if (count === 2) return `${frameworks[0]} and ${frameworks[1]}`;
  return `${frameworks.slice(0, -1).join(', ')} and ${frameworks[count - 1]}`;
}

/**
 * Assembles an EntrySection container from underlying items and groupings.
 */
function createSection(
  id: EntrySection['id'],
  title: string,
  note: string,
  list: WireList<unknown>,
  groups: EntryGroup[],
  floor: boolean,
  extraMeta = ''
): EntrySection {
  const summary = formatCountSummary(list, floor);
  return {
    id,
    title,
    meta: extraMeta ? `${summary} · ${extraMeta}` : summary,
    note,
    groups,
    shown: list.shown,
    total: list.total,
    floor,
  };
}

/**
 * Evaluates and builds the aggregate EntryPanel view model from API response.
 */
export function buildEntryPanel(entries: WireEntryPoints | null): EntryPanel {
  if (!entries) {
    return { sections: [], rows: [], empty: null };
  }

  const sections: EntrySection[] = [];

  // Route section - rendered only when the project is recognized as a routed application.
  if (entries.routes.routed && entries.routes.items.items.length > 0) {
    const allScreenRoutes = entries.routes.items.items.every((r) => !r.method);
    const routeNote = allScreenRoutes
      ? 'A screen of the app — its path, and the component that renders it.'
      : 'A request from outside arrives here — the URL, and the symbol that serves it.';

    const routeGroups = groupRows(
      entries.routes.items.items.map((route) => ({
        row: routeRow(route),
        path: route.routeFile,
        file: route.routeFile,
      }))
    );

    sections.push(
      createSection(
        'routes',
        'Routes',
        routeNote,
        entries.routes.items,
        routeGroups,
        false,
        frameworkPhrase(entries.frameworks)
      )
    );
  }

  // Top-level executable files with module-level calls.
  if (entries.files.items.length > 0) {
    const fileGroups = groupRows(
      entries.files.items.map((file) => ({
        row: fileRow(file),
        path: directoryOf(file.file),
        file: null,
      }))
    );

    sections.push(
      createSection(
        'files',
        'Top-level files with calls',
        'Statements at the top level of the file — a CLI, a worker entry, a script.',
        entries.files,
        fileGroups,
        true
      )
    );
  }

  // Test suite suites and fixtures.
  if (entries.tests.items.length > 0) {
    const testGroups = groupRows(
      entries.tests.items.map((test) => ({
        row: testRow(test),
        path: directoryOf(test.file),
        file: null,
      }))
    );

    sections.push(
      createSection(
        'tests',
        'Tests',
        'What already exercises this code, widest reach first.',
        entries.tests,
        testGroups,
        false
      )
    );
  }

  // Central dependency hubs.
  if (entries.hubs.items.length > 0) {
    const hubGroups = groupRows(
      entries.hubs.items.map((hub) => ({
        row: hubRow(hub),
        path: hub.file,
        file: hub.file,
      }))
    );

    sections.push(
      createSection(
        'hubs',
        'Most depended on',
        'Not where the project starts — where a change radiates furthest.',
        entries.hubs,
        hubGroups,
        true
      )
    );
  }

  const allRows = sections.flatMap((sec) => sec.groups.flatMap((grp) => grp.rows));
  const emptyMessage =
    sections.length === 0
      ? 'This index has no routes, no file that runs anything at module level, no test that reaches outside itself, and nothing depended on yet.'
      : null;

  return {
    sections,
    rows: allRows,
    empty: emptyMessage,
  };
}

/* --------------------------------------------------------- Palette Matching - */

/** Match candidate produced for command palette entry point queries. */
export interface EntryMatch {
  row: EntryRow;
  origin: 'route' | 'file' | 'test' | 'hub';
}

/**
 * Searches and ranks entry points matching a user search query.
 */
export function matchEntries(
  entries: WireEntryPoints | null,
  query: string,
  limit: number
): EntryMatch[] {
  const needle = query.trim().toLowerCase();
  if (!entries || needle === '') return [];

  const candidatePools: Array<[EntryMatch['origin'], EntryRow[]]> = [
    ['route', entries.routes.routed ? entries.routes.items.items.map(routeRow) : []],
    ['file', entries.files.items.map(fileRow)],
    ['test', entries.tests.items.map(testRow)],
    ['hub', entries.hubs.items.map(hubRow)],
  ];

  const results: EntryMatch[] = [];

  for (const [origin, rows] of candidatePools) {
    for (const row of rows) {
      if (results.length >= limit) {
        return results;
      }
      const searchSpace = `${row.method ?? ''} ${row.name} ${row.meta} ${row.title}`.toLowerCase();
      if (searchSpace.includes(needle)) {
        results.push({ row, origin });
      }
    }
  }

  return results;
}

/**
 * Returns human-readable origin label for palette search result attribution.
 */
export function originLabel(origin: EntryMatch['origin']): string {
  switch (origin) {
    case 'route':
      return 'route';
    case 'file':
      return 'runs at module level';
    case 'test':
      return 'test';
    case 'hub':
      return 'depended on';
  }
}

/* ----------------------------------------------------------- Flow Affordance - */

/**
 * Validates whether two symbol names form a valid distinct flow exploration pair.
 */
export function flowPair(from: string, to: string): { from: string; to: string } | null {
  const source = from.trim();
  const destination = to.trim();

  if (!source || !destination) {
    return null;
  }

  if (source.toLowerCase() === destination.toLowerCase()) {
    return null;
  }

  return { from: source, to: destination };
}
