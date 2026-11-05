/**
 * AFYX Engineering Kit - Program Execution Flow Model
 *
 * Constructs a chronological execution order graph from folded step programs,
 * tracking sequences, branches, conditional branches, loops, and block runs.
 */

import { conditionTokens, joinTokens, whenWords, type WordToken } from './conditions';
import { buildMapLayout, linkId, PORT_PITCH, type MapLayout } from './map-model';
import { samplePolyline, trackedCurves, EDGE_LABEL_MAX, SCREEN_LAYER_GAP, type Point } from './screens-model';
import {
  armWords,
  stepLabel,
  stepSub,
  type StepEdgeInfo,
  type StepForkInfo,
  type StepNodeInfo,
  type StepsModel,
} from './steps-model';
import type { WireArm, WireBlock, WireItem, WireMapLink, WireMapModule, WireStep, WireStepsPayload } from './wire';

/* ------------------------------------------------------------------ Tokens -- */

/** Syntax construct from which a decision fork originates. */
export type ForkForm = Extract<WireItem, { kind: 'fork' }>['form'];

/**
 * Tokenizes condition expression into user-facing tokens for line labels.
 */
export function whenTokens(when: string): WordToken[] {
  return conditionTokens(when);
}

/**
 * Converts block metadata into human-readable sequence annotations.
 */
export function runWords(item: Extract<WireItem, { kind: 'block' }>): string {
  switch (item.block) {
    case 'inline':
      return item.via ? `via ${item.via.name}` : 'via a helper';
    case 'loop':
      if (!item.by) {
        return item.loop === 'while' ? 'again and again' : 'for each item';
      }
      return item.loop === 'while' ? `again while ${item.by}` : `for each ${item.by}`;
    case 'later':
      return item.by ? `later · ${item.by}` : 'later';
    default:
      return item.by ? `together · ${item.by}` : 'together';
  }
}

/* ------------------------------------------------------------------ Graph -- */

/**
 * Sequential execution edge connecting a preceding step to a succeeding step.
 */
export interface OrderEdge {
  from: string;
  to: string;
  when: string;
  runs: string[];
  arm?: string;
}

/** Preceding execution tail candidate during block traversal. */
interface FlowTail {
  id: string;
  when: string[];
  runs: string[];
  arm?: string;
}

/**
 * Representation of a multi-branch decision fork node in the execution diagram.
 */
export interface OrderFork {
  id: string;
  on: string;
  form: ForkForm;
}

/**
 * Graph representation of program execution order.
 */
export interface OrderGraph {
  edges: OrderEdge[];
  depth: Map<string, number>;
  forks: OrderFork[];
}

/**
 * Traverses folded program blocks to generate execution sequence edges,
 * branches, and sequential depth levels starting from an anchor node.
 */
