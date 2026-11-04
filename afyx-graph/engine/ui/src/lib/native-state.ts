/** Framework-free state used by the standalone viewer and embeddable native views. */

import { canWriteTrails, deleteTrail, fetchEntryPoints, fetchNodeRefs, fetchSearch, fetchStats, fetchTrails, saveTrail } from './api';
import { getGraphAdapter } from './adapter';
import { buildEntryPalette, buildSearchPalette, moveSelection, parseFlowQuery, type Palette, type PaletteItem } from './search-model';
import { decodeTrail, encodeTrail, type HopDirection, type TrailHop } from './trail-codec';
import type { WireEntryPoints, WireSearch, WireStats, WireTrail, WireTrails } from './wire';

export type StateListener = () => void;

function observable(): { emit: () => void; subscribe: (listener: StateListener) => () => void } {
  const listeners = new Set<StateListener>();
  return {
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const trailEvents = observable();
let trailHops: TrailHop[] = [];
const known = new Map<string, { name: string | null; kind: string | null }>();

function remember(id: string, info: { name?: string | null; kind?: string | null }): void {
  if (!info.name && !info.kind) return;
  const current = known.get(id) ?? { name: null, kind: null };
  if (info.name) current.name = info.name;
  if (info.kind) current.kind = info.kind;
  known.set(id, current);
}

export const trail = {
  get hops(): readonly TrailHop[] { return trailHops; },
  get current(): TrailHop | null { return trailHops.at(-1) ?? null; },
  get encoded(): string { return encodeTrail(trailHops); },
  subscribe: trailEvents.subscribe,
  push(hop: { id: string; name?: string | null; kind?: string | null; dir?: HopDirection }): void {
    remember(hop.id, hop);
    const at = trailHops.findIndex((item) => item.id === hop.id);
    if (at >= 0) {
      const previous = trailHops[at]!;
      trailHops = [
        ...trailHops.slice(0, at),
        { ...previous, name: hop.name ?? previous.name, kind: hop.kind ?? previous.kind },
      ];
    } else {
      trailHops = [...trailHops, {
        id: hop.id,
        name: hop.name ?? null,
        kind: hop.kind ?? null,
        dir: hop.dir ?? (trailHops.length === 0 ? 'start' : 'down'),
      }];
    }
    trailEvents.emit();
  },
  rename(oldId: string, next: { id: string; name?: string | null; kind?: string | null }): void {
    const at = trailHops.findIndex((hop) => hop.id === oldId);
    if (at < 0) return;
    remember(next.id, next);
    const previous = trailHops[at]!;
    trailHops = trailHops.map((hop, index) => index === at ? {
      ...previous,
      id: next.id,
      name: next.name ?? previous.name,
      kind: next.kind ?? previous.kind,
    } : hop);
    trailEvents.emit();
  },
  truncateTo(index: number): void {
    if (index < 0 || index >= trailHops.length) return;
    trailHops = trailHops.slice(0, index + 1);
    trailEvents.emit();
  },
  resolve(id: string, info: { name?: string | null; kind?: string | null }): void {
    remember(id, info);
    trailHops = trailHops.map((hop) => hop.id === id ? {
      ...hop,
      name: info.name ?? hop.name,
      kind: info.kind ?? hop.kind,
    } : hop);
    trailEvents.emit();
  },
  clear(): void {
    trailHops = [];
    trailEvents.emit();
  },
  hydrate(encoded: string | null): void {
    const decoded = decodeTrail(encoded);
    if (encodeTrail(decoded) === encodeTrail(trailHops)) return;
    trailHops = decoded.map((hop) => {
      const remembered = known.get(hop.id);
      return remembered ? { ...hop, ...remembered } : hop;
    });
    trailEvents.emit();
  },
};

const nameless = new Set<string>();
export async function resolveTrailNames(): Promise<void> {
  const ids = trailHops.filter((hop) => !hop.name && !known.get(hop.id)?.name && !nameless.has(hop.id)).map((hop) => hop.id);
  if (ids.length === 0) return;
  try {
    const answer = await fetchNodeRefs(ids);
    for (const node of answer.items) trail.resolve(node.id, { name: node.kind === 'file' ? node.file : node.name, kind: node.kind });
    for (const id of answer.missing) nameless.add(id);
  } catch {
    // Trail names are presentation metadata; navigation remains usable.
  }
}

const projectEvents = observable();
let projectStats: WireStats | null = null;
let projectError: string | null = null;
let projectInflight: Promise<void> | null = null;
function loadProject(): Promise<void> {
  if (projectInflight) return projectInflight;
  projectInflight = fetchStats().then((value) => {
    projectStats = value;
    projectError = null;
  }).catch((cause: unknown) => {
    projectError = cause instanceof Error ? cause.message : String(cause);
  }).finally(projectEvents.emit);
  return projectInflight;
}

export const project = {
  get stats(): WireStats | null { return projectStats; },
  get error(): string | null { return projectError; },
  get name(): string | null { return projectStats?.project.name ?? null; },
  get summary(): string | null {
    if (!projectStats) return null;
    const n = (value: number): string => value.toLocaleString();
    return `${n(projectStats.graph.nodes)} symbols · ${n(projectStats.graph.edges)} edges · ${n(projectStats.graph.files)} files indexed`;
  },
  subscribe: projectEvents.subscribe,
  ensure: loadProject,
  reload(): Promise<void> {
    projectInflight = null;
    return loadProject();
  },
};

const paletteEvents = observable();
const SEARCH_LIMIT = 40;
const ENTRY_LIMIT = 24;
const ENTRY_ROUTE_LIMIT = 200;
export const PALETTE_ENTRY_ROWS = 6;
export const PALETTE_ENTRY_MATCHES = 6;
const DEBOUNCE_MS = 90;
let paletteQuery = '';
let paletteOpen = false;
let paletteSelected = 0;
let paletteLoading = false;
let paletteFailure: string | null = null;
let paletteAnswers: WireSearch[] = [];
let paletteEntries: WireEntryPoints | null = null;
let entriesSettled = false;
let entriesFailure: string | null = null;
let searchController: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let entriesInflight: Promise<void> | null = null;

function currentPalette(): Palette {
  if (paletteQuery.trim() === '') return buildEntryPalette(paletteEntries, { perSection: PALETTE_ENTRY_ROWS });
  return buildSearchPalette(paletteAnswers, parseFlowQuery(paletteQuery), {
    entries: paletteEntries,
    query: paletteQuery,
    entryRows: PALETTE_ENTRY_MATCHES,
  });
}

function loadEntries(): Promise<void> {
  if (entriesInflight) return entriesInflight;
  entriesInflight = fetchEntryPoints({ limit: ENTRY_LIMIT, routes: ENTRY_ROUTE_LIMIT }).then((value) => {
    paletteEntries = value;
    entriesFailure = null;
  }).catch((cause: unknown) => {
    paletteEntries = null;
    entriesFailure = cause instanceof Error ? cause.message : String(cause);
  }).finally(() => {
    entriesSettled = true;
    paletteEvents.emit();
  });
  return entriesInflight;
}

function cancelSearch(): void {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
  searchController?.abort();
  searchController = null;
}

async function runSearch(text: string, mine: number): Promise<void> {
  const flow = parseFlowQuery(text);
  const controller = new AbortController();
  searchController = controller;
  paletteLoading = true;
  paletteEvents.emit();
  try {
    const queries = flow ? [flow.from, flow.to] : [text];
    const answers = await Promise.all(queries.map((query) => fetchSearch(query, { limit: SEARCH_LIMIT }, controller.signal)));
    if (mine !== generation) return;
    paletteAnswers = answers;
    paletteFailure = null;
  } catch (cause) {
    if (controller.signal.aborted || mine !== generation) return;
    paletteAnswers = [];
    paletteFailure = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (mine === generation) {
      paletteLoading = false;
      paletteEvents.emit();
    }
  }
}

function setPaletteQuery(next: string): void {
  if (next === paletteQuery) return;
  paletteQuery = next;
  paletteSelected = 0;
  cancelSearch();
  const mine = ++generation;
  if (next.trim() === '') {
    paletteAnswers = [];
    paletteFailure = null;
    paletteLoading = false;
    paletteEvents.emit();
    return;
  }
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void runSearch(next, mine);
  }, DEBOUNCE_MS);
  paletteEvents.emit();
}

