/**
 * AFYX Engineering Kit - Steps View Layout Model
 *
 * Implements deterministic hierarchical, region-clustered, and tree-structured
 * execution step topologies, decision fork labeling, edge visibility filtering,
 * stub representations, and hit-testing data structures.
 */

import { whenWords } from './conditions';
import type {
  WireMapLink,
  WireMapModule,
  WireStep,
  WireStepDecision,
  WireStepLink,
  WireStepTrigger,
  WireStepsPayload,
} from './wire';
import {
  buildMapLayout,
  linkId,
  nodeWidth,
  strokeWidthFor,
  NODE_GAP,
  NODE_HEIGHT,
  PADDING,
  PORT_PITCH,
  type EdgeRoute,
  type MapEdgeLayout,
  type MapLayout,
  type MapNodeLayout,
  type PortRef,
} from './map-model';
import {
  edgeLabel,
  samplePolyline,
  trackedCurves,
  SCREEN_LAYER_GAP,
  type Curve,
  type Picture,
  type Point,
} from './screens-model';

/* ------------------------------------------------------------- Interfaces -- */

export interface StepNodeInfo {
  id: string;
  step: WireStep;
  label: string;
  sub: string;
}

export interface StepEdgeInfo {
  id: string;
  from: string;
  to: string;
  links: WireStepLink[];
  label: string;
  synthesized: boolean;
  kind: WireStepLink['kind'];
  arm?: string;
}

export interface StepDecision {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
}

export interface StepsModel extends Picture {
  layout: MapLayout;
  nodes: Map<string, StepNodeInfo>;
  edges: Map<string, StepEdgeInfo>;
  layerGap: number;
  curves: Map<string, Curve>;
  polylines: Map<string, Point[]>;
  counts: Record<WireStep['kind'], number>;
  regions: StepRegionZone[] | null;
  regionEntries: ReadonlySet<string> | null;
  forks: Map<string, StepForkInfo> | null;
  decisions: StepDecision[];
  stubs: Map<string, StepStub[]>;
  stubbed: ReadonlySet<string>;
}

export interface StepForkInfo {
  id: string;
  on: string;
  form: 'if' | 'switch' | 'ternary' | 'try';
  label: string;
}

export interface StepStub {
  edge: string;
  other: string;
  label: string;
  dir: 'out' | 'in';
}

export interface StepRegionZone {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  entry: string;
}

const DEFAULT_SAMPLE_COUNT = 24;

/* ---------------------------------------------------------------- Words -- */

export type ProjectKind = WireStepsPayload['project'];

export function kindWord(kind: WireStep['kind'], project: ProjectKind = 'app', step?: WireStep): string {
  return kindWords(kind, project, step)[0];
}

export function kindWords(kind: WireStep['kind'], project: ProjectKind = 'app', step?: WireStep): [string, string] {
  switch (kind) {
    case 'screen':
      if (step?.screen?.endpoint) return ['endpoint', 'endpoints'];
      return project === 'api' ? ['endpoint', 'endpoints'] : project === 'web' ? ['page', 'pages'] : ['screen', 'screens'];
    case 'trigger':
      return ['handler', 'handlers'];
    case 'bridge':
      if (step?.screen?.endpoint) return ['call to the server', 'calls to the server'];
      return project === 'app'
        ? ['native call', 'native calls']
        : project === 'web'
          ? ['call to the server', 'calls to the server']
          : ['call to another tier', 'calls to another tier'];
    case 'event':
      return project === 'app'
        ? ['native event', 'native events']
        : project === 'web'
          ? ['arrives from the server', 'arrive from the server']
          : ['arrives from a queue or bus', 'arrive from a queue or bus'];
    case 'store':
      return project === 'api' ? ['data call', 'data calls'] : ['store action', 'store actions'];
    case 'effect':
      return ['outside the index', 'outside the index'];
    default:
      return ['start', 'start'];
  }
}

export function countWords(n: number, kind: WireStep['kind'], project: ProjectKind = 'app'): string {
  const [singleWord, pluralWord] = kindWords(kind, project);
  return `${n} ${n === 1 ? singleWord : pluralWord}`;
}

export function triggerWords(t: WireStepTrigger): string {
  const afterSuffix = t.after && t.after.length > 0 ? ` · after ${t.after.join(', ')}` : '';
  switch (t.kind) {
    case 'prop':
      return t.of ? `${t.name} · <${t.of}>` : t.name;
    case 'option':
      return t.of ? `${t.name} · ${t.of}(…)` : t.name;
    case 'request':
      return `${t.name} ${t.of ?? ''}`.trim() + afterSuffix;
    case 'decorator':
      return `@${t.name}(${t.of ?? ''})` + afterSuffix;
    case 'load':
      return `page load · ${t.of ?? t.name}` + afterSuffix;
    default:
      return t.of ? `${t.name}(${t.of})` : t.name;
  }
}

