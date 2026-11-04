/**
 * MCP Tool Definitions
 *
 * Defines the tools exposed by the Afyx Graph MCP server.
 */

import type AfyxGraph from '../index';
import type { QueryPool } from './query-pool';
import { findNearestAfyxGraphRoot } from '../directory';
// Lazy-load the heavy Afyx Graph chain off the MCP startup path — see the same
// helper in engine.ts. ToolHandler must load to answer tools/list (static
// schemas), but it must NOT drag in sqlite/query layers before the daemon binds;
// Afyx Graph is pulled in only when a tool actually opens a project. require() is
// sync + cached (CommonJS build).
const loadAfyxGraph = (): typeof import('../index').default =>
  loadAfyxGraphForTests ?? (require('../index') as typeof import('../index')).default;
// Test seam (same pattern as the watcher's `__setFsWatchForTests`): vitest's
// module transform can't service the lazy `require('../index')` above, so
// in-process tests that exercise a genuine cross-project open (an explicit
// `projectPath` to a different project — issue #1474's repro shape) inject the
// already-imported class here. Never set outside tests.
let loadAfyxGraphForTests: typeof import('../index').default | null = null;
export function __setLoadAfyxGraphForTests(cls: typeof import('../index').default | null): void {
  loadAfyxGraphForTests = cls;
}
import {
  detectWorktreeIndexMismatch,
  worktreeMismatchWarning,
  worktreeMismatchNotice,
  type WorktreeIndexMismatch,
} from '../sync/worktree';
import type { PendingFile } from '../sync';
import type { Node, Edge, NodeKind } from '../types';
import { groupDefinitions, matchesSymbol } from '../graph/symbol-lookup';
import {
  existsSync,
  readFileSync,
  statSync,
} from 'fs';
import { createHash } from 'crypto';
import { validatePathWithinRoot, validateProjectPath } from '../utils';
import { findAllSymbols } from '../graph/named-symbol-flow';
import {
  type ExploreEmission,
} from './explore-session-state';
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
import { dispatchReadTool, type ReadToolHandlers } from './tool-dispatch';
import { executeSearchTool } from './search-tool';
import { executeInventoryTool } from './inventory-tool';
import { executeFilesTool } from './files-tool';
import { executeRelationshipTool, type RelationshipToolSource } from './relationship-tool';
import { executeImpactTool, type ImpactToolSource } from './impact-tool';
import { executeNodeTool, resolveNodeSymbolMatches } from './node-tool';
import { executeStatusTool } from './status-tool';
import { executeExploreTool, getExploreBudget } from './explore-tool';
export {
  normalizeQuerySpelling,
  getExploreBudget,
  getExploreOutputBudget,
  RELEVANCE_KIND_WEIGHT,
  EXPLORE_ALLOCATION,
  allocateExploreBudget,
  symbolsBetweenRanges,
  symbolsNotInRanges,
  formatGapMarker,
  joinPartsWithNamedGaps,
  biasHeaderSymbols,
} from './explore-tool';
export type { ExploreOutputBudget, ExploreAllocationCandidate, ExploreAllocation } from './explore-tool';

export { NotIndexedError } from './tool-results';

/**
 * An expected, recoverable "afyx-graph can't serve this" condition — most
 * importantly a project with no index. The dispatch catch converts these to
 * SUCCESS-shaped responses (guidance text, NO isError): an `isError: true`
 * early in a session teaches the agent the toolset is broken and it stops
 * calling afyx-graph entirely (observed repeatedly), which is exactly wrong
 * for conditions the agent can simply work around (use built-in tools for
 * that codebase / pass projectPath). isError is reserved for "stop trying"
 * cases: security refusals ({@link PathRefusalError}) and genuine
 * malfunctions.
 */
/**
 * A security refusal (sensitive system path). Stays `isError: true` WITHOUT
 * retry guidance — abandoning this path is the desired agent reaction.
 *
 * Defined in `../errors` so non-MCP read sinks (the `afyx-graph ui` server) can
 * enforce the same refusal without importing this module; re-exported here
 * because this is where every existing caller imports it from.
 */
export { PathRefusalError } from '../errors';
import { PathRefusalError } from '../errors';
import { resolve as resolvePath, relative as relativePath } from 'path';

/**
 * Maximum length for free-form string inputs (query, task, symbol).
 * Bounds memory and CPU when a buggy or hostile MCP client sends a
 * huge payload — without this an attacker could ship a 100MB string
 * and force a full FTS5 scan / OOM the server. 10 000 characters is
 * far beyond any realistic legitimate query.
 */
const MAX_INPUT_LENGTH = 10_000;

/**
 * Maximum length for path-like string inputs (projectPath, path
 * filter, glob pattern). Paths beyond a few thousand chars are
 * never legitimate and signal abuse or a bug upstream.
 */
const MAX_PATH_LENGTH = 4_096;

/**
 * Node kinds that contain other symbols. For these, `afyx_graph_node` with
 * `includeCode=true` returns a structural outline (member names + signatures
 * + line numbers) instead of the full body, which for a large class is a
 * multi-thousand-character wall of source that bloats the agent's context.
 */
const CONTAINER_NODE_KINDS = new Set<NodeKind>([
  'class', 'struct', 'union', 'interface', 'trait', 'protocol', 'enum', 'namespace', 'module',
]);


/**
 * How long the FIRST tool call waits on the post-open catch-up reconcile before
 * giving up and serving anyway (issue #905). On a normal repo the reconcile
 * finishes in well under this, so the gate is fully honored and nothing changes.
 * On a very large repo (~100k files) the reconcile takes minutes — blocking the
 * first call on all of it presents as a multi-minute hang — so we wait briefly
 * for a clean answer, then serve and let the reconcile finish in the background
 * (it yields to the event loop, so a concurrent read still runs).
 *
 * `AFYX_GRAPH_CATCHUP_GATE_TIMEOUT_MS` overrides the default; `0` restores the
 * old unbounded-wait behavior (always block until the reconcile completes).
 */
const DEFAULT_CATCHUP_GATE_TIMEOUT_MS = 3000;
function resolveCatchUpGateTimeoutMs(): number {
  const raw = process.env.AFYX_GRAPH_CATCHUP_GATE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_CATCHUP_GATE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CATCHUP_GATE_TIMEOUT_MS;
  return Math.floor(n);
}

/**
 * Prefix each line of a source slice with its 1-based line number, matching
 * the Read tool's `cat -n` convention (number + tab) so the agent treats it
 * the same way it treats Read output.
 *
 * @param slice  contiguous source text (already extracted from the file)
 * @param firstLineNumber  the 1-based line number of the slice's first line
 */
function numberSourceLines(slice: string, firstLineNumber: number): string {
  const out: string[] = [];
  const split = slice.split('\n');
  for (let i = 0; i < split.length; i++) {
    out.push(`${firstLineNumber + i}\t${split[i]}`);
  }
  return out.join('\n');
}

/**
 * Unique line-prefix for a per-file source section in afyx_graph_explore output.
 * Issue #778: tool results dropped ATX headings (`####`, `##`, `###`) for bold
 * labels so Markdown-rendering MCP clients (e.g. the Claude Code VSCode
 * extension) stop blowing every header up to H1–H4. The path is bold + a code
 * span so it still reads as a header, and the leading ``**` `` stays a UNIQUE,
 * greppable marker — no other explore line begins with it — that the explore
 * truncation boundary (`handleExplore`) keys off to cut on whole file sections.
 */

/**
 * Per-file staleness banner emitted at the top of a tool response when the
 * file watcher has pending events for files referenced by the response.
 * The agent uses this to fall back to Read for those specific files
 * without waiting for the debounced sync (issue #403).
 */
