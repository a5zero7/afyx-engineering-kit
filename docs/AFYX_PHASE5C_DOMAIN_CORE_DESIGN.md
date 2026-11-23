# Phase 5C Afyx-native domain core design

Task: `AFYX-68421`

Official baseline: `3c5da1c148756ea47ecc31691f886307c6d38641`

Branch: `afyx/native-phase5c-domain-core`

Status: review ready; exact PR-head CI remains the merge gate

## Ownership inventory

This inventory was frozen before production edits. Existing behavior is the
contract evidence, not an instruction to reproduce historical file structure.

| Domain family | Classification | Ownership decision |
| --- | --- | --- |
| Extraction source discovery, scope and Git-aware enumeration | `AFYX_NATIVE_KEEP` | Deterministic Afyx configuration and containment policy remains in the extraction host; no duplicate discovery abstraction. |
| `ExtractorRegistry`, content hashing, generated detection | `AFYX_NATIVE_KEEP` | Small pure Afyx seams already centralize language dispatch and file facts. |
| Filesystem reconciliation and definition delta | `AFYX_NATIVE_KEEP` | `reconciliation.ts` already separates filesystem evidence from DB effects and protects fresh/incremental convergence. |
| Parse pool/worker and store writer/worker | `AFYX_NATIVE_KEEP` | Native `worker_threads` boundaries provide bounded concurrency, ordered results and single-writer ownership. |
| Extraction result persistence, cross-file edge recovery and re-resolution handoff | `NATIVE_REFACTOR_NEEDED` | Move durable result admission out of `ExtractionOrchestrator` into one explicit Afyx-owned admission seam. |
| Tree-sitter host, grammar registry, WASM grammars and optional Rust kernel bridge | `THIRD_PARTY_PHASE5F` | Retain runtime behavior and notices; no replacement or new dependency in Phase 5C. |
| Language and specialized framework/file extractors | `AFYX_NATIVE_KEEP` | They are bounded adapters whose semantic output is protected by ground truth. Rewrite only for a demonstrated defect. |
| Resolution candidate policy, import/name matching and alias binding | `AFYX_NATIVE_KEEP` | Existing deterministic policy seams contain corrected Afyx semantics; language complexity is not rewritten for similarity. |
| Framework strategies and synthesizers | `AFYX_NATIVE_KEEP` | Existing strategy interfaces are sufficient; no plugin framework is introduced. |
| Resolver pool/worker, memory policy and cooperative yielding | `AFYX_NATIVE_KEEP` | Read-only workers plus ordered main-thread admission are the simplest deterministic concurrency boundary. |
| Resolution edge construction, cleanup partitioning and persistence | `NATIVE_REFACTOR_NEEDED` | Move durable admission out of `ReferenceResolver` behind an explicit Afyx-owned seam. |
| Historical terminology in untouched active files | `HISTORICAL_RESIDUE_PHASE5G` | Phase 5C removes residue only from materially touched files; repository-wide eradication remains Phase 5G. |

No material domain responsibility is classified as
`HISTORICAL_IMPLEMENTATION_REWRITE`: investigation found bounded, corrected
Afyx behavior whose wholesale rewrite would add semantic risk without improving
ownership. The two misplaced persistence responsibilities above are the actual
architectural defects addressed by this phase.

## Observable contracts

Extraction guarantees deterministic source scope and language selection,
stable node/edge/reference facts, visible parse failures, ordered result
admission, safe single-writer persistence, retryable failed files, and
fresh/incremental convergence for add, remove, rename, body-only and import
changes. Workers parse; they never own the database.

Resolution consumes unresolved references plus graph/database context. It
keeps unresolved work explicit, selects candidates deterministically, preserves
import and local-symbol evidence, removes obsolete resolved edges, and admits
sequential and worker results through the same ordered writer boundary.
Read-only workers never mutate the database.

## Native architecture

```text
ExtractionOrchestrator
  -> source discovery / reconciliation
  -> ExtractorRegistry or ParseWorkerPool
  -> ExtractionAdmission
       -> normalized file facts
       -> ordered QueryBuilder writes
       -> recoverable cross-file edge handoff

ReferenceResolver
  -> import/name/framework candidate policy
  -> sequential execution or ResolverPool
  -> ResolutionAdmission
       -> edge construction
       -> exact unresolved-row cleanup
       -> ordered QueryBuilder writes
```

