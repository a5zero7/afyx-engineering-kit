/**
 * AFYX Engineering Kit - Screens View Model
 *
 * Models application screens, transitions, multi-source hierarchical layering,
 * cubic Bézier edge tracking, hit-testing, and dynamic collision-avoiding pill placement.
 */

import type { WireMapLink, WireMapModule, WireScreen, WireScreenLink, WireScreensPayload } from './wire';
import { clauseWords, clauses } from './conditions';
import {
  buildMapLayout,
  linkId,
  portPoint,
  PORT_PITCH,
  type EdgeRoute,
  type MapEdgeLayout,
  type MapLayout,
  type MapNodeLayout,
} from './map-model';

/* ------------------------------------------------------------- Geometry -- */

/** Vertical distance separating screen layers. */
export const SCREEN_LAYER_GAP = 116;

const ARCH_MAX_RISE = 0.66;
const ARCH_NEST_FACTOR = 0.26;
const DEFAULT_CURVE_SAMPLES = 24;

/** Pill label metrics for typography and bounding box computations. */
export const PILL_CHAR_WIDTH = 6.3;
export const PILL_PADDING = 12;
export const PILL_HEIGHT = 17;
export const PILL_OFFSET = 13;
export const LANE_STEP = PILL_HEIGHT + 4;
const PILL_MIN_GAP_X = 4;
const BAND_CLEARANCE_MARGIN = 2;

/** Maximum text characters on an edge label pill before truncation. */
export const EDGE_LABEL_MAX = 40;

/* ---------------------------------------------------------------- Models -- */

export interface ScreenNodeInfo {
  id: string;
  label: string;
  sub: string;
  screen: WireScreen | null;
  origin: boolean;
  entry: boolean;
  unreached: boolean;
}

export interface ScreenEdgeInfo {
  id: string;
  from: string;
  to: string;
  links: WireScreenLink[];
  label: string;
  synthesized: boolean;
}

export interface ScreensModel {
  layout: MapLayout;
  nodes: Map<string, ScreenNodeInfo>;
  edges: Map<string, ScreenEdgeInfo>;
  unreached: number;
  layerGap: number;
  curves: Map<string, Curve>;
  polylines: Map<string, Point[]>;
}

export interface Point {
  x: number;
  y: number;
}

export interface Picture {
  layout: MapLayout;
  layerGap: number;
  edges: Map<string, { label: string }>;
  curves: Map<string, Curve>;
  polylines: Map<string, Point[]>;
}

/* ------------------------------------------------------------ Layering -- */

/**
 * Computes topological row layers based on transition distance from the entry screen,
 * positioning origin nodes adjacent to their targets, and partitioning unreached screens.
 */
