# Afyx Graph Independence Audit and Closure Plan

> **Phase 5I closure (2026-10-10):** The 24 Linux assertions recorded below and
> the final five-assertion continuation are closed on branch
> `afyx/native-phase5f-parser-grammar`. The `AFYX_GRAPH_NATIVE_PARSER` leakage
> hypothesis was disproved: production routing is unconditional, focused Node 24
> and Node 26 behavior agrees, and same-HEAD Linux reruns reproduced the defects.
> Corrections preserve qualified Rust imports and C++ receivers, fix Go anonymous
> function ownership, exclude TypeScript type/object-literal syntax from call and
> function-reference facts, and update one stale Rust expectation. The unrelated
> WAL assertion passed 5/5 in isolation and required no source change. Graph Build
> run `38017609984` at production HEAD
> `54cc0786734be6c10fb9fe06d1316f0fa942e5f7` passes Linux unit, semantic,
> CLI/MCP, and host-bundle gates plus Windows and macOS jobs. Phase 5I is complete,
> full independence is established, and Technical Alpha is ready for a separate
> activation decision; it is not activated by this audit.

> **Phase 5I final-audit notice (2026-10-09):** Starting from
> `14c138024fef26cd303d9c0bcb16340830776652`, current production dependencies,
> retained historical implementation, unexplained substantive upstream overlap,
> active historical identity, unwanted bundled third-party material, and unclear
> provenance/legal obligations all audit to zero. Fresh npm-pack and Windows/
> Linux staged artifacts contain one current Afyx license and no dependency,
> parser/WASM, native, vendor, or historical-notice payload. Scoped audit fixes
> restore Python inheritance/self-call facts, Java field-type references,
> cross-Node finite BM25 comparison, and the Phase 5H distribution fixture.
> Focused tests, semantic 6/6, smoke 21/21, clean build, validators, and artifact
> verification pass. Technical Alpha remains blocked because the starting-head
> Graph Build diagnostic left 24 non-distribution assertions across 12 files,
> including extraction/resolution and UI/API behavior, after subtracting eight
> now-fixed distribution-fixture failures. Those failures require a separate
> bounded correctness campaign and final-head cross-platform proof.
> `PHASE_5I=BLOCKED`, `AFYX_FULLY_INDEPENDENT=NOT_ESTABLISHED`, and
> `TECHNICAL_ALPHA_ENTRY_GATE=NOT_READY`; neither Technical Alpha nor Phase 6 is
> started here.

> **Phase 5H closure notice (2026-10-09):** Starting from
> `81af1777297814ccc7603fd0552be496ef4209f3`, the historical-license ledger
> traced all three Phase 5G `LEGAL_PROVENANCE` files to the removed prior engine
> implementation. Current corresponding tracked and shipped material is zero.
> `afyx-graph/THIRD_PARTY_NOTICES.md` and
> `afyx-graph/LICENSES/THIRD_PARTY_ENGINE_MIT.txt` were removed as obsolete;
> `afyx-graph/engine/LICENSE` now matches the current root Afyx MIT `LICENSE`.
> The distribution manifest, bundle builder, installers, release workflow,
> validator, and tests enforce one current root-level license and reject the old
> payload. Measured npm-pack, Windows archive, Linux archive, and staged-release
> composition is `current Afyx license=1`, `third-party license=0`,
> `third-party notice=0`, `historical-only legal=0`, `unexplained legal=0`.
> Node.js remains an unbundled external platform runtime; Prompt Master is
> externally fetched; Headroom is detection-only. `UNCLEAR_LEGAL_OBLIGATION=0`,
> `LEGAL_CLOSURE_BLOCKER=0`, and `PHASE_5H=COMPLETE`. This preserves historical
> Phase 5 evidence and makes no broader legal conclusion. Technical Alpha stays
> inactive; the exact next boundary is Phase 5I — Final Independence Audit.

Status: Phase 3B.12B audit complete  
Baseline: `e401cbf002a0d0e57fcb9774d22c974abe580c4e`  
Historical comparison commit: `b7a1aa2718dc1f6940e483043733f67020d9a62f`  
Classification: `INDEPENDENCE_PLAN_READY_WITH_GAPS`

> **Canonical status notice (2026-10-03):** C01 through C07.11 below are
> retained historical engineering evidence. C07.12 was planned but never
> started, and its micro-residual closure plan is superseded. Active development
> continues under [AFYX_V1_MASTER_ROADMAP.md](AFYX_V1_MASTER_ROADMAP.md), Phase
> 5B — Native MCP/CLI Runtime Reimplementation. Historical evidence blocks,
> SHAs, counts, PR numbers, and measurements remain unchanged.

> **Phase 5G closure notice (2026-10-09):** starting from
> `f7f3294bdbb4150a3e037622feda9ad6e1a164d8`, the active legacy-identity,
> runtime-config, path/env, implementation-residue, obsolete-compatibility, and
> unclassified-residue counts are all zero. Ninety-two historical ticket labels
> were removed from shipped source/script comments and replaced with behavioral
> terminology; executable behavior did not change. The permitted ledger retains
> 144 historical evidence references, three legal-provenance files, one ignored
> external developer-index directory, and 150 non-product false positives (145
> ephemeral test-directory prefixes and five generic “code graph” domain
> phrases). Identity audit tests, static validators, clean production/UI build,
> CLI/MCP smoke, npm-pack inventory, and the staged distribution scan pass.
> Phase 5F viability evidence remains valid. Technical Alpha is inactive; the
> exact next boundary is Phase 5H — Historical License Closure.

This document records technical provenance and plans implementation closure. It
does not make a legal conclusion, authorize removal of attribution, or begin a
rewrite. Detailed machine-readable evidence is stored outside the repository in
the audit scratch directory named by Phase 3B.12B.

## Independence target and quality floor

Afyx Graph is technically independent only when it has no runtime, build,
operational, package, configuration, release, or product-identity dependency on
the historical upstream product; retains no private upstream implementation; and has no unexplained
substantial implementation overlap. Historical comparison tooling may remain an
external development oracle, never a product or user dependency.

Independence must preserve the accepted product: Search, Context, Graph, DB and
WAL, Impact/Affected Tests, Watcher, Daemon, MCP, CLI, Extraction, Resolution,
the optional UI, provider-aware installation, and future Odoo and Engineering
Assurance layers. The quality floor remains
`CORE_ACCEPTED_WITH_KNOWN_GAPS`. Context ranking, relation-aware presentation,
exact query, Odoo semantics, inconclusive token measurement, and result
explanation are product backlogs, not provenance findings.

The closure rule is **no rewrite for similarity alone**. A slice must establish
clearer Afyx ownership or architecture, lower coupling, better maintainability,
or equal/better correctness, determinism, performance, or context efficiency.
Cosmetic source-text change is not closure.

## Method and classification

The audit inventories 431 production/infrastructure text files under
`engine/src`, `engine/ui/src`, and top-level engine scripts. Each file is
compared with the historical snapshot using the established method:

- trim and collapse whitespace;
- substantive line = at least 20 characters with an alphanumeric token,
  excluding comment lines;
- exact normalized substantive/comment line membership;
- five-line non-empty shingles;
- `SequenceMatcher(autojunk=False)` identical blocks;
- same-path historical file first, otherwise the best historical-corpus
  candidate.

Similarity is only an indicator. Classification also uses module role, public
and schema boundaries, Git history, current architecture, call relationships,
and accepted behavioral evidence. Per-file classification cannot erase mixed
regions: a file classified `PUBLIC_CONTRACT` may still contain legacy private
implementation requiring separation.

| Classification | Meaning in this audit |
|---|---|
| `AFYX_NATIVE` | Afyx architecture/history plus low unexplained historical overlap |
| `PUBLIC_CONTRACT` | Observable library/CLI/MCP/provider compatibility boundary; private internals are not automatically exempt |
| `STANDARD_IDIOM` | Generic platform/framework mechanism with little private originality |
| `SCHEMA_OR_PROTOCOL` | Required DB, wire, type, or protocol shape |
| `BEHAVIOR_DEFINING_DATA` | Language/framework tables, constants, or fixtures required for observable behavior |
| `LEGACY_PRIVATE_IMPLEMENTATION` | Private structure materially retained from the historical implementation |
| `UNKNOWN_REQUIRES_REVIEW` | Evidence is insufficient for a safe region-level conclusion |

Machine file-level counts are 65 `AFYX_NATIVE`, 24 `PUBLIC_CONTRACT`, nine
`SCHEMA_OR_PROTOCOL`, 62 `BEHAVIOR_DEFINING_DATA`, 220
`LEGACY_PRIVATE_IMPLEMENTATION`, and 51 `UNKNOWN_REQUIRES_REVIEW`. Standard
idioms occur as regions inside mixed files rather than as a whole-file class.

The provenance scopes are:

- **Scope A:** every inventoried file in the subsystem.
- **Scope B:** files with evidence sufficient for `AFYX_NATIVE`.
- **Scope C:** every remaining/frozen host, including files that also carry a
  public contract, schema, or behavior-defining data. Scope C is the complement
  of B and prevents contract labels from hiding private implementation.

## Subsystem inventory

| Subsystem | Significant current modules | Role and dependents | Current status |
|---|---|---|---|
| Search | `src/search/*` | Parsing, segmentation, scoring, vocabulary, path/test signals; used by public facade, CLI, MCP, Context, UI | Afyx-native core plus seven residual hosts |
| Context | `src/context/*` | Bounded seeding, expansion, rerank, rendering; consumed by facade, CLI and MCP | Mostly Afyx-native architecture; five residual hosts |
| Graph Core | `src/graph/*` | Store facade, traversal, relations, routes, hierarchy, dead-code and flow; used by all query surfaces | Native store/walk split around high-overlap legacy hosts |
| DB Read/Write | `src/db/*reader*`, `*writer*`, sessions, `queries.ts`, `index.ts` | SQLite persistence behind Graph, indexing and query surfaces | Native granular writers/readers coexist with residual monolith-derived hosts |
| WAL/durability | `src/db/wal-*`, `connection-tuning.ts` | Checkpoint, pressure, valve and connection policy; used by DB/index/sync | One native configuration module; five residual hosts |
| Impact/Affected Tests | `src/impact/*` | Symbol/file impact and affected-test propagation; called by CLI/MCP and future UI adapter | Afyx-native, corrected against ground truth |
| Watcher/Sync | `src/sync/*` | Worktree discovery, event scheduling, retry and sync policy; drives index freshness | Three native policy modules plus seven residual hosts |
| Daemon/Proxy | daemon/proxy/socket/liveness/writer-lock modules in `src/mcp` | Single-writer process and client lifecycle; hosts MCP engine | Granular current architecture, but private overlap remains |
| MCP | engine/session/tools/catalog/results/worker modules in `src/mcp` | MCP protocol adapter over public domain API | Afyx identity and newer registry/result split; large legacy hosts remain |
| CLI | `src/bin/*` | Public command contract and process lifecycle over domain APIs | Afyx product contract over substantially retained host implementation |
| CLI presentation | `src/ui/*` | ANSI/glyph/progress terminal rendering | Isolated but highly retained private implementation |
| Extraction | `src/extraction/*` | Discovery, parsing, language rules, workers, reconciliation and optional kernel | Reconciliation/registry work exists; parser/language host remains predominantly historical |
| Resolution | `src/resolution/*` | Import/name/framework/synthesizer resolution and worker pool | Corrected Afyx semantics and native policy extraction, but hosts remain predominantly historical |
| UI server | `src/ui-server/*` | Loopback HTTP, security, SSE, bounded presentation adapters and static serving | Optional adapter contract accepted; implementation predominantly historical |
| UI frontend | `ui/src/*` | Svelte views, models, navigation and visualization | Product identity updated; implementation predominantly historical |
| Installer/providers | `src/installer/*` | Target registry, config writers, provider integration | Correct ownership behavior, but implementation predominantly historical |
| Shared/public facade | `src/index.ts`, `types.ts`, freshness, directory, config, errors, product | Public `AfyxGraph` facade and shared product/state contracts | Mixed public contracts, two native modules, legacy private hosts |
| Packaging/distribution | engine build/check/smoke scripts and workflows | Builds npm/self-contained bundles and validates artifacts | Afyx release identity; four high-overlap helper hosts |
| Performance infrastructure | `scripts/benchmark*.mjs` | Deterministic subsystem performance baselines | Afyx-native and independent |

The public facade is consumed by CLI, MCP and UI as peer adapters. The UI
server reads through `AfyxGraph`; the daemon owns the writer; the installer is
outside graph semantics. These dependency boundaries remain frozen.

## Scope A/B/C provenance summary

Percentages below are normalized substantive-line overlap. Comment and shingle
columns describe Scope A. “Block” is the longest per-file identical non-empty
block; `>=8` is the total count of such blocks. These are measurement facts,
not derivation conclusions.

| Subsystem | A files | A subst. | A comments | A shingles | Block / >=8 | B files / subst. | C files / subst. |
|---|---:|---:|---:|---:|---:|---:|---:|
| Search | 15 | 13.49% | 22.86% | 0.62% | 7 / 0 | 8 / 8.45% | 7 / 21.51% |
| Context | 16 | 11.85% | 26.69% | 2.00% | 14 / 1 | 11 / 6.59% | 5 / 31.90% |
| Graph Core | 17 | 78.90% | 83.46% | 75.53% | 2130 / 33 | 8 / 4.35% | 9 / 91.93% |
| DB Read/Write | 27 | 43.77% | 28.65% | 12.08% | 139 / 24 | 11 / 9.84% | 16 / 51.94% |
| WAL/durability | 6 | 45.90% | 49.81% | 21.21% | 20 / 11 | 1 / 0.00% | 5 / 49.56% |
| Impact/Affected Tests | 4 | 5.80% | 13.64% | 0.00% | 4 / 0 | 4 / 5.80% | 0 / n/a |
| Watcher/Sync | 10 | 50.58% | 49.91% | 15.07% | 32 / 17 | 3 / 10.61% | 7 / 55.45% |
| Daemon/Proxy | 15 | 55.46% | 33.92% | 19.75% | 60 / 33 | 0 / n/a | 15 / 55.46% |
| MCP | 16 | 91.47% | 91.31% | 80.50% | 910 / 162 | 0 / n/a | 16 / 91.47% |
| CLI | 8 | 76.02% | 86.59% | 58.39% | 95 / 80 | 0 / n/a | 8 / 76.02% |
| CLI presentation | 5 | 97.79% | 95.33% | 91.96% | 132 / 7 | 0 / n/a | 5 / 97.79% |
| Extraction | 58 | 98.82% | 98.71% | 96.77% | 3694 / 142 | 1 / 13.33% | 57 / 98.94% |
| Resolution | 61 | 99.40% | 99.38% | 98.56% | 2735 / 103 | 0 / n/a | 61 / 99.40% |
| UI server | 34 | 98.32% | 98.69% | 93.80% | 1060 / 141 | 0 / n/a | 34 / 98.32% |
| UI frontend | 91 | 99.75% | 99.29% | 99.03% | 1142 / 121 | 0 / n/a | 91 / 99.75% |
| Installer/providers | 19 | 89.52% | 91.12% | 70.77% | 210 / 143 | 0 / n/a | 19 / 89.52% |
| Shared/public facade | 9 | 87.15% | 93.71% | 79.59% | 384 / 80 | 2 / 4.35% | 7 / 92.24% |
| Packaging helpers | 7 | 45.45% | 78.11% | 43.65% | 98 / 16 | 3 / 2.64% | 4 / 86.90% |
| Performance infrastructure | 13 | 2.27% | 12.80% | 0.00% | 3 / 0 | 13 / 2.27% | 0 / n/a |

## Classification findings

### Afyx-native modules

The strongest current native regions are:

- all four `src/impact/*` modules;
- Context budgets, builder, call paths, entry points, expansion, infix channels,
  query symbols, request, rerank, seeding, and settings;
- Graph catalog, containment, file graph, frontier walk, graph store, relations,
  route, and walk request;
- DB bulk windows, granular edge/file/graph/ref writers, graph reader, name
  vocabulary, query/write sessions, schema script, and SQL limits;
- Search edit distance, scoring, segmentation, stemming, terms, test paths,
  text runs, and vocabulary;
- Sync debounce scheduler, pending change set, and watcher scope;
- extraction registry, freshness and product identity modules;
- all 13 benchmark modules plus semantic/smoke/dist-clean helpers.

This list means those modules have positive architecture/history evidence and
low unexplained overlap. It does not imply that every neighboring caller is
independent.

### Legacy private implementation candidates

High-confidence candidates include `extraction/tree-sitter.ts`, extraction and
language hosts, `resolution/index.ts`, `import-resolver.ts`, `name-matcher.ts`,
resolution synthesizers, `graph/branch-guards.ts`, `graph/dead-code.ts`,
`mcp/tools.ts`, MCP diagnostics/session hosts, CLI and terminal presentation
internals, most UI API/view/model code, provider/installer implementations,
and legacy portions of the public facade. Large identical blocks and matching
private helper/control-flow organization support this classification; branding
does not.

The largest measured hosts include:

| File | Substantive overlap | Longest block |
|---|---:|---:|
| `src/extraction/tree-sitter.ts` | 99.97% | 3694 |
| `src/mcp/tools.ts` | 95.30% | 910 |
| `src/resolution/callback-synthesizer.ts` | 99.89% | 2735 |
| `src/resolution/name-matcher.ts` | 99.42% | 2169 |
| `src/graph/branch-guards.ts` | 100.00% | 2130 |
| `src/resolution/import-resolver.ts` | 98.63% | 1519 |
| `src/ui-server/api/steps.ts` | 99.04% | 1060 |
| `ui/src/lib/steps-model.ts` | 100.00% | 1142 |

### Unknown-review candidates

Region-level review remains necessary for `mcp/proxy.ts`, DB search/dependency/
node/file/reference/routing readers, `db/queries.ts`, `db/index.ts`, WAL
coordinator/maintenance/pressure, `graph/type-hierarchy.ts`,
`graph/queries.ts`, Context render/source helpers, `search/path-references.ts`,
sync filesystem/Git/worktree policy, `extraction/reconciliation.ts`, and
`resolution/resolution-policy.ts`. Several are architecturally Afyx-shaped but
still share material lines or structure; neither “native” nor “legacy” is safe
for the whole file yet.

### Contracts, schemas, idioms, and behavior data

Public contracts include `AfyxGraph`, CLI commands/output modes, MCP tool names
and schemas, provider config formats, and UI wire responses. Schema/protocol
regions include `db/schema.sql`, exported domain types, MCP/wire types and
ambient declarations. Standard idioms include Node HTTP/listener setup,
filesystem/path normalization, atomic file replacement, JSON/TOML parsing,
SQLite transaction scaffolding, worker startup, and Svelte/Vite wiring; these
must be reviewed in context but are not closure targets merely because lines
match. Language/framework rule tables and compatibility fixtures are
behavior-defining data and may remain contract-compatible while private control
flow is replaced.

## Operational identity and dependency remnants

A tracked-tree scan found zero historical upstream product-name, legacy state
directory/database identity, legacy MCP, CLI, environment, config, telemetry, waitlist,
release, or update identity hits. The generic phrase “code graph” describes the
domain and is not an upstream product remnant.

Current package, binary, state, DB, environment and MCP identities are Afyx:
`@a5zero7/afyx-graph`, `afyx-graph`, `.afyx-graph`, `afyx-graph.db`,
`AFYX_GRAPH_*`, `afyx_graph`, and `afyx_graph_*`. No runtime, build, operational,
or package dependency on the historical upstream product was found. Its snapshot is
reachable only through Git history/audit tooling.

This satisfies the operational-identity half of independence. It does not
offset retained private implementation.

## Package, distribution, license, and Git metadata

| Artifact | Classification and finding |
|---|---|
| Root `LICENSE` | `CURRENT_PROJECT_LICENSE`: MIT, Copyright Afyx |
| `afyx-graph/engine/LICENSE` | `THIRD_PARTY_ATTRIBUTION`: historical MIT notice; retained |
| `afyx-graph/THIRD_PARTY_NOTICES.md` | `THIRD_PARTY_ATTRIBUTION`: identifies incorporated historical software; shipped |
| `afyx-graph/LICENSES/THIRD_PARTY_ENGINE_MIT.txt` | `THIRD_PARTY_ATTRIBUTION`: exact notice; shipped |
| Engine `package.json` | `PACKAGE_SPECIFIC_METADATA`: Afyx package/repository/bin/license identity |
| UI `package.json` | `PACKAGE_SPECIFIC_METADATA`: private Afyx UI workspace |
| `dist/` | Build output, untracked; npm `files` includes it and bundle copies it |
| Source maps | Engine TypeScript emits `.js.map` and `.d.ts.map` into distributed `dist`; UI Vite source maps are disabled. Distribution exposure must be a deliberate later decision, not silently changed here. |
| Self-contained bundle | Official Node runtime, compiled app/viewer, production dependencies, Afyx metadata and both third-party notice files |
| Release workflows | Afyx artifact/tag/repository identity; no legacy URL found |

No nested `.git` directory exists under `afyx-graph`; only the repository-root
`.git` is present. No nested upstream remote or release metadata was found.
`afyx-graph/engine/.gitignore` is `KEEP_PACKAGE_SPECIFIC` for Node/build/state/
SQLite/test scratch. `afyx-graph/engine/afyx-graph-kernel/.gitignore` is
`KEEP_PACKAGE_SPECIFIC` for Rust target/prebuild output. Root/eval ignore files
serve different scopes; consolidation is not justified.

Technical status and attribution status are deliberately separate. No license,
notice, or third-party record was changed. Attribution review remains open even
after future technical closure and requires a complete distribution/provenance
review; this document cannot authorize removal.

## UI provenance and architecture compatibility

UI server Scope A is 98.32% substantive / 98.69% comment / 93.80% shingle
overlap; frontend Scope A is 99.75% / 99.29% / 99.03%. Renaming
the historical root component to `AfyxGraphUi.svelte` changed identity, not private
implementation provenance. HTTP APIs, wire serialization, SSE, trail storage,
security middleware, Svelte models/views, navigation, and graph visualization
therefore remain closure candidates.

Phase 3B.12A remains frozen. Closure must preserve optional UI packaging,
CLI/MCP/UI peer adapters, public-domain API consumption, loopback-only security,
single writer ownership, progressive disclosure, bounded results, modular
installation, provider ownership, and Assurance extension points. UI work may
replace presentation implementation but must not copy Search, traversal,
Resolution, or affected-test semantics into browser/server code. Functional UI
Phase 3B.12D must not resume until relevant UI private regions have passed their
independence slice.

## Installer and provider provenance

The registry implements eleven targets, including verified Codex, Claude Code,
and OpenCode adapters. Current strengths are targeted key/marker merges,
preservation of unrelated configuration, atomic writes, global/local location
handling, and read-only `detect()` implementations. Current provenance is high
(89.52% substantive Scope A) and the architecture still combines detection and
mutation in target objects.

Later Phase 4 work must preserve provider-specific compatibility and unrelated
user data; replace private historical orchestration; normalize explicit
capabilities, versions, pure plan, verification and ownership metadata; and
remove the current semantic mismatch where CLI `all` means all registered
targets rather than all `DETECTED + SUPPORTED + INTEGRATABLE`. Adapter presence
alone is not a support claim. Do not redesign this registry inside an unrelated
core closure slice.

## Test, fixture, and documentation provenance

The test audit found 324 same-path historical behavioral-oracle tests, 49 Afyx
regression/generic tests, four explicit Afyx ground-truth tests, one named
performance test, and cross-platform coverage distributed through tests and
CI. The filename classifier is conservative: benchmark scripts and prior
scratch mutation campaigns provide additional evidence outside these counts.

Historical oracle tests may remain when they protect public behavior. Afyx
ground truth has priority over historical compatibility. Extraction has 5/5
OLD mutations caught; Resolution has 7/7 current mutations caught (including
native policy and the imported-member regression); Impact has direct ground
truth and mutation evidence from its correction campaign. Search, Context,
Graph, DB/WAL, Watcher, Daemon, MCP and CLI have focused tests and deterministic
benchmarks, but future slices must inventory or add mutation coverage for the
specific private region rather than infer coverage from a neighboring test.

No product-facing historical upstream identity appears in current tracked documentation.
README/engine notices accurately state historical authorship and are
`REQUIRED_ATTRIBUTION`; references to Prompt Master or Headroom upstream are
unrelated external-component documentation. Fixture descriptions referencing
an “upstream issue” are historical engineering context, not product identity.

## Independence scorecard

Evidence strength is qualitative and action names are the required closed set.

| Subsystem | Correctness | Native architecture | Private legacy | Perf / mutation / differential / real repo | Rewrite and UI/API risk | Action |
|---|---|---|---|---|---|---|
| Search | strong contracts | strong | small residual | benchmark-search; contracts; acceptance determinism/real repo | medium; Context/API consumers | `SMALL_CLOSURE` |
| Context | strong but ranking gap | strong | five hosts | benchmark-context; acceptance determinism/real repo; slice mutation needed | medium; token/result formatting | `SMALL_CLOSURE` |
| Graph Core | strong | mixed strong native split | substantial hosts | graph benchmarks/contracts and real repo; slice mutation needed | high downstream radius | `MEDIUM_REIMPLEMENTATION` |
| DB Read/Write | strong | mixed native split | substantial hosts | DB/query benchmarks, DB differential scenarios, real repo | very high persistence radius | `MEDIUM_REIMPLEMENTATION` |
| WAL | strong focused tests | partial | five hosts | WAL benchmark/tests; slice mutation needed | high durability risk | `SMALL_CLOSURE` |
| Impact/Affected | strong ground truth | strong | none identified | corrected ground truth, mutation/performance/real repo | low unless contract changed | `FREEZE_AS_NATIVE` |
| Watcher/Sync | strong convergence | partial | seven hosts | watcher benchmark/tests and real repo | high stale-index risk | `MEDIUM_REIMPLEMENTATION` |
| Daemon/Proxy | strong lifecycle tests | current modular shape | material | daemon benchmark/liveness tests; mutation gap | high process/platform risk | `MEDIUM_REIMPLEMENTATION` |
| MCP | strong protocol/downstream gates | partial registry/result split | large | MCP benchmark/smoke/acceptance; mutation gap | high agent/API risk | `LARGE_REIMPLEMENTATION` |
| CLI | strong command/smoke tests | public contract established | large private internals | CLI benchmark/smoke/CI; mutation gap | high public/cross-platform risk | `MEDIUM_REIMPLEMENTATION` |
| CLI presentation | focused output tests | weak independence | high but isolated | CLI benchmark/no-color/smoke | low semantic, medium output risk | `SMALL_CLOSURE` |
| Extraction | strong ground truth | limited native split | very large | OLD mutation 5/5, differential, real repo, benchmark | extreme language/routing risk | `LARGE_REIMPLEMENTATION` |
| Resolution | strong ground truth | native policy exists | very large | current mutation 7/7, OLD/NEW differential, real repo, performance | extreme semantic risk | `LARGE_REIMPLEMENTATION` |
| UI server | strong API/security tests | accepted boundary | very large | API/model/security tests; performance baseline incomplete | high contract/security risk | `LARGE_REIMPLEMENTATION` |
| UI frontend | strong model tests, visual gap | accepted adapter boundary | very large | model/package tests; browser perf/visual evidence gap | high UX, low core if boundary held | `LARGE_REIMPLEMENTATION` |
| Installer/providers | strong merge tests | direction frozen | large | installer tests; mutation/golden matrix incomplete | high user-config/platform risk | `MEDIUM_REIMPLEMENTATION` |
| Shared/facade | strong public tests | mixed | substantial | semantic/smoke/acceptance | maximum downstream contract risk | `MEDIUM_REIMPLEMENTATION` |
| Packaging helpers | strong CI/build gates | partial | four hosts | cross-platform CI/release build; mutation not relevant | medium distribution risk | `SMALL_CLOSURE` |
| Performance infrastructure | strong deterministic scripts | strong | none identified | itself supplies baselines | low | `FREEZE_AS_NATIVE` |
| Public/schema/behavior-data regions | contract-dependent | not an implementation claim | review mixed hosts | protected through consumers | high compatibility risk | `NO_ACTION_CONTRACT` |

No whole subsystem is assigned `NEEDS_MORE_EVIDENCE`, but individual unknown
regions must receive evidence before their slice edits them.

## Closure order and slice contracts

The order favors bounded regression radius and strong gates before semantic
cores. Each slice produces a separate commit/PR and stops on unexplained
behavior. Large subsystem labels never authorize a batch rewrite.

### IND-C01 — terminal presentation seam

- **Scope/ownership:** private ANSI color, glyph, shimmer progress and worker
  implementation in `src/ui/{color,glyphs,shimmer-progress,shimmer-worker}.ts`;
  Afyx-owned replacement. `src/ui/types.ts` remains a frozen contract.
- **Current contract:** identical color/no-color selection, glyph fallback,
  progress ordering, cancellation, worker teardown, stdout/stderr discipline.
- **Ground truth:** CLI no-color/version/query/context/impact tests and smoke.
- **OLD mutation:** not established; capture baseline contract before edits.
- **NEW mutation plan:** invert color eligibility, break non-Unicode fallback,
  suppress cancellation, and leak worker; each must be caught.
- **Differential/real repo:** exact exit code and observable output structure for
  help/status/query/explore/context/impact on fixture and this repository.
- **Downstream gates:** CLI focused, smoke, MCP startup isolation, Windows/
  Linux/macOS CI.
- **Performance:** interleaved `benchmark-cli`, startup plus progress-heavy
  operation, absolute/p95 latency and peak RSS.
