# Afyx Forge T09.E1 Secure Evaluator Handoff

Status: **PUBLIC CONTRACT PREPARED / CAMPAIGN BLOCKED**

Date: 2026-10-16

Scope: public-side execution and evidence contract only; zero benchmark cells executed.

This document binds the public handoff required before an owner may authorize the Forge B0-B5 campaign. It contains no evaluator credentials, protected paths, canary values, private rubric, ground truth, scoring rules, holdout content, or evaluator-only evidence.

## Trust boundaries

```text
developer identity
  -> public source, candidates, fixture, schemas, sanitized attestations only

trusted evaluator identity
  -> independently controlled evaluator storage and private scoring material
  -> reviews and freezes the runner; never executes developer/agent code as owner

restricted evaluated-agent identity
  -> one disposable Windows workspace and exact public cell input only
  -> no evaluator storage, owner profile, WSL, shared mounts, or host administration

trusted controller/model runner
  -> bounded process launch as the restricted identity
  -> only owner-approved provider connectivity; no general agent network access
```

The developer cannot administer the evaluator environment or receive evaluator credentials. The evaluated agent cannot traverse to evaluator material. The trusted evaluator must not open, source, import, or run developer-authored or agent-generated scripts with owner/evaluator privileges. Any privileged setup or collection code must be independently reviewed and owned by the trusted evaluator; untrusted work runs only as the restricted identity.

## Allowed runtime

- Formal cells run on the frozen, owner-approved Windows runtime using the restricted evaluated-agent identity.
- PowerShell or command execution is allowed only when declared by the public scenario and bounded to the disposable workspace.
- The owner's personal Ubuntu and every WSL distribution are excluded from formal execution, discovery, fallback, mounts, path translation, and cleanup.
- Optional Graph, Headroom, external MCP, credential forwarding, shared clipboard/folders, and host management endpoints remain unavailable unless a later reviewed runtime amendment explicitly authorizes them.
- Provider connectivity, if approved, terminates at the trusted controller/model runner. A disconnected evaluated workspace must not be misrepresented as proof that a hosted model is reachable.

## Public cell input contract

The controller constructs one canonical JSON input per cell from frozen public material:

```json
{
  "schema_version": 1,
  "evaluation_run_id": "public correlation identifier",
  "control_run_id": "matching isolation-control identifier",
  "cell_id": "deterministic frozen cell identifier",
  "candidate": {
    "id": "B0-B5",
    "content_sha256": "frozen candidate fingerprint",
    "activation": "frozen materialization contract"
  },
  "scenario": {
    "id": "public scenario identifier",
    "category": "frozen category",
    "user_prompt": "exact frozen public scenario prompt",
    "fixture_sha256": "frozen public fixture fingerprint",
    "allowed_file_scope": [],
    "validation_command": null
  },
  "environment_sha256": "owner-approved runtime fingerprint",
  "limits": {
    "timeout_seconds": 0,
    "model_retries": 0
  }
}
```

Only the exact manifest `user_prompt`, public fixture files, candidate material, allowed relative paths, and approved limits enter the evaluated workspace. Coding scenarios carry their exact manifest command array; advisory scenarios preserve `validation_command: null` and do not invent a command. The private rubric, answers, scoring logic, holdouts, canary, evaluator paths, credentials, and owner environment details must never appear in the input, workspace, process environment, tool descriptions, logs, or transcript.

## Per-cell lifecycle

1. **Correlate:** verify campaign/source/candidate/fixture/environment/bundle attestations and allocate fresh run and control IDs. Any mismatch invalidates the cell before launch.
2. **Initialize:** create a new empty workspace owned by the restricted identity. Reject symlinks, junctions, mount points, or other reparse points in its ancestry and materialized tree.
3. **Materialize:** copy the exact public fixture and candidate in the frozen order; rehash inside the workspace; deny undeclared files and inherited credentials.
4. **Preflight:** prove the expected non-admin identity, Windows-only runtime, permitted workspace read/write, evaluator-storage denial, absent WSL route, bounded tools, and sanitized environment.
5. **Execute:** the trusted controller launches one bounded child process as the restricted identity. It never launches the cell as owner/trusted evaluator and never evaluates generated code in a privileged process.
6. **Validate:** when `validation_command` is non-null, run only that declared public command; advisory cells run no invented validation command. Collect exit status when applicable, bounded stdout/stderr, mutation inventory, tool events, provider-reported usage, timeout, and process-cleanup evidence.
7. **Evaluate privately:** the trusted evaluator applies private hard-gate and scoring material outside the workspace and outside developer/evaluated-agent visibility.
8. **Sanitize:** emit only the public result schema below. Scan output for credentials, private paths, canary markers, rubric/holdout fragments, prompts, and unexpected source content before release.
9. **Clean:** terminate the owned process tree, verify no orphan or persistent handle, and delete only the correlated disposable workspace. Record cleanup outcome; never delete evaluator material or unrelated processes.

Timeout, crash, identity drift, stale/missing correlation, unexpected ACL access, reparse traversal, credential exposure, private marker exposure, incomplete cleanup, or missing result must fail closed. Confirmed unauthorized access or leakage is `FAIL` even when another condition is `BLOCKED`. A failed cell is never silently retried; the frozen retry count is zero.

