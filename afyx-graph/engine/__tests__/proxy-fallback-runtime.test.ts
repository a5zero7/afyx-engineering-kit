import { describe, expect, it, vi } from 'vitest';
import { handleLocalFallbackMessage } from '../src/mcp/proxy';
import { AfyxSessionContext } from '../src/mcp/session-context';
import {
  EXPLORE_EMISSION_KEY,
  readExploreSessionView,
  viewForProject,
  type ExploreEmission,
  type ExploreSessionView,
} from '../src/mcp/explore-session-state';
import { ErrorCodes } from '../src/mcp/transport';

function emission(root: string): ExploreEmission {
  return {
    projectRoot: root,
    query: 'q',
    files: [],
    sourceBytes: 0,
    responseBytes: 2,
  };
}

describe('local proxy fallback runtime', () => {
  it('uses the public InvalidParams and MethodNotFound contracts', async () => {
    const getHandler = vi.fn(async () => ({ executeRuntime: vi.fn() }));
    const context = new AfyxSessionContext();

    expect(await handleLocalFallbackMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
      context,
      getHandler,
    )).toEqual({
      jsonrpc: '2.0', id: 1,
      error: { code: ErrorCodes.InvalidParams, message: 'Missing tool name' },
    });
    expect(await handleLocalFallbackMessage(
      { jsonrpc: '2.0', id: 2, method: 'unknown/method' },
      context,
      getHandler,
    )).toEqual({
      jsonrpc: '2.0', id: 2,
      error: { code: ErrorCodes.MethodNotFound, message: 'Method not found: unknown/method' },
    });
    expect(getHandler).not.toHaveBeenCalled();
  });

  it('answers ping and ignores notifications without constructing an engine', async () => {
    const getHandler = vi.fn(async () => ({ executeRuntime: vi.fn() }));
    const context = new AfyxSessionContext();
    expect(await handleLocalFallbackMessage(
      { jsonrpc: '2.0', id: 3, method: 'ping' }, context, getHandler,
    )).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
    expect(await handleLocalFallbackMessage(
      { jsonrpc: '2.0', method: 'initialized' }, context, getHandler,
    )).toBeNull();
    expect(getHandler).not.toHaveBeenCalled();
  });

  it('owns independent history and strips worker-compatible metadata', async () => {
    const first = new AfyxSessionContext();
    const second = new AfyxSessionContext();
    const seenViews: Array<ExploreSessionView | null> = [];
    const handler = {
      executeRuntime: vi.fn(async (_name: string, args: Record<string, unknown>) => {
        seenViews.push(readExploreSessionView(structuredClone(args)));
        return structuredClone({
          content: [{ type: 'text' as const, text: 'ok' }],
          [EXPLORE_EMISSION_KEY]: emission('/repo/fallback'),
        });
      }),
    };
    const getHandler = async () => handler;
    const request = (id: number) => ({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'afyx_graph_explore', arguments: { query: 'q' } },
    });

    const responseA1 = await handleLocalFallbackMessage(request(1), first, getHandler);
    await handleLocalFallbackMessage(request(2), first, getHandler);
    await handleLocalFallbackMessage(request(3), second, getHandler);

    expect(JSON.stringify(responseA1)).not.toContain(EXPLORE_EMISSION_KEY);
    expect(viewForProject(seenViews[0], '/repo/fallback')?.callCount).toBe(0);
    expect(viewForProject(seenViews[1], '/repo/fallback')?.callCount).toBe(1);
    expect(viewForProject(seenViews[2], '/repo/fallback')?.callCount).toBe(0);
    expect(first.getExploreHistory().callCount('/repo/fallback')).toBe(2);
    expect(second.getExploreHistory().callCount('/repo/fallback')).toBe(1);
  });
});
