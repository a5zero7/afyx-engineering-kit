#!/usr/bin/env python3
"""Local-only, conservative AFYX Phase 8 event evidence ledger.

No model/provider invocation, no network access, no raw prompt/body retention.
This tool reports observed events; completeness is not inferred from silence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

CATEGORIES = {
    "human_intervention": "human",
    "policy_denial": "policy",
    "agent_fallback": "agent",
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


class EvidenceError(ValueError):
    pass


def read_jsonl(path: Path) -> tuple[list[dict[str, Any]], str]:
    digest = hashlib.sha256()
    events: list[dict[str, Any]] = []
    with path.open("rb") as raw:
        for number, line in enumerate(raw, 1):
            digest.update(line)
            if len(line) > 4 * 1024 * 1024:
                raise EvidenceError(f"{path.name}: oversized line {number}")
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise EvidenceError(f"{path.name}: invalid JSONL line {number}") from exc
            if not isinstance(record, dict):
                raise EvidenceError(f"{path.name}: object required at line {number}")
            events.append(record)
    return events, digest.hexdigest()


def parse_tokens(usage: Any) -> dict[str, Any]:
    if not isinstance(usage, dict):
        return {"availability": "NOT_AVAILABLE", "values": None}
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


def parse_annotations(path: Path | None) -> dict[str, Any]:
    by_category: dict[str, list[dict[str, Any]]] = {category: [] for category in CATEGORIES}
    complete: set[str] = set()
    digest: str | None = None
    if path is not None:
        records, digest = read_jsonl(path)
        for i, entry in enumerate(records, 1):
            if entry.get("type") == "coverage":
                for name in entry.get("complete_categories", []):
                    if name not in CATEGORIES:
                        raise EvidenceError(f"unknown coverage category at line {i}")
                    complete.add(name)
                continue
            category = entry.get("event_type")
            if category not in CATEGORIES:
                raise EvidenceError(f"unsupported annotated event at line {i}")
            if entry.get("actor") != CATEGORIES[category]:
                raise EvidenceError(f"actor mismatch for {category} at line {i}")
            if not entry.get("timestamp") or not entry.get("evidence_ref"):
                raise EvidenceError(f"timestamp and evidence_ref required at line {i}")
            if category == "rework":
                if not all(entry.get(key) for key in ("revision_before", "revision_after", "reason")):
                    raise EvidenceError(f"rework lineage missing at line {i}")
            if category == "explicit_retry":
                if not entry.get("attempt_group_id") or type(entry.get("attempt_index")) is not int or entry["attempt_index"] < 2:
                    raise EvidenceError(f"retry provenance missing at line {i}")
            by_category[category].append(entry)
    summary = {}
    for category, entries in by_category.items():
        # Never turn absent evidence into zero unless coverage explicitly asserts completeness.
        status = "AUTHORITATIVE" if category in complete else ("PARTIAL" if entries else "NOT_AVAILABLE")
        summary[category] = {"availability": status, "observed_minimum": len(entries),
                             "total": len(entries) if category in complete else None}
    return {"sha256": digest, "categories": summary}


def analyze(run_id: str, event_file: Path, annotations: Path | None = None,
            expected_thread_id: str | None = None) -> dict[str, Any]:
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
            if not isinstance(tid, str) or not tid or threads or turns_started:
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
                unrecognized_item_types.add(item_type)
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
            "retry_count": {"availability": "NOT_AVAILABLE", "value": None},
        },
        "tokens": parse_tokens(completed[0].get("usage")),
        "annotations": parse_annotations(annotations),
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
    except (EvidenceError, OSError) as exc:
        print(f"EVIDENCE_BLOCKED: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
