# AFYX Alpha Stabilization — Evidence-First Execution Preflight

**Status:** PREPARATION IMPLEMENTED; REAL PILOT `NOT_RUN`; COMBINED ACCEPTANCE `BLOCKED`

**Authority:** [AFYX_V1_MASTER_ROADMAP.md](AFYX_V1_MASTER_ROADMAP.md), 2026-10-27 expanded v1 finalization contract.

**Starting source baseline:** `dev` at `b273b7b27ba33838075c86870e0b8a58fdbaca95` (observed from GitHub).

**Dependency:** [PR #139](https://github.com/a5zero7/afyx-codex-engineering-kit/pull/139) is Draft. Its default-on provider companion work does **not** prove installed Graph–ACE MCP runtime activation; a separately validated native runtime owner, recovery, and explicit-OFF contract is still required.

## What this increment delivers

- One explicit, conservative [acceptance ledger](AFYX_ALPHA_ACCEPTANCE_LEDGER.json) with 18 release-blocking expanded-v1 gate identities and six prospective Phase 8 real-workload scenarios. All remain `NOT_RUN` or `BLOCKED`; no historical synthetic result is silently promoted.
- A standard-library-only, offline `scripts/alpha_acceptance_preflight.py` consistency checker. No Graph indexing, agent/model calls, telemetry scanning, private data reading, installation, release or Git modification.
- Negative regressions against missing evidence, identity mismatch, Forge A8 jump, absent independent-review provenance, incomplete representative scenarios, forged artifact claims and unsafe output destinations.
- A useful `BLOCKED` report rather than a fabricated green release verdict. `READY_FOR_INDEPENDENT_REVIEW` (if every claim has the required record and prerequisites) is **not** `RELEASE_READY`, an evaluator verification, or owner release consent.

This uses the existing `scripts/phase8-representative-workload.mjs`,
`scripts/phase8_event_ledger.py` and `scripts/phase8_evidence_discovery.py`;
it is **not** a second benchmark engine or model-call orchestrator. Existing
historical default-OFF fixture conclusions remain scoped to their historical
candidate. They do not override the new default-available installation policy
or prove native Graph-to-ACE execution.

## Run the non-mutating preflight

In the canonical development checkout:

```powershell
python scripts/alpha_acceptance_preflight.py
python -m unittest scripts.tests.test_alpha_acceptance_preflight -v

# An intentional non-zero status (3) while a required gate is pending:
python scripts/alpha_acceptance_preflight.py --require-review-ready
```

Portable shell commands are identical. Optional `--expected-source-sha` binds
claims to an exact approved candidate SHA. Optional `--output <new-file>`
creates a **new** sanitized report without overwriting existing evidence.
Use a private/local output directory for working acceptance records; no raw
prompt, source snippet, credentials, private repository identity, or provider
telemetry belongs in GitHub/Jira comments.

The default ledger has **no candidate SHA or installed artifact digest**.
These cannot be inferred from GitHub source CI. When a real, immutable
candidate is produced, an owner-reviewed update can provide its exact source
SHA, signed/verified artifact digest, scope-specific evidence references and
qualified verifier roles. The checker only validates record shape and
dependencies; an independent evaluator or owner must verify the underlying
evidence bytes and conclusions separately.

## The six real-workload scenarios

| Scenario | Workload | Required interpretation |
| --- | --- | --- |
| `KNOWN_SYMBOL_DIRECT` | Small known-symbol lookup | Direct-source routing may outperform Graph; do not force Graph |
| `ODOO_CROSS_MODULE` | Multi-module Odoo inheritance/impact | Controlled direct-source versus Graph; preserve authoritative Odoo domain facts |
| `PYTHON_REGRESSION` | Medium Python debugging/test selection | Identical source, task, test oracle and validation conditions |
| `TYPESCRIPT_MONOREPO` | Large multi-package dependency impact | Observe Graph stale/unsupported coverage and direct fallback |
| `ACE_LARGE_REPEAT_RECOVERY` | Large repeated context | Verify useful selective invocation, exact recovery, protected-output bypass and explicit OFF |
| `PROVIDER_RESTART_ROLLBACK` | Multi-provider lifecycle | Installed configuration read-back, restart, ownership, idempotency, rollback, safe uninstall |

For controlled pairs, freeze repository commit/tree, task, model/effort,
provider and available tools, permission policy, test oracle and budgets before
either run. Record both positive and negative outcomes. Correctness/security
and required evidence are gates; performance or token cost is compared only
after quality passes. Unknown billing counters remain `NOT_AVAILABLE`, never
observed zero. Record startup/indexing costs separately from task latency.

Tests must operate on **approved, disposable clones** with independent Graph
and ACE state. No uncontrolled indexing of customer/private repositories; no
hidden model run or unsanctioned benchmark budget. Use only sanitized,
scope-verified references in the public ledger. Raw evidence and evaluator-only
holdout/canary/rubric material remain outside developer and candidate roots.

## Execution order, with truthful dependencies

1. **Graph–ACE native integration gate:** close PR #139's remaining native MCP
   wiring, session/recovery, explicit-disable and actual provider restart/read-back.
   A passing provider skill test is not native MCP acceptance.
2. **Alpha installed pilot:** after an exact candidate is built and reviewed,
   use `D:\Project\afyx-alpha` **only** for clean install/update and smoke
   acceptance. All source builds/patches remain under
   `D:\Project\workspace\afyx-codex-engineering-kit`.
   The pilot has **not** been run by this increment.
3. **Phase 8 paired dogfood:** run the six bounded scenarios on authorized data.
   Existing synthetic fixture evidence and AFYX-64 historical observations can
   guide setup, but cannot substitute for a new candidate's real-workload proof.
4. **Independent evaluation:** Expert D.6 and Forge formal 36-cell A5–A7 require
   their own evaluator isolation, external custody and explicit budget authority.
   A8 is a separate evidence-bound decision. A9–A12 cannot run under an assumed GO.
5. **Platform Track B / Phase 9:** complete TB7 provider compatibility and real
   fault/rollback/packaging matrix with applicable Windows/Linux/macOS limitations.
6. **T12 and release:** build a distinct signed **Unified Kit** candidate only
   after the upstream gates. Then Phase 10 Private Beta, followed by Phase 11
   Stable v1. T12 is not fulfilled by a Graph-only Technical Alpha artifact.

## Reporting rules

- **`PASS`** is a scoped acceptance claim requiring an exact source identity,
  an artifact identity where relevant, a sanitized evidence reference and the
  proper verification role. It does not imply the validator audited the evidence.
- **`NOT_RUN`** means no verified run for the current candidate, even if old
  evidence or source code exists.
- **`BLOCKED`** means a prerequisite or authorization gate is missing.
- **`FAIL`** is a negative observed result, not a reason to erase the test.
- The preflight produces `BLOCKED` or `READY_FOR_INDEPENDENT_REVIEW`, and
  **never grants** release readiness or permission to merge, publish or run models.

Next readiness decision should use observed evidence, not completion percentages.