export function stepLabel(step: WireStep): string {
  switch (step.kind) {
    case 'bridge':
      return `⇢ ${step.label}`;
    case 'event': {
      const eventList = step.events ?? (step.event ? [step.event] : []);
      if (eventList.length === 0) return `⇠ ${step.label}`;
      return eventList.length === 1 ? `⇠ ${eventList[0]}` : `⇠ ${eventList[0]} +${eventList.length - 1}`;
    }
    default:
      return step.label;
  }
}

export function stepSub(step: WireStep, project: ProjectKind = 'app'): string {
  const filename = step.node ? step.node.file.slice(step.node.file.lastIndexOf('/') + 1) : '';
  switch (step.kind) {
    case 'screen':
      return step.sub;
    case 'trigger':
      return step.trigger ? `${triggerWords(step.trigger)} · ${filename}` : `handler · ${filename}`;
    case 'bridge':
      if (step.screen) return step.sub;
      return `${project === 'app' ? 'native' : project === 'web' ? 'server' : 'another tier'} · ${filename}`;
    case 'event':
      return `${step.label} · ${filename}`;
    case 'store':
      return `${project === 'api' ? 'data' : 'store'} · ${filename}`;
    case 'effect':
      return step.sub;
    default:
      return step.node && step.sub === step.node.file ? filename : step.sub;
  }
}

/* ----------------------------------------------------------- Decisions -- */

const MAX_ARM_LABEL_LEN = 24;
const DECISION_ROW_HEIGHT = 15;
const DECISION_FONT_ADVANCE = 6.3;
const DECISION_CONTAINER_MAX_WIDTH = 320;

export function armWords(d: { on: string; arm: string; form: 'if' | 'switch' | 'ternary' | 'try'; not?: true }): string {
  if (d.form === 'if' || d.form === 'ternary') {
    return d.not ? 'no' : 'yes';
  }
  if (d.not) return 'else';
  let expr = d.arm;
  if (d.on && expr.startsWith(d.on)) {
    expr = expr.slice(d.on.length).trim().replace(/^===?\s*/, '');
  }
  if (!expr) return 'yes';
  return expr.length > MAX_ARM_LABEL_LEN ? `${expr.slice(0, MAX_ARM_LABEL_LEN - 1)}…` : expr;
}

function resolveUniformEdgeArm(info: StepEdgeInfo): WireStepDecision | null {
  let matchedDecision: WireStepDecision | null = null;
  for (const link of info.links) {
    for (const site of link.sites) {
      if (!site.decision) return null;
      if (matchedDecision === null) {
        matchedDecision = site.decision;
      } else if (
        matchedDecision.branch !== site.decision.branch ||
        matchedDecision.arm !== site.decision.arm
      ) {
        return null;
      }
    }
  }
  return matchedDecision;
}

function markDecisions(edges: Map<string, StepEdgeInfo>, layout: MapLayout): StepDecision[] {
  const branchGroups = new Map<string, Array<{ info: StepEdgeInfo; decision: WireStepDecision }>>();

  for (const edgeInfo of edges.values()) {
    const decision = resolveUniformEdgeArm(edgeInfo);
    if (decision === null) continue;

    const groupKey = `${edgeInfo.from}\u0000${decision.branch}`;
    const list = branchGroups.get(groupKey) ?? [];
    list.push({ info: edgeInfo, decision });
    branchGroups.set(groupKey, list);
  }

  const nodeMap = new Map(layout.nodes.map((n) => [n.id, n]));
  const decisionList: StepDecision[] = [];
  const nodeDecisionCount = new Map<string, number>();

  for (const [key, group] of branchGroups) {
    const distinctArms = new Set(group.map((g) => g.decision.arm));
    if (distinctArms.size < 2) continue;

    const originNode = nodeMap.get(group[0]!.info.from);
    if (!originNode) continue;

    for (const { info, decision } of group) {
      info.arm = armWords(decision);
      info.label = info.arm;
    }

    const orderIndex = nodeDecisionCount.get(originNode.id) ?? 0;
    nodeDecisionCount.set(originNode.id, orderIndex + 1);

    const conditionSubject = group[0]!.decision.on;
    const captionText = `${whenWords(conditionSubject) || conditionSubject}?`;
    const boxWidth = Math.max(
      originNode.width,
      Math.min(captionText.length * DECISION_FONT_ADVANCE + 8, DECISION_CONTAINER_MAX_WIDTH)
    );

    decisionList.push({
      id: key,
      label: captionText,
      x: originNode.x + (originNode.width - boxWidth) / 2,
      y: originNode.y + originNode.height + 4 + orderIndex * DECISION_ROW_HEIGHT,
      width: boxWidth,
    });
  }

  return decisionList;
}

/* ------------------------------------------------------------- Build -- */

