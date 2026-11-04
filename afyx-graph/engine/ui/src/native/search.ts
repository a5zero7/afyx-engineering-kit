import { fileHref, flowHref, navigate } from '../lib/navigation';
import { palette } from '../lib/native-state';
import type { PaletteItem } from '../lib/search-model';
import { openEntryTarget, walkTo } from '../lib/walk';
import { element, listen, mount, replace, type Dispose, type NativeMount } from './dom';

function pick(item: PaletteItem, input: HTMLInputElement): void {
  palette.reset();
  input.blur();
  if (item.type === 'flow') { navigate(flowHref({ from: item.from, to: item.to })); return; }
  if (item.type === 'entry') { openEntryTarget(item.row.target); return; }
  const id = item.type === 'route' ? item.nodeId : item.id;
  if (!id) return;
  if (item.type === 'symbol' && item.node.kind === 'file') { navigate(fileHref(item.node.file)); return; }
  walkTo(item.type === 'route'
    ? { id, name: item.handler, kind: null }
    : { id, name: item.node.name, kind: item.node.kind }, 'start');
}

export interface SearchPaletteMount extends NativeMount { focus(): void }

export function SearchPalette(target: HTMLElement): SearchPaletteMount {
  const root = element('div', { className: 'native-search', role: 'search' });
  const input = element('input', {
    type: 'search',
    role: 'combobox',
    'aria-expanded': palette.open,
    placeholder: 'Search a symbol or file, or ask “how does X reach Y” — press / to focus',
    'aria-label': 'Search symbols and files',
    autocomplete: 'off',
  });
  const panel = element('div', { className: 'native-palette', role: 'listbox' });
  root.append(input, panel);
  const disposers: Dispose[] = [];

  function draw(): void {
    root.classList.toggle('open', palette.open);
    input.setAttribute('aria-expanded', String(palette.open));
    if (!palette.open) { replace(panel); return; }
    const model = palette.view;
    const nodes: Node[] = [];
    if (model.hint) nodes.push(element('p', { className: 'palette-hint' }, model.hint));
    if (palette.pending) nodes.push(element('p', { className: 'palette-status', role: 'status' }, 'Searching…'));
    else if (palette.failure) nodes.push(element('p', { className: 'palette-error', role: 'alert' }, palette.failure));
    else if (model.empty) nodes.push(element('p', { className: 'palette-empty' }, model.empty));
    let index = 0;
    for (const section of model.sections) {
      const rows: Node[] = [element('h3', {}, section.title)];
      if (section.note) rows.push(element('p', { className: 'palette-note' }, section.note));
      for (const item of section.items) {
        const at = index++;
        const name = item.type === 'route' ? item.url : item.name;
        const meta = item.type === 'route' ? item.handler : item.meta;
        const row = element('button', {
          type: 'button', role: 'option', className: `palette-row${palette.selected === at ? ' selected' : ''}`,
          'aria-selected': palette.selected === at,
        }, element('span', { className: 'palette-name' }, name), element('span', { className: 'palette-meta' }, meta), element('span', { className: 'palette-location' }, item.location));
        row.addEventListener('pointerenter', () => palette.select(at));
        row.addEventListener('mousedown', (event) => { event.preventDefault(); pick(item, input); });
        rows.push(row);
      }
      nodes.push(element('section', { className: 'palette-section' }, ...rows));
    }
    replace(panel, ...nodes);
  }

  input.addEventListener('focus', () => palette.show());
  input.addEventListener('input', () => { palette.query = input.value; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); palette.hide(); input.blur(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); palette.move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); palette.move(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); const item = palette.selectedItem; if (item) pick(item, input); }
  });
  disposers.push(palette.subscribe(draw));
  disposers.push(listen(document, 'pointerdown', (event) => {
    if (event.target instanceof Node && root.contains(event.target)) return;
    palette.hide();
  }));
  draw();
  const mounted = mount(target, root, disposers);
  return {
    ...mounted,
    focus(): void { input.focus(); input.select(); palette.show(); },
  };
}