export function formatStaleBanner(stale: PendingFile[]): string {
  const now = Date.now();
  const lines = stale.map((p) => {
    const ageMs = Math.max(0, now - p.lastSeenMs);
    const label = p.indexing ? 'indexing in progress' : 'pending sync';
    return `  - ${p.path} (edited ${ageMs}ms ago, ${label})`;
  });
  return (
    '⚠️ Some files referenced below were edited since the last index sync — ' +
    'their afyx-graph entries may be stale:\n' +
    lines.join('\n') +
    '\nFor accurate content of those specific files, Read them directly. ' +
    'The rest of this response is fresh.'
  );
}

/**
 * Compact footer listing pending files that are NOT referenced in this
 * response. Gives the agent a complete project-wide freshness picture
 * without bloating the main banner.
 */
export function formatStaleFooter(stale: PendingFile[]): string {
  const MAX = 5;
  const now = Date.now();
  const shown = stale.slice(0, MAX);
  const lines = shown.map((p) => {
    const ageMs = Math.max(0, now - p.lastSeenMs);
    return `  - ${p.path} (edited ${ageMs}ms ago)`;
  });
  const more = stale.length > MAX ? `\n  - …and ${stale.length - MAX} more` : '';
  return (
    `(Note: ${stale.length} file(s) elsewhere in this project are pending index ` +
    `sync but were not referenced above:\n${lines.join('\n')}${more})`
  );
}

/**
 * Whole-index degradation banner (issue #876). Emitted at the top of a read
 * tool response when live watching has permanently stopped — at which point
 * `getPendingFiles()` is empty, so the per-file banner above can't fire even
 * though the index is now FROZEN and silently drifting stale. Leads with the
 * agent-actionable instruction (Read directly) and carries the reason, which
 * already names the operator remedy (`afyx-graph sync` / git hooks).
 */
export function formatDegradedBanner(reason: string | null): string {
  return (
    '⚠️ Afyx Graph auto-sync is DISABLED — live file watching stopped, so the index is ' +
    'frozen and any file edited since then is stale here. Read files directly to confirm ' +
    'current content before relying on it.' +
    (reason ? `\n  Reason: ${reason}` : '')
  );
}

/**
 * MCP Tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
  /** Behavioral hints for clients (see {@link ToolAnnotations}). */
  annotations?: ToolAnnotations;
  /**
   * MCP `_meta` on the tool definition. `anthropic/alwaysLoad: true` makes
   * Claude Code load the tool at session start instead of deferring it behind
   * its tool search (https://code.claude.com/docs/en/mcp#exempt-a-server-from-deferral).
   */
  _meta?: Record<string, unknown>;
}

/**
 * MCP ToolAnnotations — behavioral hints a client MAY use to decide how, or
 * whether, to run a tool (introduced in the 2025-03-26 spec, carried in
 * 2025-06-18). They are advisory and never to be trusted for security, but
 * clients gate on them: Cursor's Ask mode, for one, refuses any MCP tool that
 * doesn't advertise `readOnlyHint: true` (issue #1018).
 *
 * The field is purely additive — a client that predates annotations ignores it
 * — so afyx-graph advertises these even though `initialize` still negotiates the
 * 2024-11-05 protocol version.
 *
 * https://modelcontextprotocol.io/specification/2025-06-18/schema#toolannotations
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool. */
  title?: string;
  /** If true, the tool does not modify its environment. Default (unset): false. */
  readOnlyHint?: boolean;
  /** Meaningful only when NOT read-only: may the tool perform destructive updates? */
  destructiveHint?: boolean;
  /** If true, repeat calls with the same arguments have no additional effect. */
  idempotentHint?: boolean;
  /** If true, the tool interacts with an open world of external entities. */
  openWorldHint?: boolean;
}

interface PropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  /**
   * INTERNAL side-channel: what a `afyx_graph_explore` call actually put
   * on the wire — files, line ranges, bytes. It rides the result because the
   * call may have run on a query-pool worker, while the session state it feeds
   * lives on the main thread. The owning Afyx session context records and
   * removes it before the result reaches the client.
   */
  _afyxExploreEmission?: ExploreEmission;
}

/**
 * Common projectPath property for cross-project queries
 */
const projectPathProperty: PropertySchema = {
  type: 'string',
  description: 'Absolute path to the project to query (or any directory inside it) — afyx-graph uses the nearest .afyx-graph/ index at or above that path. Omit to use this session\'s default project. Pass it to query a second codebase, or when the server root has no index of its own (e.g. a monorepo where only sub-projects are indexed, so there is no default project).',
};

/**
 * EVERY afyx-graph tool is query-only: it reads the pre-built index and never
 * mutates the workspace (indexing is the user's explicit CLI call, never the
 * agent's). Advertising this read-only contract lets clients that gate on it run
 * the tools where a possibly-mutating tool would be blocked — most concretely,
 * Cursor's Ask mode, which rejects any MCP tool lacking `readOnlyHint: true`
 * (issue #1018). `idempotentHint`: a repeated query has no additional effect.
 * `openWorldHint: false`: the domain is the closed local index, not an open
 * external world. Shared so the contract is declared once; a hypothetical
 * mutating tool would simply not reference it.
 */
const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * All Afyx Graph MCP tools
 *
 * Designed for minimal context usage - use afyx_graph_explore as the primary tool
 * (one call usually answers the whole question), and only use other tools for
 * targeted follow-up queries.
 *
 * All tools support cross-project queries via the optional `projectPath` parameter.
 */
