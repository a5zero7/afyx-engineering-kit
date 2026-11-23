#!/usr/bin/env python3
"""Local-only, conservative AFYX Phase 8 event evidence ledger.

No model/provider invocation, no network access, no raw prompt/body retention.
This tool reports observed events; completeness is not inferred from silence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

CATEGORIES = {
    "human_intervention": "human",
    "policy_denial": "policy",
    "agent_fallback": "agent",
    "agent_recovery": "agent",
    "rework": "agent",
    "explicit_retry": "agent",
}
TOOL_TYPES = frozenset({
    "command_execution", "mcp_tool_call", "collab_tool_call", "web_search",
    "dynamic_tool_call", "function_call",
})
# Codex may emit these as item.completed without an item.started notification.
# They are NOT tool calls and must not be counted as one.
TERMINAL_ONLY_TYPES = frozenset({"agent_message", "reasoning", "file_change", "todo_list", "plan", "error"})
USAGE_FIELDS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens")
MAX_BYTES = 4 * 1024 * 1024
MAX_EVENTS = 20_000
SHA256 = re.compile(r"[a-f0-9]{64}")
IDENTITY = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
TIMESTAMP = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)")


class EvidenceError(ValueError):
    pass


def read_jsonl(path: Path) -> tuple[list[dict[str, Any]], str]:
    digest = hashlib.sha256()
    events: list[dict[str, Any]] = []
    with path.open("rb") as raw:
        size = 0
        for number, line in enumerate(iter(lambda: raw.readline(MAX_BYTES + 1), b""), 1):
            size += len(line)
            if size > MAX_BYTES or number > MAX_EVENTS:
                raise EvidenceError("evidence input exceeds byte or line budget")
            digest.update(line)
            if not line.strip():
                continue
            try:
                record = json.loads(line.decode("utf-8"), object_pairs_hook=unique_object,
                                    parse_constant=invalid_constant)
            except (UnicodeDecodeError, ValueError, RecursionError) as exc:
                raise EvidenceError(f"invalid JSONL line {number}") from exc
            if not isinstance(record, dict):
                raise EvidenceError(f"object required at line {number}")
            events.append(record)
    return events, digest.hexdigest()


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = dict(pairs)
    if len(result) != len(pairs):
        raise EvidenceError("duplicate JSON property")
    return result


def invalid_constant(_: str) -> None:
    raise EvidenceError("nonfinite JSON number")


def is_hash(value: Any) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def parse_time(value: Any) -> datetime:
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        raise EvidenceError("timestamp requires ISO timezone")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceError("invalid timestamp calendar") from exc


def parse_tokens(usage: Any) -> dict[str, Any]:
    if not isinstance(usage, dict):
        return {"availability": "NOT_AVAILABLE", "values": None}
    for field in ("usage_semantics", "usageSemantics"):
        if field in usage and usage[field] != "per_turn_delta":
            raise EvidenceError("usage must be a per-turn delta")
    values: dict[str, int | None] = {}
    for key in USAGE_FIELDS:
        value = usage.get(key)
        if value is not None and (type(value) is not int or value < 0):
            raise EvidenceError(f"invalid token field: {key}")
        values[key] = value
    input_tokens, output_tokens = values["input_tokens"], values["output_tokens"]
    if input_tokens is None or output_tokens is None:
        return {"availability": "INCOMPLETE", "values": values}
    for subset in ("cached_input_tokens", "cache_write_input_tokens"):
        if values[subset] is not None and values[subset] > input_tokens:
            raise EvidenceError(f"{subset} exceeds input_tokens")
    if values["reasoning_output_tokens"] is not None and values["reasoning_output_tokens"] > output_tokens:
        raise EvidenceError("reasoning_output_tokens exceeds output_tokens")
    computed = input_tokens + output_tokens
    reported = usage.get("total_tokens")
    if reported is not None and (type(reported) is not int or reported != computed):
        raise EvidenceError("reported total_tokens does not equal input + output")
    values["total_tokens"] = computed
    return {
        "availability": "AUTHORITATIVE" if reported is not None else "DERIVED_TOTAL",
        "values": values,
        "total_tokens_provenance": "AUTHORITATIVE" if reported is not None else "DERIVED",
        "subsets_not_additive": ["cached_input_tokens", "cache_write_input_tokens", "reasoning_output_tokens"],
    }


def parse_annotations(path: Path | None, source_sha256: str | None = None) -> dict[str, Any]:
    counts = dict.fromkeys(CATEGORIES, 0)
    complete: set[str] = set()
    unverified: set[str] = set()
    references: set[str] = set()
    attempts: dict[str, int] = {}
    revisions: dict[str, str] = {}
    coverage_receipts: dict[str, str] = {}
    declared: set[str] = set()
    previous_time: datetime | None = None
    digest: str | None = None
    if path is not None:
        records, digest = read_jsonl(path)
        for i, entry in enumerate(records, 1):
            if entry.get("type") == "coverage":
                categories = entry.get("complete_categories")
                if not isinstance(categories, list) or not categories:
                    raise EvidenceError(f"missing coverage categories at line {i}")
                proof = "source_sha256" in entry or "receipt_sha256" in entry
                if proof and (not is_hash(entry.get("receipt_sha256")) or not is_hash(source_sha256)
                              or entry.get("source_sha256") != source_sha256):
                    raise EvidenceError(f"coverage source digest mismatch at line {i}")
                for name in categories:
                    if not isinstance(name, str) or name not in CATEGORIES or name in declared:
                        raise EvidenceError(f"unknown or duplicate coverage category at line {i}")
                    declared.add(name)
                    if proof:
                        complete.add(name)
                        coverage_receipts[name] = entry["receipt_sha256"]
                continue
            category = entry.get("event_type")
            if not isinstance(category, str) or category not in (*CATEGORIES, "operation_attempt"):
                raise EvidenceError(f"unsupported annotated event at line {i}")
            allowed_actors = ("agent", "human") if category == "rework" else (CATEGORIES.get(category, "agent"),)
            if entry.get("actor") not in allowed_actors:
                raise EvidenceError(f"actor mismatch for {category} at line {i}")
            when = parse_time(entry.get("timestamp"))
            if previous_time is not None and when < previous_time:
                raise EvidenceError(f"nonmonotonic annotation timeline at line {i}")
            previous_time = when
            ref = entry.get("evidence_ref")
            if not isinstance(ref, str) or not IDENTITY.fullmatch(ref) or ref in references:
                raise EvidenceError(f"invalid or duplicate evidence_ref at line {i}")
            references.add(ref)
            evidence = entry.get("evidence_sha256")
            if "evidence_sha256" in entry:
                if not is_hash(evidence) or evidence in references:
                    raise EvidenceError(f"invalid or duplicate evidence hash at line {i}")
                references.add(evidence)
            source = {"human_intervention": "human_observation", "policy_denial": "policy_event",
                      "rework": "artifact_revision"}.get(category, "agent_event")
            if evidence is not None or "source" in entry:
                if evidence is None or entry.get("source") != source:
                    raise EvidenceError(f"annotation provenance missing at line {i}")
            elif category == "human_intervention":
                unverified.add(category)
                continue
            if category == "rework":
                artifact, before, after = (entry.get(k) for k in ("artifact_sha256", "revision_before", "revision_after"))
                if not all(map(is_hash, (artifact, before, after))) or before == after or evidence is None:
                    raise EvidenceError(f"rework lineage missing at line {i}")
                if artifact in revisions and revisions[artifact] != before:
                    raise EvidenceError(f"discontinuous rework lineage at line {i}")
                revisions[artifact] = after
            if category in ("operation_attempt", "explicit_retry"):
                operation, index = entry.get("attempt_group_id"), entry.get("attempt_index")
                if not is_hash(operation) or type(index) is not int or evidence is None:
                    raise EvidenceError(f"retry provenance missing at line {i}")
                previous = attempts.get(operation)
                if (category == "operation_attempt" and (previous is not None or index != 1)
                    or category == "explicit_retry" and (previous is None or index != previous + 1)):
                    raise EvidenceError(f"duplicate or unlinked attempt at line {i}")
                attempts[operation] = index
            if category != "operation_attempt":
                counts[category] += 1
    summary = {}
    for category, count in counts.items():
        # Never turn absent evidence into zero unless coverage explicitly asserts completeness.
        covered = category in complete and category not in unverified
        status = "AUTHORITATIVE" if covered else ("PARTIAL" if count else "NOT_AVAILABLE")
        summary[category] = {"availability": status, "observed_minimum": count if count or covered else None,
                             "total": count if covered else None}
    return {"sha256": digest, "coverage_receipts": coverage_receipts, "categories": summary}


def analyze(run_id: str, event_file: Path, annotations: Path | None = None,
            expected_thread_id: str | None = None) -> dict[str, Any]:
    if not isinstance(run_id, str) or not IDENTITY.fullmatch(run_id):
        raise EvidenceError("invalid run ID")
    events, digest = read_jsonl(event_file)
    started: dict[str, str] = {}
    finished: set[str] = set()
    failures = 0
    completed: list[dict[str, Any]] = []
    threads: set[str] = set()
    unrecognized_item_types: set[str] = set()
    turns_started = 0
    terminal_seen = False

    for event in events:
        kind = event.get("type")
        if kind == "thread.started":
            tid = event.get("thread_id")
            if not isinstance(tid, str) or not IDENTITY.fullmatch(tid) or threads or turns_started:
                raise EvidenceError("duplicate, late or invalid thread.started")
            threads.add(tid)
        elif kind == "turn.started":
            if not threads or turns_started:
                raise EvidenceError("missing thread or duplicate turn.started")
            turns_started += 1
        elif kind == "turn.completed":
            if turns_started != 1 or terminal_seen:
                raise EvidenceError("missing turn.started or duplicate turn.completed")
            terminal_seen = True
            if any(field in event and event[field] != "per_turn_delta"
                   for field in ("usage_semantics", "usageSemantics")):
                raise EvidenceError("usage must be a per-turn delta")
            completed.append(event)
        elif kind in ("turn.failed", "error"):
            raise EvidenceError("failed or incomplete Codex event stream")
        elif kind in ("item.started", "item.updated", "item.completed", "item.failed"):
            if turns_started != 1 or terminal_seen:
                raise EvidenceError("item event outside active turn")
            item = event.get("item")
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
                raise EvidenceError("item event missing item.id")
            key = item["id"]
            item_type = item.get("type")
            if not isinstance(item_type, str) or not item_type:
                raise EvidenceError("item type missing")
            if item_type not in TOOL_TYPES and item_type not in TERMINAL_ONLY_TYPES:
                # Preserve the fact of an unknown item without copying a
                # provider-controlled label into an evidence summary.
                unrecognized_item_types.add(hashlib.sha256(item_type.encode("utf-8", "surrogatepass")).hexdigest())
            if kind == "item.started":
                if key in started or key in finished:
                    raise EvidenceError("duplicate item.started")
                started[key] = item_type
            elif kind == "item.updated":
                # Updates must refer to an existing item, but need not carry
                # a tool-specific payload. An unknown item cannot disappear.
                if key not in started or key in finished or started[key] != item_type:
                    raise EvidenceError("orphan or inconsistent item.updated")
            else:
                if key in finished:
                    raise EvidenceError("duplicate item completion")
                if key in started:
                    if started[key] != item_type:
                        raise EvidenceError("item type changed between start and completion")
                elif item_type not in TERMINAL_ONLY_TYPES:
                    # A tool completed without a corresponding start means the
                    # observed tool-call count and event completeness are unsafe.
                    raise EvidenceError("orphan tool completion")
                finished.add(key)
                status = item.get("status")
                if kind == "item.failed" or status in ("failed", "declined"):
                    failures += 1
                elif item_type == "command_execution" and type(item.get("exit_code")) is int and item["exit_code"] != 0:
                    failures += 1
        elif kind is None:
            raise EvidenceError("event missing type")
        else:
            raise EvidenceError("unsupported top-level event type")

    if not threads or len(threads) != 1 or (expected_thread_id and expected_thread_id not in threads):
        raise EvidenceError("thread identity missing or does not match")
    if turns_started != 1 or len(completed) != 1:
        raise EvidenceError("expected exactly one complete turn")
    if set(started) - finished:
        raise EvidenceError("unclosed item events")
    tool_ids = [key for key, kind in started.items() if kind in TOOL_TYPES]
    annotated = parse_annotations(annotations, digest)
    retry = annotated["categories"]["explicit_retry"]
    return {
        "schema_version": 1,
        "run_id": run_id,
        "thread_id": next(iter(threads)),
        "source_sha256": digest,
        "tool_events": {
            "observed_started": len(tool_ids),
            "observed_item_failures": failures,
            "availability": "OBSERVED_ONLY" if unrecognized_item_types else "COMPLETE_CAPTURE_SCOPE_ONLY",
            "unknown_item_types": sorted(unrecognized_item_types),
            "retry_count": {"availability": retry["availability"], "value": retry["total"]},
        },
        "tokens": parse_tokens(completed[0].get("usage")),
        "annotations": annotated,
        "provider_monetary_cost": {"availability": "NOT_AVAILABLE", "value": None},
        "claims": {"human_zero_if_missing": False, "rework_zero_if_missing": False,
                   "provider_cost_is_estimated": False},
        "note": "Counts are capture-scoped, never universal tool or human-intervention claims. No raw messages copied.",
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--events", type=Path, required=True, help="Codex exec --json JSONL (existing local file)")
    ap.add_argument("--annotations", type=Path, help="Optional timestamped adjudicated events JSONL")
    ap.add_argument("--expected-thread-id")
    ap.add_argument("--output", type=Path, help="New JSON output path, never overwrite existing files")
    ns = ap.parse_args(argv)
    try:
        record = analyze(ns.run_id, ns.events, ns.annotations, ns.expected_thread_id)
        serialized = json.dumps(record, indent=2, sort_keys=True) + "\n"
        if ns.output:
            # Atomic exclusive create: do not overwrite prior evidence or owner files.
            with ns.output.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(serialized)
        else:
            sys.stdout.write(serialized)
    except EvidenceError as exc:
        print(f"EVIDENCE_BLOCKED: {exc}", file=sys.stderr)
        return 2
    except OSError:
        print("EVIDENCE_BLOCKED: local evidence I/O failed", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
