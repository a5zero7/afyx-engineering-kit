import { createHash } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPSession, PROTOCOL_VERSION, SERVER_INFO } from '../src/mcp/session';
import { ToolHandler, getStaticTools, tools, type ToolResult } from '../src/mcp/tools';
import {
  ErrorCodes,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcTransport,
  type MessageHandler,
} from '../src/mcp/transport';
import type { MCPEngine } from '../src/mcp/engine';
import { EXPLORE_SESSION_VIEW_ARG } from '../src/mcp/explore-session-state';
import {
  REGISTERED_TOOL_NAMES,
  catalogMatchesRegistry,
  parseToolCallParams,
} from '../src/mcp/tool-registry';

const MCP_TOOLS_ENV = 'AFYX_GRAPH_MCP_TOOLS';
const EXPECTED_TOOL_NAMES = [
  'afyx_graph_search',
  'afyx_graph_inventory',
  'afyx_graph_callers',
  'afyx_graph_callees',
  'afyx_graph_impact',
  'afyx_graph_node',
  'afyx_graph_explore',
  'afyx_graph_status',
  'afyx_graph_files',
];

class RecordingTransport implements JsonRpcTransport {
  private handler: MessageHandler | null = null;
  readonly responses: JsonRpcResponse[] = [];

  start(handler: MessageHandler): void { this.handler = handler; }
  stop(): void { this.handler = null; }
  send(response: JsonRpcResponse): void { this.responses.push(response); }
  notify(): void { /* server notifications are not used by MCPSession */ }
  request(): Promise<unknown> { return Promise.resolve({ roots: [] }); }
  sendResult(id: string | number, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }
  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  }

  async receive(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!this.handler) throw new Error('transport not started');
    await this.handler(message);
  }
}

function sessionHarness() {
  const transport = new RecordingTransport();
  const result: ToolResult = { content: [{ type: 'text', text: 'handled' }] };
  const handler = {
    getTools: vi.fn(() => tools),
    executeRuntime: vi.fn(async () => result),
  };
  const engine = {
    hasDefaultAfyxGraph: vi.fn(() => true),
    getProjectPath: vi.fn(() => null),
    getToolHandler: vi.fn(() => handler),
    ensureInitialized: vi.fn(async () => undefined),
    retryInitializeSync: vi.fn(),
  } as unknown as MCPEngine;
  const session = new MCPSession(transport, engine);
  session.start();
  return { transport, handler };
}