export function buildStepsModel(payload: WireStepsPayload): StepsModel {
  const nodes = new Map<string, StepNodeInfo>();
  const modules: WireMapModule[] = [];
  const counts: Record<WireStep['kind'], number> = {
    anchor: 0,
    screen: 0,
    trigger: 0,
    bridge: 0,
    event: 0,
    store: 0,
    effect: 0,
  };

  const nodeDegree = new Map<string, number>();
  for (const link of payload.links) {
    nodeDegree.set(link.from, (nodeDegree.get(link.from) ?? 0) + 1);
    nodeDegree.set(link.to, (nodeDegree.get(link.to) ?? 0) + 1);
  }

  for (const step of payload.steps) {
    counts[step.kind]++;
    const info: StepNodeInfo = {
      id: step.id,
      step,
      label: stepLabel(step),
      sub: stepSub(step, payload.project),
    };
    nodes.set(step.id, info);
    modules.push({
      id: step.id,
      label: info.label,
      files: 1,
      symbols: nodeDegree.get(step.id) ?? 0,
      languages: [],
      test: false,
      generated: 0,
      generatedFiles: [],
      facade: false,
      fileList: { total: 1, shown: 1, truncated: false, items: [step.node?.file ?? step.sub] },
      dependents: { files: 0, modules: 0 },
    });
  }

  const groupedLinks = new Map<string, WireStepLink[]>();
  for (const link of payload.links) {
    if (!nodes.has(link.from) || !nodes.has(link.to) || link.from === link.to) continue;
    const pairKey = linkId({ source: link.from, target: link.to });
    const list = groupedLinks.get(pairKey) ?? [];
    list.push(link);
    groupedLinks.set(pairKey, list);
  }

  const layoutLinks: WireMapLink[] = [];
  const edgeInfoMap = new Map<string, StepEdgeInfo>();

  for (const [key, group] of groupedLinks) {
    const headLink = group[0]!;
    layoutLinks.push({
      source: headLink.from,
      target: headLink.to,
      count: group.length,
      declared: group.length,
      byKind: [{ kind: 'calls', count: group.length }],
      topPairs: [],
    });

    const singleHandlerTrigger =
      group.length === 1 && headLink.kind === 'handler' && headLink.trigger ? headLink.trigger : null;

    edgeInfoMap.set(key, {
      id: key,
      from: headLink.from,
      to: headLink.to,
      links: group,
      label: singleHandlerTrigger ? triggerWords(singleHandlerTrigger) : edgeLabel(group),
      synthesized: group.every((l) => l.synthesized),
      kind: group.every((l) => l.kind === headLink.kind) ? headLink.kind : 'calls',
    });
  }

  const hasRegions = payload.steps.some((s) => s.region !== undefined);
  let layout: MapLayout;
  let zones: StepRegionZone[] | null = null;

  if (hasRegions) {
    const packed = packRegions(payload.steps, nodes, modules, layoutLinks);
    layout = packed.layout;
    zones = packed.zones;
  } else {
    const stepDepthMap = new Map(payload.steps.map((s) => [s.id, s.depth]));
    const maxDepth = Math.max(0, ...payload.steps.map((s) => s.depth));

    const computeLayering = (ids: string[]): Map<string, number> =>
      new Map(ids.map((id) => [id, maxDepth - (stepDepthMap.get(id) ?? maxDepth)]));

    layout = buildMapLayout(
      { modules, links: layoutLinks },
      {
        includeTests: true,
        minWeight: 0,
        sizing: (mod) => {
          const info = nodes.get(mod.id);
          const cutMarker = info?.step.cut != null ? ' …' : '';
          const anchorBullet = info?.step.anchor ? '● ' : '';
          return { label: anchorBullet + (info?.label ?? mod.id) + cutMarker, meta: info?.sub ?? '' };
        },
        layering: computeLayering,
        order: (id) => nodes.get(id)?.step.order ?? Number.MAX_SAFE_INTEGER,
        layerGap: SCREEN_LAYER_GAP,
        portPitch: PORT_PITCH,
        ports: 'directional',
      }
    );
  }

  const effectiveLayerGap = hasRegions ? REGION_GAP_Y : SCREEN_LAYER_GAP;
  const curves = trackedCurves(layout, effectiveLayerGap);
  const polylines = new Map<string, Point[]>();
  for (const [id, curve] of curves) {
    polylines.set(id, samplePolyline(curve, DEFAULT_SAMPLE_COUNT));
  }

  const regionEntries = zones === null ? null : new Set(zones.map((z) => z.entry));
  const { stubs, stubbed } = packStubs(layout, nodes, effectiveLayerGap, regionEntries);

  return {
    layout,
    nodes,
    edges: edgeInfoMap,
    layerGap: effectiveLayerGap,
    curves,
    polylines,
    counts,
    regions: zones,
    regionEntries,
    forks: null,
    stubs,
    stubbed,
    decisions: markDecisions(edgeInfoMap, layout),
  };
}

/* ------------------------------------------------------------- Stubs -- */

const STUB_SPAN_LINES = 3;

function stripStubPrefix(label: string): string {
  return label.startsWith('⇢ ') || label.startsWith('⇠ ') ? label.slice(2) : label;
}

