import { getGraphAdapter } from '../lib/adapter';
import { deadCodeHeadline, deadCodeRowMeta, emptyMessage as deadCodeEmptyMessage } from '../lib/deadcode-model';
import { buildEntryPanel, type EntryRow } from '../lib/entry-model';
import { buildFileOutline, buildFileRail, fileMetaLine } from '../lib/file-model';
import { buildFlowLayout } from '../lib/flow-model';
import { buildMapLayout } from '../lib/map-model';
import { fileHref, navigate, symbolHref } from '../lib/navigation';
import { buildScreensModel } from '../lib/screens-model';
import { buildStepsModel } from '../lib/steps-model';
import { basename, buildCalleeRail, buildCallerRail, buildCodeBlock, kindPhrase } from '../lib/symbol-model';
import { decodeTrail } from '../lib/trail-codec';
import type {
  WireEntryPoints,
  WireFileCodePayload,
  WireFilePayload,
  WireFlowPayload,
  WireMapPayload,
  WireNodeRef,
  WireScreensPayload,
  WireSource,
  WireStepsPayload,
  WireStats,
} from '../lib/wire';
import { empty, element, failure, loading, mount, replace, svgElement, type Dispose, type NativeMount } from './dom';
import { renderMapGraph } from './graph';
import { arrowMarker, createViewport, viewportControls } from './viewport';

export interface SymbolViewProps { id: string; line: number | null }
export interface FlowViewProps { from: string | null; to: string | null; symbols: string | null; trailParam: string | null }
export interface MapViewProps { root: string | null; depth: number | null; tests: boolean }
export interface FileViewProps { path: string; line: number | null }
export interface EntryViewProps { project?: string | null }
export interface DeadCodeViewProps { kind?: string[]; exported?: boolean; tests?: boolean; generated?: boolean }
export interface StepsViewProps { anchor: string | null; symbol: string | null; depth: number | null; through: boolean }

function asyncMount<T>(
  target: HTMLElement,
  className: string,
  read: (signal: AbortSignal) => Promise<T>,
  draw: (value: T, root: HTMLElement, disposers: Dispose[]) => void
): NativeMount {
  const root = element('section', { className });
  const controller = new AbortController();
  const disposers: Dispose[] = [() => controller.abort()];
  replace(root, loading());
  void read(controller.signal).then((value) => {
    if (controller.signal.aborted) return;
    replace(root);
    draw(value, root, disposers);
  }).catch((cause: unknown) => {
    if (!controller.signal.aborted) replace(root, failure(cause));
  });
  return mount(target, root, disposers);
}

function kindGlyph(kind: string): HTMLElement {
  return element('span', { className: `kind-glyph kind-${kind}`, title: kind, 'aria-hidden': true }, (kind[0] ?? '?').toUpperCase());
}

function nodeLink(node: WireNodeRef, detail?: string): HTMLAnchorElement {
  return element(
    'a',
    { className: 'native-row', href: node.kind === 'file' ? fileHref(node.file) : symbolHref(node.id) },
    kindGlyph(node.kind),
    element('span', { className: 'native-row-name' }, node.kind === 'file' ? basename(node.file) : node.name),
    element('span', { className: 'native-row-meta' }, detail ?? `${node.file}:${node.line}`)
  );
}

function panel(title: string, rows: Node[], note?: string): HTMLElement {
  return element(
    'section',
    { className: 'native-panel' },
    element('header', { className: 'native-panel-header' }, element('h2', {}, title), note ? element('span', {}, note) : null),
    rows.length > 0 ? element('div', { className: 'native-list' }, ...rows) : empty(`No ${title.toLowerCase()}`)
  );
}

function sourceBlock(source: WireSource): HTMLElement {
  if (!source.lines) return empty('Source unavailable', source.drift ? 'This file changed after it was indexed.' : undefined);
  const code = element('code', { className: 'native-code' });
  source.lines.forEach((line, index) => code.append(element(
    'span',
    { className: 'native-code-line', 'data-line': (source.from ?? 1) + index },
    element('span', { className: 'native-line-number' }, String((source.from ?? 1) + index)),
    element('span', { className: 'native-line-text' }, line)
  )));
  return element('pre', { className: 'native-source' }, code);
}