export const tools: ToolDefinition[] = [
  {
  name: 'afyx_graph_search',
    description: 'Quick ranked symbol-metadata search by name. Returns bounded locations only (no code), not an exhaustive source-text or declaration inventory; truncated responses say how to widen them. Use afyx_graph_explore instead to get the actual source / understand an area in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name or partial name (e.g., "auth", "signIn", "UserService")',
        },
        kind: {
          type: 'string',
          description: 'Filter by node kind',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        limit: {
          type: 'number',
          description: 'Maximum displayed results (default: 10, maximum: 100). The response reports when more ranked matches exist.',
          default: 10,
        },
        projectPath: projectPathProperty,
      },
      required: ['query'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'afyx_graph_inventory',
    description: 'Exact, bounded inventory of indexed Python class assignments with a source-grounded literal value. Use for exhaustive count/list questions such as classes declaring `_inherit = "sale.order"`; unlike ranked search, it reports total matches, pagination, index coverage, unsupported expressions, and exclusions. Static source facts do not imply the Odoo runtime registry.',
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'string',
          description: 'Exact class-assignment name, for example `_inherit` or `_name`.',
        },
        value: {
          type: 'string',
          description: 'Exact string literal value to enumerate, for example `sale.order`.',
        },
        path: {
          type: 'string',
          description: 'Optional project-relative scope such as `addons` or `src/addons`.',
        },
        offset: {
          type: 'number',
          description: 'Zero-based result offset for bounded pagination (default: 0).',
          default: 0,
        },
        limit: {
          type: 'number',
          description: 'Maximum declarations returned (default: 100, maximum: 200). A truncated page is explicitly marked incomplete.',
          default: 100,
        },
        projectPath: projectPathProperty,
      },
      required: ['declaration', 'value'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
  name: 'afyx_graph_callers',
    description: 'List functions that call <symbol>. For the full flow, use afyx_graph_explore.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callers for',
        },
        file: {
          type: 'string',
          description: 'Narrow to the definition in this file (path or suffix) when several same-named symbols exist (e.g. one UserService per app in a monorepo)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callers to return (default: 20)',
          default: 20,
        },
        projectPath: projectPathProperty,
      },
      required: ['symbol'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
  name: 'afyx_graph_callees',
    description: 'List functions that <symbol> calls. For the full flow, use afyx_graph_explore.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callees for',
        },
        file: {
          type: 'string',
          description: 'Narrow to the definition in this file (path or suffix) when several same-named symbols exist',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callees to return (default: 20)',
          default: 20,
        },
        projectPath: projectPathProperty,
      },
      required: ['symbol'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
  name: 'afyx_graph_impact',
    description: 'List symbols affected by changing <symbol>. Use before a refactor.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to analyze impact for',
        },
        file: {
          type: 'string',
          description: 'Narrow to the definition in this file (path or suffix) when several same-named symbols exist',
        },
        depth: {
          type: 'number',
          description: 'How many levels of dependencies to traverse (default: 2)',
          default: 2,
        },
        projectPath: projectPathProperty,
      },
      required: ['symbol'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
  name: 'afyx_graph_node',
    description: 'Two modes. (1) READ A FILE — use INSTEAD of the Read tool: pass `file` (a path or basename) with no `symbol` and it returns that file\'s current on-disk source with line numbers, exactly the shape Read gives you (`<n>\\t<line>`, safe to Edit from), narrowable with `offset`/`limit` just like Read — PLUS a one-line note of which files depend on it. Same bytes as Read, faster (served from the index), with the blast radius attached. Use it whenever you would Read a source file. (2) ONE SYMBOL you can name — its location, signature, verbatim source (includeCode=true) and caller/callee trail in one call, so before changing it you see what calls it and what your edit would break. For an AMBIGUOUS name it returns EVERY matching definition\'s body in one call (so you never Read a file to find the right overload); pass `file`/`line` to pin one. Use afyx_graph_explore for several related symbols or the full flow.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to read (symbol mode). Omit it and pass `file` alone to read a whole file like Read.',
        },
        includeCode: {
          type: 'boolean',
          description: 'Symbol mode: include the symbol\'s full body (default: false). Ignored in file mode, which always returns source unless `symbolsOnly` is set.',
          default: false,
        },
        file: {
          type: 'string',
          description: 'A file path or basename (e.g. "harness.rs", "src/auth/session.ts"). Pass it ALONE (no symbol) to READ the file like the Read tool — its full source with line numbers + which files depend on it. Or pass it WITH a symbol to disambiguate an overloaded name to the definition in this file.',
        },
        offset: {
          type: 'number',
          description: 'File mode: 1-based line to start reading from, exactly like Read\'s offset. Defaults to the start of the file.',
        },
        limit: {
          type: 'number',
          description: 'File mode: maximum number of lines to return, exactly like Read\'s limit. Defaults to the whole file (capped at 2000 lines, like Read).',
        },
        symbolsOnly: {
          type: 'boolean',
          description: 'File mode: return just the file\'s symbol map + dependents (a cheap structural overview) instead of its source.',
          default: false,
        },
        line: {
          type: 'number',
          description: 'Symbol mode only: disambiguate to the definition at/around this line (use with the file:line a trail showed you).',
        },
        projectPath: projectPathProperty,
      },
      required: [],
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
  name: 'afyx_graph_explore',
    description: 'Ranked relational/source exploration for how code works, architecture, flow, impact, or an area being changed. Returns verbatim source of relevant symbols grouped by file in one capped call plus paths among them. It is intentionally ranked and bounded: NEVER use it as an exhaustive declaration inventory; use afyx_graph_inventory for supported exact class-assignment counts/lists, or direct source inspection when the requested fact is unsupported or index coverage is limited.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol names, file names, or short code terms for ranked relational exploration. For a flow question, name the symbols spanning the flow. A natural-language question works too; exact inventory/count requests belong to afyx_graph_inventory.',
        },
        maxFiles: {
          type: 'number',
          description: 'Maximum number of files to include source code from (default: 12)',
          default: 12,
        },
        projectPath: projectPathProperty,
      },
      required: ['query'],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    // Loaded from the first prompt in Claude Code, which otherwise defers every
    // MCP tool behind a ToolSearch step (#1696).
    _meta: { 'anthropic/alwaysLoad': true },
  },
  {
  name: 'afyx_graph_status',
    description: 'Index health check (files / nodes / edges). Skip unless debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathProperty,
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
  name: 'afyx_graph_files',
    description: 'Indexed file tree with language + symbol counts. Faster than Glob for project layout.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Filter to files under this directory path (e.g., "src/components"). Returns all files if not specified.',
        },
        pattern: {
          type: 'string',
          description: 'Filter files matching this glob pattern (e.g., "*.tsx", "**/*.test.ts")',
        },
        format: {
          type: 'string',
          description: 'Output format: "tree" (hierarchical, default), "flat" (simple list), "grouped" (by language)',
          enum: ['tree', 'flat', 'grouped'],
          default: 'tree',
        },
        includeMetadata: {
          type: 'boolean',
          description: 'Include file metadata like language and symbol count (default: true)',
          default: true,
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum directory depth to show (default: unlimited)',
        },
        projectPath: projectPathProperty,
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

/**
 * Return `defs` with `projectPath` marked `required` in each tool's inputSchema.
 *
 * Used for the NO-DEFAULT-PROJECT tool surface (issue #993): when the MCP server
 * has no default project to fall back to — a gateway server started outside any
 * repo, or a monorepo root whose `.afyx-graph/` indexes live only in sub-projects
 * — every call MUST carry an explicit `projectPath`, so the schema should say so.
 * A `required` field is a HIGH-salience channel (MCP clients surface and often
 * validate it), unlike the instructions text the reporter found too weak to stop
 * the agent omitting the param. When a default project IS open, callers leave
 * projectPath optional and never call this.
 *
 * Pure: clones each tool's schema rather than mutating the shared module-level
 * `tools` array (reused by every session and the static surface). A tool that
 * doesn't expose projectPath, or already requires it, is returned untouched;
 * explore's `['query']` becomes `['query', 'projectPath']`, and a tool with no
 * `required` list (status/files) gains `['projectPath']`.
 */
/**
 * Allowlist-filtered tool definitions WITHOUT an engine — the static surface the
 * proxy answers `tools/list` with before any project is open. Mirrors
 * `ToolHandler.getTools()` in the no-index case (the dynamic per-repo budget
 * note in a description only adds once `cg` is loaded; the schemas are static).
 */
export function getStaticTools(): ToolDefinition[] {
  return selectToolDefinitions(tools, process.env.AFYX_GRAPH_MCP_TOOLS);
}

/**
 * The MCP tools served by default are the two distinct correctness routes:
 * `afyx_graph_inventory` for exact supported declaration enumeration and
 * `afyx_graph_explore` for ranked relational/source context. Every other tool is
 * a narrower slice and remains unlisted unless explicitly allowlisted.
 *
 * The other defined tools (`node`, `search`, `callers`, plus callees/impact/files/
 * status) remain fully functional — handlers stay, the library API and CLI are
 * untouched, and `AFYX_GRAPH_MCP_TOOLS=explore,node,...` re-enables any of them.
 */
/**
 * Tool handler that executes tools against an Afyx Graph instance
 *
 * Supports cross-project queries via the projectPath parameter.
 * Other projects are opened on-demand and cached for performance.
 */