export function orderGraph(program: NonNullable<WireStepsPayload['program']>, anchor: string): OrderGraph {
  const edges: OrderEdge[] = [];
  const registeredNodes = new Set<string>([anchor]);
  const edgeIndex = new Map<string, OrderEdge>();
  const forks: OrderFork[] = [];

  const connectEdge = (sourceId: string, targetId: string, tail: FlowTail): void => {
    if (sourceId === targetId) return;
    const pairKey = `${sourceId} ${targetId}`;
    const deduplicatedWhen = tail.when.filter((w, idx) => Boolean(w) && tail.when.indexOf(w) === idx).join(' && ');

    const existing = edgeIndex.get(pairKey);
    if (existing) {
      if (deduplicatedWhen !== existing.when) {
        existing.when = !deduplicatedWhen || !existing.when ? '' : `${existing.when} || ${deduplicatedWhen}`;
      }
      for (const runLabel of tail.runs) {
        if (!existing.runs.includes(runLabel)) {
          existing.runs.push(runLabel);
        }
      }
      if (existing.arm !== tail.arm) {
        delete existing.arm;
      }
      return;
    }

    const newEdge: OrderEdge = {
      from: sourceId,
      to: targetId,
      when: deduplicatedWhen,
      runs: [...tail.runs],
      ...(tail.arm !== undefined ? { arm: tail.arm } : {}),
    };
    edgeIndex.set(pairKey, newEdge);
    edges.push(newEdge);
  };

  const traverseBlock = (block: WireBlock, currentTails: readonly FlowTail[], activeRuns: readonly string[]): FlowTail[] => {
    let tails: FlowTail[] = [...currentTails];

    for (const item of block) {
      if (item.kind === 'step') {
        registeredNodes.add(item.step);
        for (const t of tails) {
          connectEdge(t.id, item.step, { ...t, runs: [...t.runs, ...activeRuns] });
        }

        let innerTails: FlowTail[] = [{ id: item.step, when: [], runs: [] }];
        if (item.body && item.body.length > 0) {
          innerTails = traverseBlock(item.body, innerTails, []);
        }
        tails = innerTails;
      } else if (item.kind === 'fork') {
        const actionableArms = item.arms.filter((arm) => hasExecutableStep(arm.body));
        const shouldForkPoint = actionableArms.length >= 2 && tails.length > 0;

        const forkPoint: OrderFork | null = shouldForkPoint
          ? { id: `fork:${forks.length}`, on: item.on, form: item.form }
          : null;

        if (forkPoint !== null) {
          forks.push(forkPoint);
          for (const t of tails) {
            connectEdge(t.id, forkPoint.id, { ...t, runs: [...t.runs, ...activeRuns] });
          }
        }

        const aggregatedOutTails: FlowTail[] = [];
        for (const arm of item.arms) {
          const armEntryTails: FlowTail[] =
            forkPoint !== null && hasExecutableStep(arm.body)
              ? [{ id: forkPoint.id, when: [arm.when], runs: [...activeRuns], arm: resolveArmLabel(item, arm) }]
              : tails.map((t) => ({ id: t.id, when: [...t.when, arm.when], runs: [...t.runs, ...activeRuns] }));

          const armExitTails = traverseBlock(arm.body, armEntryTails, []);
          if (arm.ends === null) {
            aggregatedOutTails.push(...armExitTails);
          }
        }

        if (item.arms.length < 2) {
          aggregatedOutTails.push(...tails.map((t) => ({ ...t, runs: [...t.runs, ...activeRuns] })));
        }
        tails = aggregatedOutTails;
      } else if (item.kind === 'block') {
        const blockLabel = runWords(item);
        const innerTails = traverseBlock(item.body, tails, [...activeRuns, blockLabel]);
        tails = (innerTails.length > 0 ? innerTails : tails).map((t) =>
          t.runs.includes(blockLabel) ? { ...t, runs: t.runs.filter((r) => r !== blockLabel) } : t
        );
      }
    }

    return tails;
  };

  traverseBlock(program.root, [{ id: anchor, when: [], runs: [] }], []);

  // Ensure all visited steps remain attached to the root anchor if not linked
  for (const stepId of registeredNodes) {
    if (stepId !== anchor && !edges.some((edge) => edge.to === stepId)) {
      connectEdge(anchor, stepId, { id: anchor, when: [], runs: [] });
    }
  }

  const allNodeIds = new Set<string>(registeredNodes);
  for (const f of forks) {
    allNodeIds.add(f.id);
  }

  return {
    edges,
    depth: computeNodeDepths(anchor, allNodeIds, edges),
    forks,
  };
}

function hasExecutableStep(block: WireBlock): boolean {
  for (const item of block) {
    if (item.kind === 'step') return true;
    if (item.kind === 'fork' && item.arms.some((arm) => hasExecutableStep(arm.body))) return true;
    if (item.kind === 'block' && hasExecutableStep(item.body)) return true;
  }
  return false;
}

function resolveArmLabel(fork: Extract<WireItem, { kind: 'fork' }>, arm: WireArm): string {
  return armWords({ on: fork.on, arm: arm.when, form: fork.form, not: arm.not });
}

