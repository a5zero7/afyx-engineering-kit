import type { ToolDefinition } from './tools';

/** Internal handler routes. These values never appear on the MCP wire. */
export type ToolRoute =
  | 'search'
  | 'inventory'
  | 'callers'
  | 'callees'
  | 'impact'
  | 'node'
  | 'explore'
  | 'status'
  | 'files';

const TOOL_ROUTES = new Map<string, ToolRoute>([
  ['afyx_graph_search', 'search'],
  ['afyx_graph_inventory', 'inventory'],
  ['afyx_graph_callers', 'callers'],
  ['afyx_graph_callees', 'callees'],
  ['afyx_graph_impact', 'impact'],
  ['afyx_graph_node', 'node'],
  ['afyx_graph_explore', 'explore'],
  ['afyx_graph_status', 'status'],
  ['afyx_graph_files', 'files'],
]);

const DEFAULT_TOOL_ROUTES = new Set<ToolRoute>(['inventory', 'explore']);

/** Public names in stable registration order. Used to prove catalog parity. */
export const REGISTERED_TOOL_NAMES = Object.freeze([...TOOL_ROUTES.keys()]);

export interface ParsedToolCall {
  name: string;
  route: ToolRoute;
  args: Record<string, unknown>;
}

export type ToolCallParseResult =
  | { ok: true; call: ParsedToolCall }
  | { ok: false; message: string };

/** Resolve a public MCP name to its internal semantic route. */
export function resolveToolRoute(name: unknown): ToolRoute | null {
  return typeof name === 'string' ? TOOL_ROUTES.get(name) ?? null : null;
}

/**
 * Parse the MCP `tools/call` envelope without applying JSON Schema defaults.
 * This intentionally preserves the established wire behavior: falsy argument
 * payloads become `{}`, while truthy payloads are forwarded to handler-level
 * validation unchanged.
 */
export function parseToolCallParams(params: unknown): ToolCallParseResult {
  if (!params || typeof params !== 'object') {
    return { ok: false, message: 'Missing tool name' };
  }
  const value = params as { name?: unknown; arguments?: unknown };
  if (!value.name) return { ok: false, message: 'Missing tool name' };
  const route = resolveToolRoute(value.name);
  if (!route) return { ok: false, message: `Unknown tool: ${String(value.name)}` };
  return {
    ok: true,
    call: {
      name: value.name as string,
      route,
      args: (value.arguments || {}) as Record<string, unknown>,
    },
  };
}

/** Return the operator-facing suffix of an Afyx Graph MCP tool name. */
export function toolShortName(name: string): string {
  return name.replace(/^afyx_graph_/, '');
}

function configuredRoutes(raw: string | undefined): Set<ToolRoute> | null {
  if (!raw || !raw.trim()) return null;
  const routes = new Set<ToolRoute>();
  for (const entry of raw.split(',')) {
    const route = resolveToolRoute(`afyx_graph_${toolShortName(entry.trim())}`);
    if (route) routes.add(route);
  }
  return routes;
}

/** Build the static/listed surface while preserving catalog order. */
export function selectToolDefinitions(
  definitions: readonly ToolDefinition[],
  rawAllowlist: string | undefined,
): ToolDefinition[] {
  const configured = configuredRoutes(rawAllowlist);
  const visible = configured ?? DEFAULT_TOOL_ROUTES;
  return definitions.filter((definition) => {
    const route = resolveToolRoute(definition.name);
    return route !== null && visible.has(route);
  });
}

/** Defense-in-depth check for calls cached before an allowlist changed. */
export function isToolEnabled(name: string, rawAllowlist: string | undefined): boolean {
  const configured = configuredRoutes(rawAllowlist);
  if (!configured) return true;
  const route = resolveToolRoute(name);
  return route !== null && configured.has(route);
}

/** Clone schemas so every cross-project tool requires an explicit project. */
export function requireProjectPath(definitions: readonly ToolDefinition[]): ToolDefinition[] {
  return definitions.map((definition) => {
    if (!definition.inputSchema.properties.projectPath) return definition;
    const required = definition.inputSchema.required ?? [];
    if (required.includes('projectPath')) return definition;
    return {
      ...definition,
      inputSchema: {
        ...definition.inputSchema,
        required: [...required, 'projectPath'],
      },
    };
  });
}

/** Detect catalog/route drift without exposing internal metadata to clients. */
export function catalogMatchesRegistry(definitions: readonly ToolDefinition[]): boolean {
  return definitions.length === REGISTERED_TOOL_NAMES.length
    && definitions.every((definition, index) => definition.name === REGISTERED_TOOL_NAMES[index]);
}
