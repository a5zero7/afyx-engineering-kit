/**
 * ContextBuilder: the public face of the context pipeline.
 *
 *   query
 *     → request         symbols, terms, test-intent, memoised path checks
 *     → candidates      name / definition / text seeding, then infix channels
 *     → ranking         merge, demote tests, favour the core directory, corroborate
 *     → entry points    bounded, import-resolved, with a confidence verdict
 *     → expansion       type hierarchies, then a per-entry neighbourhood
 *     → budgets         node limit, per-file cap, non-production cap, edge recovery
 *     → answer          structured, or rendered as markdown / json
 *
 * Every stage is deterministic: ties keep discovery order and no stage depends on
 * hidden state, so the same graph and query always yield the same context.
 */

import type { QueryBuilder } from '../db/queries';
import type { GraphTraverser } from '../graph';
import type { BuildContextOptions, FindRelevantContextOptions, Node, Subgraph, TaskContext, TaskInput } from '../types';
import { LOW_CONFIDENCE_MARKER } from './markers';
import { applyBudgets } from './budgets';
import { renderCallPaths } from './call-paths';
import { assessConfidence, selectEntryPoints } from './entry-points';
import { ContextGraph, expandHierarchies, expandNeighborhoods } from './expansion';
import { addCompoundMatches, addHumpMatches } from './infix-channels';
import { formatContextAsJson, formatContextAsMarkdown } from './renderers';
import { corroborate, demoteTestFiles, favourCoreDirectory, mergeChannels, byScoreDescending } from './rerank';
import { createRequest, type Backend, type Request } from './request';
import { nameSeeds, textSeeds, withDefinitionSeeds } from './seeding';
import { resolveBuildSettings, resolveFindSettings } from './settings';
import { SourceReader, selectCodeBlocks } from './source-reader';
import type { SearchResult } from '../types';

const MAX_SHOWN_DIRECTORIES = 4;
const MAX_SUMMARY_ENTRIES = 3;

/** Candidates from every channel, ranked best first. */
function rankCandidates(req: Request, backend: Backend): SearchResult[] {
  const { queries } = backend;
  const named = withDefinitionSeeds(req, queries, nameSeeds(req, queries));
  const merged = mergeChannels(named, textSeeds(req, queries));

  demoteTestFiles(req, merged);
  favourCoreDirectory(merged, queries);
  corroborate(req, merged, named);

  if (req.symbols.length > 0) {
    const taken = new Set(merged.map((candidate) => candidate.node.id));
    addHumpMatches(req, queries, merged, taken);
    addCompoundMatches(req, queries, merged, taken);
  }
  return merged.sort(byScoreDescending);
}

