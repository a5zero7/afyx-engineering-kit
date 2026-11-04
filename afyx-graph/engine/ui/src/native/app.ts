import { setGraphAdapter, type GraphAdapter } from '../lib/adapter';
import {
  back, deadHref, entryHref, flowHref, mapHref, navigate, screensHref, stepsHref,
  symbolHref, type NavigationDriver, setNavigationDriver,
} from '../lib/navigation';
import { live, palette, project, resolveTrailNames, toast, trail, trails } from '../lib/native-state';
import { router, type Route } from '../lib/router';
import { hopLabel } from '../lib/trail-codec';
import { element, listen, mount, replace, type Dispose, type NativeMount } from './dom';
import { SearchPalette } from './search';
import {
  ArchitectureMap, DeadCodeView, EntryPointsView, FileSourceView, FileView, FlowStrip,
  HomeView, NotFoundView, ScreensView, StepsView, SymbolView,
} from './views';

export interface AfyxGraphUiOptions {
  adapter?: GraphAdapter | null;
  nav?: NavigationDriver | null;
  theme?: 'auto' | 'light' | 'dark';
  fill?: boolean;
}

export function AfyxGraphUi(target: HTMLElement, options: AfyxGraphUiOptions = {}): NativeMount {
  setGraphAdapter(options.adapter ?? null);
  setNavigationDriver(options.nav ?? null);
  const root = element('div', {
    className: `afyx-graph-ui${options.fill === false ? '' : ' fill'}`,
    'data-theme': options.theme && options.theme !== 'auto' ? options.theme : null,
  });
  return mount(target, root);
}

function active(view: Route['view'], names: Route['view'][]): string {
  return names.includes(view) ? 'active' : '';
}

