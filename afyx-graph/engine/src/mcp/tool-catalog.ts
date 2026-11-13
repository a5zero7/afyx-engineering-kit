import type { ExploreEmission } from './explore-session-state';

/**
 * Behavioral hints advertised alongside Afyx Graph MCP tools so clients
 * operating in strict read-only modes can invoke query tools without prompts.
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool. */
  title?: string;
  /** If true, the tool never modifies workspace state. */
  readOnlyHint?: boolean;
  /** Applicable only when readOnlyHint is false. */
  destructiveHint?: boolean;
  /** If true, repeated invocations with identical inputs have no extra effect. */
  idempotentHint?: boolean;
  /** If true, the tool interacts with external/unbounded systems. */
  openWorldHint?: boolean;
}

export interface PropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Declarative MCP tool contract definition exposed via tools/list.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Standard MCP tool execution payload returned across runtime and wire layers.
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  _afyxExploreEmission?: ExploreEmission;
}

const projectPathProperty: PropertySchema = {
  type: 'string',
  description:
    "Absolute path to the project to query (or any directory inside it) — afyx-graph uses the nearest .afyx-graph/ index at or above that path. Omit to use this session's default project. Pass it to query a second codebase, or when the server root has no index of its own (e.g. a monorepo where only sub-projects are indexed, so there is no default project).",
};

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function readOnlyTool(
  name: string,
  description: string,
  properties: Record<string, PropertySchema>,
  required?: string[],
  meta?: Record<string, unknown>,
): ToolDefinition {
  const inputSchema: ToolDefinition['inputSchema'] = required === undefined
    ? { type: 'object', properties }
    : { type: 'object', properties, required };
  const def: ToolDefinition = {
    name,
    description,
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  };
  if (meta) def._meta = meta;
  return def;
}

/**
 * Canonical public wire schema catalog for Afyx Graph MCP tools.
 * Field ordering and descriptions form the frozen MCP semantic contract.
 */
export const AFYX_MCP_TOOL_CATALOG: ToolDefinition[] = [
  readOnlyTool(
    'afyx_graph_search',
    'Quick ranked symbol-metadata search by name. Returns bounded locations only (no code), not an exhaustive source-text or declaration inventory; truncated responses say how to widen them. Use afyx_graph_explore instead to get the actual source / understand an area in one call.',
    {
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
    ['query'],
  ),
  readOnlyTool(
    'afyx_graph_inventory',
    'Exact, bounded inventory of indexed Python class assignments with a source-grounded literal value. Use for exhaustive count/list questions such as classes declaring `_inherit = "sale.order"`; unlike ranked search, it reports total matches, pagination, index coverage, unsupported expressions, and exclusions. Static source facts do not imply the Odoo runtime registry.',
    {
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
    ['declaration', 'value'],
  ),
  readOnlyTool(
    'afyx_graph_callers',
    'List functions that call <symbol>. For the full flow, use afyx_graph_explore.',
    {
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
    ['symbol'],
  ),
  readOnlyTool(
    'afyx_graph_callees',
    'List functions that <symbol> calls. For the full flow, use afyx_graph_explore.',
    {
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
    ['symbol'],
  ),
  readOnlyTool(
    'afyx_graph_impact',
    'List symbols affected by changing <symbol>. Use before a refactor.',
    {
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
    ['symbol'],
  ),
  readOnlyTool(
    'afyx_graph_node',
    'Two modes. (1) READ A FILE — use INSTEAD of the Read tool: pass `file` (a path or basename) with no `symbol` and it returns that file\'s current on-disk source with line numbers, exactly the shape Read gives you (`<n>\\t<line>`, safe to Edit from), narrowable with `offset`/`limit` just like Read — PLUS a one-line note of which files depend on it. Same bytes as Read, faster (served from the index), with the blast radius attached. Use it whenever you would Read a source file. (2) ONE SYMBOL you can name — its location, signature, verbatim source (includeCode=true) and caller/callee trail in one call, so before changing it you see what calls it and what your edit would break. For an AMBIGUOUS name it returns EVERY matching definition\'s body in one call (so you never Read a file to find the right overload); pass `file`/`line` to pin one. Use afyx_graph_explore for several related symbols or the full flow.',
    {
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
    [],
  ),
  readOnlyTool(
    'afyx_graph_explore',
    'Ranked relational/source exploration for how code works, architecture, flow, impact, or an area being changed. Returns verbatim source of relevant symbols grouped by file in one capped call plus paths among them. It is intentionally ranked and bounded: NEVER use it as an exhaustive declaration inventory; use afyx_graph_inventory for supported exact class-assignment counts/lists, or direct source inspection when the requested fact is unsupported or index coverage is limited.',
    {
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
    ['query'],
    { 'anthropic/alwaysLoad': true },
  ),
  readOnlyTool(
    'afyx_graph_status',
    'Index health check (files / nodes / edges). Skip unless debugging.',
    {
      projectPath: projectPathProperty,
    },
  ),
  readOnlyTool(
    'afyx_graph_files',
    'Indexed file tree with language + symbol counts. Faster than Glob for project layout.',
    {
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
  ),
];
