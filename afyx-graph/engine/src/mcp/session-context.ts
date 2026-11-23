import {
  EXPLORE_EMISSION_KEY,
  EXPLORE_SESSION_VIEW_ARG,
  ExploreSessionState,
  type ExploreEmission,
} from './explore-session-state';
import type { ToolResult } from './tool-results';

const EXPLORE_TOOL = 'afyx_graph_explore';

export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

/**
 * Per-connection Afyx runtime context.
 *
 * The shared engine and tool handler never own client history. This context
 * prepares a bounded, serializable view for an Explore call, then consumes and
 * removes the internal emission returned by either a worker or the in-process
 * path. A fresh MCP connection receives a fresh context.
 */
export class AfyxSessionContext {
  private readonly exploreHistory = new ExploreSessionState();

  /** Read-only access for diagnostics and focused ownership tests. */
  getExploreHistory(): ExploreSessionState {
    return this.exploreHistory;
  }

  /** Execute one tool call through the session boundary. */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    executor: ToolExecutor,
  ): Promise<ToolResult> {
    const prepared = this.prepareArgs(toolName, args);
    const result = await executor(toolName, prepared);
    return this.consumeResult(toolName, result);
  }

  /**
   * Remove client-forged bookkeeping and attach only server-owned history.
   * Non-Explore calls without the internal key keep their original object.
   */
  prepareArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    const hasForgedView = EXPLORE_SESSION_VIEW_ARG in args;
    if (toolName !== EXPLORE_TOOL && !hasForgedView) return args;

    const prepared = { ...args };
    delete prepared[EXPLORE_SESSION_VIEW_ARG];
    if (toolName === EXPLORE_TOOL) {
      prepared[EXPLORE_SESSION_VIEW_ARG] = this.exploreHistory.view();
    }
    return prepared;
  }

  /**
   * Strip internal bookkeeping before a result reaches the wire. Recording is
   * best-effort: malformed metadata cannot turn a successful tool call into a
   * failed one.
   */
  consumeResult(toolName: string, result: ToolResult): ToolResult {
    if (!(EXPLORE_EMISSION_KEY in result)) return result;
    const emission = result?.[EXPLORE_EMISSION_KEY];
    const publicResult = { ...result };
    delete publicResult[EXPLORE_EMISSION_KEY];
    if (toolName === EXPLORE_TOOL && emission !== undefined) {
      try {
        this.exploreHistory.record(emission as ExploreEmission);
      } catch {
        // Session bookkeeping must never fail an otherwise valid tool result.
      }
    }
    return publicResult;
  }
}

