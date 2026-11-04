# Phase 7 — Engineering Assurance and Prompt Master Default Retirement

Status (2026-10-20): **FROZEN IMPLEMENTATION ACCEPTED BY OWNER / FOCUSED VALIDATION PASS / OWNER MERGE DECISION PENDING**.

Phase 6 PR #79 was merged into `dev` as merge commit
`8e7220499dd44cda5d80636078cae97129a7adf4`. Its tree SHA
`46d819827fa8873b18dd0e19307df5e1fae9b603` exactly matches the reviewed
Phase 6 HEAD `b7fddb76264244803d723cca5537f9e2ddc0238c` tree. Phase 7 PR #80
was retargeted to `dev`, preserving its Phase 7-only effective diff. Earlier exact-source
CI [39285510592](https://github.com/a5zero7/afyx-codex-engineering-kit/actions/runs/39285510592)
was SUCCESS on Windows, Linux, and macOS at source HEAD
`325107b2f4689066e3d900e319875a6467712f45`. That evidence predates this
status-only documentation correction; final exact-head CI must be checked against
the current PR HEAD and its GitHub checks, not inferred from this document.
PR #80 remains Draft/unmerged until a separate owner merge authorization.
No automatic merge, active-runtime replacement, Alpha promotion, or Forge execution is authorized.

## Phase 6 boundary review

| Checkpoint | Result |
|---|---|
| PR #79 exact source identity | PASS — `b7fddb76264244803d723cca5537f9e2ddc0238c` |
| CI run `39227026045` | PASS — Windows, Linux, macOS |
| Ownership-aware scope and preservation | PASS from reviewed source and focused evidence |
| Owner isolated Windows install/post-install/idempotency evidence | OWNER_OBSERVED_PASS; independently attributable installed-runtime attestation NOT VERIFIED |
| Native-Windows repository suite | FAIL retained — 25 Forge POSIX/WSL environment errors, no Phase 6 assertion failure |
| Independent review / owner merge decision | Independent-person review WAIVED_BY_OWNER / NOT_PERFORMED for Phase 6; PR #79 owner-authorized merge completed |

## Frozen-v1 preset amendment

| Preset | Desired components |
|---|---|
| Minimal | Efficient Coding + Odoo Engineering |
| Recommended | Minimal + Afyx Engineering Expert |
| Full | Recommended + Afyx Graph + platform-applicable Usage Tracking |
| Custom | Explicit ordered operator selection, including Prompt Master when deliberately requested |

Prompt Master remains an upstream-owned `EXTERNAL` component with its historical
provenance and rollback contract intact. Default install, update, repair, verify,
Recommended, and Full paths neither fetch nor require it. Existing user-owned or
disabled state is preserved. Explicit Custom/component actions retain the pinned,
fail-closed upstream lifecycle. This is default retirement, not a Forge replacement.

## Assurance contract

`scripts/engineering-assurance.json` defines the frozen vocabulary. The validator
`scripts/validate-engineering-assurance.py` validates the contract by default and
optionally a task record:

```text
python scripts/validate-engineering-assurance.py
python scripts/validate-engineering-assurance.py --record <record.json> --expected-head <40-char-sha>
```

The record declares its Task Contract baseline, source SHA, relevant-source digest,
acceptance revision, allowed/changed scope, and evidence-backed ground truth. The
validator is deliberately a record-schema validator: these source, scope, CI, and
evidence identities are `SELF_DECLARED`, not independently discovered facts. Its
successful record result is `SCHEMA_VALID` with
`INDEPENDENT_VERIFICATION_REQUIRED`; a reviewer or trusted automation must still
verify the Git source/diff and CI identities before acceptance.
Validation Level 1 requires static and focused evidence; Level 2 adds negative and
regression evidence; Level 3 adds security and rollback evidence. Mutation,
differential, and measured performance proof are mandatory only when their risk flags
are set. Performance uses a numeric value, threshold, comparator, and unit and can
never override correctness or security failure.

Only `PASS`, `FAIL`, `NOT_RUN`, and `BLOCKED` are accepted. An `AFFIRMATIVE`
Ground Truth claim requires `PASS` evidence. A separately classified
`NEGATIVE_OBSERVATION` may cite only `FAIL`, `BLOCKED`, or `NOT_RUN`, preserving
real negative evidence without allowing it to prove success. `NOT_RUN` needs an
`UNSUPPORTED`, `DEFERRED`, or `ENVIRONMENT` disposition and reason. `FAIL`/`BLOCKED`
needs an owner, resolution, and expected acceptance evidence; required-v1 failures
block readiness. Evidence reuse requires matching relevant-source digest, acceptance
revision, and scope fingerprint plus no new relevant failure. Validation-budget
overrun needs an explicit reason.

`MERGE_READY` requires a record declaring a clean baseline, no scope violation,
eligible ground truth, the risk-level test set, and explicit CI/documentation PASS
evidence. This is schema-valid merge-readiness input, not independent acceptance.
The canonical lifecycle remains:

```text
PLANNED → ANALYZED → IMPLEMENTED → VALIDATED → DOCUMENTED → MERGE_READY
```

## Requirement-to-implementation matrix

| Requirement | Implementation | Status |
|---|---|---|
| Task Contract / Baseline / Scope / Ground Truth | Canonical repository-relative scope validation, status-eligible claims, and explicit self-declared authority | PASS |
| Risk Levels 1/2/3 | Cumulative required test kinds | PASS |
| Mutation / Differential Proof | Conditional risk flags and named PASS evidence | PASS |
| Performance Gate | Numeric threshold-bound measurement | PASS |
| Adaptive budget / evidence reuse | Budget-overrun justification and exact relevance binding | PASS |
| Failed/skipped classification | Closed vocabulary and fail-closed metadata rules | PASS |
| CI / docs / merge readiness | Explicit gates tied to canonical lifecycle | PASS |
| Prompt Master default retirement | Unified component plan and lifecycle entrypoints | PASS |
| Daily-runtime compatibility | PASS in disposable focused workflows; active user runtime NOT TOUCHED |
| Exact-source cross-platform CI | PASS at prior source HEAD `325107b2f4689066e3d900e319875a6467712f45` (run `39285510592`); post-documentation HEAD must have its own verified result |

Local focused evidence: component contract PASS; engineering-assurance 13/13 PASS;
control-plane 11/11 PASS. The current native-Windows scripts suite executed 240
tests with zero assertion failures and 15 environment errors in the same three Forge
POSIX/WSL modules: three synthetic-image compiler-path cases, six WSL-container
identity cases, and six WSL-lab identity cases. This current result is `FAIL`; the
earlier 25-error run remains separate historical `FAIL` evidence and is not rewritten.
Broader unchanged regression evidence may be reused only where its source and
acceptance scope remain valid. Historical source validation and final current-head
checks are tracked on PR #80, not inferred from static documentation.

## Owner acceptance and separate residual scope (2026-10-20)

Under the Solo-Maintainer policy, the owner accepts the frozen Phase 7 implementation
and explicitly accepts the following broader legacy outcomes as **outside this
frozen Phase 7 merge acceptance**, with separate tracking. Acceptance is not a PASS,
completion, or cancellation of any residual; scheduling and entry-gate applicability
must be evaluated separately before their relevant downstream acceptance decisions:

| Residual | Jira | Actual evidence | Disposition |
|---|---|---|---|
| Formal comprehensive security assessment | AFYX-58 | NOT_RUN; targeted guards/regressions PASS only | Deferred from frozen Phase 7 merge acceptance; remains open |
| Broader runtime reliability and recovery campaign | AFYX-59 | NOT_RUN; bounded transaction/rollback regressions reused | Deferred from frozen Phase 7 merge acceptance; remains open |
| Resource / peak-memory measurement | AFYX-62 | NOT_RUN | Deferred from frozen Phase 7 merge acceptance; remains open |
| Actual representative performance benchmark | AFYX-63 | NOT_RUN; threshold schema fixture PASS is not measured benchmark | Deferred from frozen Phase 7 merge acceptance; remains open |

Phase 7 independent-person review is `WAIVED_BY_OWNER / NOT_PERFORMED`; the owner
accepts the corresponding review-independence risk. No formal independent GitHub
APPROVE is claimed, and repository branch protection, actual test evidence, and
Forge independent-evaluator/holdout isolation gates are not waived. This is frozen
scope acceptance **only**, not owner authorization to merge PR #80. The prior
native-Windows 240-test repository result remains FAIL with 15 Forge POSIX/WSL
environment errors and zero assertion failures; the earlier 227-test/25-error run
remains a distinct historical FAIL.

## Limits and Phase 8 handoff

Phase 7 is development assurance only. Phase 6 has merged into `dev`; Phase 7
is frozen-scope owner-accepted but PR #80 has **not** merged and requires a separate
owner merge instruction. Solo-Maintainer waiver does not create independent review.
Neither this acceptance nor Prompt Master default retirement replaces the active
runtime, activates Alpha, or authorizes a release. T05 Adit remains
`DEFERRED BY OWNER`. T09 remains `BLOCKED — 0/36`; A8 has no GO decision and
production Forge is not implemented. Phase 8 begins only after accepted integration
and the relevant entry gate, using this evidence where source, acceptance, and failure
identity remain applicable.
