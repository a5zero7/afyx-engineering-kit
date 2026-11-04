import { resolveToolRoute, type ToolRoute } from './tool-registry';
import {
  classifyToolFailure,
  errorToolResult,
  type ToolResult,
} from './tool-results';

export type ReadToolRoute = Exclude<ToolRoute, 'status'>;
export type ReadToolHandler = (
  args: Record<string, unknown>,
) => Promise<ToolResult>;
export type ReadToolHandlers = {
  [Route in ReadToolRoute]: ReadToolHandler;
};

/**
 * Resolve and execute one worker-safe MCP read tool.
 *
 * The caller supplies the adapter implementations explicitly; this seam owns
 * only public-name routing and the established failure-to-ToolResult boundary.
 * Status is intentionally excluded because it requires main-thread watcher
 * state and is dispatched by ToolHandler.execute().
 */
export async function dispatchReadTool(
  toolName: string,
  args: Record<string, unknown>,
  handlers: ReadToolHandlers,
): Promise<ToolResult> {
  const route = resolveToolRoute(toolName);
  if (route === null || route === 'status') {
    return errorToolResult(`Unknown tool: ${toolName}`);
  }

  try {
    return await handlers[route](args);
  } catch (error) {
    return classifyToolFailure(error);
  }
}