`ExtractionAdmission` owns only persistence-ready extraction facts. It does not
scan, parse, detect frameworks or schedule workers. `ResolutionAdmission` owns
only conversion and persistence of resolver decisions. It does not select
candidates, read source files, run framework strategies or schedule workers.

## Extraction to Resolution boundary

Extraction publishes stored nodes, intrinsic edges and unresolved references.
When a changed definition invalidates a previously resolved cross-file edge,
the extraction admission seam restores the original stamped reference before
removing that edge. Resolution assumes those references retain source path,
language, position, reference kind and original text. A definition-set delta,
removed target or changed import therefore re-enters resolution; body-only
edits do not trigger unrelated re-resolution. This is the convergence contract.

## Validation plan

One risk-based campaign covers representative TypeScript, Python and Go
extraction facts; add/remove/rename/body/import fresh-vs-incremental convergence;
local/imported/ambiguous/unresolved resolution; repeated determinism; worker vs
sequential admission where compiled workers are available; a bounded repository
index/sync; focused downstream Graph, Search/Context, Impact, MCP and CLI tests;
typecheck, clean production/UI builds, semantic baseline, smoke and final-head
supported-platform CI.

## Implemented ownership

`src/extraction/extraction-admission.ts` now owns normalization and durable
admission of completed extraction results, repair of incomplete rows,
cross-file incoming-edge recovery and definition-delta re-resolution handoff.
The extraction host retains scanning, parser selection, worker scheduling and
progress only.

`src/resolution/resolution-admission.ts` now owns semantic edge construction,
exact-row versus legacy cleanup partitioning, failed-reference settlement and
chunked persistence. The resolution host retains candidate policy, strategy
execution, deferred passes and sequential/pool scheduling. Its profiled batched
loop consumes the same admission partition functions while retaining explicit
timing and backpressure boundaries.

No intended semantic correction was necessary. The change is an ownership
refactor with identical accepted facts and queue semantics.

## Validation evidence

- Direct admission contract: 6/6 passed.
- Extraction/Resolution ground truth and incremental convergence: 28/28
  passed, including TypeScript, Python and Go facts, deterministic repeat,
  add/remove/rename/body/import changes and R0–R9 convergence.
- Broad focused domain campaign: 990 assertions passed. Eleven Windows cases
  completed their assertions and then failed only while deleting temporary
  directories held by subprocesses (`EPERM`); production behavior did not
  fail and final Windows CI remains authoritative.
- Parse/resolver boundary and downstream Graph, Search, Context,
  Impact/Affected, MCP and CLI campaign: 543 passed with one declared
  platform/configuration skip.
- Sequential versus two-worker resolution on identical bounded repository
  copies produced the same semantic SHA-256
  `25d9a8d1e37e8476393861912ab34c09a9edb18dcdf1a751ffb1c43807ed9943`:
  121 files, 3,535 nodes, 11,014 edges and 10,393 unresolved facts.
- Bounded real-repository indexing succeeded with 121 files, 3,535 nodes and
  11,014 edges; a subsequent no-op sync preserved all counts.
- Clean production and UI build passed; semantic baseline passed 6/6; CLI/MCP
  smoke passed 21/21.

The touched hot path was measured directly over 60 repetitions. Normalizing a
1,000-node/999-edge/999-reference extraction bundle measured 0.1416 ms median
and 0.8026 ms p95 with digest
`4aa0269f76594567e510b2821891330562af451558ffd1aa86cc14fac865c9d3`.
Constructing 1,000 resolution edges measured 0.1069 ms median and 0.4474 ms
p95 with digest
`1e8995877b268230b42d232873de5774e1adfac87464d1756d37bd997ad57abe`.
These local microbenchmarks are regression sanity checks, not cross-platform
performance claims. Concurrency and memory policy were not changed.

Final merge readiness additionally requires the normal supported-platform CI
matrix on the exact PR head.

## Deferred handoff

Phase 5F owns the current Tree-sitter/WASM grammar assets, grammar runtime and
optional native kernel dependency review. Phase 5G owns global historical name
and task-marker eradication outside files materially touched here. No legal or
attribution record changes in Phase 5C. Phase 5C adds no production dependency,
bundled source, runtime or license obligation and does not claim final product
independence.