/** A closing note for answers built on weak matches: admit it, and point at the precise tools. */
function lowConfidenceNote(entryPoints: readonly Node[]): string {
  const directories: string[] = [];
  const seen = new Set<string>();
  for (const { filePath } of entryPoints) {
    const slash = filePath.lastIndexOf('/');
    const directory = slash > 0 ? filePath.slice(0, slash) : filePath;
    if (!seen.has(directory)) {
      seen.add(directory);
      directories.push(directory);
    }
    if (directories.length >= MAX_SHOWN_DIRECTORIES) break;
  }
  const areaLine = directories.length ? `\n- \`afyx_graph_files\` a likely area: ${directories.map((directory) => `\`${directory}\``).join(', ')}` : '';
  return `\n\n${LOW_CONFIDENCE_MARKER}\n\n`
    + 'This query matched mostly on common words, so the entry points above may '
    + 'be off-target — treat them as a starting point, not a complete answer. '
    + 'For a reliable result:\n'
    + '- `afyx_graph_explore` with the **exact symbol names** you are after '
    + '(class / function / method names), or\n'
    + '- `afyx_graph_search <name>` for one specific symbol'
    + areaLine
    + '\n\nDo not assume the list above is comprehensive.';
}

function summarize(subgraph: Subgraph, entryPoints: readonly Node[], fileCount: number): string {
  const names = entryPoints.slice(0, MAX_SUMMARY_ENTRIES).map((node) => node.name).join(', ');
  const more = entryPoints.length > MAX_SUMMARY_ENTRIES ? ` and ${entryPoints.length - MAX_SUMMARY_ENTRIES} more` : '';
  return `Found ${subgraph.nodes.size} relevant code symbols across ${fileCount} files. `
    + `Key entry points: ${names}${more}. `
    + `${subgraph.edges.length} relationships identified.`;
}

export class ContextBuilder {
  private readonly backend: Backend;

  constructor(private readonly projectRoot: string, queries: QueryBuilder, traverser: GraphTraverser) {
    this.backend = { queries, traverser };
  }

  /**
   * The subgraph relevant to a query: entry points from hybrid search, expanded through the
   * graph and trimmed to budget. Blank queries yield an empty subgraph.
   */
  async findRelevantContext(query: string, options: FindRelevantContextOptions = {}): Promise<Subgraph> {
    const settings = resolveFindSettings(options);
    if (!query || query.trim().length === 0) return { nodes: new Map(), edges: [], roots: [] };

    const req = createRequest(query, settings, this.backend.queries);
    const entries = selectEntryPoints(req, this.backend.queries, rankCandidates(req, this.backend));
    const confidence = assessConfidence(req, entries);

    const graph = new ContextGraph();
    for (const { node } of entries) graph.addRoot(node);
    expandHierarchies(graph, entries, settings, this.backend);
    expandNeighborhoods(graph, entries, settings, this.backend);

    const { nodes, edges } = applyBudgets(graph, req, this.backend.queries);
    return { nodes, edges, roots: graph.roots, confidence };
  }

  /** Context for a task, structured (no `format`) or rendered as markdown/json. */
  async buildContext(input: TaskInput, options: BuildContextOptions = {}): Promise<TaskContext | string> {
    const settings = resolveBuildSettings(options);
    const query = typeof input === 'string' ? input : `${input.title}${input.description ? `: ${input.description}` : ''}`;

    const subgraph = await this.findRelevantContext(query, {
      searchLimit: settings.searchLimit,
      traversalDepth: settings.traversalDepth,
      maxNodes: settings.maxNodes,
      minScore: settings.minScore,
    });

    const entryPoints = subgraph.roots.map((id) => subgraph.nodes.get(id)).filter((node): node is Node => node !== undefined);
    const codeBlocks = settings.includeCode
      ? selectCodeBlocks(subgraph, new SourceReader(this.projectRoot), settings.maxCodeBlocks, settings.maxCodeBlockSize)
      : [];
    const relatedFiles = [...new Set([...subgraph.nodes.values()].map((node) => node.filePath))].sort();

    const context: TaskContext = {
      query,
      subgraph,
      entryPoints,
      codeBlocks,
      relatedFiles,
      summary: summarize(subgraph, entryPoints, relatedFiles.length),
      stats: {
        nodeCount: subgraph.nodes.size,
        edgeCount: subgraph.edges.length,
        fileCount: relatedFiles.length,
        codeBlockCount: codeBlocks.length,
        totalCodeSize: codeBlocks.reduce((total, block) => total + block.content.length, 0),
      },
    };

    if (settings.format === 'markdown') {
      // One storage probe for the bounded set of paths that will be rendered.
      const isGenerated = this.backend.queries.generatedPredicateFor([
        ...entryPoints.map((node) => node.filePath),
        ...[...subgraph.nodes.values()].map((node) => node.filePath),
        ...codeBlocks.map((block) => block.filePath),
      ]);
      return formatContextAsMarkdown(context, isGenerated)
        + renderCallPaths(subgraph)
        + (subgraph.confidence === 'low' ? lowConfidenceNote(entryPoints) : '');
    }
    if (settings.format === 'json') return formatContextAsJson(context);
    return context;
  }

  /** Source of one node, or null when the node is unknown or its file is unreadable. */
  async getCode(nodeId: string): Promise<string | null> {
    const node = this.backend.queries.getNodeById(nodeId);
    return node ? new SourceReader(this.projectRoot).read(node) : null;
  }
}

export function createContextBuilder(projectRoot: string, queries: QueryBuilder, traverser: GraphTraverser): ContextBuilder {
  return new ContextBuilder(projectRoot, queries, traverser);
}
