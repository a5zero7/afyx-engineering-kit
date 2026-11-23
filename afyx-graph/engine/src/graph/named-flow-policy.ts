import type AfyxGraph from '../index';
import type { Edge, Node } from '../types';
import { isTestFile } from '../search/query-utils';

export const FLOW_CALLABLE_KINDS: ReadonlySet<string> = new Set([
  'method', 'function', 'component', 'constructor', 'route',
]);
export const FLOW_EDGE_KINDS: ReadonlySet<string> = new Set(['calls', 'navigates']);
export const DEFAULT_MAX_HOPS = 7;
export const DIRECTED_MAX_HOPS = 12;
export const DEFAULT_MAX_BRIDGE = 1;

const DYNAMIC_ENDPOINT_KINDS = new Set(['constant', 'variable', 'field', 'property']);
const FILE_EXTENSION =
  /\.(?:java|kt|kts|ts|tsx|js|jsx|mjs|cjs|cs|py|go|rb|php|swift|rs|cpp|cc|cxx|c|h|hpp|scala|lua|dart|vue|svelte|astro|erl|hrl)$/i;
const LIMITS = Object.freeze({
  namedSeeds: 8,
  namedCandidatesPerToken: 6,
  directedCandidatesPerToken: 12,
  tokens: 16,
  namedNodes: 40,
  dynamicNodes: 12,
  dynamicPerToken: 4,
  namedVisits: 1_500,
  directedVisitsPerSide: 12_000,
});

export interface FlowStep {
  node: Node;
  edge: Edge | null;
}
export interface FlowChain {
  steps: FlowStep[];
  callSites: Map<string, number>;
}
export interface NamedSymbolFlowOptions {
  mode?: 'named' | 'directed';
  from?: string;
  to?: string;
  maxHops?: number;
  maxBridge?: number;
  maxChains?: number;
}
export interface NamedSymbolFlow {
  tokens: string[];
  named: Map<string, Node>;
  dynNamed: Map<string, Node>;
  tokenNodes: Map<string, string[]>;
  tokenFamily: Map<string, Node[]>;
  uniqueNamedNodeIds: Set<string>;
  preciseNamedIds: Set<string>;
  chains: FlowChain[];
}

export type FlowTokenLookup = (token: string) => readonly Node[];
type ParentLink = { previous: string | null; edge: Edge | null; node: Node };

function blankFlow(): NamedSymbolFlow {
  return {
    tokens: [], named: new Map(), dynNamed: new Map(), tokenNodes: new Map(),
    tokenFamily: new Map(), uniqueNamedNodeIds: new Set(), preciseNamedIds: new Set(),
    chains: [],
  };
}

export function normalizeToken(token: string): string {
  return token.replace(FILE_EXTENSION, '').trim();
}

export function flowTokens(query: string): string[] {
  const accepted = query
    .split(/[\s,()[\]]+/)
    .map(normalizeToken)
    .filter((token) =>
      token.length >= 3 && /^[A-Za-z_$][\w$]*(?:(?:::|\.)[\w$]+)*$/.test(token)
    );
  return [...new Set(accepted)].slice(0, LIMITS.tokens);
}

function tokenIsPrecise(token: string): boolean {
  return /[._$]|::|\//.test(token) || /[a-z][A-Z]/.test(token) || /^[A-Z]/.test(token);
}

function directedCandidateOrder(nodes: readonly Node[]): Node[] {
  return [...nodes].sort(
    (a, b) => (isTestFile(a.filePath) ? 1 : 0) - (isTestFile(b.filePath) ? 1 : 0)
  );
}

function hasHeuristicRelationship(cg: AfyxGraph, nodeId: string): boolean {
  return [...cg.getIncomingEdges(nodeId), ...cg.getOutgoingEdges(nodeId)]
    .some(({ provenance }) => provenance === 'heuristic');
}

