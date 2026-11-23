/**
 * AFYX Graph Native UI File View Presentation Model
 *
 * Implements deterministic dependency rail construction, test file identification,
 * hierarchical symbol outline formatting, and file metadata presentation.
 *
 * Architecture highlights:
 * - Pure, browser-independent view models decoupled from DOM components.
 * - Source of truth: dependency rails prioritize semantic graph edges (calls,
 *   type references, instantiations) while enriching rows with resolved import symbols.
 * - Out-of-tree and external package imports are isolated and sorted deterministically.
 * - Depth-bounded outline rendering with visual dimming for passive data members.
 *
 * Part of AFYX Native UI System (AFYX-5, AFYX-157, AFYX-320).
 */

import type { WireFilePayload, WireImportRow, WireOutlineEntry } from './api';
import { basename } from './symbol-model';

export { basename } from './symbol-model';

/** Symbol categories dimmed in outline views (state/data rather than behaviour). */
const PASSIVE_SYMBOL_KINDS = new Set([
  'property',
  'field',
  'enum_member',
  'variable',
  'constant',
]);

/** Threshold beyond which outline items are virtualized for performance. */
export const OUTLINE_VIRTUAL_THRESHOLD = 250;

/** Pixel row height constraint for virtual outline list layout. */
export const OUTLINE_ROW_HEIGHT = 28;

/* ----------------------------------------------------------- Rail Models ---- */

/** Symbol reference displayed within an import rail row. */
export interface RailSymbol {
  id: string;
  name: string;
  kind: string;
  line: number;
}

/** Single row entry in an inbound or outbound file dependency rail. */
export interface FileRailRow {
  /** Target or source file path. */
  path: string;
  /** True if classified as test, spec, mock, or fixture code. */
  test: boolean;
  /** True if an explicit import statement references this file. */
  imported: boolean;
  /** Resolved named symbols associated with import statements. */
  symbols: RailSymbol[];
  /** Count of resolved named symbols (excluding file nodes). */
  symbolCount: number;
}

/** External or unresolved package dependency row. */
export interface OutsideRow {
  name: string;
  /** Sorted line numbers where this external package is imported. */
  lines: number[];
}

/** Aggregate presentation model for a file dependency rail. */
export interface FileRailModel {
  rows: FileRailRow[];
  total: number;
  testCount: number;
  outside: OutsideRow[];
}

/**
 * Filters out synthetic file-level nodes, retaining only named code symbols.
 */
function extractNamedSymbols(row: WireImportRow | undefined): RailSymbol[] {
  if (!row) return [];
  return row.symbols.filter((sym) => sym.kind !== 'file');
}

/**
 * Builds a deterministic FileRailModel combining graph edge paths and import metadata.
 *
 * Rows are partitioned into production files followed by test files, each sorted
 * lexicographically. External or unresolved packages are aggregated separately.
 */
export function buildFileRail(
  paths: readonly string[],
  importRows: readonly WireImportRow[],
  unresolved: ReadonlyArray<{ name: string; line: number }> = []
): FileRailModel {
  const importDetailMap = new Map<string, WireImportRow>();
  for (const row of importRows) {
    importDetailMap.set(row.file, row);
  }

  // Deduplicate input paths preserving consistent set evaluation
  const uniquePaths = Array.from(new Set(paths));

  const railRows: FileRailRow[] = uniquePaths.map((filePath) => {
    const importDetail = importDetailMap.get(filePath);
    const symbols = extractNamedSymbols(importDetail);

    const isTest = importDetail?.test ?? looksLikeTest(filePath);
    const isImported = importDetail !== undefined;

    return {
      path: filePath,
      test: isTest,
      imported: isImported,
      symbols,
      symbolCount: symbols.length,
    };
  });

  // Sort: production files first (test=false -> 0), then tests (test=true -> 1),
  // tie-broken by case-sensitive locale comparison.
  railRows.sort((a, b) => {
    const testDelta = Number(a.test) - Number(b.test);
    if (testDelta !== 0) return testDelta;
    return a.path.localeCompare(b.path);
  });

  // Aggregate external/unresolved import occurrences by module name
  const externalMap = new Map<string, number[]>();
  for (const item of unresolved) {
    let lineList = externalMap.get(item.name);
    if (!lineList) {
      lineList = [];
      externalMap.set(item.name, lineList);
    }
    lineList.push(item.line);
  }

  const outsideRows: OutsideRow[] = Array.from(externalMap.entries())
    .map(([pkgName, lineNums]) => ({
      name: pkgName,
      lines: lineNums.slice().sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const testFileCount = railRows.filter((r) => r.test).length;

  return {
    rows: railRows,
    total: railRows.length,
    testCount: testFileCount,
    outside: outsideRows,
  };
}

/**
 * Heuristically identifies test, spec, mock, or fixture files from path strings.
 * Errs cautiously toward false negatives to prevent misfiling production code.
 */
export function looksLikeTest(path: string): boolean {
  const directoryPattern = /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|spec|fixtures)(\/|$)/;
  const fileSuffixPattern = /\.(test|spec)\.[a-z0-9]+$/i;

  return directoryPattern.test(path) || fileSuffixPattern.test(path);
}

/* -------------------------------------------------------- Outline Models ---- */

/** Formatted outline item row with clamped indentation and dimming style. */
export interface OutlineEntryRow {
  entry: WireOutlineEntry;
  indent: number;
  dimmed: boolean;
}

/**
 * Transforms server outline items into UI presentation rows with indentation limits.
 */
export function buildFileOutline(payload: WireFilePayload): OutlineEntryRow[] {
  return payload.outline.items.map((entry) => ({
    entry,
    indent: Math.min(entry.depth, 3),
    dimmed: PASSIVE_SYMBOL_KINDS.has(entry.kind),
  }));
}

/* ------------------------------------------------------- Metadata Format ---- */

/**
 * Formats byte values into human-readable compact notation (B, KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Generates summary subtitle for file views:
 * e.g. "typescript · 24.2 KB · 23 symbols · generated · test"
 */
export function fileMetaLine(payload: WireFilePayload): string {
  const segments: string[] = [
    payload.file.language,
    formatBytes(payload.file.size),
  ];

  const symbolTotal = payload.outline.total;
  const symbolWord = symbolTotal === 1 ? 'symbol' : 'symbols';
  segments.push(`${symbolTotal} ${symbolWord}`);

  if (payload.file.generated) {
    segments.push('generated');
  }

  if (payload.file.test) {
    segments.push('test');
  }

  return segments.join(' · ');
}

/**
 * Returns canonical display title for a source file.
 */
export function fileTitle(path: string): string {
  return basename(path);
}
