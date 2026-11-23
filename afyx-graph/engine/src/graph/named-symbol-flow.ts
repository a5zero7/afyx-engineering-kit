import type AfyxGraph from '../index';
import type { Node } from '../types';
import { lastQualifierPart, matchesSymbol } from './symbol-lookup';
import {
  deriveNamedSymbolFlow,
  resolveFlowTokens,
  type NamedSymbolFlow,
  type NamedSymbolFlowOptions,
} from './named-flow-policy';

export {
  DEFAULT_MAX_BRIDGE,
  DEFAULT_MAX_HOPS,
  DIRECTED_MAX_HOPS,
  FLOW_CALLABLE_KINDS,
  FLOW_EDGE_KINDS,
  flowTokens,
  normalizeToken,
  type FlowChain,
  type FlowStep,
  type NamedSymbolFlow,
  type NamedSymbolFlowOptions,
} from './named-flow-policy';
export { RUST_PATH_PREFIXES, lastQualifierPart, matchesSymbol } from './symbol-lookup';

/**
 * Find ALL symbols matching a name. Used by callers/callees/impact to aggregate
 * results across all matching symbols (e.g., multiple classes with an `execute` method).
 *
 * Exact matches only (#1473): a missing / mistyped name must NOT silently
 * resolve to the top fuzzy FTS hit under the caller's typed label. Closest
 * hits may appear in `note` as a did-you-mean hint when `nodes` is empty.
 */
export function findAllSymbols(cg: AfyxGraph, symbol: string): { nodes: Node[]; note: string } {
  // Nix option paths: the declaration is stored as `options.<path>` and
  // config writes carry longer/quoted tails (`<path>."git/config".text`),
  // so a dotted option token (`xdg.configFile`, `launchd.user.agents`) has
  // no exact-name node and would degrade to bare-tail FTS soup — burying
  // the declaration hub the nix-option-path edges hang off. Resolve the
  // convention directly: declaration first, then the exact write, then a
  // capped prefix scan of write sites. Three index hits; non-nix graphs
  // fall straight through.
  if (/^[a-z][\w'-]*(?:\.[\w'-]+)+$/.test(symbol)) {
    const optionHits = [
      ...cg.getNodesByName(`options.${symbol}`),
      ...cg.getNodesByName(symbol),
      ...cg.getNodesByNamePrefix(`${symbol}.`, 12),
    ].filter((n) => n.language === 'nix');
    if (optionHits.length > 0) {
      const seen = new Set<string>();
      const nodes = optionHits.filter((n) => !seen.has(n.id) && !!seen.add(n.id)).slice(0, 10);
      return { nodes, note: '' };
    }
  }

  const isQualified = /[.\/]|::/.test(symbol);
  let exactNodes: Node[];

  if (!isQualified) {
    // Direct index — every exact-name overload, case-sensitive. Avoids FTS
    // ranking a differently-cased sibling above the real node (#1473 Fetch).
    exactNodes = cg.getNodesByName(symbol);
  } else {
    let results = cg.searchNodes(symbol, { limit: 50 });
    // Mirror findSymbolMatches — FTS strips colons, so re-search by bare tail.
    if (results.length === 0) {
      const tail = lastQualifierPart(symbol);
      if (tail && tail !== symbol) results = cg.searchNodes(tail, { limit: 50 });
    }
    exactNodes = results
      .filter((r) => matchesSymbol(r.node, symbol))
      .map((r) => r.node);
  }

  if (exactNodes.length === 0) {
    const fuzzy = cg.searchNodes(symbol, { limit: 5 });
    const suggestions = [
      ...new Set(fuzzy.map((r) => r.node.name).filter((n) => n !== symbol)),
    ].slice(0, 3);
    const note =
      suggestions.length > 0
        ? `\n\n> **Note:** no symbol named "${symbol}". Did you mean: ${suggestions.join(', ')}?`
        : '';
    return { nodes: [], note };
  }

  if (exactNodes.length === 1) {
    return { nodes: exactNodes, note: '' };
  }

  // Same generated-file down-rank as findSymbol — keeps callers/callees
  // /impact aggregation aligned (a query against "Send" returns the
  // hand-written implementations before the protobuf scaffold).
  const isGen = cg.generatedFilePredicate(exactNodes.map((n) => n.filePath));
  const ranked = [...exactNodes].sort((a, b) => {
    const aGen = isGen(a.filePath) ? 1 : 0;
    const bGen = isGen(b.filePath) ? 1 : 0;
    return aGen - bGen;
  });

  const locations = ranked.map(
    (n) => `${n.kind} at ${n.filePath}:${n.startLine}`
  );
  const note = `\n\n> **Note:** Aggregated results across ${ranked.length} symbols named "${symbol}": ${locations.join(', ')}`;
  return { nodes: ranked, note };
}

const lookupFor = (cg: AfyxGraph) => (token: string): Node[] => findAllSymbols(cg, token).nodes;

/** Resolve tokens without traversing the graph. */
export function resolveNamedTokens(
  cg: AfyxGraph,
  query: string,
  options: NamedSymbolFlowOptions = {}
): NamedSymbolFlow {
  return resolveFlowTokens(cg, query, options, lookupFor(cg));
}

/** Derive the accepted named or directed Flow answer. */
export function resolveNamedSymbolFlow(
  cg: AfyxGraph,
  query: string,
  options: NamedSymbolFlowOptions = {}
): NamedSymbolFlow {
  return deriveNamedSymbolFlow(cg, query, options, lookupFor(cg));
}
