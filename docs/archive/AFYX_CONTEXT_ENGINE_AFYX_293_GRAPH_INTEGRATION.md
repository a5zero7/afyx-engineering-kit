# AFYX-293 — Controlled opt-in Graph–ACE real-consumer integration

Status: **IMPLEMENTED AND VALIDATED; DRAFT OWNER REVIEW PENDING**

## Source and boundary

AFYX-293 is stacked directly on AFYX-292 HEAD
`943727d9a450442daca46bd01bb710a172c53650`. The implementation remains
**Standalone by Design, Integrated by Contract**:

- Afyx Graph has no ACE runtime dependency and its API, CLI, MCP registration,
  tool output, defaults, and installed runtime are unchanged;
- `graph.ace.consumer/v1` lives in `@a5zero7/afyx-context` and consumes an
  injected normal Graph executor;
- integration is OFF unless `enabled: true` is explicit; OFF does not start an
  ACE worker or create ACE state;
- the consumer runs Graph first. Its validated public result is authoritative
  and is returned byte-for-byte when ACE is skipped or fails;
- ACE executes in a local worker with a bounded timeout. A timed-out worker is
  terminated; AFYX-292 coordination/recovery owns any interrupted ACE state.

No MCP response contract was changed and no default MCP activation, installer
lifecycle, provider routing, Headroom configuration, distributed lock, semantic
compression, Forge/Expert integration, or release packaging was added.

## Identity, provenance, and recovery

`deriveGraphAceIdentity` canonicalizes the real project root and deterministically
binds:

- owner = canonical project root + explicit local consumer identity;
- session = exact caller-supplied source identity.

Every ACE segment records the integration contract, Graph tool name, canonical
project root, source identity, query digest, content index, and completeness.
`afyx_graph_explore`, `afyx_graph_files`, and `afyx_graph_node` are always
`source-evidence`; `afyx_graph_status` is diagnostic. Those protected classes
remain inline. Inventory/search relationship facts may use recoverable ACE
references, but their exact original is content-hashed and bound to the same
owner/session.

Recovery verifies the reference boundary and content SHA-256. A foreign session,
invalid reference, missing/corrupt blob, malformed result, or foreign/corrupt
state fails closed. If the generic adapter reports `originalComplete=false`, the
Graph consumer ignores that partial rendering and returns its retained complete
Graph result.

The caller owns an absolute local ACE state directory and its filesystem ACL and
retention. Coordination remains machine-local. The bridge does not weaken those
AFYX-290/292 limitations.

## Real-consumer validation

The tracked synthetic fixture is
`afyx-context/test-fixtures/graph-consumer-repo`. The E2E harness copies it to a
new temporary project, sets a new external `AFYX_GRAPH_STATE_DIR`, builds a real
Graph index, then invokes real `ToolHandler` search, inventory, and explore
queries. It never opens, repairs, migrates, or synchronizes the Kit repository's
existing Graph index.

Observed local Windows workflow:

1. Graph inventory reported complete supported literal-declaration coverage and
   found the tracked `_inherit = "sale.order"` fixture;
2. OFF returned the exact Graph result;
3. ON processed a real search result, a repeated query emitted a reference, and
   recovery returned the exact original;
4. a mostly-unique result stayed original;
5. exact explore source stayed protected and inline;
6. fixture fingerprints remained unchanged.

Focused negative tests cover unavailable, throwing, timed-out, malformed and
incomplete ACE responses; Graph error passthrough; foreign owner/session;
invalid reference; corrupt content/state; unsafe configuration; and unsupported
Graph content blocks. All return the exact valid Graph result or fail recovery
closed as appropriate.

## Controlled cost observation

The single local synthetic real-query observation used pinned `js-tiktoken`
1.0.21 with `o200k_base`:

| Scenario | Observation |
|---|---:|
| Repeated query raw | 78 tokens |
| Repeated query ACE gross | 63–67 tokens (11–15-token gross reduction) |
| Recovery request + exact original | 146–150 tokens |
| Net after recovery | 209–217 tokens (**131–139-token regression**) |
| Mostly unique | Original retained |
| Protected source | Original retained |

The bounded range is from three valid local executions; the randomized disposable
project path changes the owner-bound reference hash and therefore its tokenization
by a few tokens. This deliberately demonstrates selectivity and recovery cost,
not generalized savings. It is not provider-billed usage, a Headroom comparison,
a performance benchmark, or evidence that ACE should be enabled by default.

## Validation and rollback

Local validation commands:

```text
cd afyx-context
npm test
npm run build:clean
npm run test:comparative -- --samples 1 --summary
npm run test:graph-integration
npm pack --dry-run

cd ../afyx-graph/engine
npm run build:clean
```

Rollback is configuration-only for consumers: leave `enabled` false or remove
the consumer call. Graph remains independently usable and its response is always
the fallback. Deleting retained ACE state is an owner retention decision and is
not performed by the bridge.

## Acceptance state

| Gate | Status | Evidence |
|---|---|---|
| `GRAPH_STANDALONE_NONREGRESSION` | PASS | No Graph source/default change; real OFF path exact-match |
| `GRAPH_ACE_OPT_IN_CONTRACT` | PASS | Versioned default-OFF dependency-inverted consumer |
| `GRAPH_ACE_REAL_QUERY_E2E` | PASS | Real disposable Graph index and ToolHandler query |
| `GRAPH_ACE_RECOVERY_AND_PROVENANCE` | PASS | Exact same-session recovery and bound provenance |
| `GRAPH_ACE_FAILURE_ISOLATION` | PASS | Missing/throw/timeout/malformed/corrupt negative coverage |
| `GRAPH_ACE_BOUNDARY_AND_SECURITY` | PASS | Protected evidence inline; foreign boundaries denied |
| `GRAPH_ACE_COST_AND_SELECTIVITY` | PASS | Gross and net costs include negative recovery result |
| `CROSS_PLATFORM_EXACT_HEAD` | PASS | Context Build and repository CI completed on Windows/Linux/macOS; exact run identities are published in the PR closure evidence |

The first cross-platform attempt exposed that macOS presents its temporary root
through `/var`, an alias of `/private/var`. The E2E harness now canonicalizes the
temporary root before creating external Graph state. Graph's fail-closed alias
validation was not weakened. The corrected exact-head run passed all three OSes.

Historical AFYX-291 evidence and its hashes remain unchanged. This result does
not authorize merge, deployment, default enablement, Alpha promotion, or a claim
of generalized context savings.