export function mountApp(target: HTMLElement, options: AfyxGraphUiOptions = {}): NativeMount {
  if (options.adapter !== undefined) setGraphAdapter(options.adapter);
  if (options.nav !== undefined) setNavigationDriver(options.nav);
  const root = element('div', { className: 'native-app' });
  const topbar = element('header', { className: 'topbar' });
  const trailbar = element('nav', { className: 'trailbar', 'aria-label': 'Current graph trail' });
  const main = element('main', { className: 'native-main' });
  const toastHost = element('div', { className: 'toast', role: 'status', 'aria-live': 'polite' });
  const searchHost = element('div', { className: 'topbar-search' });
  const search = SearchPalette(searchHost);
  const disposers: Dispose[] = [() => search.dispose()];
  let viewMount: NativeMount | null = null;
  let seenIndex = live.indexTick;

  function drawTopbar(): void {
    const route = router.route;
    const hasScreens = (project.stats?.graph.edgesByKind.navigates ?? 0) > 0;
    const nav = element('nav', { className: 'views', 'aria-label': 'Views' });
    const links: Array<[string, string, Route['view'][]]> = [];
    if (hasScreens) links.push(['Screens', screensHref(), ['screens', 'home']]);
    links.push(
      ['Steps', stepsHref(), ['steps']], ['Entry points', entryHref(), ['entry']],
      ['Map', mapHref(), ['map']], ['Symbol', symbolHref(trail.current?.id ?? null), ['symbol']],
      ['Flow', flowHref(), ['flow']], ['Dead code', deadHref(), ['dead']]
    );
    for (const [label, href, names] of links) nav.append(element('a', { href, className: active(route.view, names) }, label));
    replace(topbar,
      element('a', { className: 'brand', href: '#/', 'aria-label': 'Afyx Graph home' }, element('span', { className: 'brand-mark' }), element('span', { className: 'brand-name' }, 'Afyx Graph'), element('span', { className: 'brand-sub' }, 'ui')),
      nav, searchHost,
      element('div', { className: 'project', title: project.error ?? 'Indexed project' },
        live.degraded || live.stopped ? element('span', { className: 'offline' }, live.degraded ?? 'Not live') : null,
        element('strong', {}, project.name ?? 'Reading project…'),
        project.summary ? element('span', {}, project.summary) : null
      )
    );
  }

  function drawTrail(): void {
    const nodes: Node[] = [];
    trail.hops.forEach((hop, index) => {
      if (index > 0) nodes.push(element('span', { className: 'trail-arrow', 'aria-hidden': true }, hop.dir === 'up' ? '←' : '→'));
      const link = element('a', { href: symbolHref(hop.id, { trail: trail.encoded }), className: index === trail.hops.length - 1 ? 'current' : '' }, hopLabel(hop));
      link.addEventListener('click', () => trail.truncateTo(index));
      nodes.push(link);
    });
    if (nodes.length === 0) nodes.push(element('span', { className: 'trail-empty' }, 'No active trail'));
    replace(trailbar, ...nodes);
  }

  function drawToast(): void { replace(toastHost, toast.message ?? ''); toastHost.hidden = toast.message === null; }

  function drawView(): void {
    viewMount?.dispose();
    const host = element('div', { className: 'view-host' });
    replace(main, host);
    const route = router.route;
    trail.hydrate(router.params.get('t'));
    if (route.view === 'symbol' && route.id) {
      if (trail.current?.id !== route.id) trail.push({ id: route.id });
      viewMount = SymbolView(host, { id: route.id, line: route.line });
    } else if (route.view === 'file') viewMount = route.source ? FileSourceView(host, route) : FileView(host, route);
    else if (route.view === 'map') viewMount = ArchitectureMap(host, route);
    else if (route.view === 'flow') viewMount = FlowStrip(host, { ...route, trailParam: route.trail });
    else if (route.view === 'entry') viewMount = EntryPointsView(host, { project: project.name });
    else if (route.view === 'screens' || (route.view === 'home' && (project.stats?.graph.edgesByKind.navigates ?? 0) > 0)) viewMount = ScreensView(host);
    else if (route.view === 'steps') viewMount = StepsView(host, route);
    else if (route.view === 'dead') viewMount = DeadCodeView(host, { exported: route.exported });
    else if (route.view === 'unknown') viewMount = NotFoundView(host, route.path);
    else viewMount = HomeView(host, project.stats);
    void resolveTrailNames();
    drawTopbar();
    drawTrail();
  }

  disposers.push(router.subscribe(drawView), project.subscribe(() => { drawTopbar(); if (router.route.view === 'home') drawView(); }), trail.subscribe(drawTrail), toast.subscribe(drawToast));
  disposers.push(live.subscribe(() => {
    drawTopbar();
    if (live.indexTick !== seenIndex) {
      seenIndex = live.indexTick;
      void project.reload();
      void palette.reloadEntries();
      void trails.reload();
      toast.show('Index updated · reloaded');
      drawView();
    }
  }));
  disposers.push(listen(window, 'keydown', (event) => {
    if (event.defaultPrevented) return;
    const targetElement = event.target;
    const typing = targetElement instanceof HTMLElement && (targetElement.isContentEditable || targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement || targetElement instanceof HTMLSelectElement);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.focus(); return; }
    if (event.metaKey || event.ctrlKey || event.altKey || typing) return;
    const shortcuts: Record<string, string> = { m: mapHref(), f: flowHref(), e: entryHref(), s: screensHref(), d: deadHref() };
    if (event.key === '/') { event.preventDefault(); search.focus(); }
    else if (event.key === 'Backspace' || event.key === '[') { event.preventDefault(); back(); }
    else if (shortcuts[event.key]) { event.preventDefault(); navigate(shortcuts[event.key]!); }
  }));
  disposers.push(() => { viewMount?.dispose(); live.stop(); });

  root.append(topbar, trailbar, main, toastHost);
  drawTopbar(); drawTrail(); drawToast(); drawView();
  void project.ensure();
  live.start();
  return mount(target, root, disposers);
}
