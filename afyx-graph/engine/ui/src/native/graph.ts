import { moduleMetaLabel, portPoint, type MapLayout } from '../lib/map-model';
import { arrowMarker, createViewport, viewportControls } from './viewport';
import { element, svgElement, type Dispose } from './dom';

export interface GraphLabels {
  node(id: string): { title: string; subtitle: string };
  edge?(id: string): string;
}

export interface GraphRender {
  element: HTMLElement;
  dispose: Dispose;
}

function edgePath(layout: MapLayout, edge: MapLayout['edges'][number]): string {
  const source = layout.nodes.find((node) => node.id === edge.source);
  const target = layout.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return '';
  const from = portPoint(source, edge.id, 'source');
  const to = portPoint(target, edge.id, 'target');
  const bend = Math.max(36, Math.abs(to.y - from.y) * 0.42);
  const direction = to.y >= from.y ? 1 : -1;
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend * direction}, ${to.x} ${to.y - bend * direction}, ${to.x} ${to.y}`;
}

export function renderMapGraph(
  layout: MapLayout,
  labels?: Partial<GraphLabels>,
  onSelect?: (id: string) => void
): GraphRender {
  const host = element('section', { className: 'native-graph', tabindex: 0 });
  const svg = svgElement('svg', {
    className: 'native-graph-svg',
    viewBox: `0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`,
    role: 'img',
    'aria-label': 'Afyx Graph visualization',
  });
  const content = svgElement('g', { className: 'native-graph-content' });
  svg.append(arrowMarker(), content);
  host.append(svg);

  for (const edge of layout.edges) {
    const path = edgePath(layout, edge);
    if (!path) continue;
    const line = svgElement('path', {
      d: path,
      className: `native-edge${edge.back ? ' back' : ''}${edge.thin ? ' thin' : ''}`,
      'data-edge': edge.id,
      'stroke-width': Math.max(1, edge.width),
      'marker-end': 'url(#afyx-arrow)',
      fill: 'none',
    });
    const title = labels?.edge?.(edge.id);
    if (title) line.append(svgElement('title', {}, title));
    content.append(line);
  }

  for (const node of layout.nodes) {
    const words = labels?.node?.(node.id) ?? {
      title: node.module.label || node.module.id,
      subtitle: moduleMetaLabel(node.module, node.island),
    };
    const group = svgElement('g', {
      className: `native-node${node.generated ? ' generated' : ''}${node.island ? ' island' : ''}`,
      transform: `translate(${node.x} ${node.y})`,
      'data-node': node.id,
      tabindex: 0,
      role: 'button',
      'aria-label': `${words.title}. ${words.subtitle}`,
    });
    group.append(
      svgElement('rect', { width: node.width, height: node.height, rx: 0 }),
      svgElement('text', { x: 10, y: 18, className: 'native-node-title' }, words.title),
      svgElement('text', { x: 10, y: 35, className: 'native-node-subtitle' }, words.subtitle)
    );
    if (node.weight > 0) group.append(svgElement('rect', {
      x: 0,
      y: node.height - 4,
      width: node.width * node.weight,
      height: 4,
      className: 'native-node-weight',
    }));
    const select = (): void => onSelect?.(node.id);
    group.addEventListener('click', select);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    content.append(group);
  }

  const viewport = createViewport(host, content, { width: layout.width, height: layout.height }, { minScale: 0.35, maxScale: 2.5 });
  host.append(viewportControls(viewport));
  queueMicrotask(() => viewport.fit());
  return { element: host, dispose: () => viewport.dispose() };
}