export const palette = {
  get query(): string { return paletteQuery; },
  set query(value: string) { setPaletteQuery(value); },
  get open(): boolean { return paletteOpen; },
  get loading(): boolean { return paletteLoading; },
  get failure(): string | null { return paletteFailure; },
  get view(): Palette { return currentPalette(); },
  get selected(): number { return paletteSelected; },
  get selectedItem(): PaletteItem | null { return currentPalette().items[Math.min(paletteSelected, currentPalette().items.length - 1)] ?? null; },
  get pending(): boolean { return paletteQuery.trim() !== '' && (paletteLoading || searchTimer !== null); },
  get entries(): WireEntryPoints | null { return paletteEntries; },
  get entriesSettled(): boolean { return entriesSettled; },
  get entriesFailure(): string | null { return entriesFailure; },
  subscribe: paletteEvents.subscribe,
  show(): void { paletteOpen = true; void loadEntries(); paletteEvents.emit(); },
  hide(): void { paletteOpen = false; paletteEvents.emit(); },
  select(index: number): void { paletteSelected = index; paletteEvents.emit(); },
  move(delta: number): void { paletteSelected = moveSelection(paletteSelected, delta, currentPalette().items.length); paletteEvents.emit(); },
  reset(): void {
    cancelSearch();
    generation++;
    paletteQuery = '';
    paletteAnswers = [];
    paletteFailure = null;
    paletteLoading = false;
    paletteSelected = 0;
    paletteOpen = false;
    paletteEvents.emit();
  },
  ensureEntries: loadEntries,
  reloadEntries(): Promise<void> { entriesInflight = null; return loadEntries(); },
};

