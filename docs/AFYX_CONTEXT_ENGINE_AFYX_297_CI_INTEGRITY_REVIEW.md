# AFYX-297 — CI signal integrity and ACE stack owner-review packet

Status: **LOCAL CORRECTION PASS; PUBLICATION AND EXACT-HEAD CI PENDING**

Date: 2026-10-23

Base: AFYX-296 / PR #89 at
`b51b51d24d68a9fc30d4454e48cbf27d227ccae8`, tree
`61c1d6b3ab6116545b591f73ec72c903875afedc`.

Candidate branch: `afyx/afyx-297-ci-signal-integrity`.

## Stack identity and evidence authority

GitHub was read directly on 2026-10-23. Every PR was Open, Draft, Mergeable,
and based on the preceding branch. Git ancestry checks also passed for every
adjacent HEAD.

| PR / Jira | Exact HEAD | Tree | Effective public diff | Published exact-head runs |
|---|---|---|---:|---|
| #84 / AFYX-290 | `594452d4722d4135ef04643639c1ad16c2c5e681` | `fc355efe23c53fe6c67c083096b7fc22fcf4d69f` | 22 files, +1550/-0 | Context `39585857550`; CI `39585857575` |
| #85 / AFYX-291 | `c3d29fcdae020818370510d17286a80be686d649` | `1e4f9c193ce266075ed471971e624ba5f349c7b1` | 9 files, +11199/-1 | Context `39671064428`; CI `39671067398` |
| #86 / AFYX-292 | `943727d9a450442daca46bd01bb710a172c53650` | `74b7f28e58a006e285f6cdc7b6b890332dd55cd3` | 9 files, +854/-19 | Context `39713153309`; CI `39713158179` |
| #87 / AFYX-293 | `473e1efd3a3da4c926638e77ec898a3d66200cf9` | `0d707c6db99de4047f90244dfac65f9ed8a07f45` | 14 files, +954/-1 | Context `39717395764`; CI `39717399179` |
| #88 / AFYX-295 | `54b4832204a9465d93e166ea780d07f39e0cdf25` | `7965aaaea4d5b501a47905ab7a20b8e7a99703dd` | 6 files, +298/-29 | Context `39920501186`; CI `39920509855` |
| #89 / AFYX-296 | `b51b51d24d68a9fc30d4454e48cbf27d227ccae8` | `61c1d6b3ab6116545b591f73ec72c903875afedc` | 15 files, +758/-31 | Context `39929350087`; CI `39929354350` |

The run conclusions above are verified GitHub facts, but the Repository CI
Windows conclusion is not equivalent to test-level success before this
correction. Raw Windows logs for #88 job `120304327301` and #89 job
`120333490822` each contain the same eight failures. Later successful Python
commands caused both PowerShell steps to return zero. Context Build does not use
that execution pattern.

## False-green mechanism and correction

The affected Windows workflow placed six validation commands and nine test
commands in two multiline PowerShell blocks. PowerShell exposed the exit code
of the last native command; it did not aggregate earlier native exit codes. A
disposable reproducer ran a required command returning 7 followed by a
successful command. The old pattern exited 0. The corrected pattern still ran
both commands and emitted both outputs, but exited 1.

Both blocks now enumerate the same required Python invocations, retain their
output, check `$LASTEXITCODE` after every invocation, and exit nonzero if any
command failed. A regression covers both the masked-failure case and the
all-pass case. Workflow permissions remain `contents: read`; no dependency,
error suppression, `continue-on-error`, or coverage reduction was introduced.

## Eight-failure differential

Relevant workflow, test, and implementation blobs are byte-identical at #88
and #89, and both raw logs have equivalent assertions and outputs. The failures
therefore predate AFYX-296.

| Failures | Reproduction and cause | Classification | Bounded correction |
|---|---|---|---|
| 2 legacy adoption subtests (`efficient-coding`, `odoo-engineering`) | Windows hosted checkout converted the tracked 1.1.0 fixtures to CRLF. Exact legacy-content provenance then correctly returned `UNKNOWN` instead of adopting content whose digest differed. | Test-fixture portability defect; installer fail-closed behavior was correct. | Pin only the historical legacy fixture tree to LF in `.gitattributes`; do not weaken digest or ownership checks. |
| 6 project detector tests | PowerShell derived an addon root with `Substring($Root.Length)`. Windows supplied a short/long path spelling mismatch, producing `ect/addons` or `ect/custom_addons`. The traversal depth expression also expanded into separate stack elements, so depth did not advance. | Product path-normalization/resource-bound defect. | Carry relative directory identity during traversal and increment depth as one parenthesized value; do not derive identity from lexical absolute-path length. |

Candidate focused evidence is 5/5 legacy adoption, 15/15 cross-shell project
detection, and 3/3 CI-signal tests PASS on Windows. The GitHub-hosted Windows
fixture behavior remains an exact-new-head gate, not an inferred pass.