function computeNodeDepths(anchor: string, nodes: ReadonlySet<string>, edges: readonly OrderEdge[]): Map<string, number> {
  const dagEdges = filterAcyclicEdges(anchor, nodes, edges);
  const depthMap = new Map<string, number>();

  for (const id of nodes) {
    depthMap.set(id, 0);
  }
  depthMap.set(anchor, 0);

  for (let round = 0; round < nodes.size; round++) {
    let updated = false;
    for (const edge of dagEdges) {
      const candidateDepth = (depthMap.get(edge.from) ?? 0) + 1;
      if (candidateDepth > (depthMap.get(edge.to) ?? 0)) {
        depthMap.set(edge.to, candidateDepth);
        updated = true;
      }
    }
    if (!updated) break;
  }

  return depthMap;
}

function filterAcyclicEdges(anchor: string, nodes: ReadonlySet<string>, edges: readonly OrderEdge[]): OrderEdge[] {
  const adjacency = new Map<string, OrderEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list) {
      list.push(edge);
    } else {
      adjacency.set(edge.from, [edge]);
    }
  }

  // DFS colors: 1 = visiting (ancestor), 2 = visited
  const visitState = new Map<string, 1 | 2>();
  const cyclicEdges = new Set<OrderEdge>();
  const searchRoots = [anchor, ...nodes];

  for (const root of searchRoots) {
    if (visitState.has(root)) continue;

    visitState.set(root, 1);
    const callStack: Array<{ id: string; edgeIndex: number }> = [{ id: root, edgeIndex: 0 }];

    while (callStack.length > 0) {
      const topFrame = callStack[callStack.length - 1]!;
      const outgoing = adjacency.get(topFrame.id) ?? [];

      if (topFrame.edgeIndex >= outgoing.length) {
        visitState.set(topFrame.id, 2);
        callStack.pop();
        continue;
      }

      const nextEdge = outgoing[topFrame.edgeIndex++]!;
      const targetState = visitState.get(nextEdge.to);

      if (targetState === 1) {
        cyclicEdges.add(nextEdge);
      } else if (targetState === undefined) {
        visitState.set(nextEdge.to, 1);
        callStack.push({ id: nextEdge.to, edgeIndex: 0 });
      }
    }
  }

  return edges.filter((edge) => !cyclicEdges.has(edge));
}

/* ------------------------------------------------------------------ Model Build -- */

const CURVE_HIT_SAMPLES = 24;

/**
 * Builds chronological StepsModel representation from parsed WireStepsPayload.
 */