export function SymbolView(target: HTMLElement, props: SymbolViewProps): NativeMount {
  return asyncMount(target, 'native-view symbol-view', async (signal) => {
    const payload = await getGraphAdapter().node(props.id, signal);
    let source: WireSource | null = null;
    try {
      source = await getGraphAdapter().source({
        file: payload.node.file,
        from: payload.drift ? 1 : payload.node.line,
        to: payload.drift ? undefined : payload.node.endLine,
      }, signal);
    } catch {
      // Node facts remain useful when source is unavailable.
    }
    return { payload, source };
  }, ({ payload, source }, root) => {
    const callers = buildCallerRail(payload);
    const callees = buildCalleeRail(payload);
    if (source?.lines) buildCodeBlock(source.from ?? payload.node.line, source.lines, callees.rows.flatMap((row) => row.lines));
    root.append(
      element('header', { className: 'native-view-header' },
        kindGlyph(payload.node.kind),
        element('div', {}, element('h1', {}, payload.node.name), element('p', { className: 'native-meta' }, `${kindPhrase(payload.node)} · ${payload.node.file}:${payload.node.line} · ${payload.tests.reached ? 'test reached' : 'no test path found'}`)),
        payload.drift ? element('strong', { className: 'drift' }, 'File changed since indexing') : null
      ),
      element('div', { className: 'symbol-grid' },
        panel('Callers', callers.groups.flatMap((group) => group.rows).map((row) => nodeLink(row.relation.node, `${row.relation.edgeCount} reference${row.relation.edgeCount === 1 ? '' : 's'}`)), `${payload.incoming.shown}/${payload.incoming.total}`),
        element('section', { className: 'native-panel source-panel' }, source ? sourceBlock(source) : empty('Source unavailable')),
        panel('Callees', callees.rows.map((row) => nodeLink(row.relation.node, `${row.relation.edgeCount} reference${row.relation.edgeCount === 1 ? '' : 's'}`)), `${payload.outgoing.shown}/${payload.outgoing.total}`)
      ),
      ...(payload.members.items.length > 0 ? [panel('Members', payload.members.items.map((member) => nodeLink(member)))] : [])
    );
  });
}

function flowGraph(payload: WireFlowPayload): { node: HTMLElement; dispose: Dispose } {
  const flows = payload.flows;
  if (flows.length === 0) return { node: empty('No flow found', 'Try a different source or destination.'), dispose: () => {} };
  const layout = buildFlowLayout([flows[0]!], flows[0]!.id);
  const host = element('section', { className: 'native-graph flow-graph', tabindex: 0 });
  const svg = svgElement('svg', { className: 'native-graph-svg', role: 'img', 'aria-label': 'Call flow' });
  const content = svgElement('g', { className: 'native-graph-content' });
  svg.append(arrowMarker(), content);
  const byId = new Map(layout.cards.map((card) => [card.id, card]));
  for (const link of layout.links) {
    const from = byId.get(link.source);
    const to = byId.get(link.target);
    if (!from || !to) continue;
    const y1 = from.y + from.height / 2;
    const y2 = to.y + to.height / 2;
    content.append(svgElement('path', {
      d: `M ${from.x + from.width} ${y1} C ${from.x + from.width + 48} ${y1}, ${to.x - 48} ${y2}, ${to.x} ${y2}`,
      className: 'native-edge',
      'data-edge': link.id,
      'stroke-dasharray': link.dash,
      'marker-end': 'url(#afyx-arrow)',
      fill: 'none',
    }));
  }
  for (const card of layout.cards) {
    const group = svgElement('g', { className: 'native-node flow-card', transform: `translate(${card.x} ${card.y})`, 'data-node': card.id });
    group.append(
      svgElement('rect', { width: card.width, height: card.height }),
      svgElement('text', { x: 12, y: 20, className: 'native-node-title' }, card.hop.node.name),
      svgElement('text', { x: 12, y: 38, className: 'native-node-subtitle' }, `${basename(card.hop.node.file)}:${card.hop.node.line}`)
    );
    if (card.hop.source?.lines) {
      card.hop.source.lines.slice(0, 6).forEach((line, index) => group.append(svgElement('text', {
        x: 12,
        y: 60 + index * 16,
        className: 'native-flow-code',
      }, line.slice(0, 64))));
    }
    group.addEventListener('click', () => navigate(symbolHref(card.hop.node.id)));
    content.append(group);
  }
  host.append(svg);
  const viewport = createViewport(host, content, { width: layout.width, height: layout.height }, { minScale: 0.35, maxScale: 2.5 });
  host.append(viewportControls(viewport));
  return { node: host, dispose: viewport.dispose };
}

