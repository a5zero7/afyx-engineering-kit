# AFYX Forge T09.E4 WSL synthetic lab

Status: **BOUNDED WSL LAB PASS / FORMAL CAMPAIGN UNCHANGED AND BLOCKED**

Date: 2026-10-17 (Asia/Jakarta)

Jira: AFYX-285

Baseline: `6dbeeeeddd670d068bf9e35dd5cb81921e8b1ac0`

This is new public synthetic integration evidence for the accepted Forge
controller and retention interfaces. It is not a benchmark cell, model run,
private-evaluator test, or amendment of the native-Windows formal campaign
contract. The frozen manifest, B0-B5 candidates, public fixtures, source
identities, and historical evidence are unchanged.

## Bounded implementation

`evals/forge/wsl_lab.py` supplies a Linux-only lab recorder, verifier, and
launcher through the existing `EvidenceRetentionRecorder`,
`EvidenceReceiptVerifier`, and `RestrictedProcessLauncher` interfaces. The
launcher runs exactly one fixed Python child in isolated mode with a sanitized
environment. The fixed child writes the known synthetic artifact and emits
fixed stdout/stderr; it never imports or executes materialized workspace
source.

Before workspace creation and launch, the recorder durably creates a readiness
record. The launcher captures the complete original byte streams and process
state into a separate evidence root. Capture binds the pre-existing readiness
record by digest. Finalization re-reads and verifies original sizes and SHA-256
digests before creating the finalization record. The verifier independently
rechecks the retained records and uses persistent one-use challenge markers to
reject replay. Controller cleanup remains a later, separately reported step.

The adapter deliberately runs as the current WSL user. It makes no restricted
identity, evaluator independence, privilege separation, or archive durability
beyond the local filesystem claim.

## Actual WSL execution evidence

Observed on Linux `6.6.114.1-microsoft-standard-WSL2`, x86_64. Raw originals
were retained outside the disposable execution workspace and were not added to
Git or printed in this record.

| Observation | Result |
|---|---:|
| Fixed child exit | `0` |
| Controller result | `PASS` |
| Readiness accepted before capture | `PASS` |
| Finalization accepted before successful result | `PASS` |
| Disposable workspace cleanup | `PASS` |
| Originals still readable after workspace cleanup | `PASS` |
| stdout original | 30 bytes / `608b1aa2874936fadc195af4893afc55142c114e15aa82269d6a73cdb7caf049` |
| stderr original | 30 bytes / `85d4f53e69ce8a402be53e7ad4865165cd89ae9c017794bb04d83ac0b3fe5d98` |
| Public stdout digest equals retained original | `PASS` |
| Public stderr digest equals retained original | `PASS` |

All four evaluator-only hard gates remained `NOT_TESTED`; the lab did not
promote them from that state.

## Focused validation

The seven new actual-subprocess tests cover the successful lifecycle and these
six negative paths:

- capture failure after one observed subprocess start;
- truncated stdout with incomplete upstream coverage;
- tampered retained original;
- readiness-receipt replay;
- timeout with process-group interruption, retained terminal state,
  finalization, and cleanup;
- cleanup failure recorded independently after successful finalization.

Observed results:

- new WSL lab tests: `7/7` PASS;
- WSL lab plus directly impacted controller/readiness tests: `58/58` PASS;
- fixture/materialization validation: PASS;
- Python compilation and `git diff --check`: PASS.

The accepted deterministic `178/178` repository result from AFYX-285 is reused
as historical regression evidence and was not rerun or relabeled as new WSL
evidence.

## Properties still not proven

This same-user WSL subprocess does **not** prove independent evaluator control,
restricted-identity isolation, non-admin token behavior, evaluator-storage
denial, credential containment, network policy, native-Windows behavior, WSL
exclusion, Task Scheduler suitability, signed/immutable archival storage,
crash/power-loss recovery, or formal campaign authorization. No private
material, evaluator bundle, model, or B0-B5 benchmark cell was used.

The native-Windows handoff remains authoritative and the seven campaign gates
remain unresolved. Final campaign status remains **CAMPAIGN BLOCKED — 0/36**.
