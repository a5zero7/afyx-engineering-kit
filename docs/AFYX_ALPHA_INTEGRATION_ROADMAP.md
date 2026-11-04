# Afyx Alpha Integration Roadmap

Status: **T01 documentation contract complete; benchmark readiness remains provisional**
Observed: **2026-10-15**
Canonical milestone source: [AFYX_V1_MASTER_ROADMAP.md](AFYX_V1_MASTER_ROADMAP.md)
Identity ledger: [AFYX_ALPHA_BASELINES.json](AFYX_ALPHA_BASELINES.json)

## Scope and governance

This plan makes Graph, Afyx Engineering Expert, and Forge work executable against one vocabulary. It does not promote an artifact, activate Technical Alpha, run a benchmark, or change Jira status.

### Workspace boundary (applies to T01-T12)

`D:\Project\workspace\afyx-codex-engineering-kit` is the canonical and exclusive development repository. All source changes, fixes, benchmarks, development tests, documentation, versioning, commits, builds, and release preparation for T01-T12 originate there.

`D:\Project\afyx-alpha` is an installation/update acceptance environment only. It may be used for clean installation, upgrade to a newly produced candidate, installed identity/provenance verification, and post-install smoke or acceptance checks. It must not be used to develop or patch source, commit changes, run source benchmarks, build artifacts, or prepare releases. A defect found there is reproduced and fixed in the canonical repository, rebuilt from that repository, and only then reinstalled or updated in the Alpha environment for acceptance. This filesystem boundary does not alter any task scope, dependency, acceptance gate, or historical evidence below.