export class ToolHandler {
  // Cache of opened Afyx Graph instances for cross-project queries
  private projectCache: Map<string, AfyxGraph> = new Map();
  // The directory the server last searched for a default project. Surfaced in
  // the "not initialized" error so users can see why detection missed.
  private defaultProjectHint: string | null = null;
  // Indexed sub-projects the engine's bounded down-scan saw below the search
  // base when no default project resolved (#1607). Listed in the "not
  // initialized" error so the fact is reachable through the protocol, not just
  // the host's stderr capture. Engine-maintained (initial resolve + throttled
  // retry) — tool calls themselves never scan.
  private knownSubprojects: string[] = [];
  private knownSubprojectsBase: string | null = null;
  // Per-start-path cache of the git worktree/index mismatch (issue #155). The
  // mismatch is a fixed property of (where the request came from → which
  // .afyx-graph/ it resolves to), so the up-to-two `git rev-parse` spawns run
  // once and every later tool call reuses the result — never shelling out to
  // git on the hot path. `undefined` = not computed yet; `null` = no mismatch.
  private worktreeMismatchCache: Map<string, WorktreeIndexMismatch | null> = new Map();
  // Gate that the MCP engine pokes after `cg.open()` so the first tool call
  // blocks on the post-open filesystem reconcile (catch-up sync). Without
  // this, a tool call that races past `catchUpSync()` serves rows for files
  // that were deleted (or edited) while no MCP server was running — and the
  // per-file staleness banner can't help, because `getPendingFiles()` is
  // populated by the watcher, not by catch-up. The wait is time-boxed
  // (see {@link resolveCatchUpGateTimeoutMs}) so a minutes-long reconcile on a
  // huge repo can't hang the first call (#905); cleared on first await so
  // subsequent calls don't pay any cost.
  private catchUpGate: Promise<void> | null = null;
  // Optional worker-thread pool for off-loop read-tool dispatch (daemon mode).
  // When set + healthy, the heavy read tools run on a worker so the daemon's
  // main loop stays free for the MCP transport under concurrent load. Null in
  // direct/in-process mode (one client, no concurrency to parallelize).
  private queryPool: QueryPool | null = null;
  /** Stable explicit dependencies for worker-safe read-tool dispatch. */
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

  /**
   * Engine-only: attach (or detach with null) the worker-thread query pool. The
   * shared daemon sets this once its default project is open; the workers each
   * hold their own WAL read connection and run {@link executeReadTool}. A
   * worker's own ToolHandler never has a pool, so there is no nested off-loading.
   */
  setQueryPool(pool: QueryPool | null): void {
    this.queryPool = pool;
  }

  /**
   * Update the default Afyx Graph instance (e.g. after lazy initialization)
   */
  setDefaultAfyxGraph(cg: AfyxGraph): void {
    this.cg = cg;
  }

  /**
   * Engine-only: register the catch-up sync promise so the next `execute()`
   * call awaits it before serving. The handler swallows rejections (the
   * engine logs them) so a sync failure never propagates as a tool error;
   * we still want to serve a best-effort result over the same potentially-
   * stale data, which is what would have happened without the gate.
   */
  setCatchUpGate(p: Promise<void> | null): void {
    this.catchUpGate = p;
  }

