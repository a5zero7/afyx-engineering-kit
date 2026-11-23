# AFYX Universal Integration — Real Host Acceptance Gate

**Scope:** integrated draft PR #12, based on `dev`. This is an acceptance procedure, **not a PASS certificate**. Never reconfigure the owner's daily IDE, overwrite a foreign skill, read real secrets, bypass mandatory hooks, or merge to `dev` without review.

## 1. Verified source gate

- Owner Windows focused check on original integration source `70599bd4e64de08f5b554d5be5df8b8282b436da`:
  `node --test --test-concurrency=1 scripts/tests/test_native_universal_integration.mjs scripts/tests/test_native_skill_broker.mjs scripts/tests/test_capability_orchestrator.mjs scripts/tests/test_host_bridge.mjs scripts/tests/test_universal_runtime.mjs`
  → **57 PASS / 0 FAIL**. `python scripts/validate-components.py` → **PASS (7 components)**.
- The later workflow-only commit `ed075eea515d13ce051e34f0d19f72391acb1666` adds that serialized focused test gate to CI on Windows, Linux and macOS. It does **not** change JavaScript runtime/test files. Do not label its hosted CI passed until runners actually run.
- Running those five files in parallel initially gave 55/57 with two subprocess/timeout failures; sequential execution passed 57/57. Treat process contention as **probable, not proven**, and do not raise production timeouts solely to mask it.

## 2. Actual host acceptance (Codex first, Antigravity second)

Use an **isolated disposable workspace and provider test profile**, with installed component identities and project/revision recorded. Before starting, verify the actual MCP launch command resolves to the **candidate source**, not the user's existing production AFYX installation. Do not modify a provider's global settings without owner approval.

For each real host **in a fresh session**, capture all of:
1. **REGISTERED:** MCP host lists `afyx_workflow` from the verified candidate executable.
2. **DISCOVERED:** host reports installed AFYX components with real source identities, health and permission state; never fabricate these from a task.
3. **SELECTED / INVOKED:** real agent chooses and calls `afyx_workflow` for a bounded Odoo/relational task in the disposable repository.
4. **EXECUTED:** Graph adapter returns actual structural evidence with real source location/model. For eligible sufficiently large evidence, Context follows only when enabled and receives the bounded **executed Graph result**; no invented evidence or unrelated component calls.
5. **RESULT_CONSUMED:** the agent's *final answer* explicitly uses at least one verifiable detail from that same tool result (source path, symbol, relationship) and identifies that tool-derived evidence. Tool registration, invocation or raw output alone **does not pass** this gate.

Negative cases: known-file/direct-source task executes zero optional AFYX calls; explicit Context OFF stays OFF; missing permission prevents invocation; Forge autonomous execution remains A8-gated; Usage Tracking stays passive and provider-scoped. Record exact source SHA, provider version, tool transcript identifiers, output evidence, and `PASS / FAIL / NOT TESTED`.

## 3. Native skill lifecycle boundary

`scripts/afyx-skill-engineering.mjs` provides an AFYX-owned **source API** for create, revise, validate, package, preview, host-approved apply, verify, recover and rollback. Its targeted Node acceptance passed on PR #11 and its source is unchanged in the integration tree.

**Important limitation:** Product inventory declaring `afyx-skill-engineering` as `SOURCE_READY` is *not* proof of provider parity. A separately gated **in-process trusted host adapter** is now implemented in `scripts/afyx-native-skill-host.mjs` (see [AFYX_NATIVE_SKILL_HOST_ADAPTER.md](AFYX_NATIVE_SKILL_HOST_ADAPTER.md)). It is unavailable without an explicit host-owned exact write plan, a trusted synchronous approval callback, and positive host authorization. The default CLI/MCP launch does **not** grant this write capability. The adapter has source/mock acceptance only until exact-head Node filesystem tests and real provider fresh-session discovery/invocation pass. Never accept model-supplied approvals.

A disposable real-host lifecycle acceptance must prove `create → validate → package → install → provider discover → fresh-session invoke → verify → optional rollback`, using only an isolated provider skill root and explicit trusted approval. The original OpenClaw skill-creator stays installed until this acceptance is confirmed and owner authorizes retirement.

## 4. Credential Broker boundary

`AfyxCredentialBroker/v1` is source-ready with synthetic backend and one-shot host-approved consent. There is **no accepted real 1Password backend** and no authorization to read vault secrets. Real credential-provider parity remains **DEFERRED**; do not grant a production-ready label or remove the external 1Password skill on synthetic tests alone.

## 5. Release and closure sequence

1. Keep PR #9/#10/#11 available as source provenance. PR #12 is the reviewable combined candidate; never blind-merge conflicting orchestrator changes.
2. Run required normal pre-push/ownership/hygiene gates on an isolated candidate checkout. Previous 5,836 Graph PASS belongs to a different SHA and is not exact-head integrated acceptance.
3. Restore GitHub-hosted CI. Its current Windows/Linux/macOS/installer jobs fail with **zero steps**; determine account/runner error from owner GitHub UI. No reason to repeatedly rerun these jobs or guess that billing is definitively responsible.
4. Pass real Codex and Antigravity `RESULT_CONSUMED`, and lifecycle parity/approval as applicable. Keep AFYX-312 provenance, AFYX-313 native host lifecycle, AFYX-314 conditional backend, AFYX-315 external retirement and AFYX-320 global independence clearance separate.
5. Only after approved, evidence-backed gates may PR #12 become ready for merge and Jira items change to Done. Record skipped/deferred cases explicitly; never inflate PASS from mock simulation.
