/**
 * `@a5zero7/afyx-graph-ui` — the Afyx Graph reader over native browser APIs.
 *
 * The same Symbol view, Flow strip and Map that `afyx-graph ui` serves, behind
 * one seam: a {@link GraphAdapter}. The CLI's viewer runs them on
 * {@link createHttpAdapter} (the read-only JSON API over loopback); a host that
 * already holds the index — Afyx Graph Pro, which opens it in-process — installs
 * its own adapter and renders the identical components over its own reads.
 * Nothing is forked, so the two can never draw different answers from the same
 * graph.
 *
 * ```ts
 * import { SymbolView, setGraphAdapter } from '@a5zero7/afyx-graph-ui';
 * setGraphAdapter(myAdapter);
 * const view = SymbolView(host, { id: symbolId, line: null });
 * // Later: view.dispose();
 * ```
 *
 * Three things a host has to know, all of them in the docs and repeated here
 * because they are the ones that bite:
 *
 * 1. **Import `theme.css` once.** Every component paints from the design
 *    tokens; without them the screens render as unstyled ink on white. Override
 *    any variable on a narrower selector.
 * 2. **The adapter is module-level, not context.** The pure model modules are
 *    plain TypeScript and cannot read a component's context, so one page reads
 *    one project. `<AfyxGraphUi>` installs it during initialisation.
 * 3. **Geometry is not themable.** 34px rail rows, 300/320px rails, the 20px
 *    code line: the Symbol view measures these against each other to put a
 *    callee row beside the line that calls it. Colour and type are yours.
 */

/* ------------------------------------------------------------ the seams -- */

export { AfyxGraphUi, mountApp } from './native/app';
export type { AfyxGraphUiOptions } from './native/app';
export type { NativeMount, Dispose } from './native/dom';

export {
  ApiFailure,
  createHttpAdapter,
  getGraphAdapter,
  setGraphAdapter,
} from './lib/adapter';
export type {
  DeadCodeRequest,
  EntryPointsRequest,
  FlowRequest,
  GraphAdapter,
  HttpAdapterOptions,
  LiveHandlers,
  MapRequest,
  RoutesRequest,
  SaveTrailRequest,
  SearchRequest,
  SourceRequest,
} from './lib/adapter';

export {
  back,
  deadHref,
  entryHref,
  fileHref,
  flowHref,
  getNavigationDriver,
  hashNavigation,
  mapHref,
  navigate,
  setNavigationDriver,
  symbolHref,
} from './lib/navigation';
export type {
  DeadCodeHrefOptions,
  FileHrefOptions,
  FlowHrefOptions,
  MapHrefOptions,
  NavigationDriver,
  SymbolHrefOptions,
} from './lib/navigation';

/** The wire vocabulary an adapter answers in. Types only — no runtime. */
export * from './lib/wire';

/* ----------------------------------------------------------- the screens -- */

/** Callers | verbatim source with gutter ports | line-anchored callee rail. */
export { SymbolView } from './native/views';
/** How one symbol reaches another, one card per hop, opened at the call line. */
export { FlowStrip } from './native/views';
/** The repository at module granularity, layered so dependencies point down. */
export { ArchitectureMap } from './native/views';
/** One file: the outline in source order between two dependency rails. */
export { FileView } from './native/views';
/** One file's whole source, with gutter ports and intra-file call arcs. */
export { FileSourceView } from './native/views';
/** Where a reader starts: routes, files that run something, tests, hubs. */
export { EntryPointsView } from './native/views';
/** Symbols nothing reaches, grouped by file, with every exclusion printed. */
export { DeadCodeView, ScreensView, StepsView } from './native/views';

/* -------------------------------------------------------- the furniture -- */

/** The path walked, with its arrows, its "read as flow" and its Save. */
export { TrailBar } from './native/components';
/** The trails somebody kept, each hop re-resolved against the current graph. */
export { SavedTrails } from './native/components';
/** The search box, its keyboard and its results panel — one component. */
export { SearchPalette } from './native/search';
/** The results panel alone, for a host that owns the input. */
export { PalettePanel } from './native/components';
/** The rows inside the panel, for a host that owns the whole shell. */
export { PaletteRows } from './native/components';
/** "This file changed on disk since it was indexed." */
export { DriftBanner } from './native/components';
/** The one-letter square that stands for a symbol's kind. */
export { KindGlyph } from './native/components';
/** Copy image / download SVG for a Flow strip or a Map layout. */
export { ExportButtons } from './native/components';
/** Ancestors up, subtypes down, and the fan an interface call dispatches into. */
export { TypeHierarchy } from './native/components';

