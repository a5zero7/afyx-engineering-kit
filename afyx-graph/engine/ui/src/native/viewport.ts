import { button, element, listen, svgElement, type Dispose } from './dom';

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface ViewportController {
  readonly state: ViewportState;
  fit(): void;
  reset(): void;
  dispose(): void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function createViewport(
  host: HTMLElement,
  content: SVGGElement,
  bounds: { width: number; height: number },
  options: { minScale?: number; maxScale?: number; initialScale?: number } = {}
): ViewportController {
  const minScale = options.minScale ?? MIN_SCALE;
  const maxScale = options.maxScale ?? MAX_SCALE;
  const initialScale = Math.min(maxScale, Math.max(minScale, options.initialScale ?? 1));
  const state: ViewportState = { x: 0, y: 0, scale: initialScale };
  const disposers: Dispose[] = [];
  let pointer: { id: number; x: number; y: number; originX: number; originY: number } | null = null;

  function apply(): void {
    state.x = finite(state.x, 0);
    state.y = finite(state.y, 0);
    state.scale = Math.min(maxScale, Math.max(minScale, finite(state.scale, 1)));
    content.setAttribute('transform', `translate(${state.x} ${state.y}) scale(${state.scale})`);
  }

  function reset(): void {
    state.x = 0;
    state.y = 0;
    state.scale = initialScale;
    apply();
  }

  function fit(): void {
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, finite(bounds.width, 1));
    const height = Math.max(1, finite(bounds.height, 1));
    const availableWidth = Math.max(1, rect.width - 32);
    const availableHeight = Math.max(1, rect.height - 32);
    state.scale = Math.min(maxScale, Math.max(minScale, Math.min(availableWidth / width, availableHeight / height)));
    state.x = Math.max(16, (rect.width - width * state.scale) / 2);
    state.y = Math.max(16, (rect.height - height * state.scale) / 2);
    apply();
  }

  disposers.push(listen(host, 'wheel', (event) => {
    event.preventDefault();
    const wheel = event as WheelEvent;
    const rect = host.getBoundingClientRect();
    const px = wheel.clientX - rect.left;
    const py = wheel.clientY - rect.top;
    const next = Math.min(maxScale, Math.max(minScale, state.scale * Math.exp(-wheel.deltaY * 0.0015)));
    const ratio = next / state.scale;
    state.x = px - (px - state.x) * ratio;
    state.y = py - (py - state.y) * ratio;
    state.scale = next;
    apply();
  }, { passive: false }));

  disposers.push(listen(host, 'pointerdown', (event) => {
    const down = event as PointerEvent;
    if (down.button !== 0 || (down.target as Element | null)?.closest('button,a,[data-node]')) return;
    pointer = { id: down.pointerId, x: down.clientX, y: down.clientY, originX: state.x, originY: state.y };
    host.setPointerCapture?.(down.pointerId);
    host.classList.add('panning');
  }));
  disposers.push(listen(host, 'pointermove', (event) => {
    const move = event as PointerEvent;
    if (!pointer || pointer.id !== move.pointerId) return;
    state.x = pointer.originX + move.clientX - pointer.x;
    state.y = pointer.originY + move.clientY - pointer.y;
    apply();
  }));
  const end = (event: PointerEvent): void => {
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer = null;
    host.classList.remove('panning');
  };
  disposers.push(listen(host, 'pointerup', end));
  disposers.push(listen(host, 'pointercancel', end));

  apply();
  return {
    state,
    fit,
    reset,
    dispose(): void {
      for (const dispose of disposers.splice(0).reverse()) dispose();
      host.classList.remove('panning');
    },
  };
}

export function viewportControls(controller: ViewportController): HTMLElement {
  return element(
    'div',
    { className: 'viewport-controls', 'aria-label': 'Graph viewport controls' },
    button('Fit', () => controller.fit(), 'Fit graph to viewport'),
    button('1:1', () => controller.reset(), 'Reset graph viewport')
  );
}

export function arrowMarker(): SVGDefsElement {
  return svgElement(
    'defs',
    {},
    svgElement(
      'marker',
      { id: 'afyx-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'strokeWidth' },
      svgElement('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'context-stroke' })
    )
  );
}