function packStubs(
  layout: MapLayout,
  infos: Map<string, StepNodeInfo>,
  layerGap: number,
  entries: ReadonlySet<string> | null
): { stubs: Map<string, StepStub[]>; stubbed: ReadonlySet<string> } {
  const stubs = new Map<string, StepStub[]>();
  const stubbed = new Set<string>();
  const nodeLookup = new Map(layout.nodes.map((n) => [n.id, n]));
  const verticalPitch = NODE_HEIGHT + layerGap;

  const appendStub = (id: string, item: StepStub): void => {
    stubs.set(id, [...(stubs.get(id) ?? []), item]);
  };

  for (const edge of layout.edges) {
    const fromNode = nodeLookup.get(edge.source);
    const toNode = nodeLookup.get(edge.target);
    if (!fromNode || !toNode) continue;

    if (entries !== null && infos.get(edge.source)?.step.anchor && !entries.has(edge.target)) {
      continue;
    }

    const lineDistance = Math.abs(toNode.y - fromNode.y) / verticalPitch;
    const horizontalDistance = Math.abs(toNode.x + toNode.width / 2 - (fromNode.x + fromNode.width / 2));

    const isClose = !edge.back && !edge.thin && lineDistance <= STUB_SPAN_LINES + 0.01 && horizontalDistance <= REGION_LINE_MIN;
    if (isClose) continue;

    stubbed.add(edge.id);
    appendStub(edge.source, {
      edge: edge.id,
      other: edge.target,
      label: stripStubPrefix(infos.get(edge.target)?.label ?? edge.target),
      dir: 'out',
    });
    appendStub(edge.target, {
      edge: edge.id,
      other: edge.source,
      label: stripStubPrefix(infos.get(edge.source)?.label ?? edge.source),
      dir: 'in',
    });
  }

  const computeLocationRank = (id: string): number => {
    const node = nodeLookup.get(id);
    return node ? node.y * 100000 + node.x : 0;
  };

  for (const stubList of stubs.values()) {
    stubList.sort((a, b) => {
      if (a.dir === b.dir) {
        return computeLocationRank(a.other) - computeLocationRank(b.other);
      }
      return a.dir === 'out' ? -1 : 1;
    });
  }

  return { stubs, stubbed };
}

/* ------------------------------------------------------------ Regions -- */

const REGION_GAP_Y = 72;
const REGION_PITCH = NODE_HEIGHT + REGION_GAP_Y;
const REGION_LINE_MIN = 720;
const REGION_WIDTHS = [REGION_LINE_MIN, 1000, 1300, 1600, 1900, 2200, 2600, 3000];
const CANVAS_ASPECT_TARGET = 1.4;

function evaluateCanvasAspectCost(dimensions: { width: number; height: number }): number {
  return Math.abs(Math.log(Math.max(1, dimensions.width) / Math.max(1, dimensions.height) / CANVAS_ASPECT_TARGET));
}

const CLUSTER_INDENT = 26;
const CLUSTER_DEPTH_MAX = 6;
const REGION_GUTTER = 72;
const BAND_GAP = 84;

function calculateBandWidthBudget(totalArea: number, maxItemWidth: number): number {
  return Math.max(maxItemWidth, Math.min(3400, Math.max(1440, Math.ceil(Math.sqrt(totalArea * 2.4)))));
}

function filterAcyclicMapLinks(links: readonly WireMapLink[]): WireMapLink[] {
  const outgoingMap = new Map<string, WireMapLink[]>();
  const activeIds = new Set<string>();

  for (const l of links) {
    activeIds.add(l.source);
    activeIds.add(l.target);
    const list = outgoingMap.get(l.source);
    if (list) {
      list.push(l);
    } else {
      outgoingMap.set(l.source, [l]);
    }
  }

  const visitStates = new Map<string, number>();
  const cyclicEdges = new Set<WireMapLink>();

  const traverseDfs = (startId: string): void => {
    const stack: Array<{ id: string; edgeIdx: number }> = [{ id: startId, edgeIdx: 0 }];
    visitStates.set(startId, 1);

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const edges = outgoingMap.get(top.id) ?? [];

      if (top.edgeIdx >= edges.length) {
        visitStates.set(top.id, 2);
        stack.pop();
        continue;
      }

      const nextEdge = edges[top.edgeIdx++]!;
      const targetState = visitStates.get(nextEdge.target) ?? 0;

      if (targetState === 1) {
        cyclicEdges.add(nextEdge);
        continue;
      }
      if (targetState === 2) continue;

      visitStates.set(nextEdge.target, 1);
      stack.push({ id: nextEdge.target, edgeIdx: 0 });
    }
  };

  for (const id of activeIds) {
    if (!visitStates.has(id)) {
      traverseDfs(id);
    }
  }

  return links.filter((l) => !cyclicEdges.has(l));
}