export function entryLayering(
  entry: string | null,
  origins: readonly string[],
  links: ReadonlyArray<{ source: string; target: string }>
) {
  return (ids: string[]): Map<string, number> => {
    const activeNodes = new Set(ids);
    const forwardEdges = new Map<string, string[]>(ids.map((id) => [id, []]));
    const inDegreeMap = new Map<string, number>(ids.map((id) => [id, 0]));

    for (const link of links) {
      if (!activeNodes.has(link.source) || !activeNodes.has(link.target) || link.source === link.target) {
        continue;
      }
      forwardEdges.get(link.source)!.push(link.target);
      inDegreeMap.set(link.target, (inDegreeMap.get(link.target) ?? 0) + 1);
    }

    for (const neighbors of forwardEdges.values()) {
      neighbors.sort();
    }

    const calculatedDepth = new Map<string, number>();

    const multiSourceBfs = (sourceEntries: ReadonlyArray<[string, number]>): void => {
      const levelBuckets = new Map<number, string[]>();

      const enqueue = (id: string, dist: number): void => {
        if (calculatedDepth.has(id)) return;
        calculatedDepth.set(id, dist);
        const bucket = levelBuckets.get(dist);
        if (bucket) {
          bucket.push(id);
        } else {
          levelBuckets.set(dist, [id]);
        }
      };

      let highestStartDist = 0;
      for (const [id, startDist] of sourceEntries) {
        enqueue(id, startDist);
        highestStartDist = Math.max(highestStartDist, startDist);
      }

      const maxPossibleDepth = ids.length + highestStartDist;
      for (let d = 0; d <= maxPossibleDepth; d++) {
        const currentTier = levelBuckets.get(d);
        if (!currentTier) continue;
        for (const nodeId of currentTier) {
          for (const targetId of forwardEdges.get(nodeId) ?? []) {
            enqueue(targetId, d + 1);
          }
        }
      }
    };

    if (entry !== null && activeNodes.has(entry)) {
      multiSourceBfs([[entry, 0]]);
    }

    const originSeeds: Array<[string, number]> = [];
    const sortedOrigins = [...origins].filter((o) => activeNodes.has(o)).sort();

    for (const orig of sortedOrigins) {
      const assignedTargets = (forwardEdges.get(orig) ?? [])
        .map((t) => calculatedDepth.get(t))
        .filter((depthVal): depthVal is number => depthVal !== undefined);

      const targetMin = assignedTargets.length > 0 ? Math.min(...assignedTargets) : 0;
      originSeeds.push([orig, assignedTargets.length > 0 ? Math.max(0, targetMin - 1) : 0]);
    }
    multiSourceBfs(originSeeds);

    const maxAssignedDepth = Math.max(0, ...[...calculatedDepth.values()]);

    const unreachedIds = ids.filter((id) => !calculatedDepth.has(id));
    const unreachedDepth = new Map<string, number>();

    if (unreachedIds.length > 0) {
      const unreachedSet = new Set(unreachedIds);
      const rootCandidates = unreachedIds.filter((id) => (inDegreeMap.get(id) ?? 0) === 0);
      let wave = rootCandidates.length > 0 ? rootCandidates : [unreachedIds[0]!];

      for (const root of wave) {
        unreachedDepth.set(root, 0);
      }

      let currentTier = 0;
      while (wave.length > 0) {
        currentTier++;
        const nextWave: string[] = [];
        for (const currentId of wave) {
          for (const succ of forwardEdges.get(currentId) ?? []) {
            if (unreachedDepth.has(succ) || !unreachedSet.has(succ)) continue;
            unreachedDepth.set(succ, currentTier);
            nextWave.push(succ);
          }
        }
        wave = nextWave;
      }

      for (const id of unreachedIds) {
        if (!unreachedDepth.has(id)) {
          unreachedDepth.set(id, 0);
        }
      }
    }

    const maxUnreachedDepth = Math.max(0, ...[...unreachedDepth.values()]);
    const verticalOffset = unreachedIds.length > 0 ? maxUnreachedDepth + 2 : 0;

    const layerMap = new Map<string, number>();
    for (const [id, depth] of calculatedDepth) {
      layerMap.set(id, verticalOffset + maxAssignedDepth - depth);
    }
    for (const [id, depth] of unreachedDepth) {
      layerMap.set(id, maxUnreachedDepth - depth);
    }

    return layerMap;
  };
}

/* ------------------------------------------------------------- Labels -- */

export { clauses } from './conditions';

/**
 * Derives user-facing summary text for transitions connecting two screens.
 */
export function edgeLabel(
  links: ReadonlyArray<{ when: string; sites?: ReadonlyArray<{ when: string }> }>
): string {
  const flattenedScenarios = links.flatMap((link) =>
    link.sites && link.sites.length > 1 ? link.sites.map((s) => s.when) : [link.when]
  );

  if (flattenedScenarios.length === 1) {
    const whenPredicate = flattenedScenarios[0]!;
    if (!whenPredicate) return '';

    const conditionClauses = clauses(whenPredicate);
    const innerExpression = conditionClauses[conditionClauses.length - 1] ?? whenPredicate;
    const clauseLabel = clauseWords(innerExpression);
    const fullText = conditionClauses.length > 1 ? `…${clauseLabel}` : clauseLabel;

    return fullText.length > EDGE_LABEL_MAX ? `${fullText.slice(0, EDGE_LABEL_MAX - 1)}…` : fullText;
  }

  const conditionalScenarioCount = flattenedScenarios.filter(Boolean).length;
  return conditionalScenarioCount > 0
    ? `${flattenedScenarios.length} ways · ${conditionalScenarioCount} conditional`
    : `${flattenedScenarios.length} ways`;
}