/* ------------------------------------------------------------- the state -- */

export { trail, resolveTrailNames } from './lib/native-state';
export { encodeTrail, decodeTrail, hopLabel } from './lib/trail-codec';
export type { HopDirection, TrailHop } from './lib/trail-codec';
export { trails, live, liveRefresh, touchesFile, project, hot, railFocus, palette, toast } from './lib/native-state';
export type { LiveChanged, LiveHello, LiveIndexEvent, LiveIndexRevision, RailSide } from './lib/native-state';
export { walkTo, arrivedFrom, openEntryTarget } from './lib/walk';
export type { WalkTarget } from './lib/walk';

/* ------------------------------------------------------------ the models --
   Pure functions: no DOM, no fetch, no state. A host that wants a different
   screen over the same answers builds it out of these rather than out of the
   payloads, so its arithmetic is the arithmetic the shipped screens use. */

export { decodeLine, plainLine, tokenClass, tokensByLine } from './lib/highlight';
export type { Token, TokenClass, WireHighlight, WireToken } from './lib/highlight';

export {
  assignRefs,
  basename,
  buildCalleeRail,
  buildCallerRail,
  buildCodeBlock,
  buildOutline,
  edgeWord,
  graphCallLines,
  kindPhrase,
  lastSegment,
  refsByLine,
  relationWords,
  showsBody,
  synthesizedBy,
} from './lib/symbol-model';
export type {
  CalleeRailModel,
  CalleeRow,
  CallerFileGroup,
  CallerRailModel,
  CallerRow,
  CodeBlock,
  Connector,
  LineRef,
  OutlineRow,
  SourceWindow,
} from './lib/symbol-model';

export { buildFlowLayout, cardHeight, endCapHeight, endCapText } from './lib/flow-model';
export type {
  EndCapSite,
  EndCapText,
  FlowCardLayout,
  FlowEndCapLayout,
  FlowLayout,
  FlowLinkLayout,
} from './lib/flow-model';

export {
  buildHierarchyModel,
  connectorPath,
  visibleHierarchy,
  HIER_FOLD_AT,
  HIER_INDENT,
  HIER_PORT_X,
  HIER_ROW_H,
} from './lib/hierarchy-model';
export type {
  HierarchyConnector,
  HierarchyModel,
  HierarchyRow,
} from './lib/hierarchy-model';

export { buildMapLayout, isEdgeVisible, moduleMetaLabel } from './lib/map-model';
export type {
  MapEdgeLayout,
  MapLayerLayout,
  MapLayout,
  MapLayoutOptions,
  MapNodeLayout,
} from './lib/map-model';

export { buildFileOutline, buildFileRail, fileMetaLine, fileTitle } from './lib/file-model';
export type { FileRailModel, FileRailRow, OutlineEntryRow } from './lib/file-model';

export {
  buildFileArcs,
  buildFileCallRows,
  buildFileRefs,
  documentHeight,
  lineCentre,
  lineTop,
  pageFor,
  visibleLines,
} from './lib/filecode-model';
export type { FileArc, FileCallRow, SourcePage } from './lib/filecode-model';

export {
  deadCodeHeadline,
  deadCodeRowMeta,
  deadCodeScale,
  emptyMessage as deadCodeEmptyMessage,
  exclusionPhrases,
  groupMeta as deadCodeGroupMeta,
  DEAD_CODE_CAVEAT,
} from './lib/deadcode-model';

export {
  hopStatusWord,
  isOpenable as isTrailOpenable,
  replacedTrail,
  trailDecay,
  trailExport,
  trailMeta,
  trailNameProblem,
  trailOpens,
  trailTitle,
  MAX_NAMED_DECAYED,
} from './lib/trails-model';
export type { TrailDecay } from './lib/trails-model';

export { buildEntryPanel, flowPair, matchEntries } from './lib/entry-model';
export type {
  EntryGroup,
  EntryPanel,
  EntryRow,
  EntrySection,
  EntryTarget,
} from './lib/entry-model';

export {
  buildEntryPalette,
  buildSearchPalette,
  moveSelection,
  parseFlowQuery,
} from './lib/search-model';
export type { FlowQuery, Palette, PaletteItem, PaletteSection } from './lib/search-model';

export { exportFilename, flowSvg, mapSvg } from './lib/export-svg';
export type { ExportOptions, FlowExportOptions, MapExportOptions } from './lib/export-svg';
export { copyPngToClipboard, downloadSvg, svgToPng } from './lib/export-image';
export { kindLetter, kindWord } from './lib/kinds';