const trailsEvents = observable();
let trailsPayload: WireTrails | null = null;
let trailsSettled = false;
let trailsFailure: string | null = null;
let trailsBusy = false;
let trailsInflight: Promise<void> | null = null;
function loadTrails(): Promise<void> {
  if (trailsInflight) return trailsInflight;
  trailsInflight = fetchTrails().then((value) => {
    trailsPayload = value;
    trailsFailure = null;
  }).catch((cause: unknown) => {
    trailsPayload = null;
    trailsFailure = cause instanceof Error ? cause.message : String(cause);
  }).finally(() => {
    trailsSettled = true;
    trailsEvents.emit();
  });
  return trailsInflight;
}
function adoptTrails(value: WireTrails): void {
  trailsPayload = value;
  trailsFailure = null;
  trailsSettled = true;
  trailsInflight = Promise.resolve();
  trailsEvents.emit();
}
export const trails = {
  get list(): readonly WireTrail[] { return trailsPayload?.trails ?? []; },
  get payload(): WireTrails | null { return trailsPayload; },
  get settled(): boolean { return trailsSettled; },
  get failure(): string | null { return trailsFailure; },
  get busy(): boolean { return trailsBusy; },
  get canSave(): boolean { return canWriteTrails() && (trailsPayload === null || !trailsPayload.readOnly); },
  get readOnlyReason(): string | null {
    if (trailsPayload?.readOnly) return trailsPayload.readOnlyReason ?? 'This viewer is running read-only.';
    return canWriteTrails() ? null : 'This viewer cannot save trails.';
  },
  get directory(): string | null { return trailsPayload?.directory ?? null; },
  subscribe: trailsEvents.subscribe,
  ensure: loadTrails,
  reload(): Promise<void> { trailsInflight = null; return loadTrails(); },
  async save(name: string, note: string, hops: readonly TrailHop[]): Promise<string | null> {
    trailsBusy = true;
    trailsEvents.emit();
    try {
      const answer = await saveTrail({ name, note, hops: hops.map(({ dir, id }) => ({ dir, id })) });
      adoptTrails(answer);
      return answer.saved ?? null;
    } catch (cause) {
      trailsFailure = cause instanceof Error ? cause.message : String(cause);
      return null;
    } finally {
      trailsBusy = false;
      trailsEvents.emit();
    }
  },
  async remove(id: string): Promise<boolean> {
    trailsBusy = true;
    trailsEvents.emit();
    try {
      adoptTrails(await deleteTrail(id));
      return true;
    } catch (cause) {
      trailsFailure = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      trailsBusy = false;
      trailsEvents.emit();
    }
  },
  clearFailure(): void { trailsFailure = null; trailsEvents.emit(); },
};

export interface LiveIndexRevision { lastIndexedAt: number | null; files: number; edges?: number }
export interface LiveHello { type: 'hello'; index: LiveIndexRevision | null; watching: { source: boolean; index: boolean }; degraded: string | null; heartbeatMs: number }
export interface LiveChanged { type: 'changed'; files?: string[]; total?: number; truncated?: boolean; scan?: boolean; index?: LiveIndexRevision; at?: number }
export interface LiveIndexEvent { type: 'index'; index: LiveIndexRevision; files: string[]; total: number; truncated: boolean; at: number }