/* -------------------------------------------------------------- Model -- */

export function buildScreensModel(payload: WireScreensPayload): ScreensModel {
  const nodes = new Map<string, ScreenNodeInfo>();
  const modules: WireMapModule[] = [];

  for (const screen of payload.screens) {
    const info: ScreenNodeInfo = {
      id: screen.id,
      label: screen.path,
      sub: screen.component?.name ?? screen.file,
      screen,
      origin: false,
      entry: payload.entry === screen.id,
      unreached: false,
    };
    nodes.set(screen.id, info);
    modules.push(createModuleDescriptor(info, screen.incoming + screen.outgoing));
  }

  for (const origin of payload.origins) {
    const info: ScreenNodeInfo = {
      id: origin.id,
      label: origin.node.kind === 'component' ? `<${origin.node.name}>` : `${origin.node.name}()`,
      sub: origin.sharedBy ? `on ${origin.sharedBy} screens` : origin.node.file,
      screen: null,
      origin: true,
      entry: false,
      unreached: false,
    };
    nodes.set(origin.id, info);
    modules.push(createModuleDescriptor(info, origin.outgoing));
  }

  const groupedTransitions = new Map<string, WireScreenLink[]>();
  for (const link of payload.links) {
    const key = linkId({ source: link.from, target: link.to });
    const list = groupedTransitions.get(key) ?? [];
    list.push(link);
    groupedTransitions.set(key, list);
  }

  const links: WireMapLink[] = [];
  const edges = new Map<string, ScreenEdgeInfo>();

  for (const [key, group] of groupedTransitions) {
    const initialLink = group[0]!;
    if (!nodes.has(initialLink.from) || !nodes.has(initialLink.to)) continue;
    if (initialLink.from === initialLink.to) continue;

    links.push({
      source: initialLink.from,
      target: initialLink.to,
      count: group.length,
      declared: group.length,
      byKind: [{ kind: 'navigates', count: group.length }],
      topPairs: [],
    });

    edges.set(key, {
      id: key,
      from: initialLink.from,
      to: initialLink.to,
      links: group,
      label: edgeLabel(group),
      synthesized: group.every((l) => l.synthesized),
    });
  }

  const originIds = payload.origins.map((o) => o.id);
  const reachableNodes = new Set<string>();

  {
    const transitionGraph = new Map<string, string[]>();
    for (const link of payload.links) {
      transitionGraph.set(link.from, [...(transitionGraph.get(link.from) ?? []), link.to]);
    }

    const traversalStack = [payload.entry, ...originIds].filter((s): s is string => s !== null);
    while (traversalStack.length > 0) {
      const current = traversalStack.pop()!;
      if (reachableNodes.has(current)) continue;
      reachableNodes.add(current);
      for (const target of transitionGraph.get(current) ?? []) {
        traversalStack.push(target);
      }
    }
  }

  let unreachedCount = 0;
  for (const info of nodes.values()) {
    if (!info.origin && !reachableNodes.has(info.id)) {
      info.unreached = true;
      unreachedCount++;
    }
  }

  const layout = buildMapLayout(
    { modules, links },
    {
      includeTests: true,
      minWeight: 0,
      sizing: (mod) => {
        const info = nodes.get(mod.id);
        return { label: info?.label ?? mod.id, meta: info?.sub ?? '' };
      },
      layering: entryLayering(payload.entry, originIds, links),
      layerGap: SCREEN_LAYER_GAP,
      portPitch: PORT_PITCH,
      ports: 'directional',
    }
  );

  const curves = trackedCurves(layout, SCREEN_LAYER_GAP);
  const polylines = new Map<string, Point[]>();
  for (const [id, curve] of curves) {
    polylines.set(id, samplePolyline(curve, DEFAULT_CURVE_SAMPLES));
  }

  return {
    layout,
    nodes,
    edges,
    unreached: unreachedCount,
    layerGap: SCREEN_LAYER_GAP,
    curves,
    polylines,
  };
}

