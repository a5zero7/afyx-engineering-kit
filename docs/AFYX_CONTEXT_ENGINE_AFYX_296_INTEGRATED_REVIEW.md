# AFYX-296 — Integrated ACE stack review and combined Graph–ACE dogfood

Status: **LOCAL INTEGRATED REVIEW PASS; PUBLICATION AND EXACT-HEAD CI PENDING**

Date: 2026-10-23

Base: AFYX-295 / PR #88 at `54b4832204a9465d93e166ea780d07f39e0cdf25`

Candidate branch: `afyx/afyx-296-integrated-ace-review`

## Scope and provenance

The reviewed stack is linear and preserves the five frozen Draft PR identities:

| PR | Scope | Verified HEAD |
|---|---|---|
| #84 | ACE foundation | `594452d4722d4135ef04643639c1ad16c2c5e681` |
| #85 | comparative benchmark | `c3d29fcdae020818370510d17286a80be686d649` |
| #86 | multi-process coordination | `943727d9a450442daca46bd01bb710a172c53650` |
| #87 | Graph–ACE integration | `473e1efd3a3da4c926638e77ec898a3d66200cf9` |
| #88 | worker recovery | `54b4832204a9465d93e166ea780d07f39e0cdf25` |

GitHub reported every PR Open, Draft, and mergeable, with #88 based directly on
#87. Exact-head #88 Context Build `39920501186` and Repository CI
`39920509855` were independently read as SUCCESS on Windows, Linux, and macOS.
The historical AFYX-295 document's pre-CI `PENDING/NOT_RUN` statement remains an
immutable point-in-time record; the later verified runs above supersede only its
operational status.

The implementation is native repository source. Package-lock v3 contains the
root package plus `js-tiktoken` and its platform-neutral helper only; there are
no ACE runtime dependencies. The tokenizer is development-only and pinned to
`1.0.21`. No customer source, installed runtime, global configuration, existing
Graph index, provider route, or historical evidence was used or changed.

## Material findings and bounded corrections

Three concrete lifecycle defects were closed without changing the optional,
default-OFF Graph contract.

1. `nativeAceRunner` could throw synchronously from IPC serialization (for
   example, a `BigInt`) before owning cleanup of the already-spawned worker. A
   deterministic reproducer returned the serialization error but left the Node
   process alive beyond ten seconds. The runner now catches synchronous and
   asynchronous send failure, spawn/child errors, timeout, and unexpected exit;
   terminates its owned child; waits for `close`; and rejects
   `ACE_TERMINATION_UNCONFIRMED` if termination is not confirmed within the
   bounded grace period.
2. The integration timeout timer was unreferenced. A standalone process with a
   hung injected runner could exit before producing authoritative Graph
   fallback. The bounded timeout now remains live until fallback or the
   termination boundary completes. A subprocess regression proves both output
   and process quiescence.
3. Cross-host lock liveness at the timeout boundary nondeterministically
   reported either `LOCK_TIMEOUT` or `LOCK_RECOVERY_UNSAFE`, depending on which
   side of the clock check executed first. The acquisition loop now evaluates
   recovery safety before final timeout classification and deterministically
   preserves the fail-closed `LOCK_RECOVERY_UNSAFE` result.

Focused tests cover successful IPC response, spawn failure, synchronous and
callback send failure, child error, timeout, confirmed termination, unexpected
exit, unconfirmed termination, and the standalone no-other-handles case. No
path reports safe fallback while an owned child is still unconfirmed.

## Controlled combined dogfood

The tracked fixture at
`afyx-context/test-fixtures/integrated-dogfood-repo` is a synthetic Odoo-like
repository with Python models, a manifest, cross-file references, repeated and
unique facts, an XML view, and CSV access data. Its identity is
`sha256:e13412cd03ddd1b7b001f5a0b3c4c0f7c584b9f1e2ff52fccb667e463a17a2b2`.

The harness creates four separate roots: fixture source copy, external Graph
state, ACE states, and evidence. It executes the real built Graph `ToolHandler`,
not a mocked query, and verifies source fingerprints before and after. The
preserved final evidence is generated under a task-owned local staging path
that is intentionally not part of the public source diff.

The authoritative run is `r3`, bound to implementation commit
`c3bcc92a7021e492705759a2d109b7c7a584080b`, at
`.afyx-report-staging/afyx-296-integrated-c3bcc92-20261023-r3/evidence/integrated-dogfood.json`
with SHA-256
`1f6757cb9e092dc66bf030fe79962e93f36c531845500ebc351ec7dae8cdcf43`.
The earlier `r1` stopped before producing a report. The completed `r2` is
rejected for identity evidence because its operator-supplied candidate SHA had
an incorrect suffix; both directories remain preserved and neither was
overwritten.

Observed local outcomes:

- ACE OFF returned the exact Graph result.
- ACE ON optimized the repeated result and exact recovery reproduced the full
  original bytes; unique content remained `original`.
- source, diagnostic, and security evidence all remained inline as `original`.
- inventory completeness and an intentionally bounded partial page were both
  detected; Python and XML source paths remained present.
- unavailable, malformed, timeout, and incomplete adapter results returned the
  exact authoritative Graph result with bounded failure codes.
- concurrent same-state access completed; an actually interrupted worker
  returned `ACE_TIMEOUT`, left no live lock, and same-state retry succeeded.
- foreign-session recovery and unsafe overlapping state failed closed.
- no `.ace-lock` or `.tmp` artifact remained, and both copied and tracked
  fixture fingerprints were unchanged.

## Cost and latency observation

Using pinned `js-tiktoken` `1.0.21`, encoding `o200k_base`, the representative
repeated query measured 34 raw tokens, 67 gross ACE consumer tokens, 72
reference-request tokens, and 34 recovered-original tokens. Net recovery cost
was 173 tokens: a regression of 139 tokens versus raw. The authoritative local
observation measured 0.817 ms OFF, 115.142 ms first ON, 108.641 ms repeated ON,
and 107.495
ms recovery. These values are tokenizer context accounting and local wall-clock
observations, not provider billing or a generalized performance claim.

This workload therefore supports selective default-OFF use only; it does not
support default ON or a token-savings claim. Comparable Headroom A/B remains
BLOCKED. Process memory and CPU were NOT_RUN.

## Validation

| Evidence | Result |
|---|---|
| ACE clean build | PASS — 9 runtime files |
| ACE complete suite | PASS — 53/53 |
| Combined real Graph–ACE dogfood | PASS |
| AFYX-293 real-consumer E2E | PASS |
| Comparative harness smoke | PASS — correctness PASS; Headroom comparability BLOCKED |
| Graph clean production build | PASS |
| Graph targeted standalone/dispatch/semantic/input suite | PASS — 45/45 |
| Graph complete Windows suite | FAIL — 5,683 PASS, 29 FAIL, 31 skipped; failures were cleanup EPERM, host timeouts/daemon lifetime, and Windows-unavailable `which`, outside changed Graph source |
| Package dry-run | PASS — 14 files, 69.4 kB unpacked |
| Engineering Assurance | PASS — schema and 13/13 tests |
| `git diff --check` | PASS |
| exact-candidate three-OS CI | NOT_RUN pending separate public-push authorization |

The Graph complete-suite FAIL is retained as FAIL. It is not relabeled PASS;
the passing clean build, targeted 45-test suite, AFYX-293 E2E, and combined
dogfood isolate the changed integration boundary from those Windows host issues.

## Acceptance matrix

| Gate | Verdict | Basis |
|---|---|---|
| `STACK_IDENTITY_AND_PROVENANCE` | PASS | Exact PR identities, ancestry, lockfile, and ownership reviewed |
| `INCREMENTAL_AND_COMBINED_REVIEW` | PASS | Five incremental diffs plus combined implementation audited |
| `TERMINATION_AND_COORDINATION_BOUNDARIES` | PASS | Three defects corrected; complete lifecycle tests PASS |
| `GRAPH_OFF_AND_STANDALONE_REGRESSION` | PASS | Exact OFF output, Graph build, targeted Graph tests, and real E2E PASS |
| `REAL_COMBINED_E2E_AND_EXACT_RECOVERY` | PASS | Real queries, selective output, and exact retrieval PASS |
| `FAILURE_SECURITY_AND_ISOLATION` | PASS | Negative cases, protected evidence, fingerprints, and cleanup PASS |
| `COST_SELECTIVITY_AND_MEASUREMENT_INTEGRITY` | PASS | Gross and net regression disclosed; no billing/savings inference |
| `CLEAN_DISPOSABLE_EXECUTION` | PASS | Separate external roots; no source mutation or leaked ACE artifacts |
| `CROSS_PLATFORM_EXACT_HEAD` | NOT_RUN | Requires separately authorized public push and exact-head CI |
| `OWNER_DECISION_PACKET` | PASS | Reproducer, corrections, tests, limitations, and next boundary documented |

## Recommendation and next boundary

Technical recommendation: **CONDITIONAL GO for owner review**, conditioned on
exact-candidate Windows/Linux/macOS Context Build and Repository CI. This is not
merge approval, runtime activation, or Alpha authorization.

After owner-reviewed source integration, the next separately authorized task
should install the exact accepted artifact in one new disposable runtime lab,
keep Graph and ACE state external and isolated, run OFF/ON/fallback/recovery
smoke against only the tracked synthetic fixture, verify active runtime and
global configuration fingerprints, and stop with an owner activation handoff.
It must not activate ACE by default or modify a daily-use installation.
