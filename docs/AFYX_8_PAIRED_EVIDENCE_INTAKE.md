# Phase 8 — Paired engineering evidence intake

Status: **SOURCE PREPARATION ONLY** (2026-10-31). Jira: AFYX-8, AFYX-68, AFYX-69. No real A/B run, installed Alpha GO, Expert D.6 verdict, Forge A8 GO, or release approval is implied by this source.

## Purpose

This is a zero-provider-call, standard-library-only Node.js checker for **already collected** Afyx OFF versus Afyx ON paired engineering work. It reads bounded local evidence, checks structured event file SHA-256, reports only observed metrics and preserves unavailable data as **null/NOT_AVAILABLE**. It never edits a repository, contacts model providers, runs customer code, or writes private evidence to CI.

The existing Phase 8 representative workload/CI evaluates deterministic local fixtures and does **not** become a real human/agent comparative proof by running this checker. PR #138/#139/#140 and the installed Alpha candidate must be accepted independently before product-level conclusions.

## Freeze before either run

Independently fix and record: task specification, source Git SHA, evaluator-only oracle/rubric, permissions, environment, model and effort, approved validation commands and resource budget. Keep OFF and ON worktrees, databases, Context states and user configurations isolated. Counterbalance/randomize condition order over multiple tasks where practical. OFF uses ordinary source tools without Afyx; ON uses an identifiable installed Afyx candidate. Correctness/security/test outcomes take priority over efficiency.

The shared manifest records digest and environment claims; a separate independent reviewer must verify their physical equality and source/artifact identities.

## Private evidence schema

Keep manifest.json, off.ndjson and on.ndjson OUTSIDE Git and agent-accessible workspaces. The manifest contains:

- contract = "afyx.phase8.paired-evidence/v1"
- evidenceClass = "owner_observed" or "synthetic_fixture" (synthetic result always SYNTHETIC_ONLY)
- caseId, taskSha256, oracleSha256, permissionsSha256, environmentSha256 (64 hex characters each), sourceRevision (full 40-character Git SHA), model, effort
- runs = exactly two entries, OFF then ON, each with distinct runId, eventsFile (relative local NDJSON), eventsSha256, quality, coverage
- quality = correctness/tests/security, each PASS, FAIL or NOT_RUN, and evaluatorReceiptSha256 (64 hex or null when all three are NOT_RUN). The receipt digest is *declared*, not an independently authenticated signature.
- coverage = booleans toolEvents/humanEvents/reworkEvents/providerUsage. TRUE only when the entire category is recorded; completeness remains a claim requiring independent verification.
- timing = {capture, liveReceiptSha256}. Use capture REPLAY_OR_UNVERIFIED and null receipt for offline replay, incomplete listener, or source-unknown records. LIVE_MONITORED requires an external SHA-256 receipt from the real agent host proving both boundaries; the intake verifies only the receipt's format, **not** its authenticity. A trusted evaluator must independently validate that receipt. Only LIVE_MONITORED is eligible for a wallMs comparison.

The checker enforces 4 MiB / 20,000 event limits, SHA-256 hashes, no symlinks or path traversal, unique event IDs, one initial start and one final end, monotonic timezone-aware timestamps, and valid actor identities.

Each event row must have id, runId, at (ISO-8601 with timezone), and kind. Supported intermediate event kinds:

| Kind | Required additional fields | Meaning |
|---|---|---|
| tool_call | actor = agent | One tool invocation |
| human_intervention | actor = human | One *human* action, not an agent retry/policy denial |
| rework | actor = agent or human | One confirmed rework event |
| provider_usage | source = provider_report; usageSemantics = per_turn_delta; nonnegative inputTokens, cachedInputTokens, outputTokens | Provider-reported per-turn *increments* only; cumulative session snapshots must not be summed |

