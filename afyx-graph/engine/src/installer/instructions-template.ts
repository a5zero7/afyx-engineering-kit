/**
 * The marker-fenced agent-instructions block the installer writes into each
 * agent's instructions file (CLAUDE.md / AGENTS.md / GEMINI.md).
 *
 * History: pre-#529 the installer wrote a full usage playbook here, which
 * duplicated the MCP `initialize` instructions for the main agent — so it
 * was removed and `mcp/server-instructions.ts` became the single source of
 * truth. A much smaller block returned for #704, because the MCP
 * instructions cannot reach two audiences that the instructions FILE does
 * reach:
 *
 *  - **Task-tool subagents** — they receive the project instructions file
 *    in their context but NOT the MCP initialize instructions. They hold
 *    the afyx-graph MCP tools only as deferred names and rarely think to
 *    load them: measured on a forced-delegation flow question (excalidraw,
 *    sonnet, high effort), subagents loaded + used afyx-graph in ~1 of 9
 *    runs without this block, and consistently with it — including runs
 *    with zero Read/grep fallback.
 *  - **Non-MCP harnesses** — agents with no MCP client at all can still
 *    run the `afyx-graph explore` CLI, which prints the same output as the
 *    MCP tool.
 *
 * Keep this block SHORT. The main agent reads it every turn on top of the
 * server instructions — the #529 duplication-cost argument still bounds
 * its size. Command names and the two surfaces, nothing more.
 */

/** Markers used by the marker-based section write/removal. */
export const AFYX_GRAPH_SECTION_START = '<!-- AFYX_GRAPH_START -->';
export const AFYX_GRAPH_SECTION_END = '<!-- AFYX_GRAPH_END -->';

/**
 * The full block, markers included, exactly as written to disk.
 *
 * The wording is deliberately CONDITIONAL ("in repositories indexed by…"):
 * a global install writes this into a user-scope file (~/.claude/CLAUDE.md,
 * ~/.codex/AGENTS.md) that applies to every project the user opens —
 * including unindexed ones, where an unconditional "this repository is
 * indexed" claim would send subagents into failing afyx-graph calls (the
 * noise the unindexed-session policy exists to prevent).
 */
export const AFYX_GRAPH_INSTRUCTIONS_BLOCK = `${AFYX_GRAPH_SECTION_START}
## Afyx Graph

In repositories indexed by Afyx Graph (a local \`.afyx-graph/\` directory exists, or the owner configured a working external-state MCP mapping), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): \`afyx_graph_explore\` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): \`afyx-graph explore "<symbol names or question>"\` prints the same output.

If there is neither a local \`.afyx-graph/\` directory nor a working owner-configured external-state mapping, skip Afyx Graph entirely — indexing is the user's decision.
${AFYX_GRAPH_SECTION_END}`;
