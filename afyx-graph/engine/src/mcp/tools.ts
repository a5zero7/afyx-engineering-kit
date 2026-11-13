import { existsSync, readFileSync } from 'fs';
import { relative as relativePath, resolve as resolvePath } from 'path';
import type AfyxGraph from '../index';
import { findNearestAfyxGraphRoot } from '../directory';
import { PathRefusalError } from '../errors';
import { findAllSymbols } from '../graph/named-symbol-flow';
import { groupDefinitions, matchesSymbol } from '../graph/symbol-lookup';
import {
  detectWorktreeIndexMismatch,
  worktreeMismatchNotice,
  worktreeMismatchWarning,
  type WorktreeIndexMismatch,
} from '../sync/worktree';
import type { Edge, Node, NodeKind } from '../types';
import { validatePathWithinRoot, validateProjectPath } from '../utils';
import { describeSynthesizedEdge, type SynthesizedEdgeNote } from './dynamic-edge-notes';
import { executeExploreTool, getExploreBudget } from './explore-tool';
import { executeFilesTool } from './files-tool';
import {
  DiskDriftMonitor,
  attachFreshnessNotices,
  formatLineNumberedSource,
  prependToolNotice,
} from './freshness-notices';
import { executeImpactTool, type ImpactToolSource } from './impact-tool';
import { executeInventoryTool } from './inventory-tool';
import { executeNodeTool, resolveNodeSymbolMatches } from './node-tool';
import type { QueryPool } from './query-pool';
import { executeRelationshipTool, type RelationshipToolSource } from './relationship-tool';
import { executeSearchTool } from './search-tool';
import { executeStatusTool } from './status-tool';
import {
  AFYX_MCP_TOOL_CATALOG,
  type ToolDefinition,
  type ToolResult,
} from './tool-catalog';
import { dispatchReadTool, type ReadToolHandlers } from './tool-dispatch';
import {
  isToolEnabled,
  requireProjectPath,
  resolveToolRoute,
  selectToolDefinitions,
} from './tool-registry';
import {
  NotIndexedError,
  classifyToolFailure,
  errorToolResult,
  stripInternalToolResult,
} from './tool-results';

export { PathRefusalError } from '../errors';
export {
  EXPLORE_ALLOCATION,
  RELEVANCE_KIND_WEIGHT,
  allocateExploreBudget,
  biasHeaderSymbols,
  formatGapMarker,
  getExploreBudget,
  getExploreOutputBudget,
  joinPartsWithNamedGaps,
  normalizeQuerySpelling,
  symbolsBetweenRanges,
  symbolsNotInRanges,
  type ExploreAllocation,
  type ExploreAllocationCandidate,
  type ExploreOutputBudget,
} from './explore-tool';
export { formatDegradedBanner, formatStaleBanner, formatStaleFooter } from './freshness-notices';
export type { ToolAnnotations, ToolDefinition, ToolResult } from './tool-catalog';
export { NotIndexedError } from './tool-results';

/** Canonical MCP tool definition list exported for server and contract checks. */
export const tools: ToolDefinition[] = AFYX_MCP_TOOL_CATALOG;

type AfyxGraphCtor = typeof import('../index').default;

let injectedGraphCtor: AfyxGraphCtor | null = null;

/** Test hook to inject an already-loaded AfyxGraph class for cross-project opens. */
export function __setLoadAfyxGraphForTests(cls: AfyxGraphCtor | null): void {
  injectedGraphCtor = cls;
}

function loadGraphClass(): AfyxGraphCtor {
  if (injectedGraphCtor) return injectedGraphCtor;
  return (require('../index') as typeof import('../index')).default;
}

const MAX_TEXT_ARG_LENGTH = 10_000;
const MAX_PATH_ARG_LENGTH = 4_096;
const DEFAULT_CATCHUP_WAIT_MS = 3_000;
const TINY_REPO_THRESHOLD = 500;

const TINY_REPO_TOOL_NAMES = new Set([
  'afyx_graph_inventory',
  'afyx_graph_explore',
  'afyx_graph_search',
  'afyx_graph_node',
]);