function packRegions(
  steps: WireStep[],
  infos: Map<string, StepNodeInfo>,
  modules: WireMapModule[],
  links: WireMapLink[]
): { layout: MapLayout; zones: StepRegionZone[] } {
  const anchorStep = steps.find((s) => s.anchor)!;
  const nonAnchorSteps = steps.filter((s) => !s.anchor);
  const moduleLookup = new Map(modules.map((m) => [m.id, m]));

  const linkDegrees = new Map<string, number>();
  for (const l of links) {
    linkDegrees.set(l.source, (linkDegrees.get(l.source) ?? 0) + 1);
    linkDegrees.set(l.target, (linkDegrees.get(l.target) ?? 0) + 1);
  }

  const getNodeWidth = (id: string): number => {
    const info = infos.get(id);
    const cutSuffix = info?.step.cut != null ? ' …' : '';
    const anchorMarker = info?.step.anchor ? '● ' : '';
    return Math.max(
      nodeWidth(anchorMarker + (info?.label ?? id) + cutSuffix, info?.sub ?? ''),
      ((linkDegrees.get(id) ?? 0) + 1) * PORT_PITCH
    );
  };

  interface RegionGroup {
    id: string;
    label: string;
    members: WireStep[];
  }

  const regionGroups = new Map<string, RegionGroup>();
  for (const s of nonAnchorSteps) {
    const regId = s.region?.id ?? anchorStep.id;
    const reg = regionGroups.get(regId) ?? {
      id: regId,
      label: s.region?.label ?? anchorStep.label,
      members: [],
    };
    reg.members.push(s);
    regionGroups.set(regId, reg);
  }

  const stepRegionMap = new Map(nonAnchorSteps.map((s) => [s.id, s.region?.id ?? anchorStep.id]));
  const intraRegionLinks = links.filter(
    (l) =>
      l.source !== anchorStep.id &&
      l.target !== anchorStep.id &&
      l.source !== l.target &&
      stepRegionMap.get(l.source) === stepRegionMap.get(l.target)
  );

  const directAnchorTargets = new Set(links.filter((l) => l.source === anchorStep.id).map((l) => l.target));
  const intraParents = new Map<string, string[]>();

  for (const link of filterAcyclicMapLinks(intraRegionLinks)) {
    const list = intraParents.get(link.target) ?? [];
    list.push(link.source);
    intraParents.set(link.target, list);
  }

  const intraChildren = new Map<string, string[]>();
  {
    const stepOrderLookup = new Map(nonAnchorSteps.map((s) => [s.id, s.order ?? Number.MAX_SAFE_INTEGER]));
    const outgoingAdjacency = new Map<string, string[]>();

    for (const l of filterAcyclicMapLinks(intraRegionLinks)) {
      outgoingAdjacency.set(l.source, [...(outgoingAdjacency.get(l.source) ?? []), l.target]);
    }

    const assignedNodes = new Set<string>();
    const rootQueue = nonAnchorSteps
      .filter((s) => (intraParents.get(s.id) ?? []).length === 0)
      .map((s) => s.id);

    for (const rId of rootQueue) {
      assignedNodes.add(rId);
    }

    while (rootQueue.length > 0) {
      const current = rootQueue.shift()!;
      const neighbors = [...new Set(outgoingAdjacency.get(current) ?? [])].sort(
        (a, b) =>
          (stepOrderLookup.get(a) ?? 0) - (stepOrderLookup.get(b) ?? 0) || a.localeCompare(b)
      );

      for (const neighbor of neighbors) {
        if (assignedNodes.has(neighbor)) continue;
        assignedNodes.add(neighbor);
        intraChildren.set(current, [...(intraChildren.get(current) ?? []), neighbor]);
        rootQueue.push(neighbor);
      }
    }
  }

  interface PackedRegionResult {
    pos: Map<string, { x: number; line: number }>;
    lines: number;
    width: number;
    entry: string;
  }

  const anchorOriginY = PADDING;

  const solveRegionLayoutAtWidth = (maxLineWidth: number) => {
    const packedRegions = new Map<string, PackedRegionResult>();

    for (const reg of regionGroups.values()) {
      const regionMembersSet = new Set(reg.members.map((m) => m.id));
      const getRegionChildren = (nodeId: string): string[] =>
        (intraChildren.get(nodeId) ?? []).filter((childId) => regionMembersSet.has(childId));

      const regionRootIds = reg.members
        .filter((m) => (intraParents.get(m.id) ?? []).length === 0)
        .map((m) => m.id);

      const arrangeRegionAtLineWidth = (
        limitWidth: number
      ): { pos: Map<string, { x: number; line: number }>; lines: number; width: number } => {
        const layoutCluster = (
          clusterRootId: string
        ): { pos: Map<string, { x: number; line: number }>; lines: number; width: number } => {
          const positions = new Map<string, { x: number; line: number }>();
          let currentLine = 0;
          let calculatedWidth = 0;

          const distributeLeafNodes = (leafList: string[], startX: number): void => {
            if (leafList.length === 0) return;
            let currentX = startX;
            for (const leafId of leafList) {
              const nodeW = getNodeWidth(leafId);
              if (currentX > startX && currentX + nodeW - startX > limitWidth) {
                currentLine += 1;
                currentX = startX;
              }
              positions.set(leafId, { x: currentX, line: currentLine });
              calculatedWidth = Math.max(calculatedWidth, currentX + nodeW);
              currentX += nodeW + NODE_GAP;
            }
            currentLine += 1;
          };

          const placeSubtree = (nodeId: string, depthLevel: number): void => {
            const xOffset = Math.min(depthLevel, CLUSTER_DEPTH_MAX) * CLUSTER_INDENT;
            positions.set(nodeId, { x: xOffset, line: currentLine });
            calculatedWidth = Math.max(calculatedWidth, xOffset + getNodeWidth(nodeId));
            currentLine += 1;

            const children = getRegionChildren(nodeId);
            const leaves = children.filter((c) => getRegionChildren(c).length === 0);
            const nonLeaves = children.filter((c) => getRegionChildren(c).length > 0);

            distributeLeafNodes(leaves, xOffset + CLUSTER_INDENT);
            for (const branchId of nonLeaves) {
              placeSubtree(branchId, depthLevel + 1);
            }
          };

          placeSubtree(clusterRootId, 0);
          return { pos: positions, lines: currentLine, width: calculatedWidth };
        };

        const distributeFlatNodes = (
          flatIds: string[]
        ): { pos: Map<string, { x: number; line: number }>; lines: number; width: number } => {
          const positions = new Map<string, { x: number; line: number }>();
          let currentLine = 0;
          let calculatedWidth = 0;
          let currentX = 0;

          for (const flatId of flatIds) {
            const nodeW = getNodeWidth(flatId);
            if (currentX > 0 && currentX + nodeW > limitWidth) {
              currentLine += 1;
              currentX = 0;
            }
            positions.set(flatId, { x: currentX, line: currentLine });
            calculatedWidth = Math.max(calculatedWidth, currentX + nodeW);
            currentX += nodeW + NODE_GAP;
          }

          return { pos: positions, lines: flatIds.length === 0 ? 0 : currentLine + 1, width: calculatedWidth };
        };

        const blockUnits: Array<{ pos: Map<string, { x: number; line: number }>; lines: number; width: number }> = [];
        const orphanRoots = regionRootIds.filter((id) => getRegionChildren(id).length === 0);
        if (orphanRoots.length > 0) {
          blockUnits.push(distributeFlatNodes(orphanRoots));
        }

        const accountedNodes = new Set(orphanRoots);
        for (const rootId of regionRootIds) {
          if (accountedNodes.has(rootId)) continue;
          const clusterResult = layoutCluster(rootId);
          for (const key of clusterResult.pos.keys()) {
            accountedNodes.add(key);
          }
          blockUnits.push(clusterResult);
        }

        for (const member of reg.members) {
          if (accountedNodes.has(member.id)) continue;
          const standaloneResult = layoutCluster(member.id);
          for (const key of standaloneResult.pos.keys()) {
            accountedNodes.add(key);
          }
          blockUnits.push(standaloneResult);
        }

        const combinedPositions = new Map<string, { x: number; line: number }>();
        let maxWidth = 0;
        let cumulativeLines = 0;

        for (const block of blockUnits) {
          for (const [id, coord] of block.pos) {
            combinedPositions.set(id, { x: coord.x, line: cumulativeLines + coord.line });
          }
          maxWidth = Math.max(maxWidth, block.width);
          cumulativeLines += block.lines;
        }

        return { pos: combinedPositions, lines: cumulativeLines, width: maxWidth };
      };

      const { pos, lines: totalLines, width: regWidth } = arrangeRegionAtLineWidth(maxLineWidth);

      const findTopmostInRegion = (candidateIds: string[]): string | null =>
        candidateIds
          .filter((id) => pos.has(id))
          .sort((a, b) => pos.get(a)!.line - pos.get(b)!.line || pos.get(a)!.x - pos.get(b)!.x)[0] ?? null;

      const regionEntryId =
        findTopmostInRegion(reg.members.filter((m) => directAnchorTargets.has(m.id)).map((m) => m.id)) ??
        findTopmostInRegion(reg.members.map((m) => m.id)) ??
        reg.members[0]!.id;

      packedRegions.set(reg.id, {
        pos,
        lines: totalLines,
        width: regWidth,
        entry: regionEntryId,
      });
    }

    let accumulatedArea = 0;
    let broadestRegion = 0;

    for (const reg of regionGroups.values()) {
      const p = packedRegions.get(reg.id)!;
      accumulatedArea += p.width * p.lines * REGION_PITCH;
      broadestRegion = Math.max(broadestRegion, p.width);
    }

    const bandBudget = calculateBandWidthBudget(accumulatedArea, broadestRegion);
    const nodePlacements = new Map<string, { x: number; y: number; line: number }>();
    const zoneList: StepRegionZone[] = [];
    const baselineTopY = anchorOriginY + NODE_HEIGHT + SCREEN_LAYER_GAP + BAND_GAP;
    const horizonSkyline: Array<{ x0: number; x1: number; y: number }> = [];

    const getHorizonFloor = (x0: number, x1: number): number => {
      let floorY = baselineTopY;
      for (const seg of horizonSkyline) {
        if (seg.x1 > x0 + 1 && seg.x0 < x1 - 1) {
          floorY = Math.max(floorY, seg.y);
        }
      }
      return floorY;
    };

    for (const reg of regionGroups.values()) {
      const packed = packedRegions.get(reg.id)!;
      const regionH = Math.max(0, packed.lines - 1) * REGION_PITCH + NODE_HEIGHT;

      const candidatePlacements = [PADDING, ...horizonSkyline.map((s) => s.x1 + REGION_GUTTER)]
        .filter((xVal, idx, arr) => arr.indexOf(xVal) === idx && xVal + packed.width <= PADDING + Math.max(bandBudget, packed.width))
        .sort((a, b) => a - b);

      let bestSpot = { x: PADDING, y: getHorizonFloor(PADDING, PADDING + packed.width) };
      for (const cX of candidatePlacements) {
        const floorY = getHorizonFloor(cX, cX + packed.width);
        if (floorY < bestSpot.y - 1) {
          bestSpot = { x: cX, y: floorY };
        }
      }

      const { x: posX, y: posY } = bestSpot;
      for (const [id, coord] of packed.pos) {
        nodePlacements.set(id, { x: posX + coord.x, y: posY + coord.line * REGION_PITCH, line: 0 });
      }

      zoneList.push({
        id: reg.id,
        label: reg.label,
        x: posX,
        y: posY,
        width: packed.width,
        height: regionH,
        entry: packed.entry,
      });

      horizonSkyline.push({ x0: posX, x1: posX + packed.width, y: posY + regionH + BAND_GAP });
    }

    const maxCanvasContentWidth = Math.max(
      getNodeWidth(anchorStep.id),
      ...zoneList.map((z) => z.x + z.width - PADDING)
    );

    for (const placeRecord of nodePlacements.values()) {
      placeRecord.line = Math.round((placeRecord.y - baselineTopY) / REGION_PITCH);
    }

    const maxGlobalLine = Math.max(0, ...[...nodePlacements.values()].map((v) => v.line)) + 1;
    const canvasHeight = Math.max(anchorOriginY + NODE_HEIGHT, ...zoneList.map((z) => z.y + z.height)) + PADDING;

    return {
      at: nodePlacements,
      zones: zoneList,
      contentWidth: maxCanvasContentWidth,
      globalLine: maxGlobalLine,
      height: canvasHeight,
      width: maxCanvasContentWidth + PADDING * 2,
    };
  };

  const layoutAttempts = REGION_WIDTHS.map((widthLimit) => solveRegionLayoutAtWidth(widthLimit));
  const optimalLayout = layoutAttempts.reduce((bestAttempt, currentAttempt) =>
    evaluateCanvasAspectCost(bestAttempt) <= evaluateCanvasAspectCost(currentAttempt)
      ? bestAttempt
      : currentAttempt
  );

  const { at: resolvedNodeCoords, zones: finalZones, contentWidth: finalContentWidth, globalLine: finalGlobalLine, height: finalHeight } = optimalLayout;

  const determineNodeLayer = (id: string): number =>
    id === anchorStep.id
      ? finalGlobalLine + 1
      : finalGlobalLine - (resolvedNodeCoords.get(id)?.line ?? 0);

  const mapNodesById = new Map<string, MapNodeLayout>();
  const addLayoutNode = (id: string, xPos: number, yPos: number): void => {
    mapNodesById.set(id, {
      id,
      module: moduleLookup.get(id)!,
      island: false,
      generated: false,
      weight: 0,
      layer: determineNodeLayer(id),
      x: xPos,
      y: yPos,
      width: getNodeWidth(id),
      height: NODE_HEIGHT,
      sourceHandles: [],
      targetHandles: [],
      ports: { top: [], bottom: [] },
    });
  };

  addLayoutNode(anchorStep.id, PADDING + (finalContentWidth - getNodeWidth(anchorStep.id)) / 2, anchorOriginY);
  for (const [id, coord] of resolvedNodeCoords) {
    addLayoutNode(id, coord.x, coord.y);
  }

  const generatedEdgeLayouts: MapEdgeLayout[] = [];
  interface EdgeSidePort extends PortRef {
    other: number;
  }
  const nodePortRegistry = new Map<string, { top: EdgeSidePort[]; bottom: EdgeSidePort[] }>();

  const getNodeMidX = (id: string): number => {
    const n = mapNodesById.get(id);
    return n ? n.x + n.width / 2 : 0;
  };

  for (const link of links) {
    const fromNode = mapNodesById.get(link.source);
    const toNode = mapNodesById.get(link.target);
    if (!fromNode || !toNode) continue;

    const edgeId = linkId(link);
    const edgeRouteType: EdgeRoute =
      fromNode.layer > toNode.layer ? 'down' : fromNode.layer < toNode.layer ? 'up' : 'level';

    generatedEdgeLayouts.push({
      id: edgeId,
      source: link.source,
      target: link.target,
      sourceHandle: `s:${edgeId}`,
      targetHandle: `t:${edgeId}`,
      link,
      width: strokeWidthFor(link.count),
      back: fromNode.layer <= toNode.layer,
      thin: false,
      route: edgeRouteType,
    });

    const routeSides =
      edgeRouteType === 'down'
        ? { source: 'bottom' as const, target: 'top' as const }
        : edgeRouteType === 'up'
          ? { source: 'top' as const, target: 'bottom' as const }
          : { source: 'top' as const, target: 'top' as const };

    const getPortContainer = (nodeId: string): { top: EdgeSidePort[]; bottom: EdgeSidePort[] } => {
      const existing = nodePortRegistry.get(nodeId) ?? { top: [], bottom: [] };
      nodePortRegistry.set(nodeId, existing);
      return existing;
    };

    getPortContainer(link.source)[routeSides.source].push({
      id: edgeId,
      type: 'source',
      other: getNodeMidX(link.target),
    });
    getPortContainer(link.target)[routeSides.target].push({
      id: edgeId,
      type: 'target',
      other: getNodeMidX(link.source),
    });
  }

  const comparePortPositions = (p1: EdgeSidePort, p2: EdgeSidePort): number =>
    p1.other - p2.other || p1.id.localeCompare(p2.id);

  for (const [nodeId, sideContainers] of nodePortRegistry) {
    const node = mapNodesById.get(nodeId);
    if (!node) continue;

    sideContainers.top.sort(comparePortPositions);
    sideContainers.bottom.sort(comparePortPositions);

    node.ports = {
      top: sideContainers.top.map((p) => ({ id: p.id, type: p.type })),
      bottom: sideContainers.bottom.map((p) => ({ id: p.id, type: p.type })),
    };
    node.sourceHandles = sideContainers.bottom.filter((p) => p.type === 'source').map((p) => p.id);
    node.targetHandles = sideContainers.top.filter((p) => p.type === 'target').map((p) => p.id);
  }

  const composedLayout: MapLayout = {
    nodes: [...mapNodesById.values()],
    edges: generatedEdgeLayouts,
    layers: [],
    width: finalContentWidth + PADDING * 2,
    height: finalHeight,
    basis: { kind: 'all', declaredLinks: links.length, totalLinks: links.length },
    minWeight: 0,
    hiddenLinks: 0,
    mutual: [],
    moduleCycles: [],
  };

  return { layout: composedLayout, zones: finalZones };
}

