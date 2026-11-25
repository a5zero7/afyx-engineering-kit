# Cross-repository contract impact

Graph follows an explicitly declared binding from a producer contract to a
consumer symbol, then follows indexed callers inside that consumer repository.
Each repository uses a unique repository ID. Put `afyx-contracts.json` at the
root and include it in the index. Commit the manifest and the sources before
indexing a peer so Graph can verify freshness.

A producer can declare its identity with:

```json
{"repository":"catalog","consumes":[]}
```

A sibling can declare a binding with:

```json
{
  "repository": "checkout",
  "consumes": [
    {
      "producer": "catalog",
      "contract": {"file":"api/schema.graphql","symbol":"Query.item"},
      "consumer": {"file":"src/lookup.ts","symbol":"lookupItem"}
    }
  ]
}
```

Use repository-relative paths and exact qualified names. Supported producer
endpoints are GraphQL fields and object types, Protobuf RPCs and messages, and
OpenAPI operations and schemas. Protobuf names include their package when one
is declared. OpenAPI names use `GET:/items` for operations or `schemas/Item`
for schemas. A same-name symbol alone provides no contract evidence.

```bash
afyx-graph impact Query.item --file api/schema.graphql --peer-roots checkout --depth 3 --json
```

Relative peer roots are resolved from the producer's parent directory. Pass
at most eight sibling roots. The output includes source locations, explicit
`cross-repo-contract` links, and separately identified local `indexed-call`
links. `callers` returns direct consumer bindings. Peer indexes are read-only.
Unindexed, stale, ambiguous, and symlinked roots are excluded and coverage
limitations are reported.

For MCP, set the host-side `AFYX_GRAPH_PEER_ROOTS` to a JSON array of authorized
roots, then pass a subset as `peerProjectPaths` to callers or impact. The
installed host bridge instead receives allowed paths in trusted configuration
as `trustedCapabilities.graph.peerProjectPaths`. Task payloads cannot grant
that access.

A host task with `taskType: "impact"` and `forgeAdvice: true` can request an
advisory producer → consumer → verification plan. Authorized Context processing
packs large evidence as complete, cited records and reports estimated token
counts, byte budgets, and omitted records. With `AFYX_CONTEXT_OPT_IN=0`, Forge
uses bounded Graph evidence directly. A skipped peer or truncated result
reduces coverage and does not establish that other affected consumers are absent.
