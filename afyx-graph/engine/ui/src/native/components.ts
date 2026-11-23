import { buildHierarchyModel } from '../lib/hierarchy-model';
import { navigate, symbolHref } from '../lib/navigation';
import { palette, trail, trails } from '../lib/native-state';
import type { Palette as PaletteModel, PaletteItem } from '../lib/search-model';
import { hopLabel } from '../lib/trail-codec';
import { isOpenable, trailMeta, trailTitle } from '../lib/trails-model';
import type { WireHierarchy, WireNodeDetail } from '../lib/wire';
import { element, mount, replace, type Dispose, type NativeMount } from './dom';

export function KindGlyph(target: HTMLElement, props: { kind: string }): NativeMount {
  return mount(target, element('span', { className: `kind-glyph kind-${props.kind}`, title: props.kind }, (props.kind[0] ?? '?').toUpperCase()));
}

export function DriftBanner(target: HTMLElement, props: { reason?: string; file?: string }): NativeMount {
  return mount(target, element('aside', { className: 'drift', role: 'note' }, props.reason ?? `${props.file ?? 'This file'} changed after it was indexed.`));
}

function itemName(item: PaletteItem): string {
  return item.type === 'route' ? item.url : item.name;
}

export function PaletteRows(target: HTMLElement, props: { model?: PaletteModel; onpick?: (item: PaletteItem) => void } = {}): NativeMount {
  const root = element('div', { className: 'native-list palette-rows' });
  const model = props.model ?? palette.view;
  model.items.forEach((item, index) => {
    const row = element('button', { type: 'button', className: `palette-row${palette.selected === index ? ' selected' : ''}` }, itemName(item));
    row.addEventListener('click', () => props.onpick?.(item));
    root.append(row);
  });
  return mount(target, root);
}

export function PalettePanel(target: HTMLElement, props: { onpick?: (item: PaletteItem) => void } = {}): NativeMount {
  const root = element('section', { className: 'native-palette' });
  let child: NativeMount | null = null;
  const draw = (): void => {
    child?.dispose();
    const host = element('div');
    replace(root, host);
    child = PaletteRows(host, { model: palette.view, onpick: props.onpick });
  };
  const dispose = palette.subscribe(draw);
  draw();
  const mounted = mount(target, root, [dispose, () => child?.dispose()]);
  return mounted;
}

export function TrailBar(target: HTMLElement): NativeMount {
  const root = element('nav', { className: 'trailbar', 'aria-label': 'Current graph trail' });
  const draw = (): void => {
    const nodes: Node[] = [];
    trail.hops.forEach((hop, index) => {
      if (index > 0) nodes.push(element('span', { className: 'trail-arrow' }, hop.dir === 'up' ? '←' : '→'));
      nodes.push(element('a', { href: symbolHref(hop.id, { trail: trail.encoded }) }, hopLabel(hop)));
    });
    replace(root, ...(nodes.length ? nodes : [element('span', { className: 'trail-empty' }, 'No active trail')]));
  };
  const dispose = trail.subscribe(draw);
  draw();
  return mount(target, root, [dispose]);
}

export function SavedTrails(target: HTMLElement): NativeMount {
  const root = element('section', { className: 'native-panel saved-trails' });
  const disposers: Dispose[] = [];
  const draw = (): void => {
    const rows = trails.list.map((saved) => {
      const row = element('button', { type: 'button', className: 'native-row', disabled: !isOpenable(saved) },
        element('strong', {}, trailTitle(saved)), element('span', { className: 'native-row-meta' }, trailMeta(saved)));
      row.addEventListener('click', () => {
        if (!saved.encoded || !saved.openId) return;
        trail.hydrate(saved.encoded);
        navigate(symbolHref(saved.openId, { trail: saved.encoded }));
      });
      return row;
    });
    const emptyText = trails.readOnlyReason ?? (trails.settled ? 'No saved trails.' : 'Reading saved trails…');
    replace(root, element('h2', {}, 'Saved trails'), ...(rows.length ? rows : [element('p', { className: 'dim' }, emptyText)]));
  };
  disposers.push(trails.subscribe(draw));
  void trails.ensure();
  draw();
  return mount(target, root, disposers);
}

export function TypeHierarchy(target: HTMLElement, props: { hierarchy: WireHierarchy; focus: WireNodeDetail; onopen?: (id: string) => void }): NativeMount {
  const model = buildHierarchyModel(props.hierarchy, props.focus);
  const root = element('section', { className: 'native-panel type-hierarchy' }, element('h2', {}, 'Type hierarchy'));
  if (model.headline) root.append(element('p', {}, model.headline));
  const visible = model.foldFrom === null ? model.rows : model.rows.slice(0, model.foldFrom);
  for (const row of visible) {
    const detail = row.entry?.via ? ` · ${row.entry.via}${row.entry.registeredAt ? ` at ${row.entry.registeredAt}` : ''}` : '';
    const button = element('button', { type: 'button', className: `native-row ${row.side}`, style: `padding-left:${row.indent}px` }, `${row.word ? `${row.word} ` : ''}${row.node.name}${detail}`);
    button.addEventListener('click', () => props.onopen?.(row.node.id));
    root.append(button);
  }
  if (model.foldCount > 0) root.append(element('p', { className: 'dim' }, `+${model.foldCount} more ${model.foldNoun}`));
  const wiring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wiring.setAttribute('class', 'hierarchy-wiring');
  for (const connector of model.connectors.filter((item) => item.toIndex < (model.foldFrom ?? Number.POSITIVE_INFINITY))) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const fromY = connector.fromIndex * 24 + 12;
    const toY = connector.toIndex * 24 + 12;
    path.setAttribute('d', `M ${connector.x} ${fromY} L ${connector.x} ${toY} L ${connector.toX} ${toY}`);
    wiring.append(path);
  }
  root.append(wiring);
  if (model.note) root.append(element('p', { className: 'dim' }, model.note));
  return mount(target, root);
}

export function ExportButtons(target: HTMLElement, props: { svg: () => string; filename?: string }): NativeMount {
  const root = element('div', { className: 'export-buttons' });
  const button = element('button', { type: 'button', className: 'native-button' }, 'Download SVG');
  button.addEventListener('click', () => {
    const blob = new Blob([props.svg()], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = element('a', { href: url, download: props.filename ?? 'afyx-graph.svg' });
    link.click();
    URL.revokeObjectURL(url);
  });
  root.append(button);
  return mount(target, root);
}