export function FlowStrip(target: HTMLElement, props: FlowViewProps): NativeMount {
  return asyncMount(target, 'native-view flow-view', (signal) => getGraphAdapter().flow({
    from: props.from ?? undefined,
    to: props.to ?? undefined,
    symbols: props.symbols ?? undefined,
    trail: props.trailParam ? decodeTrail(props.trailParam).map((hop) => `${hop.dir[0]}${hop.id}`) : undefined,
  }, signal), (payload, root, disposers) => {
    root.append(element('header', { className: 'native-view-header' }, element('h1', {}, 'Flow'), element('span', { className: 'native-meta' }, `${payload.flows.length} path${payload.flows.length === 1 ? '' : 's'}`)));
    const graph = flowGraph(payload);
    disposers.push(graph.dispose);
    root.append(graph.node);
  });
}

function drawMapPayload(root: HTMLElement, payload: WireMapPayload, tests: boolean, disposers: Dispose[]): void {
  const layout = buildMapLayout(payload, { includeTests: tests });
  if (layout.nodes.length === 0) {
    root.append(empty('No modules to draw'));
    return;
  }
  const graph = renderMapGraph(layout, undefined, (id) => {
    const node = layout.nodes.find((item) => item.id === id);
    const file = node?.module.fileList.items[0];
    if (file) navigate(fileHref(file));
  });
  disposers.push(graph.dispose);
  root.append(graph.element);
}

export function ArchitectureMap(target: HTMLElement, props: MapViewProps): NativeMount {
  return asyncMount(target, 'native-view map-view', (signal) => getGraphAdapter().map({
    root: props.root ?? undefined,
    depth: props.depth ?? undefined,
  }, signal), (payload, root, disposers) => {
    root.append(element('header', { className: 'native-view-header' }, element('h1', {}, 'Architecture map'), element('span', { className: 'native-meta' }, `${payload.modules.length} modules · ${payload.links.length} links`)));
    drawMapPayload(root, payload, props.tests, disposers);
  });
}

export function ScreensView(target: HTMLElement): NativeMount {
  return asyncMount(target, 'native-view screens-view', (signal) => getGraphAdapter().screens(signal), (payload: WireScreensPayload, root, disposers) => {
    root.append(element('header', { className: 'native-view-header' }, element('h1', {}, 'Screens'), element('span', { className: 'native-meta' }, `${payload.screens.length} screens · ${payload.links.length} transitions`)));
    const model = buildScreensModel(payload);
    if (model.layout.nodes.length === 0) { root.append(empty('No screens found')); return; }
    const graph = renderMapGraph(model.layout, {
      node(id) {
        const info = model.nodes.get(id);
        return { title: info?.label ?? id, subtitle: info?.sub ?? '' };
      },
      edge(id) { return model.edges.get(id)?.label ?? ''; },
    }, (id) => {
      const info = model.nodes.get(id);
      if (info?.screen?.component) navigate(symbolHref(info.screen.component.id));
    });
    disposers.push(graph.dispose);
    root.append(graph.element);
  });
}

