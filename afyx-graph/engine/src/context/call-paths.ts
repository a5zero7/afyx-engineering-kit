/**
 * "Call paths": short execution flows among the symbols a context already found,
 * derived in memory from its `calls` edges (no further queries).
 *
 * Agents reliably read the context they are given but rarely discover a separate
 * tracing tool, so the flow between the symbols they asked about is delivered here.
 * Chains end where the static call graph ends; hops that exist only through dynamic
 * dispatch (callbacks, events, framework re-renders) are real `calls` edges added by
 * synthesis and are labelled inline with where the wiring happens.
 */

import type { Edge, Subgraph } from '../types';

const MAX_CHAIN_NODES = 6;
const MIN_CHAIN_NODES = 3;
const MAX_STARTS = 5;
const MAX_CHAINS_SHOWN = 3;
/** Bounds the depth-first search on dense subgraphs. */
const VISIT_BUDGET = 2000;

const at = (metadata: Record<string, unknown>): string => (typeof metadata.registeredAt === 'string' ? ` @${metadata.registeredAt}` : '');
const quoted = (value: unknown): string => `\`${String(value)}\``;

type HopLabel = (metadata: Record<string, unknown>) => string;

/** How each kind of synthesized hop is described; anything unrecognised reads as a plain event. */
const HOP_LABELS: ReadonlyMap<string, HopLabel> = new Map<string, HopLabel>([
  ['callback', (m) => `callback via ${m.via ? quoted(m.via) : 'registrar'}${at(m)}`],
  ['react-render', (m) => `React re-render via setState${at(m)}`],
  ['jsx-render', (m) => `renders <${String(m.via || 'child')}>`],
  ['vue-handler', (m) => `Vue @${String(m.event || 'event')} handler`],
  ['http-client', (m) => `HTTP ${String(m.method || 'GET')} ${String(m.href || '')} — the client's call onto its own route${at(m)}`],
  ['queue-job', (m) => `queue job ${m.event ? quoted(m.event) : ''}${m.queue ? ` on ${quoted(m.queue)}` : ''}${at(m)}`],
]);

function describeHop(metadata: Record<string, unknown>): string {
  const kind = metadata.synthesizedBy as string;
  if (kind === 'event-bus' && metadata.channel === 'socket') {
    const direction = metadata.tier === 'client→server' ? ' → server' : metadata.tier === 'server→client' ? ' → client' : '';
    return `socket message ${metadata.event ? quoted(metadata.event) : ''}${direction}${at(metadata)}`;
  }
  const label = HOP_LABELS.get(kind);
  return label ? label(metadata) : `event ${metadata.event ? quoted(metadata.event) : ''}${at(metadata)}`;
}

function callAdjacency(subgraph: Subgraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of subgraph.edges) {
    if (edge.kind !== 'calls' || !subgraph.nodes.has(edge.source) || !subgraph.nodes.has(edge.target)) continue;
    const targets = adjacency.get(edge.source);
    if (targets) targets.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }
  return adjacency;
}

/** Simple paths of at least three nodes, depth-first from the first few starting points. */
function enumerateChains(adjacency: ReadonlyMap<string, string[]>, roots: readonly string[]): string[][] {
  const chains: string[][] = [];
  let visits = VISIT_BUDGET;
  const walk = (current: string, chain: string[], onChain: Set<string>): void => {
    if (visits-- <= 0) return;
    const next = (adjacency.get(current) ?? []).filter((target) => !onChain.has(target));
    if (next.length === 0 || chain.length >= MAX_CHAIN_NODES) {
      if (chain.length >= MIN_CHAIN_NODES) chains.push([...chain]);
      return;
    }
    for (const target of next) {
      onChain.add(target);
      walk(target, [...chain, target], onChain);
      onChain.delete(target);
    }
  };
  const starts = (roots.length > 0 ? roots.filter((id) => adjacency.has(id)) : [...adjacency.keys()]).slice(0, MAX_STARTS);
  for (const start of starts) walk(start, [start], new Set([start]));
  return chains;
}

/**
 * Keep chains anchored to what was asked about (at least two entry points on the
 * chain), most anchors first then longest, without chains contained in a kept one.
 */
function pickChains(chains: string[][], roots: readonly string[]): string[][] {
  const rootSet = new Set(roots);
  const anchors = (chain: string[]): number => chain.reduce((count, id) => count + (rootSet.has(id) ? 1 : 0), 0);
  const ranked = chains.filter((chain) => anchors(chain) >= 2).sort((a, b) => anchors(b) - anchors(a) || b.length - a.length);
  const kept: string[][] = [];
  const keptKeys: string[] = [];
  for (const chain of ranked) {
    const key = chain.join('>');
    if (keptKeys.some((existing) => existing.includes(key))) continue;
    kept.push(chain);
    keptKeys.push(key);
    if (kept.length >= MAX_CHAINS_SHOWN) break;
  }
  return kept;
}

function synthesizedHops(edges: readonly Edge[]): Map<string, string> {
  const hops = new Map<string, string>();
  for (const edge of edges) {
    if (edge.kind !== 'calls' || edge.provenance !== 'heuristic') continue;
    const metadata = edge.metadata as Record<string, unknown> | undefined;
    if (!metadata?.synthesizedBy) continue;
    hops.set(`${edge.source}>${edge.target}`, describeHop(metadata));
  }
  return hops;
}

export function renderCallPaths(subgraph: Subgraph): string {
  const adjacency = callAdjacency(subgraph);
  if (adjacency.size === 0) return '';
  const chains = enumerateChains(adjacency, subgraph.roots);
  if (chains.length === 0) return '';
  const chosen = pickChains(chains, subgraph.roots);
  if (chosen.length === 0) return '';

  const nameOf = (id: string): string => subgraph.nodes.get(id)?.name ?? id;
  const hops = synthesizedHops(subgraph.edges);
  const hopBetween = (chain: string[], index: number): string | undefined => hops.get(`${chain[index - 1]}>${chain[index]}`);
  const renderChain = (chain: string[]): string => {
    let text = nameOf(chain[0]!);
    for (let index = 1; index < chain.length; index++) {
      const hop = hopBetween(chain, index);
      text += hop ? ` →[${hop}] ${nameOf(chain[index]!)}` : ` → ${nameOf(chain[index]!)}`;
    }
    return text;
  };
  const anySynthesized = chosen.some((chain) => chain.some((_, index) => index > 0 && hopBetween(chain, index) !== undefined));

  const lines = [
    '',
    '## Call paths',
    '',
    'Execution flow among the key symbols (traced through the call graph):',
    '',
    ...chosen.map((chain) => `- ${renderChain(chain)}`),
    '',
    anySynthesized
      ? '_Hops marked `[callback/event …]` are dynamic dispatch bridged by afyx-graph (with the registration site); the rest are direct calls. afyx_graph_node any symbol for its body._'
      : '_afyx_graph_node any symbol above for its source + its own callers/callees._',
  ];
  return `\n${lines.join('\n')}\n`;
}