function createModuleDescriptor(info: ScreenNodeInfo, symbols: number): WireMapModule {
  return {
    id: info.id,
    label: info.label,
    files: 1,
    symbols,
    languages: [],
    test: false,
    generated: 0,
    generatedFiles: [],
    facade: false,
    fileList: { total: 1, shown: 1, truncated: false, items: [info.screen?.file ?? info.sub] },
    dependents: { files: 0, modules: 0 },
  };
}

export function neighbourhood(
  payload: WireScreensPayload,
  id: string
): { opensFrom: WireScreenLink[]; goesTo: WireScreenLink[] } {
  return {
    opensFrom: payload.links.filter((l) => l.to === id),
    goesTo: payload.links.filter((l) => l.from === id),
  };
}

export function viaText(link: WireScreenLink): string {
  return link.via.map((v) => v.name).join(' → ');
}

export function pairId(link: WireScreenLink): string | null {
  return link.from === link.to ? null : linkId({ source: link.from, target: link.to });
}

/* --------------------------------------------------------------- Curves -- */

export interface Curve {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

export function screenCurve(
  route: EdgeRoute,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  layerGap = SCREEN_LAYER_GAP,
  track?: number
): Curve {
  if (route === 'level') {
    const archHeight = track ?? Math.round(layerGap * ARCH_MAX_RISE);
    return { x0: sx, y0: sy, x1: sx, y1: sy - archHeight, x2: tx, y2: ty - archHeight, x3: tx, y3: ty };
  }
  const midY = track ?? (sy + ty) / 2;
  return { x0: sx, y0: sy, x1: sx, y1: midY, x2: tx, y2: midY, x3: tx, y3: ty };
}

export function pathOf(c: Curve): string {
  return `M${c.x0},${c.y0} C${c.x1},${c.y1} ${c.x2},${c.y2} ${c.x3},${c.y3}`;
}

export function screenEdgePath(
  route: EdgeRoute,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  layerGap = SCREEN_LAYER_GAP
): string {
  return pathOf(screenCurve(route, sx, sy, tx, ty, layerGap));
}

/* --------------------------------------------------------------- Tracks -- */

interface FanEdgeDescriptor {
  edge: MapEdgeLayout;
  s: Point;
  t: Point;
  reach: number;
  pivotUpper: boolean;
  up: Point;
  lo: Point;
}

export function trackedCurves(layout: MapLayout, layerGap: number): Map<string, Curve> {
  const nodeLookup = new Map(layout.nodes.map((n) => [n.id, n]));
  const countPorts = (node: MapNodeLayout, side: 'top' | 'bottom'): number => node.ports[side].length;

  const fanGroups = new Map<string, FanEdgeDescriptor[]>();

  for (const edge of layout.edges) {
    const fromNode = nodeLookup.get(edge.source);
    const toNode = nodeLookup.get(edge.target);
    if (!fromNode || !toNode) continue;

    const sourcePoint = portPoint(fromNode, edge.id, 'source');
    const targetPoint = portPoint(toNode, edge.id, 'target');

    let pivotNode: MapNodeLayout;
    let anchorSide: 'top' | 'bottom';
    let oppositePoint: Point;
    let pivotUpper = true;
    let upperPoint = sourcePoint;
    let lowerPoint = targetPoint;

    if (edge.route === 'level') {
      pivotNode = countPorts(toNode, 'top') > countPorts(fromNode, 'top') ? toNode : fromNode;
      anchorSide = 'top';
      oppositePoint = pivotNode === fromNode ? targetPoint : sourcePoint;
    } else {
      const isDownEdge = edge.route === 'down';
      const upper = isDownEdge ? fromNode : toNode;
      const lower = isDownEdge ? toNode : fromNode;
      upperPoint = isDownEdge ? sourcePoint : targetPoint;
      lowerPoint = isDownEdge ? targetPoint : sourcePoint;

      pivotUpper = countPorts(upper, 'bottom') >= countPorts(lower, 'top');
      pivotNode = pivotUpper ? upper : lower;
      anchorSide = pivotUpper ? 'bottom' : 'top';
      oppositePoint = pivotUpper ? lowerPoint : upperPoint;
    }

    const pivotMidX = pivotNode.x + pivotNode.width / 2;
    const directionTag = oppositePoint.x < pivotMidX ? 'L' : 'R';
    const groupKey = `${pivotNode.id}\u0000${anchorSide}\u0000${directionTag}`;

    const memberList = fanGroups.get(groupKey) ?? [];
    memberList.push({
      edge,
      s: sourcePoint,
      t: targetPoint,
      reach: Math.abs(oppositePoint.x - pivotMidX),
      pivotUpper,
      up: upperPoint,
      lo: lowerPoint,
    });
    fanGroups.set(groupKey, memberList);
  }

  const curvesMap = new Map<string, Curve>();

  for (const groupMembers of fanGroups.values()) {
    groupMembers.sort((a, b) => b.reach - a.reach || a.edge.id.localeCompare(b.edge.id));
    const totalMembers = groupMembers.length;

    groupMembers.forEach((member, idx) => {
      const { edge, s, t } = member;
      if (edge.route === 'level') {
        const archRise = Math.round(
          layerGap * (ARCH_MAX_RISE - (ARCH_NEST_FACTOR * idx) / Math.max(1, totalMembers - 1))
        );
        curvesMap.set(edge.id, screenCurve('level', s.x, s.y, t.x, t.y, layerGap, archRise));
        return;
      }

      const fraction = (idx + 1) / (totalMembers + 1);
      const verticalSpan = Math.min(member.lo.y - member.up.y, layerGap);
      const trackCoord = member.pivotUpper ? member.up.y + verticalSpan * fraction : member.lo.y - verticalSpan * fraction;

      curvesMap.set(edge.id, screenCurve(edge.route, s.x, s.y, t.x, t.y, layerGap, trackCoord));
    });
  }

  return curvesMap;
}

/* ------------------------------------------------------------- Pointing -- */

export function samplePolyline(c: Curve, count = DEFAULT_CURVE_SAMPLES): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < count; i++) {
    result.push(pointAt(c, i / (count - 1)));
  }
  return result;
}

