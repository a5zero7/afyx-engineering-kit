# Tool routing

Use direct file reads or targeted text search for known symbols, simple textual facts, configuration, and localized changes. Do not use Afyx Graph merely to read a known file, grep an exact string, or inspect a tiny local function.

Use Afyx Graph (the `afyx_graph_*` MCP tools or the `afyx-graph` CLI) when relationships materially determine correctness: callers and callees, inheritance, dependency paths, dynamic dispatch, cross-module impact, or affected tests. Do not use it merely because it is available. If Afyx Graph is missing, unavailable, or stale, use direct source inspection and targeted search. Never invoke the deprecated external graph dependency through MCP, CLI, shell, scripts, or fallback paths.

Use Headroom selectively for large/noisy logs, search output, JSON, API or database output, generated diagnostics, or large documentation when compression preserves the needed meaning. Do not use it for source code by default or for small results. Preserve access to the exact original evidence and return to it for lines, values, ordering, stack frames, SQL rows, or code details.

Do not add tool calls after the material question is answered. Prefer the smallest evidence path that retains every fact needed for a correct change.
