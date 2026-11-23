# Phase 5B Native MCP/CLI Runtime Design

Task: `AFYX-57384`  
Date: 2026-10-03  
Baseline: `2a82886d282c35756f9f17431ff473d14d83bcb7`  
Branch: `afyx/native-phase5b-mcp-cli-runtime`

Implementation: `e82e27f0f3ac0d92134d217e200f6213328df819`
Review: [PR #53](https://github.com/a5zero7/afyx-codex-engineering-kit/pull/53)

## Ownership map

```text
CLI host / daemon
  └─ shared engine
       ├─ project and graph lifecycle
       ├─ one writer/watcher owner
       ├─ stateless tool handler
       └─ bounded native worker pool (read connections only)

transport connection
  └─ MCP session
       ├─ JSON-RPC protocol state and root resolution
       └─ Afyx session context
            ├─ bounded per-project Explore history
            ├─ serializable worker view
            └─ internal emission consumption/removal
```

Transport owns framing only. The shared engine owns heavyweight resources.
Every connection owns a fresh session context. Workers receive plain data and
never own client history.

## MUST KEEP

- Public MCP tool names, schemas, results, protocol version, and JSON-RPC error
  behavior.
- Fast initialize response before graph initialization.
- Root precedence: `rootUri`, first workspace folder, explicit CLI path, then
  `roots/list`/cwd fallback.
- Tools remain visible without a default index.
- Session and reconnect isolation, including per-project isolation within one
  session and bounded non-persistent history.
- Untrusted client input cannot forge internal history; bookkeeping never
  reaches the wire and cannot fail an otherwise successful call.
- Worker and in-process paths expose compatible public results.
- Shared daemon writer/watcher ownership, bounded worker concurrency, graceful
  fallback, and clean shutdown.
- Proxy fallback history is local and is never merged with daemon history.
- Project containment and config/secret protections.

## CAN CHANGE

- Class/helper names, internal property names, call sequence, and collection
  layout.
- Which runtime layer prepares the worker view and consumes the emission.
- Internal server-generated JSON-RPC request identifiers.
- Comments and test structure that only describe historical closure work.

## REMOVE

- Session bookkeeping inside `ToolHandler`.
- `_cgExploreEmission`, `_cgExploreSession`, and touched-scope `CG-*`
  terminology.
- Client-state parameters on the otherwise shared/stateless tool handler.
- Tests coupled to the historical placement of session state instead of the
  observable isolation and wire contract.

## IMPROVE

- Make session ownership explicit through one Afyx-native context boundary.
- Clone/sanitize arguments only for Explore or forged internal input.
- Keep the successful tool result intact while consuming bookkeeping on a
  best-effort path.
- Reuse Node worker threads and existing graph lifecycle; add no dependency,
  queue framework, duplicate writer, or global mutable session state.
- Validate the runtime through direct contract tests instead of private
  byte-for-byte implementation parity.

## Architecture decision

The existing line-based transports, shared engine/project lifecycle, and native
`worker_threads` pool already match the required ownership and risk boundaries.
They are retained as platform mechanisms, not as historical templates. The
substantive Phase 5B change is to replace the cross-layer session bridge with an
Afyx-owned `AfyxSessionContext`, making the shared tool handler client-stateless
and giving direct MCP sessions and proxy fallback one common execution contract.

