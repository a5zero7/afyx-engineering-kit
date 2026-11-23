import { describe, expect, it, vi } from 'vitest';
import { PathRefusalError } from '../src/errors';
import {
  dispatchReadTool,
  type ReadToolHandlers,
  type ReadToolRoute,
} from '../src/mcp/tool-dispatch';
import { ToolHandler } from '../src/mcp/tools';
import { NotIndexedError, type ToolResult } from '../src/mcp/tool-results';

type ReadHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
type ReadHandlerMethod =
  | 'handleSearch'
  | 'handleInventory'
  | 'handleCallers'
  | 'handleCallees'
  | 'handleImpact'
  | 'handleExplore'
  | 'handleNode'
  | 'handleFiles';

const routes: ReadonlyArray<readonly [string, ReadHandlerMethod]> = [
  ['afyx_graph_search', 'handleSearch'],
  ['afyx_graph_inventory', 'handleInventory'],
  ['afyx_graph_callers', 'handleCallers'],
  ['afyx_graph_callees', 'handleCallees'],
  ['afyx_graph_impact', 'handleImpact'],
  ['afyx_graph_explore', 'handleExplore'],
  ['afyx_graph_node', 'handleNode'],
  ['afyx_graph_files', 'handleFiles'],
];

const routeKeys: ReadonlyArray<readonly [string, ReadToolRoute]> = routes.map(
  ([toolName, method]) => [toolName, method.replace('handle', '').toLowerCase() as ReadToolRoute],
);

function fakeReadHandlers() {
  const calls: Array<{ route: ReadToolRoute; args: Record<string, unknown> }> = [];
  const results = new Map<ReadToolRoute, ToolResult>();
  const handlers = {} as ReadToolHandlers;

  for (const [, route] of routeKeys) {
    const result: ToolResult = { content: [{ type: 'text', text: route }] };
    results.set(route, result);
    handlers[route] = vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ route, args });
      return result;
    });
  }

  return { handlers, calls, results };
}

function fakeToolHandler() {
  const subject = new ToolHandler(null);
  const methods = subject as unknown as Record<ReadHandlerMethod, ReadHandler>;
  const calls: Array<{ method: ReadHandlerMethod; args: Record<string, unknown> }> = [];
  const results = new Map<ReadHandlerMethod, ToolResult>();

  for (const [, method] of routes) {
    const result: ToolResult = { content: [{ type: 'text', text: method }] };
    results.set(method, result);
    methods[method] = vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ method, args });
      return result;
    });
  }

  return { subject, methods, calls, results };
}

describe('Afyx read-tool dispatch seam', () => {
  it.each(routeKeys)('%s invokes only the %s dependency and passes through result and args', async (toolName, route) => {
    const { handlers, calls, results } = fakeReadHandlers();
    const args = { marker: route };

    const result = await dispatchReadTool(toolName, args, handlers);

    expect(result).toBe(results.get(route));
    expect(calls).toEqual([{ route, args }]);
    expect(calls[0]?.args).toBe(args);
  });

  it.each(['afyx_graph_status', 'afyx_graph_missing'])(
    '%s is not accepted by read dispatch and preserves the unknown-tool result',
    async (toolName) => {
      const { handlers, calls } = fakeReadHandlers();

      await expect(dispatchReadTool(toolName, {}, handlers)).resolves.toEqual({
        content: [{ type: 'text', text: `Error: Unknown tool: ${toolName}` }],
        isError: true,
      });
      expect(calls).toEqual([]);
    },
  );

  it.each([
    {
      name: 'NotIndexedError',
      error: new NotIndexedError('No Afyx Graph project is loaded'),
      expected: { content: [{ type: 'text', text: 'No Afyx Graph project is loaded' }] },
    },
    {
      name: 'PathRefusalError',
      error: new PathRefusalError('Path escapes the project root'),
      expected: {
        content: [{ type: 'text', text: 'Error: Path escapes the project root' }],
        isError: true,
      },
    },
    {
      name: 'generic Error',
      error: new Error('database unavailable'),
      expected: {
        content: [{
          type: 'text',
          text: 'Error: Tool execution failed: database unavailable. This is an internal afyx-graph error — retry the call once; if it persists, continue without afyx-graph for this task.',
        }],
        isError: true,
      },
    },
    {
      name: 'non-Error throw',
      error: 'worker exploded',
      expected: {
        content: [{
          type: 'text',
          text: 'Error: Tool execution failed: worker exploded. This is an internal afyx-graph error — retry the call once; if it persists, continue without afyx-graph for this task.',
        }],
        isError: true,
      },
    },
  ])('classifies $name without throwing', async ({ error, expected }) => {
    const { handlers } = fakeReadHandlers();
    handlers.search = vi.fn(async () => { throw error; });

    await expect(dispatchReadTool('afyx_graph_search', {}, handlers)).resolves.toEqual(expected);
  });
});

describe('ToolHandler worker-facing facade', () => {
  it.each(routes)('%s keeps its explicit %s dependency', async (toolName, method) => {
    const { subject, calls, results } = fakeToolHandler();
    const args = { marker: method };

    await expect(subject.executeReadTool(toolName, args)).resolves.toBe(results.get(method));
    expect(calls).toEqual([{ method, args }]);
  });

  it('retains the never-throw failure contract', async () => {
    const { subject, methods } = fakeToolHandler();
    methods.handleSearch = vi.fn(async () => { throw new NotIndexedError('not indexed'); });
    await expect(subject.executeReadTool('afyx_graph_search', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'not indexed' }],
    });
  });
});