const liveEvents = observable();
let liveConnected = false;
let liveStopped = false;
let liveDegraded: string | null = null;
let liveIndexTick = 0;
let liveDiskTick = 0;
let liveLastChanged: LiveChanged | null = null;
let closeLive: (() => void) | null = null;

function recordLive(kind: 'index' | 'disk', event?: unknown): void {
  if (kind === 'index') liveIndexTick++;
  else {
    liveDiskTick++;
    if (event && typeof event === 'object') liveLastChanged = event as LiveChanged;
  }
  liveEvents.emit();
}

export const live = {
  get connected(): boolean { return liveConnected; },
  get stopped(): boolean { return liveStopped; },
  get degraded(): string | null { return liveDegraded; },
  get indexTick(): number { return liveIndexTick; },
  get diskTick(): number { return liveDiskTick; },
  subscribe: liveEvents.subscribe,
  start(): void {
    if (closeLive) return;
    const events = getGraphAdapter().events;
    if (!events) return;
    closeLive = events({
      hello(event) {
        liveConnected = true;
        liveStopped = false;
        const hello = event as Partial<LiveHello>;
        liveDegraded = typeof hello.degraded === 'string' ? hello.degraded : null;
        liveEvents.emit();
      },
      changed(event) { recordLive('disk', event); },
      index(event) { recordLive('index', event); },
      degraded(event) {
        liveDegraded = typeof event === 'string' ? event : 'Live updates are degraded.';
        liveEvents.emit();
      },
      error() {
        liveConnected = false;
        liveStopped = true;
        closeLive = null;
        liveEvents.emit();
      },
    });
  },
  stop(): void {
    closeLive?.();
    closeLive = null;
    liveConnected = false;
    liveEvents.emit();
  },
  signal(kind: 'index' | 'disk', event?: unknown): void { recordLive(kind, event); },
};

export function touchesFile(path: string | null): boolean {
  if (!path || !liveLastChanged) return false;
  if (liveLastChanged.scan || liveLastChanged.truncated) return true;
  return liveLastChanged.files?.includes(path) ?? false;
}

export function liveRefresh(file: () => string | null, refresh: (reason: 'index' | 'disk') => void): () => void {
  let index = liveIndexTick;
  let disk = liveDiskTick;
  return liveEvents.subscribe(() => {
    if (index !== liveIndexTick) {
      index = liveIndexTick;
      disk = liveDiskTick;
      refresh('index');
    } else if (disk !== liveDiskTick) {
      disk = liveDiskTick;
      if (touchesFile(file())) refresh('disk');
    }
  });
}

export type RailSide = 'left' | 'right';
let hotTarget: string | null = null;
let focusedRail: RailSide = 'right';
let focusedIndex = -1;
export const hot = {
  get target(): string | null { return hotTarget; },
  is(id: string | null | undefined): boolean { return id != null && hotTarget === id; },
  set(id: string | null): void { hotTarget = id; },
  clear(id: string | null): void { if (id == null || hotTarget === id) hotTarget = null; },
};
export const railFocus = {
  get rail(): RailSide { return focusedRail; },
  get index(): number { return focusedIndex; },
  at(rail: RailSide, index: number): boolean { return rail === focusedRail && index === focusedIndex; },
  move(rail: RailSide, index: number): void { focusedRail = rail; focusedIndex = index; },
  step(delta: number, length: number): void { if (length > 0) focusedIndex = Math.max(0, Math.min(length - 1, focusedIndex + delta)); },
  switchTo(rail: RailSide): void { focusedRail = rail; if (focusedIndex < 0) focusedIndex = 0; },
  reset(): void { focusedRail = 'right'; focusedIndex = -1; },
};

export const TOAST_MS = 2_600;
const toastEvents = observable();
let toastMessage: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export const toast = {
  get message(): string | null { return toastMessage; },
  subscribe: toastEvents.subscribe,
  show(message: string): void {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage = message;
    toastEvents.emit();
    toastTimer = setTimeout(() => { toastMessage = null; toastTimer = null; toastEvents.emit(); }, TOAST_MS);
  },
  clear(): void {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    toastMessage = null;
    toastEvents.emit();
  },
};
