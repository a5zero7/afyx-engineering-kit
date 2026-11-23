import { describe, expect, it } from 'vitest';
import {
  EXPLORE_EMISSION_KEY,
  EXPLORE_SESSION_VIEW_ARG,
  readExploreSessionView,
  type ExploreEmission,
} from '../src/mcp/explore-session-state';
import { AfyxSessionContext } from '../src/mcp/session-context';
import type { ToolResult } from '../src/mcp/tool-results';

const EXPLORE = 'afyx_graph_explore';

function emission(projectRoot: string, query = 'q'): ExploreEmission {
  return {
    projectRoot,
    query,
    files: [{ path: 'src/a.ts', ranges: [{ start: 1, end: 3 }], bytes: 30 }],
    sourceBytes: 30,
    responseBytes: 100,
  };
}

function resultWithEmission(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: 'ok' }],
    [EXPLORE_EMISSION_KEY]: value,
  } as ToolResult;
}

describe('AfyxSessionContext', () => {
  it('leaves ordinary calls allocation-free unless a forged key must be removed', () => {
    const context = new AfyxSessionContext();
    const clean = { query: 'name' };
    expect(context.prepareArgs('afyx_graph_search', clean)).toBe(clean);

    const forged = { query: 'name', [EXPLORE_SESSION_VIEW_ARG]: { projects: ['forged'] } };
    const prepared = context.prepareArgs('afyx_graph_search', forged);
    expect(prepared).not.toBe(forged);
    expect(prepared).toEqual({ query: 'name' });
  });

  it('ignores a forged Explore view and injects only server-owned history', () => {
    const context = new AfyxSessionContext();
    const prepared = context.prepareArgs(EXPLORE, {
      query: 'q',
      [EXPLORE_SESSION_VIEW_ARG]: { projects: [{ projectRoot: '/forged' }] },
    });
    expect(readExploreSessionView(prepared)).toEqual({ projects: [] });
  });

  it('records a valid emission and never exposes it in the public result', async () => {
    const context = new AfyxSessionContext();
    const result = await context.execute(EXPLORE, { query: 'q' }, async () => (
      resultWithEmission(emission('/repo/a'))
    ));

    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(EXPLORE_EMISSION_KEY in result).toBe(false);
    expect(context.getExploreHistory().callCount('/repo/a')).toBe(1);
  });

  it('drops malformed bookkeeping without failing the successful call', async () => {
    const context = new AfyxSessionContext();
    const result = await context.execute(EXPLORE, { query: 'q' }, async () => (
      resultWithEmission('malformed')
    ));
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(context.getExploreHistory().snapshot()).toEqual([]);
  });

  it('preserves the required view and emission across structured clone', async () => {
    const context = new AfyxSessionContext();
    let receivedView: unknown;
    await context.execute(EXPLORE, { query: 'q' }, async (_name, args) => {
      const workerArgs = structuredClone(args);
      receivedView = readExploreSessionView(workerArgs);
      return structuredClone(resultWithEmission(emission('/repo/worker')));
    });

    expect(receivedView).toEqual({ projects: [] });
    expect(context.getExploreHistory().callCount('/repo/worker')).toBe(1);
  });

  it('keeps projects isolated inside one session and reconnects cleanly', async () => {
    const first = new AfyxSessionContext();
    const reconnected = new AfyxSessionContext();
    for (const root of ['/repo/a', '/repo/b']) {
      await first.execute(EXPLORE, { query: root }, async () => (
        resultWithEmission(emission(root, root))
      ));
    }

    expect(first.getExploreHistory().callCount('/repo/a')).toBe(1);
    expect(first.getExploreHistory().callCount('/repo/b')).toBe(1);
    expect(reconnected.getExploreHistory().snapshot()).toEqual([]);
  });
});
