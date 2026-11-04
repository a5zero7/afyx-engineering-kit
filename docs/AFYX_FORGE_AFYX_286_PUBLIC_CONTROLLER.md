# AFYX-286 public trusted-controller contract

Status:

- **PUBLIC IMPLEMENTATION READY**
- **OWNER INTEGRATION PENDING**
- **FORMAL CAMPAIGN BLOCKED — 0/36**

This record covers only the independently reviewable developer-side contract. It implements no privileged controller, provider client, Windows account integration, Task Scheduler deployment, private evaluator bundle, rubric, holdout, scoring, or benchmark execution. The authoritative trust boundary and schemas remain [T09.E1 secure evaluator handoff](AFYX_FORGE_T09_E1_SECURE_HANDOFF.md); this document does not introduce a competing campaign contract.

Public baseline: `63f528e24ed0b4b0217b8db3666ed8b7dd06bebd`. Jira: [AFYX-286](https://afifbendol.atlassian.net/browse/AFYX-286). Draft [PR #60](https://github.com/a5zero7/afyx-codex-engineering-kit/pull/60) is treated only as owner-reported sanitized synthetic evidence and is not merged or reclassified as independent runtime acceptance.

The fail-closed follow-up contract is documented in [AFYX-285 Forge evidence-retention gate](AFYX_FORGE_AFYX_285_EVIDENCE_RETENTION.md).

## Public architecture

`evals/forge/controller.py` provides four bounded layers:

1. `validate_cell_input` checks the exact public schema against the frozen manifest: scenario prompt and command, candidate identity and activation, fixture/environment fingerprints, frozen cell identity, canonical allowed paths, timeout bound, and zero retries.
2. `DisposableWorkspaceManager` creates one correlated workspace below a caller-owned root and cleans only its registered lease. Source and workspace trees reject traversal, links, junctions, mount/reparse points, and conflicting materialization.
3. `RestrictedProcessLauncher` and `ArtifactValidator` are protocols only. Developer tests inject fakes. No implementation in this repository launches a model, authenticates a provider, changes host configuration, or assumes owner/evaluator privileges.
4. `PublicController` records bounded output digests and sizes, actual file mutations, artifact checks, identity/timeout/process-tree status, sanitization, and correlated cleanup. Raw stdout, stderr, transcript, prompt, credentials, and private evidence are not public result fields.

The controller copies the canonical public fixture and exact selected candidate into a fresh workspace, rechecks content after copying, snapshots bytes before and after the injected launcher, and rejects mutations outside `allowed_file_scope`. `DigestArtifactValidator` performs deterministic LF-normalized content validation for synthetic artifacts; a process exit code of zero without matching content still fails.

Canonical artifact hashing is parity-tested against the authoritative `evals/forge/validate.py` `canonical_content()` / `file_sha256()` contract for LF, CRLF, isolated CR, mixed endings, chunk-boundary line endings, and invalid UTF-8 raw-byte fallback. The implementation remains streaming and bounded; it does not require whole-file buffering.

## Public interfaces

- Input is schema version 1 from the E1 handoff and must match one exact manifest cell.
- `LaunchRequest` supplies the controller's forbidden-output markers to the injected launcher. `RestrictedProcessLauncher.launch(LaunchRequest)` returns the observed restricted identity, exit state, bounded output, timeout, owned-process-tree termination, provider-reported token values when available, tool-call count, and retry count.
- `ProcessOutcome` must explicitly report per-stream upstream capture truncation (`stdout_upstream_truncated` / `stderr_upstream_truncated`). If an upstream stream is truncated, `*_stream_scan_complete` and `*_stream_forbidden_marker` attest whether its complete byte stream was scanned by the independently reviewed launcher. Missing/invalid metadata or an unseen, unverified suffix fails closed with `upstream_output_unverified` and `sanitization: FAIL`. A detected marker fails with `unsafe_output_marker`. The controller's published `evidence.*_truncated` only describes its own digest-preview capture limit; it is **not** an upstream completeness guarantee. The owner must verify that the actual launcher's scan and truncation attestations reflect observed streams; synthetic/fake assertions alone do not establish this.
- `ArtifactValidator.validate(...)` must be implemented so validation also executes inside the restricted boundary. It returns a command exit status and at least one content check; the trusted controller must never execute agent-modified source as owner/evaluator.
- Workspace inventory uses configurable file-count, per-file-size, aggregate-byte, and deadline limits with streaming hashing. A limit breach fails closed, skips artifact validation, and still performs correlated cleanup.
- Public metadata is allowlisted: only manifest-approved modified paths, canonical provider token counters, one aggregate artifact-validation verdict, bounded lifecycle state, and stable failure codes are publishable. Unknown filenames and adapter keys remain restricted and are never copied into the public result.
- Output contains every canonical `result_schema.required_fields` entry plus public candidate/environment identities, allowlisted mutation inventory, lifecycle state, bounded evidence metadata, and sanitization status. `PublicController.result` is the operational execution verdict and is intentionally limited to `PASS` or `FAIL`; evaluator-only hard gates retain `BLOCKED` and `NOT_TESTED` for conditions that cannot be decided from public execution evidence. The frozen manifest schema is unchanged. All four private quality gates remain `NOT_TESTED` until the independent evaluator applies its private rubric.

## Fail-closed behavior

The public implementation rejects malformed or extra schema fields, unknown cells, scenario/candidate/activation drift, fingerprint mismatch, unsafe or non-canonical paths, source/workspace reparse points, materialization conflicts, non-zero retries, identity mismatch, timeout, unexpected termination, incomplete process-tree termination, file-scope violations, incorrect artifacts, unsafe output markers, and failed cleanup. Error reporting exposes stable codes rather than untrusted output or private paths.

## Deterministic developer validation

Synthetic tests cover successful materialization and cleanup plus malformed input, fingerprint drift, traversal/reparse rejection, restricted-identity mismatch, timeout, unexpected termination, incomplete process-tree cleanup, cleanup failure, forbidden output markers (including past the controller publication limit), missing/invalid upstream capture metadata, unverified truncated suffix, verified bounded streaming-scan attestations, unsafe nested public metadata, unauthorized mutations, retry-policy drift, raw-output publication rejection, exit-zero with incorrect content, bounded inventory failures, and canonical-hash parity. They make no model/provider call and use no private material.

Developer-reported local validation on final public implementation source commit `e4d4c5d6067a06720cc9349982dbce885ca83e37`: controller `29/29`, Forge focused/readiness `41/41`, deterministic repository `168/168` PASS; static manifest and fixture/materialization validation, Python compilation, `git diff --check`, and frozen manifest/candidate/fixture identity comparison also PASS. The zero-model CI workflow now includes pull requests targeting `dev`; remote CI remains a separately observed requirement and must not be inferred from local results.

Commands:

```text
python -m unittest scripts.tests.test_forge_controller -v
python -m unittest scripts.tests.test_forge_readiness -v
python evals/forge/validate.py --check-fixtures
python -m py_compile evals/forge/controller.py scripts/tests/test_forge_controller.py
```

## Security limitations and owner-only handoff

This code does not prove Windows OS isolation, credential containment, WSL exclusion, network policy, Task Scheduler suitability, actual restricted-token launch, or process-tree termination. Fakes prove contract handling only. The seven campaign authorization gates remain unresolved and the benchmark remains `0/36`.

The unresolved authorization gates are:

1. `OWNER_APPROVED_RUNTIME_CONFIGURATION`
2. `INDEPENDENTLY_ENFORCED_EVALUATOR_ISOLATION`
3. `EXPLICIT_36_CELL_BUDGET_APPROVAL`
4. `EXPLICIT_CONFIRMATION_BUDGET_APPROVAL`
5. `INDEPENDENT_EVALUATOR_ARRANGEMENT_APPROVAL`
6. `FINAL_CAMPAIGN_EXECUTION_APPROVAL`
7. `EVALUATOR_ONLY_BUNDLE_FREEZE`

Before any privileged or model execution, the owner/independent evaluator must:

1. review this exact source revision independently and implement the launcher and validator outside developer control;
2. bind them to the approved native-Windows restricted identity without forwarding owner/evaluator credentials, profiles, WSL, shared mounts, undeclared MCP endpoints, or private storage;
3. ensure model and validation processes, including agent-modified code, run only inside the restricted boundary with bounded timeout and owned-process-tree cleanup; independently verify the launcher's per-stream bounded capture, complete streaming scan and upstream truncation metadata, including adversarial unseen-suffix cases;
4. repeat positive and adversarial synthetic acceptance through the actual controller and preserve raw evidence privately;
5. publish only a sanitized integrity-verifiable attestation, then obtain each remaining owner approval separately.

Implementation readiness is not deployment approval, isolation acceptance, campaign authorization, A8 GO, or benchmark authority. Final campaign status: **CAMPAIGN BLOCKED — 0/36**.