export function StepsView(target: HTMLElement, props: StepsViewProps): NativeMount {
  const steps = getGraphAdapter().steps;
  if (!steps) return mount(target, empty('Steps are unavailable', 'This host does not provide the optional steps adapter.'));
  return asyncMount(target, 'native-view steps-view', (signal) => steps({
    anchor: props.anchor ?? undefined,
    symbol: props.symbol ?? undefined,
    depth: props.depth ?? undefined,
    through: props.through,
  }, signal), (payload: WireStepsPayload, root, disposers) => {
    root.append(element('header', { className: 'native-view-header' }, element('h1', {}, `Steps from ${payload.anchor.name}`), element('span', { className: 'native-meta' }, `${payload.steps.length} steps · ${payload.links.length} links`)));
    const model = buildStepsModel(payload);
    if (model.layout.nodes.length === 0) { root.append(empty('No steps found')); return; }
    const graph = renderMapGraph(model.layout, {
      node(id) { const info = model.nodes.get(id); return { title: info?.label ?? id, subtitle: info?.sub ?? '' }; },
      edge(id) { return model.edges.get(id)?.label ?? ''; },
    }, (id) => {
      const node = model.nodes.get(id)?.step.node;
      if (node) navigate(symbolHref(node.id));
    });
    disposers.push(graph.dispose);
    root.append(graph.element);
  });
}

function fileHeader(payload: WireFilePayload | WireFileCodePayload, source: boolean): HTMLElement {
  return element('header', { className: 'native-view-header' },
    kindGlyph('file'),
    element('div', {}, element('h1', {}, basename(payload.file.path)), element('p', { className: 'native-meta' }, `${payload.file.language} · ${payload.file.path}`)),
    element('nav', { className: 'mode-tabs', 'aria-label': 'File view mode' },
      element('a', { href: fileHref(payload.file.path), className: source ? '' : 'active' }, 'Outline'),
      element('a', { href: fileHref(payload.file.path, { source: true }), className: source ? 'active' : '' }, 'Source')
    )
  );
}

export function FileView(target: HTMLElement, props: FileViewProps): NativeMount {
  return asyncMount(target, 'native-view file-view', (signal) => getGraphAdapter().file(props.path, signal), (payload, root) => {
    const outline = buildFileOutline(payload);
    const importedBy = buildFileRail(payload.dependents, payload.importedBy.items);
    const imports = buildFileRail(payload.dependencies, payload.imports.items, payload.unresolvedImports);
    root.append(
      fileHeader(payload, false),
      ...(payload.drift ? [element('div', { className: 'drift' }, 'This file changed after it was indexed.')] : []),
      element('p', { className: 'native-summary' }, fileMetaLine(payload)),
      element('div', { className: 'file-grid' },
        panel('Imported by', importedBy.rows.map((row) => element('a', { className: 'native-row', href: fileHref(row.path) }, row.path))),
        panel('Outline', outline.map((row) => nodeLink(row.entry, `${row.entry.kind} · ${row.entry.line}`))),
        panel('Imports', imports.rows.map((row) => element('a', { className: 'native-row', href: fileHref(row.path) }, row.path)))
      )
    );
  });
}

export function FileSourceView(target: HTMLElement, props: FileViewProps): NativeMount {
  return asyncMount(target, 'native-view file-source-view', async (signal) => {
    const payload = await getGraphAdapter().fileCode(props.path, signal);
    let source: WireSource | null = null;
    try { source = await getGraphAdapter().source({ file: props.path, from: 1 }, signal); } catch { /* metadata still renders */ }
    return { payload, source };
  }, ({ payload, source }, root) => {
    root.append(
      fileHeader(payload, true),
      ...(payload.drift ? [element('div', { className: 'drift' }, payload.reason ?? 'This file changed after it was indexed.')] : []),
      source ? sourceBlock(source) : empty('Source unavailable'),
      panel('Symbols', payload.outline.items.map((row) => nodeLink(row)), `${payload.outline.shown}/${payload.outline.total}`)
    );
  });
}

function entryRow(row: EntryRow): HTMLElement {
  const target = row.target;
  const href = target?.type === 'file' ? fileHref(target.path) : target?.type === 'symbol' ? symbolHref(target.id) : '#';
  return element('a', { className: 'native-row', href }, kindGlyph(row.kind), element('span', { className: 'native-row-name' }, row.name), element('span', { className: 'native-row-meta' }, row.meta));
}

export function EntryPointsView(target: HTMLElement, _props: EntryViewProps = {}): NativeMount {
  return asyncMount(target, 'native-view entry-view', (signal) => getGraphAdapter().entryPoints({ limit: 24, routes: 200 }, signal), (payload: WireEntryPoints, root) => {
    const model = buildEntryPanel(payload);
    root.append(element('header', { className: 'native-view-header' }, element('h1', {}, 'Entry points'), element('span', { className: 'native-meta' }, payload.frameworks.join(' · '))));
    for (const section of model.sections) root.append(panel(section.title, section.groups.flatMap((group) => group.rows).map(entryRow), section.note));
  });
}