Start/end timestamps define observed wall duration. Missing/partial category coverage outputs **null** and NOT_AVAILABLE; never silently infer zero. Delta = ON minus OFF; percentage only when OFF is positive. A quality/security/test FAIL blocks performance promotion regardless of costs. Actual owner-observed data is at most ELIGIBLE_FOR_INDEPENDENT_REVIEW; independentAcceptance remains NOT_VERIFIED even if both runs claim PASS. Synthetic fixtures always produce SYNTHETIC_ONLY.

No private patch, transcript, source excerpt, trace event, path, secret, holdout, prompt or raw run ID is emitted in the aggregate summary. Case/model labels may still be sensitive and must be reviewed before public/Jira publication.

## Run locally on authorized evidence only

PowerShell from canonical development repository:

    node scripts/phase8-paired-evidence.mjs --input "D:\private-evaluator\phase8\manifest.json" > "D:\private-evaluator\phase8\summary.json"

Exit 0 means valid schema, NOT acceptance (inspect verdict). Exit 1 means quality fail or missing quality evidence; exit 2 means invalid or tampered input.

Local developer-only regression: node --test scripts/tests/test_phase8_paired_evidence.mjs

GitHub CI executes **synthetic and negative contract tests only**, on Windows/Linux/macOS, without real provider calls or real-workload metrics. AFYX-8, AFYX-68 and AFYX-69 remain In Progress pending authorized paired tasks, raw event corroboration and independent review. Forge A5–A8, Expert D.6, and installed Alpha gates stay independent.


## Local session capture (non-executing host bridge)

A typed **recorder** is now provided at scripts/phase8-session-recorder.mjs. The tool has no model/provider credentials, launches no agent and runs no supplied shell commands. It consumes ONLY small structured telemetry rows from a human-authorized execution host on stdin. Host instrumentation must be started before task execution, finish after task completion, and identify events from the *actual* observed session; this recorder cannot independently prove the host emitted every event or certify correctness.

Example, from a separate private evaluator environment rather than the development worktree (the log source shown here is illustrative only):

    node scripts/phase8-session-recorder.mjs --mode OFF --run-id trial-off-001 --root "D:\private-evaluator\phase8" --workspace-root "D:\private-agent-worktree" < "D:\private-evaluator\phase8\observed-off-events.jsonl" > "D:\private-evaluator\phase8\off-descriptor.json"

Repeat independently with mode ON, a distinct run ID, isolated workspace and output on-descriptor.json. A provider/host integration may instead stream NDJSON rows to stdin in real time. Each *input* record MUST contain ONLY the supported typed fields shown above (no prompt, path, free-text output or credential). The recorder generates its own timestamp, sequence ID and run identity, then emits a hash-checked private off.ndjson/on.ndjson and a private run descriptor, with all coverage flags FALSE, all quality verdicts NOT_RUN and timing marked REPLAY_OR_UNVERIFIED. Only independently corroborated live-host receipts can change timing eligibility. It never infers provider usage or human intervention completeness. Existing traces cannot be overwritten; invalid stream events fail closed and remove incomplete capture.

**Timing caveat:** capture start/end measure the recorder input-listener interval. When input is a previously saved NDJSON file, this is merely replay time, **not agent execution wall time**. Wall time may be reported as real engineering duration only if an auditor verifies the recorder was attached for the full live agent session. Do not attribute a replay-duration measurement to the original task. The script does not guarantee security isolation by itself; the evaluator must enforce actual OS-level read/write/credential boundaries and verify the worktree is disposable and separate. Use no private customer data without authorization.

To construct the OFF/ON manifest, copy the two private descriptor run objects, attach the pre-frozen task/source/rubric/environment identity and independently verified quality receipts. Set each coverage boolean true **only** if the full corresponding host-generated event stream was observed and confirmed. Then invoke the paired-evidence checker. Neither the capture script nor the checker may promote a result to accepted on its own.

Developer-only regression: node --test scripts/tests/test_phase8_session_recorder.mjs. CI exercises synthetic local streams and negative confidentiality/security paths on three OS; it does NOT operate an agent or measure a real comparative workload.