## Combined ACE assessment

The stack remains **Standalone by Design, Integrated by Contract**. ACE is
default-OFF, Graph has no mandatory ACE dependency, and a valid Graph result is
authoritative on ACE unavailable/throw/timeout/malformed/incomplete outcomes.
Protected source, diagnostic, and security evidence stays inline. References
are owner/session/source-bound and exact recovery verifies content digests.

AFYX-292/295 serialize local state, record a distinct child PID, terminate only
the owned child, wait for confirmed close before fallback, and recover only
same-host locks whose owner is proven absent. Foreign, malformed, live,
cross-host, and inconclusive locks remain fail-closed. Coordination is not a
distributed lease; filesystem ACL and plaintext retention remain caller-owned.

The implementation uses native repository source and Node built-ins. The only
ACE development dependency is pinned `js-tiktoken` 1.0.21; it is not a runtime
package dependency. Headroom remains an external comparator. Equivalent
isolated Headroom A/B is BLOCKED and provider billing/resource claims are
NOT_RUN.

The authoritative AFYX-296 local dogfood evidence remains R3. R1 stopped and R2
has an invalid operator-supplied candidate identity, so neither is authoritative.
R3 records raw 34 tokens and net 173 after recovery: **+139 tokens regression**.
It supports selective default-OFF behavior only, not token savings or default ON.

## Validation and unresolved boundaries

| Evidence | Result |
|---|---|
| Deterministic old-pattern reproduction | PASS — earlier exit 7 was masked to exit 0 |
| Corrected aggregation negative/positive regression | PASS — 3/3 |
| Eight focused Windows failures | PASS — 20/20 (5 legacy + 15 detector) |
| ACE clean build and complete suite | PASS — 9 runtime files; 53/53 |
| AFYX-291 comparative smoke | PASS correctness; Headroom comparison BLOCKED |
| AFYX-293 real Graph consumer | PASS — external disposable state, source preserved |
| AFYX-296 combined dogfood | PASS — default OFF/fallback/recovery/isolation; raw 34, net 173 |
| ACE package dry-run | PASS — 14 files, 69.4 kB unpacked |
| Engineering Assurance | PASS — schema and 13/13 tests |
| Workflow YAML and permissions | PASS — parsed; `contents: read` |
| Full repository Python suite on native Windows | FAIL — 249 tests, 25 Forge POSIX/WSL environment errors; not relabeled PASS and outside AFYX-297 correction |
| Full Graph Windows suite (preserved) | FAIL — 5,683 PASS, 29 FAIL, 31 skipped |
| Exact-new-head Windows/Linux/macOS CI | NOT_RUN — public push requires separate owner authorization |

The Graph engine tree is identical on #88 and #89 at
`a5417e97769d17f44f627e2c986ed829c4f6888c`. Existing differential evidence
classifies eight Graph failures as passing on serial rerun, twenty as Windows
cleanup EPERM, and one as POSIX `which` portability. Identical source does not
make the complete suite pass. AFYX-278 remains the owner of that broader
Node26/Windows fixture, teardown, and portability campaign.

## Owner integration and rollback

Recommendation: **CONDITIONAL GO for owner review**, not approval. Publish the
AFYX-297 branch only after explicit owner authorization, create one Draft PR
based directly on #89, then require exact-head Context Build and Repository CI
on Windows, Linux, and macOS. Repository CI must be judged by both job status
and inner test results.

If accepted, integrate in order #84, #85, #86, #87, #88, #89, then AFYX-297.
After each merge, retarget only the next PR, verify the expected reviewed HEAD
is still its source, and confirm its effective diff contains only that layer.
Use owner-authorized merge commits so each layer is independently reversible.
Rollback proceeds in reverse order. Operational rollback remains leaving ACE
disabled/removing the optional consumer call; retained ACE state is not deleted
automatically. No step authorizes deployment, default activation, Alpha
promotion, or runtime/configuration mutation.

## Acceptance gates

| Gate | Verdict |
|---|---|
| `STACK_AND_BASELINE_IDENTITY` | PASS |
| `FALSE_GREEN_REPRODUCTION` | PASS |
| `STRICT_CI_EXIT_PROPAGATION` | PASS locally; exact-host confirmation pending publication |
| `EIGHT_WINDOWS_FAILURE_DIFFERENTIAL` | PASS locally; exact-host confirmation pending publication |
| `NO_COVERAGE_WEAKENING` | PASS |
| `GRAPH_WINDOWS_AND_AFYX_278_BOUNDARY` | PASS |
| `ACE_STACK_NONREGRESSION` | PASS for scoped suites; broader failures retained above |
| `CROSS_PLATFORM_EXACT_NEW_HEAD` | NOT_RUN |
| `OWNER_REVIEW_DECISION_PACKET` | PASS |