export function DeadCodeView(target: HTMLElement, props: DeadCodeViewProps = {}): NativeMount {
  return asyncMount(target, 'native-view dead-view', (signal) => getGraphAdapter().deadCode({
    kinds: props.kind,
    includeExported: props.exported,
    includeTests: props.tests,
    includeGenerated: props.generated,
  }, signal), (payload, root) => {
    root.append(element('header', { className: 'native-view-header' }, element('h1', {}, 'Dead code'), element('span', { className: 'native-meta' }, deadCodeHeadline(payload))));
    if (payload.groups.length === 0) { root.append(empty(deadCodeEmptyMessage(payload))); return; }
    for (const group of payload.groups) root.append(panel(group.file, group.rows.map((row) => nodeLink(row, deadCodeRowMeta(row))), `${group.lines} lines`));
  });
}

export function HomeView(target: HTMLElement, stats: WireStats | null = null): NativeMount {
  if (!stats) return mount(target, loading('Reading index health…'));
  const health = stats.health;
  const accounting = health.extraction.accounting;
  const healthRow = (label: string, value: string, detail?: string): HTMLElement => element(
    'div', { className: 'health-row' },
    element('span', { className: 'health-label' }, label),
    element('strong', { className: 'health-value' }, value),
    detail ? element('span', { className: 'health-detail' }, detail) : null,
  );
  const root = element('section', { className: 'native-view health-view' },
    element('header', { className: 'native-view-header' },
      element('div', {}, element('h1', {}, 'Index Health'), element('p', {}, 'Independent trust signals for this project index.')),
    ),
    element('div', { className: 'health-grid' },
      healthRow('Git snapshot', health.gitFreshness.state, health.gitFreshness.detail),
      healthRow('Filesystem/content', health.pendingChanges.state,
        health.pendingChanges.count === null ? 'No live watcher or filesystem scan available.' : `${health.pendingChanges.count} pending change(s).`),
      healthRow('Extraction', health.extraction.state.toUpperCase(), accounting
        ? `${accounting.indexed} indexed · ${accounting.skipped} skipped · ${accounting.unsupported} unsupported · ${accounting.failed} failed`
        : 'Last full-index accounting unavailable.'),
      healthRow('Extraction version', `${health.compatibility.builtWithExtractionVersion ?? 'unknown'}/${health.compatibility.currentExtractionVersion}`,
        health.compatibility.reindexRecommended ? 'Re-index recommended.' : 'Compatible with this runtime.'),
      healthRow('References', String(health.pendingReferences), health.pendingReferences > 0 ? 'Resolution is incomplete.' : 'No pending references.'),
      healthRow('Watcher', health.watcher.state, health.watcher.reason ?? 'No degradation reason recorded.'),
      healthRow('Ignored paths', 'NOT ENUMERATED', 'Ignored paths are deliberately not counted.'),
      healthRow('Last full index', accounting?.completedAt ? new Date(accounting.completedAt).toLocaleString() : 'UNAVAILABLE',
        accounting?.timings ? `scan ${accounting.timings.scanMs}ms · parse/store ${accounting.timings.parseStoreMs}ms · resolve/link ${accounting.timings.resolutionLinkMs}ms · maintenance ${accounting.timings.maintenanceMs}ms · total ${accounting.timings.totalMs}ms` : 'Phase timing unavailable.'),
    ),
  );
  if (accounting?.skippedReasons && Object.keys(accounting.skippedReasons).length > 0) {
    root.append(panel('Skipped reasons', Object.entries(accounting.skippedReasons).map(([reason, count]) =>
      element('div', { className: 'native-row' }, element('span', { className: 'native-row-name' }, reason), element('span', { className: 'native-row-meta' }, String(count))))));
  }
  return mount(target, root);
}

export function NotFoundView(target: HTMLElement, path: string): NativeMount {
  return mount(target, empty('Unknown view', `No Afyx Graph view matches ${path}.`));
}