function pointSegmentDistance(pt: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((pt.x - start.x) * dx + (pt.y - start.y) * dy) / lengthSquared));

  const projX = start.x + t * dx - pt.x;
  const projY = start.y + t * dy - pt.y;
  return Math.sqrt(projX * projX + projY * projY);
}

export function distanceToPolyline(p: Point, line: readonly Point[]): number {
  let minDistance = Infinity;
  for (let i = 1; i < line.length; i++) {
    minDistance = Math.min(minDistance, pointSegmentDistance(p, line[i - 1]!, line[i]!));
  }
  return minDistance;
}

export interface EdgeHit {
  id: string;
  distance: number;
}

export function nearestEdge(
  model: Picture,
  point: Point,
  among: ReadonlySet<string> | null,
  reach: number
): EdgeHit | null {
  let closest: EdgeHit | null = null;

  for (const [edgeId, poly] of model.polylines) {
    if (among !== null && !among.has(edgeId)) continue;
    const dist = distanceToPolyline(point, poly);
    if (dist > reach) continue;

    if (closest === null || dist < closest.distance || (dist === closest.distance && edgeId < closest.id)) {
      closest = { id: edgeId, distance: dist };
    }
  }

  return closest;
}

export function pointAt(c: Curve, t: number): { x: number; y: number } {
  const inv = 1 - t;
  const b0 = inv * inv * inv;
  const b1 = 3 * inv * inv * t;
  const b2 = 3 * inv * t * t;
  const b3 = t * t * t;

  return {
    x: b0 * c.x0 + b1 * c.x1 + b2 * c.x2 + b3 * c.x3,
    y: b0 * c.y0 + b1 * c.y1 + b2 * c.y2 + b3 * c.y3,
  };
}

