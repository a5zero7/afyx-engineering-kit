export type Dispose = () => void;

export interface NativeMount {
  readonly element: HTMLElement;
  dispose(): void;
}

type Attributes = Record<string, string | number | boolean | null | undefined>;

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Array<Node | string | null | undefined>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

function applyAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'className') node.setAttribute('class', String(value));
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
}

export function append(parent: Node, children: Array<Node | string | null | undefined>): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function replace(parent: Element, ...children: Array<Node | string>): void {
  parent.replaceChildren(...children.map((child) =>
    typeof child === 'string' ? document.createTextNode(child) : child
  ));
}

export function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | Window | Document,
  event: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions
): Dispose {
  const listener = handler as EventListener;
  target.addEventListener(event, listener, options);
  return () => target.removeEventListener(event, listener, options);
}

export function mount(target: HTMLElement, root: HTMLElement, disposers: Dispose[] = []): NativeMount {
  target.replaceChildren(root);
  let active = true;
  return {
    element: root,
    dispose(): void {
      if (!active) return;
      active = false;
      for (const dispose of disposers.splice(0).reverse()) dispose();
      if (root.parentNode === target) root.remove();
    },
  };
}

export function loading(label = 'Loading…'): HTMLElement {
  return element('div', { className: 'native-state loading', role: 'status' }, label);
}

export function empty(title: string, detail?: string): HTMLElement {
  return element(
    'section',
    { className: 'emptystate native-state' },
    element('h2', {}, title),
    detail ? element('p', {}, detail) : null
  );
}

export function failure(cause: unknown): HTMLElement {
  const message = cause instanceof Error ? cause.message : String(cause);
  return element(
    'section',
    { className: 'emptystate native-state error', role: 'alert' },
    element('h2', {}, 'Could not load this view'),
    element('p', {}, message)
  );
}

export function button(label: string, action: () => void, title?: string): HTMLButtonElement {
  const node = element('button', { type: 'button', title, className: 'native-button' }, label);
  node.addEventListener('click', action);
  return node;
}