- **Provenance target:** independent helper/module/control-flow structure; no
  unexplained identical private block of eight lines or more. Standard ANSI/
  worker idioms may remain with classification.
- **Expected files:** the four files above plus narrowly scoped tests; no domain
  source.
- **Frozen:** all semantic subsystems, CLI registry/command contract, UI
  architecture.
- **Stop:** output/ordering regression, process leak, cross-platform failure,
  material reproducible startup regression, or scope crossing into CLI/domain.

#### IND-C01 closure evidence (2026-09-29)

- **Status/scope:** the private implementation in
  `src/ui/{color,glyphs,shimmer-progress,shimmer-worker}.ts` is replaced by an
  Afyx-owned policy/lifecycle design. The public message contract in
  `src/ui/types.ts`, CLI registry, and semantic subsystems are unchanged.
- **Behavioral contract:** argument/environment/TTY color precedence, managed
  versus raw-write Unicode fallbacks, stable glyph data, one-line non-TTY
  progress, bounded worker messages, phase ordering, cancellation, and final
  phase output are preserved. Teardown is now idempotent and worker errors are
  contained without leaving a live worker or timer.
- **Mutation evidence:** four OLD and four NEW load-bearing mutants were each
  killed: color disablement inversion, ASCII fallback bypass, ignored stop,
  and skipped worker termination.
- **Differential:** nine exact CLI contract scenarios have identical exit code,
  stdout, and stderr between OLD and NEW. Help/status/query/explore/context/
  impact also pass against this repository with non-TTY output and no ANSI
  leakage. `UNEXPLAINED = 0`; the only deliberate correction is safer,
  repeatable/error-path teardown.
- **Performance:** ten OLD/NEW interleaved CLI pairs show median deltas from
  -3.34% to +1.61%. A 20-pair presentation microbenchmark measured plain
  progress at 0.147/0.040 ms and worker start-update-stop at 30.018/28.865 ms
  (OLD/NEW medians). A 10-pair colored query measured 553.499/551.858 ms.
  The policy microbenchmark is 14.016 ms slower per 50,000 paired decisions
  (about 0.28 microseconds each), an immaterial absolute cost.
- **Provenance:** under the established historical-reference normalization,
  substantive overlap falls from 173/177 (97.74%) to 31/215 (14.42%);
  five-line shingle overlap falls from 92.14% to 5.88%. The two remaining
  identical blocks of at least eight lines are public data/type contracts
  (`Glyphs`, `IndexProgress`, and `ShimmerProgress`), not private control flow.
- **Validation/gaps:** focused terminal/CLI tests, build/type checking, semantic
  baseline, CLI+MCP smoke, real-repository smoke, and local Windows lifecycle
  checks pass. PR #20 confirms all seven Linux/macOS/Windows/Rust CI gates.
  The next recommended bounded slice remains IND-C02; this result does not
  claim repository-wide independence.

### IND-C02 — packaging and distribution helpers

- **Scope/ownership:** high-overlap bundle/copy/check helpers only; Afyx release
  pipeline. Preserve package metadata and legal artifacts.
- **Contract/evidence:** six target bundles, viewer/WASM checks, npm contents,
  launchers, CI build/smoke. OLD mutation is not applicable; add packaging fault
  tests for missing viewer/WASM/notices and wrong launcher paths.
- **Differential/real repo/downstream:** archive manifest/hash comparison and
  launch smoke on available OS CI; release workflows.
- **Performance/provenance:** build time and archive size are reported; no
  unexplained private orchestration block. Do not remove notices or change
  source-map distribution without an explicit decision.
- **Expected files:** selected `engine/scripts` and focused build tests.
- **Frozen/stop:** runtime semantics and legal records frozen; stop on artifact,
  platform, license, or reproducibility mismatch.

#### IND-C02 closure evidence (2026-09-29)

- **Scope/architecture:** the four audited private helper hosts
  `scripts/{build-bundle.sh,build-kernel.sh,check-ui-build.mjs,kernel-parity.mjs}`
  now use Afyx-owned orchestration. A new testable
  `scripts/distribution-contract.mjs` owns distribution validation and normalized
  SHA-256 manifests; semantic engine and Rust sources are unchanged.
- **Frozen contract:** all six target names, archive names/layout, bundled Node
  launchers, optional native kernel location, package identity, production-only
  dependencies, viewer/WASM assets, engine source maps, disabled viewer source
  maps, and both required legal files are preserved.
- **Fault evidence:** controlled fixtures catch missing runtime, viewer asset,
  WASM grammar, notice, launcher, wrong CLI metadata, and development-only
  contamination (eight focused tests). Existing attribution validation remains
  7/7 PASS.
- **Differential/size:** controlled OLD and NEW `win32-x64` bundles each contain
  1,544 files and 240,303,435 unpacked bytes; normalized path/size/SHA-256
  comparison has zero differences. Npm dry-run changes only the reimplemented
  packaged helper sources: 1,370 to 1,371 entries, 8,284,381 to 8,283,660 packed
  bytes, and 78,781,278 to 78,776,470 unpacked bytes.
- **Execution/rebuild:** packaged version/help/status/query all pass from the
  isolated NEW artifact. A deliberately stale dist file is removed by a clean
  build, and two clean-build manifests are identical.
- **Performance/provenance:** three OLD/NEW interleaved clean builds measured
  13.823/13.945 s median and 14.550/14.240 s p95 (+0.122 s, +0.88% median).
  Three interleaved self-contained bundle builds measured 30.601/30.505 s
  median and 30.888/30.991 s p95 (-0.096 s, -0.31% median); NEW manifest
  generation measured 0.496 s median and 0.501 s p95 over five runs.
  Established normalized provenance falls from 272/313 substantive lines
  (86.90%) across the four historical hosts to 19/340 (5.59%) across those
  hosts plus the new contract module; five-line shingle overlap is 0%, longest
  identical block is three lines, and no block of eight lines remains.
- **Validation/gaps:** TypeScript, shell syntax, packaging/UI tests, semantic
  baseline, CLI+MCP smoke, package identity/attribution validation, and local
  Windows artifact execution pass. PR #21 confirms all seven Linux/macOS/
  Windows/Rust CI gates. UI packaging remains bundled as frozen by Phase
  3B.12A; future optional UI productization is intentionally deferred.

### IND-C03 — Search and Context residual hosts

- **Completed bounded scope:** private implementation was replaced only in
  `search/filters.ts`, `search/path-references.ts`,
  `search/project-names.ts`, `context/renderers.ts`, and
  `context/source-reader.ts`. Search/Context facades, native ranking, budgets,
  expansion, traversal, Graph/DB, CLI/MCP schemas, and UI adapters were not
  changed.
- **Contracts and mutation evidence:** OLD and NEW each pass the same 180/180
  focused assertions (22 Search contract and 77 Context contract assertions
  included). Five observable mutants on each side are killed: field-filter
  bypass, path-candidate omission, project-token omission, generated-last
  rendering inversion, and source-range corruption. Ranking/tie/limit and
  seed/budget/expansion/call-path mutation categories remain owned by unchanged
  Afyx-native modules and are not attributed to this slice.
- **Differential and real repository:** all synthetic golden results are
  identical. Six real-repository `query`, `context`, and `explore` CLI cases
  have identical exit codes, ordered output, hashes, and byte counts; five NEW
  repetitions per case are deterministic. Search and Context each have
  `UNEXPLAINED = 0`. The representative structured Context result remains five
  nodes, seven edges, five code blocks, one related file, 3,676 source bytes,
  and 13,050 serialized bytes. Provider token accounting is unavailable, so
  `TOKEN_BENCHMARK_INCONCLUSIVE` remains the only token claim.
- **Performance and downstream gates:** three Search and six final Context
  OLD/NEW interleaved repetitions preserve every semantic digest and payload
  size. Search cases range from
  -6.05% to +4.72%, except the parser microcase (+4.81 microseconds per full
  batch, +125.92% relative); Context cases range from -3.69% to +3.84%.
  Focused Search/Context/Graph-consumer regression is 325/325, focused CLI is
  26/26, focused MCP is 42 passed with one intentional skip, semantic baseline
  is 6/6 fixtures, and CLI/MCP smoke is 21/21 checks.
- **Provenance:** established Phase 3B normalization reproduces the frozen OLD
  measurements. Search A moves 13.49% to 13.27% substantive, 22.86% to 23.12%
  comments, and 0.62% to 0.61% shingles (longest block 7, no block >=8);
  Search B is unchanged at 8.45% / 21.80% / 0.61%; Search C moves 21.51% to
  20.62%, 24.68% to 25.76%, and 0.64% to 0.59% (7 / 0). Context A moves
  11.85% to 9.58%, 26.69% to 26.80%, and 2.00% to 1.12% (14 / 1 to 11 / 1);
  Context B is unchanged at 6.59% / 26.21% / 0.40%; Context C moves 31.90% to
  21.12%, 28.89% to 29.55%, and 8.57% to 4.13% (14 / 1 to 11 / 1). The one
  remaining 11-line block is the stable public JSON code-block/result shape,
  not private ranking, traversal, or source-selection control flow.
- **Classification and retained gaps:** `IND_C03_COMPLETE_WITH_KNOWN_GAPS`.
  Exact-query mode, known Context ranking omissions, why-this-result
  presentation, formal token accounting, and whole-repository implementation
  closure remain separate backlog items. No license or attribution record was
  changed.

### IND-C04 — DB and WAL residual hosts

- **Scope/ownership:** remaining DB readers/queries/index/adapter and WAL hosts;
  Afyx persistence architecture.
- **Contract/evidence:** schema, transaction atomicity, row mapping, WAL healing,
  incremental/fresh convergence; DB contract scenarios, WAL tests and benchmarks.
- **Mutation plan:** one read predicate/order, transaction rollback, deletion,
  checkpoint/pressure and recovery mutant per edited policy.
- **Differential/real repo:** byte-normalized semantic DB dump and full real
  index/reopen/sync; exact result digest, counts and state.
- **Downstream/performance:** Graph, Search, Context, Impact, daemon, MCP, CLI,
  UI; interleaved DB/query/WAL/index/sync with RSS, DB/WAL size and work counts.
- **Provenance/expected files:** select one cohesive reader or WAL policy group;
  schema remains `SCHEMA_OR_PROTOCOL`.
- **Frozen/stop:** schema/public API unless separately approved; stop on data
  loss, unexplained digest/order difference, lock/durability failure or material
  regression.

#### IND-C04 closure evidence (2026-09-30)

- **Bounded scope:** the DB foundation slice replaces residual private structure in
  `src/db/{migrations,row-mappers,sqlite-adapter}.ts`; the WAL slice replaces
  orchestration in `wal-checkpoint-coordinator.ts`, worker lifecycle in
  `wal-maintenance.ts`, and threshold policy in `wal-pressure.ts`. The
  `wal-valve.ts` facade, schema, native readers/writers/sessions, public APIs, and
  every semantic subsystem remain unchanged. Residual domain-reader hosts stay a
  separately reviewable gap rather than being batch-rewritten here.
- **Frozen OLD contracts:** 164 persistence assertions, 131 ordered-query
  assertions, the FTS dual-mode contract, connection/reopen/backend checks, and
  37 WAL policy/concurrency/healing/deferral assertions pass (350 PASS and four
  platform-conditioned skips in the focused run). They cover single/bulk writes,
  update/delete/conflict behavior, metadata, row/null mapping, ordering, commit/
  rollback, reopen, checkpoint, pressure, fail-closed, and stale-WAL healing.
- **Architecture:** declarative SQL migrations now share one transaction-owned
  executor; row decoding centralizes nullable, boolean, and JSON conversion; the
  SQLite adapter owns a single explicit outer transaction boundary while nested
  operations join it. WAL maintenance shares one single-settlement worker
  dispatcher, while pressure sampling and checkpoint completion/error decisions
  are explicit and independently testable. Persisted SQL/descriptions and wire
  shapes are unchanged.
- **Mutation and differential:** OLD and NEW each kill one commit-to-rollback
  write mutant, one exported-flag read mutant, and one disabled-soft-checkpoint
  WAL mutant (3/3 each). DB Write, DB Read, and WAL golden differentials all have
  `UNEXPLAINED = 0`. A four-way OLD/NEW writer-reader matrix passes 4/4 with the
  same logical SHA-256 digest
  `3ad35cf4209a6d526dae2f4230cbbbe769731be8c3c00e9e6dc5c091ac4f1c9f`.
- **Real snapshot and safety:** disposable copies of this repository's accepted
  index contain 23,978 nodes, 76,550 edges, 949 files, and seven metadata rows;
  OLD and NEW reads produce the same logical digest
  `c7f46c7728847b2ac94ed37efc8acb58b233aa823346ddd3d1b204a30e63f73e`.
  A bounded NEW write adds exactly one metadata row, an induced exception rolls
  back with no partial row, reopen succeeds, and the canonical index is untouched.
- **Incremental/downstream:** R0-R9 resolution convergence, rebuild convergence,
  46 sync cases, Graph/Search/Context/Impact contracts, CLI/MCP semantic contracts,
  semantic baseline (6/6 fixtures), and CLI/MCP smoke (21/21 checks) pass. The
  focused downstream run is 550/550 assertions; no frozen subsystem file changed.
- **Performance and size:** three OLD/NEW interleaved pairs preserve every work
  count and digest. DB write-case median deltas range from -47.05% to +4.61%; DB
  read-case deltas range from -16.67% to +20.14%, with the largest regression a
  15.86-microsecond name-prefix microcase amid run spread; the real WAL full cycle
  improves 1.97%. Policy-only 0.01-microsecond deltas are not treated as material.
  Fixture DBs are byte-identical at 159,744 bytes, real snapshot copies are
  100,700,160 bytes, and both sides leave no WAL/SHM sidecars after close; operation
  counts show no write-amplification change.
- **Provenance:** established normalization reproduces OLD DB Scope A at 43.77%
  substantive / 28.65% comments / 12.08% shingles and WAL Scope A at 45.90% /
  49.81% / 21.21%. NEW DB Scope A is 42.78% / 28.95% / 10.69%; the selected DB
  residual slice falls from 62.63% / 27.66% / 29.72% to 52.55% / 30.59% / 19.02%,
  with longest block 24→22 and blocks >=8 at 13→9. NEW WAL Scope A is 35.83% /
  50.00% / 14.67%; WAL residual Scope C falls from 49.56% / 56.09% / 23.01% to
  38.56% / 56.33% / 15.89%, with blocks >=8 at 11→9. Remaining blocks are SQL/
  schema shapes, stable error/diagnostic contracts, worker/SQLite protocol, and
  standard API idioms; this is a technical classification, not a legal conclusion.
- **Classification and gaps:** `IND_C04_COMPLETE_WITH_KNOWN_GAPS`. Local Windows
  evidence is complete; PR #23 passes all seven normal jobs (Linux 2/2, macOS
  2/2, Windows 2/2, and Rust kernel 1/1). The next bounded persistence follow-up
  is one domain-reader family from the residual DB inventory; IND-C05 must not
  absorb that work.

#### DB domain-reader residual closure evidence (2026-09-30)

- **Selected family:** unresolved/reference reads in
  `src/db/reference-reader.ts`. This is one storage and observable-contract
  family: pending/failed reference enumeration, name/file/source filters,
  stable resolver pagination, retry ceilings, and resolution-edge candidates.
  Shared `query-session.ts`, `row-mappers.ts`, `graph-reader.ts`, and the
  `QueryBuilder` facade remain unchanged boundaries. Node, edge, file,
  dependency-analytics, routing, and search readers remain separately bounded
  residual families.
- **OLD contract and mutation:** the 131-assertion ordered DB query golden plus
  pagination, 200,000-row chunking, resolution, extraction, and cache-binding
  fixtures freeze identity, count, order, filters, status handling, missing-row
  behavior, nullable mapping, relations, retry ceilings, and reopen behavior.
  Five OLD observable mutants are killed: filter bypass, order reversal, row
  omission, relation remapping, and missing-row corruption.
- **Afyx-native architecture:** explicit reference-column and fixed-query
  definitions form one SQL-to-domain boundary; fixed reads share prepared
  statements; unbounded chunked reads append iteratively; prerequisite phases
  retain explicit row-id order; and retry/reference-edge reconciliation shares
  one population-ceiling policy. Schema, public signatures, mappers, writers,
  and surrounding resolution/extraction semantics are unchanged. The initial
  iterative implementation exposed and then corrected a 200,000-row spread
  overflow before acceptance.
- **NEW mutation and differential:** the same five NEW mutants are killed.
  The complete synthetic golden and accepted real snapshot have
  `UNEXPLAINED = 0`. On the real repository copy, both readers return 85,617
  unresolved rows and identical filtered/retry/relation results, with logical
  SHA-256 `f67507d17266f2ad508cbd5d3a29cb62edb44388b907ea5aecdda35e055d4430`.
  Both DB copies remain byte-identical to the 100,700,160-byte canonical input.
- **Determinism, payload, and performance:** three repeated NEW real-snapshot
  reads preserve order, values, digest, and 24,557,839 serialized bytes. Seven
  interleaved OLD/NEW benchmark pairs preserve every case digest, row count,
  and payload. OLD/NEW median microseconds are 522.8/527.8 for single-name,
  4.6/4.6 for missing-name, 240.4/280.7 for file-filtered, 3,935.9/4,059.8 for
  retryable multi-row, 2,716.1/2,916.9 for resolution edges, and
  202,270.7/204,280.0 for all 85,617 real rows. The largest relative delta is
  the 40.3-microsecond file-filtered microcase; the full snapshot delta is
  +0.99%. Peak process RSS differs by 262,144 bytes. No material regression or
  payload growth is observed.
- **Provenance:** under the established historical-reference normalization,
  Family Scope A (`query-session.ts` plus `reference-reader.ts`) falls from
  36.19% substantive / 25.81% comments / 1.47% shingles to 21.14% / 21.43% /
  1.46%. Already-native Scope B (`query-session.ts`) remains 10.00% / 18.18% /
  0.00%. Residual Scope C (`reference-reader.ts`) falls from 42.35% / 27.45% /
  1.85% to 23.30% / 23.53% / 1.84%; longest identical block moves 6→7 and both
  sides have zero blocks >=8. Remaining overlap is SQL/schema identifiers,
  public result shapes, and standard TypeScript/SQLite idioms, not a legal
  conclusion.
- **Validation and status:** selected-reader tests pass 163/163, DB contracts,
  FTS, reopen/lifecycle/backends, Graph contracts, sync/rebuild convergence,
  semantic baseline (6/6), typecheck, clean build, and CLI/MCP smoke (21/21)
  pass locally. PR #24 passes all seven normal jobs (Linux 2/2, macOS 2/2,
  Windows 2/2, and Rust kernel 1/1). Classification is
  `DB_DOMAIN_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`; the recommended next DB
  slice is the node identity/lookup reader, not IND-C05 Graph.

#### Node identity/lookup reader residual closure evidence (2026-09-30)

- **Selected family and exclusions:** the complete bounded family is
  `src/db/node-reader.ts`: ID and batch identity reads, file/kind/name/qualified/
  case-folded lookups, prefix and full-name scans, streaming kind/decorator
  reads, definition-delta names, and the decoded-node identity cache.
  `query-session.ts`, `row-mappers.ts`, `graph-reader.ts`, the `QueryBuilder`
  facade, and writer invalidation hooks remain frozen Afyx-native/shared
  boundaries. Reference, edge, file/index-state, dependency, routing, search,
  stats, and vocabulary readers remain separately bounded families; schema,
  writers, WAL, and Graph semantics are unchanged.
- **OLD contract and mutation:** 131 ordered DB-query assertions plus 164 DB
  assertions, iterator/decorator/language, reopen/lifecycle, and ten sync/
  rebuild convergence cases freeze positive/missing/batch identities, source
  and candidate order, file/kind/name filters, qualified/case-folded lookups,
  null/default decoding, and write-through cache invalidation. Nine OLD
  observable mutants are killed: row omission, wrong identity, name and kind
  filter bypass, order reversal, multi-result omission, file-relation
  corruption, and per-ID/per-file cache invalidation failures.
- **Afyx-native architecture:** an explicit fixed/dynamic node query catalog
  owns SQL selection; one decoding boundary handles materialized rows; one
  streaming boundary handles cursor reads; and a bounded `NodeIdentityCache`
  owns LRU touch, insertion, and explicit mutation invalidation. Public
  signatures, SQL predicates/order, row mapper, prepared-statement session,
  schema, and writer hooks are unchanged.
- **NEW mutation and differential:** the same nine NEW mutants are killed.
  OLD and NEW pass the exact query golden with `UNEXPLAINED = 0`. On isolated
  copies of the accepted repository snapshot, both read 23,978 nodes and
  produce identical selected-case SHA-256
  `c02e5c77ce033a63af2d49a6043f6fedda06875fe51e1fb15e43445a07844cf5`
  and full-population SHA-256
  `6f8f7cd82bbd22133cf21848f01d7aebf78c1515dcd8a409c9fa5b4c28880d2c`.
  The canonical and both copies retain the same 100,700,160-byte content hash;
  no migration, write, WAL, or SHM sidecar is produced.
- **Graph boundary, determinism, and payload:** Graph contracts pass 376/376;
  Search 22/22, Context 77/77, Impact/helper 6/6, and FTS dual-mode/fallback
  8/8 also pass. Three repeated NEW real-snapshot reads preserve identities,
  order, values, and both digests. OLD and NEW each surface a 5,004,204-byte
  representative payload and 13,566,389-byte full-node payload, with identical
  counts including 432 ambiguous-name and 5,080 busy-kind results.
- **Performance:** seven OLD/NEW interleaved pairs preserve every case digest,
  row count, and byte count. Median microseconds are 9.6/9.5 cold ID, 0.4/0.4
  warm ID, 2,263.5/2,100.9 batch IDs, 1,433.8/1,427.9 ambiguous name,
  7,823.0/7,571.4 file, 18,799.1/18,590.2 kind, 166.4/165.3 prefix, and
  89,605.6/87,207.4 all nodes (OLD/NEW). Median deltas range from 0.00% to
  -7.18%; maximum observed process RSS is 397,307,904/397,225,984 bytes.
  No material regression or payload growth is observed.
- **Provenance:** established normalization moves complete family Scope A
  (`query-session.ts`, `row-mappers.ts`, `node-reader.ts`) from 45.86%
  substantive / 29.27% comments / 14.80% shingles to 32.52% / 25.00% /
  14.62%. Frozen Scope B remains 50.00% / 31.25% / 29.59%. Replaced residual
  Scope C (`node-reader.ts`) falls from 41.57% / 28.79% / 1.59% to 18.42% /
  18.75% / 0.00%; longest identical block moves 5→4 and neither side has a
  block >=8. Remaining overlap is SQL/schema identifiers, public result shapes,
  and standard TypeScript/SQLite idioms, not a legal conclusion.
- **Validation and status:** selected node/DB/sync tests pass 320 with four
  platform-conditioned skips; focused downstream tests pass 489/489; semantic
  baseline passes 6/6; CLI/MCP smoke passes 21/21; typecheck and clean build
  pass. PR #25 passes all seven normal jobs (Linux 2/2, macOS 2/2, Windows 2/2,
  and Rust kernel 1/1). Classification is
  `DB_NODE_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`. Remaining DB-reader review
  inventory is edge, file/index-state, dependency, routing, search, stats, and
  vocabulary. The recommended next bounded persistence slice is edge identity/
  adjacency reads; IND-C05 Graph remains deferred.

#### Edge identity/adjacency reader residual closure evidence (2026-09-30)

- **Selected family and exclusions:** the complete bounded family is
  `src/db/edge-reader.ts`: single and batched outgoing/incoming adjacency,
  kind/provenance filters, per-endpoint fan-in/fan-out counts, and induced
  connectivity reads. `query-session.ts`, `row-mappers.ts`, `graph-reader.ts`,
  the `QueryBuilder` facade, edge writers, schema, node/reference readers, WAL,
  and Graph traversal remain frozen boundaries. File/index-state, dependency,
  routing, search, stats, and vocabulary readers remain separate residual
  families.
- **OLD contract and mutation:** the ordered DB-query golden and a focused
  observable edge contract freeze source/target identity, kind, metadata,
  coordinates, provenance, direction, filters, natural SQLite result order,
  batch-endpoint deduplication, counts, connectivity, and missing/empty shapes.
  Nine OLD mutants are killed: omission, wrong source, wrong target, direction
  inversion, filter bypass, ordering corruption, duplicate expansion, relation
  remapping, and empty-input corruption.
- **Afyx-native architecture:** an explicit adjacency-direction/query catalog
  owns persisted source/target meaning; a named edge projection and one decode
  boundary own SQL-to-domain conversion; shared bounded helpers implement batch
  reads and counts without moving traversal into persistence. Public signatures,
  predicates, natural result order, mapper, session, schema, and writers are
  unchanged.
- **NEW mutation and differential:** the same nine NEW mutants are killed.
  OLD and NEW pass the exact ordered query contract. On isolated copies of the
  accepted repository snapshot, 76,550 edges across eight kinds produce the
  same representative logical SHA-256
  `d767be34141ee8f12c58ed8679ac0b106223106ab73fca1ab17720c3dc3a535e`;
  `UNEXPLAINED = 0`. The canonical and both copies retain the same 100,700,160
  bytes and SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`;
  no migration or sidecar is produced.
- **Graph boundary, real repository, determinism, and payload:** Graph-facing
  inputs, Search, Context, Impact, and affected-test contracts pass unchanged.
  Real-snapshot cases cover 1,557-edge outgoing and 880-edge incoming high-fanout
  nodes, filtered and batch reads, counts, induced connectivity, and empty cases.
  Three repeated NEW reads preserve identity, order, direction, values, payload
  (1,557,544 bytes), and digest. OLD/NEW full outgoing scans each surface all
  76,550 edges, 16,704,218 serialized bytes, and digest
  `a438b2b7c14fa91d`; no duplicate expansion, recursion, relation inversion,
  identity drift, false negative, or unexplained payload growth is observed.
- **Performance:** seven interleaved OLD/NEW pairs preserve every case count,
  digest, and payload. Median microseconds (OLD/NEW) are 2,553.6/2,579.4
  outgoing, 1,514.8/1,463.9 incoming, 2,322.9/2,315.1 kind-filtered,
  6,712.8/6,740.4 outgoing batch, 7,779.1/7,581.5 incoming batch,
  1,115.9/1,067.8 counts, 212.1/209.4 connectivity, and
  162,426.7/163,697.8 full scan. Median deltas range from -4.31% to +1.01%; the
  full-scan delta is +0.78%. Maximum observed process RSS is
  329,818,112/335,642,624 bytes. No material reproducible regression appears.
- **Provenance:** established normalization moves complete family Scope A
  (`query-session.ts`, `row-mappers.ts`, `edge-reader.ts`) from 54.82%
  substantive / 25.00% comments / 19.93% shingles to 35.67% / 34.78% / 18.80%.
  Frozen Scope B remains 50.00% / 31.25% / 29.59%. Replaced residual Scope C
  (`edge-reader.ts`) falls from 60.81% / 16.67% / 4.67% to 15.38% / 42.86% /
  0.00%; longest identical block moves 6→2 and both sides have zero blocks >=8.
  Remaining overlap is SQL/schema identifiers, public edge shapes, and standard
  TypeScript/SQLite idioms, not a legal conclusion.
- **Validation and status:** focused edge/DB/Graph tests pass 720 with four
  platform-conditioned skips; Search/Context/Impact downstream tests pass
  159/159; sync/rebuild convergence passes 56/56; semantic baseline passes 6/6;
  CLI/MCP smoke, typecheck, and clean build pass. PR #26 passes all seven normal
  jobs (Linux 2/2, macOS 2/2, Windows 2/2, and Rust kernel 1/1). Classification is
  `DB_EDGE_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`. Remaining DB-reader review
  inventory is file/index-state, dependency, routing, search, stats, and
  vocabulary. The recommended next bounded persistence slice is file/index-state
  reads; IND-C05 Graph remains deferred.

#### File/index-state reader residual closure evidence (2026-09-30)

- **Selected family and exclusions:** the complete bounded family is
  `src/db/file-reader.ts`: exact-path file records, ordered file/path population,
  file-node lookup, latest-index timestamp and revision, bounded indexed-since
  reads, hash staleness, generated-file state/count, and ambient-declaration
  classification. `query-session.ts`, `row-mappers.ts`, `graph-reader.ts`, the
  `QueryBuilder` facade, and file writer remain frozen shared boundaries.
  Filesystem discovery, extraction, Resolution, Sync/Watcher orchestration,
  metadata/schema-version state, schema, writers, migrations, node/edge/reference,
  dependency, routing, search, stats, vocabulary, and Graph traversal are excluded.
- **OLD file/index-state contract and mutation:** the ordered DB-query golden and
  focused observable contract freeze exact case-sensitive stored paths, complete
  file row/null decoding, path ordering, file-node identity, content hash and
  generated state, `MAX(indexed_at)`, revision row count, strict indexed-since
  filtering with newest-first/path tie order and caps, missing/empty/reopen
  behavior, duplicate-safe bounded probes, hash staleness, and ambient file
  classification. Ten OLD mutants are killed: omission, wrong identity, path
  corruption, filter bypass, order reversal, revision corruption, hash inversion,
  null/default corruption, missing-file corruption, and file-node remapping.
  Generic metadata values and schema/build versions belong to the separately
  deferred stats/metadata family rather than this reader.
- **Afyx-native architecture:** one explicit query catalog owns fixed file and
  index-state reads; a named file projection and one decode boundary own
  SQL-to-domain conversion; exact persisted paths are deliberately not
  renormalized or checked against the filesystem; prepared statements serve
  fixed reads; bounded path probes share chunk handling; and ambient
  classification uses explicit summary/behavior/inbound stages. Public
  signatures, predicates, row mapper, schema, writers, and observable order are
  unchanged.
- **NEW mutation and differential:** the same ten NEW mutants are killed. OLD
  and NEW pass the exact ordered query contract. On isolated copies of the
  accepted repository snapshot, both expose 949 files across 21 languages,
  identical file-node/index-state/classification results, 368,035 representative
  serialized bytes, and logical SHA-256
  `36314d4d1267d2e6344dfa6dd472cd222b4a9e72431662fc4229df6212716ef8`;
  file and index-state `UNEXPLAINED = 0`. The canonical and both copies retain
  the same 100,700,160-byte SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`;
  no migration, write, WAL, or SHM sidecar is produced.
