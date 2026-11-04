import * as crypto from 'node:crypto';
import { GraphTraverser, GraphQueryManager } from '../../src/graph';
import type { Edge, Node, Subgraph, TraversalOptions } from '../../src/types';
import { createFakeStore } from './fake-store';
import { GRAPH_WORLDS, READABLE_WORLDS } from './worlds';

const digest = (value: unknown): string => `${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 14)}`;
const edgeText = (edge: Edge): string => `${edge.source}>${edge.target}:${edge.kind}@${edge.line ?? '-'}:${edge.column ?? '-'}`;
const shape = (graph: Subgraph) => ({ nodes: [...graph.nodes.keys()], edges: graph.edges.map(edgeText), roots: graph.roots });
const pairs = (list: Array<{ node: Node; edge: Edge }>) => list.map(({ node, edge }) => `${node.id}<${edgeText(edge)}`);
const ids = (nodes: Node[]) => nodes.map((node) => node.id);

const DIRECTIONS = ['outgoing', 'incoming', 'both'] as const;
const DEPTHS: Array<number | undefined> = [0, 1, 2, undefined];

function walkVariants(): Array<[string, TraversalOptions]> {
  const variants: Array<[string, TraversalOptions]> = [['default', {}]];
  for (const direction of DIRECTIONS) {
    for (const depth of DEPTHS) variants.push([`${direction}:${depth ?? 'inf'}`, { direction, maxDepth: depth ?? Infinity }]);
  }
  variants.push(
    ['both:limit2', { direction: 'both', limit: 2 }],
    ['both:limit5', { direction: 'both', limit: 5 }],
    ['outgoing:calls', { direction: 'outgoing', edgeKinds: ['calls'] }],
    ['both:functions', { direction: 'both', maxDepth: 2, nodeKinds: ['function'] }],
    ['both:classes', { direction: 'both', nodeKinds: ['class', 'interface'] }],
    ['outgoing:noStart', { direction: 'outgoing', includeStart: false }],
    ['incoming:noStart', { direction: 'incoming', includeStart: false }],
    ['both:noStart:limit3', { direction: 'both', includeStart: false, limit: 3 }],
    // An explicit undefined replaces the default rather than falling back to it.
    ['undefinedLimit', { direction: 'both', limit: undefined }],
    ['undefinedDepth', { direction: 'both', maxDepth: undefined }],
    ['emptyKinds', { direction: 'both', edgeKinds: [], nodeKinds: [] }],
  );
  return variants;
}

export function computeGraphContract(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, make] of Object.entries(GRAPH_WORLDS)) {
    const world = make();
    const store = createFakeStore(world);
    const traverser = new GraphTraverser(store);
    const manager = new GraphQueryManager(store);
    const readable = READABLE_WORLDS.has(name);
    const records: Record<string, unknown> = {};
    const put = (key: string, value: unknown): void => { records[key] = readable ? value : digest(value); };
    const attempt = (key: string, run: () => unknown): void => {
      try { put(key, run()); } catch (error) { put(key, `throws: ${(error as Error).message}`); }
    };

    const nodeIds = [...world.nodes.map((node) => node.id), 'MISSING'];
    const variants = walkVariants();
    for (const id of nodeIds) {
      for (const [label, options] of variants) {
        put(`bfs ${id} ${label}`, shape(traverser.traverseBFS(id, options)));
        put(`dfs ${id} ${label}`, shape(traverser.traverseDFS(id, options)));
      }
      for (const depth of [0, 1, 2, 3, 5]) {
        put(`callers ${id} ${depth}`, pairs(traverser.getCallers(id, depth)));
        put(`callees ${id} ${depth}`, pairs(traverser.getCallees(id, depth)));
        put(`impact ${id} ${depth}`, shape(traverser.getImpactRadius(id, depth)));
      }
      put(`callers ${id} default`, pairs(traverser.getCallers(id)));
      put(`callees ${id} default`, pairs(traverser.getCallees(id)));
      put(`impact ${id} default`, shape(traverser.getImpactRadius(id)));
      for (const depth of [0, 1, 2]) put(`callGraph ${id} ${depth}`, shape(traverser.getCallGraph(id, depth)));
      put(`callGraph ${id} default`, shape(traverser.getCallGraph(id)));
      put(`hierarchy ${id}`, shape(traverser.getTypeHierarchy(id)));
      put(`usages ${id}`, pairs(traverser.findUsages(id)));
      put(`ancestors ${id}`, ids(traverser.getAncestors(id)));
      put(`children ${id}`, ids(traverser.getChildren(id)));
      attempt(`context ${id}`, () => {
        const context = manager.getContext(id);
        return {
          focal: context.focal.id, ancestors: ids(context.ancestors), children: ids(context.children), incoming: pairs(context.incomingRefs),
          outgoing: pairs(context.outgoingRefs), types: ids(context.types), imports: ids(context.imports),
        };
      });
      put(`metrics ${id}`, manager.getNodeMetrics(id));
    }

    const sample = nodeIds.slice(0, 8);
    for (const from of sample) {
      for (const to of sample) {
        for (const kinds of [[], ['calls']] as const) {
          const path = traverser.findPath(from, to, [...kinds]);
          put(`path ${from}>${to} ${kinds.join(',') || 'all'}`, path === null ? null : path.map(({ node, edge }) => `${node.id}${edge ? `<${edgeText(edge)}` : ''}`));
        }
      }
    }

    const files = [...new Set(world.nodes.map((node) => node.filePath)), 'src/missing.ts'];
    for (const file of files) {
      put(`fileDeps ${file}`, manager.getFileDependencies(file));
      put(`fileDependents ${file}`, manager.getFileDependents(file));
      put(`exported ${file}`, ids(manager.getExportedSymbols(file)));
    }
    for (const pattern of ['*', 'src/main.ts::*', 'src/*::a*', '?', '*::A', 'nomatch', 'src/main.ts::Service', 'src/util.ts::h?lper', '*.ts::*']) put(`qname ${pattern}`, ids(manager.findByQualifiedName(pattern)));
    put('moduleStructure', [...manager.getModuleStructure().entries()]);
    put('circular', manager.findCircularDependencies());
    put('deadCode default', ids(manager.findDeadCode()));
    put('deadCode classes', ids(manager.findDeadCode(['class'])));
    put('deadCode mixed', ids(manager.findDeadCode(['function', 'variable', 'interface'])));
    for (const edges of [true, false]) {
      put(`filtered functions ${edges}`, shape(manager.getFilteredSubgraph((node) => node.kind === 'function', edges)));
      put(`filtered a* ${edges}`, shape(manager.getFilteredSubgraph((node) => node.name.toLowerCase().startsWith('a'), edges)));
    }
    put('sameTraverser', manager.getTraverser() instanceof GraphTraverser);
    out[name] = { counts: { nodes: world.nodes.length, edges: world.edges.length }, records };
  }
  return out;
}