/* ----------------------------------------------------------- Filtering -- */

export function selectionReach(model: StepsModel, selected: string): ReadonlySet<string> {
  const reachableNodeIds = new Set([selected]);
  if (model.forks === null || model.forks.size === 0) return reachableNodeIds;

  for (let hasExpanded = true; hasExpanded; ) {
    hasExpanded = false;
    for (const edge of model.layout.edges) {
      const containsSource = reachableNodeIds.has(edge.source);
      const containsTarget = reachableNodeIds.has(edge.target);
      if (containsSource === containsTarget) continue;

      const externalNode = containsSource ? edge.target : edge.source;
      if (model.forks.has(externalNode) && !reachableNodeIds.has(externalNode)) {
        reachableNodeIds.add(externalNode);
        hasExpanded = true;
      }
    }
  }

  return reachableNodeIds;
}

export function stepEdgeVisible(
  model: StepsModel,
  edge: MapEdgeLayout,
  selected: string | null,
  reach?: ReadonlySet<string>
): boolean {
  if (selected !== null) {
    const activeReach = reach ?? selectionReach(model, selected);
    return activeReach.has(edge.source) || activeReach.has(edge.target);
  }

  if (edge.thin || edge.back) return false;
  if (model.stubbed.has(edge.id)) return false;
  if (model.regions === null) return true;

  const originStep = model.nodes.get(edge.source)?.step;
  if (originStep?.anchor) {
    return model.regionEntries?.has(edge.target) ?? true;
  }

  return true;
}

export function stepNeighbourhood(
  payload: WireStepsPayload,
  id: string
): { arrivesFrom: WireStepLink[]; leadsTo: WireStepLink[] } {
  return {
    arrivesFrom: payload.links.filter((l) => l.to === id),
    leadsTo: payload.links.filter((l) => l.from === id),
  };
}

export function stepViaText(link: WireStepLink): string {
  return link.via.map((v) => v.name).join(' → ');
}

export function stepPairId(link: WireStepLink): string | null {
  return link.from === link.to ? null : linkId({ source: link.from, target: link.to });
}