## Sanitized public result contract

```json
{
  "schema_version": 1,
  "evaluation_run_id": "correlated ID",
  "control_run_id": "correlated ID",
  "cell_id": "frozen cell ID",
  "candidate_id": "B0-B5",
  "scenario_id": "public scenario ID",
  "candidate_fingerprint": "verified fingerprint",
  "fixture_fingerprint": "verified fingerprint",
  "environment_fingerprint": "approved fingerprint",
  "hard_gate_results": {
    "correctness": "PASS|FAIL|BLOCKED|NOT_TESTED",
    "task_fidelity": "PASS|FAIL|BLOCKED|NOT_TESTED",
    "evidence_quality": "PASS|FAIL|BLOCKED|NOT_TESTED",
    "security": "PASS|FAIL|BLOCKED|NOT_TESTED"
  },
  "result": "PASS|FAIL|BLOCKED|NOT_TESTED",
  "provider_tokens": "provider values or NOT_AVAILABLE",
  "wall_time_seconds": 0.0,
  "tool_calls": "sanitized counts",
  "repeated_reads": 0,
  "retry_count": 0,
  "first_pass_success": false,
  "validation_outcomes": "public checks and exit states",
  "files_modified": [],
  "timeout": false,
  "cleanup": "PASS|FAIL",
  "exclusion_reason": null,
  "sanitization": "PASS|FAIL"
}
```

No raw transcript, prompt, private score, private assertion, credential, protected path, canary value, evaluator-only filename, or customer data is publishable. Monetary cost is reported only when the provider supplies it; otherwise it is `NOT_AVAILABLE`. Efficiency is considered only after correctness, task fidelity, evidence quality, and security pass in that order.

## Isolation acceptance checklist

The trusted evaluator records objective PASS/FAIL evidence for:

- correct developer, evaluator, controller, and restricted-agent identities; non-admin cell token and no privilege inheritance;
- allowed workspace read/write and denied evaluator-storage enumeration/read/write;
- canonical, extended-length, normalized, traversal, alternate-drive/share, symlink, junction, mount, and reparse-point paths;
- absence of owner/evaluator credentials, tokens, environment secrets, profile inheritance, clipboard/share forwarding, attachments, and unexpected tool endpoints;
- Windows-only execution with WSL and the owner's personal Ubuntu unavailable to the restricted identity;
- bounded timeout, zero model retries, owned-process-tree termination, orphan/handle checks, and correlated cleanup;
- sanitized report delivery with no private marker, content, path, rubric, holdout, ground truth, or canary leakage.

An `OTHER_ERROR`, unexecuted control, or unverifiable evidence is `BLOCKED`/`INCONCLUSIVE`, never PASS. Any granted unauthorized path or marker exposure is FAIL.

## Independent evaluator responsibilities

The trusted evaluator independently reviews and owns its runner, private bundle, permissions, connectivity, evidence storage, scoring, sanitation, and signed or integrity-verifiable attestation. It verifies public digests against the approved source revision, preserves immutable raw evidence privately, and publishes only sanitized metadata. The developer may verify the public attestation digest but must never receive the underlying evaluator material.

Before the first cell, the owner separately reviews the evaluator arrangement, synthetic-control attestation, bundle manifest digest, runtime/network fingerprint, 36-cell budget, confirmation policy/budget, immutable campaign envelope, and final execution decision. This document grants none of those approvals.

## Engineering Expert integration boundary

This handoff does not change Afyx Engineering Expert or its existing thirteen-domain and six-workflow architecture. Progressive disclosure and cross-skill routing remain future integration-acceptance concerns: later authorized evaluation must verify selective reference/workflow loading and bounded composition without changing the frozen Forge candidates or using this security handoff as evidence of model-routing quality. No new skill, domain, workflow, or routing rule is introduced here.

## Owner handoff and remaining blockers

1. Have the trusted evaluator review this public contract and independently implement/review the private runner; do not run repository or agent-generated scripts as owner.
2. Complete fresh synthetic controls, including conclusive Windows-only/WSL exclusion and all checklist negatives, under the actual campaign identities.
3. Freeze the evaluator-only bundle and return only its sanitized, integrity-verifiable attestation and digests.
4. Propose the exact Windows runtime/network fingerprint and bind it to the source, candidates, fixture, cell order, evaluator identity, bundle, timeouts, retries, cleanup, failure policy, and result schema.
5. Obtain separate owner decisions for runtime, evaluator arrangement, 36-cell budget, confirmation policy/budget, then final execution authorization after reviewing the immutable envelope.
6. Re-run `python evals/forge/validate.py --campaign-ready`. Exit `2` means the campaign remains blocked; no cell may execute.

Current unresolved gates remain: owner-approved runtime configuration, independently enforced evaluator isolation, 36-cell budget, confirmation budget/policy, independent evaluator arrangement, final execution authorization, and evaluator-only bundle freeze. Final status: **CAMPAIGN BLOCKED**.