export function resolveFlowTokens(
  cg: AfyxGraph,
  query: string,
  options: NamedSymbolFlowOptions,
  lookup: FlowTokenLookup
): NamedSymbolFlow {
  const result = blankFlow();
  result.tokens = flowTokens(query);
  if (result.tokens.length < 2) return result;

  const directed = options.mode === 'directed';
  const querySegments = new Set<string>();
  for (const token of result.tokens) {
    for (const part of token.toLowerCase().split(/::|\./)) if (part) querySegments.add(part);
  }

  for (const token of result.tokens) {
    const hits = [...lookup(token)];
    const callable = hits.filter(({ kind }) => FLOW_CALLABLE_KINDS.has(kind));
    result.tokenFamily.set(token, callable);
    const specific = callable.length <= 3;
    const relevant = specific || directed
      ? callable
      : callable.filter(({ qualifiedName }) => {
          const parts = (qualifiedName || '').toLowerCase().split(/::|\./).filter(Boolean);
          const owner = parts.length >= 2 ? parts[parts.length - 2] : '';
          return !!owner && querySegments.has(owner);
        });
    const chosen = directed
      ? directedCandidateOrder(relevant).slice(0, LIMITS.directedCandidatesPerToken)
      : relevant.slice(0, LIMITS.namedCandidatesPerToken);
    result.tokenNodes.set(token, chosen.map(({ id }) => id));

    const precise = tokenIsPrecise(token);
    for (const node of chosen) {
      result.named.set(node.id, node);
      if (specific) result.uniqueNamedNodeIds.add(node.id);
      if (precise) result.preciseNamedIds.add(node.id);
    }

    if (result.dynNamed.size < LIMITS.dynamicNodes) {
      let addedForToken = 0;
      for (const node of hits) {
        if (
          FLOW_CALLABLE_KINDS.has(node.kind) ||
          !DYNAMIC_ENDPOINT_KINDS.has(node.kind) ||
          result.dynNamed.has(node.id)
        ) continue;
        if (hasHeuristicRelationship(cg, node.id)) {
          result.dynNamed.set(node.id, node);
          if (precise) result.preciseNamedIds.add(node.id);
          addedForToken += 1;
        }
        if (result.dynNamed.size >= LIMITS.dynamicNodes || addedForToken >= LIMITS.dynamicPerToken) break;
      }
    }
    if (result.named.size > LIMITS.namedNodes) break;
  }
  return result;
}

function namedWalk(
  cg: AfyxGraph,
  seed: Node,
  namedIds: ReadonlySet<string>,
  maxHops: number,
  maxBridge: number
): { parents: Map<string, ParentLink>; reached: string[] } {
  const parents = new Map<string, ParentLink>([
    [seed.id, { previous: null, edge: null, node: seed }],
  ]);
  const pending: Array<{ nodeId: string; edges: number; unnamedRun: number }> = [
    { nodeId: seed.id, edges: 0, unnamedRun: 0 },
  ];
  const reached: string[] = [];
  let cursor = 0;
  while (cursor < pending.length && parents.size < LIMITS.namedVisits) {
    const current = pending[cursor++]!;
    if (current.nodeId !== seed.id && namedIds.has(current.nodeId)) reached.push(current.nodeId);
    if (current.edges >= maxHops - 1) continue;
    for (const { node, edge } of cg.getCallees(current.nodeId)) {
      if (!FLOW_EDGE_KINDS.has(edge.kind) || parents.has(node.id)) continue;
      const unnamedRun = namedIds.has(node.id)
        ? 0
        : node.kind === 'route'
          ? current.unnamedRun
          : current.unnamedRun + 1;
      if (unnamedRun > maxBridge) continue;
      parents.set(node.id, { previous: current.nodeId, edge, node });
      pending.push({ nodeId: node.id, edges: current.edges + 1, unnamedRun });
    }
  }
  return { parents, reached };
}

function stepsFrom(parents: ReadonlyMap<string, ParentLink>, targetId: string): FlowStep[] {
  const reversed: FlowStep[] = [];
  let cursor: string | null = targetId;
  while (cursor !== null) {
    const link = parents.get(cursor);
    if (!link) break;
    reversed.push({ node: link.node, edge: link.edge });
    cursor = link.previous;
  }
  return reversed.reverse();
}

function directedWalk(
  cg: AfyxGraph,
  source: Node,
  destinationIds: ReadonlySet<string>,
  maxHops: number
): FlowStep[] | null {
  if (destinationIds.has(source.id)) return null;
  const forward = new Map<string, ParentLink>([
    [source.id, { previous: null, edge: null, node: source }],
  ]);
  const backward = new Map<string, { next: string; edge: Edge } | null>();
  const backwardNodes = new Map<string, Node>();
  let forwardFrontier: Node[] = [source];
  let backwardFrontier: Node[] = [];
  for (const id of destinationIds) {
    const node = cg.getNode(id);
    if (!node) continue;
    backward.set(id, null);
    backwardNodes.set(id, node);
    backwardFrontier.push(node);
  }
  if (backwardFrontier.length === 0) return null;

  const meetingNode = (): string | null => {
    for (const id of forward.keys()) if (backward.has(id)) return id;
    return null;
  };
  const edgeBudget = Math.max(1, maxHops - 1);
  for (let level = 0; level < edgeBudget; level += 1) {
    if (forwardFrontier.length <= backwardFrontier.length) {
      if (forward.size > LIMITS.directedVisitsPerSide) break;
      const next: Node[] = [];
      for (const current of forwardFrontier) {
        for (const { node, edge } of cg.getCallees(current.id)) {
          if (!FLOW_EDGE_KINDS.has(edge.kind) || forward.has(node.id)) continue;
          forward.set(node.id, { previous: current.id, edge, node });
          next.push(node);
        }
      }
      if (next.length === 0) break;
      forwardFrontier = next;
    } else {
      if (backward.size > LIMITS.directedVisitsPerSide) break;
      const next: Node[] = [];
      for (const current of backwardFrontier) {
        for (const { node, edge } of cg.getCallers(current.id)) {
          if (!FLOW_EDGE_KINDS.has(edge.kind) || backward.has(node.id)) continue;
          backward.set(node.id, { next: current.id, edge });
          backwardNodes.set(node.id, node);
          next.push(node);
        }
      }
      if (next.length === 0) break;
      backwardFrontier = next;
    }

    const meeting = meetingNode();
    if (meeting === null) continue;
    const steps = stepsFrom(forward, meeting);
    let link = backward.get(meeting);
    while (link) {
      const node = backwardNodes.get(link.next);
      if (!node) break;
      steps.push({ node, edge: link.edge });
      link = backward.get(link.next);
    }
    const last = steps[steps.length - 1];
    if (steps.length < 2 || !last || !destinationIds.has(last.node.id)) return null;
    return steps.length <= maxHops ? steps : null;
  }
  return null;
}

