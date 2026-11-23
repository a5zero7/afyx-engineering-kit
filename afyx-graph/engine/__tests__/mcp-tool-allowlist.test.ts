/**
 * AFYX_GRAPH_MCP_TOOLS allowlist — lets an operator (or an A/B harness) trim the
 * exposed MCP tool surface without touching the client config. Inert when unset.
 * Filtering happens in ListTools (getTools) and is enforced again on execute().
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ToolHandler } from '../src/mcp/tools';

const ENV = 'AFYX_GRAPH_MCP_TOOLS';

describe('AFYX_GRAPH_MCP_TOOLS allowlist', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  const listed = () => new ToolHandler(null).getTools().map(t => t.name).sort();

  it('exposes inventory and explore by default when unset', () => {
    delete process.env[ENV];
    // The default set keeps the two distinct correctness routes: exact
    // structural inventory and ranked relational/source exploration.
    // node/search/callers/callees/impact/files/status stay defined and executable
    // but unlisted; AFYX_GRAPH_MCP_TOOLS re-enables them.
    expect(listed()).toEqual(['afyx_graph_explore', 'afyx_graph_inventory']);
  });

  it('keeps exact inventory visible after tiny-repository tool gating', () => {
    delete process.env[ENV];
    const tiny = { getStats: () => ({ fileCount: 12 }) } as unknown as
      NonNullable<ConstructorParameters<typeof ToolHandler>[0]>;
    expect(new ToolHandler(tiny).getTools().map((tool) => tool.name).sort())
      .toEqual(['afyx_graph_explore', 'afyx_graph_inventory']);
  });

  it('re-enables an unlisted tool via the allowlist (impact)', () => {
    process.env[ENV] = 'explore,impact';
    expect(listed()).toEqual(['afyx_graph_explore', 'afyx_graph_impact']);
  });

  it('filters ListTools to the allowlisted short names', () => {
    process.env[ENV] = 'explore,search,node';
    expect(listed()).toEqual(['afyx_graph_explore', 'afyx_graph_node', 'afyx_graph_search']);
  });

  it('accepts fully-qualified afyx_graph_ names and ignores whitespace', () => {
    process.env[ENV] = ' afyx_graph_explore , search ';
    expect(listed()).toEqual(['afyx_graph_explore', 'afyx_graph_search']);
  });

  it('treats an empty/whitespace value as unset (default surface)', () => {
    process.env[ENV] = '   ';
    expect(listed()).toEqual(['afyx_graph_explore', 'afyx_graph_inventory']);
  });

  it('keeps a non-empty unknown allowlist as an intentionally empty surface', () => {
    process.env[ENV] = 'not-a-tool';
    expect(listed()).toEqual([]);
  });

  it('rejects a disabled tool on execute (defense in depth)', async () => {
    process.env[ENV] = 'node';
    const res = await new ToolHandler(null).execute('afyx_graph_explore', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled via AFYX_GRAPH_MCP_TOOLS/);
  });

  it('lets an allowlisted tool past the guard', async () => {
    process.env[ENV] = 'search';
    // No Afyx Graph attached, so it fails *after* the allowlist guard — the
    // "disabled" message must NOT appear, proving the guard passed it through.
    const res = await new ToolHandler(null).execute('afyx_graph_search', { query: 'x' });
    expect(res.content[0].text).not.toMatch(/disabled via AFYX_GRAPH_MCP_TOOLS/);
  });
});