  /**
   * Await the catch-up gate, but no longer than the configured timeout (#905).
   * If the reconcile settles first, we got the fully-reconciled answer. If the
   * timeout wins, we serve the call now and let the reconcile finish in the
   * background — it yields to the event loop (see SYNC_RECONCILE_YIELD_INTERVAL),
   * so a concurrent read still runs against the same connection. Never throws:
   * a failed reconcile is logged by the engine, and we serve best-effort over
   * the same potentially-stale data the un-gated path would have.
   */
  private async awaitCatchUpGate(gate: Promise<void>): Promise<void> {
    const timeoutMs = resolveCatchUpGateTimeoutMs();
    if (timeoutMs <= 0) {
      // 0 = opt back into the original unbounded wait.
      try { await gate; } catch { /* engine already logged */ }
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([
        gate.then(() => 'done' as const, () => 'done' as const),
        timedOut,
      ]);
      if (outcome === 'timeout') {
        process.stderr.write(
          `[Afyx Graph MCP] Catch-up reconcile still running after ${timeoutMs}ms; serving this tool call now and finishing the reconcile in the background (#905). ` +
          `Set AFYX_GRAPH_CATCHUP_GATE_TIMEOUT_MS=0 to always wait for it.\n`
        );
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Record the directory the server tried to resolve the default project from.
   * Used only to make the "no default project" error actionable.
   */
  setDefaultProjectHint(searchedPath: string): void {
    this.defaultProjectHint = searchedPath;
  }

  /**
   * Engine-only: record the indexed sub-projects the workspace down-scan saw
   * when it could not adopt a default project (#1606/#1607). An empty list
   * clears any previous note.
   */
  setKnownSubprojects(roots: string[], base: string): void {
    this.knownSubprojects = roots;
    this.knownSubprojectsBase = base;
  }

  /** One message line naming the indexed sub-projects, or '' when none known. */
  private formatKnownSubprojects(): string {
    if (this.knownSubprojects.length === 0) return '';
    const base = this.knownSubprojectsBase;
    const rels = this.knownSubprojects.map((r) => (base ? relativePath(base, r) || '.' : r));
    return (
      `Indexed sub-projects were found below it: ${rels.join(', ')} — ` +
      'pass one of them (absolute, or resolved against that directory) as projectPath.\n'
    );
  }

  /**
   * Whether a default Afyx Graph instance is available
   */
  hasDefaultAfyxGraph(): boolean {
    return this.cg !== null;
  }

  /** Whether a tool name passes the AFYX_GRAPH_MCP_TOOLS allowlist (if any). */
  private isToolAllowed(name: string): boolean {
    return isToolEnabled(name, process.env.AFYX_GRAPH_MCP_TOOLS);
  }

  /**
   * Get tool definitions with dynamic descriptions based on project size.
   * The afyx_graph_explore tool description includes a budget recommendation
   * scaled to the number of indexed files. Honors the AFYX_GRAPH_MCP_TOOLS
   * allowlist so a trimmed surface is reflected in ListTools.
   */
  getTools(): ToolDefinition[] {
    let visible = selectToolDefinitions(tools, process.env.AFYX_GRAPH_MCP_TOOLS);
    // No default project loaded → no-root-index case (#993): a gateway server
    // started outside any repo, or a monorepo root whose indexes live in
    // sub-projects. With nothing to fall back to, EVERY call needs an explicit
    // projectPath, so mark it required in the schema — a high-salience nudge the
    // agent acts on, where SERVER_INSTRUCTIONS_NO_ROOT_INDEX's prose alone
    // wasn't enough (the reporter had to add an AGENTS.md note). `this.cg` is
    // settled by `retryInitIfNeeded()` before `handleToolsList` calls us, so a
    // null here means "genuinely no default", not a startup race. When a default
    // IS open we leave projectPath optional (below): a bare call falls back to
    // it, exactly as in the common single-project launch.
    if (!this.cg) return requireProjectPath(visible);

    try {
      const stats = this.cg.getStats();
      const budget = getExploreBudget(stats.fileCount);

      // Tiny-repo tool gating: on projects under TINY_REPO_FILE_THRESHOLD
      // files, retain exact inventory alongside the navigation tools. Exact
      // declaration enumeration is a distinct correctness route, not optional
      // ranked-navigation overhead.
      //
      // n=2 audits ruled out cutting below 5 tools:
      // - 3-tool gate (search + context + trace): cost regressed on
      //   cobra/ky/sinatra. The agent fell back to raw Reads to cover
      //   what afyx_graph_node + afyx_graph_explore would have answered.
      // - 1-tool gate (search only): catastrophic regression — express
      //   went from -43% WIN to +107% LOSS. With only search, the agent
      //   can't navigate the call graph structurally and reads everything.
      //
      // 5 is the empirical lower bound. Tools beyond search/context/
      // node/explore/trace pay overhead that the agent doesn't recoup
      // on tiny-repo flow questions.
      // ITER4: raise threshold 150 → 500 so single-file frameworks
      // (sinatra at 159, slim_framework around 200) also get the
      // 5-tool surface. The empirical 5-tool floor was set on <150
      // probes; iter3 measurement showed sinatra is structurally the
      // SAME problem as cobra (single-file WITHOUT-arm Read wins),
      // so it deserves the same gating.
      const TINY_REPO_FILE_THRESHOLD = 500;
      const TINY_REPO_CORE_TOOLS = new Set([
        'afyx_graph_inventory',
        'afyx_graph_explore',
        'afyx_graph_search',
        'afyx_graph_node',
      ]);
      if (stats.fileCount < TINY_REPO_FILE_THRESHOLD) {
        visible = visible.filter(t => TINY_REPO_CORE_TOOLS.has(t.name));
      }

      return visible.map(tool => {
        if (tool.name === 'afyx_graph_explore') {
          return {
            ...tool,
            description: `${tool.description} Exploration guidance — advisory only, NOT a quota: ~${budget} focused calls usually cover this project (${stats.fileCount.toLocaleString()} files indexed), and extra calls are never rejected or rate-limited.`,
          };
        }
        return tool;
      });
    } catch {
      return visible;
    }
  }

  /**
   * Get Afyx Graph instance for a project
   *
   * If projectPath is provided, opens that project's Afyx Graph (cached).
   * Otherwise returns the default Afyx Graph instance.
   *
   * Walks up parent directories to find the nearest .afyx-graph/ folder,
   * similar to how git finds .git/ directories.
   */
  private getAfyxGraph(projectPath?: string): AfyxGraph {
    if (!projectPath) {
      if (!this.cg) {
        const searched = this.defaultProjectHint ?? process.cwd();
        throw new NotIndexedError(
          'No Afyx Graph project is loaded for this session.\n' +
          `Searched for a .afyx-graph/ directory starting from: ${searched}\n` +
          this.formatKnownSubprojects() +
          'Either the server root has no index of its own (e.g. a monorepo where only ' +
          "sub-projects are indexed), or the MCP client launched the server outside your " +
          'project without reporting the workspace root. Either way, target the project ' +
          'explicitly:\n' +
          '  • Pass projectPath to the tool call, e.g. projectPath: "/absolute/path/to/your/project" ' +
          '(any project that has a .afyx-graph/ — including a sub-project of a monorepo)\n' +
          '  • Or add --path to the server\'s MCP config args: ["serve", "--mcp", "--path", "/absolute/path/to/your/project"]\n' +
          'If a project simply has no index, use your built-in tools (Read/Grep/Glob) for THAT ' +
          "project (the user can run 'afyx-graph init' there to enable it) — you can still query " +
          'other indexed projects by projectPath in the same session.'
        );
      }
      return this.freshen(this.cg);
    }

    // Reject sensitive system directories before opening. Only validate a
    // path that actually exists — a nested or not-yet-created sub-path of a
    // real project must still be allowed to resolve UP to its .afyx-graph/
    // root below (issue #238), so we don't run the existence-checking
    // validator on paths that are meant to walk up.
    if (existsSync(projectPath)) {
      const pathError = validateProjectPath(projectPath);
      if (pathError) {
        throw new PathRefusalError(pathError);
      }
    }

    // Always RE-RESOLVE the nearest .afyx-graph/ from the input path. The walk
    // is cheap (a few existsSync up the tree) and is the only thing that
    // notices a path whose index root CHANGED since it was first seen — most
    // importantly a git worktree that gained its own .afyx-graph/ after the
    // (long-lived) server first resolved it up to the parent checkout. We used
    // to short-circuit on a `projectCache[projectPath]` entry before resolving,
    // which pinned that first resolution for the server's whole lifetime, so a
    // worktree kept being served the parent checkout's index until restart
    // (#926). The DB connection itself is still cached (by resolved root,
    // below), so re-resolving costs only the stat walk, never a reopen.
    const resolvedRoot = findNearestAfyxGraphRoot(projectPath);

    if (!resolvedRoot) {
      throw new NotIndexedError(
        `The project at ${projectPath} isn't indexed with afyx-graph (no .afyx-graph/ directory found ` +
        'walking up from it), so afyx-graph cannot query it. Use your built-in tools (Read/Grep/Glob) ' +
        "for that codebase instead, and don't call afyx-graph for it again this session. " +
        "Indexing is the user's decision — they can run 'afyx-graph init' in that project to enable it."
      );
    }

    // If the path resolves to the default project, reuse the already-open
    // default instance rather than opening a SECOND connection to the same DB.
    // A duplicate connection serializes reads against the watcher's auto-sync
    // writes; when WAL isn't in effect (e.g. a filesystem without shared-memory
    // support) that surfaces as intermittent
    // "database is locked" on concurrent tool calls. See issue #238. The
    // default instance is owned/closed by the server, so it's never cached.
    if (this.cg && this.cg.getProjectRoot() === resolvedRoot) {
      return this.freshen(this.cg);
    }

    // Cache the open DB connection by RESOLVED ROOT only — never by the input
    // path. One key per instance means closeAll() closes each exactly once, and
    // a changed resolution maps to a different entry instead of a stale hit.
    const cached = this.projectCache.get(resolvedRoot);
    if (cached) return this.freshen(cached);

    const cg = loadAfyxGraph().openSync(resolvedRoot);
    this.projectCache.set(resolvedRoot, cg);
    return cg;
  }

  /**
   * Heal a long-lived connection whose `.afyx-graph/` was removed and recreated
   * at the same path (a worktree recreated, or `rm -rf .afyx-graph` + re-init)
   * before handing it to a tool. Otherwise the daemon keeps serving the
   * pre-removal snapshot from its now-unlinked file handle until restart — and
   * because the daemon registry is keyed by path, a same-path recreate routes
   * new clients straight back to this same stale daemon (#925). The check is one
   * stat() and a no-op unless the inode actually changed; it never throws into a
   * tool call.
   */
  private freshen(cg: AfyxGraph): AfyxGraph {
    try {
      if (cg.reopenIfReplaced()) {
        process.stderr.write(
          '[Afyx Graph MCP] The index was replaced on disk (e.g. a git worktree ' +
          'recreated at the same path); reopened the live database in place.\n'
        );
      }
    } catch {
      // Best-effort self-heal — a failed reopen must never break the tool call;
      // the (still stale) handle keeps serving and the next call retries.
    }
    return cg;
  }

  /**
   * Close all cached project connections
   */
  closeAll(): void {
    for (const cg of this.projectCache.values()) {
      cg.close();
    }
    this.projectCache.clear();
    this.worktreeMismatchCache.clear();
  }

  /**
   * Validate that a value is a non-empty string within length bounds.
   *
   * The `maxLength` cap protects against MCP clients that ship huge
   * payloads (10MB+ query strings either by accident or maliciously).
   * Without this, a single oversized input can pin the FTS5 index or
   * exhaust memory before any real work runs.
   */
  private validateString(
    value: unknown,
    name: string,
    maxLength: number = MAX_INPUT_LENGTH
  ): string | ToolResult {
    if (typeof value !== 'string' || value.length === 0) {
      return this.errorResult(`${name} must be a non-empty string`);
    }
    if (value.length > maxLength) {
      return this.errorResult(
        `${name} exceeds maximum length of ${maxLength} characters (got ${value.length})`
      );
    }
    return value;
  }

  /**
   * Validate an optional path-like string input. Returns the value if
   * valid (or undefined), or a ToolResult with the error.
   */
  private validateOptionalPath(
    value: unknown,
    name: string
  ): string | undefined | ToolResult {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      return this.errorResult(`${name} must be a string`);
    }
    if (value.length > MAX_PATH_LENGTH) {
      return this.errorResult(
        `${name} exceeds maximum length of ${MAX_PATH_LENGTH} characters (got ${value.length})`
      );
    }
    return value;
  }

  /**
   * Cached git worktree/index mismatch for a tool call's effective project.
   *
   * The "effective project" is what the request targets: an explicit
   * `projectPath` arg, else the directory the server resolved its default
   * project from (`defaultProjectHint`), else cwd. Memoized per start path —
   * see `worktreeMismatchCache`. Best-effort: if the project can't be resolved
   * (e.g. nothing initialized yet), it reports "no mismatch" so a tool is never
   * broken by this check.
   */
  private worktreeMismatchFor(projectPath?: string): WorktreeIndexMismatch | null {
    const startPath = projectPath ?? this.defaultProjectHint ?? process.cwd();

    // The verdict depends on BOTH the start path AND the index root it resolves
    // to, so the cache must be keyed on the pair. Resolve the index root first
    // (cheap — getAfyxGraph re-walks to the nearest .afyx-graph/, no git), then
    // key on `(startPath, indexRoot)`. The moment that root changes — most
    // importantly when a git worktree gains its own index and the walk-up stops
    // there instead of at the parent checkout — the key changes and the verdict
    // is recomputed, instead of serving the stale "borrowed the parent's index"
    // warning for the server's whole lifetime. Keying on startPath alone pinned
    // that first verdict until restart (#926).
    let indexRoot: string;
    try {
      indexRoot = this.getAfyxGraph(projectPath).getProjectRoot();
    } catch {
      // No resolvable project (or any other resolution error) → nothing to warn.
      return null;
    }

    const cacheKey = `${startPath}\u0000${indexRoot}`;
    const cached = this.worktreeMismatchCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const mismatch = detectWorktreeIndexMismatch(startPath, indexRoot);
    this.worktreeMismatchCache.set(cacheKey, mismatch);
    return mismatch;
  }

  /**
   * Prefix a successful read-tool result with a compact worktree-mismatch
   * notice when the resolved index belongs to a different git working tree than
   * the caller's (issue #155). Without this, an agent in a nested worktree
   * silently trusts main-branch results. No-op on error results and when there
   * is no mismatch. `afyx_graph_status` is excluded — it embeds its own verbose
   * warning — so it stays out of this path.
   */
  private withWorktreeNotice(result: ToolResult, projectPath?: string): ToolResult {
    if (result.isError) return result;
    const mismatch = this.worktreeMismatchFor(projectPath);
    if (!mismatch) return result;

    const notice = worktreeMismatchNotice(mismatch);
    const [first, ...rest] = result.content;
    if (first && first.type === 'text') {
      return { ...result, content: [{ type: 'text', text: `${notice}\n\n${first.text}` }, ...rest] };
    }
    return result;
  }

  /**
   * Annotate a successful read-tool result with per-file staleness — the
   * non-blocking answer to issue #403. The file watcher tracks every event
   * it sees per path; here we intersect "files referenced in this response"
   * against that pending set and prepend a compact banner so the agent can
   * fall back to Read for those *specific* files without waiting for the
   * debounced sync to fire. Other pending files in the project (not
   * referenced by this response) get a small footer so the agent has a
   * complete picture without bloating the banner.
   *
   * Cost when nothing is pending — the common case — is one boolean check.
   * No I/O, no parsing of markdown beyond a per-pending-file substring scan.
   */
  private driftCache = new Map<string, { at: number; stale: boolean }>();
  private static readonly DRIFT_TTL_MS = 2000;

  /**
   * On-disk drift check for a single indexed file (issue #1474). The code
   * renderers slice CURRENT bytes at INDEXED line ranges; when the file
   * changed after its last index sync those ranges can point at a DIFFERENT
   * symbol's code — served under the requested name with `isError: false`.
   * The watcher-based pending/degraded banners can't cover this for a
   * project reached via `projectPath` (cross-project instances have no
   * watcher, by construction), so freshness is verified here, at the point
   * of emission, from data the index already stores.
   *
   * Cheap and precise: one stat() per file (size + mtime, the same
   * comparison the sync fast path uses); only on a stat mismatch is the
   * content hashed (sha256, matching extraction's `hashContent`) so a
   * touch/checkout that rewrote identical bytes never false-positives.
   * Results are memoized briefly so one response rendering the same file in
   * several sections pays for the check once.
   *
   * Returns true when the on-disk file differs from what was indexed —
   * i.e. indexed line ranges for it are NOT trustworthy. Any failure
   * (missing files-table row, stat/read error) reports false: those cases
   * are handled by the existing not-found paths, and a wrong "stale" flag
   * would needlessly push the agent back to Read.
   */
  private isFileStaleOnDisk(cg: AfyxGraph, relPath: string, content?: string): boolean {
    let root: string;
    try {
      root = cg.getProjectRoot();
    } catch {
      return false;
    }
    const key = `${root}\0${relPath}`;
    const now = Date.now();
    const hit = this.driftCache.get(key);
    if (hit && now - hit.at < ToolHandler.DRIFT_TTL_MS) return hit.stale;
    let stale = false;
    try {
      const rec = cg.getFile(relPath);
      const absPath = rec ? validatePathWithinRoot(root, relPath) : null;
      if (rec && absPath && existsSync(absPath)) {
        const st = statSync(absPath);
        // Same freshness test as the sync fast path (extraction/index.ts):
        // equal size + equal floored mtime ⇒ unchanged, no read needed.
        if (st.size !== rec.size || Math.floor(st.mtimeMs) !== Math.floor(rec.modifiedAt)) {
          const data = content ?? readFileSync(absPath, 'utf-8');
          // Must stay byte-identical to extraction's `hashContent` (sha256 over
          // the utf-8 string) — the identical-rewrite test in
          // mcp-stale-slice.test.ts pins the parity. Inlined (not imported)
          // to keep the extraction module off the MCP startup path.
          stale = createHash('sha256').update(data).digest('hex') !== rec.contentHash;
        }
      }
    } catch {
      stale = false;
    }
    this.driftCache.set(key, { at: now, stale });
    return stale;
  }

  private withStalenessNotice(result: ToolResult, projectPath?: string): ToolResult {
    if (result.isError) return result;

    let cg: AfyxGraph;
    try {
      cg = this.getAfyxGraph(projectPath);
    } catch {
      return result; // no default project — leave as is
    }

    // Cross-project `projectPath` calls open a cached Afyx Graph WITHOUT a
    // watcher (watchers are only attached to the default session project).
    // When the cross-project path happens to be the same project as the
    // default cg, the cached instance is the wrong one — its pendingFiles is
    // permanently empty. Detect the equal-path case and prefer the default
    // cg so the staleness signal still fires when an agent passes the
    // explicit projectPath form of its own project.
    if (this.cg && cg !== this.cg) {
      try {
        const sameProject =
          resolvePath(this.cg.getProjectRoot()) === resolvePath(cg.getProjectRoot());
        if (sameProject) cg = this.cg;
      } catch {
        /* getProjectRoot may throw on a closed instance — leave cg as is */
      }
    }

    // Whole-index degradation (#876): once live watching has permanently
    // stopped, getPendingFiles() is empty so the per-file banner below can't
    // fire — but the index is now FROZEN and silently drifting stale. Surface
    // one global notice instead, so the agent Reads for current content rather
    // than trusting a response off a no-longer-updating index. (Cross-project
    // calls open a watcher-less Afyx Graph, so this is false there — correct: we
    // only know degraded state for the default session project.)
    let degraded = false;
    try {
      degraded = cg.isWatcherDegraded?.() ?? false;
    } catch {
      degraded = false;
    }
    if (degraded) {
      const [head, ...tail] = result.content;
      if (!head || head.type !== 'text') return result;
      let reason: string | null = null;
      try {
        reason = cg.getWatcherDegradedReason?.() ?? null;
      } catch {
        reason = null;
      }
      const composed = `${formatDegradedBanner(reason)}\n\n${head.text}`;
      return { ...result, content: [{ type: 'text', text: composed }, ...tail] };
    }

    // Defensive: some test fakes inject a partial Afyx Graph stub without the
    // newer pending-files API. Treat missing/throwing as "no pending files."
    let pending: PendingFile[] = [];
    try {
      pending = cg.getPendingFiles?.() ?? [];
    } catch {
      return result;
    }
    if (pending.length === 0) return result;

    const [first, ...rest] = result.content;
    if (!first || first.type !== 'text') return result;

    const text = first.text;
    const inResponse: PendingFile[] = [];
    const elsewhere: PendingFile[] = [];
    for (const p of pending) {
      // Substring match against the project-relative POSIX path — that's
      // exactly the format both the watcher and every afyx-graph response
      // emit, so a plain includes() is sufficient and avoids regex pitfalls.
      if (text.includes(p.path)) inResponse.push(p);
      else elsewhere.push(p);
    }

    let banner = '';
    if (inResponse.length > 0) {
      banner = formatStaleBanner(inResponse);
    }
    let footer = '';
    if (elsewhere.length > 0) {
      footer = formatStaleFooter(elsewhere);
    }
    if (!banner && !footer) return result;

    const composed = [banner, text, footer].filter(Boolean).join('\n\n');
    return { ...result, content: [{ type: 'text', text: composed }, ...rest] };
  }

  /** Execute without a session and return only the public result. */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return stripInternalToolResult(await this.executeRuntime(toolName, args));
  }

  /**
   * Execute for the MCP runtime. The result may carry serializable internal
   * metadata for the owning session context to consume before it reaches the
   * wire; no client state is stored on this shared handler.
   */
  async executeRuntime(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    try {
      // Block the first tool call on the engine's post-open reconcile so we
      // never serve rows for files deleted/edited while no MCP server was
      // running. The wait is time-boxed (#905): a huge-repo reconcile takes
      // minutes, and blocking the first call on all of it reads as a hang, so
      // we wait briefly then serve and let it finish in the background. The
      // gate is cleared after first await — subsequent calls pay nothing.
      // Catch-up failures are logged by the engine; we proceed regardless so a
      // transient sync error never breaks tools.
      if (this.catchUpGate) {
        const gate = this.catchUpGate;
        this.catchUpGate = null;
        await this.awaitCatchUpGate(gate);
      }
      // Honor the optional tool allowlist (AFYX_GRAPH_MCP_TOOLS): a trimmed
      // surface rejects ablated tools defensively even if a client cached them.
      if (!this.isToolAllowed(toolName)) {
        return this.errorResult(`Tool ${toolName} is disabled via AFYX_GRAPH_MCP_TOOLS`);
      }
      // Cross-cutting input validation. All tools accept an optional
      // `projectPath` and most accept either `query`, `task`, or
      // `symbol` — bound their lengths centrally so individual handlers
      // can stay focused on tool-specific logic.
      const pathCheck = this.validateOptionalPath(args.projectPath, 'projectPath');
      if (typeof pathCheck === 'object' && pathCheck !== undefined) {
        return pathCheck;
      }
      // The `path` and `pattern` properties used by afyx_graph_files are
      // also path-shaped — apply the same cap.
      if (args.path !== undefined) {
        const check = this.validateOptionalPath(args.path, 'path');
        if (typeof check === 'object' && check !== undefined) return check;
      }
      if (args.pattern !== undefined) {
        const check = this.validateOptionalPath(args.pattern, 'pattern');
        if (typeof check === 'object' && check !== undefined) return check;
      }

      // afyx_graph_status reports watcher state (pending files, degraded mode,
      // worktree warning) and embeds its own sections — it must run on the MAIN
      // thread against the watched default instance, so it is NEVER off-loaded to
      // a worker (whose read connection has no watcher). It also skips the
      // auto-banner wrapper to avoid duplicating its own pending-files section.
      if (resolveToolRoute(toolName) === 'status') {
        return await this.handleStatus(args);
      }

      // Read tools: off-load the CPU-heavy dispatch to the worker pool when one
      // is attached, healthy, AND has finished its first cold start (daemon
      // mode), so the daemon's single event loop stays free for the MCP
      // transport under concurrent load — otherwise N concurrent explores
      // serialize AND starve the transport until the whole batch drains
      // (clients then time out). Before the first worker is warm, calls run
      // in-process: a call queued behind a cold start sat invisible until the
      // 45s busy backstop — the daemon's first tool call stalling for however
      // long a worker spawn takes on a loaded machine (the #662 flake). With
      // no pool (direct mode) or a degraded one, dispatch runs in-process
      // exactly as before. Either way the result flows through the
      // cross-cutting notices — worktree-index mismatch (#155) and per-file
      // staleness (#403) — which need the watched MAIN instance and so are
      // always applied here, never in the worker.
      //
      const raw = (this.queryPool && this.queryPool.healthy && this.queryPool.ready)
        ? await this.queryPool.run(toolName, args)
        : await this.executeReadTool(toolName, args);
      const withWorktree = this.withWorktreeNotice(raw, args.projectPath as string | undefined);
      return this.withStalenessNotice(withWorktree, args.projectPath as string | undefined);
    } catch (err) {
      return classifyToolFailure(err);
    }
  }

  /**
   * Run a single read tool to completion and return its raw {@link ToolResult},
   * classifying expected failures the same way {@link execute}'s catch does so
   * the SHAPE is identical whether dispatch runs in-process or on a worker:
   * NotIndexed → success-shaped guidance, PathRefusal → clean error, anything
   * else → internal-error-with-retry. Never throws.
   *
   * This is the worker thread's entry point (see {@link ./query-worker}) and the
   * in-process fallback for {@link execute}. It deliberately does NOT run the
   * catch-up gate or the staleness/worktree notices — those need the daemon's
   * watched main instance and stay on the main thread. Cross-cutting allowlist +
   * path validation already ran in {@link execute} before routing here.
   */
  async executeReadTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return dispatchReadTool(toolName, args, this.readToolHandlers);
  }

