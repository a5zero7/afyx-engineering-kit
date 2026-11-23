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
    "Absolute path selecting an indexed project. Omission uses the server's resolved project root.",
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
 * Protocol fields retain their compatibility contract. Descriptive guidance is
 * authored for AFYX and versioned separately from technical schema constraints.
 */
export const AFYX_MCP_TOOL_CATALOG: ToolDefinition[] = [
  readOnlyTool(
    'afyx_graph_search',
    "Locate indexed symbols matching a supplied name. The response contains a bounded set of ranked locations rather than every source occurrence. Request source and relationships with afyx_graph_explore; use afyx_graph_inventory for supported exhaustive declaration listings.",
    {
      query: {
        type: 'string',
        description: "Name fragment used to rank indexed symbols; for example, session or UserService.",
      },
      kind: {
        type: 'string',
        description: "Return only symbols of this indexed node category.",
        enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
      },
      limit: {
        type: 'number',
        description: "Response location cap: 10 by default, at most 100. The response identifies additional ranked matches.",
        default: 10,
      },
      projectPath: projectPathProperty,
    },
    ['query'],
  ),
  readOnlyTool(
    'afyx_graph_inventory',
    "Enumerate indexed class assignments for an exact assignment key and string value. Pagination and completeness are explicit in the result. Facts outside this indexed assignment model require direct source inspection.",
    {
      declaration: {
        type: 'string',
        description: "Class assignment key to match exactly, such as _inherit or _name.",
      },
      value: {
        type: 'string',
        description: "String value to match exactly, such as sale.order.",
      },
      path: {
        type: 'string',
        description: "Optional repository-relative subtree containing the declarations.",
      },
      offset: {
        type: 'number',
        description: "Number of matching declarations to omit before this page; starts at 0.",
        default: 0,
      },
      limit: {
        type: 'number',
        description: "Page capacity: 100 by default, at most 200. A partial page is identified as incomplete.",
        default: 100,
      },
      projectPath: projectPathProperty,
    },
    ['declaration', 'value'],
  ),
  readOnlyTool(
    'afyx_graph_callers',
    "List indexed incoming call relationships for a selected definition. A file selector resolves names shared by several definitions. The response limit bounds the displayed relationships.",
    {
      symbol: {
        type: 'string',
        description: "Indexed definition name whose incoming calls should be inspected.",
      },
      file: {
        type: 'string',
        description: "Repository path or path suffix selecting the intended definition when names overlap.",
      },
      limit: {
        type: 'number',
        description: "Upper bound on displayed incoming callers; defaults to 20.",
        default: 20,
      },
      projectPath: projectPathProperty,
    },
    ['symbol'],
  ),
  readOnlyTool(
    'afyx_graph_callees',
    "Follow indexed outgoing call relationships from a selected definition. Supply a file selector when several definitions share the requested name.",
    {
      symbol: {
        type: 'string',
        description: "Indexed definition name whose outgoing calls should be inspected.",
      },
      file: {
        type: 'string',
        description: "Repository path or suffix selecting one of the matching definitions.",
      },
      limit: {
        type: 'number',
        description: "Upper bound on displayed outgoing callees; defaults to 20.",
        default: 20,
      },
      projectPath: projectPathProperty,
    },
    ['symbol'],
  ),
  readOnlyTool(
    'afyx_graph_impact',
    "Trace dependency reach from a symbol when reviewing a proposed change. File selection identifies the definition, and depth bounds traversal. Interpret heuristic relationships using the evidence returned with them.",
    {
      symbol: {
        type: 'string',
        description: "Starting definition for dependency impact traversal.",
      },
      file: {
        type: 'string',
        description: "Path or suffix identifying the starting definition when its name is ambiguous.",
      },
      depth: {
        type: 'number',
        description: "Traversal distance in relationship levels; defaults to 2.",
        default: 2,
      },
      projectPath: projectPathProperty,
    },
    ['symbol'],
  ),
  readOnlyTool(
    'afyx_graph_node',
    "Read current source by file or inspect named definitions. A file without symbol returns numbered source lines and dependent-file context; offset and limit select a window of up to 2000 lines. Symbol requests return declaration details and relationships, including multiple matching definitions unless file or line narrows the request. includeCode enables symbol source; symbolsOnly selects a structural file overview. Use afyx_graph_explore for questions spanning several symbols.",
    {
      symbol: {
        type: 'string',
        description: "Definition name to inspect. Leave unset when requesting source through file alone.",
      },
      includeCode: {
        type: 'boolean',
        description: "Include source text with a symbol result; defaults to false. File requests include source unless symbolsOnly is enabled.",
        default: false,
      },
      file: {
        type: 'string',
        description: "Repository file path or basename. Without symbol this selects file reading; with symbol it selects a definition in that file.",
      },
      offset: {
        type: 'number',
        description: "First requested source line, using 1-based numbering. File requests begin at line 1 when omitted.",
      },
      limit: {
        type: 'number',
        description: "Maximum source lines in a file request. Omission selects the file subject to the 2000-line response bound.",
      },
      symbolsOnly: {
        type: 'boolean',
        description: "Return the selected file's indexed symbol outline and dependents instead of source text; defaults to false.",
        default: false,
      },
      line: {
        type: 'number',
        description: "Source line used with a symbol request to select a nearby definition.",
      },
      projectPath: projectPathProperty,
    },
    [],
  ),
  readOnlyTool(
    'afyx_graph_explore',
    "Gather relevant source excerpts and indexed relationships for a question about code structure, execution flow, or change impact. Ranking chooses what fits the response budget, so the result cannot establish exhaustive counts. Use inventory for supported assignment enumerations and direct source for facts outside index coverage.",
    {
      query: {
        type: 'string',
        description: "Names, paths, code terms, or a question describing the area to investigate. Include participating symbols for a flow investigation. Exact assignment enumeration belongs in afyx_graph_inventory.",
      },
      maxFiles: {
        type: 'number',
        description: "Source-file capacity for this response; defaults to 12.",
        default: 12,
      },
      projectPath: projectPathProperty,
    },
    ['query'],
    { 'anthropic/alwaysLoad': true },
  ),
  readOnlyTool(
    'afyx_graph_status',
    "Inspect the selected project's index counts and readiness when diagnosing indexing or query problems.",
    {
      projectPath: projectPathProperty,
    },
  ),
  readOnlyTool(
    'afyx_graph_files',
    "Browse indexed repository paths with optional filtering, language and symbol metadata, and selectable grouping. Filesystem tools remain authoritative for paths absent from the index.",
    {
      path: {
        type: 'string',
        description: "Repository-relative directory restricting the returned file paths. Omission searches the indexed repository.",
      },
      pattern: {
        type: 'string',
        description: "Glob restriction for file paths, such as *.tsx or **/*.test.ts.",
      },
      format: {
        type: 'string',
        description: "Presentation style: tree for hierarchy, flat for a list, or grouped for language groups. Defaults to tree.",
        enum: ['tree', 'flat', 'grouped'],
        default: 'tree',
      },
      includeMetadata: {
        type: 'boolean',
        description: "Attach indexed language and symbol-count information; defaults to true.",
        default: true,
      },
      maxDepth: {
        type: 'number',
        description: "Directory depth bound for the displayed tree. Omission leaves depth unrestricted.",
      },
      projectPath: projectPathProperty,
    },
  ),
];
