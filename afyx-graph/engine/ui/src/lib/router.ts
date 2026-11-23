import { registerHashSync } from './navigation';

export {
  back, deadHref, entryHref, fileHref, flowHref, getNavigationDriver, hashNavigation,
  mapHref, navigate, screensHref, setNavigationDriver, stepsHref, symbolHref,
} from './navigation';
export type {
  DeadCodeHrefOptions, FileHrefOptions, FlowHrefOptions, MapHrefOptions,
  NavigationDriver, StepsHrefOptions, SymbolHrefOptions,
} from './navigation';

export type Route =
  | { view: 'home' }
  | { view: 'symbol'; id: string | null; line: number | null }
  | { view: 'file'; path: string; line: number | null; source: boolean }
  | { view: 'map'; root: string | null; depth: number | null; tests: boolean }
  | { view: 'flow'; from: string | null; to: string | null; symbols: string | null; trail: string | null }
  | { view: 'entry' }
  | { view: 'screens' }
  | { view: 'steps'; anchor: string | null; symbol: string | null; depth: number | null; through: boolean; reading: 'order' | 'tree' | null }
  | { view: 'dead'; exported: boolean }
  | { view: 'unknown'; path: string };

export type ViewName = Route['view'];
export interface RouterLocation { route: Route; params: URLSearchParams; raw: string }

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function parseLine(params: URLSearchParams): number | null {
  const line = Number.parseInt(params.get('hl') ?? '', 10);
  return Number.isFinite(line) && line > 0 ? line : null;
}

export function parseHash(hash: string): RouterLocation {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  const pathPart = q < 0 ? raw : raw.slice(0, q);
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1));
  const segments = pathPart.split('/').filter(Boolean).map(decodeSegment);
  const line = parseLine(params);
  const [head, ...rest] = segments;
  let route: Route;
  if (head === undefined) route = { view: 'home' };
  else if (head === 's') route = { view: 'symbol', id: rest.length > 0 ? rest.join('/') : null, line };
  else if (head === 'file' && rest.length > 0) route = { view: 'file', path: rest.join('/'), line, source: params.get('src') === '1' };
  else if (head === 'map' && rest.length === 0) {
    const depth = Number.parseInt(params.get('depth') ?? '', 10);
    route = { view: 'map', root: params.get('root'), depth: Number.isFinite(depth) && depth >= 1 && depth <= 4 ? depth : null, tests: params.get('tests') === '1' };
  } else if (head === 'entry' && rest.length === 0) route = { view: 'entry' };
  else if (head === 'screens' && rest.length === 0) route = { view: 'screens' };
  else if (head === 'steps' && rest.length === 0) {
    const depth = Number.parseInt(params.get('depth') ?? '', 10);
    const reading = params.get('view');
    route = {
      view: 'steps', anchor: params.get('anchor'), symbol: params.get('symbol'),
      depth: Number.isFinite(depth) && depth >= 1 && depth <= 14 ? depth : null,
      through: params.get('through') === '1', reading: reading === 'order' || reading === 'tree' ? reading : null,
    };
  } else if (head === 'dead' && rest.length === 0) route = { view: 'dead', exported: params.get('exported') === '1' };
  else if (head === 'flow' && rest.length === 0) route = { view: 'flow', from: params.get('from'), to: params.get('to'), symbols: params.get('symbols'), trail: params.get('t') };
  else route = { view: 'unknown', path: pathPart };
  return { route, params, raw };
}

let current = parseHash(typeof location === 'undefined' ? '' : location.hash);
const listeners = new Set<(location: RouterLocation) => void>();
function sync(): void {
  const next = parseHash(location.hash);
  if (next.raw === current.raw) return;
  current = next;
  for (const listener of [...listeners]) listener(current);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', sync);
  window.addEventListener('popstate', sync);
  registerHashSync(sync);
}

export const router = {
  get location(): RouterLocation { return current; },
  get route(): Route { return current.route; },
  get params(): URLSearchParams { return current.params; },
  subscribe(listener: (location: RouterLocation) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
