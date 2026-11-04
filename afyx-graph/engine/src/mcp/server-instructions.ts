/**
 * Server-level instructions emitted in the MCP `initialize` response.
 *
 * MCP clients (Claude Code, Cursor, opencode, LangChain, OpenAI Agent
 * SDK, …) surface this text in the agent's system prompt automatically,
 * giving the agent a high-level playbook for the afyx-graph toolset
 * before it sees individual tool descriptions.
 *
 * Goals when editing this:
 *   - Route exact inventories separately from ranked relational exploration
 *   - Make index freshness and unsupported coverage explicit
 *   - Keep source-backed fallback available when the index cannot prove an answer
 *
 * Keep it tight. The agent reads this every session — long instructions
 * burn tokens. The default MCP surface is `afyx_graph_inventory` plus
 * `afyx_graph_explore` (see tool-registry.ts). The other
 * tools (node/search/callers/…) stay defined and are re-enablable via
 * AFYX_GRAPH_MCP_TOOLS, but they are NOT listed to agents, so don't name them.
 */
export const SERVER_INSTRUCTIONS = `# Afyx Graph — code intelligence over an indexed knowledge graph

Afyx Graph is a SQLite knowledge graph of indexed symbols, edges, and files in
the workspace — pre-computed structure for supported source facts. It indexes 30+ languages
(TypeScript/JavaScript, Python, Go, Rust, Java, C#, C/C++, PHP, Ruby, Swift,
Kotlin, and more). Index usefulness depends on extraction support, scope,
freshness, and bounded result contracts; use direct source inspection when
those cannot prove the requested fact.

## Two default tools: exact inventory and relational exploration

- \`afyx_graph_inventory\` enumerates exact supported Python class assignments,
  reports totals and bounded pages, and states freshness, exclusions, failures,
  and unresolved expressions. A partial page is never a complete inventory.
- \`afyx_graph_explore\` handles relationships, context, impact, and relevant
  source. Its ranking and caps are intentionally not exhaustive inventory.

\`afyx_graph_explore\` is Read-equivalent for relational/source questions. It
takes either a natural-language question or a bag of symbol/file names and
returns the **verbatim, line-numbered source** of the relevant symbols
grouped by file — the same \`<n>\\t<line>\` shape \`Read\` gives you, safe to
\`Edit\` from — PLUS the call path among them (including dynamic-dispatch hops
like callbacks, React re-render, and JSX children that grep can't follow) and
a blast-radius summary of what depends on them.

Use \`afyx_graph_explore\` when relationship context materially helps. For a
known file, an unsupported fact, or a stale/incomplete index, direct source
inspection is a valid source-backed fallback.

## How to query

- **Almost any question — "how does X work", architecture, a bug, "what/where is X", or surveying an area** → \`afyx_graph_explore\` with a natural-language question or the relevant names. ONE capped call returns the verbatim source grouped by file; most often the ONLY call you need.
- **Exact inventory/count of supported class assignments** → \`afyx_graph_inventory\`. Page through all results when needed and preserve its coverage warnings.
- **Hybrid inventory + relationship request** → enumerate accurately first, then explore only the relevant classes/files.
- **"How does X reach/become Y? / the flow / the path from X to Y"** → \`afyx_graph_explore\`, naming the symbols that span the flow (e.g. \`mutateElement renderScene\`) — it surfaces the call path among them, riding dynamic-dispatch hops, and returns their source.
- **Reading or editing a file/symbol you can name** → put its name or file path in the \`afyx_graph_explore\` query — it returns that current line-numbered source (safe to \`Edit\` from) with the call path and blast radius attached, so you don't Read it separately. For an overloaded name it returns every matching definition's body in one call.
- **Need more?** Call \`afyx_graph_explore\` again with more specific names — treat the source it returns as already Read. Suggested call counts are advisory only, NOT a quota; extra calls are never rejected or rate-limited.
- Qualified symbol names accept dots, \`::\`, or slashes, including containers whose names contain dots (for example, \`AppWeb.Format.group\`).
- Named-symbol call paths require exact matches; partial or mistyped names are never silently substituted as flow endpoints. If a graph query reports a missing symbol with did-you-mean suggestions, query the suggested name explicitly.

## Anti-patterns

- **Do not present ranked/capped results as exhaustive.** Use inventory when its supported fact contract fits; otherwise use a source-backed enumeration.
- **Respect index evidence.** If inventory reports stale, failed, skipped, unsupported, unresolved, or excluded coverage, state the limitation and use direct source inspection when proof beyond it is required.
- **Don't reconstruct a flow by hand** — name the endpoints in one \`afyx_graph_explore\` and it surfaces the path between them, dynamic-dispatch hops included.
- **After editing, check the staleness banner.** When a tool response starts with "⚠️ Some files referenced below were edited since the last index sync…", the listed files are pending re-index — Read those specific files for accurate content. Every file NOT in that banner is fresh, so still trust afyx-graph. A different, rarer banner — "⚠️ Afyx Graph auto-sync is DISABLED…" — means live watching stopped entirely (the whole index is frozen, not just a few files); until it's resolved, Read files directly to confirm anything that may have changed.
- **A file flagged "⚠ changed on disk after the last index sync" drifted from its index** (most common on projects queried via \`projectPath\`, which have no live watcher). Afyx Graph never serves a possibly-mis-sliced body from such a file — it either shows the file's full CURRENT source (trust it as a Read) or omits the source with this flag. When the source was omitted, Read that specific file; line numbers referencing it elsewhere in the response may be shifted until that project's next sync. All unflagged files remain trustworthy.

- **Source is re-served on every call by default**, including for fresh subagents and after context compaction. Cross-call dedup requires \`AFYX_GRAPH_EXPLORE_DEDUP=1\` and is only suitable for hosts that guarantee one durable context per connection. With that opt-in, **"Already sent earlier in this conversation"** points to exact, unchanged source returned by an earlier \`afyx_graph_explore\` in that context. Use that copy; don't re-fetch it and don't Read the file. The bytes it freed went into source you have not seen yet, elsewhere in the same response.

## Limitations

- If a tool reports a project isn't indexed (no \`.afyx-graph/\`), stop calling afyx-graph tools for that project for the rest of the session and use your built-in tools there instead. Indexing is the user's decision — mention they can run \`afyx-graph init\` if it comes up, but don't run it yourself.
- Index lags file writes by ~1 second.
- Cross-file resolution is best-effort name matching; ambiguous calls may return multiple candidates.
- No live correctness validation — that's still the TypeScript compiler / test suite / linter's job. Afyx Graph supplements those with structural context they don't have.
`;