  /**
   * Handle afyx_graph_search
   */
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

  /** Handle exact structural declaration inventory. */
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

  /**
   * Group symbol matches into DISTINCT DEFINITIONS — one group per
   * (filePath, qualifiedName), so same-file overloads stay together while
   * unrelated same-named classes across a monorepo's apps (#764: one
   * `UserService` per NestJS app) are kept apart. Optionally narrowed by a
   * `file` path/suffix first.
   */
  private groupDefinitions(
    nodes: Node[],
    fileFilter: string | undefined
  ): { groups: Node[][]; filteredOut: boolean } {
    return groupDefinitions(nodes, fileFilter);
  }

  /**
   * Handle afyx_graph_callers
   */
  private async handleCallers(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;

    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeRelationshipTool(this.relationshipToolSource(cg), {
      symbol,
      file: args.file,
      limit: args.limit,
    }, 'callers');
  }

  /**
   * Handle afyx_graph_callees
   */
  private async handleCallees(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;

    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeRelationshipTool(this.relationshipToolSource(cg), {
      symbol,
      file: args.file,
      limit: args.limit,
    }, 'callees');
  }

  /** Narrow wiring from the project graph to Relationship adapter dependencies. */
  private relationshipToolSource(cg: AfyxGraph): RelationshipToolSource {
    return {
      resolveSymbols: (symbol) => this.findAllSymbols(cg, symbol),
      groupDefinitions: (nodes, fileFilter) => this.groupDefinitions(nodes, fileFilter),
      getCallers: (nodeId) => cg.getCallers(nodeId),
      getCallees: (nodeId) => cg.getCallees(nodeId),
    };
  }