- `main` remains canonical integration. `dev` is ordinary engineering and starts at verified T02 final source `ad1560dd930ccde94b0dadaa7b42d804be55714f`. `alpha` is reviewed Technical Alpha stabilization and starts at the existing `release/alpha-0.1` baseline `018dce0a31f927f2dc200c7be0bc8b71a8a3535c`. The historical branches remain preserved.
- Promotion flows `dev` -> reviewed `alpha` promotion -> accepted `main` integration. This is documented policy only: GitHub reports `main` and `release/alpha-0.1` as unprotected, so reviews and non-force integration remain operational gates rather than enforced branch protection.
- AFYX-248 owns IJP Odoo 10/17 Windows acceptance. AFYX-269 owns Adit's macOS pilot. Neither is closed here.
- The accepted candidate, branch HEAD, source revision, installed executable, and persisted index are distinct identities. A claim about one never proves another.
- PR [#59](https://github.com/a5zero7/afyx-codex-engineering-kit/pull/59) is open, targets `release/alpha-0.1`, and promotes AFYX-266 security work from head `0ca928da5e4b6f3ce170d954fed31d50319da2bb`. Its recorded checks passed, but it predates AFYX-282 and does not prove Graph inventory inclusion.
- Graph engineering acceptance for AFYX-282 and Knowledge Catalog is reusable, but installed-artifact acceptance for extraction v28 is still unverified.
- Expert D.5 is recorded as a reported automated 5/5 PASS. T06 preparation found no sanitized independent-review verdict, so D.6 is `BLOCKED — REVIEW PREPARED / SUBSTANTIVE REVIEW NOT EXECUTED`; formal A1/B1 remains blocked.
- Forge Track A is scheduled into the current Alpha development cycle. Its identity and A0-A12 gates are unchanged. This scheduling exception does not add Forge to the frozen v1 release requirements and does not auto-complete Technical Alpha, Alpha, Private Beta, or Stable.
- Holdouts, rubrics, canaries, and ground truth stay evaluator-only outside both developer and evaluated-agent roots. Only sanitized development evidence belongs in this repository.

Jira was not directly available to this Codex session. The user supplied a separately verified snapshot dated 2026-10-15: AFYX-12 `To Do`, AFYX-248 `In Progress`, AFYX-269 `To Do`, AFYX-279 `In Review`, AFYX-282 `Done`, and AFYX-283 `In Progress`. This is attributed external evidence, not a live Jira verification or status change by this session; no Jira comment was posted.

Latest externally supplied Forge mapping dated 2026-10-16: AFYX-12, AFYX-88, and AFYX-171 are `In Progress`; AFYX-172 and the A1-A3 issues are `Done` within their documented contract scope. This supersedes the earlier AFYX-12 planning snapshot only; it is still not a live Jira read or write by this Codex session.

## Twelve master tasks

These are the twelve approved master-task identities. They reuse existing Jira issues, create no new issues, and do not predict PASS.

| Task | Deliverable | Reused Jira | Dependency / exit | Planning state |
|---|---|---|---|---|
| T01 | Scope, baseline, evaluation contract | AFYX-248 / AFYX-283 / AFYX-12 | This document and ledger validated | COMPLETE (documentation only) |
| T02 | Graph case reproduction and correctness closure | AFYX-248; reuse AFYX-280–282; AFYX-265/278 where relevant | Source-grounded disposable reproduction; correctness and layer accounting close | PASS; exact-head Graph Build 38700997957 succeeded on 3 OS |
| T03 | Graph candidate promotion and artifact identity | AFYX-279; separate Graph promotion tracking | After T02 PASS; immutable source/artifact identity and promotion review | PREPARED; promotion blocked by unresolved PR #59 review |
| T04 | Installed-artifact IJP Windows acceptance and durability | AFYX-252/253/254 | After T03; exact installed artifact on AFYX-248 Windows scope | BLOCKED by T03 |
| T05 | Adit native macOS pilot acceptance | AFYX-269; related child issues | After T03; compatible native artifact and tester consent | BLOCKED by T03; AFYX-269 externally reported To Do |
| T06 | Expert D.6 substantive review and candidate freeze | AFYX-283 | Fresh, correlated D.5 evidence; independent substantive review | BLOCKED; review prepared, substantive review not executed |
| T07 | Expert controlled A1/B1 acceptance | AFYX-283; related AFYX-67/68 | After T06; frozen candidate, rubric, isolation, sampling, and budget | BLOCKED by T06 |
| T08 | Forge A0–A3 capability and contract work | AFYX-88–91 / AFYX-171–176 | Evaluation freeze before capability harvest/matrix/refinement | COMPLETE (contract only); no benchmark or implementation |
| T09 | Forge A4–A8 candidate evaluation and architecture decision | AFYX-92–96 / AFYX-177–183 | After T08; immutable B0–B5 candidates and predeclared decision rule | P1 PREPARATION COMPLETE; external gates blocked |
| T10 | Forge A9–A10 implementation and adaptive modes | AFYX-97/98 / AFYX-184–186 | Only after T09 records an explicit GO at A8 | BLOCKED by T09 GO |
| T11 | Forge A11–A12 dogfood and final acceptance | AFYX-99/100 / AFYX-187/188 | After T10; dogfood and stable-contract gates | BLOCKED by T10 |
| T12 | Combined artifact and integration acceptance | AFYX-248 / AFYX-269 / AFYX-283 / AFYX-12 | After T04, T05, T07, and T11 PASS | BLOCKED by component acceptance |

PR #59 remains the AFYX-279 security promotion and does not prove Graph inventory inclusion. T03 must track Graph promotion separately without creating a duplicate issue. Jira status for child issues not present in the supplied snapshot remains `NOT VERIFIED`.

Forge gate coverage is explicit: A0 evaluation freeze; A1 capability harvest; A2 capability matrix; A3 deduplication/refinement; A4 B0-B5 candidate construction; A5 benchmark harness; A6 quality gate; A7 efficiency gate; A8 evidence-driven architecture decision; A9 implementation; A10 adaptive directive; A11 dogfood/optimization; A12 stable contract. T08–T11 preserve this order and do not skip a gate. T12 is combined Kit integration acceptance, not Forge stable acceptance.

## Identity interpretation

The JSON ledger is authoritative for T01 observations. `NOT_VERIFIED` is a result, not an invitation to infer equality. In particular:

- development source is verified at `cdce74c7b75fae94ca99966bb80451afdb766e60`;
- the frozen accepted Technical Alpha source remains `a431ba9ad5fae7bd06329f1fc6e42f1ba503f6dd`, while its per-platform archive digests were not locally verified in T01;
- the Windows runtime revision `5b6ab08d...` is historical AFYX-265 evidence, not a current-runtime claim; macOS runtime identity is unknown;
- source extraction version is 28; every installed index must separately report its build version and freshness;
- Expert v0.1.0 historical evidence and v0.1.1 candidate evidence must never be pooled;
- Forge has definitions only: no frozen harness or B4/B5 candidate exists yet.

## Acceptance contracts

All contracts apply hard gates in this order: correctness, task fidelity, evidence quality, and security; efficiency is considered only after those gates pass. Provider-reported tokens, elapsed time, and observable tool calls may be compared. Monetary cost is `NOT AVAILABLE` unless the provider supplies a trustworthy value; it must not be estimated.

### Graph ON/OFF — PROVISIONAL

| Field | Contract |
|---|---|
| Public categories | Exact structural inventory; ranked navigation/relationship discovery; incremental freshness/restart; negative unsupported/ignored/path-safety cases |
| OFF | Direct source/Git-grounded inspection with Graph unavailable; same revision, prompt, permissions, and oracle |
| ON | Exact pinned installed Graph artifact and fresh extraction-v28 index; inventory for exhaustive supported facts, ranked tools only for navigation |
| Sampling | **PROPOSED:** four categories × ON/OFF × three fresh repetitions = 24 cells, deterministic interleaving and recorded seeds |
| Budget | **PROPOSED:** existing 27-run campaign ceiling; identical per-cell timeout and permissions; no unbounded retries |
| Hard acceptance | **PROPOSED:** 100% supported-fact ground-truth correctness, zero unauthorized access/mutation, zero fabricated completeness, all failures/ignored/unsupported files accounted for |
| Regression tolerance | **PROPOSED:** zero correctness/security regression versus OFF. Efficiency is descriptive until a stable paired baseline exists; no token/time win is claimed |
| Evidence | Archive SHA-256 and manifest, embedded revision, platform, extraction version, Git revision, index timestamps/state, discovery accounting, exact totals/pages, ranked limit/truncation, correlated result IDs |

Blocker before freeze: installed runtime/artifact and index identity are not verified, and the numeric efficiency non-inferiority margin has no approved empirical baseline.

Graph layer verdicts are independent: discovery decides eligible paths; extraction produces supported facts; persistence stores facts and diagnostics; freshness covers catch-up, reconciliation, restart and version drift; ranked retrieval is bounded relevance navigation; exact inventory is exhaustive only for supported values within its declared scope and coverage. A short ranked page is not evidence of missing indexing. A limited inventory page is not complete even when its rows are correct.

### Expert A1/B1 — PROVISIONAL

Expert aliases are `A0=N`, `A1=CORE`, `B0=X`, and `B1=CORE_X`. This B1 means Core plus Expert; it is unrelated to Forge B1.

| Field | Contract |
|---|---|
| Public categories | Architecture, security, database/reliability, ERP/Odoo composition, negative routing; DEVELOPMENT prompts may calibrate but are not private holdouts |
| A1 | Efficient Coding + Odoo Engineering + Prompt Master, exact frozen versions |
| B1 | Same A1 skills plus exact Expert candidate fingerprint; identical model, provider, reasoning, permissions, fixture, and prompt |
| Sampling | Existing discovery round: one fresh cell per scenario/configuration; confirmation only for ambiguity/failure, within 27 total runs. Formal repetition rule needs approval |
| Budget | Correlated `evaluation_run_id`, fresh workspaces, MXC/root-deny isolation, bounded child timeout and cleanup; same limits for A1/B1 |
| Hard acceptance | **PROPOSED:** every applicable cell passes all four gates; zero evaluator access; negative routing has no Afyx read/tool call; ERP observes distinct Expert/Odoo ownership; no fabricated execution |
| Regression tolerance | **PROPOSED:** zero loss of an A1 hard-gate PASS in B1. Start with one primary and at most two supporting domains unless evidence justifies expansion. Efficiency remains descriptive pending D.6 |
| Evidence | Environment/skill hashes, run/control IDs, observable skill/reference/workflow reads, sanitized output, independent-evaluator rubric verdicts, provider token fields, wall time, tool calls, mutation check |

Blockers: D.6 has not been independently verified by T01, the historical seven-reference disclosure defect remains a regression target, and formal repetition/efficiency thresholds are not approved. The reported D.5 5/5 result cannot substitute for D.6 or A1/B1.

### Forge B0-B5 — A0-A3 CONTRACT FROZEN / EXECUTION BLOCKED

The authoritative T08 specification, capability inventory/matrix, independent native behavior contract, and T09 prerequisites are in [AFYX_FORGE_A0_A3_CONTRACT.md](AFYX_FORGE_A0_A3_CONTRACT.md); its machine-readable identities and states are in [AFYX_FORGE_A0_A3_BASELINE.json](AFYX_FORGE_A0_A3_BASELINE.json).

A0 freezes six public categories against B0-B5 as a 36-cell, one-repetition discovery stratum. The Expert 27-run ceiling does not apply to this separate Forge campaign. The 36-cell Forge budget remains unapproved, and discovery `n=1` cannot establish comparative superiority. Correctness, task fidelity, evidence quality, and security are ordered hard gates; efficiency is evaluated only after they pass, with provider metrics recorded only when actually available.

Efficient Coding 1.2.0 has a verified source identity. The owner-authorized Independent Master Prompt is absent from the canonical repository and has no verified bytes, provenance, or digest, so B2/B3 remain blocked. B4/B5 are A4 construction work and do not exist. Exact campaign runtime identity and independent evaluator isolation also remain unresolved. T08 is complete as an A0-A3 contract foundation; T09 is **CONTRACT READY / EXECUTION BLOCKED**, A8 has no GO decision, and no Forge performance or architecture claim is made.

T09.P0 readiness is recorded in [AFYX_FORGE_T09_P0_READINESS.md](AFYX_FORGE_T09_P0_READINESS.md). B0, B1, and an evaluation-only B5 directive now have deterministic public identities; B2/B3 remain blocked by the missing authorized Independent Master Prompt, and B4 remains unconstructed. Six public synthetic fixtures and the 36-cell manifest validate deterministically without model calls. The proposed runtime still requires owner approval, Forge isolation is not independently verified, the evaluator bundle is not frozen, and the 36-cell budget remains unapproved. Status is **T09.P0 PREPARATION COMPLETE / BENCHMARK EXECUTION BLOCKED**.

T09.P1 adds deterministic disposable-workspace materialization for B0, B1, and B5 plus a fail-closed campaign authorization command. No new B2 or independently enforced evaluator environment was supplied, and none of the five runtime/budget/evaluator/execution approvals was granted. B3/B4 and the complete campaign fingerprint therefore remain unavailable. Status is **T09.P1 PREPARATION COMPLETE / EXTERNAL GATES BLOCKED**; T09 model execution and A8 remain blocked.

T09.P2A records owner-selected Route B through amendment `A0-ROUTE-B-2026-10-16`. The original B2 remains historically unresolved; a distinctly named Afyx-owned B2 0.1.0, exact ordered B3 composition, and refined B4 0.1.0 complete the six public candidate identities without model execution. Deterministic materialization and contamination checks apply to all candidates. Status is **CANDIDATE MATRIX COMPLETE / CAMPAIGN AUTHORIZATION BLOCKED** pending runtime, isolation, evaluator, evaluator-only bundle, both budgets, and final execution authority. A8 remains without a GO decision.

T09.E1.5 adds the fingerprinted public [secure evaluator handoff contract](AFYX_FORGE_T09_E1_SECURE_HANDOFF.md): strict developer/evaluator/restricted-agent boundaries, Windows-only per-cell lifecycle, sanitized schemas, negative isolation checks, cleanup, and owner review responsibilities. It excludes WSL and the owner's personal Ubuntu from formal execution and does not alter candidates, discovery order, budgets, or authorization. Status remains **CAMPAIGN BLOCKED**.

AFYX-286 adds the synthetic-only [public trusted-controller contract](AFYX_FORGE_AFYX_286_PUBLIC_CONTROLLER.md): exact manifest-bound input/output validation, safe disposable materialization, restricted-launch and artifact-validation interfaces, bounded evidence, mutation checks, and correlated cleanup. It contains no privileged launcher/provider implementation and does not convert owner-reported PR #60 evidence into independent acceptance. Owner integration, repeated synthetic acceptance, all seven authorization gates, and the formal `0/36` campaign remain blocked.

## T02 correctness closure and bounded T03 handoff

T02 used an owned, Git-tracked disposable Odoo-style fixture and an identified development build from implementation revision `7fe932892c06fb9aae873bafb686de0ff05be330`. The package is Afyx Graph `1.0.0`, extraction version 28; its temporary npm package SHA-256 is `56fc427324ea085aa61697c542a2f42c9c0bd4dc0c4f74b6025e4fe7f75d919d` and built CLI SHA-256 is `0bd19746ce165a317accd5b6d125155c9b64f0aac88a8325973883062f655456`. These identify a local development build only; no artifact was promoted or installed.

| Layer | Expected | Actual | Verdict |
|---|---|---|---|
| Discovery/scanning | Three scoped target files indexed; ignored/virtualenv excluded; sibling outside query scope may remain indexed | 4 discovered/eligible/indexed, 0 skipped/unsupported/failed; three target files plus one tracked sibling; ignored and `.venv` absent | PASS |
| Extraction | Nine supported scalar/list/tuple `_inherit` matches; `_name`, `sale.order.line`, comments/strings excluded; one dynamic expression unresolved | Independent Python AST and Graph agree on 9 declarations across 3 files/modules and one dynamic unresolved expression | PASS |
| Persistence | Exact paths, repeated class identity, line spans, module names survive storage | All nine rows and lines match AST ground truth; duplicate `SharedName` remains file-qualified | PASS |
| Freshness | Complete extraction-v28 index, current tracked tree, no pending change after reconciliation | `COMPLETE`, built/current extraction 28, `FRESH`, 0 pending after reconciliation, 0 pending references | PASS |
| Ranked retrieval | `limit=4` is a bounded relevance page, not inventory | Four rows shown with explicit truncation; full source population remains indexed | PASS |
| Exact inventory | Full query reports 9/3/3; limited query reports totals and incompleteness | Full CLI and actual MCP report 9 declarations, 3 files, 3 modules, complete coverage; limit 4 reports 5 remaining | PASS |

The historical nine-versus-four observation is reproduced as a retrieval-mode difference: ranked search at limit four returns four rows, while exact inventory over the same complete index returns all nine. It is not a remaining discovery, extraction, or persistence loss. The 45-versus-approximately-eight report has the same bounded-ranked-page explanation; the existing 45-declaration regression remains reused verified functionality.

One product defect remained. AFYX-282 made `afyx_graph_inventory` a default correctness route, but the older `<500`-file MCP tool filter retained only navigation tools and silently removed inventory after project initialization. The default actual MCP session therefore advertised only `afyx_graph_explore` on the small acceptance fixture. The minimal fix retains inventory in that filter; actual MCP now advertises `afyx_graph_inventory` plus `afyx_graph_explore`, and the inventory call returns the exact 9/3/3 result. No extraction, ranking, schema, index, or parser behavior changed, so extraction version remains 28.

Existing incremental coverage is reused and rerun: add raises 9→10, delete restores 9, rename moves stored paths without duplicates, modify produces 8 then restores 9, catch-up gates the query, and reopen preserves 9. A separate disposable reconciliation also removed a transient probe file and returned the index to 4 files, 35 nodes, 31 edges, and zero pending changes.

Local validation: focused inventory/routing 29/29 PASS; expanded sync/freshness selection 101/101 PASS; clean TypeScript/UI build PASS; semantic extraction-v28 additive contract and six-fixture historical baseline PASS; CLI/MCP smoke 21/21 PASS; identity, component, independence, and artifact-identity checks PASS. The full local Node 26 Windows suite is FAIL because of pre-existing/environmental TEMP cleanup `EPERM`, a Windows `which` fixture, and load-sensitive timeouts; isolated T02 and representative sync cases pass. Exact-final-head Node 24 Windows/Linux/macOS Graph Build remains the T02 closure authority and is recorded externally to avoid a self-referential documentation commit.

T02 closed at source/documentation HEAD `ad1560dd930ccde94b0dadaa7b42d804be55714f`. Exact-head [Graph Build 38700997957](https://github.com/a5zero7/afyx-codex-engineering-kit/actions/runs/38700997957) passed on Windows, Linux, and macOS. Its input to T03 is the accepted source revision, local build identity above, nine-declaration evidence, MCP exposure regression, and validation record. Installed Windows/macOS acceptance remains T04/T05 and was not performed here.

## T03 branch governance and promotion manifest

Observed branch topology on 2026-10-15:

| Role | Branch | Starting revision | Actual enforcement |
|---|---|---|---|
| Canonical integration | `main` | `5349c4a184e539f0ac0752d895ff3262c6326e29` | GitHub branch protection NOT CONFIGURED |
| Technical Alpha stabilization | `alpha` | `018dce0a31f927f2dc200c7be0bc8b71a8a3535c` | Policy documented; GitHub protection NOT CONFIGURED |
| Ordinary engineering | `dev` | `ad1560dd930ccde94b0dadaa7b42d804be55714f` | Tracks `origin/dev`; review required before Alpha promotion |

Historical refs `afyx/native-phase5f-parser-grammar`, `release/alpha-0.1`, and `afyx/afyx-279-alpha-security-promotion` are retained unchanged. PR [#59](https://github.com/a5zero7/afyx-codex-engineering-kit/pull/59) remains open against legacy `release/alpha-0.1`: it is mergeable/CLEAN and its recorded Windows/Linux/macOS CI and Graph Build checks pass, but no review decision is recorded. It must be approved and merged by its existing process before `alpha` is synchronized by verified non-force integration. T03 does not merge or retarget it.

The reviewable promotion is layered rather than a merge of all `dev`:

1. Preserve frozen candidate source `a431ba9ad5fae7bd06329f1fc6e42f1ba503f6dd` as historical rollback evidence.
2. Complete PR #59 security review and integrate its four commits (`5c5a4a5`, `637bdae`, `923cf1c`, `0ca928d`) into legacy Alpha through the existing review.
3. Synchronize the approved legacy Alpha result into `alpha` without rewriting history.
4. Create a Graph-only promotion from that exact security baseline. Include accepted AFYX-280 bounded-search prerequisites (`4572dc2`, `e508732`), AFYX-282/extraction-v28 inventory and acceptance (`d728a20`, `c16ff5c`, `ef8777a`, `0a9615d`, `2e81388`, `8837ea9`), and T02 MCP allowlist correction (`7fe9328`). Review the resulting patch rather than relying on commit ancestry alone.
5. Exclude Expert, Forge, evaluation harness, unrelated skill/installer changes, and all other development-only files. A direct PR #59-head-to-`dev` comparison contains 106 changed paths, including 75 non-Graph paths outside the bounded release/documentation/workflow scope, so merging all of `dev` is prohibited.

General CI now runs on pushes to `main`, `dev`, and `alpha`, and on pull requests to `main` or `alpha`. Graph Build runs path-filtered pushes to those three branches and path-filtered pull requests to `main` or `alpha`; it remains manually dispatchable. The stable Graph Release workflow is unchanged and must not be used for this Technical Alpha candidate.

Candidate identity remains pending until the scoped promotion is reviewed and merged. The required matrix is six inner archives—`win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64`, and `darwin-arm64`—each tied to the same exact `alpha` source SHA, package/product `1.0.0`, channel `technical-alpha`, Node `>=22.5.0`, extraction version 28, embedded revision, release manifest, and inner-archive SHA-256. GitHub wrapper ZIP digests are not accepted as archive identities. Publisher authenticity remains `NOT VERIFIED` unless independent attestation is established.

No new candidate artifact exists in T03 preparation. The T02 archive is a local development package, not a distribution candidate; therefore archive digests, retained downloads, isolated candidate installation, upgrade/rollback, and T04/T05 handoff are `NOT PERFORMED`. The local Node 26 Windows full-suite failure remains a supported-runtime compatibility risk: cleanup `EPERM` and missing Unix `which` are environment-specific in isolated evidence, while load-sensitive timeouts are not fully dispositioned. Node 24 is the cross-platform CI baseline; the published Node floor remains `>=22.5.0`. Candidate approval requires explicit Node 26 disposition rather than narrowing support or calling the local suite PASS.

## T03.1 workspace hygiene and evidence preservation

The active repository was verified on `dev` at `84a122f01fc15a58b07b9939960b3c7167dfc430`, equal to `origin/dev`. Before cleanup, the only tracked modification was generated `evals/results/latest-summary.json`; no staged or untracked file existed. The modified file was valid Expert v0.1.1 DEVELOPMENT evidence with schema 2, evaluation/control run `384826dee91d45f0a3388d5d276407ae`, five PASS cells, and SHA-256 `f14f5473107d7b85fc924cd0571ec55f6f60bf3574b91acf39c2f779e4857eaa`. This remains D.5 input only, not D.6 or formal A1/B1 acceptance.

The summary, correlated child-health/isolation controls, and five cell directories were copied through temporary staging into an owner-controlled evaluator archive outside the repository and developer/evaluated workspace roots. The archive contains 25 files / 252,383 bytes, including each available `result.json`, `events.jsonl`, `agent_response.txt`, and `stderr.log`; source-to-copy and final read-back hashes pass. Its inventory manifest SHA-256 is `799d34b5934928606954b6fb19b3f8b834e010224a558c85cdfcd527dd48e926`. ACL inheritance is disabled and only the owner and Windows SYSTEM retain access. Separate generated-prompt files were not available and that limitation is recorded in the private manifest. No raw response, transcript, canary, rubric, holdout, or private path is committed here.

After archive verification, only generated `latest-summary.json` was restored to its HEAD blob `08ce65dbfb651beaef00760848a269ed2b9b7201`. The historical tracked smoke schema 1 remains intact. Ignored run outputs remain locally available and were not deleted. Git cleanliness therefore does not imply that evaluation/runtime state is absent. Longer term, keep a deterministic tracked smoke fixture separate from an ignored/generated `latest` pointer, and preserve approved immutable run snapshots by run ID; changing that harness/output policy requires its own regression validation.

### Canonical branch classification

| Branch | Classification | Observed revision and relationship |
|---|---|---|
| `main` | CANONICAL_INTEGRATION | `5349c4a`; ancestor of `dev` |
| `dev` | ACTIVE_DEVELOPMENT | `84a122f`; 145 commits ahead of `main` at observation |
| `alpha` | ACTIVE_STABILIZATION_BLOCKED | `018dce0`; identical to legacy Alpha baseline |
| `afyx/afyx-279-alpha-security-promotion` | ACTIVE_REVIEW_PR_59 | `0ca928d`; four commits ahead of legacy Alpha |
| `release/alpha-0.1` | LEGACY_PRESERVED | `018dce0`; retained while PR #59 is open |
| `afyx/native-phase5f-parser-grammar` | LEGACY_PRESERVED | `ad1560d`; direct ancestor of `dev` |

No historical ref is deleted, renamed, rebased, force-pushed, retargeted, or merged. Redundant legacy refs may be considered for deletion only after PR #59 is resolved, every unique commit/release reference is accounted for, and the owner explicitly approves deletion.

### Environment Readiness & Closure Contract

Before every task:

1. Verify repository root, branch, HEAD/upstream equality, remotes/worktrees, runtime versions, and applicable fingerprints.
2. Enumerate and classify staged, tracked, untracked, ignored, runtime, and evaluation state; a clean Git status is not proof of a clean environment.
3. Resolve task-owned state or quarantine external/user-owned state with recorded provenance. Never use blanket add, clean, reset, or stash.
4. Confirm dependencies, authorization gates, and rollback before mutation.

After every task:

1. Validate the smallest affected scope and material regressions; inspect the final diff and side effects.
2. Commit and non-force push only task-owned files, then verify local HEAD equals upstream.
3. Verify required CI against the exact final SHA and read back GitHub/Jira writes rather than assuming success.
4. Record source, artifact, environment, runtime, and evaluation identities separately; update roadmap/Jira only from actual evidence.

Release work must use an isolated, verified-clean worktree/runtime. The active development worktree is not a release environment merely because `git status` is clean.

### Protection audit and proposal

GitHub reports `protected=false` for `main`, `alpha`, and `dev`; repository rulesets are empty. The authenticated API did not expose an account-plan capability value, so plan-specific enforcement remains `NOT VERIFIED`. Actual check-run names are only `linux`, `windows`, and `macos` under both `CI` and `Afyx Graph Build`. Requiring those ambiguous contexts directly could allow one workflow to be mistaken for the other.

Proposed, not enforced: prohibit force-push and deletion on all three branches; require reviewed pull requests plus separately identifiable applicable CI and Graph Build checks on `main` and `alpha`; permit routine non-force development on `dev` with CI and review for security/release-impacting changes. Before activation, use required-workflow rules if supported or rename job contexts so CI and Graph Build are unambiguous, confirm the repository plan and release-workflow permissions, and verify that the current contributor and PR #59 remain operable.

### Master-task stage map after T03.1

- T01–T02: completed engineering/documentation evidence in `dev` history.
- T03: governance prepared; immutable Graph promotion remains BLOCKED.
- T04/T05: installed Windows/macOS acceptance remains blocked until an approved artifact exists.
- T06: developer-side D.6 preparation is complete, but substantive review is blocked because no sanitized independent-review verdict is available; preserved D.5 evidence is input only.
- T07: formal A1/B1 remains blocked by T06.
- T08–T11: Forge Track A sequence remains unchanged; A8 GO is required before A9.
- T12: combined Kit integration acceptance remains blocked by component acceptance.

## T06 Expert D.6 review preparation

Decision: **BLOCKED — REVIEW PREPARED / SUBSTANTIVE REVIEW NOT EXECUTED**.
This is not `KEEP`, `REVISE`, or `REJECT`: the developer session verified the
candidate and D.5 provenance but did not cross the owner/evaluator trust
boundary. No Expert source, frozen evidence, evaluator-only material, or
candidate identity changed.

The reviewed identity is Expert `0.1.1`, subject revision
`8df29c3f9e31aa4661cc1e7d6f80328096e3f1ce`, directory-content SHA-256
`06d947c595f164ed1ad94e8ef97aa412a3ec7559c5f79cb467f0ec1ad488095c`,
MXC environment SHA-256
`6203b5dd2f016fade8b04c1d2fd02be5ed8bf24763d1a4404e6931cbb4447c6c`,
D.5 run `384826dee91d45f0a3388d5d276407ae`, and archived-evidence manifest
SHA-256 `799d34b5934928606954b6fb19b3f8b834e010224a558c85cdfcd527dd48e926`.
The archive remains owner-only and was not opened by the developer session.

| Scenario | Observable D.5 evidence | Provider counters (input / cached / output / reasoning) | Wall time / reads | D.6 verdict |
|---|---|---:|---:|---|
| Architecture | Expert observed; automated PASS | 51,621 / 44,032 / 3,764 / 433 | 80.971 s / 5 | SUBSTANTIVE REVIEW BLOCKED |
| Database/Reliability | Expert observed; automated PASS | 51,568 / 40,192 / 2,614 / 483 | 62.614 s / 5 | SUBSTANTIVE REVIEW BLOCKED |
| ERP/Odoo | Expert + Odoo Engineering observed; automated PASS | 72,632 / 59,136 / 4,195 / 1,602 | 80.918 s / 3 | SUBSTANTIVE REVIEW BLOCKED |
| Negative Routing | no skill and no tool call observed; automated PASS | 15,511 / 11,520 / 36 / 0 | 6.271 s / 0 | SUBSTANTIVE REVIEW BLOCKED |
| Security | Expert observed; automated PASS | 51,670 / 44,032 / 3,057 / 332 | 69.070 s / 5 | SUBSTANTIVE REVIEW BLOCKED |

All five records report first-pass success, return code 0, no timeout, cleanup
success, unchanged canonical fixture, and zero wrong-version API findings.
These operational results do not establish substantive correctness, task
fidelity, evidence quality, unsupported-claim absence, domain/reference
appropriateness, or security. Total-token and monetary-cost values were not
available and are not inferred. Separate generated-prompt files were not
archived, limiting exact prompt-to-response review. The historical Case A
seven-reference progressive-disclosure defect remains `OPEN`; the narrow
Odoo-only exclusion is `NOT TESTED` by these five records.

Bounded owner/evaluator handoff:

1. The owner invokes an independent evaluator outside developer and evaluated-agent roots.
2. The evaluator receives read-only access to the owner-controlled D.5 archive and public candidate source, while rubrics, canaries, and holdouts remain evaluator-only.
3. The evaluator assesses each scenario independently for correctness, task fidelity, evidence quality, and security, including routing, domain/reference/workflow selection, unsupported claims, progressive disclosure, and recorded tool failures.
4. The evaluator emits only a sanitized, signed or hashed conclusion tied to the identities above; raw responses, events, rubrics, holdouts, and private paths remain unpublished.
5. The conclusion records `KEEP`, `REVISE`, or `REJECT` with provenance. Narrow Odoo exclusion remains `NOT TESTED` unless a separately authorized evaluation covers it.

Until that conclusion exists, the candidate is not frozen as review-passed,
T07 is blocked, and this evidence has no Alpha or release implication.

T06.R0 environment assessment is recorded in
[AFYX_T06_R0_EVALUATOR_READINESS.md](AFYX_T06_R0_EVALUATOR_READINESS.md).
The current same-principal Windows/Codex arrangement is `BLOCKED`: no distinct
trusted-evaluator identity exists, so mandatory cross-principal denial controls
were not executed. This is an environment verdict only, not a D.6 candidate
verdict.

## Graph coverage audit and universal file catalog foundation

The development-index observation at source baseline
`100b66d88c903812f063ea4c6149e5af88b0ea89` reported 1,032 discovered, 872
eligible/indexed, 160 unsupported, and zero failed files. The top unsupported
extensions were Markdown 81, JSON 42, PowerShell 18, shell 10, and PowerShell
module 3. The installed runtime was Afyx Graph 1.0.0 at source revision
`5277bea70a46dcc7046a53cc4d3f8c8470462ff0`, extraction version 28, with
publisher authenticity `UNVERIFIED`; it was observed only and was not changed.

The audit confirmed unsupported files were removed at extension admission before
the `files` table, so the table conflated structural indexing with catalog
membership. The bounded correction admits generic Markdown and JSON as
metadata-only catalog entries and persists an explicit `metadata`, `content`, or
`structural` indexing level. Markdown/JSON content is not put into nodes, edges,
FTS, or symbol search. Shopify template/section JSON retains Liquid extraction;
PowerShell and shell native extraction remains follow-up scope. Schema v10 adds
only the file-depth column; structural extraction remains version 28 because no
parser fact contract changed.

Security and scope stay fail-closed: ignore rules run before admission, ignored
path counts/names remain unenumerated, and evaluator-like ignored directories do
not enter the catalog. A disposable regression covers full indexing,
add/modify/delete/rename, scoped catch-up, restart/persistence, deterministic
accounting, unsupported PowerShell/shell, and absence of metadata content from
search. Candidate promotion, installed-runtime replacement, Expert evaluation,
PR #59, and Alpha branches are outside this change.

The final source-build audit used a separate `.afyx-graph-catalog-audit` state
directory and left the active index/runtime unchanged. It measured 1,034
discovered, 997 eligible/indexed, 127 metadata-indexed (82 Markdown, 42 JSON,
3 YAML), 0 content-indexed, 870 structurally indexed, 0 skipped, 37 unsupported,
and 0 failed. The two-file discovery increase from the 1,032 observation is the
subsequent roadmap document plus this task's new regression file; it is not a
forced match to the earlier 995/1,032 projection. Remaining unsupported files
are PowerShell 18, shell 10, PowerShell module 3, CSS 2, Go module 2, HTML 1,
and SQL 1. Timings on Windows/Node 26.8.1 were scan 467 ms, parse/store 3,345 ms,
resolution/link 6,246 ms, maintenance 120 ms, total 11,455 ms (12.239 s CLI
wall time). A deterministic 2,000-file reconciliation micro-benchmark recorded
medians of 3.992 ms no-op, 4.051 ms modify, 3.165 ms add, 4.609 ms delete, and
2.554 ms rename; these are descriptive measurements, not a cross-version speed
claim.

## Jira comment drafts — not posted

### AFYX-279

> T03 preparation established `dev` at T02 final source `ad1560dd930ccde94b0dadaa7b42d804be55714f` and `alpha` at legacy stabilization baseline `018dce0a31f927f2dc200c7be0bc8b71a8a3535c`; historical branches remain unchanged. PR #59 is OPEN, mergeable/CLEAN, and its recorded 3-OS checks pass, but no review decision is recorded. The scoped promotion manifest includes the accepted AFYX-280 prerequisites, AFYX-282 extraction-v28 inventory changes, and T02 allowlist fix while excluding Expert, Forge, and other development-only paths. No candidate SHA or archive digest exists yet. Status: PREPARED / PROMOTION BLOCKED pending PR #59 approval, verified Alpha synchronization, scoped promotion review, exact-source CI, retained six-target artifacts, inner-archive SHA-256 verification, isolated acceptance, and Node 26 compatibility disposition. No merge, release, install, or Jira status change was performed.

> T03.1 standardized the active development workspace on `dev` without changing the Alpha baseline or PR #59. `main`, `alpha`, and `dev` are not protected and no ruleset exists; protection recommendations remain proposed because actual check names collide across CI and Graph Build. Historical branches are classified `LEGACY_PRESERVED`, not deleted. The worktree was cleaned only after D.5 evidence was archived and verified. Promotion status remains BLOCKED.

### AFYX-248

> T02 is complete: exact-head Graph Build 38700997957 passed Windows/Linux/macOS at `ad1560dd930ccde94b0dadaa7b42d804be55714f`, with AST and exact inventory agreeing on 9/3/3 and tiny-repository MCP advertising Inventory plus Explore. T03 branch governance and a bounded Graph-only promotion manifest are prepared, but promotion is blocked by unresolved PR #59 review and no candidate artifact has been created. T04/T05 remain blocked; no IJP/Adit install or acceptance was performed. The local Node 26 full-suite failure remains explicitly recorded as a supported-runtime compatibility risk pending disposition.

> T03.1 preserved the T02/T03 development baseline while separating clean Git state from ignored runtime/evaluation state. No Graph candidate, install, PR merge, or T04/T05 acceptance occurred. `dev` is synchronized and the release worktree isolation contract is documented.

### AFYX-283

> T01.1 preserves Expert v0.1.1 identity separately from historical v0.1.0. AFYX-283 is externally reported In Progress. T06 owns D.6 substantive review and candidate freeze; T07 owns controlled A1/B1 acceptance and cannot start before T06. The reported D.5 5/5 evidence, isolation contract, hard quality gates, and progressive-disclosure regression target remain unchanged. No evaluation was run and no status was changed.

> T03.1 archived Expert v0.1.1 DEVELOPMENT D.5 run `384826dee91d45f0a3388d5d276407ae` outside the repository under owner-only ACL before restoring generated `latest-summary.json` to the historical schema-1 HEAD blob. The archive contains 25 correlated control/raw files with verified source/final hashes; manifest SHA-256 is `799d34b5934928606954b6fb19b3f8b834e010224a558c85cdfcd527dd48e926`. Separate generated-prompt files were unavailable and are recorded as a limitation. This is D.5 input only; D.6 remains open and formal A1/B1 remains blocked. No raw evaluator material was committed.

> T06 developer-side preparation verified Expert v0.1.1 identity, MXC fingerprint, D.5 run correlation, and sanitized per-scenario routing/operational counters. No sanitized independent evaluator verdict exists, and the owner-only archive was not opened by the developer session. Decision: BLOCKED — REVIEW PREPARED / SUBSTANTIVE REVIEW NOT EXECUTED. ERP/Odoo observably loaded Expert + Odoo Engineering and Negative Routing loaded no skill/tool, but all five substantive scenario verdicts remain blocked. Historical seven-reference progressive-disclosure is OPEN; narrow Odoo-only exclusion is NOT TESTED. Candidate source and fingerprints are unchanged; no model run or formal A1/B1 occurred. T07 remains blocked pending an independently produced sanitized KEEP/REVISE/REJECT conclusion.

### AFYX-12

> T01.1 preserves Forge Track A in the current Alpha development cycle without making it a frozen-v1 blocker. AFYX-12 is externally reported To Do. T08 owns A0–A3, T09 owns A4–A8, T10 owns A9–A10 only after an A8 GO, and T11 owns A11–A12. T12 is combined integration acceptance. The B0–B5 contract remains provisional; no Forge benchmark, implementation, promotion, or status change occurred.
