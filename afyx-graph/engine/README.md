# Afyx Graph Engine

**Local repository intelligence — Technical Alpha source.**

This directory contains the standalone Afyx Graph engine. It indexes supported
source structures and relationships, provides symbol discovery, exploration,
impact/affected-test analysis, freshness and coverage reporting, CLI/MCP
interfaces, and a bundled local viewer. Its evidence remains structural and
bounded by indexed content, language routes and index freshness.

Build and test from this directory with `npm ci`, `npm run build:clean`, and
`npm test`. The package metadata version `1.0.0` is **not** a Stable v1 release
claim; rely on the repository release gate and artifact identity instead.

For public capability, lifecycle, command, limitation, and troubleshooting
guidance, see the repository [Component Guide](../../docs/COMPONENTS.md#afyx-graph)
and [Installation Guide](../../docs/INSTALLATION.md#graph-installation-and-project-initialization).

Afyx Graph is static structural evidence, not runtime proof. Check index health
and coverage before using a result, verify source when precision matters, and run
the affected behavioral tests before accepting a code change.

Regression gates, all local and deterministic (no model calls):

- `npm run test:semantic` compares the built engine with the frozen structural
  snapshot in `tests/semantic-baseline.json` (see `tests/semantic-baseline.meta.json`
  for its provenance). Never refreeze it from this implementation.
- `npm run test:smoke` drives the built CLI and the MCP server end to end.
- `npm test` runs the unit suites and first refuses stale build artifacts
  (`scripts/check-dist-clean.mjs`).

Project state lives in `.afyx-graph/` by default (database
`afyx-graph.db`). `AFYX_GRAPH_DIR` remains the backward-compatible override
for a single directory name inside the project root.

For a read-only corpus, set `AFYX_GRAPH_STATE_DIR` to a dedicated absolute
directory outside the corpus before every CLI or MCP invocation:

```powershell
$env:AFYX_GRAPH_STATE_DIR = 'D:\AfyxState\my-project'
afyx-graph init 'D:\Source\my-project' --yes
afyx-graph status 'D:\Source\my-project'
```

The first initialization writes `project.json` into that state directory and
binds it to the corpus's canonical path. CLI, MCP, daemon, watchdog, freshness,
locks, logs, database/WAL, saved trails, and daemon discovery then use the same
external location. The directory must be absolute, outside and non-overlapping
with the corpus, writable, free of path aliases/reparse points, and either empty
or already bound to that exact corpus. Invalid, unavailable, unbound non-empty,
or cross-project state fails closed; it never falls back to `.afyx-graph/`. Use
one state directory and one MCP process configuration per corpus. External-state
mode never auto-writes `afyx-graph.json` into the corpus.

An optional, committed `afyx-graph.json` at the project root maps custom file
extensions to supported languages.
The shipped product requires external Node.js 22.5.0 or newer on `PATH`; release
archives do not bundle Node or a `node_modules` dependency tree.
`afyx-graph status` reports index freshness (`MISSING`, `FRESH`, `STALE`,
`INVALID`, `UNKNOWN`) from `freshness.json` in the effective state, which the engine
rewrites after every successful index or sync. Afyx Graph makes no outbound network
requests and collects no telemetry.

## Latest verified CI checkpoint

The 2026-11-05 `dev` merge
[`e332230`](https://github.com/a5zero7/afyx-engineering-kit/commit/e332230a2c0ba162b447af1359cf591057ce26b6)
resolved a Windows Vitest `beforeEach` hook timeout in the Git/SQLite-heavy
`sync.test.ts` fixture. The hook now has an explicit 30-second budget and
Windows temporary-directory removal retries; the global CI `hookTimeout`
permits 30 seconds while local default remains 10 seconds. This preserves the
tests rather than skipping them. The [post-merge Graph Build](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333699)
passed Windows, Linux, and macOS; its report includes 5,836 unit tests and
21/21 CLI/MCP smoke checks. This is CI evidence for this commit, **not**
representative installed-host acceptance or a Stable v1 certification.

## File catalog coverage

The persisted file catalog reports one explicit depth per indexed file:

- `metadata`: path, content hash, language, size, and timestamps only;
- `content`: reserved for a future bounded searchable-content contract;
- `structural`: the native structural extraction contract ran, including valid
  files that contain no declarations and therefore produce zero symbols.

Generic Markdown (`.md`, `.markdown`) and JSON (`.json`) are metadata-indexed.
Their prose and values do not enter symbol search, FTS, nodes, or edges. Shopify
`templates/**/*.json` and `sections/**/*.json` retain their existing Liquid
structural route. PowerShell and shell files retain bounded direct-source
inspection but are not part of native structural extraction in this change.

`status`, MCP status, Inventory coverage, and Files metadata distinguish these
depths. Discovery accounting keeps ignored paths unenumerated; `ignored` remains
unknown rather than leaking excluded names. Existing `.gitignore`, Git exclude,
project exclude/include, path-safety, and generated-file rules apply before a
file may enter the catalog.

Install and release Afyx Graph only through the kit-level scripts and workflows:
`scripts/install-afyx-graph.ps1`, `scripts/install-afyx-graph.sh`,
`.github/workflows/graph-build.yml`, and `.github/workflows/graph-release.yml`.

Afyx Graph is licensed under the MIT License in `LICENSE`. Historical
implementation and attribution evidence is retained in the repository's Phase
5 documentation and Git history; it is not part of the current release payload.