function callSites(steps: readonly FlowStep[]): Map<string, number> {
  const result = new Map<string, number>();
  for (let index = 0; index < steps.length - 1; index += 1) {
    const sourceId = steps[index]?.node.id;
    const line = steps[index + 1]?.edge?.line;
    if (sourceId && line && line > 0 && !result.has(sourceId)) result.set(sourceId, line);
  }
  return result;
}

function namedPaths(
  cg: AfyxGraph,
  flow: NamedSymbolFlow,
  maxHops: number,
  maxBridge: number
): FlowStep[][] {
  const namedIds = new Set(flow.named.keys());
  const paths: FlowStep[][] = [];
  for (const seed of [...flow.named.values()].slice(0, LIMITS.namedSeeds)) {
    const walk = namedWalk(cg, seed, namedIds, maxHops, maxBridge);
    let deepest: FlowStep[] | null = null;
    for (const reachedId of walk.reached) {
      const candidate = stepsFrom(walk.parents, reachedId);
      if (!deepest || candidate.length > deepest.length) deepest = candidate;
    }
    if (deepest) paths.push(deepest);
  }
  return paths;
}

function directedPaths(
  cg: AfyxGraph,
  flow: NamedSymbolFlow,
  options: NamedSymbolFlowOptions,
  maxHops: number
): FlowStep[][] {
  const sourceIds = flow.tokenNodes.get(normalizeToken(options.from ?? '')) ?? [];
  const destinationIds = flow.tokenNodes.get(normalizeToken(options.to ?? '')) ?? [];
  if (sourceIds.length === 0 || destinationIds.length === 0) return [];
  const destinations = new Set(destinationIds);
  const paths: FlowStep[][] = [];
  for (const id of sourceIds) {
    const source = flow.named.get(id);
    if (!source) continue;
    const path = directedWalk(cg, source, destinations, maxHops);
    if (path) paths.push(path);
  }
  return paths;
}

function keepDistinctPaths(paths: FlowStep[][], directed: boolean, maxChains: number): FlowChain[] {
  paths.sort((a, b) => directed ? a.length - b.length : b.length - a.length);
  const identities: string[] = [];
  const result: FlowChain[] = [];
  for (const steps of paths) {
    const identity = steps.map(({ node }) => node.id).join('>');
    if (identities.some((kept) => kept === identity || kept.includes(identity))) continue;
    identities.push(identity);
    result.push({ steps, callSites: callSites(steps) });
    if (result.length >= maxChains) break;
  }
  return result;
}

export function deriveNamedSymbolFlow(
  cg: AfyxGraph,
  query: string,
  options: NamedSymbolFlowOptions,
  lookup: FlowTokenLookup
): NamedSymbolFlow {
  try {
    const directed = options.mode === 'directed';
    const flow = resolveFlowTokens(cg, query, options, lookup);
    if (flow.named.size < 2) return flow;
    const maxHops = options.maxHops ?? (directed ? DIRECTED_MAX_HOPS : DEFAULT_MAX_HOPS);
    const maxBridge = options.maxBridge ?? (directed ? Number.POSITIVE_INFINITY : DEFAULT_MAX_BRIDGE);
    const maxChains = Math.max(1, options.maxChains ?? 1);
    const paths = directed
      ? directedPaths(cg, flow, options, maxHops)
      : namedPaths(cg, flow, maxHops, maxBridge);
    flow.chains = keepDistinctPaths(paths, directed, maxChains);
    return flow;
  } catch {
    return blankFlow();
  }
}