export function tAtY(c: Curve, y: number, end: 'source' | 'target'): number | null {
  const isLevelArch = c.y0 === c.y3;
  let lowerBound = isLevelArch && end === 'target' ? 0.5 : 0;
  let upperBound = isLevelArch && end === 'source' ? 0.5 : 1;

  const yAtLow = pointAt(c, lowerBound).y;
  const yAtHigh = pointAt(c, upperBound).y;

  if (y < Math.min(yAtLow, yAtHigh) - 1e-6 || y > Math.max(yAtLow, yAtHigh) + 1e-6) {
    return null;
  }

  const isAscending = yAtHigh > yAtLow;
  for (let step = 0; step < 40; step++) {
    const midPoint = (lowerBound + upperBound) / 2;
    if (pointAt(c, midPoint).y < y === isAscending) {
      lowerBound = midPoint;
    } else {
      upperBound = midPoint;
    }
  }

  return (lowerBound + upperBound) / 2;
}

/* ---------------------------------------------------------------- Pills -- */

export interface PillPlacement {
  edge: string;
  text: string;
  x: number;
  y: number;
  width: number;
  lane: number;
  end: 'source' | 'target';
}

export interface PillLayout {
  pills: Map<string, PillPlacement>;
  hidden: number;
}

export function pillWidth(text: string): number {
  return text.length * PILL_CHAR_WIDTH + PILL_PADDING;
}

export function laneCount(layerGap: number): number {
  return Math.max(
    1,
    Math.floor((layerGap - BAND_CLEARANCE_MARGIN - PILL_HEIGHT / 2 - PILL_OFFSET) / LANE_STEP) + 1
  );
}

export function pillText(info: { label: string }, edge: MapEdgeLayout, selected: string | null): string {
  if (!info.label) return '';
  const isIncoming = selected !== null && edge.target === selected && edge.source !== selected;
  return `${isIncoming ? '←' : '→'} ${info.label}`;
}

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isOverlapping(rectA: BoundingBox, rectB: BoundingBox, marginX: number): boolean {
  return (
    rectA.x < rectB.x + rectB.w + marginX &&
    rectB.x < rectA.x + rectA.w + marginX &&
    rectA.y < rectB.y + rectB.h &&
    rectB.y < rectA.y + rectA.h
  );
}

function computePillPosition(
  model: Picture,
  edge: MapEdgeLayout,
  end: 'source' | 'target',
  labelContent: string,
  nodeMap: Map<string, MapNodeLayout>,
  totalLanes: number,
  occupiedBoxes: BoundingBox[],
  canvasBounds: { width: number; height: number }
): { pill: PillPlacement; rect: BoundingBox } | null {
  const curve = model.curves.get(edge.id);
  const targetBox = nodeMap.get(end === 'source' ? edge.source : edge.target);
  if (!curve || !targetBox) return null;

  const portCoord = end === 'source' ? { x: curve.x0, y: curve.y0 } : { x: curve.x3, y: curve.y3 };
  const leavesTop = portCoord.y === targetBox.y;
  const computedWidth = pillWidth(labelContent);

  for (let laneIdx = 0; laneIdx < totalLanes; laneIdx++) {
    const laneOffset = PILL_OFFSET + laneIdx * LANE_STEP;
    const targetY = leavesTop ? portCoord.y - laneOffset : portCoord.y + laneOffset;

    const paramT = tAtY(curve, targetY, end);
    if (paramT === null) return null;

    const targetX = pointAt(curve, paramT).x;
    const bounding: BoundingBox = {
      x: targetX - computedWidth / 2,
      y: targetY - PILL_HEIGHT / 2,
      w: computedWidth,
      h: PILL_HEIGHT,
    };

    if (bounding.y < 0 || bounding.y + bounding.h > canvasBounds.height) {
      return null;
    }

    if (occupiedBoxes.some((box) => isOverlapping(box, bounding, PILL_MIN_GAP_X))) {
      continue;
    }

    return {
      pill: {
        edge: edge.id,
        text: labelContent,
        x: targetX,
        y: targetY,
        width: computedWidth,
        lane: laneIdx,
        end,
      },
      rect: bounding,
    };
  }

  return null;
}