describe('MCP public semantic contract', () => {
  const originalToolsEnv = process.env[MCP_TOOLS_ENV];

  afterEach(() => {
    if (originalToolsEnv === undefined) delete process.env[MCP_TOOLS_ENV];
    else process.env[MCP_TOOLS_ENV] = originalToolsEnv;
  });

  it('freezes the complete tool catalog, schemas, descriptions, annotations, and metadata', () => {
    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES);
    expect(REGISTERED_TOOL_NAMES).toEqual(EXPECTED_TOOL_NAMES);
    expect(catalogMatchesRegistry(tools)).toBe(true);
    expect(createHash('sha256').update(JSON.stringify(tools)).digest('hex'))
      .toBe('abc1da85b7fea6dd50defb57894416919ca0f8da6729e439e4a844cb5a267fe3');

    delete process.env[MCP_TOOLS_ENV];
    expect(getStaticTools().map((tool) => tool.name)).toEqual(['afyx_graph_inventory', 'afyx_graph_explore']);
  });

  it('parses call envelopes without widening or inventing schema behavior', () => {
    expect(parseToolCallParams(undefined)).toEqual({ ok: false, message: 'Missing tool name' });
    expect(parseToolCallParams({ name: 42 })).toEqual({ ok: false, message: 'Unknown tool: 42' });
    expect(parseToolCallParams({ name: 'afyx_graph_status', arguments: null })).toEqual({
      ok: true,
      call: { name: 'afyx_graph_status', route: 'status', args: {} },
    });
  });

  it('returns the negotiated server identity and tool capability on initialize', async () => {
    const { transport } = sessionHarness();
    await transport.receive({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2099-01-01', capabilities: {} },
    });

    const result = transport.responses[0]?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual(SERVER_INFO);
    expect(result.capabilities).toEqual({ tools: {} });
    expect(typeof result.instructions).toBe('string');
    expect(result.instructions).toMatch(/afyx_graph_inventory/);
    expect(result.instructions).toMatch(/ranked\/capped results as exhaustive/);
    expect(result.instructions).toMatch(/direct source inspection/);
    expect(result.instructions).not.toMatch(/Trust afyx-graph's results/);
  });

  it('lists the handler surface and dispatches a valid tool call unchanged', async () => {
    const { transport, handler } = sessionHarness();
    await transport.receive({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(transport.responses[0]).toEqual({ jsonrpc: '2.0', id: 2, result: { tools } });

    const args = { query: 'AuthService', maxFiles: 4 };
    await transport.receive({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'afyx_graph_explore', arguments: args },
    });
    expect(handler.executeRuntime).toHaveBeenCalledWith(
      'afyx_graph_explore', {
        ...args,
        [EXPLORE_SESSION_VIEW_ARG]: { projects: [] },
      },
    );
    expect(transport.responses[1]).toEqual({
      jsonrpc: '2.0', id: 3,
      result: { content: [{ type: 'text', text: 'handled' }] },
    });
  });

  it('normalizes omitted or null tool arguments to an empty object', async () => {
    const { transport, handler } = sessionHarness();
    await transport.receive({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'afyx_graph_status', arguments: null },
    });
    expect(handler.executeRuntime).toHaveBeenCalledWith(
      'afyx_graph_status', {},
    );
  });

  it('returns exact JSON-RPC errors for missing names, unknown tools, and methods', async () => {
    const { transport, handler } = sessionHarness();
    await transport.receive({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} });
    await transport.receive({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'afyx_graph_missing', arguments: {} },
    });
    await transport.receive({ jsonrpc: '2.0', id: 7, method: 'unknown/method' });

    expect(transport.responses).toEqual([
      { jsonrpc: '2.0', id: 5, error: { code: ErrorCodes.InvalidParams, message: 'Missing tool name' } },
      { jsonrpc: '2.0', id: 6, error: { code: ErrorCodes.InvalidParams, message: 'Unknown tool: afyx_graph_missing' } },
      { jsonrpc: '2.0', id: 7, error: { code: ErrorCodes.MethodNotFound, message: 'Method not found: unknown/method' } },
    ]);
    expect(handler.executeRuntime).not.toHaveBeenCalled();
  });

  it('answers standard capability probes and ping with stable empty shapes', async () => {
    const { transport } = sessionHarness();
    await transport.receive({ jsonrpc: '2.0', id: 8, method: 'ping' });
    await transport.receive({ jsonrpc: '2.0', id: 9, method: 'resources/list' });
    await transport.receive({ jsonrpc: '2.0', id: 10, method: 'resources/templates/list' });
    await transport.receive({ jsonrpc: '2.0', id: 11, method: 'prompts/list' });

    expect(transport.responses.map((response) => response.result)).toEqual([
      {}, { resources: [] }, { resourceTemplates: [] }, { prompts: [] },
    ]);
  });

  it('keeps invalid arguments and engine failures inside ToolResult semantics', async () => {
    const invalid = await new ToolHandler(null).execute('afyx_graph_search', {});
    expect(invalid).toEqual({
      content: [{ type: 'text', text: 'Error: query must be a non-empty string' }],
      isError: true,
    });

    const failingGraph = {
      reopenIfReplaced: () => false,
      searchNodes: () => { throw new Error('database exploded'); },
    };
    const failed = await new ToolHandler(failingGraph as never).execute(
      'afyx_graph_search', { query: 'x' },
    );
    expect(failed).toEqual({
      content: [{
        type: 'text',
        text: 'Error: Tool execution failed: database exploded. This is an internal afyx-graph error — retry the call once; if it persists, continue without afyx-graph for this task.',
      }],
      isError: true,
    });

    const unindexed = await new ToolHandler(null).execute('afyx_graph_search', { query: 'x' });
    expect(unindexed.isError).toBeUndefined();
    expect(unindexed.content[0]?.text).toContain('No Afyx Graph project is loaded for this session.');
  });
});
