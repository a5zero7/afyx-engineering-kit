# AFYX-68 / AFYX-69 — Offline event ledger (draft, bounded)

This small **offline, standard-library-only** parser helps combine Phase 8.5 telemetry and Phase 8.6 human-intervention/rework evidence under one run identity. It **never launches an agent or makes provider calls**. Its input must already exist on the operator's machine. Raw messages, prompts, commands, tool payloads, personal paths, and secrets are not copied into the report. Only counts, run/thread identifiers, SHA-256 digests, and availability markers are emitted.

The source of truth for installed Codex token accounting remains `CodexUsage.psm1`; this tool only validates *run-local* `turn.completed.usage` evidence and must not replace the usage tracker. See `docs/CODEX_USAGE_TRACKER.md`. It does not estimate token usage from text length or monetary cost from API pricing.

## Read-only usage

Capture or locate a prior `codex exec --json` output file **locally**, without publishing it. Do not add `--ephemeral` when authoritative persisted rollout evidence is required, and preserve `turn.completed` and the correlated thread ID. A non-ephemeral session is not by itself evidence that the capture was complete.

```powershell
python scripts/phase8_event_ledger.py --run-id T1-ON --events D:\\private-evidence\\t1-on.jsonl --expected-thread-id <thread-id> --output D:\\private-evidence\\t1-on-summary.json
```

The parser accepts Codex's legitimate completion-only *non-tool* items (for example, an `agent_message` or `file_change` emitted as `item.completed` with no preceding `item.started`). This matches the public Codex JSONL event example and avoids rejecting a valid agent answer. It **continues to reject** orphan tool completion, missing/duplicate turn boundaries, inconsistent item IDs/types, invalid token usage, nonzero command exit codes, and explicit failed/declined terminal tool states. It recognizes `collab_tool_call` as an observed agent/tool event rather than quietly omitting sub-agent calls. `turn.failed` and fatal top-level `error` are blocking incomplete runs. Unknown item types are reported with downgraded capture availability.

For missing usage fields, the report emits `NOT_AVAILABLE` or `INCOMPLETE`. Its `observed_started` tool count is **capture-scoped**, not proof of all internal agent calls; a successful tool process does not prove an inner ACL operation succeeded. No aggregate financial cost or provider usage is inferred from bytes.

Event reference: https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs

Optional adjudicated sidecar `annotations.jsonl` (one JSON object per line) can contain:

```jsonl
{"actor":"policy","event_type":"policy_denial","timestamp":"2026-10-29T01:00:00Z","evidence_ref":"local:event:001"}
{"actor":"agent","event_type":"agent_fallback","timestamp":"2026-10-29T01:00:10Z","evidence_ref":"local:event:002"}
{"actor":"agent","event_type":"rework","timestamp":"2026-10-29T01:00:20Z","evidence_ref":"local:revision:003","revision_before":"r1","revision_after":"r2","reason":"confirmed-correction"}
```

Human intervention must have `actor=human` and `event_type=human_intervention`. A policy denial is not a human action, an agent fallback is not automatically rework, and repeated similar tool calls are not automatically retry. An `explicit_retry` requires `attempt_group_id` and `attempt_index >= 2`.

Only after the responsible evaluator has audited a *complete* set of raw events may an annotation include:

```jsonl
{"type":"coverage","complete_categories":["human_intervention","rework"]}
```

Without the coverage attestation, even an empty sidecar yields `NOT_AVAILABLE`, not zero. A positive event without complete coverage is a **minimum observed**, not a complete total. A coverage attestation is an evaluator assertion requiring independent validation; the tool cannot prove that missing records never existed.

## Acceptance boundaries

- Existing AFYX-67/68 4-run historical sessions were ephemeral; no raw full event streams have been presented for these sessions. Do **not** fabricate totals or infer missing counts from final messages.
- One documented T1 ON policy-denied Graph retrieval and source fallback are *reported observations*, not proof of a human intervention or rework event.
- AFYX-68 and AFYX-69 stay **In Progress / PARTIAL** until the missing raw telemetry is acquired or a documented scope change is accepted.
- For new paired runs, freeze source SHA, task, model and reasoning effort, provider/tool exposure and approval policy, first. Obtain explicit owner budget/quota authorization before model calls; run each trial once to capture both Phase 8.5 and 8.6 evidence and avoid duplicate expense.
- Do not commit raw rollouts, transcripts, or private annotation evidence to GitHub. Keep PR #126 and owner-modified `.github/workflows/ci.yml` untouched.

Run focused tests with `python -m unittest scripts.tests.test_phase8_event_ledger -v`.

## Discover AFYX-67 historical sessions without provider calls

The independent `scripts/phase8_evidence_discovery.py` tool performs **bounded read-only discovery**, looking only for exact structured `session_meta.payload.id` or `thread.started.thread_id` identities. It does not text-search prompts, call Codex, or upload session data. By default it searches `%CODEX_HOME%\\sessions` if `CODEX_HOME` is set, else `~/.codex/sessions`. Use this in the **owner's Windows terminal**, not in a public CI runner:

```powershell
$threadIds = @(
  '01a183a6-1ff8-73f2-9371-d82bfcc0cb25' # T1 OFF
  '01a183a6-f803-7842-b4b8-71eef5d0384c' # T1 ON
  '01a183a8-795c-7703-9669-2ccf0a0c29a5' # T2 OFF
  '01a183aa-0c77-7e22-bcc1-3d054bff1cd6' # T2 ON
)
$argsList = @('scripts/phase8_evidence_discovery.py')
foreach ($id in $threadIds) { $argsList += @('--thread-id', $id) }
python @argsList
```

Results are `FOUND`, `MULTIPLE_MATCHES`, `NOT_FOUND_IN_SCOPE`, or `INCOMPLETE_SCAN`. `NOT_FOUND_IN_SCOPE` means only that **these exact identities were not found in the bounded scanned directory**; it is not proof that no copies exist elsewhere or that missing token usage can be reconstructed. `INCOMPLETE_SCAN` explicitly flags a missing root, unreadable, oversized, symlink, or file-count-limited scan. Output contains relative paths, size/hash, and status only. Never attach raw session files to Jira or GitHub.

For separately persisted `codex exec --json` files in an **explicit owner-selected directory**, pass `--root 'D:\\private-evidence'` and `--include-cli-json`. Do not scan the entire home drive. To create a local JSON report, add `--output '<new local filename>.json'`; the tool refuses to overwrite an existing report.

A discovered session is **evidence existence only**. It is not authoritative telemetry until a separate parser verifies the complete event record, model/effort/fixture match, and the correct run/thread boundaries. Run the Phase 8 ledger on a *known-complete CLI JSONL* only. Historical `--ephemeral` sessions may correctly return `NOT_FOUND_IN_SCOPE`—report the gap, do not substitute unrelated sessions or start new provider runs.