export function placeLabels(
  model: Picture,
  selected: string | null,
  atRest: boolean | ReadonlySet<string> = false
): PillLayout {
  const resultPills = new Map<string, PillPlacement>();

  const isEligibleAtRest = (id: string): boolean =>
    atRest === true ? true : atRest !== false && atRest.has(id);

  const hasAtRestRequirement = atRest === true || (atRest !== false && atRest.size > 0);
  if (selected === null && !hasAtRestRequirement) {
    return { pills: resultPills, hidden: 0 };
  }

  const nodes = new Map(model.layout.nodes.map((n) => [n.id, n]));
  const availableLanes = laneCount(model.layerGap);
  const canvasSize = { width: model.layout.width, height: model.layout.height };
  const occupiedObstacles: BoundingBox[] = model.layout.nodes.map((n) => ({
    x: n.x,
    y: n.y,
    w: n.width,
    h: n.height,
  }));

  const candidateEdges = model.layout.edges
    .filter((edge) => isEligibleAtRest(edge.id) || edge.source === selected || edge.target === selected)
    .map((edge) => {
      const edgeEnd: 'source' | 'target' =
        selected !== null && edge.target === selected ? 'source' : 'target';
      const oppositeNode = nodes.get(edgeEnd === 'source' ? edge.source : edge.target);
      const anchorPos = oppositeNode ? portPoint(oppositeNode, edge.id, edgeEnd) : { x: 0, y: 0 };
      return { edge, end: edgeEnd, anchor: anchorPos };
    })
    .sort(
      (a, b) =>
        a.anchor.x - b.anchor.x || a.anchor.y - b.anchor.y || a.edge.id.localeCompare(b.edge.id)
    );

  let suppressedCount = 0;

  for (const { edge, end } of candidateEdges) {
    const edgeData = model.edges.get(edge.id);
    if (!edgeData) continue;

    const labelString = pillText(edgeData, edge, selected);
    if (!labelString) continue;

    const placed = computePillPosition(
      model,
      edge,
      end,
      labelString,
      nodes,
      availableLanes,
      occupiedObstacles,
      canvasSize
    );

    if (placed === null) {
      suppressedCount++;
      continue;
    }

    resultPills.set(edge.id, placed.pill);
    occupiedObstacles.push(placed.rect);
  }

  return { pills: resultPills, hidden: suppressedCount };
}

export function hoverPill(
  model: Picture,
  edgeId: string,
  selected: string | null,
  text?: string,
  avoid?: PillLayout
): PillPlacement | null {
  const edge = model.layout.edges.find((e) => e.id === edgeId);
  const info = edge ? model.edges.get(edge.id) : undefined;
  if (!edge || !info) return null;

  const contentText = text ?? pillText(info, edge, selected);
  if (!contentText) return null;

  const nodes = new Map(model.layout.nodes.map((n) => [n.id, n]));
  const edgeEnd: 'source' | 'target' =
    selected !== null && edge.target === selected && edge.source !== selected ? 'source' : 'target';

  const canvasBounds = { width: model.layout.width, height: model.layout.height };
  const obstacles: BoundingBox[] = model.layout.nodes.map((n) => ({
    x: n.x,
    y: n.y,
    w: n.width,
    h: n.height,
  }));

  for (const pill of avoid?.pills.values() ?? []) {
    if (pill.edge === edgeId) continue;
    obstacles.push({
      x: pill.x - pill.width / 2,
      y: pill.y - PILL_HEIGHT / 2,
      w: pill.width,
      h: PILL_HEIGHT,
    });
  }

  const placed = computePillPosition(
    model,
    edge,
    edgeEnd,
    contentText,
    nodes,
    laneCount(model.layerGap),
    obstacles,
    canvasBounds
  );

  if (placed !== null) return placed.pill;

  const fallback = computePillPosition(model, edge, edgeEnd, contentText, nodes, 1, [], canvasBounds);
  return fallback !== null ? fallback.pill : null;
}