- **Sync/Watcher boundary, real repository, determinism, and payload:** known,
  changed, removed, no-op, reopen, incremental, and rebuild-convergence
  observations pass without changing Sync or Watcher. Real-snapshot reads cover
  first/middle/last/missing paths, all 949 ordered records and paths, 247 file
  nodes, revision/indexed-since state, eight stale hash cases, 16 generated
  paths, two ambient paths, and generated count. Three repeated NEW reads retain
  every identity, path, value, order, 368,035-byte payload, and digest. OLD/NEW
  full file-population payload is identical at 256,971 bytes; no false negative,
  false positive, path/identity/state/order drift, or unexplained growth appears.
- **Performance:** seven interleaved OLD/NEW pairs preserve every case count,
  digest, and payload. Median microseconds (OLD/NEW) are 6.6/6.6 path lookup,
  4.2/4.2 missing path, 1,306.2/1,294.1 population, 273.9/272.7 paths,
  1,225.9/1,147.6 file nodes, 45.3/38.2 revision, 258.9/225.5 indexed-since,
  1,409.6/1,468.7 staleness, 636.2/501.2 generated probes, and
  55,418.2/55,427.3 ambient classification. Median deltas range from -21.22%
  to +4.19%; ambient is +9.1 microseconds (+0.02%). Maximum observed process RSS
  is 128,831,488/122,941,440 bytes. No material reproducible regression appears.
- **Provenance:** established normalization moves complete family Scope A
  (`query-session.ts`, `row-mappers.ts`, `file-reader.ts`) from 56.18%
  substantive / 29.03% comments / 16.51% shingles to 32.16% / 34.78% / 15.58%.
  Frozen Scope B remains 50.00% / 31.25% / 29.59%. Replaced residual Scope C
  (`file-reader.ts`) falls from 62.79% / 28.26% / 2.53% to 16.82% / 42.86% /
  0.00%; longest identical block moves 5→4 and both sides have zero blocks >=8.
  Residual overlap is SQL/schema/column identifiers, public result shapes, path
  literals, and standard TypeScript/SQLite idioms, not a legal conclusion.
- **Validation and status:** focused file/DB tests pass 353 with four
  platform-conditioned skips; Sync/Watcher/Resolution convergence passes
  180/180; Graph/Search/Context/Impact downstream tests pass 509/509; semantic
  baseline passes 6/6; CLI/MCP smoke, typecheck, and clean build pass. One
  concurrent evidence run exceeded a 5-second convergence-test budget by 148 ms;
  that exact test passed isolated at 4,793 ms and the complete serial group then
  passed 180/180. PR #27 passes all seven normal jobs (Linux 2/2, macOS 2/2,
  Windows 2/2, and Rust kernel 1/1). Classification is
  `DB_FILE_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`. Remaining DB-reader review
  inventory is dependency, routing, search, stats, and vocabulary. The
  recommended next bounded DB slice is dependency analytics; IND-C05 Graph
  remains deferred.

#### Dependency analytics reader residual closure evidence (2026-09-30)

- **Selected family and exclusions:** the complete bounded family is
  `src/db/dependency-reader.ts`: dead-code dependency evidence, symbol/file
  fan-in and fan-out aggregates, module rollups, cross-file pairs, direct
  dependency/dependent paths, and incoming-edge reconciliation reads.
  `query-session.ts` and `row-mappers.ts` are already Afyx-native shared
  boundaries; `graph-reader.ts` and the `QueryBuilder` facade only delegate.
  Node, edge, reference, file/index-state, routing, search, stats/metadata,
  vocabulary, schema, writers, DB foundation/WAL, Extraction, Resolution,
  Sync/Watcher orchestration, Graph traversal, Impact, and Affected Tests are
  excluded. Graph owns recursion, reachability, cycles and traversal limits;
  this reader returns persisted facts only.
- **OLD contract and mutation:** the ordered DB-query golden freezes source and
  target identity, direction, relation-kind filters, direct/reverse file sets,
  distinct/count behavior, module grouping and pair ranking, dead-code evidence,
  missing/empty results, edge mapping, and accepted SQLite result order. The
  focused Graph/Impact/Affected oracle passes 169/169. All ten OLD observable
  mutants are killed: dependency omission, source/target inversion, kind-filter
  bypass, direction swap, ordering, count, aggregation, duplicate, empty/missing,
  and relation-mapping corruption.
- **Afyx-native architecture:** one named query catalog owns fixed dependency
  reads; dynamic list queries explicitly own projections; row types and decode
  points make direction and identity visible; module facts are collected once
  and folded by Afyx-owned link/pair identities. Fixed statements are cached by
  the existing session, chunking remains bounded, and no traversal algorithm was
  moved into the DB layer. Public signatures, filters, grouping, duplicates,
  return shapes, and observed order remain unchanged.
- **NEW mutation, differential and snapshot:** all ten equivalent NEW mutants
  are killed (10/10, no survivors). OLD and NEW against the accepted
  100,700,160-byte snapshot both report 23,978 nodes, 76,550 edges, 949 files and
  51,990 non-`contains` dependency edges. Every selected identity, direction,
  kind, ordered result, aggregate and serialized value is identical with digest
  `169ed1d440ac906b29da2a94a7334aa8c5ab6b15ddb7f36a96583790176be213`;
  `UNEXPLAINED = 0`, no migration is required. Three repeated NEW runs retain
  that digest and exact 1,175,272-byte logical payload. The high-fan-in case
  (`src/index.ts`) returns 203 distinct dependent files / 11,427 bytes; the
  selected high-out case returns seven files / 304 bytes, with no Cartesian or
  recursive expansion.
- **Performance and payload:** seven interleaved OLD/NEW pairs preserve every
  digest, count and payload. Median microseconds (OLD/NEW) are 550.2/505.1 direct,
  666.8/616.4 reverse, 83,883.6/81,432.3 confidence-filtered full pairs,
  9,135.2/9,367.7 batch counts, 115,357.0/116,437.6 module aggregation,
  33,193.0/33,263.8 top-depended, and 1,963.2/1,920.1 incoming high-fanout.
  Median deltas range from -8.20% to +2.55%; the largest positive absolute
  median delta is 1,080.6 microseconds on the 116 ms aggregation. Median-of-run
  p95 OLD/NEW values are respectively 678.1/618.8, 799.4/842.9,
  93,345.3/88,445.9, 11,957.4/11,867.7, 120,195.5/122,958.6,
  37,357.6/38,634.2, and 2,994.6/2,767.3 microseconds. Maximum observed NEW RSS
  is 146,595,840 bytes. Identical payloads include 2,548 pairs / 306,207 bytes,
  589 incoming edges / 242,856 bytes, and the complete 1,175,272-byte snapshot;
  there is no material reproducible regression or unexplained growth.
- **Provenance:** established normalization moves complete Scope A
  (`query-session.ts`, `row-mappers.ts`, `dependency-reader.ts`) from
  52.57% substantive / 25.30% comments / 16.17% five-line shingles to
  21.83% / 29.41% / 12.22%. Frozen already-native Scope B
  (`query-session.ts`, `row-mappers.ts`) remains 50.00% / 31.25% / 29.59%.
  Replaced residual Scope C (`dependency-reader.ts`) falls from
  53.89% / 23.88% / 9.34% to 12.54% / 0.00% / 4.31%; longest identical block
  is 13→17 and blocks >=8 are 2→1. Residual matches are SQL syntax/schema
  identifiers, public dependency shapes and literals, and standard
  SQLite/TypeScript idioms; this is a technical provenance measure, not a legal
  conclusion.
- **Validation and classification:** focused downstream persistence,
  Graph/file traversal, incremental/sync and CLI affected boundaries pass
  688/688. Semantic baseline passes 6/6, CLI/MCP smoke passes 21/21, and
  TypeScript typecheck plus clean production/UI build pass. PR #28 passes all
  seven normal jobs (Linux 2/2, macOS 2/2, Windows 2/2, and Rust kernel 1/1).
  Previous DB reader closures and DB foundation/WAL remain unchanged. Current
  classification is
  `DB_DEPENDENCY_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`: routing, search,
  stats/metadata, and vocabulary remain DB-reader review inventory. The
  recommended next bounded slice is routing; IND-C05 Graph remains deferred.

#### Routing reader residual closure evidence (2026-10-01)

- **Selected family and separation:** `src/db/routing-reader.ts` owns persisted
  project-shape facts: dominant same-file edge concentration, top route-file
  concentration, and the ordered route-to-handler manifest. `query-session.ts`,
  the closed `file-reader.ts`, `graph-reader.ts`, `QueryBuilder`, the public
  `AfyxGraph` facade, and generated-file classification remain frozen
  Afyx-native boundaries. Context reranking, Graph traversal, route extraction
  and resolution, UI navigation, and CLI/MCP/HTTP/provider/installer routing are
  behavioral consumers or separate domains and were excluded.
- **OLD contract and sensitivity:** accepted behavior freezes source/target row
  identity, route and handler mapping, stable route ordering, first-wins handler
  precedence, 20-candidate bounds, generated/test filtering, thresholds and
  null fallback, duplicate preservation, limit-before-filter behavior, and
  reopen behavior. OLD focused routing plus DB golden passed; all nine applicable
  mutants were killed: omission, wrong target, precedence, ordering, filter,
  fallback, duplicate, missing-result, and row-mapping corruption.
- **Afyx-native architecture and differential:** a named query catalog owns the
  three projections; explicit row types and a single route-entry decoder own the
  SQLite boundary; named policy constants and one eligibility function own
  filters; an insertion-ordered count fold owns stable precedence. NEW focused
  routing plus DB golden passed and killed the same 9/9 mutants. OLD/NEW real and
  controlled snapshots are byte-logically identical (`UNEXPLAINED = 0`).
- **Snapshot, determinism, and consumer boundary:** the isolated accepted
  100,700,160-byte DB (23,978 nodes, 76,550 edges, 949 files, 31 route nodes)
  produced an identical 836-byte logical payload and
  `47d68ab8b49a22fb40fc0cf7bafcfdeff8c4e145f46355b9f908d6ae249937bb`
  digest for OLD and three NEW runs. A controlled positive fixture preserved all
  200 manifest rows, 41,215 manifest bytes, and the
  `39c26d09f738df174e2cd9a5506ac53f9e8280db39084396c0401b0377114090`
  digest. Routing 4/4, DB query 131/131, Context 77/77, and UI server 61/61
  passed (one declared UI skip).
- **Performance and payload:** seven interleaved OLD/NEW pairs preserved every
  result count, serialized byte count, and digest. Median/p95 microseconds were
  598.2/928.1 to 579.7/679.0 for dominant file, 115.2/140.9 to 104.5/143.3
  for top route, 575.5/706.1 to 571.1/671.6 for fallback manifest,
  704.5/940.7 to 750.6/985.3 for a bounded 40-row manifest, and
  1,329.0/2,264.9 to 1,406.9/2,090.5 for the full 200-row manifest. Positive
  median deltas are +46.1 microseconds (+6.54%) and +77.9 microseconds (+5.86%),
  with no material regression. Payloads remain 64, 69, 4, 8,063, and 41,215
  bytes respectively; maximum observed NEW RSS was 64,110,592 bytes.
- **Provenance:** established normalization moves complete Scope A
  (`query-session.ts`, `file-reader.ts`, `routing-reader.ts`) from 26.24%
  substantive / 29.41% comments / 3.43% five-line shingles to 13.81% / 26.32%
  / 0.29%. Frozen Scope B remains 15.75% / 27.78% / 0.00%. Replaced Scope C
  (`routing-reader.ts`) moves from 44.00% / 30.30% / 8.66% to 11.61% / 0.00%
  / 0.65%; its longest identical block falls 9 to 5 lines and blocks of at least
  eight lines fall 2 to 0. Residual matches are public result contracts,
  SQL/schema identifiers and literals, and standard TypeScript/SQLite idioms,
  not copied private helper decomposition.
- **Regression, CI, and known gaps:** TypeScript typecheck, clean production/UI
  build, semantic baseline 6/6, and CLI/MCP smoke 21/21 pass. PR #29
  cross-platform CI passes 7/7 (Linux 2/2, macOS 2/2, Windows 2/2, Rust kernel
  1/1). DB foundation/WAL and all previously closed reader families remain
  unchanged. Classification is
  `DB_ROUTING_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`; search, stats/metadata,
  and vocabulary readers remain. The recommended next bounded closure is the
  Search DB reader; IND-C05 Graph remains deferred.

#### Search DB reader residual closure evidence (2026-10-01)

- **Selected family and separation:** persisted candidate retrieval formerly
  embedded in `src/db/search-reader.ts` is isolated in
  `src/db/search-candidate-reader.ts`: FTS prefix candidates, LIKE candidates,
  exact/case-folded and exact-spelling reads, filter-only reads, rare-name file
  probes, and substring candidates. Query parsing, fuzzy-name selection,
  rescoring, path/name gates, co-location boosts, deduplication, and final
  ranking/limits remain frozen Search semantics in `search-reader.ts`.
  `query-session.ts`, `row-mappers.ts`, the closed `node-reader.ts`,
  `graph-reader.ts`, QueryBuilder, and the public facade remain unchanged.
- **OLD contract and sensitivity:** accepted behavior freezes exact, prefix,
  substring, and fuzzy identities; case folding; kind/language filters; DB
  ordering and candidate bounds; complete node decoding; multi-name
  deduplication; missing/empty behavior; and reopen determinism. Existing
  Search/FTS/index/DB/Context contracts plus the new focused four-test corpus
  pass on OLD. All nine observable mutants are killed: candidate omission,
  wrong identity, filter bypass, ordering, limit, case/prefix, duplicate,
  missing-result, and row-decoding corruption.
- **Afyx-native architecture and differential:** one candidate reader owns an
  explicit node projection, filter construction, SQL execution, FTS capability
  observation, and node/scored-row decode boundaries. SearchReader owns no
  SQLite query and retains the accepted semantic orchestration. NEW kills the
  same 9/9 mutants. OLD and NEW are byte-logically identical for every focused
  contract and real-snapshot case (`UNEXPLAINED = 0`).
- **Snapshot, determinism, and boundaries:** isolated copies of the accepted
  100,700,160-byte DB (SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`)
  contain 23,978 nodes and 23,978 FTS rows. Exact, partial, kind/language,
  path-constrained, multi-exact, substring, empty, missing, and 200-candidate
  reads preserve all counts, identities, fields, scores and order in a
  165,726-byte payload with digest
  `89069b73afc74e2070a7e0c22fb9cad51dce62796e9d97bb3b1011c28b675d42`.
  Three repeated NEW runs are identical; no migration or canonical-index write
  occurs. Search DB/DB/Search/Context/symbol boundaries pass 299/299; CLI, MCP,
  and UI public-consumer gates pass 78 with one declared UI skip.
- **Performance and payload:** seven interleaved OLD/NEW pairs preserve every
  result count, byte count, and digest. Median/p95 microseconds are
  476.0/902.8 to 515.2/1,020.7 exact, 1,981.7/2,734.8 to 1,993.3/2,864.9
  partial, 482.9/610.8 to 519.1/645.9 filtered, 1,772.2/2,966.8 to
  1,939.2/2,704.6 path-constrained, 194.4/285.6 to 224.9/314.2 multi-exact,
  4,031.7/5,612.9 to 3,795.6/5,557.6 bounded-40, and 9,305.0/12,748.9 to
  9,506.5/12,150.3 bounded-200. Median deltas range from -5.86% to +15.69%;
  the largest positive absolute delta is 201.5 microseconds on the 9.5 ms
  200-candidate case. Maximum OLD/NEW RSS is 103,436,288/103,411,712 bytes.
  Corresponding payloads remain 2,133, 3,429, 110, 2,401, 266, 4,656, and
  21,609 bytes with zero unexplained growth or loss.
- **Provenance:** established normalization moves complete Scope A
  (`query-session.ts`, `row-mappers.ts`, `node-reader.ts`, `search-reader.ts`,
  and the new candidate reader) from 43.51% substantive / 21.15% comments /
  10.76% five-line shingles to 31.50% / 20.95% / 7.61%. Frozen Scope B remains
  32.52% / 25.00% / 14.62%. Selected Scope C moves from 54.29% / 19.44% /
  7.04% to 30.41% / 19.18% / 0.85%; longest identical block falls 19 to 6
  lines and blocks of at least eight lines fall 2 to 0. The new candidate
  reader itself has 7/85 substantive matches. Residuals are frozen public
  Search/result contracts, SQL/schema identifiers and search literals, and
  standard TypeScript/SQLite idioms—not retained private DB helper topology.
- **Regression, CI, and known gaps:** typecheck, clean production/UI build,
  semantic baseline 6/6, and CLI/MCP smoke 21/21 pass. PR #30 cross-platform CI
  passes 7/7 (Linux 2/2, macOS 2/2, Windows 2/2, Rust kernel 1/1). All previously
  closed readers, DB foundation/WAL, IND-C03 semantics, and legal/provenance
  files remain unchanged.
  Classification is `DB_SEARCH_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`;
  stats/metadata and vocabulary remain DB-reader review inventory. The
  recommended next bounded persistence slice is stats/metadata; IND-C05 Graph
  remains deferred.

#### Stats / metadata reader residual closure evidence (2026-10-01)

- **Selected family and separation:** `src/db/stats-reader.ts` exclusively owns
  persisted whole-graph totals, node/edge/file grouped distributions, project
  metadata lookup, and ordered project-metadata enumeration. `query-session.ts`
  remains the Afyx-native prepared-statement boundary; `graph-reader.ts` and
  `QueryBuilder` only compose/delegate. File revision/index timestamps remain in
  the already-closed file reader; schema version is owned by `db/index.ts`;
  metadata writes remain in `graph-writer.ts`; DB/WAL health, UI presentation,
  and the vocabulary reader are excluded. No schema, migration, writer, WAL,
  facade, consumer, or previously closed reader changed.
- **OLD contract and sensitivity:** the focused four-test contract freezes
  empty/new and reopened DB behavior; node/edge/file totals; kind/language
  grouping and order; lightweight counts; metadata hit/miss (`null`), values,
  insertion order and updates; zero DB/WAL placeholders; and observation-time
  `lastUpdated`. OLD kills all eight applicable mutants: total count, group
  count, metadata omission, metadata value, timestamp/default, ordering, null
  handling, and row decoding. Schema version/revision mutation is not applicable
  to this reader and was not used to broaden the slice.
- **Afyx-native architecture and differential:** named statements own totals,
  the metadata point read, and row-ordered metadata enumeration. One ordered
  UNION result owns all three distribution dimensions, replacing three private
  query loops; the existing query session caches every fixed statement. NEW
  kills the same 8/8 mutants. OLD and NEW accepted-snapshot outputs are
  byte-identical (`UNEXPLAINED = 0`), require no migration, and provide the same
  values to every frozen consumer.
- **Snapshot, determinism, and payload:** isolated copies of the accepted
  100,700,160-byte DB (SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`)
  report 23,978 nodes, 76,550 edges, 949 files, 19 node-kind groups, eight
  edge-kind groups, 21 language groups, and seven metadata keys. OLD and three
  repeated NEW runs retain identical grouping/order, 1,490-byte logical payload,
  and SHA-256
  `2b26fdca9a4f6ef87d95689f8cb7b90d66642f2e85543e9663a03c99cc01b010`.
  Every per-operation benchmark payload/digest is also identical; the canonical
  index was never opened by the campaign and no migration or writer ran.
- **Performance:** seven deterministic interleaved OLD/NEW pairs preserve every
  result and payload. Median/median-of-run-p95 microseconds move 21.1/34.5 to
  14.8/18.5 for node/edge counts, 3,432.2/3,994.3 to 3,323.2/3,840.6 for full
  stats, 11.1/19.5 to 5.4/7.5 for metadata hit, 9.0/15.5 to 4.2/4.8 for metadata
  miss, and 18.9/31.8 to 9.0/13.4 for all metadata. Median deltas range from
  -3.18% to -53.33%; maximum observed OLD/NEW RSS is
  68,096,000/66,146,304 bytes. No payload growth/loss or performance regression
  appears.
- **Provenance:** established Phase 3B normalization moves complete Scope A
  (`query-session.ts`, `stats-reader.ts`) from 34.62% substantive / 26.67%
  comments / 5.68% five-line shingles to 14.71% / 25.00% / 0.00%. Frozen Scope
  B (`query-session.ts`) remains 10.00% / 18.18% / 0.00%. Replaced Scope C
  (`stats-reader.ts`) falls from 50.00% / 50.00% / 10.87% to 16.67% / 40.00% /
  0.00%; longest identical block falls 9→3 and blocks of at least eight lines
  fall 1→0. Residual matches are public result shapes, SQL/schema identifiers,
  aggregate literals, and standard TypeScript/SQLite idioms; this is technical
  provenance evidence, not a legal conclusion.
- **Validation, CI, and known gaps:** focused DB/metadata plus direct CLI, MCP,
  UI, index-state, lifecycle, and full-pipeline consumers pass 144 tests with one
  declared UI skip. TypeScript typecheck, clean production/UI build, semantic
  baseline 6/6, and CLI/MCP smoke 21/21 pass. PR #31 passes all seven normal CI
  jobs (Linux 2/2, macOS 2/2, Windows 2/2, and Rust kernel 1/1); one unrelated
  Usage Tracker watcher failure passed its targeted rerun while the other
  Windows matrix job had already passed. Classification is
  `DB_STATS_METADATA_READER_SLICE_COMPLETE_WITH_KNOWN_GAPS`:
  vocabulary is the only remaining DB-reader review family. The recommended
  next bounded DB slice is vocabulary; IND-C05 Graph remains deferred.

#### Vocabulary reader residual closure evidence (2026-10-01)

- **Selected family and semantic separation:** `src/db/vocabulary-reader.ts`
  owns the five persisted name-segment reads: empty-state detection, paged
  distinct node names, segment co-occurrence, per-segment name frequencies, and
  names by segment. `name-vocabulary.ts` remains the already-native writer.
  Tokenization, identifier segmentation, plural variants,
  `AfyxGraph.getSegmentMatches`, Search ranking/candidates, and Context
  seeding/expansion remain frozen semantic consumers. This reader has no prefix
  or kind/language/file-filter API, so none was invented. Schema, migrations,
  writers, WAL, and all earlier reader closures are unchanged.
- **OLD contract and sensitivity:** a focused five-test contract plus twelve
  existing vocabulary/semantic tests freeze empty/missing results, identity and
  exclusions, stable paging order, bounds, duplicates, variant folding,
  coverage order, counts/frequencies, shortest-name order, and reopen
  determinism (17/17 PASS). All ten applicable OLD mutants are killed: omission,
  wrong identity, count/frequency, filter, order, limit, coverage threshold,
  duplicate variant, missing/empty, and row decoding.
- **Afyx-native architecture:** a fixed named query catalog owns static reads;
  bounded builders own parameterized co-occurrence and frequency statements;
  explicit row types and decode functions form the SQL-to-domain boundary; and
  every statement uses the existing prepared `QuerySession`. Public signatures,
  predicates, ordering, limits, and result shapes remain unchanged. NEW kills
  the same 10/10 mutants.
