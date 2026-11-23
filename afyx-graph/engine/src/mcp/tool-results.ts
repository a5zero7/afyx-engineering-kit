import { PathRefusalError } from '../errors';
import { EXPLORE_EMISSION_KEY, type ExploreEmission } from './explore-session-state';

/** Agent-facing MCP tool result. */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /** Internal explore bookkeeping; stripped before the MCP response is sent. */
  _afyxExploreEmission?: ExploreEmission;
}

/** Recoverable absence of an Afyx Graph index; intentionally success-shaped. */
export class NotIndexedError extends Error {}

export function textToolResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorToolResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/** Return an agent-facing result with all runtime bookkeeping removed. */
export function stripInternalToolResult(result: ToolResult): ToolResult {
  if (!(EXPLORE_EMISSION_KEY in result)) return result;
  const publicResult = { ...result };
  delete publicResult[EXPLORE_EMISSION_KEY];
  return publicResult;
}

/** Map engine failures to the established agent-facing ToolResult contract. */
export function classifyToolFailure(error: unknown): ToolResult {
  if (error instanceof NotIndexedError) return textToolResult(error.message);
  if (error instanceof PathRefusalError) return errorToolResult(error.message);
  const message = error instanceof Error ? error.message : String(error);
  return errorToolResult(
    `Tool execution failed: ${message}. ` +
    'This is an internal afyx-graph error — retry the call once; if it persists, ' +
    'continue without afyx-graph for this task.',
  );
}