  /**
   * Handle afyx_graph_impact
   */
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

  /** Narrow wiring from the project graph to the MCP Impact adapter. */
  private impactToolSource(cg: AfyxGraph): ImpactToolSource {
    return {
      resolveSymbols: (symbol) => this.findAllSymbols(cg, symbol),
      groupDefinitions: (nodes, fileFilter) => this.groupDefinitions(nodes, fileFilter),
      getImpactRadius: (nodeId, depth) => cg.getImpactRadius(nodeId, depth),
    };
  }

  /**
   * Describe a synthesized (dynamic-dispatch) edge for human output: how the
   * callback was wired up — the bridge static parsing can't see. Returns null
   * for ordinary static edges. Used by trace + the node trail so a synthesized
   * hop reads as "registered via onUpdate at App.tsx:3148", not a bare arrow.
   */

  private synthEdgeNote(edge: Edge | null): { label: string; compact: string; registeredAt?: string } | null {
    if (!edge || edge.provenance !== 'heuristic') return null;
    const m = edge.metadata as Record<string, unknown> | undefined;
    const registeredAt = typeof m?.registeredAt === 'string' ? m.registeredAt : undefined;
    const at = registeredAt ? ` @${registeredAt}` : '';
    if (m?.synthesizedBy === 'callback') {
      const via = m.via ? `\`${String(m.via)}\`` : 'a registrar';
      const field = m.field ? ` on .${String(m.field)}` : '';
      return {
        label: `callback — registered via ${via}${field} (dynamic dispatch)`,
        compact: `dynamic: callback via ${via}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'http-client') {
      const req = `${String(m.method ?? 'GET')} ${String(m.href ?? '')}`.trim();
      return {
        label: `HTTP request \`${req}\` — the client's call onto its own route (cross-tier)`,
        compact: `dynamic: HTTP ${req}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'queue-job') {
      const job = m.event ? `\`${String(m.event)}\`` : 'a job';
      const queue = m.queue ? ` on queue \`${String(m.queue)}\`` : '';
      return {
        label: `queue job ${job}${queue} — producer → consumer (cross-tier)`,
        compact: `dynamic: queue job ${job}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'event-bus') {
      const ev = m.event ? `\`${String(m.event)}\`` : 'an event';
      const what = m.channel === 'socket' ? 'socket message' : 'bus event';
      const dir = m.tier === 'client→server' ? ', client → server' : m.tier === 'server→client' ? ', server → client' : '';
      return {
        label: `${what} ${ev} — emit → handler${dir} (dynamic dispatch)`,
        compact: `dynamic: ${what} ${ev}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'event-emitter') {
      const ev = m.event ? `\`${String(m.event)}\`` : 'an event';
      return {
        label: `event ${ev} — emit → handler (dynamic dispatch)`,
        compact: `dynamic: event ${ev}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'react-render') {
      return {
        label: `React re-render — \`setState\` re-runs render() (dynamic dispatch)`,
        compact: `dynamic: React re-render via setState${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'jsx-render') {
      const child = m.via ? `<${String(m.via)}>` : 'a child component';
      return {
        label: `renders ${child} (JSX child — dynamic dispatch)`,
        compact: `dynamic: renders ${child}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'vue-handler') {
      const ev = m.event ? `@${String(m.event)}` : 'a template event';
      return {
        label: `Vue template handler — bound to ${ev} (dynamic dispatch)`,
        compact: `dynamic: Vue ${ev} handler`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'interface-impl') {
      return {
        label: `interface/abstract dispatch — runs the implementation override (dynamic dispatch)`,
        compact: `dynamic: interface → impl${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'closure-collection') {
      const field = m.field ? `\`${String(m.field)}\`` : 'a collection';
      return {
        label: `closure collection — runs handlers appended to ${field} (dynamic dispatch)`,
        compact: `dynamic: runs ${field} handlers${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'fn-pointer-dispatch') {
      const via = m.via ? `\`${String(m.via)}\`` : 'a function pointer';
      return {
        label: `function-pointer dispatch via ${via} (dynamic dispatch)`,
        compact: `dynamic: fn-pointer ${m.via ? String(m.via) : ''}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'goframe-route') {
      const route = m.route ? `\`${String(m.route)}\`` : 'a route';
      return {
        label: `GoFrame route ${route} — reflective Bind → controller method (dynamic dispatch)`,
        compact: `dynamic: GoFrame route ${m.route ? String(m.route) : ''}${at}`,
        registeredAt,
      };
    }
    // Generic fallback for any other synthesizer (redux-thunk, gin-middleware-chain,
    // flutter-build, …): a synthesized hop must never read as a bare static `calls`.
    // It's a dynamic-dispatch bridge — label it as one and keep its wiring site.
    if (typeof m?.synthesizedBy === 'string') {
      const kind = m.synthesizedBy.replace(/-/g, ' ');
      return { label: `${kind} (dynamic dispatch)`, compact: `dynamic: ${kind}${at}`, registeredAt };
    }
    return null;
  }


  private async handleExplore(args: Record<string, unknown>): Promise<ToolResult> {
    const rawQuery = this.validateString(args.query, 'query');
    if (typeof rawQuery !== 'string') return rawQuery;
    const cg = this.getAfyxGraph(args.projectPath as string | undefined);
    return executeExploreTool(cg, rawQuery, args, {
      isFileStaleOnDisk: (graph, filePath, content) => this.isFileStaleOnDisk(graph, filePath, content),
      numberSourceLines,
      synthEdgeNote: (edge) => this.synthEdgeNote(edge),
    });
  }
  /**
   * Handle afyx_graph_node
   */
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
      numberSourceLines,
      synthEdgeLabel: (edge) => this.synthEdgeNote(edge)?.compact ?? null,
      isContainerKind: (kind) => CONTAINER_NODE_KINDS.has(kind),
    });
  }
  /**
   * Handle afyx_graph_status
   */
  private async handleStatus(args: Record<string, unknown>): Promise<ToolResult> {
    let cg = this.getAfyxGraph(args.projectPath as string | undefined);
    // Same trick as withStalenessNotice — when an explicit projectPath
    // resolves to the same project as the default session cg, prefer the
    // default so getPendingFiles() (only populated by the default's watcher)
    // is non-empty when there are pending edits.
    if (this.cg && cg !== this.cg) {
      try {
        if (resolvePath(this.cg.getProjectRoot()) === resolvePath(cg.getProjectRoot())) {
          cg = this.cg;
        }
      } catch { /* closed instance — leave as is */ }
    }
    const mismatch = this.worktreeMismatchFor(args.projectPath as string | undefined);
    return executeStatusTool(cg, {
      worktreeWarning: mismatch ? worktreeMismatchWarning(mismatch) : undefined,
      nowMs: Date.now(),
    });
  }

  /**
   * Handle afyx_graph_files - get project file structure from the index
   */
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

  // =========================================================================
  // Symbol resolution helpers
  // =========================================================================

  /** Compatibility facade for the frozen shared symbol-matching rules. */
  matchesSymbol(node: Node, symbol: string): boolean {
    return matchesSymbol(node, symbol);
  }

  /** Compatibility facade for Node's Afyx-owned lookup policy. */
  findSymbolMatches(cg: AfyxGraph, symbol: string): Node[] {
    return resolveNodeSymbolMatches(cg, symbol);
  }

  /**
   * Find a symbol by name, handling disambiguation when multiple matches exist.
   * Returns the best match and a note about alternatives if any.
   */
  /**
   * Find ALL definitions matching a name, ranked, so afyx_graph_node can return
   * every overload instead of guessing one (the wrong guess → a Read). Keepers
   * rank before generated stubs (.pb.go etc.); stable within a group preserves
   * FTS order. Returns [] when nothing matches; a qualified lookup that finds no
   * exact match returns [] rather than a misleading fuzzy file hit (#173); a
   * bare name with no exact match falls back to the single top fuzzy result.
   */
  private findAllSymbols(cg: AfyxGraph, symbol: string): { nodes: Node[]; note: string } {
    return findAllSymbols(cg, symbol);
  }

  // =========================================================================
  // Formatting helpers (compact by default to reduce context usage)
  // =========================================================================

  /**
   * Build a compact structural outline of a container symbol from its
   * indexed children (methods, fields, properties, …) — name, kind,
   * line number, and signature — so the agent gets the shape of a class
   * without the full source of every method. Returns '' when the container
   * has no indexed children, so the caller can fall back to full source.
   */
  private errorResult(message: string): ToolResult {
    return errorToolResult(message);
  }
}