const CONTAINER_KINDS = new Set<NodeKind>([
  'class',
  'struct',
  'union',
  'interface',
  'trait',
  'protocol',
  'enum',
  'namespace',
  'module',
]);

function readCatchUpTimeoutMs(): number {
  const configured = process.env.AFYX_GRAPH_CATCHUP_GATE_TIMEOUT_MS;
  if (!configured) return DEFAULT_CATCHUP_WAIT_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CATCHUP_WAIT_MS;
  return Math.floor(parsed);
}

/** Static tool surface exposed prior to opening any workspace index. */
export function getStaticTools(): ToolDefinition[] {
  return selectToolDefinitions(tools, process.env.AFYX_GRAPH_MCP_TOOLS);
}

/**
 * Coordinates MCP tool validation, routing, project graph resolution,
 * worker offloading, and freshness/worktree notices.
 */
export class ToolHandler {
  private readonly projectCache = new Map<string, AfyxGraph>();
  private readonly worktreeMismatchCache = new Map<string, WorktreeIndexMismatch | null>();
  private readonly driftMonitor = new DiskDriftMonitor(2_000);

  private defaultProjectHint: string | null = null;
  private knownSubprojects: string[] = [];
  private knownSubprojectsBase: string | null = null;
  private catchUpGate: Promise<void> | null = null;
  private queryPool: QueryPool | null = null;

  private readonly readToolHandlers: ReadToolHandlers = {
    search: (args) => this.handleSearch(args),
    inventory: (args) => this.handleInventory(args),
    callers: (args) => this.handleCallers(args),
    callees: (args) => this.handleCallees(args),
    impact: (args) => this.handleImpact(args),
    explore: (args) => this.handleExplore(args),
    node: (args) => this.handleNode(args),
    files: (args) => this.handleFiles(args),
  };

  constructor(private cg: AfyxGraph | null) {}

  setQueryPool(pool: QueryPool | null): void {
    this.queryPool = pool;
  }

  setDefaultAfyxGraph(cg: AfyxGraph): void {
    this.cg = cg;
  }

  setCatchUpGate(gate: Promise<void> | null): void {
    this.catchUpGate = gate;
  }

  setDefaultProjectHint(searchedPath: string): void {
    this.defaultProjectHint = searchedPath;
  }

  setKnownSubprojects(roots: string[], base: string): void {
    this.knownSubprojects = roots;
    this.knownSubprojectsBase = base;
  }

  hasDefaultAfyxGraph(): boolean {
    return this.cg !== null;
  }

  getTools(): ToolDefinition[] {
    let visible = getStaticTools();
    if (!this.cg) return requireProjectPath(visible);

    try {
      const stats = this.cg.getStats();
      const budget = getExploreBudget(stats.fileCount);
      if (stats.fileCount < TINY_REPO_THRESHOLD) {
        visible = visible.filter((def) => TINY_REPO_TOOL_NAMES.has(def.name));
      }
      const advice =
        ` Source-selection estimate (advisory only, NOT a quota): ${budget} focused calls for ${stats.fileCount.toLocaleString()} indexed files. Further calls remain available.`;
      return visible.map((def) =>
        def.name === 'afyx_graph_explore'
          ? { ...def, description: `${def.description}${advice}` }
          : def,
      );
    } catch {
      return visible;
    }
  }

  closeAll(): void {
    for (const graph of this.projectCache.values()) {
      graph.close();
    }
    this.projectCache.clear();
    this.worktreeMismatchCache.clear();
    this.driftMonitor.clear();
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return stripInternalToolResult(await this.executeRuntime(toolName, args));
  }