/**
 * Instructions variant sent when the server's own root has NO afyx-graph index.
 *
 * The tools are still exposed (gating tool availability on whether `./` has an
 * index is the bug behind #964: it breaks monorepos where only sub-projects are
 * indexed, and a server that started before `afyx-graph init` never surfaces the
 * tools afterward). Instead of an "inactive" note, this variant tells the agent
 * afyx-graph works **per project**: there's no default project to query, so pass
 * a `projectPath` to any project that HAS a `.afyx-graph/`. The full single-
 * project playbook ({@link SERVER_INSTRUCTIONS}) is sent instead when the root
 * IS indexed, so the common case stays tight.
 */
export const SERVER_INSTRUCTIONS_NO_ROOT_INDEX = `# Afyx Graph — available (per-project; pass projectPath)

Afyx Graph is a SQLite knowledge graph of a codebase's symbols, edges, and
files (30+ languages): one \`afyx_graph_explore\` call returns the verbatim, line-numbered source
of the relevant symbols PLUS the call paths between them and a blast-radius
summary — replacing a grep + Read loop with one round-trip.

This server started somewhere with no \`.afyx-graph/\` of its own, so there is no
default project — but the tools are available and work **per project**:

- Use \`afyx_graph_inventory\` for exact supported declaration lists/counts and
  \`afyx_graph_explore\` for relational/context questions; pass \`projectPath\` to either.
  Do not present ranked/capped results as exhaustive; when index coverage cannot prove
  the requested fact, state the limitation and use direct source inspection.

- To query a project that HAS a \`.afyx-graph/\` index (e.g. a service inside a
  monorepo, or a second repo), pass its path as \`projectPath\` to
  \`afyx_graph_explore\` (and any other afyx-graph tool). Afyx Graph resolves the
  nearest \`.afyx-graph/\` at or above that path and answers from it — for as many
  projects as you like in one session.
- For a project with no \`.afyx-graph/\`, use your built-in tools (Read/Grep/Glob)
  for that project. Indexing is the user's decision — don't run it yourself, but
  if it comes up they can run \`afyx-graph init\` in a project to enable afyx-graph
  there (a new index is picked up live, no restart).
`;