export function buildOrderModel(payload: WireStepsPayload): StepsModel | null {
  if (!payload.program) return null;
  const anchorStep = payload.steps.find((s) => s.anchor);
  if (!anchorStep) return null;

  const graph = orderGraph(payload.program, anchorStep.id);
  const nodes = new Map<string, StepNodeInfo>();
  const forks = new Map<string, StepForkInfo>();
  const modules: WireMapModule[] = [];
  const counts: StepsModel['counts'] = {
    anchor: 0,
    screen: 0,
    trigger: 0,
    bridge: 0,
    event: 0,
    store: 0,
    effect: 0,
  };

  const nodeDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    nodeDegree.set(edge.from, (nodeDegree.get(edge.from) ?? 0) + 1);
    nodeDegree.set(edge.to, (nodeDegree.get(edge.to) ?? 0) + 1);
  }

  const stepsById = new Map(payload.steps.map((s) => [s.id, s]));
  const orderedIds = [anchorStep.id, ...graph.depth.keys()];

  for (const id of orderedIds) {
    if (nodes.has(id)) continue;
    const step = stepsById.get(id);
    if (!step) continue;

    counts[step.kind]++;
    const info: StepNodeInfo = {
      id,
      step,
      label: stepLabel(step),
      sub: stepSub(step, payload.project),
    };
    nodes.set(id, info);

    modules.push({
      id,
      label: info.label,
      files: 1,
      symbols: nodeDegree.get(id) ?? 0,
      languages: [],
      test: false,
      generated: 0,
      generatedFiles: [],
      facade: false,
      fileList: { total: 1, shown: 1, truncated: false, items: [step.node?.file ?? step.sub] },
      dependents: { files: 0, modules: 0 },
    });
  }

  for (const fork of graph.forks) {
    const label = formatForkLabel(fork.on);
    forks.set(fork.id, { id: fork.id, on: fork.on, form: fork.form, label });
    modules.push({
      id: fork.id,
      label,
      files: 0,
      symbols: nodeDegree.get(fork.id) ?? 0,
      languages: [],
      test: false,
      generated: 0,
      generatedFiles: [],
      facade: false,
      fileList: { total: 0, shown: 0, truncated: false, items: [] },
      dependents: { files: 0, modules: 0 },
    });
  }

  const isDrawn = (id: string): boolean => nodes.has(id) || forks.has(id);
  const links: WireMapLink[] = [];
  const edges = new Map<string, StepEdgeInfo>();

  for (const edge of graph.edges) {
    if (!isDrawn(edge.from) || !isDrawn(edge.to)) continue;
    const key = linkId({ source: edge.from, target: edge.to });
    if (edges.has(key)) continue;

    links.push({
      source: edge.from,
      target: edge.to,
      count: 1,
      declared: 1,
      byKind: [{ kind: 'calls', count: 1 }],
      topPairs: [],
    });

    const relatedLinks = payload.links.filter((l) => l.to === edge.to);
    edges.set(key, {
      id: key,
      from: edge.from,
      to: edge.to,
      links: relatedLinks,
      label: lineWords(edge),
      synthesized: relatedLinks.length > 0 && relatedLinks.every((l) => l.synthesized),
      kind: relatedLinks[0]?.kind ?? 'calls',
    });
  }

  const forkSortOrder = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!forks.has(edge.from)) continue;
    const targetOrder = stepsById.get(edge.to)?.order;
    if (targetOrder === undefined) continue;
    forkSortOrder.set(edge.from, Math.min(forkSortOrder.get(edge.from) ?? Number.MAX_SAFE_INTEGER, targetOrder));
  }

  const maxDepth = Math.max(0, ...graph.depth.values());
  const computeLayering = (ids: string[]): Map<string, number> =>
    new Map(ids.map((id) => [id, maxDepth - (graph.depth.get(id) ?? maxDepth)]));

  const layout: MapLayout = buildMapLayout(
    { modules, links },
    {
      includeTests: true,
      minWeight: 0,
      sizing: (mod) => {
        const fork = forks.get(mod.id);
        if (fork) return { label: fork.label, meta: '' };
        const info = nodes.get(mod.id);
        const cutIndicator = info?.step.cut != null ? ' …' : '';
        const anchorDot = info?.step.anchor ? '● ' : '';
        return {
          label: anchorDot + (info?.label ?? mod.id) + cutIndicator,
          meta: info?.sub ?? '',
        };
      },
      layering: computeLayering,
      order: (id) => nodes.get(id)?.step.order ?? forkSortOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
      layerGap: SCREEN_LAYER_GAP,
      portPitch: PORT_PITCH,
      ports: 'directional',
    }
  );

  const curves = trackedCurves(layout, SCREEN_LAYER_GAP);
  const polylines = new Map<string, Point[]>();
  for (const [id, curve] of curves) {
    polylines.set(id, samplePolyline(curve, CURVE_HIT_SAMPLES));
  }

  return {
    layout,
    nodes,
    edges,
    layerGap: SCREEN_LAYER_GAP,
    curves,
    polylines,
    counts,
    regions: null,
    regionEntries: null,
    forks,
    decisions: [],
    stubs: new Map(),
    stubbed: new Set(),
  };
}

/**
 * Derives user-facing text for an execution flow edge.
 */
export function lineWords(e: OrderEdge): string {
  if (e.arm) return e.arm;
  if (!e.when) {
    return e.runs.length > 0 ? e.runs[e.runs.length - 1]! : '';
  }
  const formatted = joinTokens(whenTokens(e.when));
  return formatted.length > EDGE_LABEL_MAX ? `${formatted.slice(0, EDGE_LABEL_MAX - 1)}…` : formatted;
}

function formatForkLabel(on: string): string {
  const text = whenWords(on);
  if (!text) return '?';
  return text.length > EDGE_LABEL_MAX ? `${text.slice(0, EDGE_LABEL_MAX - 1)}…?` : `${text}?`;
}