  async executeRuntime(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      await this.flushCatchUpGate();

      if (!isToolEnabled(toolName, process.env.AFYX_GRAPH_MCP_TOOLS)) {
        return this.errorResult(`Tool ${toolName} is disabled via AFYX_GRAPH_MCP_TOOLS`);
      }

      const validationErr = this.validateSharedPathArgs(args);
      if (validationErr) return validationErr;

      if (resolveToolRoute(toolName) === 'status') {
        return await this.handleStatus(args);
      }

      const raw =
        this.queryPool?.healthy && this.queryPool.ready
          ? await this.queryPool.run(toolName, args)
          : await this.executeReadTool(toolName, args);

      const projectPath = args.projectPath as string | undefined;
      return this.withStalenessNotice(
        this.withWorktreeNotice(raw, projectPath),
        projectPath,
      );
    } catch (err) {
      return classifyToolFailure(err);
    }
  }

  async executeReadTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return dispatchReadTool(toolName, args, this.readToolHandlers);
  }

  matchesSymbol(node: Node, symbol: string): boolean {
    return matchesSymbol(node, symbol);
  }

  findSymbolMatches(cg: AfyxGraph, symbol: string): Node[] {
    return resolveNodeSymbolMatches(cg, symbol);
  }

  private async flushCatchUpGate(): Promise<void> {
    const pending = this.catchUpGate;
    if (!pending) return;
    this.catchUpGate = null;

    const timeoutMs = readCatchUpTimeoutMs();
    if (timeoutMs <= 0) {
      try {
        await pending;
      } catch {
        // Reconcile errors are logged by the engine; continue with best-effort reads.
      }
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref?.();
    });

    try {
      const result = await Promise.race([
        pending.then(() => 'settled' as const, () => 'settled' as const),
        deadline,
      ]);
      if (result === 'timeout') {
        process.stderr.write(
          `[Afyx Graph MCP] Catch-up reconciliation exceeded the wait window of ${timeoutMs}ms; ` +
            'serving this tool call now and finishing the reconcile in the background. ' +
            'Use AFYX_GRAPH_CATCHUP_GATE_TIMEOUT_MS=0 when reconciliation must complete before serving.\n',
        );
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private validateSharedPathArgs(args: Record<string, unknown>): ToolResult | null {
    for (const field of ['projectPath', 'path', 'pattern'] as const) {
      const checked = this.validateOptionalPath(args[field], field);
      if (typeof checked === 'object') return checked;
    }
    return null;
  }

  private validateString(
    value: unknown,
    name: string,
    maxLength: number = MAX_TEXT_ARG_LENGTH,
  ): string | ToolResult {
    if (typeof value !== 'string' || value.length === 0) {
      return this.errorResult(`${name} must be a non-empty string`);
    }
    if (value.length > maxLength) {
      return this.errorResult(
        `${name} exceeds maximum length of ${maxLength} characters (got ${value.length})`,
      );
    }
    return value;
  }

  private validateOptionalPath(value: unknown, name: string): string | undefined | ToolResult {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      return this.errorResult(`${name} must be a string`);
    }
    if (value.length > MAX_PATH_ARG_LENGTH) {
      return this.errorResult(
        `${name} exceeds maximum length of ${MAX_PATH_ARG_LENGTH} characters (got ${value.length})`,
      );
    }
    return value;
  }

  private formatSubprojectHint(): string {
    if (this.knownSubprojects.length === 0) return '';
    const base = this.knownSubprojectsBase;
    const displayPaths = this.knownSubprojects.map((root) =>
      base ? relativePath(base, root) || '.' : root,
    );
    return (
      `Indexed sub-projects were found below it: ${displayPaths.join(', ')} — ` +
      'Select one with projectPath; use an absolute path or resolve it from the discovery directory.\n'
    );
  }

  private buildMissingDefaultError(): NotIndexedError {
    const searched = this.defaultProjectHint ?? process.cwd();
    const guidance = [
      'No Afyx Graph project is loaded for this session.',
      `Root discovery started at: ${searched}`,
      this.formatSubprojectHint().trimEnd(),
      'The launch directory may lack an index, or the client may not have supplied its workspace root.',
      'Pass projectPath to select an indexed project explicitly. An absolute directory avoids ambiguity; relative paths use the server root.',
      'For a fixed server project, configure arguments such as ["serve", "--mcp", "--path", "/absolute/project"].',
      'Use built-in tools (Read/Grep/Glob) for source that has no index. A user can prepare one with afyx-graph init.',
      'The same session can query another indexed project by supplying its projectPath.',
    ];
    return new NotIndexedError(guidance.filter(Boolean).join('\n'));
  }

  private getAfyxGraph(projectPath?: string): AfyxGraph {
    if (!projectPath) {
      if (!this.cg) throw this.buildMissingDefaultError();
      return this.reopenIfReplaced(this.cg);
    }

    if (existsSync(projectPath)) {
      const refusal = validateProjectPath(projectPath);
      if (refusal) throw new PathRefusalError(refusal);
    }

    const indexRoot = findNearestAfyxGraphRoot(projectPath);
    if (!indexRoot) {
      throw new NotIndexedError(
        `The project at ${projectPath} isn't indexed with afyx-graph (no .afyx-graph/ directory found ` +
          'walking up from it), so afyx-graph cannot query it. Use your built-in tools (Read/Grep/Glob) ' +
          "for that codebase instead, and don't call afyx-graph for it again this session. " +
          "Indexing is the user's decision — they can run 'afyx-graph init' in that project to enable it.",
      );
    }

    if (this.cg && this.cg.getProjectRoot() === indexRoot) {
      return this.reopenIfReplaced(this.cg);
    }

    const existing = this.projectCache.get(indexRoot);
    if (existing) return this.reopenIfReplaced(existing);

    const opened = loadGraphClass().openSync(indexRoot);
    this.projectCache.set(indexRoot, opened);
    return opened;
  }

  private reopenIfReplaced(graph: AfyxGraph): AfyxGraph {
    try {
      if (graph.reopenIfReplaced()) {
        process.stderr.write(
          '[Afyx Graph MCP] A replacement index was detected for this project root; ' +
            'the active database connection was reopened.\n',
        );
      }
    } catch {
      // Best-effort refresh; preserve existing handle on failure.
    }
    return graph;
  }

  private preferWatchedDefault(resolved: AfyxGraph): AfyxGraph {
    if (!this.cg || resolved === this.cg) return resolved;
    try {
      if (resolvePath(this.cg.getProjectRoot()) === resolvePath(resolved.getProjectRoot())) {
        return this.cg;
      }
    } catch {
      // Handle may have been closed; keep caller-supplied graph.
    }
    return resolved;
  }

  private worktreeMismatchFor(projectPath?: string): WorktreeIndexMismatch | null {
    const startPath = projectPath ?? this.defaultProjectHint ?? process.cwd();
    let indexRoot: string;
    try {
      indexRoot = this.getAfyxGraph(projectPath).getProjectRoot();
    } catch {
      return null;
    }

    const cacheKey = `${startPath}\u0000${indexRoot}`;
    const cached = this.worktreeMismatchCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const mismatch = detectWorktreeIndexMismatch(startPath, indexRoot);
    this.worktreeMismatchCache.set(cacheKey, mismatch);
    return mismatch;
  }

  private withWorktreeNotice(result: ToolResult, projectPath?: string): ToolResult {
    if (result.isError) return result;
    const mismatch = this.worktreeMismatchFor(projectPath);
    return mismatch ? prependToolNotice(result, worktreeMismatchNotice(mismatch)) : result;
  }

  private withStalenessNotice(result: ToolResult, projectPath?: string): ToolResult {
    if (result.isError) return result;
    let graph: AfyxGraph;
    try {
      graph = this.getAfyxGraph(projectPath);
    } catch {
      return result;
    }
    return attachFreshnessNotices(result, this.preferWatchedDefault(graph));
  }

  private isFileStaleOnDisk(cg: AfyxGraph, relPath: string, content?: string): boolean {
    return this.driftMonitor.isDrifted(cg, relPath, content);
  }

  private synthEdgeNote(edge: Edge | null): SynthesizedEdgeNote | null {
    return describeSynthesizedEdge(edge);
  }

  private groupDefinitions(
    nodes: Node[],
    fileFilter: string | undefined,
  ): { groups: Node[][]; filteredOut: boolean } {
    return groupDefinitions(nodes, fileFilter);
  }

  private findAllSymbols(cg: AfyxGraph, symbol: string): { nodes: Node[]; note: string } {
    return findAllSymbols(cg, symbol);
  }

  private relationshipToolSource(cg: AfyxGraph): RelationshipToolSource {
    return {
      resolveSymbols: (symbol) => this.findAllSymbols(cg, symbol),
      groupDefinitions: (nodes, fileFilter) => this.groupDefinitions(nodes, fileFilter),
      getCallers: (nodeId) => cg.getCallers(nodeId),
      getCallees: (nodeId) => cg.getCallees(nodeId),
    };
  }

  private impactToolSource(cg: AfyxGraph): ImpactToolSource {
    return {
      resolveSymbols: (symbol) => this.findAllSymbols(cg, symbol),
      groupDefinitions: (nodes, fileFilter) => this.groupDefinitions(nodes, fileFilter),
      getImpactRadius: (nodeId, depth) => cg.getImpactRadius(nodeId, depth),
    };
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const query = this.validateString(args.query, 'query');
    if (typeof query !== 'string') return query;
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeSearchTool(cg, {
      query,
      kind: args.kind as string | undefined,
      limit: args.limit,
    });
  }

  private async handleInventory(args: Record<string, unknown>): Promise<ToolResult> {
    const declaration = this.validateString(args.declaration, 'declaration');
    if (typeof declaration !== 'string') return declaration;
    const value = this.validateString(args.value, 'value');
    if (typeof value !== 'string') return value;
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeInventoryTool(cg, {
      declaration,
      value,
      path: args.path as string | undefined,
      offset: args.offset,
      limit: args.limit,
    });
  }

  private async handleCallers(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeRelationshipTool(
      this.relationshipToolSource(cg),
      { symbol, file: args.file, limit: args.limit },
      'callers',
    );
  }

  private async handleCallees(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeRelationshipTool(
      this.relationshipToolSource(cg),
      { symbol, file: args.file, limit: args.limit },
      'callees',
    );
  }

  private async handleImpact(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeImpactTool(this.impactToolSource(cg), {
      symbol,
      depth: args.depth,
      file: args.file,
    });
  }

  private async handleExplore(args: Record<string, unknown>): Promise<ToolResult> {
    const rawQuery = this.validateString(args.query, 'query');
    if (typeof rawQuery !== 'string') return rawQuery;
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeExploreTool(cg, rawQuery, args, {
      isFileStaleOnDisk: (graph, filePath, content) => this.isFileStaleOnDisk(graph, filePath, content),
      numberSourceLines: formatLineNumberedSource,
      synthEdgeNote: (edge) => this.synthEdgeNote(edge),
    });
  }

  private async handleNode(args: Record<string, unknown>): Promise<ToolResult> {
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeNodeTool(cg, args, {
      validateSymbol: (value) => this.validateString(value, 'symbol'),
      isFileStale: (filePath) => this.isFileStaleOnDisk(cg, filePath),
      readCurrentFile: (filePath) => {
        const absolute = validatePathWithinRoot(cg.getProjectRoot(), filePath);
        if (!absolute) return null;
        try {
          return readFileSync(absolute, 'utf-8');
        } catch {
          return null;
        }
      },
      numberSourceLines: formatLineNumberedSource,
      synthEdgeLabel: (edge) => this.synthEdgeNote(edge)?.compact ?? null,
      isContainerKind: (kind) => CONTAINER_KINDS.has(kind),
    });
  }

  private async handleStatus(args: Record<string, unknown>): Promise<ToolResult> {
    const projectPath = args.projectPath as string | undefined;
    const graph = this.preferWatchedDefault(this.getAfyxGraph(projectPath));
    const mismatch = this.worktreeMismatchFor(projectPath);
    return executeStatusTool(graph, {
      worktreeWarning: mismatch ? worktreeMismatchWarning(mismatch) : undefined,
      nowMs: Date.now(),
    });
  }

  private async handleFiles(args: Record<string, unknown>): Promise<ToolResult> {
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeFilesTool(cg, {
      path: args.path as string | undefined,
      pattern: args.pattern as string | undefined,
      format: args.format,
      includeMetadata: args.includeMetadata,
      maxDepth: args.maxDepth,
    });
  }

  private errorResult(message: string): ToolResult {
    return errorToolResult(message);
  }
}