- **Differential, real snapshot, determinism, and payload:** seven interleaved
  OLD/NEW runs use isolated copies of the accepted 100,700,160-byte DB (SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`).
  Both readers return 25,457 vocabulary rows and 10,734 distinct names, with
  identical identities, order, counts, co-occurrence, missing/empty behavior,
  5,419-byte representative payloads, and full-population digest
  `6481df8363df4bb99719f1c9f0c43c2abddc6521684a7777bb4fec27bd95b2d2`;
  `UNEXPLAINED = 0`. All seven NEW runs are identical. The canonical index was
  hash-verified and never opened by the campaign; no migration or writer ran.
- **Consumer boundary and performance:** vocabulary/DB, Search, and Context
  gates pass 151/151. Seven interleaved benchmark pairs preserve every result
  count and payload. Median milliseconds (OLD/NEW) are 0.0049/0.0051 emptiness,
  0.6102/0.5896 bounded page, 17.5133/18.2358 full distinct population,
  0.0964/0.0632 co-occurrence, 0.1022/0.0867 frequency batch,
  0.1084/0.1243 names by segment, and 0.0163/0.0092 missing segment. The largest
  positive absolute median delta is 0.7225 ms on the 18.24 ms full population;
  no material reproducible regression or payload growth appears.
- **Provenance:** established Phase 3B normalization moves complete Scope A
  (`query-session.ts`, `vocabulary-reader.ts`) from 31.25% substantive / 22.22%
  comments / 1.08% five-line shingles to 14.93% / 22.22% / 0.00%. Frozen Scope
  B remains 10.00% / 18.18% / 0.00%. Replaced Scope C
  (`vocabulary-reader.ts`) falls from 46.43% / 25.00% / 1.96% to 17.02% /
  25.00% / 0.00%; longest identical block falls 5 to 2 lines and both sides
  have zero blocks of at least eight lines. Residual matches are public result
  shapes, SQL/schema identifiers and standard TypeScript/SQLite idioms; this is
  technical provenance evidence, not a legal conclusion.
- **Final DB-reader inventory audit:** reference/unresolved, node identity,
  edge/adjacency, file/index-state, dependency analytics, routing, Search DB,
  stats/metadata, vocabulary, and DB foundation/WAL are
  `CLOSED_AFYX_NATIVE`. `query-session.ts`, `row-mappers.ts`, reader composition/
  facade, and `name-vocabulary.ts` are `ALREADY_NATIVE`. Schema, migrations,
  writers, semantic Graph/Search/Context logic, Extraction, Resolution,
  Sync/Watcher, MCP/CLI/UI, and IND-C05 Graph are
  `DEFERRED_OUTSIDE_DB_READER_SCOPE`. `UNRESOLVED_RESIDUAL` is empty: no
  material persisted reader family remains.
- **Validation and closure:** TypeScript typecheck, clean production/UI build,
  semantic baseline 6/6, and CLI/MCP smoke 21/21 pass locally. PR #32 passes all
  seven normal CI jobs (Linux 2/2, macOS 2/2, Windows 2/2, Rust kernel 1/1); one
  Linux worker-exit after 5,355 passing assertions passed its targeted rerun.
  Classification is
  `DB_VOCABULARY_READER_SLICE_COMPLETE`; the DB reader subsystem is ready for a
  consolidation checkpoint, but no consolidation implementation or IND-C05
  Graph work starts in this slice.

### DB Closure Consolidation (2026-10-01)

- **Baseline and closure matrix:** official baseline `35a1c7b22f6eda6400466052a5361f56c03236df` includes the DB foundation/WAL and the Reference, Node, Edge, File, Dependency, Routing, Search DB, Stats/Metadata, and Vocabulary reader closures. Those families are `CLOSED_AFYX_NATIVE`; connection tuning, query/write sessions, graph reader/writer composition, row mappers, SQLite adapter helpers, and name-vocabulary policy are `ALREADY_NATIVE` or `OUTSIDE_READER_CLOSURE_SCOPE`. Schema/migrations own storage shape, writers own mutation, readers own persisted retrieval/decoding, and delivery/semantic subsystems remain outside this checkpoint. `UNRESOLVED_RESIDUAL = 0`.
- **Evidence consistency:** all closures use isolated copies of the same accepted 100,700,160-byte snapshot with SHA-256 `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f` and schema version 9. Slice-specific payload digests are expected to differ because their logical projections differ. The 85,617 unresolved rows are all `failed`; the pending count is therefore zero, not contradictory evidence. Ordering, null/default, reopen, determinism, platform, and snapshot claims have no real contract conflict or unknown classification.
- **Accepted population and cross-reader invariants:** the snapshot contains 23,978 nodes, 76,550 edges, 949 files, 7 metadata rows, 51,990 non-`contains` dependency edges, 25,457 vocabulary rows, 31 route nodes, and 85,617 unresolved-reference rows. Edge endpoint, node-file, reference-source, dependency-pair, routing identity, Search candidate identity, Stats total/group, and Vocabulary eligible-name orphan counts are all zero where applicable. Direct/reader checks agree for the 1,557/880 top adjacency counts, 2,523 representative file nodes, 85,617 references, 3,478 cross-file dependency pairs, 23,978/76,550/949 Stats totals, and 10,734 distinct eligible vocabulary names.
- **Consolidated digest, determinism, and lifecycle:** the normalized 6,019-byte logical payload has SHA-256 `ac8cb36cf25b781ab179c1160b89209cedf1f4c6c1c48a95e6d057be8c8ae3ba` in each of three runs. Open/read/close/reopen cycles preserve the digest, values, ordering, metadata, DB bytes, and schema version; no WAL/SHM sidecar remains. The canonical snapshot was never opened by the harness and its isolated copy retained the same byte size and hash.
- **Routing and boundedness:** direct storage contains 31 route nodes. The accepted snapshot has no persisted routing manifest, while bounded routing summaries identify `afyx-graph/engine/src/graph/branch-guards.ts` as dominant (734 edges, 685 next edges) and `afyx-graph/engine/src/resolution/frameworks/react-router.ts` as the top route file (4 of 7 routes). Bounded reader limits, stable ordering, result identities, and payload counts show no duplicate inflation, hidden semantic expansion, unbounded traversal, or accidental full-table read beyond explicitly full-population contracts.
- **Regression boundary:** DB-focused contracts pass 398 tests with four declared skips; Search 91/91, Context 108/108, Graph 427/427, Impact/Affected 10/10, and Watcher/Sync 200 tests with one declared skip all pass. Semantic fixtures pass 6/6 and CLI/MCP smoke passes 21/21. TypeScript typecheck, clean production build, clean UI build, and viewer/WASM validation pass.
- **Representative performance sanity:** median/p95 milliseconds and result count/payload bytes are node lookup 0.0102/0.0216, 21/467; adjacency 2.2702/4.2215, 1,557/394,977; file state 0.0375/0.0433, 2/47; dependency 0.5067/0.5466, 7/304; exact Search DB 0.0812/0.1155, 2/918; Stats 3.3001/3.5252, 8/745; Vocabulary 0.0937/0.1536, 100/2,097. This is a local integration-regression sanity check, not a precision comparison across environments; no material regression is visible against the recorded closure ranges.
- **Provenance consolidation:** bounded Scope C comparison covers 17 final foundation/WAL/reader files against historical commit `b7a1aa2718dc1f6940e483043733f67020d9a62f` using the established Phase 3B normalization. It finds 21 identical blocks of at least eight lines, all explained by SQL/schema declarations, public result shapes, SQLite/worker protocol, diagnostics/comments, or standard TypeScript/SQLite idioms. No at-least-eight-line block spans current reader files, no material private implementation residual remains, and no substantial block is unexplained. This is technical provenance evidence, not a legal conclusion.
- **Ownership and residual scan:** executable persisted reads remain under `src/db`; non-reader reads there are schema/version/WAL mechanics, writer endpoint validation, or bounded dependency aggregation owned by their declared layers. Hits outside `src/db` are comments only. `MATERIAL_OWNERSHIP_LEAK = 0` and `UNRESOLVED_MATERIAL_DB_READER_RESIDUAL = 0`.
- **Limitations and readiness:** the accepted snapshot cannot exercise a non-null persisted routing manifest, and local microbenchmarks cannot establish cross-platform precision. Both are bounded, non-blocking limitations because routing identities and downstream routing contracts pass. Classification: `DB_SUBSYSTEM_CONSOLIDATION_READY`. Freeze this DB subsystem as the dependency baseline; merge this checkpoint before beginning a separately bounded IND-C05 Graph slice.

### IND-C05 — Graph legacy hosts

- **Scope/ownership:** branch guards, dead code, named flow, type hierarchy and
  remaining traversal hosts; use native graph store/frontier/relations seams.
- **Evidence:** graph contracts/benchmarks, semantic baseline, Impact/Context/
  MCP/CLI/UI downstream gates and real repository.
- **Mutation/differential:** traversal direction/depth/order/cycle/guard mutants;
  historical and fresh-index semantic digests.
- **Performance/provenance:** interleaved graph/high-fanout workloads with
  visited counts; replace selected private architecture, not behavior data.
- **Expected files/frozen:** one graph feature family per PR; DB, Resolution and
  public facade frozen.
- **Stop:** unexplained reachability/order delta, fanout blow-up or UI contract
  break.

#### IND-C05.1 — Branch Guard residual closure (2026-10-01)

- **Exact scope and architecture:** selected only source-AST branch/path guards:
  public `BranchGuard` shape and labels, per-site/file extraction, language
  profiles, function boundaries, early-exit/order/branch identity and arm-exit
  semantics. `src/graph/branch-guard-policy.ts` now owns an Afyx-native
  language-profile registry and one centralized ancestor policy;
  `src/graph/branch-guards.ts` remains the stable facade and frozen host for
  call arguments, triggers, loops, decorators, member types and other excluded
  source-intelligence families. Persisted graph traversal, Dead Code, Named
  Flow and Type Hierarchy remain outside this slice; the existing parser/cache
  and UI `SiteReader` boundaries are reused.
- **Accepted contract and mutation:** OLD and NEW focused contracts each pass
  59/59. Ten applicable OLD and ten equivalent NEW mutants are killed:
  language/filter and function-boundary bypass, branch inclusion, early-exit,
  ordering, condition bound, site-line, branch identity, arm-exit and duplicate
  insertion. Graph relation/direction/depth/visited mutations are not applicable
  to this acyclic AST-parent policy and were not fabricated.
- **Differential and repository evidence:** OLD/NEW are byte-identical across
  synthetic contracts, 400-site fanout and the accepted repository snapshot
  (`UNEXPLAINED = 0`). Synthetic is 4,266 bytes SHA-256
  `3098af4774f6f70831833c20bfc74124febd4ab07daf685d95cee55b279fa4f5`;
  fanout is 400/400 guarded, 33,097 bytes SHA-256
  `5bce301748a5c56eecce1e160ed6b19c969c9887e9e5b8199da6043e11a78a3a`;
  repository evidence is 63 guarded plus 40 unconditional observations,
  25,674 bytes SHA-256
  `14ce5f1c1a41c83e4caf1de5196bc2dceafee7ecb1e3c2c03a92f0eb8bd60227`.
  Combined semantic payload is 30,161 bytes SHA-256
  `9d441a08485e217c94c9a5ebcdaea5f38edc90b4aa469d672f147f1b5c964f03`.
  Three frozen NEW runs reproduce identities, ordering, counts, bytes and
  digests exactly; the copied DB remains 100,700,160 bytes with SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`
  before and after every run.
- **Performance and boundedness:** seven-pair interleaved final-source benchmark
  shows high fanout median 43.253 ms OLD versus 41.258 ms NEW (-1.995 ms,
  -4.6%) and p95 49.828 versus 50.402 ms (+0.573 ms). Repository representative
  median is 0.264 versus 0.211 ms and p95 0.316 versus 0.380 ms.
  Simple/multi/deep/cycle absolute median deltas are
  0.0053/0.0025/0.0034/0.0009 ms. All workloads retain site/guard counts,
  ordering, digest and serialized bytes; benchmark fanout is 400/400 and
  29,201 bytes on both implementations. RSS median is 24.73 versus 24.96 MB.
  No duplicate inflation, hidden expansion, limit bypass, cycle revisit or
  unexplained payload growth exists; AST visited-node count is not an
  observable contract, so fixed sites/results are the work proxy.
- **Provenance:** established Phase 3B normalization against historical commit
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` moves complete-family Scope A
  from 100.00% substantive / 99.62% comments / 99.75% five-line shingles to
  57.54% / 94.02% / 59.61%. New native Scope B
  (`branch-guard-policy.ts`) is 6.49% / 0.00% / 0.46%, longest identical block
  0 and no block >=8. Frozen semantic-host Scope C (`branch-guards.ts`) moves
  from 100.00% / 99.62% / 99.75% to 98.01% / 98.30% / 93.16%; its longest
  block is 634 with nine blocks >=8 because excluded domain families remain
  intentionally frozen. Scope B residuals are public contract/type shape,
  grammar vocabulary and standard TypeScript idioms, not a material private
  block; this is technical provenance evidence, not a legal conclusion.
- **Downstream/freeze gates:** Graph 427/427, Context 108/108, Impact/Affected
  10/10, semantic fixtures 6/6, CLI/MCP smoke 21/21 and UI Graph/server/viewer
  684 passed with three declared skips. TypeScript typecheck and clean
  production/UI build pass. No DB, Search, Context, Impact/Affected,
  Extraction, Resolution, Watcher/Daemon, MCP, CLI, UI, provider/installer or
  legal/provenance source changed. Cross-platform CI remains required on the
  final PR head.
- **Known gaps / next bounded slice:** branch guards are complete, but IND-C05
  as a whole is not. Dead Code, Named Flow, Type Hierarchy and any remaining
  traversal families stay separate. After this slice is reviewed and merged
  into a frozen baseline, the recommended next one-family closure is Dead Code;
  it is not started here.

#### IND-C05.2 — Dead Code residual closure (2026-10-01)

- **Scope and boundary:** selected only candidate acquisition, conservative
  exclusion policy, bounded ancestor/override evidence, ambiguity and unresolved
  protection, source corroboration, and deterministic report assembly. The
  contract remains `UNREFERENCED = zero incoming indexed edge`; `DEAD` is the
  narrower inference left after every unsafe candidate is removed. Islands stay
  owned by the map. Named Flow, Type Hierarchy, remaining traversal, DB, Search,
  Context, Impact/Affected, Resolution, MCP/CLI/UI semantics, and installer
  behavior remain frozen.
- **Architecture and contracts:** `src/graph/dead-code-policy.ts` owns the
  Afyx-native facts → exclusion ledger → bounded corroboration → report pipeline;
  `src/graph/dead-code.ts` is the stable public facade. `buildDeadCodeReport`,
  query/report shapes, constants, allowed/default kinds, ordering, counters,
  `/api/deadcode`, and UI wire behavior are unchanged. One safe-direction
  correction excludes a candidate when ancestry demonstrably continues beyond
  the eight-level inspection cap; below/at/above probes are 0/0/0 NEW findings
  versus 0/0/1 OLD, classified `EXPECTED_CORRECTION`.
- **Correctness evidence:** controlled OLD and NEW contracts pass 5/5. Equivalent
  OLD and NEW mutation campaigns kill 21/21 applicable mutants. Focused current
  tests pass 27/27, including every exclusion family, ranking/folding, candidate
  and file bounds, oversized/unreadable/out-of-root source handling, and ancestry
  limits. `NEW_FALSE_POSITIVE_ADDITIONS = 0`; all other controlled and accepted
  repository differences are `IDENTICAL`, with `UNEXPLAINED = 0`.
- **Accepted repository evidence:** the frozen 100,700,160-byte DB remains
  byte-identical at SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`.
  OLD and NEW both report 3,772 raw candidates, 14 final entries, `bounded=false`,
  84 files / 2,717,247 bytes read, 4,078 serialized bytes, and logical SHA-256
  `497d636eed7d8025ac84883c16c37768f1dd70fa2f8499462ad5927369062ab5`;
  all exclusion counts, entries, order, members, lines, and payload bytes match.
  Seven NEW runs are deterministic.
- **Performance and boundedness:** seven-pair interleaved full-report medians are
  145.333 ms OLD and 147.421 ms NEW (+2.088 ms, +1.44%); p95 is 151.958 ms and
  161.070 ms. Candidate count, survivor count, files/bytes read, payload, digest,
  and ordering remain fixed; no candidate/false-positive/duplicate inflation,
  unbounded scan, repeated per-candidate ancestor lookup, or hidden traversal
  expansion was observed.
- **Provenance:** established normalization against historical commit
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` moves complete-family Scope A from
  98.02% substantive / 99.59% comments / 95.76% five-line shingles to
  22.01% / 0.00% / 1.76%. New policy Scope B is 22.10% / 0.00% / 1.79%, longest
  identical block 11 with one block >=8; residuals are public contract/type and
  exclusion vocabulary plus standard TypeScript/filesystem idioms, not an
  unexplained private implementation block. The public facade Scope C is
  0.00% / 0.00% / 0.00%, longest block 0.
- **Downstream and freeze gates:** Graph 427/427, Context 108/108,
  Impact/Affected 10/10, direct Dead Code/UI boundary 76/76, semantic fixtures
  6/6, CLI/MCP smoke 21/21, typecheck, clean production build, and clean UI
  build pass. `src/db/**`, Branch Guard policy/semantics, all named frozen
  subsystems, and legal/provenance files have no changes. PR #35 cross-platform
  CI passes all seven required Linux, macOS, Windows, and Rust-kernel jobs.
- **Known gap and next slice:** IND-C05 remains active; the next independently
  bounded slice is IND-C05.3 Named Flow. This slice does not start it.

#### IND-C05.3 — Named Flow residual closure (2026-10-01)

- **Scope boundary:** selected Flow token parsing and candidate policy, named
  bounded traversal, directed bounded bidirectional traversal, path assembly,
  ordering/deduplication, and call-site mapping. `findAllSymbols` remains an
  exact frozen shared helper; `symbol-lookup.ts`, dynamic-boundary reporting,
  Type Hierarchy, all other traversal families, DB, Branch Guards, Dead Code,
  Search, Context, Impact/Affected, Extraction, Resolution, MCP/CLI/UI
  semantics, and legal records remain frozen.
- **Architecture and contracts:** `src/graph/named-flow-policy.ts` is the
  Afyx-native token/policy/traversal/assembly seam; `named-symbol-flow.ts` is
  the stable public facade and injects generic symbol lookup. Named mode keeps
  every resolved named symbol eligible at both ends, chooses the deepest
  accepted chain, and permits one unnamed bridge by default; route connectors
  do not consume that bridge. Directed mode pins overload candidates for
  `from -> to`, uses bounded two-ended traversal, and intentionally does not
  claim mathematically shortest paths. Flow edges remain `calls` and
  `navigates`, including qualified heuristic/synthesized endpoints.
- **Resolution and bounds:** case-sensitive exact/fuzzy-hint behavior,
  punctuation/extension normalization, query order/dedup, qualified/co-named
  overload handling, generated/test down-ranking, and deterministic candidate
  order are unchanged. Preserved limits are named/directed hops 7/12, bridge
  1, seeds 8, candidates per token 6/12, tokens 16, named nodes 40, dynamic
  endpoints 12 total and 4/token, named visits 1,500, directed visits 12,000
  per side, and caller-supplied `maxChains`. Scratch below/at/above probes are
  OLD/NEW identical; route, bridge, hop, seed, candidate, dynamic endpoint,
  named-visit, and directed-visit caps do not escape.
- **Correctness evidence:** controlled OLD and NEW contracts pass 8/8.
  Equivalent mutation campaigns kill 14/14 applicable mutants in each build
  across token/candidate/co-naming, edge/bridge/depth/visit, traversal,
  ranking/dedup, call-site, synthesized endpoint, and directed endpoint
  categories; no equivalent mutant was retained. The frozen 100,700,160-byte
  repository DB remains byte-identical at SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`.
  All nine real-repository workloads have identical token/node mappings,
  candidates, chains, edge kinds, call sites, work counters, payloads, and
  semantic digests (`UNEXPLAINED = 0`). Representative directed
  `main -> resolveOne` remains seven steps, 69 callee/43 caller/11 node reads,
  2,523 bytes, digest
  `64e6610eb1640a914690fab4fd30cbb1ca2b4ec6032c3de4cffd161bd6989912`.
- **Safety, determinism, performance, payload:** named and directed endpoint,
  disconnected, cycle, route, bridge, high-fanout, dedup, and call-site gates
  pass with `NAMED_FANOUT_REGRESSION = 0` and zero unexplained path delta.
  Three frozen NEW runs are byte/digest identical. A 21-repetition interleaved
  seven-workload benchmark preserves every work counter/path/payload/digest;
  median deltas range from -16.43% to +15.44%, with the largest increase only
  +0.963 ms and an improved p95, so no material regression. Payload delta is
  zero in every cell and no hidden full-graph expansion was observed.
- **Provenance and consumers:** against historical commit
  `b7a1aa2718dc1f6940e483043733f67020d9a62f`, complete-family Scope A moves
  from 99.17% substantive / 98.73% comments / 93.17% five-line shingles to
  31.56% / 90.48% / 15.28%. New policy Scope B is 20.63% / not applicable /
  0.30%, with longest identical block 0 and no block >=8. Frozen shared-host
  Scope C is 72.88% / 90.48% / 60.36%, longest block 66 and two blocks >=8,
  reflecting retained public/shared lookup contracts. Residual matches are
  public types/constants and graph vocabulary or standard TypeScript/traversal
  idioms, not a legal conclusion. MCP explore, `/api/flow`, and viewer Flow
  continue to consume the single facade; consumer/API/viewer tests pass 75/75
  with identical step/edge/call-site ordering.
- **Downstream and freeze gates:** Named Flow scratch contracts 8/8, UI Flow
  API 30/30, Graph 427/427, Context 108/108, Impact/Affected 10/10, semantic
  fixtures 6/6, CLI/MCP smoke 21/21, typecheck, clean production build, and
  clean UI build pass. `src/db/**`, Branch Guard and Dead Code policies and
  semantics, every named frozen subsystem, and legal/provenance files have no
  production change. PR #36 passes all seven normal Linux, macOS, Windows,
  and Rust-kernel CI jobs.
- **Known gap next slice:** IND-C05 remains active. Type Hierarchy and the
  remaining traversal families are not started; the recommended next bounded
  slice is IND-C05.4 Type Hierarchy only after this PR is accepted.

#### IND-C05.4 — Type Hierarchy residual closure (2026-10-01)

- **Scope boundary:** selected the rich query-time hierarchy in
  `src/graph/type-hierarchy.ts`: eligibility, `extends`/`implements` ancestry
  and descendants, deterministic relation ordering, synthesized provenance,
  true fan counts, bounded/hidden rows, dispatch threshold, and by-name member
  redeclaration. `GraphTraverser.getTypeHierarchy()` and
  `relations.ts::typeViewOf()` remain the frozen ancestor-only `Subgraph`
  boundary used by Context. DB, Branch Guards, Dead Code, Named Flow, other
  traversal, Search, Context, Impact/Affected, Extraction, Resolution,
  Watcher/Daemon, MCP/CLI/UI semantics, provider/installer, and legal records
  remain frozen.
- **Architecture and public contract:** `type-hierarchy.ts` remains the stable
  public facade and retains every public type, constant, name, and signature.
  New `type-hierarchy-policy.ts` owns the private bounded query policy,
  breadth-first level reads, ordering/dedup, fan accounting, override
  derivation, and result assembly. Accepted edges remain `extends` and
  `implements`; accepted node kinds remain class, interface, struct, trait,
  protocol, enum, type alias, and union. Bounds remain ancestor depth 8,
  descendant depth 6, 400 materialized descendants, 12 override ancestors,
  and 8 direct implementers for polymorphic dispatch. The independent wire
  caps remain 24 ancestors and 240 descendants.
- **Semantic contract:** ancestors and descendants remain breadth-first,
  cycle-safe, and one row per identity. Level order is `extends` before
  `implements`, then name, path, and start line. For duplicate relations,
  `extends` upgrades `implements` and supplies the selected edge/provenance.
  Descendant caps preserve true direct counts, expose `bounded`, and attribute
  hidden identities to their returned parent. Overrides remain a nearest
  established-ancestor, member-name match for method/function/property/field;
  `{ overrides: false }` changes only override calculation. Edge/member read
  failures retain their narrow empty-result fallback, and implementer-count
  failure remains zero.
- **Correctness and mutation evidence:** the pre-change focused/graph contract
  passes 123/123. The final focused set passes 149/149, including explicit
  7/8/9 ancestor, 5/6/7 descendant, 399/400/401 row, 7/8/9 dispatch,
  duplicate-order, cycle, missing-node, synthesized, failure, override, and
  batched-work probes. OLD and NEW each kill 19/19 applicable mutants. In both
  builds, lowering the override-member cap from 12 to 9 is equivalent because
  the independently frozen ancestor walk already stops at depth 8.
- **Differential and ground truth:** controlled OLD/NEW output is identical
  except one `EXPECTED_CORRECTION`: a duplicate edge for the 401st child no
  longer inflates direct/implementer/hidden identity counts (OLD 402, NEW 401).
  Thirteen frozen real-repository hierarchy results are exactly identical.
  `UNEXPLAINED = 0`; ancestor, descendant, relation/order, synthesized,
  boundedness, dispatch, override, payload, and work parity otherwise hold.
  The accepted copied DB remains 100,700,160 bytes at SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`.
- **Safety, work, determinism, performance, and payload:** controlled work is
  unchanged: ancestor-8 uses 1 incoming/9 outgoing reads, fan-400 uses 2/1
  reads and one 400-id node batch, and dispatch-8 uses 2/1 reads and one 8-id
  batch. Cycles terminate, all bounds hold, and no per-node query or hidden
  full-graph scan appears. Three NEW runs have identical ordering, payload,
  and semantic digest
  `df12344dc4a12db382446692036eba2c77bdc66fcaeb6f819ccae0d171fabc4e`.
  Seven 120-iteration controlled workloads show median deltas from -43.40% to
  +22.22%; the largest increase is only +0.0006 ms. p95 changes range from
  -0.0801 ms to +0.0202 ms, so no material regression exists. Normalized
  controlled payload remains 119,894 bytes in both builds; result growth/loss
  is zero outside the explicit duplicate-count correction.
- **Consumers, generic boundary, and freeze gates:** `/api/node`, viewer Type
  Hierarchy, MCP explore dispatch, generic Graph hierarchy, Context, and
  Impact/Affected focused gates pass without consumer changes; MCP and viewer
  continue to share `countImplementers`. Graph/consumer focused validation
  passes, as do graph-contract, semantic CLI/MCP contracts, typecheck, clean
  production build, clean UI build, semantic fixtures, and CLI/MCP smoke.
  The broad local Windows suite has zero NEW regression: isolated `sync.test`
  and `mcp-unindexed.test` pass, while the remaining teardown/lock/path
  failures reproduce unchanged on the exact OLD baseline.
  `src/db/**`, Branch Guards, Dead Code, Named Flow, and every named frozen
  production subsystem have no semantic change.
- **Provenance:** against historical commit
  `b7a1aa2718dc1f6940e483043733f67020d9a62f`, complete-family Scope A moves
  from 43.48% substantive / 17.11% comments / 8.29% five-line shingles to
  22.27% / 21.67% / 4.03%. New private-policy Scope B is 11.32% / 0.00% /
  1.18%, longest block 7 and no block >=8. Retained public-facade Scope C is
  55.77% / 24.07% / 9.35%, longest block 8 and two blocks >=8, reflecting
  public shapes, constants, vocabulary, and facade delegation. This is
  technical provenance evidence, not a legal conclusion.
- **Closure state and remaining inventory:** PR #37 passes all seven normal
  Linux, macOS, Windows, and Rust-kernel CI jobs. IND-C05 remains active after
  Type Hierarchy; generic frontier/relationship/containment/route traversal
  families remain pending. The recommended next slice is a fresh, separately
  bounded inventory of the remaining traversal family, not a change to frozen
  `typeViewOf` in this PR.

#### IND-C05.5 — Remaining traversal inventory and Graph consolidation (2026-10-01)

- **Baseline, scope, and ownership:** official baseline
  `2794d203c01437c6e83227c480186a70641149f3` (merged PR #37) was clean and
  identical to `origin/main`. The inventory inspected `frontier-walk.ts`,
  `walk-request.ts`, `relations.ts`, `containment.ts`, `route.ts`, and
  `traversal.ts`, plus supporting `graph-store.ts`, `queries.ts`, and
  `graph/index.ts`; indexed call paths, public `AfyxGraph` consumers,
  Context/Impact/MCP/CLI callers, focused tests, graph-contract worlds,
  semantic fixtures, benchmark coverage, Git history, and historical commit
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` were reviewed. No production or
  test source changed. Scratch-only evidence is under
  `%LOCALAPPDATA%\Temp\afyx-ind-c05r5-20261001\campaign-1790842284`.
- **Prior hypothesis rechecked:** the initial audit called frontier walk, walk
  request, relations, containment, route, and graph store Afyx-native, while
  leaving `traversal.ts` and `queries.ts` unknown. Current history confirms the
  focused modules and narrow `GraphReader` boundary were introduced together
  by Afyx-native commit `eda65906a3199ff66b36d29167d66b6b9a5b1b35`.
  Current source and call paths resolve the two former unknowns: `GraphTraverser`
  is delegation only, and relevant `GraphQueryManager` behavior is public
  context/metrics assembly over the traverser and catalog, not a retained
  traversal algorithm.
- **Accepted behavior and ground truth:** the 376-case graph-contract golden
  matrix exercises linear, diamond, cycle, self-edge, disconnected, duplicate,
  multi-relation, inheritance, multiple-parent, file-dependency, relation-kind,
  and extra worlds. It records BFS/DFS for outgoing/incoming/both, depths
  0/1/2/unbounded, limits, include-start, edge/node filters, missing nodes,
  parallel edges and deterministic ordering; relationship depths 0/1/2/3/5,
  callers/callees, focal call graph, usages, frozen ancestor-only type view and
  graph-local impact; containment parent/member order and cycles; and route
  existence, filters, tie order, reconstruction, missing endpoints, and
  unreachable pairs. `graph.test.ts` additionally pins high-fanout limits and
  edge completeness. Public contracts, current corrected Afyx semantics, and
  accepted golden output remain the authority; historical behavior is not an
  independent authority.
- **Family inventory and classification:**

  | Family / subfamily | Primary owner | Public consumer | Final classification | Basis |
  | --- | --- | --- | --- | --- |
  | Generic BFS/DFS | `frontier-walk.ts` | `GraphTraverser.traverseBFS/DFS` | `CLOSED_AFYX_NATIVE` | Explicit-stack/queue Afyx module; bounded, cycle-safe, batched, deterministic |
  | Walk request/policy | `walk-request.ts` | frontier walks | `CLOSED_AFYX_NATIVE` | Afyx-owned option resolution/direction/filter/edge identity seam |
  | Callers/callees | `relations.ts::followCalls` | traverser, public graph, Context/CLI/MCP | `CLOSED_AFYX_NATIVE` | Focused explicit-stack relationship policy with strong golden coverage |
  | Call graph | `relations.ts::callGraphAround` | traverser/public graph | `CLOSED_AFYX_NATIVE` | Thin deterministic composition of native callers and callees |
  | Usages | `relations.ts::usagesOf` | traverser/public graph | `CLOSED_AFYX_NATIVE` | Batched source attachment preserving incoming edge order |
  | `typeViewOf` | `relations.ts::typeViewOf` | `GraphTraverser.getTypeHierarchy`, Context | `FROZEN_PUBLIC_CONTRACT` | IND-C05.4 frozen ancestor-only generic `Subgraph`; rich hierarchy remains separate |
  | Graph-local `impactOf` | `relations.ts::impactOf` | traverser/public graph | `CLOSED_AFYX_NATIVE` | Same-depth member expansion and bounded incoming dependents are independently guarded; `src/impact/**` remains outside scope |
  | Containment | `containment.ts` | traverser and `GraphQueryManager` context/metrics | `CLOSED_AFYX_NATIVE` | Nearest-first first-parent chain and direct ordered members; cycle-safe |
  | Route | `route.ts` | `GraphTraverser.findPath` | `CLOSED_AFYX_NATIVE` | Outgoing filtered BFS, claim-on-discovery, parent-linked reconstruction |
  | `GraphTraverser` facade | `traversal.ts` | engine/public facade/Context | `FROZEN_PUBLIC_CONTRACT` | Stable signatures and direct delegation; owns no private algorithm |
  | Relevant `GraphQueryManager` usage | `queries.ts` | context/metrics/public query facade | `FROZEN_PUBLIC_CONTRACT` | Stable public assembly around catalog/traverser; no relationship traversal policy |

- **Sensitivity, real repository, and determinism:** 19/19 targeted scratch
  mutants are killed, with zero survivors/invalid probes: Generic Frontier and
  Walk Request 8/8 (depth, limit, include-start, edge dedup, structural order,
  direction, edge filter, node filter); Relationships 6/6 (calling vocabulary,
  side, depth, dedup, frozen type-view direction, impact member depth);
  Containment 2/2 (parent choice, child order); Route 3/3 (direction, filter,
  reconstruction). Facade/manager mutations were not fabricated because those
  boundaries only delegate/assemble and their calls are covered by the same
  contracts. Three runs against a copied accepted 100,700,160-byte DB are
  byte-for-byte deterministic: 27,932-byte normalized payload, SHA-256
  `4574568802eecc050a8be48ad08550381eb2494b3a97b154b1e094987e1e4f8c`.
  Representative results contain BFS 50 nodes/76 edges, DFS 50/64,
  callers/callees 1/9, call graph 11/10, usages 7, generic type view 5/4,
  graph-local impact 2/8, containment 1 ancestor/9 children, and a two-stop
  real route. The copied DB remains SHA-256
  `9e7ca8bffc655925c0f8bd9da81d9296e85956350e431816203b6610ae82097f`.
- **Complexity and performance:** frontier and relationship traversals schedule
  or open an identity once and batch node lookup per adjacency frame; route
  claims on discovery and stores parent indices; containment is a cycle-safe
  parent chain or one batched direct-member lookup. There is no hidden
  full-graph scan in these algorithms. The existing nine-round graph benchmark
  passes with stable digests: representative medians are BFS shallow 54.6 µs
  (7 nodes/6 edges), DFS outgoing 553.9 µs (49/48), cyclic 136.6 µs (4/6),
  containment ancestors 98.4 µs (2 nodes), and a 120-node/119-edge route
  4,456.2 µs. This inventory changes no implementation, so no OLD/NEW
  performance claim is made.
- **Per-family provenance:** established Phase 3B normalization (trim/collapse
  whitespace; substantive lines ≥20 characters with three alphanumerics;
  comment overlap; nonempty five-line shingles; `SequenceMatcher` blocks with
  `autojunk=false`) compares the current modules with the combined historical
  traversal/query corpus. Generic Frontier is 1/97 substantive (1.03%), 0.00%
  comments, 2.34% shingles, longest block 8 and one block ≥8; the block is the
  public default traversal option values. Relationships is 4/118 (3.39%),
  0.00%, 0.00%, longest 3, zero blocks ≥8. Containment is 0/18 (0.00%), 0.00%,
  0.00%, longest 1. Route is 1/30 (3.33%), 0.00%, 0.00%, longest 2. The
  `GraphTraverser` facade is 10/32 (31.25%), 0.00%, 1.56%, longest 5, zero
  blocks ≥8; `GraphQueryManager` is 17/65 (26.15%), 0.00%, 3.42%, longest 8,
  one block ≥8, consisting only of the public `getNodeMetrics` return shape.
  Supporting graph contracts are 1/28 (3.57%), 0.00%, 0.00%, longest 2.
  Residual matches are public/shared contract, graph vocabulary, or standard
  graph/TypeScript idioms; material unexplained private traversal residual is
  zero. This is technical provenance evidence, not a legal conclusion.
- **Consolidation gates and freezes:** Graph full regression passes 427/427;
  Context 108/108; Impact/Affected 10/10; Branch Guard 59/59; Dead Code 27/27;
  Named Flow consumer/API/viewer 75/75; direct Type Hierarchy 64/64; semantic
  fixtures 6/6; CLI/MCP smoke 21/21. TypeScript typecheck, clean production
  build, and clean UI build pass. DB, Search, Context semantics,
  Impact/Affected, Extraction, Resolution, Watcher/Daemon, MCP/CLI/UI
  semantics, provider/installer, and legal/attribution files are unchanged.
  Branch Guards, Dead Code, Named Flow, Rich Type Hierarchy, and frozen
  `typeViewOf` remain closed and were not reopened.
- **Decision and closure:** Path A. `MATERIAL_RESIDUAL_REQUIRES_CLOSURE = 0`
  and `UNKNOWN_REQUIRES_EVIDENCE = 0`. Graph-wide closure now covers Branch
  Guards, Dead Code, Named Flow, Rich Type Hierarchy, Generic Frontier,
  Relationships, Containment, Route, and facade/shared contracts. Final
  classification is `GRAPH_REMAINING_TRAVERSAL_CONSOLIDATION_COMPLETE`;
  `IND-C05 Graph = COMPLETE` and frozen. The exact next separately bounded
  phase is IND-C06 Watcher / Daemon / Proxy; it is not started here.

### IND-C06 — Watcher, daemon and proxy lifecycle

- **Scope/ownership:** residual sync/watch and daemon/proxy lifecycle hosts;
  Afyx single-writer architecture.
- **Evidence:** convergence, watcher, writer-lock, liveness, socket fallback,
  daemon/proxy tests and benchmarks on all OS CI.
- **Mutation/differential:** coalescing/retry/drop event, dead-client, idle timer,
  lock ownership and socket cleanup mutants; controlled filesystem/process
  traces.
- **Performance:** event bursts, attach/cold start, p95, RSS and handles.
- **Expected files:** one watcher-policy or lifecycle seam per slice.
- **Frozen/stop:** DB semantics, MCP protocol and single writer; stop on stale
  index, competing writer, orphan/leak or platform-only failure.

#### IND-C06.1 — Lifecycle inventory and first-slice selection (2026-10-01)

- **Baseline and scope:** official baseline
  `3a02a824afe96f0dda23e698806efb1afc22bb51` (merged PR #38) was clean and
  equal to `origin/main`. The inventory covered all lifecycle-relevant files in
  `src/sync` and `src/mcp`, their `src/index.ts`, `src/freshness.ts`, MCP
  session/transport, and UI event call boundaries. DB, Graph, Search, Context,
  Impact/Affected, Extraction, Resolution, MCP tool/wire semantics, CLI output,
  UI, provider/installer, and legal files were treated as frozen dependencies.
  No production or test source changed. Reproducible scratch evidence is under
  `%LOCALAPPDATA%\Temp\afyx-ind-c06r1-20261001\campaign-3a02a824`.
- **Ownership boundary:** `FileWatcher` owns freshness-event intake through
  coalescing and sync-attempt completion; it does not own Extraction's
  incremental reconciliation. `Daemon` owns the one writer/service, socket,
  sessions, idle policy, and durable discovery artifacts. A proxy owns one
  client's attachment, relay/fallback, and terminal signals. MCP sessions and
  transport own JSON-RPC behavior, which remains outside IND-C06.
- **Lifecycle topology and classification:**

  | Family | Primary owner / supporting hosts | Runtime state and resources | Contracts and evidence | Final classification |
  | --- | --- | --- | --- | --- |
  | Watch Event Intake | `FsWatchAdapter`, `classify`, `FileWatcher`; `worktree.ts`, `git-hooks.ts` support policy | recursive/per-directory `FSWatcher` handles, live ignore matcher, normalized relative paths | add/change/delete, removed-directory full scan, ignored/out-of-scope paths, Windows/macOS recursive versus Linux directory watches | `CLOSED_AFYX_NATIVE` |
  | Pending Change / Debounce | `PendingChangeSet`, `DebounceScheduler`, `FileWatcher` | insertion-ordered pending map and one trailing-edge timer | duplicate folding, during-sync preservation, quick/full window boundaries, stop cancellation | `CLOSED_AFYX_NATIVE` |
  | Retry / Convergence | `RetryPolicy`, `FileWatcher.flush`; Extraction sync is a frozen callee | separate lock/generic failure streaks, bounded backoff, full-scan latch | retries retain work, arrivals during sync survive, successful sync clears only attempted entries, incremental/full rebuild convergence | `CLOSED_AFYX_NATIVE` |
  | Writer Ownership / Lock | `atomic-lockfile.ts`, `writer-lock.ts`, daemon election/registry | atomic lockfile and writer PID record; no timer | at most one writer, compare-and-delete release, stale/live/PID-reuse handling | `CLOSED_AFYX_NATIVE` |
  | Process Liveness / Watchdogs | `liveness-watchdog.ts`, `ppid-watchdog.ts`, `early-ppid.ts`, `startup-handshake.ts`, `stdin-teardown.ts`; `process-liveness.ts` is the native leaf seam | watchdog child, heartbeat/PPID intervals, startup timer, stdin listeners | parent/host death, main-loop wedge, slow-disk progress deferral, pre-handshake orphan, stdin failure | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
  | Daemon Startup / Registry / Handshake | `Daemon`, daemon election in `mcp/index.ts`, `daemon-registry.ts`, `daemon-manager.ts` | daemon PID/registry records, writer ownership, sessions and signal listeners | cold start, concurrent election, ready/hello, stale registry, PID reuse, failed start cleanup | `CLOSED_AFYX_NATIVE` |
  | Socket Binding / Fallback | `bindFirstUsableSocket`, `daemon-paths.ts`, `Daemon.bindSocket`, proxy connect | Unix socket or Windows named pipe and candidate paths | occupied address is not stolen; unsupported path candidates relocate; stale socket and partial bind are cleaned | `CLOSED_AFYX_NATIVE` |
  | Proxy Attach / Client Lifecycle | `runProxy`, `LocalHandshakeSession`, `client-registry.ts`, `ActivityTimers` | client socket/session sets, inflight/pending maps, idle/max-idle/sweep timers | warm reuse, multiple clients, dead peer sweep, daemon-loss local fallback, last-client idle | `CLOSED_AFYX_NATIVE` |
  | Shutdown / Teardown | `Daemon.stop`, proxy shutdown, watcher stop, activity policy, lock/socket cleanup | all resources above; no independently persisted state | idempotent stop ordering and public/runtime terminal behavior span the owners above | `FROZEN_RUNTIME_CONTRACT` |

- **Why one residual remains:** watcher commit
  `9f9ee23c3d04d74881ee01c678596db36857cb3d` and daemon/proxy commits
  `5c416233c14de56efeaf5867389c7b390144001d` /
  `7c4213eba303d91d90bf4c1b140006ebff5c7c5c` introduced explicit Afyx-owned
  collaborators and orchestration with mutation evidence. By contrast, blame
  retains 237/244 lines of `liveness-watchdog.ts`, 68/71 of
  `startup-handshake.ts`, all 46 lines of `stdin-teardown.ts`, and all 25 lines
  of `early-ppid.ts` from the historical import. The child-process heartbeat,
  progress-deferral/hard-cap state machine, parent/host supervision, abandoned
  startup, and stdin-terminal policy are distinctive private lifecycle control
  flow. This conclusion is based on ownership and history, not similarity
  alone; `process-liveness.ts` and the newly structured portion of
  `ppid-watchdog.ts` remain Afyx-native supporting seams.
- **Ground truth and focused validation:** the existing 23-file lifecycle
  selection exercises 340 cases: the combined local run had 322 pass, 13
  declared skips, and five failures. Isolated reruns proved daemon 12/12,
  watcher 36/36, and incremental convergence 10/10 pass; four combined-run
  failures were Windows temp-directory/watch-handle interference. Writer-lock
  has 5/6 local passes; its one PID-1 fixture is not valid in this restricted
  Windows sandbox (`process.kill(1, 0)` is denied), while real spawned-holder,
  direct-mode competing writer, stale lock, re-entrant acquire and release
  paths pass. The selected liveness set passes 39 tests with four
  platform-conditioned skips, including real spawned wedge/healthy/slow-disk/
  hard-cap processes. Semantic fixtures pass 6/6 and CLI/MCP smoke passes
  21/21. TypeScript typecheck and clean production/UI builds pass.
- **Invariants and resources:** accepted watcher tests preserve every arrival
  through debounce, active sync and retry; isolated convergence produces zero
  lost events and zero stale final indexes. Concurrent launcher and direct-mode
  tests preserve one writer. Current and accepted PR #11 evidence records zero
  watcher handle/timer growth across 40 real start/stop cycles; PR #12 records
  zero leaked processes across repeated spawn/attach/detach/shutdown cycles on
  Windows and Linux. Focused stop tests close watch handles, timers, sessions,
  sockets, registry records and owned lockfiles. Forced `SIGKILL` deliberately
  relies on stale-owner recovery at the next start rather than graceful cleanup.
- **Mutation strength:** accepted watcher evidence kills OLD 20/20, NEW 21/21,
  plus 5/5 support-utility mutants (drop/coalescing, retry, debounce and scope
  decisions). Accepted daemon/proxy evidence kills OLD 24/24 and NEW 27/27
  election, ownership, client, idle, socket and fallback mutants. No new
  inventory-only mutants were fabricated. A bounded Afyx-owned mutation matrix
  for the retained supervision/orphan-reaping family is not yet established;
  this is the selected slice's principal missing evidence, not a claimed
  survivor.
- **Current-only performance baseline:** `benchmark-watcher-policy.mjs` runs 15
  rounds with stable digest `d0bca111f862`: median single event 0.342 ms,
  duplicate folding 3.676 ms, 100-event coalescing 13.060 ms, 1,000-event
  coalescing 134.777 ms, mixed paths 21.628 ms, and post-success pruning 31.281
  ms. `benchmark-daemon.mjs` runs five rounds: cold start median 376.940 ms
  (372.269–419.950), existing attach 13.392 ms (12.524–15.608), second-client
  attach 1.123 ms (0.993–1.528), request round trip 0.708 ms, detach 61.810 ms,
  shutdown 7.074 ms (6.411–8.702), and stale-lock restart 483.888 ms. These
  scripts do not emit p95, RSS, handle or process-count samples, so those fields
  are `NOT AVAILABLE`; no OLD/NEW performance claim is made.
- **Cross-platform evidence:** PR #11 (watcher) and PR #12 (daemon/proxy) each
  passed seven jobs: Linux 2/2, macOS 2/2, Windows 2/2 and Rust kernel 1/1.
  Their real watcher/daemon process campaigns covered Windows and Linux; macOS
  CI covers build/focused suite behavior. Platform policy is explicit: recursive
  watch on Windows/macOS, per-directory inotify on Linux, named pipes on
  Windows, Unix-socket candidates on POSIX, reparent detection on POSIX and
  direct parent-liveness probing on Windows. No platform-only semantic delta is
  accepted.
- **Provenance:** established Phase 3B normalization against historical commit
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` gives Watcher 215/548
  substantive (39.23%), 43.11% comments, 11.76% five-line shingles, longest
  block 28 and 12 blocks >=8; Writer/Lock 15/151 (9.93%), 23.68%, 0.45%, 6/0;
  Daemon 186/503 (36.98%), 23.24%, 5.74%, 12/7; Liveness 20/145 (13.79%),
  18.64%, 0.56%, 6/0; Proxy 88/234 (37.61%), 19.30%, 3.28%, 8/2. Retained
  watcher/daemon/proxy matches are public result/hello shapes, paths/messages,
  platform API idioms, or facade wiring already superseded by Afyx-owned
  collaborators. Liveness is selected despite low aggregate textual overlap
  because history and state ownership expose retained private control flow.
  This is technical provenance evidence, not a legal conclusion.
- **Decision:** Path B. `MATERIAL_RESIDUAL_REQUIRES_CLOSURE = 1` and
  `UNKNOWN_REQUIRES_EVIDENCE = 0`. The first and only selected family is
  **Process Supervision / Liveness / Orphan Reaping**, because it is a leaf
  lifecycle policy consumed by direct MCP, proxy and daemon/index lifecycles;
  closing it before orchestration avoids duplicating policy upward. Exact
  residual hosts are `liveness-watchdog.ts`, `early-ppid.ts`,
  `startup-handshake.ts`, `stdin-teardown.ts`, and historical regions of
  `ppid-watchdog.ts`; `process-liveness.ts`, call sites, MCP protocol, CLI
  behavior, single-writer semantics, timeout/env contracts and every frozen
  subsystem remain unchanged. Ground truth is the 43-case liveness selection,
  real child-process fixtures, and accepted cross-platform CI. Recommended next
  branch: `afyx/ind-c06-liveness-native`; recommended task: **Phase 3B.12C.6.2
  Process Supervision / Liveness / Orphan-Reaping Residual Closure**.
- **State:** final classification `LIFECYCLE_RESIDUAL_SELECTED`; IND-C06 remains
  active. Do not begin IND-C07 until the selected IND-C06 slice and subsequent
  lifecycle consolidation gate are complete.

#### IND-C06.2 — Process supervision / liveness closure (2026-10-01)

- **Baseline and scope:** official baseline `fb93fea7fac4055b6b22dfe968da0c7dbbdaf0a0`.
  The selected production family is the stable facades `liveness-watchdog.ts`,
  `ppid-watchdog.ts`, `startup-handshake.ts`, `stdin-teardown.ts`, and
  `early-ppid.ts`, backed by new Afyx-owned `supervision-policy.ts`,
  `watchdog-policy.ts`, and `watchdog-runtime.ts`. `process-liveness.ts`, all
  daemon/proxy/watcher callers, DB, Graph, Search, Context, Impact, MCP/CLI/UI,
  provider/installer, and legal files remain frozen and unchanged.
- **OLD architecture and ground truth:** supervision policy, timers, streams,
  child spawning, and disk-progress decisions were embedded in five historical
  facades. The reconstructed OLD selection passed 39/43 cases with four genuine
  POSIX-only skips on Windows. A valid OLD mutation campaign killed 23/23
  applicable mutants; its first junction-following result was rejected rather
  than used. The matrix covers platform-specific parent/host loss, PID parsing,
  startup abandonment, terminal stdin fan-in, healthy heartbeat, CPU and
  non-allocating wedges, progress deferral, hard cap, spawn/pipe failure, and
  idempotent stop.
- **Afyx-native ownership:** deterministic PPID/host/deadline decisions and the
  single-settlement primitive live in `supervision-policy.ts`;
  `ProgressSilencePolicy` is both directly tested and serialized into the
  isolated watchdog child; `watchdog-runtime.ts` exclusively owns spawn,
  heartbeat, unref, stream failure, and teardown. Existing exported names,
  defaults, environment variables, reason strings, and caller order remain the
  public/runtime contract.
- **NEW evidence:** final focused selection passes 58 tests with four legitimate
  POSIX-only skips. NEW mutation sensitivity is 22/22 applicable mutants killed,
  one equivalent double-callback mutant, zero meaningful survivors, and zero
  invalid mutants after compile-valid closure. Real child campaigns cover
  healthy heartbeat, allocating and non-allocating wedges, slow progress,
  no-progress stall, hard cap, watchdog opt-out, normal stop, startup abandonment,
  and socket-backed stdin failure; accepted cleanup leaves zero orphan children.
- **Controlled differential:** PPID/host decisions and reasons, parsing,
  watchdog cadence, startup callback behavior, destruction, and callback counts
  are identical. NEW intentionally removes stdin terminal listeners immediately
  after settlement, whereas OLD retained them; this is an
  `EXPECTED_CORRECTION` with unchanged destruction and callback count.
  `UNEXPLAINED = 0`.
- **Platform and resource behavior:** POSIX retains reparent-change detection;
  Windows retains direct original-parent liveness probing; an explicit host PID
  remains authoritative on either platform. Watchdog child/stdin and heartbeat
  timers are unref'd, stop is idempotent, startup timer/listener cleanup is
  asserted, stdin listeners are released, and no persistent handle growth was
  observed. Windows real-process evidence passes locally; Linux/macOS final-head
  evidence is delegated to the normal cross-platform PR jobs.
- **Performance:** interleaved OLD/NEW medians in milliseconds were PPID policy
  100k `2.3705/3.4057`, startup arm/disarm 1k `0.7576/1.3089`, PPID setup/stop
  1k `0.6603/0.6608`, watchdog arm/stop `31.4177/31.0809`, wedge detection
  `462.4922/460.2562`, and startup orphan cleanup `127.2475/141.1551`.
  Percentage changes on the first two microbenchmarks are large but correspond
  to about 10 ns/op and 0.55 us/op; process-scheduling paths show no material
  regression or persistent process/timer/handle leak.
- **Provenance:** against historical reference
  `b7a1aa2718dc1f6940e483043733f67020d9a62f`, Scope A OLD is 18/137 substantive
  lines (13.14%), 19.17% comments, 0.61% five-line shingles, longest block 6,
  zero blocks >=8; Scope A NEW is 13/211 (6.16%), 25.58%, 0.00%, 3, zero;
  Scope B new seams is 9/133 (6.77%), 13.33%, 0.00%, 3, zero; Scope C stable
  facades is 4/78 (5.13%), 32.14%, 0.00%, 2, zero. Residual matches are public
  constants/env names, stable facade contracts, and standard Node/OS idioms,
  not unexplained retained private supervision flow.
- **Freeze and validation:** DB 325/325, Graph 488/488, Search 45/45, Context
  108/108, Impact/Affected 6/6, semantic fixtures 6/6, and CLI/MCP smoke 21/21
  pass. TypeScript typecheck and clean production/UI builds pass. The serialized
  23-file lifecycle run passes 276 tests with 14 declared skips; its sole watcher
  cleanup `EPERM` is reproduced unchanged on the exact OLD baseline (35/36 in
  both OLD and NEW), so it is a bounded Windows filesystem-handle artifact, not
  a C06.2 regression. Writer ownership, convergence, daemon, socket, proxy, and
  all other lifecycle results in that run remain healthy.
- **CI and state:** PR #40 final-head cross-platform CI passes 7/7: Linux 2/2,
  macOS 2/2, Windows 2/2, and Rust kernel 1/1. The selected private residual is
  closed, but IND-C06 remains active until separate
  IND-C06.3 lifecycle consolidation proves subsystem-wide `MATERIAL_RESIDUAL = 0`
  and `UNKNOWN = 0`. Do not begin IND-C07 yet.

#### IND-C06.3 — Lifecycle final consolidation and freeze (2026-10-02)

- **Baseline and audit scope:** official baseline
  `e5b0954b63fa8c5e48b0058504d0f0e800c05c86` (PR #40 merged). This gate
  inspected lifecycle ownership under `src/sync/**` and the bounded writer,
  daemon, socket, proxy, client, shutdown, and supervision hosts under
  `src/mcp/**`. General MCP tool/session semantics remain outside IND-C06.
  Current lifecycle production source is unchanged from its accepted C06.1/C06.2
  evidence commits, so no production or permanent test change is justified.
- **Ownership architecture:** filesystem adapters feed `FileWatcher`, which owns
  freshness intake and convergence through `PendingChangeSet`,
  `DebounceScheduler`, and `RetryPolicy`. Atomic writer ownership gates the
  daemon/service. The daemon owns registry, socket, watcher, client sessions,
  and activity timers; each proxy owns one attachment and its daemon-loss
  fallback. Supervision separately owns parent/host health, startup abandonment,
  terminal stdin, and main-loop health. MCP owns wire behavior, not these
  lifecycle decisions. No unexpected cross-layer ownership leak was found.

| Family | Owner | Contract | Ground truth | Mutation | Provenance | Platform | Final classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Watch Event Intake | `FsWatchAdapter`, `watcher-scope.ts`, `FileWatcher` | normalize/filter create, change, delete and scope events | watcher and 87-case sync contract; real `fs.watch` behavior | OLD 20/20, NEW 21/21; utilities 5/5 | Afyx collaborators own intake; residual matches are fs/path idioms | recursive Windows/macOS; per-directory Linux | `CLOSED_AFYX_NATIVE` |
| Pending Change / Debounce | `PendingChangeSet`, `DebounceScheduler` | fold duplicates, preserve arrivals, trailing quick/full windows | boundary, burst, during-sync and stop cases PASS | included in watcher 21/21 and utilities 5/5 | explicit Afyx state owners; no unexplained private flow | equivalent observable scheduling contract | `CLOSED_AFYX_NATIVE` |
| Retry / Convergence | `RetryPolicy`, `FileWatcher.flush` | retain work through lock/generic failure and converge after success | sync contract 87/87; incremental convergence 10/10 | included in watcher/utility campaigns | Afyx retry/convergence policy; Extraction stays frozen | deterministic policy on all OSes | `CLOSED_AFYX_NATIVE` |
| Writer Ownership / Lock | `atomic-lockfile.ts`, `writer-lock.ts` | at most one writer; stale/live/PID-reuse-safe acquire/release | writer 6/6, MCP writer 2/2, daemon election 12/12 | daemon/proxy OLD 24/24, NEW 27/27 | 15/151 substantive (9.93%); no >=8-line block | controlled live child is portable; no PID-1 dependency | `CLOSED_AFYX_NATIVE` |
| Process Supervision / Liveness | supervision policy/runtime and stable facades | parent/host, startup, stdin and wedge supervision | focused 58 PASS plus four legitimate POSIX skips; real children | OLD 23/23; NEW 22/22 applicable plus one equivalent | NEW Scope A 13/211 (6.16%), 0% shingles, longest block 3 | POSIX reparent; Windows parent probe; CI on three OSes | `CLOSED_AFYX_NATIVE` |
| Daemon Startup / Registry / Handshake | `Daemon`, election, manager and registry | cold/concurrent start, identity hello, reuse and stale recovery | MCP daemon 12/12; registry 11/11; PID reuse and attach PASS | daemon/proxy OLD 24/24, NEW 27/27 | 186/503 (36.98%); retained matches are public shapes/messages and API idioms | real Windows plus accepted Linux/macOS CI | `CLOSED_AFYX_NATIVE` |
| Socket Binding / Fallback | `socket-bind.ts`, `daemon-paths.ts`, `Daemon.bindSocket` | ordered candidates, no live endpoint theft, partial/stale cleanup | socket selection/fallback 13 PASS plus six POSIX-only local skips | covered by daemon/proxy 27/27 | included in daemon/path ownership; OS vocabulary is not private flow | named pipe Windows; Unix socket candidates POSIX | `CLOSED_AFYX_NATIVE` |
| Proxy Attach / Client | `proxy.ts`, `client-registry.ts`, `ActivityTimers` | warm attach, multi-client lifetime, dead peer, daemon-loss fallback | daemon 12/12, client-liveness 19/19, attach-log 2/2 | daemon/proxy OLD 24/24, NEW 27/27 | 88/234 (37.61%); 3.28% shingles, two >=8 blocks classified public/facade | same observable lifecycle across all CI OSes | `CLOSED_AFYX_NATIVE` |
| Shutdown / Teardown | bounded stop paths of owners above | idempotent ordered cleanup; forced kill uses stale-owner recovery | stop/failure/disconnect paths in lifecycle selection | covered by all three accepted mutation families | stable terminal contracts span owners; no separate private host | graceful cleanup plus OS-specific crash recovery | `FROZEN_RUNTIME_CONTRACT` |

- **Resource ownership and recovery:**

  | Resource | Owner / creation | Normal and failure cleanup / crash recovery | Evidence |
  | --- | --- | --- | --- |
  | `FSWatcher` handles | `FsWatchAdapter.start` | `FileWatcher.stop` closes adapters; degradation also stops | watcher stop/integration; accepted 40-cycle handle probe |
  | pending state, debounce and retry timers | `FileWatcher` collaborators | stop cancels schedule; failed sync retains pending work; success prunes absorbed generations | sync contract 87/87; convergence 10/10 |
  | writer lock | direct/daemon engine through `writer-lock.ts` | owned release is compare-and-delete; dead/malformed holder recovered atomically | writer and daemon election/PID-reuse tests |
  | registry record and socket/named pipe | `Daemon.start` / bind candidates | `Daemon.stop` removes only owned record/endpoints; stale artifacts recovered next start | registry, bind-failure, fallback and PID-reuse tests |
  | client sessions and activity timers | `Daemon`, `ClientRegistry`, `ActivityTimers` | disconnect/dead-peer/last-client stop paths release sessions and timers | client-liveness and MCP daemon tests |
  | proxy socket and inflight/pending state | one `LocalHandshakeSession` | shutdown destroys attachment; daemon loss replays inflight locally | proxy and MCP daemon-loss tests |
  | PPID/startup/heartbeat timers | supervision facades/runtime | timers are unref'd and cleared on settlement/stop | supervision, startup and watchdog-runtime tests |
  | watchdog child and stdin pipe | `watchdog-runtime.ts` | idempotent stop closes heartbeat/pipe and kills child best-effort | real wedge/healthy tests and runtime ownership tests |
  | stdin terminal listeners | `stdin-teardown.ts` | first terminal event removes all three listeners before destruction/callback | stdin tests including socket-backed failure |
  | forced-kill remnants | operating system plus next launcher | no graceful callback assumed; stale lock/registry/socket ownership is recovered on next start | stale/PID-reuse/crash-recovery tests |

- **Final invariants:** cold, concurrent, live, stale, dead-owner,
  PID-reuse-sensitive, reentrant, release, and crash-recovery paths preserve
  `COMPETING_WRITER = 0`. Create/change/delete, duplicate/burst, debounce,
  during-sync, retry, failure-then-success, full-scan, and stop paths preserve
  `LOST_EVENT = 0` and `STALE_FINAL_INDEX = 0`. Supervision preserves healthy
  processes, parent/host detection, startup reaping, single terminal settlement,
  allocating/non-allocating wedge termination, progress deferral, hard cap, and
  idempotent stop with `ORPHAN_PROCESS = 0`. Socket evidence gives
  `SOCKET_LEAK = 0`. Observable persistent timer, listener, handle, and orphan
  child growth are all zero.
- **Windows watcher artifact:** current baseline again produced 35/36 in
  `watcher.test.ts`; the only failure is `fs.rmSync` receiving `EPERM` while
  deleting the temporary real-watch directory. This exactly matches accepted
  OLD and NEW evidence, while sync contract 87/87 and final convergence 10/10
  pass. It does not affect convergence, writer ownership, cleanup contracts, or
  production semantics. Disposition: `KNOWN_NON_REGRESSION_TEST_ARTIFACT`.
- **Mutation consolidation:** watcher OLD 20/20, NEW 21/21, utilities 5/5;
  daemon/proxy OLD 24/24 and NEW 27/27; supervision OLD 23/23 applicable and NEW
  22/22 applicable with one equivalent, zero meaningful survivors. Current
  source is unchanged from those campaigns; meaningful unexplained mutation
  survivors remain zero, so no audit-only mutations were fabricated.
- **Provenance consolidation:** historical reference remains
  `b7a1aa2718dc1f6940e483043733f67020d9a62f`. Watcher is 215/548 substantive
  overlap (39.23%), 43.11% comments, 11.76% shingles, longest block 28, 12
  blocks >=8; Writer/Lock 15/151 (9.93%), 23.68%, 0.45%, 6/0; Daemon 186/503
  (36.98%), 23.24%, 5.74%, 12/7; current supervision 13/211 (6.16%), 25.58%,
  0%, 3/0; Proxy 88/234 (37.61%), 19.30%, 3.28%, 8/2. Git history, explicit
  state owners, call boundaries, mutation, and runtime tests classify remaining
  matches as public shapes/messages, paths/env names, stable contracts, or
  standard Node/OS filesystem/process/socket idioms. This technical evidence
  establishes `MATERIAL_UNEXPLAINED_PRIVATE_LIFECYCLE_RESIDUAL = 0`; it is not
  a legal conclusion.
- **Performance consolidation:** accepted medians are watcher 100 events
  13.060 ms, 1,000 events 134.777 ms, daemon cold start 376.940 ms, warm attach
  13.392 ms, second attach 1.123 ms, shutdown 7.074 ms, watchdog arm/stop about
  31 ms, and wedge detection about 460 ms. Current sanity runs retain the
  watcher digest `d0bca111f862` and measured 6.468 ms / 56.538 ms; daemon cold
  start 384.952 ms, warm attach 13.822 ms, second attach 1.201 ms, and shutdown
  7.250 ms. Absolute deltas are small or improved, with no leak signal:
  `MATERIAL_PERFORMANCE_REGRESSION = 0`.
- **Regression and downstream freeze:** the exact serialized 23-file lifecycle
  selection records 276 PASS, 14 declared platform skips, one known EPERM
  artifact, and `NEW_UNEXPLAINED_LIFECYCLE_FAILURE = 0`; the additional daemon
  attach gate passes 2/2. DB 325/325, Graph 488/488, Search 45/45, Context
  108/108, Impact/Affected 6/6, semantic fixtures 6/6, and CLI/MCP smoke 21/21
  pass. TypeScript typecheck, clean production build, and clean UI build pass.
  PR #41 cross-platform evidence passes 7/7: general CI Linux/macOS/Windows
  3/3 and manually dispatched Graph Build Linux/macOS/Windows/Rust 4/4.
- **Decision and state:** Path A. `MATERIAL_RESIDUAL_REQUIRES_CLOSURE = 0` and
  `UNKNOWN_REQUIRES_EVIDENCE = 0`. `COMPETING_WRITER`, `LOST_EVENT`,
  `STALE_FINAL_INDEX`, `ORPHAN_PROCESS`, and `SOCKET_LEAK` are all zero. Final
  classification: `LIFECYCLE_FINAL_CONSOLIDATION_COMPLETE`.

  **IND-C06 Watcher / Daemon / Proxy Lifecycle: COMPLETE AND FROZEN.**

  Exact next phase is **IND-C07 — MCP / CLI Adapter Internals**. It is not
  started by this consolidation task.

### IND-C07 — MCP and CLI adapter internals

- **Scope/ownership:** split private implementation from frozen tool/command/
  wire contracts; use public `AfyxGraph` APIs and existing native registry/result
  seams.
- **Evidence:** CLI/MCP focused tests, semantic/smoke, acceptance, controlled
  payload and latency baselines.
- **Mutation/differential:** dispatch, validation, error/result mapping,
  availability and truncation mutants; JSON/MCP semantic comparison.
- **Performance:** startup, initialize, tools/list, first and repeated calls,
  payload bytes and RSS.
- **Expected files:** begin with one bounded MCP tool family or CLI command
  group; never rewrite `tools.ts` and CLI monolith together.
- **Frozen/stop:** public names/schema/output, domain semantics and UI peer
  boundary; stop on agent compatibility or startup/payload regression.

#### IND-C07.1 — MCP / CLI adapter inventory and first-slice selection (2026-10-02)

- **Baseline and method:** official baseline
  `a57d2cd4d57aefac5ecf9bd0548d27d81f291c0f`; inventory was performed on
  `afyx/ind-c07-adapter-inventory`. Afyx Graph topology, source-region review,
  history, accepted OLD/NEW mutation artifacts, semantic/smoke tests, a frozen
  scratch copy of the repository index, and established Phase 3B normalization
  against `b7a1aa2718dc1f6940e483043733f67020d9a62f` were used. Similarity is a
  risk signal only, never a rewrite criterion.
- **Frozen public MCP contract:** ordered names remain `afyx_graph_search`,
  `afyx_graph_callers`, `afyx_graph_callees`, `afyx_graph_impact`,
  `afyx_graph_node`, `afyx_graph_explore`, `afyx_graph_status`, and
  `afyx_graph_files`; catalog SHA-256 remains
  `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`.
  `initialize`, protocol negotiation, `serverInfo`, `{ tools: {} }`,
  `tools/list`, `tools/call`, `ping`, empty resources/prompts probes, tool
  schemas/order/annotations, `AFYX_GRAPH_MCP_TOOLS`, project-path behavior,
  JSON-RPC error codes/messages, and established `ToolResult` shapes/wording
  are frozen.
- **Frozen public CLI contract:** canonical order remains `init`, `uninit`,
  `index`, `sync`, `status`, `query`, `explore`, `context`, `prompt-hook`,
  `node`, `files`, `daemon`, `ui`, `serve`, `unlock`, `callers`, `callees`,
  `impact`, `affected`, `install`, `uninstall`, `upgrade`, `version`; aliases
  remain `daemon -> daemons` and `ui -> web`; `prompt-hook` and `serve` remain
  hidden. Root-help SHA-256 is
  `c37f1c94b207601e524ee591056da18238df1e5b7cc2b1e55eab0a015db23168`
  and query-help SHA-256 is
  `0ce2d5d2c93401f903871589a0db50b588e969524eb405253488bc81618b8bcd`.
  Names/options/help, ordering, aliases, hidden state, stdout/stderr, JSON
  purity, exit codes, color handling, and stdin behavior are frozen.

**MCP ownership and classification**

| Family / region | Owner and approximate lines | Classification | Evidence / boundary |
| --- | --- | --- | --- |
| Catalog declarations | `tools.ts:1091-1438` | `FROZEN_PUBLIC_CONTRACT` | Semantic digest freezes names, schema, descriptions, annotations, metadata and default exposure. |
| Registry/allowlist seam | `tool-registry.ts:4-125` | `CLOSED_AFYX_NATIVE` | Afyx-native commit `3e0a03e`; public name to private route, parsing, ordering, allowlist and project-path schema transform are explicit. |
| Dispatch and cross-cutting validation | `ToolHandler.execute`, `executeReadTool`, `dispatchTool` (`tools.ts:2072-2248`) | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | Owns private gate/allowlist/path validation, status exception, pool selection, route switch, failure classification and notices. |
| Result primitives | `tool-results.ts:5-37` | `CLOSED_AFYX_NATIVE` | Afyx-native result/error seam; not-indexed guidance, path refusal and internal failure are distinct. Public result wording remains frozen. |
| Tool-specific result assembly | handler/formatter regions in `tools.ts:2253-3208,6058-6991` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | Validation, domain-call orchestration, text assembly, truncation and availability are still coupled in the host. |
| Search/relationship/node/status/files adapters | `handleSearch`, `handleCallers`, `handleCallees`, `handleImpact`, `handleNode`, `handleStatus`, `handleFiles` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | Domain algorithms stay frozen; only MCP-specific validation/orchestration/presentation is C07-owned. |
| Explore adapter | `tools.ts:162-1090,2526-6049` plus `explore-*` and `dynamic-boundaries.ts` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | Adapter budgeting, allocation, dedup, diagnostics, session emission and bounded presentation remain material; Search/Context/Graph/Impact semantics are frozen. Not selected first. |
| Session dispatch | `session.ts:85-324` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | Wire behavior is frozen; private method switch, initialization/roots control flow and tools-call bridging remain implementation. |
| Transport | `transport.ts:23-89` public shapes; `90-246` line transport; `272-436` stdio/socket | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | JSON-RPC shapes/error codes are frozen; private parsing/request correlation remains C07. Socket lifecycle is C06-frozen and outside the future slice. |
| Engine/project selection | `engine.ts:64-297` selection/handler ownership; `298-412` watcher/catch-up | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | Selection/retry/handler ownership is adapter logic; indexing, watcher, locks and catch-up lifecycle are frozen/outside. |
| Query pool/worker | `query-pool.ts`, `query-worker.ts` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | MCP read-dispatch performance infrastructure owns queue, scaling, retry/backstop and result transport. It must follow, not precede, a stable dispatch seam. |
| Instructions/version | `server-instructions.ts`, `version.ts` | `FROZEN_PUBLIC_CONTRACT` | Public behavior-defining data/constants; no implementation rewrite is justified. |

The MCP call path is `MCPSession.handleToolsCall -> ToolHandler.execute ->
QueryPool.run or executeReadTool -> dispatchTool -> one domain-facing handler ->
AfyxGraph API -> ToolResult -> transport.sendResult`. The session owns JSON-RPC
and per-session Explore state; the handler owns MCP validation and presentation;
the domain APIs retain Search, Context, Graph, Impact and DB semantics.

**CLI ownership and classification**

| Family / region | Owner and approximate lines | Classification | Evidence / boundary |
| --- | --- | --- | --- |
| Registry/invocation | `cli-registry.ts:3-86` | `CLOSED_AFYX_NATIVE` | Afyx-native commit `0f06c33`; canonical metadata, aliases, hidden commands, version/color preprocessing and Commander catalog assertion. |
| Project/index group | `afyx-graph.ts:599-1039` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | `init/uninit/index/sync/status` retain CLI orchestration; indexing and DB semantics are frozen. |
| Query/intelligence group | `afyx-graph.ts:1042-1676,2017-2346` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | `query/explore/context/node/files/callers/callees/impact/affected` retain command validation, domain routing and output mapping; domain semantics are frozen. |
| Service group | `afyx-graph.ts:1678-1752,1909-2024` | `OUTSIDE_IND_C07` | `daemon/serve/unlock` lifecycle is IND-C06 complete/frozen; only its public CLI surface is frozen here. |
| UI command | `afyx-graph.ts:1754-1908` | `OUTSIDE_IND_C07` | UI semantics are outside C07; command/help/exit contract is frozen. |
| Installer group | `afyx-graph.ts:2348-2496` and `uninstall.ts` | `OUTSIDE_IND_C07` | Thin CLI contract is frozen; provider/installer implementation belongs to IND-C10. |
| Utility group | `prompt-hook`, `version`, invocation setup | `FROZEN_PUBLIC_CONTRACT` | Stable integration/version behavior; registry is already Afyx-native. |
| Result/error mapping | command actions in `afyx-graph.ts`; `cli-presentation.ts` | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` | Host still owns JSON/human/quiet, exit and exception mapping. IND-C01 presentation primitives remain complete/frozen and must be reused. |
| Runtime helpers | `cli-path.ts`, `cli-presentation.ts`, `command-supervision.ts`, `fatal-handler.ts`, `node-version-check.ts` | `OUTSIDE_IND_C07` | `cli-path.ts` is a small Afyx-native seam; presentation is C01, packaging prerequisite is C02, and supervision/liveness is C06. |

CLI call paths remain command-specific: Commander registration uses
`cli-registry.ts`, each action resolves a project and calls the relevant public
`AfyxGraph`/domain API, then maps the result to CLI-only human/JSON/quiet output.
No universal MCP/CLI adapter is justified: sharing stops at domain APIs and
genuinely identical primitives.

**Ground truth, mutation and real-repository evidence**

| Family | Contract / test | Strength | Remaining gap |
| --- | --- | --- | --- |
| MCP catalog/session/errors | `mcp-semantic-contract` 8/8; tool allowlist, annotations, path requirement, unindexed behavior, roots/init tests | Strong contract plus subprocess coverage | Three subprocess groups complete assertions but Windows teardown can report `EPERM` while deleting a just-killed child cwd; CI remains the platform authority. |
| CLI catalog/help/JSON/errors | `cli-semantic-contract` 9/9 plus focused query/context/node/affected/color/truncation 23/23 | Strong process-level contract | Future slices need family-specific mutation reruns. |
| All exposed adapters | `smoke-cli-mcp.mjs` 21/21 | Strong end-to-end smoke for all eight MCP tools and representative CLI | Fixture-sized, not a throughput claim. |
| Domain freezes | semantic baseline 6/6; Search/Context/Graph/Impact/query-pool 435/435; DB 295/295; watcher/writer-lock 42/42, proxy 3 platform-skipped | Strong frozen boundary evidence | No domain behavior may be changed by C07. |

Accepted mutation evidence is sufficient for selection: MCP OLD 16/16 and NEW
16/16 catch catalog/schema/annotation/default-surface/allowlist/project-path,
wrong route, argument normalization, unknown tool/method, `isError`, not-indexed
and generic failure mutations. CLI OLD 16/16 and NEW 16/16 catch catalog,
aliases/hidden state, version, required arguments, stdout/stderr, numeric exits,
JSON pollution, path/stdin/color/default/result formatting and wrong query route.
No new mutation was needed for this inventory; the selected slice must rerun and
extend the dispatch-specific set if its final boundary introduces an uncovered
branch.

A scratch-only copy of the current repository and its index produced exit zero
for `status`, `query`, `explore`, `context`, `callers`, `callees`, `impact`,
`affected`, `node`, and `files`. Their normalized payload sizes were respectively
1,234; 3,936; 25,117; 15,660; 2,601; 3,411; 43,659; 14,274; 840; and 2,156
bytes, with SHA-256 captured during the run. Benchmark and current-head
provenance artifacts are under
`%LOCALAPPDATA%\Temp\afyx-ind-c07-inventory-20261002`. This is adapter evidence,
not a new semantic oracle. MCP all-tool behavior is separately proven by the
21-check isolated smoke; the controlled benchmark used
`AFYX_GRAPH_MCP_TOOLS=explore,search,status`.

**Current performance and provenance**

- MCP, five current-state rounds on an isolated indexed fixture: lifecycle
  median 1,277.18 ms (nearest-rank p95 1,279.22); initialize 475.64/483.52;
  controlled three-tool `tools/list` 528.56/532.52; first search
  238.97/253.85; repeated search 1.18/1.25 ms. Payloads: initialize 6,664,
  controlled `tools/list` 3,074, valid/repeated result 180, invalid tool 93,
  invalid arguments 127 bytes. The 3,074-byte number is not the full eight-tool
  catalog. RSS was not exposed by the existing harness.
- CLI, five current-state rounds: help median/p95 153.70/188.75 ms, version
  143.68/154.19, indexed query 490.70/504.69. Scratch real-repository one-shot
  runs separate process/adapter/domain cost rather than attributing the total to
  adapters: status 1,999.4, query 630.1, explore 1,177.7, context 833.1 ms.
- Established MCP normalization: whole relevant scope (`tools.ts`, `session.ts`,
  `tool-registry.ts`, `tool-results.ts`) is 2,584/2,795 substantive lines
  (92.45%), 95.52% comments, 84.35% five-line shingles, longest block 910,
  110 blocks >=8. New native registry/result modules are 6/79 (7.59%), 0%
  comments, 0.72% shingles, no >=8 block. Legacy mixed hosts are 2,578/2,716
  (94.92%), 96.14% comments, 86.08% shingles, longest 910, 110 blocks >=8.
- Established CLI normalization: whole relevant scope is 986/1,297
  substantive lines (76.02%), 83.33% comments, 58.43% shingles, longest 95,
  80 blocks >=8. Native registry/path/presentation modules are 16/122 (13.11%),
  14.29% comments, 2.25% shingles, no >=8 block. Legacy mixed hosts are
  970/1,175 (82.55%), 84.24% comments, 62.47% shingles, longest 95, 80 blocks
  >=8. Matches include frozen contract/schema/domain vocabulary, standard
  Commander/JSON-RPC/Node idioms, and retained private orchestration; this is
  technical provenance evidence, not a legal conclusion.

**Decision and dependency order**

- Region-level inventory finds **11 material residual families** and **zero
  unknowns**. Mixed hosts are intentionally not assigned one file-wide label.
- Dependency order is: (1) MCP read-tool dispatch/failure seam; (2) MCP
  tool-specific result assembly and thin domain adapters; (3) session dispatch;
  (4) transport, project selection, and pool/worker in independently bounded
  slices; (5) Explore adapter policy; then (6) CLI project/index,
  query/intelligence, and result/error families as separate slices. Frozen
  domains and C01-C06 remain outside every step.
- **Selected first family:** `MCP Read-Tool Dispatch / Failure Adapter`, limited
  to `ToolHandler.executeReadTool` and `ToolHandler.dispatchTool`
  (`tools.ts:2223-2248`) and their consumption of the already-native
  `resolveToolRoute` / `classifyToolFailure` seams. Expected future seam:
  `src/mcp/tool-dispatch.ts`, with explicit route-to-handler dependencies;
  downstream consumers are `ToolHandler.execute` and `query-worker.ts`.
  `ToolHandler.execute`, per-tool handlers, Explore, session/transport, pool,
  CLI, and every domain API are excluded from that first implementation slice.
- Selection reason: retained private control flow is directly evidenced; it is
  lower than session/pool/tool families, bounded to two symbols, covered by
  wrong-route/unknown-tool/failure-shape mutations, and permits extraction
  without changing any public schema, name, ordering, result wording,
  availability, lifecycle or domain semantics.
- Decision path is **Path C** (multiple residuals, one dependency-safe first
  slice selected). Final classification is
  `MCP_CLI_ADAPTER_RESIDUAL_SELECTED`. IND-C07 remains **ACTIVE**. Exact next
  phase: **Phase 3B.12C.7.2 — MCP Read-Tool Dispatch / Failure Adapter Residual
  Closure**. Do not begin IND-C08.

#### IND-C07.2 — MCP read-tool dispatch / failure adapter closure (2026-10-02)

- **Baseline and selected residual:** official baseline
  `589c376f6152154004f75169557af9a6cc5b4fd7` (merged PR #42). The selected
  private implementation was limited to `ToolHandler.executeReadTool` and its
  former `dispatchTool` switch. `ToolHandler.execute`, the eight per-tool
  handlers, QueryPool/worker protocol, session, transport, CLI, Explore policy,
  and domain algorithms remained frozen.
- **OLD architecture and ground truth:** `executeReadTool` caught failures around
  a private route switch in `tools.ts`; that switch used the existing native
  `resolveToolRoute` seam, invoked one of seven host handlers, and returned the
  established unknown-tool result. A direct OLD contract passed 13/13; the
  combined dispatch/MCP semantic/allowlist/query-pool selection passed 41/41;
  CLI/MCP smoke passed 21/21. The focused OLD mutation campaign killed all
  13/13 applicable semantic mutants with zero survivors, invalids, or
  equivalents. Mutants covered wrong routes, status acceptance, unknown-route
  success/throw behavior, classifier bypass/leak, and all retained failure
  classes.
- **Afyx-native seam:** new private `src/mcp/tool-dispatch.ts` owns only public
  tool-name resolution, explicit injected handler selection, status exclusion,
  unknown-route result construction through `errorToolResult`, and thrown
  failure classification through `classifyToolFailure`. It imports no
  `ToolHandler`, graph, pool, session, transport, or domain implementation.
  `ToolHandler.executeReadTool` is now a thin stable facade over one explicit
  seven-handler dependency map; `query-worker.ts` required no change.
- **NEW ground truth and mutation:** the direct seam/facade contract passes
  21/21, covering all seven routes, status exclusion, unknown names, argument
  and result identity, `NotIndexedError`, `PathRefusalError`, generic `Error`,
  non-Error throws, and never-throw facade behavior. The NEW focused mutation
  campaign also killed 13/13 applicable mutants with zero survivors, invalids,
  or equivalents; semantic sensitivity is equal to OLD.
- **Controlled differential and worker boundary:** OLD and NEW route/failure
  matrices serialize to the same 2,170 bytes and SHA-256
  `a7b6a48446d3c4dbb9cb973433ae1d799c7986e0f755f084b4c93a25d0797c50`;
  every result, selected handler, call count, forwarded argument, and throw
  boundary is identical (`UNEXPLAINED = 0`). A real built worker against a
  temporary indexed fixture reached ready state and matched in-process search
  and unknown-tool results exactly. Raw worker/in-process parity therefore
  passes without protocol or scheduling changes.
- **Performance and payload:** twelve interleaved 50,000-call samples measured
  OLD/NEW pure success medians of 0.187176/0.158638 microseconds, classified
  failure medians of 1.172170/1.053668 microseconds, and unknown-route medians
  of 0.135480/0.122068 microseconds. Deltas are respectively -0.028538,
  -0.118502, and -0.013412 microseconds; percentage changes at this scale are
  not treated as throughput claims. Five controlled MCP rounds measured OLD/NEW
  repeated-search medians of 1.1011/1.0983 ms (p95 1.1160/1.1448 ms): no
  material adapter regression. Initialize (6,664), controlled three-tool
  `tools/list` (3,074), successful search (180), unknown tool (93), invalid
  arguments (127), and repeated result (180) payload bytes are identical. The
  3,074-byte value remains explicitly a controlled
  `AFYX_GRAPH_MCP_TOOLS=explore,search,status` surface, not the full catalog.
- **Provenance:** established normalization against
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` reports Scope A, the OLD selected
  dispatch/failure region: 4/13 substantive lines (30.77%), 3/4 comments
  (75%), 0% five-line shingles, longest block 4, zero blocks >=8. Scope B, the
  new native seam: 0/18 substantive (0%), 0/5 comments, 0% shingles, longest
  block 2, zero blocks >=8. Scope C, the remaining dependency map/thin facade:
  1/10 substantive (10%), no comments, 0% shingles, longest block 1, zero
  blocks >=8. Residual matches are public terminology and standard async/switch
  idioms; material unexplained retained private dispatch implementation is
  zero. This is technical provenance evidence, not a legal conclusion.
- **Freeze gates:** focused MCP/query-pool coverage passes 84 with one skipped;
  Explore passes 92/92; semantic fixtures 6/6; CLI/MCP smoke 21/21; Search,
  Context, Graph, Impact/Affected and QueryPool pass 435/435; DB 295/295;
  watcher/writer-lock lifecycle 42/42; CLI semantic contract 9/9; extraction
  ground truth 5/5; resolution ground truth 13/13; provider/installer and CLI
  install 244 with three skipped; UI entry/CLI UI 34 with one skipped.
  TypeScript typecheck and clean production/UI builds pass. Catalog SHA-256
  remains `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`;
  names, order, schemas, annotations, session/transport behavior, allowlist,
  QueryPool, Explore, CLI, and C01-C06 behavior remain unchanged. PR #43
  cross-platform CI passes all seven Linux, macOS, Windows, and Rust-kernel
  jobs; one Linux runner OOM/timing failure passed on its unchanged-head rerun.
- **Evidence location and state:** scratch-only mutation, differential,
  worker-parity, performance, payload, and provenance artifacts are under
  `%LOCALAPPDATA%\Temp\afyx-ind-c07r2-20261002` and are excluded from the PR.
  This slice closes one of the 11 C07 material families: **10 material
  residuals remain, with `UNKNOWN = 0`**. Current dependencies select MCP
  tool-specific result assembly / thin domain adapters as the next planning
  family because they consume this stable dispatch seam and precede session,
  transport, pool/worker, and Explore-policy closure. Exact next phase is
  **Phase 3B.12C.7.3 — MCP Tool-Specific Result Assembly / Thin Domain Adapter
  Inventory and First-Slice Selection**. It is not started here; IND-C07
  remains active and IND-C08 remains blocked on its completion.

#### IND-C07.3 — MCP tool-specific result assembly / thin domain adapter inventory and first-slice selection (2026-10-02)

- **Baseline and method:** official baseline
  `736d57b05b9c01f2041be63b0a80d88c21d83498` (merged PR #43). The audit
  inspected the post-C07.2 call path `ToolHandler.execute -> QueryPool or
  executeReadTool -> dispatchReadTool -> injected ToolHandler adapter -> public
  AfyxGraph/domain API -> ToolResult`. Source regions, focused tests, history,
  controlled fixtures, a fresh 971-file repository index, focused mutation,
  and established provenance normalization against
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` were used. Similarity remained a
  risk signal only. No production implementation changed.
- **C07.2 freeze:** `tool-dispatch.ts`, `executeReadTool`, all seven read routes,
  status exclusion, failure classification, QueryPool/worker parity, and the
  eight-tool catalog remain frozen. Catalog SHA-256 remains
  `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`.

**Region ownership and classification**

| Family / current region | Adapter-owned behavior | Frozen dependency / boundary | Classification |
| --- | --- | --- | --- |
| Search — `handleSearch` (`tools.ts:2241-2275`), `formatSearchResults` (`6846-6860`) | Query/kind/limit adaptation, advertised `type -> type_alias`, generated-vs-handwritten presentation order, empty result, compact formatting, bounding and ToolResult assembly | `searchNodes` ranking and `generatedFilePredicate` are frozen Search/domain APIs; applying their facts to MCP ordering is a public adapter contract | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
| Callers — `handleCallers` (`2301-2377`) | Validation, file-narrow fallback note, relationship aggregation/deduplication/labels, limit markers, per-definition presentation and result assembly | `findAllSymbols`/`groupDefinitions` are frozen named-flow/symbol-lookup semantics; `getCallers` is frozen Graph | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
| Callees — `handleCallees` (`2382-2455`) | Direction-specific aggregation, deduplication, labels, limits, grouped output and result assembly | Same frozen lookup/grouping boundary; `getCallees` is frozen Graph | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
| Impact — `handleImpact` (`2460-2501`), `formatImpact` (`6893-6919`) | Validation/depth adaptation, file-narrow notes, per-definition blast-radius selection, formatting, bounding and result assembly | `findAllSymbols`, `groupDefinitions`, and `mergeSymbolImpact` own frozen Resolution/Graph/Impact semantics | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
| Node — `handleNode` and file/body renderers (`6046-6433`), lookup facade (`6754-6818`), detail/outline formatters (`6921-6971`) | MCP mode selection, file/line hints, ambiguity/body budget, file-view safety presentation, stale result selection, structural outline/detail/trail assembly and bounding | `matchesSymbol`, name lookup, generated detection, graph children/trails, path containment and code retrieval remain frozen Graph/Resolution/DB/security dependencies | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE`; mixed region, no domain move authorized |
| Files — `handleFiles`, glob and formatters (`6550-6744`) | Path/glob normalization, format selection, metadata/maxDepth, deterministic presentation, empty/no-match result and bounding | `getFiles` is the frozen DB/domain boundary | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
| Status — `handleStatus` (`6434-6545`) | Main-thread result selection and health-section assembly | Stats, WAL, pending references, watcher/degraded state, pending sync, writer lock and worktree detection are C04/C06/domain dependencies; status stays outside read dispatch | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
| Shared result primitives — `textResult`/`errorResult` (`6973-6979`) | Thin delegation only | `tool-results.ts` owns Afyx-native shape/failure semantics; exact text and `isError` are public | `CLOSED_AFYX_NATIVE` with `FROZEN_PUBLIC_CONTRACT` output |
| Shared bound — `MAX_OUTPUT_LENGTH` (`113`), `truncateOutput` (`6834-6840`) | 15,000-character cap, clean-newline preference, exact truncation marker, identity below cap | No domain state; consumed by Search, relationship, Impact, Node and Files adapters | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE` |
| Family presentation helpers — `definitionHeading`, `formatSearchResults`, `formatNodeList`, `edgeLabel`, `formatImpact`, Node and Files formatters | Family-specific selection/presentation control flow | Public wording/order is frozen; domain facts remain external | Counted with their owning material family, not as a synthetic framework |
| Explore — `handleExplore` and supporting policy (`tools.ts:162-1090,2503-6041`) | Budget/allocation, deduplication, diagnostics, dynamic boundaries, source selection, session emission and bounded presentation | Search/Context/Graph/Impact remain frozen; session owns per-client state | `MATERIAL_RESIDUAL_REQUIRES_CLOSURE`, deliberately not selected |

Callers and Callees remain separately classified and directionally tested, but
count as one **relationship-adapter residual family**: they have the same
lookup/grouping dependencies, output contract shape, downstream consumer,
failure boundary and mutation strategy. Any future shared seam must keep the
direction explicit; swapping callers/callees remains a required mutant.

**Public and domain boundaries**

- Frozen public results include all tool names/order/schemas/annotations,
  ToolResult/isError shapes, empty/not-found wording, definition grouping,
  relationship labels, deterministic order, limit/truncation markers, Node
  ambiguity/file-view text, Files modes and Status sections. Textual matches in
  these public contracts are not private residuals.
- Search ranking, named-symbol flow, definition grouping, Graph traversal,
  Impact calculation, generated-file detection, Context, DB readers, path
  security, WAL, worktree detection and lifecycle state are
  `DOMAIN_SEMANTIC_DEPENDENCY` or frozen C01-C06 behavior. The inventory found
  no adapter closure that requires changing them.

**Ground truth and test/evidence matrix**

| Family | Accepted cases captured | Durable evidence / remaining future-slice need |
| --- | --- | --- |
| Search | Normal/empty, kind filter, `type -> type_alias`, limits 1/100, handwritten before generated, explicit `projectPath`, oversized output | MCP semantic/input/security/search freeze tests plus scratch matrix; a Search slice should make type mapping and generated ordering direct durable contracts |
| Callers / Callees | Missing, one definition, overloads, distinct definitions, file hit/miss fallback, empty relationships, deduplication, labels, cap marker and stable output | Same-name, truncation, no-silent-fuzzy, symbol-lookup and smoke tests are strong; direction swap/dedup/file-fallback mutants remain required for that slice |
| Impact | Missing, one/multiple definitions, file narrowing, depth clamp 1/10, stable per-definition order and bounded output | Impact contract and same-name tests plus scratch matrix; future slice must mutate depth/file/group roots without changing `mergeSymbolImpact` |
| Node | Exact/qualified/ambiguous, file+line narrowing, handwritten preference, container outline, body/source numbering, file view and not-found | Symbol lookup, file-view, stale-slice, secret-redaction and security tests are strong; frozen Resolution behavior must remain outside a Node slice |
| Files | Empty/no-match, root variants, Windows separators, prefix, glob, flat/grouped/tree, metadata on/off, maxDepth and deterministic sorting | Path-normalization and input-limit tests plus scratch matrix; format/glob/metadata/maxDepth mutation must accompany a Files slice |
| Status | Healthy WAL, non-WAL warning, pending resolution, degraded watcher and pending sync | Status/staleness/worktree, DB and lifecycle tests cover the state providers; future Status work is presentation-only and main-thread-only |

The focused affected selection passes **199 with 2 platform/dependency skips**
across 12 files. It includes MCP semantic, dispatch, input limits, Search
validation/truncation, callers/callees grouping and caps, Impact grouping, Node
lookup/file view, Files path normalization, Status degraded/pending state and
security. Domain freeze evidence separately passes Search/Context/Graph/
Impact/QueryPool **435/435**, DB **295/295**, and lifecycle **93/93**.

**Mutation evidence**

- Accepted C07.1 MCP/CLI semantic campaigns remain 16/16 OLD and 16/16 NEW;
  C07.2 focused dispatch remains 13/13 OLD and 13/13 NEW.
- A scratch-only shared-bound campaign first found one meaningful survivor:
  forcing a raw 15,000-character cut passed because the existing line-boundary
  assertion was tautological. The durable assertion was corrected to require a
  complete final source line. The same campaign then killed **5/5** applicable
  mutants with zero survivors/invalids: bound bypass, marker removal, cap
  increase, short-input truncation and clean-newline bypass. This changes test
  evidence only, not production behavior.

**Controlled repository, payload and performance evidence**

- A fresh scratch archive of this baseline indexed **971 files, 24,460 nodes
  and 78,105 edges**. Search, Callers, Callees, Impact, Node, Files and Status
  all returned non-error results; normalized output order and SHA-256 were
  recorded. Representative payloads were respectively 982, 311, 508, 397,
  1,281, 1,654 and 874 bytes. These are selected controlled calls, not a claim
  about every MCP payload.
- On a 5-file/25-node fixture, 25 warm in-process samples gave median/p95:
  Search 0.5801/0.7332 ms; Callers 0.0778/0.1293; Callees 0.0690/0.1540;
  Impact 0.0978/0.2326; Node 1.7454/2.2200; Files 0.0393/0.0474. The shared
  bound reduced a 36,489-byte controlled string to 14,980 bytes with the exact
  marker and complete-line cut. This is a baseline only, with no OLD/NEW claim.
- Five real-repository calls per family gave warm medians: Search 8.2082 ms,
  Callers 0.2008, Callees 0.1596, Impact 0.2177, Node 0.8104, Files 1.8771 and
  Status 3.9763. Nearest-rank p95 includes each first cold call and is retained
  in scratch evidence rather than presented as adapter-only cost.

**Provenance by current family scope**

Established normalization reports current region vs the full historical
`tools.ts` reference:

| Scope | Substantive overlap | Comment overlap | Five-line shingles | Longest block | Blocks >=8 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Search | 26/27 (96.30%) | 7/7 (100%) | 79.49% | 30 | 2 |
| Callers | 68/70 (97.14%) | 18/20 (90%) | 81.36% | 72 | 3 |
| Callees | 68/70 (97.14%) | 15/16 (93.75%) | 82.14% | 69 | 3 |
| Callers+Callees combined | 114/117 (97.44%) | 23/26 (88.46%) | 83.43% | 74 | 4 |
| Impact | 44/47 (93.62%) | 10/11 (90.91%) | 67.11% | 27 | 4 |
| Node | 211/225 (93.78%) | 104/113 (92.04%) | 75.54% | 58 | 15 |
| Files | 90/92 (97.83%) | 15/15 (100%) | 95.62% | 182 | 2 |
| Status | 43/46 (93.48%) | 27/27 (100%) | 84.54% | 48 | 4 |
| Shared result/bound helpers | 8/10 (80%) | 1/1 (100%) | 50% | 10 | 1 |

History corroborates retained implementation ownership: the historical
reference still owns 34/35 Search, 76/77 Callers, 73/74 Callees, 40/42 Impact,
369/388 Node, 193/195 Files, 109/112 Status and 10/10 bound-helper lines by
blame. Classification nevertheless follows private control flow and ownership,
not these percentages. Public vocabulary, headings, domain terms and standard
TypeScript idioms remain legitimate matches; this is technical provenance, not
a legal conclusion.

**Recalculated residuals, dependency order and selected slice**

- The former count of 10 used two broad overlapping buckets for tool-specific
  result assembly and named adapters. This inventory replaces them with seven
  non-overlapping material families: shared bound, Search, relationship
  (Callers+Callees), Impact, Node, Files and Status. Adding Explore; later MCP
  session, transport, engine/project selection and pool/worker; and the three
  CLI project/index, query/intelligence and result/error families yields
  **15 remaining C07 material residual families**. `UNKNOWN = 0`.
- Dependency order is: **shared bounded-output seam -> Search and Files thin
  adapters -> relationship adapter -> Impact -> Node -> Status -> Explore ->
  session -> transport / engine selection / pool-worker in bounded slices ->
  CLI project/index, query/intelligence and result/error slices**. Actual
  evidence must be re-evaluated after every closure.
- **Selected first family:** shared MCP bounded-output seam, limited to
  `MAX_OUTPUT_LENGTH`, `ToolHandler.truncateOutput` and its existing call sites.
  Frozen contract: unchanged short strings; 15,000-character source cap;
  prefer the last newline only when it lies beyond 80% of the cap; exact
  `\n\n... (output truncated)` marker; unchanged ToolResult shape and all
  family-specific formatting. It has no domain, session, transport, pool,
  lifecycle or CLI ownership.
- Expected future seam: a small Afyx-owned private module such as
  `src/mcp/tool-output.ts` exporting one bounded-output operation. Expected
  production scope is that module plus mechanical consumption from `tools.ts`
  and a focused direct contract test. It must not absorb family formatters,
  ToolResult primitives, Node's separate 38k file-view pagination, or Explore
  policy.
- Selection reason: this is the lowest shared dependency, the smallest retained
  private control-flow region, independently testable, mutation-sensitive 5/5,
  and prerequisite to moving six adapter families without duplicating output
  policy. Search/Files are deferred until this common boundary is stable.
- Decision path is **Path C**: multiple material families, exactly one
  dependency-safe implementation slice selected and not implemented. Final
  classification is `MCP_TOOL_ADAPTER_RESIDUAL_SELECTED`. IND-C07 remains
  **ACTIVE**; IND-C08 remains blocked. Exact next phase is **Phase
  3B.12C.7.4 — MCP Shared Bounded-Output Seam Residual Closure**.
- Scratch-only ground truth, payload/digest, performance, provenance and
  mutation artifacts live under
  `%LOCALAPPDATA%\Temp\afyx-ind-c07r3-20261002`; none belong in the repository.

#### IND-C07.4 — MCP shared bounded-output seam residual closure (2026-10-02)

- **Baseline and selected ownership:** official baseline
  `42de349301007c850a46d54ec89ea7f45d956f8c`. The selected OLD symbols were
  `MAX_OUTPUT_LENGTH`, `ToolHandler.truncateOutput`, and every existing
  Search/Callers/Callees/Impact/Node/Files consumption site. OLD kept the
  shared 15,000-JavaScript-string-unit policy inside the domain-hosting
  `ToolHandler` class.
- **OLD ground truth and mutation:** a 12-case direct oracle captured empty,
  short, 14,999, exactly 15,000, no-newline, long single-line, below/exact/above
  strict 80% threshold, last eligible newline, complete-line, ordinary-marker,
  and deterministic-repeat behavior with exact strings, lengths, cut points,
  markers, and SHA-256. The accepted focused OLD tests passed 2/2; the C07.3
  campaign was reproduced at **5/5 killed**, zero survivor/invalid.
- **Afyx-native seam:** `src/mcp/tool-output.ts` now owns one pure
  `boundToolOutput(text)` operation. It has no handler, graph, DB, session,
  transport, pool, worker, CLI, environment, or mutable-state dependency.
  `tools.ts` imports it directly at all 14 actual consumption sites; the old
  constant and private method were removed. Family formatting, ToolResult
  construction, Explore policy, and Node's separate 38k file-view pagination
  remain outside this seam.
- **NEW direct contract and sensitivity:** the dependency-free durable suite
  passes 6/6 and directly freezes unchanged short/exact-limit values, raw cap,
  strict `>` threshold, last eligible newline, exact
  `\n\n... (output truncated)` marker, complete-line behavior, existing-marker
  treatment, and repeatability. NEW mutation kills **12/12** applicable
  semantic mutants with zero survivor/equivalent/invalid, including first-vs-
  last newline and `>=` boundary changes.
- **Controlled differential and payload:** all **12/12** OLD/NEW cases are
  byte-for-byte `IDENTICAL`; output lengths, cut points, marker presence, and
  SHA-256 match, with `UNEXPLAINED = 0`. The complete-line case remains 14,980
  bytes/chars with cut point 14,956 and digest
  `76391e95979b4e440f75964963d4fd7038c71f857f5b09dc8fa1edc00931a2b4`.
  Focused MCP/adapter coverage passes 192 with two declared skips, exercising
  all owning families and representative oversized Search, relationship, Node,
  input-limit, and security paths; remaining call sites are mechanical direct
  consumers of the same proven pure operation.
- **Performance:** 31 alternating OLD/NEW samples of 25,000 calls each report
  median deltas: short +0.004 ns (+0.10%), >15k single line +6.536 ns (+0.13%),
  and eligible-newline multiline -2.916 ns (-0.33%). Corresponding NEW
  median/p95 values are 4.192/11.436 ns, 5,190.068/5,332.460 ns, and
  886.796/911.516 ns. There is no material reproducible regression; these
  nanosecond-scale figures are not user-facing latency claims.
- **Provenance:** established normalization against
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` reports Scope A (OLD constant and
  method) 7/7 substantive, 2/2 comments, 75% five-line shingles, longest block
  11, one block >=8. Scope B (new seam) is 1/9 substantive (11.11%), 0/1
  comments, 0% shingles, longest block 2, zero blocks >=8. Scope C (remaining
  `tools.ts` import/calls) is 0/15 substantive, no comments, 0% shingles,
  longest block 0, zero blocks >=8. The one Scope-B match is necessary public
  policy/standard string handling, not unexplained retained private ownership;
  this is technical provenance evidence, not a legal conclusion.
- **Freeze gates:** catalog digest remains
  `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`.
  C07.2 dispatch, Search/Files/relationship/Impact/Node/Status adapters,
  Explore, session, transport, QueryPool/worker, CLI, C01-C06, Extraction,
  Resolution, Provider/Installer, and UI remain frozen. Focused MCP tests,
  Search/Context/Graph/Impact/QueryPool, DB/lifecycle, CLI semantic,
  Extraction/Resolution, semantic fixtures, smoke, typecheck, production/UI
  builds, and final-head seven-job CI are required closure gates.
  PR #45 final-head CI passed **7/7** after one unchanged-head rerun of the
  Linux Graph Build: the initial run passed 5,446 tests but a frozen WAL
  concurrency timing case crossed its deliberately tiny pressure threshold;
  the rerun passed without source or test changes.
- **Residual map and next slice:** closing this independent family does not
  merge or split downstream family ownership. The evidence-based count is
  therefore **14 remaining C07 material families**, `UNKNOWN = 0`. Search is
  the next dependency-safe family: it is smaller than Files, has the strongest
  direct public/ground-truth coverage, and has a bounded validation/domain-call/
  ordering/formatting boundary. Exact next phase is **Phase 3B.12C.7.5 — MCP
  Search Adapter Residual Closure**; it is not implemented here. IND-C07 stays
  **ACTIVE** and IND-C08 remains not started.
- Scratch-only OLD/NEW oracles, differential, mutation, performance, and
  provenance artifacts live under
  `%LOCALAPPDATA%\Temp\afyx-ind-c07r4-20261002` and are excluded from the PR.

#### IND-C07.5 — MCP Search adapter residual closure (2026-10-02)

- **Baseline and ownership:** official baseline
  `31a6e1d79f774206553654abf36d1119b7601559`. Selected OLD regions were
  `ToolHandler.handleSearch` and `formatSearchResults`. Generic
  `validateString` and `getAfyxGraph` remain host-owned; `searchNodes`, Search
  scoring/ranking, and `generatedFilePredicate` remain frozen domain APIs.
- **Frozen contract:** `afyx_graph_search` schema/catalog, exact validation
  errors, `type -> type_alias`, runtime pass-through of other kinds,
  `Number(limit) || 10` plus 1..100 clamp, one domain call, success-shaped
  no-result text, stable handwritten-before-generated presentation, exact
  compact Markdown, and C07.4 `boundToolOutput` consumption remain unchanged.
- **OLD evidence:** a 34-case oracle records inputs, domain arguments/count,
  generated-predicate inputs, returned/presented order, project selection,
  exact ToolResult/text, payload bytes, SHA-256, and truncation. Focused OLD
  mutation kills **22/22** applicable semantic mutants, zero survivor,
  equivalent, or invalid; initial probe gaps were strengthened before any
  production edit.
- **Afyx-native seam:** new pure-boundary `src/mcp/search-tool.ts` owns only
  Search request adaptation, narrow domain invocation, generated presentation
  ordering, empty selection, compact formatting, shared output-bound
  consumption, and `textToolResult` assembly. It imports no ToolHandler,
  project/cache, SQLite, session, transport, pool, worker, or CLI ownership.
  `handleSearch` is now a thin generic validation/project-resolution facade.
- **NEW evidence:** direct dependency-free contract passes **13/13**. NEW
  mutation kills **22/22** equivalent-or-stronger mutants with zero survivor,
  equivalent, or invalid. Controlled OLD/NEW differential is **34/34
  IDENTICAL**, `UNEXPLAINED = 0`, including exact calls, order, text, bytes,
  and digests.
- **Real repository and payload:** an unchanged 971-file, 24,460-node,
  78,105-edge index exercised common/partial symbols, class/type filters, low/
  high limits, no-result, and explicit projectPath. OLD/NEW output/order/
  payload digests are **8/8 IDENTICAL**, `UNEXPLAINED = 0`. This is controlled
  Search evidence, not a global agent-token-efficiency claim.
- **Performance:** 31 alternating samples of 5,000 adapter calls show NEW
  median deltas of +5.14 ns empty, +11.18 ns one result, +17.64 ns ten results,
  +0.92 ns mixed results, and +100.02 ns for 180 oversized results. Relative
  percentages on the two sub-microsecond cases are timer-sensitive; ten/mixed/
  oversized deltas are +1.61%, +0.05%, and +0.16%. No material reproducible
  adapter regression exists.
- **Provenance:** normalization against
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` reports Scope A OLD regions:
  25/27 substantive (92.59%), 7/8 comments (87.5%), 69.05% shingles, longest
  block 28, two blocks >=8. Scope B new seam: 8/29 substantive (27.59%), 0/1
  comments, 7.69% shingles, longest block 9, one block >=8. Scope C thin facade:
  2/12 substantive (16.67%), no comments, 0% shingles, longest block 1, zero
  blocks >=8. Residual B matches are frozen public formatting/vocabulary and
  standard TypeScript control flow; unexplained private Search ownership is
  zero. This is technical provenance, not a legal conclusion.
- **Freeze gates:** catalog digest remains
  `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`.
  C07.2 dispatch, C07.4 output, all other MCP/CLI families, C01-C06,
  Extraction/Resolution, Provider/Installer, and UI remain frozen. Focused
  Search/MCP, Search/Context/Graph/QueryPool/Impact, DB/lifecycle, CLI semantic,
  semantic fixtures, CLI/MCP smoke, typecheck, and clean production/UI builds
  pass. PR #46 final-head CI passed **7/7** after one unchanged-head rerun of
  the Linux Graph Build: the initial job hit a Node/Vitest worker zone OOM and
  a frozen WAL pressure threshold after 5,443 tests passed and 192 were
  skipped; the rerun passed without source or test changes.
- **Residual map:** the Search family closes without merging or splitting
  downstream ownership: **13 C07 material families remain**, `UNKNOWN = 0`.
  Files is the next dependency-safe bounded adapter, supported by existing path,
  format, metadata, maxDepth, deterministic-ordering, and security evidence.
  Exact next phase is **Phase 3B.12C.7.6 — MCP Files Adapter Residual Closure**;
  it is not implemented here. IND-C07 remains **ACTIVE** and IND-C08 remains
  not started.
- Scratch-only oracles, mutation, differential, real-repository, performance,
  and provenance artifacts live under
  `%LOCALAPPDATA%\Temp\afyx-ind-c07r5-20261003` and are excluded from the PR.

#### IND-C07.6 — MCP Files adapter residual closure (2026-10-02)

- **Immutable metadata and ownership:** task date `2026-10-02`; official
  baseline `e2cfd5ccf62c5e3b68edf513791dd79bbef82721`; branch
  `afyx/ind-c07-files-adapter`; implementation evidence HEAD
  `7879580066ac67c78a97cf8b07115e20194f2a25`; PR #47. Selected OLD symbols
  were `ToolHandler.handleFiles`, `globToRegex`, `formatFilesFlat`,
  `formatFilesGrouped`, and `formatFilesTree`. Cross-cutting
  `validateOptionalPath` and `getAfyxGraph` remain host-owned; `getFiles`
  remains the frozen domain-facts boundary.
- **Frozen contract:** public `afyx_graph_files` catalog/schema, exact
  empty/no-match strings, root-ish and Windows path normalization, exact-file
  and segment-boundary subtree matching, the existing unanchored glob adapter,
  format fallback, literal-`false` metadata policy, 1..20 depth clamp, flat/
  grouped/tree layout and ordering, tree glyphs, and C07.4 `boundToolOutput`
  consumption remain unchanged. No third-party glob behavior was introduced.
- **OLD evidence:** a 60-case oracle records request, domain call count, source
  facts, exact ToolResult/text, serialized bytes, and SHA-256 across path,
  glob, options, empty, ordering, formatting, depth, bound, and deterministic
  repeat cases. Focused OLD mutation kills **35/35** applicable mutants, with
  zero survivor, equivalent, or invalid. Existing pre-edit Files/MCP gates
  passed **70/70**.
- **Afyx-native seam:** new `src/mcp/files-tool.ts` owns the narrow `getFiles`
  call, Files request adaptation, path/glob filtering, empty selection,
  flat/grouped/tree formatting, shared bound consumption, and ToolResult
  assembly. It imports no ToolHandler, project cache, DB, session, transport,
  pool, worker, CLI, or lifecycle owner. `ToolHandler.handleFiles` is now only
  the project-resolution facade plus raw-request delegation.
- **NEW evidence:** dependency-free Files contract passes **23/23** and the
  existing real-index path-normalization contract passes **13/13**. NEW
  source mutation kills **32/32** applicable mutants after strengthening four
  durable sensitivity gaps; survivor/equivalent/invalid counts are zero.
  Controlled OLD/NEW differential is **60/60 IDENTICAL** with
  `UNEXPLAINED = 0`.
- **Real repository and payload:** an unchanged 949-file index exercised whole
  tree, flat, grouped, metadata false, POSIX/Windows subtree, glob, combined
  path+glob, maxDepth, and no-match. Exact text, ToolResult bytes, ordering,
  and SHA-256 are **10/10 IDENTICAL**, `UNEXPLAINED = 0`. This is controlled
  Files payload evidence, not a global agent-token-efficiency claim.
- **Performance:** 21 interleaved samples report OLD→NEW median ns/call:
  empty 98.16→93.39, small flat 3124.14→3010.32, 100-file flat
  32889.60→30702.60, grouped 39353.67→40188.00, tree
  167282.33→163458.00, path+glob 26598.20→27788.40, and bounded large output
  635144.00→625500.00. Median deltas range from -6.65% to +4.47%; p95 is
  runner-noisy without a consistent increase. No material reproducible
  adapter regression exists.
- **Provenance:** normalization against historical
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` reports Scope A OLD regions:
  54/57 substantive (94.74%), 12/13 comments (92.31%), 85.98% five-line
  shingles, longest block 43, five blocks >=8. Scope B new seam: 33/100
  substantive (33.00%), 0/1 comments, 7.69% shingles, longest block 9, one
  block >=8. Scope C thin facade: 1/9 substantive (11.11%), 0/1 comments, 0%
  shingles, longest block 2, zero blocks >=8. Residual matches are frozen
  public strings/glyphs/vocabulary and standard TypeScript constructs;
  unexplained private Files ownership is zero. This is technical provenance,
  not a legal conclusion.
- **Freeze and regression gates:** catalog SHA-256 remains
  `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`.
  C07.2 dispatch, C07.4 output, C07.5 Search, every other MCP/CLI family,
  C01-C06, Extraction/Resolution, Provider/Installer, and UI remain frozen.
  Focused MCP/Files/security, Search/Context/Graph/QueryPool/Impact-Affected,
  DB/WAL/lifecycle, semantic fixtures, CLI/MCP smoke, CLI semantic,
  Extraction/Resolution, typecheck, and clean production/UI builds pass.
- **CI:** PR #47 implementation-head checks passed **7/7**: general CI
  Linux/macOS/Windows and Graph Build Linux/macOS/Windows/Rust. The first Linux
  Graph Build reached 305 files/5,675 tests before a Tinypool child exited
  without an assertion failure; the unchanged-head failed-job rerun passed.
  No production or test change was made for that frozen runner-resource event.
- **Residual map and next slice:** Files closes as one independent family
  without splitting or collapsing downstream ownership: **12 C07 material
  families remain**, `UNKNOWN = 0`. Current source evidence selects Callers and
  Callees together as one bounded relationship-adapter family because they
  share symbol discovery, definition grouping, edge-label, limit/truncation,
  and result-assembly ownership. Exact next phase is **Phase 3B.12C.7.7 — MCP
  Relationship Adapter Residual Closure (Callers/Callees)**; it is not started
  here. IND-C07 remains **ACTIVE** and IND-C08 remains not started.
- Scratch-only OLD/NEW oracles, mutation, differential, real-repository,
  performance, and provenance artifacts live literally under
  `C:\Users\afif\AppData\Local\Temp\afyx-ind-c07r6-20261002` and are excluded
  from PR #47.

#### IND-C07.7 — MCP Relationship adapter residual closure (Callers/Callees) (2026-10-02)

- **Immutable task metadata:** phase `IND-C07.7`; title `MCP Relationship Adapter
  Residual Closure (Callers/Callees)`; official baseline
  `9f08c10796991379b167d582571bc075ea6c60ce`; branch
  `afyx/ind-c07-relationship-adapter`; implementation/evidence HEAD
  `3742aa586aa4d5ddee2ec940d997ec320c366333`; PR #48. Scratch-only
  evidence lives literally under
  `C:\Users\afif\AppData\Local\Temp\afyx-ind-c07r7-20261002` and is excluded
  from the PR.
- **Selected OLD ownership and frozen dependencies:** the selected private
  regions were `ToolHandler.handleCallers`, `ToolHandler.handleCallees`,
  `definitionHeading`, `formatNodeList`, and `edgeLabel`. Generic
  `validateString` and project selection remain host-owned. The new seam
  consumes, but does not duplicate, frozen `findAllSymbols`,
  `groupDefinitions`, `getCallers`, and `getCallees` behavior. Impact, Node,
  Status, Explore, dispatch, output bounding, Search, Files, session,
  transport, QueryPool/worker, CLI, DB/WAL, and lifecycle ownership did not
  move.
- **Architecture closure:** OLD `ToolHandler` owned exact-symbol consumption,
  file narrowing/fallback notes, direction selection, per-definition Graph
  calls, node-ID first-seen deduplication, first-edge labels, flat/grouped
  presentation, semantic limit disclosure, and result assembly. Afyx-native
  `src/mcp/relationship-tool.ts` now owns that bounded adaptation through the
  narrow `RelationshipToolSource` capability interface. Both ToolHandler
  methods are thin generic validation/project-selection/wiring facades; the
  new module owns no ToolHandler, AfyxGraph, SQLite, MCP session/transport,
  QueryPool/worker, watcher, lifecycle, CLI, or domain algorithm.
- **Frozen relationship contract:** Callers and Callees retain default 20,
  clamp 1..100, current runtime coercion for zero/null/string/negative/NaN-like
  limits, exact-only symbol selection with did-you-mean notes, same-file
  overload aggregation, distinct-definition grouping, exact/suffix file
  narrowing, failed-filter disclosure, resolver aggregation notes, per-node-ID
  first-seen ordering, first-edge-label retention, and one Graph call per
  definition node. `calls` remains unlabeled; `fnRef`, `instantiates`,
  `imports`, `references`, and fallback kinds retain established labels.
  Zero-result text, flat headings, definition headings, empty-group markers,
  per-definition limits, grouped `… +N more`, flat total disclosure, and the
  C07.4 15,000-character output bound remain byte-identical.
- **Ground truth and mutation:** pre-edit OLD focused integration coverage
  passed across nine selected contract files. The deterministic OLD oracle
  recorded **64 cases** with request, direction, Graph call order/count,
  ToolResult, bytes, and SHA-256. OLD focused mutation killed **33/33**
  applicable mutants with zero survivors/equivalent/invalid. NEW direct,
  dependency-free Relationship tests pass **7/7** and final-source mutation
  kills **28/28** applicable mutants with zero survivors/equivalent/invalid.
- **Differential and real-index parity:** the same controlled matrix is
  **64/64 IDENTICAL**, including calls, ordering, labels, text, ToolResult,
  serialized bytes, and SHA-256; `UNEXPLAINED = 0`. A freshly indexed
  TypeScript fixture exercised default/high limits, zero/missing symbols,
  grouped definitions, successful/failed file narrowing, callback labels,
  and both directions: **14/14 IDENTICAL**, `UNEXPLAINED = 0`. These are
  controlled Relationship payload/context measurements, not a claim about
  every MCP payload or agent-token efficiency.
- **Performance and payload:** five final OLD→NEW interleaved pairs measured
  nine adapter scenarios at 500 calls each. Median ns/call OLD→NEW were:
  not-found 8,700→8,200; one relation 11,300→12,300; 20 relations
  14,600→15,400; 105/truncated 17,200→17,800; same-file overloads
  13,100→14,400; multiple definitions 15,800→15,500; multiple groups
  truncated 17,400→15,900; callback label 14,500→17,400; bounded large output
  32,200→30,300. Median deltas span -8.62% to +20.00%, with the largest
  positive absolute delta 2.9 microseconds on a microbenchmark; p95 movement
  is runner-noisy and inconsistent. No material reproducible adapter
  regression exists. Controlled 64-case and real-index 14-case payloads remain
  byte-identical.
- **Provenance:** against historical reference
  `b7a1aa2718dc1f6940e483043733f67020d9a62f`, using trimmed/collapsed
  whitespace, >=20-character substantive/comment lines, five-line shingles,
  and `SequenceMatcher(autojunk=false)`: Scope A OLD selected regions are
  105/111 substantive (94.59%), 19/21 comments (90.48%), 124/159 shingles
  (77.99%), longest block 45, five blocks >=8. Scope B new Afyx seam is 22/87
  substantive (25.29%), 0/2 comments, 3/120 shingles (2.50%), longest block 8,
  one block >=8. Scope C remaining ToolHandler facades/wiring is 6/15
  substantive (40.00%), 0/2 comments, 0/25 shingles, longest block 5, zero
  blocks >=8. Residual matches are public strings/Markdown vocabulary,
  relationship and edge-kind names, field names, and standard TypeScript
  Map/Set/switch/loop idioms; material unexplained retained private
  Relationship implementation is zero. This is technical provenance evidence,
  not a legal conclusion.
- **Frozen gates:** final focused Relationship/MCP/security/dispatch/output/
  Search/Files/QueryPool selection reports **167 passed, 2 platform-skipped**.
  Representative frozen domain suites report **942/942**: Graph 439,
  Search/Context 153, Impact/Affected 6, QueryPool 12, DB/WAL 209, lifecycle
  123. CLI/MCP semantic contracts plus extraction/resolution ground truth pass
  **35/35** (9/9, 8/8, 5/5, 13/13). Semantic baseline passes 6/6; CLI/MCP
  smoke passes 21/21 including all eight tools. TypeScript typecheck, clean
  production build, and clean UI build pass. MCP catalog SHA-256 remains
  `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`;
  session, transport, QueryPool/worker, Explore, CLI, Search/Context, Graph,
  DB/WAL, Impact/Affected, lifecycle, Extraction/Resolution, and
  Provider/Installer/UI contracts remain frozen.
- **CI and classification:** implementation/evidence-head CI on PR #48 passed
  **7/7** (General CI Linux/macOS/Windows; Afyx Graph Build
  Linux/macOS/Windows/Rust kernel). Exact final PR-head CI is verified in PR
  checks and the task closure report after this evidence commit, avoiding a
  self-referential documentation/CI loop. Implementation evidence supports
  `MCP_RELATIONSHIP_ADAPTER_SLICE_COMPLETE` subject only to that exact final
  PR-head check.
- **Residual map:** Relationship closes exactly one independently owned family;
  **11 C07 material residual families remain**, `UNKNOWN = 0`. Re-evaluation
  selects the bounded MCP Impact adapter next because it consumes the same
  now-stable lookup/grouping/output seams while retaining frozen
  `mergeSymbolImpact` domain ownership. Exact next phase is **Phase
  3B.12C.7.8 — MCP Impact Adapter Residual Closure**; it is not started here.
  IND-C07 remains **ACTIVE** and IND-C08 remains not started.

#### IND-C07.8 — MCP Impact adapter residual closure (2026-10-02)

- **Immutable task metadata:** phase `IND-C07.8`; title `MCP Impact Adapter Residual Closure`; official baseline `ca74d6eac12d1eb2f62a408c6c8d82d5b6ae9ae2`; branch `afyx/ind-c07-impact-adapter`; implementation/evidence HEAD `eb71170d9645ca7616bf75ad89279d45d2c3eccc`; PR #49. Scratch-only oracle, mutation, differential, real-index, performance, and provenance evidence lives literally under `C:\Users\afif\AppData\Local\Temp\afyx-ind-c07r8-20261002` and is excluded from the PR.
- **Selected ownership and architecture:** OLD `ToolHandler.handleImpact` and `ToolHandler.formatImpact` owned depth normalization, exact-symbol result consumption, definition grouping consumption, file-filter/note policy, per-definition domain invocation, single/multi-definition result assembly, formatting, output bounding, and `ToolResult` assembly. New Afyx-owned `src/mcp/impact-tool.ts` owns exactly that adaptation through a narrow `ImpactToolSource`; it imports no `ToolHandler`, project lifecycle, DB, session, transport, QueryPool, worker, or CLI host. `ToolHandler` retains generic symbol validation, project selection, and explicit wiring only. Frozen `findAllSymbols`, `groupDefinitions`, `mergeSymbolImpact`, and `getImpactRadius` remain single-source domain dependencies.
- **Ground truth and mutation:** the pre-edit OLD oracle and dependency-free NEW oracle each cover 24 depth, resolution, exact/fuzzy-not-found, note, file-filter, same-file overload, distinct-definition, zero/one/many-node, ordering, formatting, and shared-bound cases. Runtime depth behavior remains default 2 for omitted/null/zero/NaN-like values, clamp 1..10, numeric-string coercion, and `NaN` propagation for a truthy invalid string. Non-string file filters remain omitted; successful narrowing suppresses the resolver aggregation note; failed narrowing falls back with the exact note. Same-file overloads remain one group; distinct definitions retain independent blast radii and headings. OLD and NEW each killed 10/10 applicable observable mutants with zero meaningful survivors. The `'first-seen'` to `'last-seen'` edge-dedup mutant is honestly equivalent/non-scored because MCP Impact renders nodes, not edges; the NEW source statically preserves `'first-seen'`.
- **Differential, real index, and payload:** controlled OLD/NEW comparison is 24/24 identical for domain-call order/depth/count, `ToolResult`, text, serialized bytes, and SHA-256 (`UNEXPLAINED = 0`). Six controlled real-repository/index cases are 6/6 byte-identical (`UNEXPLAINED = 0`) across default/depth 1/depth 10, relationship symbol, resolver symbol, and missing symbol. Representative controlled payload bytes remain identical: not-found 83, zero-impact 80, one-node 117, multi-file 1,526, same-file overload 1,582, multiple definitions 1,580, and successful file narrowing 726. These are controlled Impact payloads, not a global token-efficiency claim.
- **Performance:** five OLD→NEW interleaved pairs, 2,000 warm calls per scenario after 200 warmups, produced median microseconds OLD→NEW: not-found 11.9→12.7, zero-impact 14.4→16.7, one-node 18.8→17.1, multi-file 23.3→21.8, same-file overload 22.9→22.4, multiple definitions 22.7→21.3, file-narrow 17.5→17.2. Absolute median deltas span -1.7 to +2.3 microseconds; payload sizes and domain-call counts remain identical. No material reproducible adapter regression exists.
- **Provenance:** established normalization against historical reference `b7a1aa2718dc1f6940e483043733f67020d9a62f` (trim/collapse whitespace, >=20-character substantive/comment lines, five-line shingles, `SequenceMatcher(autojunk=false)`) reports Scope A OLD selected Impact regions: 33/37 substantive (89.19%), 6/6 comments (100%), 37/55 shingles (67.27%), longest block 29, three blocks >=8. Scope B new Afyx seam: 18/47 substantive (38.30%), 0/1 comments, 8/67 shingles (11.94%), longest block 8, one block >=8. Scope C remaining ToolHandler facade/wiring: 3/9 substantive (33.33%), no comments, 0/13 shingles, longest block 4, zero blocks >=8. Residual matches classify as public Impact wording/format, protocol/domain vocabulary, schema names, and standard TypeScript iteration/map idioms; material unexplained retained private Impact implementation is zero. This is technical provenance evidence, not a legal conclusion.
- **Freeze and validation gates:** direct/focused Search/Files/Relationship/dispatch/MCP/security coverage passed 149 with two platform skips; frozen Impact/Affected, Graph, Search/Context, QueryPool, DB/WAL, and lifecycle coverage passed 953/953. Existing Impact golden is unchanged. Semantic baseline passed 6/6; CLI/MCP smoke passed 21/21; CLI/MCP semantic, Extraction, and Resolution ground truth passed 35/35. TypeScript typecheck and clean production/UI build passed. MCP catalog SHA-256 remains `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`; C07.2 dispatch, C07.4 output, C07.5 Search, C07.6 Files, C07.7 Relationship, Node, Status, Explore, session, transport, QueryPool/worker, CLI, Provider/Installer/UI, and legal/attribution sources are unchanged. Exact final PR-head CI is recorded in PR checks and the closure report, avoiding a documentation/CI recursion claim.
- **Residual map:** Impact closes exactly one independently owned family; **10 C07 material residual families remain**, `UNKNOWN = 0`. Re-evaluation selects the bounded MCP Node adapter next because it consumes the now-stable dispatch/output/resolution seams while its file/body ambiguity and presentation policy remain independently testable. Exact next phase is **Phase 3B.12C.7.9 — MCP Node Adapter Residual Closure**; it is not started here. IND-C07 remains **ACTIVE** and IND-C08 remains not started.

#### IND-C07.9 — MCP Node adapter residual closure (2026-10-02)

- **Immutable task metadata:** phase `IND-C07.9`; title `MCP Node Adapter Residual Closure`; official baseline `482fdb2ff4aa9403ccd59bd131b9a61b7003c571`; branch `afyx/ind-c07-node-adapter`; implementation/evidence HEAD `cc449fc6e5c1de8f534640c4f74a56340e30b562`; PR #50. Scratch-only oracle, mutation, differential, benchmark, and provenance evidence lives literally under `C:\Users\afif\AppData\Local\Temp\afyx-ind-c07r9-20261002` and is excluded from the PR.
- **Ownership and architecture:** OLD `ToolHandler.handleNode`, file-view, single/stale definition rendering, trail formatting, Node lookup, container outline, and detail formatting owned Node-specific mode selection, lookup orchestration, file/line narrowing, ambiguity packing, file resolution, safe current-source presentation, stale selection, trails, and `ToolResult` assembly. New Afyx-owned `src/mcp/node-tool.ts` owns that adapter policy through a narrow `NodeToolSource` capability and explicit host callbacks. It does not own `ToolHandler`, `AfyxGraph`, DB, lifecycle, MCP session/transport, QueryPool/worker, or domain algorithms. `ToolHandler` retains project selection, generic symbol validation, shared stale detection, strict path containment/current-file reading, shared line numbering, shared synthesized-edge labels, container-kind policy, and compatibility facades for frozen symbol lookup tests.
- **Frozen Node behavior:** SYMBOL and FILE modes preserve literal option normalization; bare/qualified/fuzzy/generated lookup; file/line disambiguation including case folding, ignored misses, containing-range priority, and nearest-start fallback; single metadata/body/outline/docstring output; 12,000-character body budget, 16-body hard cap, 20-row remainder cap; exact/suffix/substring file resolution; `symbolsOnly`; 2,000-line default and 38,000-character Read-parity pagination; config-secret protection; stale small/large/config behavior; 12-entry caller/callee trails with deduplication and synthesized labels. Shared `matchesSymbol`, stale hashing, containment, numbering, and synthesized-edge semantics remain single-source.
- **Ground truth and mutation:** pre-edit focused integration was 151 pass with two declared platform skips. The durable OLD/NEW oracle now records 81 controlled cases and compares request, graph-call order, `ToolResult`, serialized bytes, and SHA-256 byte-for-byte; NEW is 81/81 `IDENTICAL`, `UNEXPLAINED = 0`. The OLD focused campaign has 21 applicable mutants killed and one equivalent unmatched-file intermediate-state mutant; the strengthened oracle closes the prior fuzzy, case-folding, exact/suffix priority, and containing-range sensitivity gaps. Final functional NEW source kills 23/23 meaningful mutants. Direct dependency-free seam tests pass 4/4.
- **Real/security/payload evidence:** final focused Node/MCP/Search/Files/Relationship/Impact/dispatch/QueryPool/CLI/security selection passes 219 tests with two declared platform skips. This includes real indexed symbol lookup 31/31, file-view 9/9, stale-slice 6/6, config-secret 4/4, and security 46 pass plus two platform skips. Ten controlled benchmark workloads and all 81 oracle cases retain identical payload SHA-256; raw worker/in-process dispatch and all eight MCP smoke paths remain covered without changing QueryPool/worker protocol or main-thread notices.
- **Performance:** seven OLD→NEW interleaved pairs, each workload using 25 warmups and 250 measured calls, show median milliseconds: metadata 0.0088→0.0083; leaf body 0.0096→0.0122; qualified 0.0135→0.0142; file pin 0.0147→0.0147; ambiguous list 0.0156→0.0149; ambiguous bodies 0.0298→0.0284; `symbolsOnly` 0.0136→0.0141; small raw file 1.0940→1.1413; paged raw file 1.2507→1.2579; trail-rich 0.0168→0.0178. Largest absolute median increase is 0.0473 ms on filesystem-heavy small-file reading; pure-adapter percentage changes are microsecond-scale. All payloads are identical and no material reproducible adapter regression exists.
- **Provenance:** against historical reference `b7a1aa2718dc1f6940e483043733f67020d9a62f`, using trimmed/collapsed whitespace, >=20-character substantive/comment lines, five-line shingles, and `SequenceMatcher(autojunk=false)`: Scope A OLD selected Node regions are 202/223 substantive (90.58%), 93/104 comments (89.42%), 307/447 shingles (68.68%), longest block 47, 15 blocks >=8. Scope B new Afyx seam is 75/269 substantive (27.88%), 1/1 comment, 23/404 shingles (5.69%), longest block 12, three blocks >=8. Scope C remaining `ToolHandler` Node/lookup facades is 1/13 substantive (7.69%), 2/3 comments (66.67%), 0/25 shingles, longest block 4, zero blocks >=8. Residual matches classify as frozen public messages and Markdown, public Node/MCP/domain vocabulary, result/schema field names, and standard TypeScript collection/async idioms; material unexplained retained private Node implementation is zero. This is technical provenance evidence, not a legal conclusion.
- **Freeze and build gates:** representative Search/Context, Graph, Impact/Affected, DB/WAL, Extraction/Resolution coverage passes 889/889. Lifecycle/daemon/watcher coverage finishes with 195 pass and seven declared skips; one daemon liveness assertion failed only under concurrent watcher resource load and the unchanged-head isolated 12/12 rerun passed. TypeScript typecheck, clean production build, clean UI build, semantic fixtures 6/6, and CLI/MCP smoke 21/21 pass. Ordered eight-tool catalog SHA-256 remains `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`. C07.2 dispatch, C07.4 output, C07.5 Search, C07.6 Files, C07.7 Relationship, C07.8 Impact, Status, Explore, session, transport, QueryPool/worker, CLI, DB/WAL, Graph, Search/Context, Impact/Affected, lifecycle, Extraction/Resolution, Provider/Installer/UI, and legal/attribution remain frozen. Exact final-PR-head CI is recorded in PR checks and the closure report, avoiding a self-referential documentation/CI claim.
- **Residual map:** Node closes exactly one independently owned family; **9 C07 material residual families remain**, `UNKNOWN = 0`. Re-evaluation selects **MCP Status Adapter Residual Closure** next because Status is the remaining bounded main-thread tool adapter and depends only on already-frozen stats/WAL/pending/watcher/worktree capabilities. Exact next phase: **Phase 3B.12C.7.10 — MCP Status Adapter Residual Closure**. It is not started here. IND-C07 remains **ACTIVE**; IND-C08 remains not started.

#### IND-C07.10 — MCP Status adapter residual closure (2026-10-02)

- **Immutable metadata:** phase `IND-C07.10`; title `MCP Status Adapter Residual Closure`; official baseline `049fbcf0ddfc1ee202265846d9d38e5bc5ee2d7d`; branch `afyx/ind-c07-status-adapter`; implementation/evidence HEAD `62c510e801a049e612726960441adc663015a6b4`; PR #51. Scratch-only evidence is under `C:\Users\afif\AppData\Local\Temp\afyx-ind-c07r10-20261002` and is excluded from the PR.
- **Ownership and architecture:** OLD `ToolHandler.handleStatus()` owned statistics, DB-size/backend/WAL presentation, pending-reference warnings, node-kind/language distributions, watcher degradation, pending-file age/labels, verbose worktree quoting, and `ToolResult` assembly. New Afyx-owned `src/mcp/status-tool.ts` owns only that adapter presentation through a narrow status source and explicit `worktreeWarning`/`nowMs` context. `ToolHandler` retains project/cache selection, same-project watched-default preference, cross-project isolation, cached worktree detection, and main-thread routing. DB/WAL, watcher lifecycle, graph statistics, session, transport, QueryPool/worker, and CLI remain outside the seam.
- **Frozen contract:** Status remains main-thread-only, bypasses QueryPool and generic worktree/staleness wrappers, performs no synchronization or repair, and does not use the C07.4 15k output bound. The exact header, counts, two-decimal MiB conversion, fixed backend text, WAL/unknown warnings, pending-reference wording, insertion-ordered positive distributions, degradation fallback, pending-file order/age clamp/labels, multiline worktree quoting, and success-shaped `ToolResult` remain unchanged. Same-project explicit paths prefer the watched default; different projects do not inherit its watcher state.
- **Ground truth and mutation:** deterministic clock-backed OLD/NEW oracle covers 41 controlled fact combinations plus watched-default, cross-project, dispatch, and wrapper boundary tests. All 41 observable cases are byte-identical, including serialized bytes and SHA-256; `UNEXPLAINED = 0`. OLD focused mutation kills 28/28 meaningful mutants. NEW mutation kills 30/30, including watched-default and cross-project host wiring. Seven direct/host Status tests pass.
- **Integration and payload:** the focused C07/Status selection records 160 pass. Six Windows subprocess cases in roots/subproject suites fail on Temp-directory cleanup (`EPERM`) and the same six fail on the official OLD baseline, so they are not a NEW regression. A real repository OLD/NEW Status call is identical at 781 text characters, 874 serialized bytes, and SHA-256 `191f3755eb4855d82634ae1d6b5e9bbcb72fb9e31e269475f7fd0267eca8aa74`.
- **Performance:** seven interleaved OLD→NEW pairs per workload, with 25 warmups and 500 measured calls per pair, show median/p95 milliseconds: healthy `0.0212/0.0259 → 0.0119/0.0187`; 80 distribution entries `0.0276/0.0605 → 0.0188/0.0545`; pending references `0.0213/0.0249 → 0.0119/0.0181`; 20 pending files `0.0240/0.0379 → 0.0141/0.0266`; degraded watcher `0.0215/0.0274 → 0.0125/0.0182`; all optional sections `0.0234/0.0345 → 0.0142/0.0278`. Payloads are identical and no material regression exists.
- **Provenance:** against historical `b7a1aa2718dc1f6940e483043733f67020d9a62f`, using trimmed/collapsed whitespace, >=20-character substantive/comment lines, exact five-line shingles, and `SequenceMatcher(autojunk=false)`: Scope A OLD Status is 43/63 substantive (68.25%), 28/50 comments (56.00%), 83/153 shingles (54.25%), longest block 43, four blocks >=8. Scope B new seam is 11/48 substantive (22.92%), 0/1 comments, 2/72 shingles (2.78%), longest block 6, zero blocks >=8. Scope C remaining host facade is 5/25 substantive (20.00%), 5/27 comments (18.52%), 7/71 shingles (9.86%), longest block 11, one block >=8. Residual matches are frozen public wording, public status/schema vocabulary, and standard TypeScript idioms; material unexplained retained private Status implementation is zero.
- **Freeze/build gates:** representative Search/Context, Graph, DB/WAL, Impact/Affected, Lifecycle, Extraction/Resolution, and CLI semantic tests record 1,176 pass. One real-`fs.watch` Windows cleanup assertion fails with `EPERM` identically on OLD and NEW (35/36 watcher assertions otherwise pass). TypeScript clean production build, clean UI build, semantic fixtures 6/6, and CLI/MCP smoke 21/21 pass. Catalog SHA-256 remains `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`; C07.2 dispatch, C07.4 output, C07.5 Search, C07.6 Files, C07.7 Relationship, C07.8 Impact, C07.9 Node, Explore, session, transport, engine/project selection, QueryPool/worker, CLI, and all frozen product subsystems remain unchanged.
- **Residual map:** Status closes exactly one independently owned family; **8 C07 material residual families remain**, `UNKNOWN = 0`. Re-evaluation selects **MCP Explore Adapter Residual Closure** next because it is the next bounded family in the frozen dependency order and consumes the completed shared output/read-adapter seams. Exact next phase: **Phase 3B.12C.7.11 — MCP Explore Adapter Residual Closure**. It is not started here; IND-C07 remains active and IND-C08 remains not started.

#### IND-C07.11 — MCP Explore adapter residual closure (2026-10-02)

- **Immutable metadata:** phase `IND-C07.11`; title `MCP Explore Adapter
  Residual Closure`; official baseline
  `49fb7ffc904c8a6ea1d7a3d999e79364219adca4`; branch
  `afyx/ind-c07-explore-adapter`; implementation/evidence HEAD
  `40bca3c7c6a43484715745554948d57823467f88`; PR #52. Scratch-only
  oracle, mutation, differential, deterministic, real-repository,
  performance, and provenance evidence lives literally under
  `C:\Users\afif\AppData\Local\Temp\afyx-ind-c07r11-20261002` and is excluded
  from the PR.
- **Ownership and architecture:** OLD `tools.ts` owned Explore query
  normalization, adaptive call/output budgets, relevance/ranking/allocation,
  source-range rendering, named flow, dynamic/polymorphic boundary
  presentation, blast radius, dedup consumption, hard-ceiling fitting, and
  emission assembly together with `ToolHandler.handleExplore`. New Afyx-owned
  `src/mcp/explore-tool.ts` owns that cohesive policy/orchestration/
  presentation surface. `ToolHandler.handleExplore` is now a thin facade that
  retains generic query validation and project selection and injects only
  shared stale detection, line numbering, and synthesized-edge presentation.
  It does not move Session, QueryPool/worker, transport, project lifecycle,
  or frozen Graph/Search algorithms into the seam.
- **Frozen boundaries:** the public eight-tool schema/catalog and ordered
  digest remain unchanged at
  `4eaa5a29a1f93bcee7d6b9a77605aa221f53c5767ba26cf0c6d150a0b43d6b3a`.
  Catch-up gating, allowlisting, worktree/staleness wrappers, worker routing,
  and fallback remain host-owned. `ExploreSessionState`, session-view
  injection, emission strip/record, project-key isolation, `explore-dedup.ts`,
  and `ExploreDiagnostics` remain their existing single-source dependencies.
  Named-symbol flow, dynamic boundaries, branch guards, type hierarchy, query
  paths, symbol lookup, `numberSourceLines`, stale hashing, and synthesized
  edge semantics remain frozen shared/domain capabilities.
- **Behavior contract:** OLD/NEW preserve Erlang/query normalization; advisory
  call tiers 1/2/3/4/5; adaptive 13k/18k/24k output tiers and runtime
  `maxFiles` coercion/clamp; raw-query path extraction, pin order and 300-node
  injection cap; exact relevant-context parameters; empty-result emissions;
  named flow and dynamic/polymorphic boundaries; relevance penalties, score
  floor, RWR, named/pinned priority and rescue policy; proportional allocation;
  clustering, full/focused/skeleton rendering, oversize members, gap markers,
  line numbers, config-secret and stale-source safety; cross-call dedup and
  changed-file re-serve; hard-ceiling/section-safe truncation; pointers,
  completeness/advisory notes, survivor-based summary, and exact
  `ExploreEmission` accounting.
- **Ground truth, mutation, and determinism:** the pre-edit Explore selection
  passed **293/293**. The durable integration oracle captures 33 request,
  path, budget, coercion, ranking, config, empty, stale, session, dedup, and
  emission cases plus policy/allocation facts. Controlled OLD/NEW results are
  **33/33 IDENTICAL** after canonicalizing only the random fixture root;
  payload bytes are identical and `UNEXPLAINED = 0`. OLD and NEW focused
  campaigns each kill **12/12** meaningful policy/orchestration/rendering/
  dedup/emission mutants with zero survivors or invalid mutants. The complete
  33-case oracle remains scratch-only evidence; three NEW runs produce one
  identical digest set. The durable committed test freezes policy/allocation
  fundamentals and direct seam versus host-facade parity without retaining
  oracle payloads in a long-lived test worker.
- **Integration, session, and payload:** all Explore plus required MCP,
  QueryPool, input-limit, staleness/worktree, dispatch, dynamic-boundary,
  field-name, and secret-safety suites pass **394/394**. Session state/dedup
  coverage proves internal emission stripping, two-session isolation,
  cross-project resolution, unchanged-source back-references, changed-source
  re-serve, and diagnostic byte neutrality. Three real-repository OLD/NEW
  queries are **3/3 byte-identical** at 19,639, 27,016, and 23,310 serialized
  bytes. These are controlled Explore payload measurements, not a claim about
  every MCP payload.
- **Performance:** seven OLD→NEW pairs with 25 warm in-process Explore calls
  per side (`AFYX_GRAPH_EXPLORE_DEDUP=0`) produced 175 samples each. Median/p95
  milliseconds are **14.7015/16.7639 → 14.8418/16.4610**; median delta is
  +0.1403 ms (+0.95%) while p95 delta is -0.3029 ms (-1.81%). Payloads are
  identical and no material reproducible adapter regression exists.
- **Provenance:** established normalization against historical reference
  `b7a1aa2718dc1f6940e483043733f67020d9a62f` (trim/collapse whitespace,
  >=20-character substantive/comment lines, exact five-line shingles,
  `SequenceMatcher(autojunk=false)`) reports Scope A OLD selected Explore
  regions: 2,494/2,522 substantive (98.89%), 2,686/2,717 comments (98.86%),
  3,642/3,853 shingles (94.52%), longest block 932, 30 blocks >=8. Scope B
  mechanically extracted Afyx seam: 1,552/1,600 substantive (97.00%),
  1,681/1,704 comments (98.65%), 3,841/4,133 shingles (92.93%), longest block
  590, 38 blocks >=8. Scope C remaining facade: 3/7 substantive (42.86%), no
  comments, 0/6 shingles, longest block 3, zero blocks >=8. High Scope B
  overlap is the expected byte-preserving mechanical extraction of one large,
  accepted behavior surface—not evidence for a semantic rewrite. Scope C
  retains only generic host wiring; material unexplained retained private
  Explore implementation is zero. This is technical provenance evidence, not
  a legal conclusion.
- **Freeze and build gates:** direct completed-adapter and representative
  Graph, Search/Context, DB, Impact/Affected, QueryPool, CLI, Extraction, and
  Resolution suites pass **383/383**. Semantic fixtures pass 6/6; CLI/MCP
  smoke passes 21/21 including all eight tools. TypeScript typecheck, clean
  production build, and clean UI build pass. A maximum-concurrency Windows
  full-suite observation reported 5,460 pass, 213 declared skips, and 36
  temp-directory `EPERM`/5-second timeout failures; isolated serial reruns
  confirmed the substantive Sync, daemon, multi-repository, freshness, and
  Git-currency cases while some subprocess cleanup tests remain blocked by the
  same Windows Temp handle condition. No failure implicated changed Explore
  code; supported-platform PR CI remains the release gate.
- **CI and classification:** exact final PR-head CI is recorded in PR #52
  checks and the closure report after the documentation commit, avoiding a
  self-referential documentation/CI claim. Current implementation evidence
  supports `MCP_EXPLORE_ADAPTER_SLICE_COMPLETE` subject to that exact 7/7
  final-head check.
- **Residual map:** Explore closes exactly one independently owned family;
  **7 C07 material residual families remain**, `UNKNOWN = 0`. Re-inventory
  selects Session ownership next because the Explore seam now consumes the
  established serializable session view/emission boundary without owning its
  storage, eviction, project keys, counters, or wire stripping. Exact next
  phase: **Phase 3B.12C.7.12 — MCP Session Residual Closure**. It is not
  started here; IND-C07 remains active and IND-C08 remains not started.

### IND-C08 — Extraction closure

- **Scope/ownership:** parser dispatch/control flow and language hosts after
  behavior tables/contracts are explicitly separated; Afyx extraction design.
- **Evidence:** extraction ground truth, 5/5 OLD mutations, kernel/JS parity,
  incremental/fresh differential and real repository.
- **Mutation plan:** retain existing mutations and add language-specific mutants
  only for touched logic.
- **Performance:** interleaved parse/index/sync, semantic digest, per-language
  result counts, visited/work, RSS and p95.
- **Expected files:** one language family or parser seam per PR; never global
  parser batch replacement.
- **Frozen/stop:** corrected facts, language behavior data, Resolution/DB; stop
  on unexplained fact delta, parity failure, language regression or material
  throughput loss.

### IND-C09 — Resolution closure

- **Scope/ownership:** import/name/framework/synthesizer hosts one strategy at a
  time, using the native deterministic policy seam.
- **Evidence:** 13/13 ground truth, current 7/7 mutations, prior OLD mutations,
  R0–R9 convergence, synthetic/real differential with `UNEXPLAINED=0` and
  interleaved performance.
- **Mutation plan:** retain existing seven; add strategy-specific candidate,
  ambiguity, cleanup and scope mutants.
- **Downstream/performance:** Graph, Search, Context, Impact, MCP, CLI and UI;
  ambiguity/import/unresolved/realistic scenarios with digest, counts, RSS/p95.
- **Expected files:** one resolver strategy/host boundary per PR.
- **Frozen/stop:** Afyx-corrected ground truth outranks historical behavior; stop
  on unexplained edge/unresolved/order delta or material regression.

### IND-C10 — provider/installer closure

- **Scope/ownership:** introduce side-effect-free detection/capability/plan/
  verify seams, then replace private orchestration per provider.
- **Evidence:** installer target tests plus golden configs for Codex, Claude and
  OpenCode across global/local locations and OS path rules.
- **Mutation plan:** detection writes, unrelated-key loss, wrong location,
  non-atomic apply, ownership over-delete and `All detected` selection mutants.
- **Differential/real repo:** temporary configs only; byte preservation outside
  Afyx-owned keys; no user production config.
- **Performance:** bounded detection only; correctness dominates latency.
- **Expected files:** shared types/plan plus one provider adapter per PR.
- **Frozen/stop:** Phase 3B.12A ownership/modular model; stop on side effects in
  detect/plan or unrelated configuration mutation.

### IND-C11 — UI server and frontend closure

- **Scope/ownership:** loopback transport/security/wire/SSE/trails followed by
  browser adapter/models/views in bounded vertical slices; Afyx optional UI.
- **Evidence:** UI server/API/security/package/model tests; add browser visual/
  interaction ground truth and mutation evidence before each view replacement.
- **Differential/real repo:** normalized wire contracts and deterministic view
  models against fixture and real repository; presentation changes must be
  intentional, not silently normalized.
- **Performance:** server startup, local HTTP, browser render, bundle size, RSS,
  visible elements and pagination p95.
- **Provenance target:** independent UI architecture/implementation with public
  domain APIs; public wire/schema/standard Svelte idioms classified separately.
- **Expected files:** one vertical surface at a time, starting with status shell
  only after common server/adapter seams are independent.
- **Frozen/stop:** every Phase 3B.12A invariant; stop if core semantics enter UI,
  remote exposure appears, writer ownership changes, or bounded transfer breaks.

## Validation rules for every implementation slice

Correctness priority is ground truth, then corrected Afyx semantics, then
historical compatibility. Every OLD/NEW difference is classified and
`UNEXPLAINED` must equal zero. Same frozen input/index/configuration must produce
the same observable result and order when order is public.

Performance runs are OLD/NEW interleaved and record semantic digest, absolute
latency, percentage delta, result/work counts, memory where meaningful and p95
for stable workloads. A large microbenchmark percentage with negligible
absolute cost is reported as such, while real-repository cost remains required.
A material reproducible regression without correctness justification blocks.

Each slice begins with a clean baseline, captures ground truth, tests the OLD
implementation, implements a small Afyx-native seam, runs focused tests and
mutations, compares differential and real-repository results, runs the relevant
benchmark, then runs downstream semantic/smoke/platform gates. It commits only
after source-scope and provenance review. No slice removes legal notices.

## Final technical-independence gate

Phase 3B.12C closure is complete only when every box is evidenced:

- [x] runtime upstream dependency = 0
- [x] build upstream dependency = 0
- [x] operational upstream dependency = 0
- [x] product-facing upstream identity = 0
- [x] legacy CLI/env/config identity = 0
- [x] upstream telemetry/update/release URLs = 0
- [ ] retained private upstream implementation = 0
- [ ] unexplained substantial overlap = 0
- [x] Afyx-owned ground truth exists (coverage must expand per slice)
- [x] Afyx-owned mutation/eval evidence exists (coverage must expand per slice)
- [ ] every closure slice has parity or better performance, except documented
  correctness work
- [x] current cross-platform baseline is healthy
- [ ] accepted core correctness is re-proven after all closure slices
- [ ] Phase 3B.12A UI architecture is re-proven after UI/installer closure

Current `TECHNICAL_INDEPENDENCE_STATUS` is
`OPERATIONALLY_INDEPENDENT_BUT_IMPLEMENTATION_CLOSURE_REQUIRED`.
Current `ATTRIBUTION_REVIEW_STATUS` is `OPEN_RETAIN_ALL_NOTICES`.

The completed IND-C04 DB subsystem must first merge and remain frozen as a
dependency baseline. Only then may a separately bounded IND-C05 Graph closure
begin; do not combine it with lifecycle, MCP, CLI, installer, or browser UI work.
