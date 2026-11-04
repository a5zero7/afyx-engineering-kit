"""Conservative regression tests for the offline Phase 8 event evidence ledger."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "phase8_event_ledger.py"
SPEC = importlib.util.spec_from_file_location("phase8_event_ledger", SOURCE)
assert SPEC and SPEC.loader
ledger = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ledger)


def write_lines(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def valid_events() -> list[dict]:
    return [
        {"type": "thread.started", "thread_id": "thread-test"},
        {"type": "turn.started"},
        {"type": "item.started", "item": {"id": "tool1", "type": "mcp_tool_call"}},
        {"type": "item.completed", "item": {"id": "tool1", "type": "mcp_tool_call", "status": "completed"}},
        {"type": "item.started", "item": {"id": "tool2", "type": "command_execution"}},
        {"type": "item.failed", "item": {"id": "tool2", "type": "command_execution", "status": "failed"}},
        {"type": "turn.completed", "usage": {"input_tokens": 120, "cached_input_tokens": 80,
                                             "output_tokens": 30, "reasoning_output_tokens": 10}},
    ]


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.events = self.root / "events.jsonl"
        write_lines(self.events, valid_events())

    def test_usage_derived_and_no_double_count(self):
        output = ledger.analyze("T1-ON", self.events)
        self.assertEqual(output["tokens"]["values"]["total_tokens"], 150)
        self.assertEqual(output["tokens"]["total_tokens_provenance"], "DERIVED")
        self.assertEqual(output["tool_events"]["observed_started"], 2)
        self.assertEqual(output["tool_events"]["observed_item_failures"], 1)
        self.assertEqual(output["annotations"]["categories"]["human_intervention"]["availability"], "NOT_AVAILABLE")
        self.assertIsNone(output["annotations"]["categories"]["rework"]["total"])

    def test_existing_reported_total_must_match(self):
        data = valid_events()
        data[-1]["usage"]["total_tokens"] = 149
        write_lines(self.events, data)
        with self.assertRaises(ledger.EvidenceError):
            ledger.analyze("R", self.events)

    def test_invalid_negative_and_cached_overflow(self):
        for value in (-1, 121):
            data = valid_events()
            data[-1]["usage"]["cached_input_tokens"] = value
            write_lines(self.events, data)
            with self.assertRaises(ledger.EvidenceError):
                ledger.analyze("R", self.events)

    def test_missing_usage_does_not_invent_tokens(self):
        data = valid_events()
        data[-1].pop("usage")
        write_lines(self.events, data)
        self.assertEqual(ledger.analyze("R", self.events)["tokens"]["availability"], "NOT_AVAILABLE")

    def test_duplicate_turn_and_orphan_tool_rejected(self):
        data = valid_events()
        write_lines(self.events, data + [data[-1]])
        with self.assertRaisesRegex(ledger.EvidenceError, "turn.completed"):
            ledger.analyze("R", self.events)
        data = valid_events()
        data.pop(2)
        write_lines(self.events, data)
        with self.assertRaisesRegex(ledger.EvidenceError, "orphan"):
            ledger.analyze("R", self.events)

    def test_unclosed_tool_rejected(self):
        data = valid_events()
        data.pop(3)
        write_lines(self.events, data)
        with self.assertRaisesRegex(ledger.EvidenceError, "unclosed"):
            ledger.analyze("R", self.events)

    def test_annotation_lower_bound_does_not_imply_total(self):
        notes = self.root / "annotations.jsonl"
        write_lines(notes, [{"actor": "policy", "event_type": "policy_denial", "timestamp": "2026-10-29T01:00:00Z", "evidence_ref": "local:event:1"}])
        output = ledger.analyze("R", self.events, notes)["annotations"]["categories"]
        self.assertEqual(output["policy_denial"]["availability"], "PARTIAL")
        self.assertEqual(output["policy_denial"]["observed_minimum"], 1)
        self.assertIsNone(output["policy_denial"]["total"])
        self.assertEqual(output["human_intervention"]["availability"], "NOT_AVAILABLE")

    def test_complete_coverage_explicitly_allows_zero(self):
        notes = self.root / "annotations.jsonl"
        write_lines(notes, [{"type": "coverage", "complete_categories": ["human_intervention"]}])
        output = ledger.analyze("R", self.events, notes)["annotations"]["categories"]
        self.assertEqual(output["human_intervention"]["availability"], "AUTHORITATIVE")
        self.assertEqual(output["human_intervention"]["total"], 0)
        self.assertIsNone(output["rework"]["total"])

    def test_actor_mismatch_and_weak_rework_rejected(self):
        notes = self.root / "annotations.jsonl"
        write_lines(notes, [{"actor": "human", "event_type": "policy_denial", "timestamp": "now", "evidence_ref": "x"}])
        with self.assertRaisesRegex(ledger.EvidenceError, "actor mismatch"):
            ledger.analyze("R", self.events, notes)
        write_lines(notes, [{"actor": "agent", "event_type": "rework", "timestamp": "now", "evidence_ref": "x"}])
        with self.assertRaisesRegex(ledger.EvidenceError, "lineage"):
            ledger.analyze("R", self.events, notes)

    def test_retry_requires_attempt_provenance(self):
        notes = self.root / "annotations.jsonl"
        write_lines(notes, [{"actor": "agent", "event_type": "explicit_retry", "timestamp": "now", "evidence_ref": "x", "attempt_index": 2}])
        with self.assertRaisesRegex(ledger.EvidenceError, "retry provenance"):
            ledger.analyze("R", self.events, notes)

    def test_wrong_thread_rejected(self):
        with self.assertRaisesRegex(ledger.EvidenceError, "thread identity"):
            ledger.analyze("R", self.events, expected_thread_id="other")

    def test_official_codex_completed_only_message_and_file_change(self):
        # Public Codex JSONL reference includes agent_message item.completed
        # without a corresponding item.started. File changes are also allowed
        # as completion-only events; neither is a tool invocation.
        data = valid_events()
        data.insert(-1, {"type": "item.completed", "item": {"id": "message", "type": "agent_message", "text": "done"}})
        data.insert(-1, {"type": "item.completed", "item": {"id": "change", "type": "file_change", "status": "completed"}})
        write_lines(self.events, data)
        output = ledger.analyze("R", self.events)
        self.assertEqual(output["tool_events"]["observed_started"], 2)
        self.assertEqual(output["tokens"]["values"]["total_tokens"], 150)

    def test_orphan_tool_completion_still_rejected(self):
        data = valid_events()
        data.insert(-1, {"type": "item.completed", "item": {"id": "unseen-tool", "type": "mcp_tool_call", "status": "completed"}})
        write_lines(self.events, data)
        with self.assertRaisesRegex(ledger.EvidenceError, "orphan tool completion"):
            ledger.analyze("R", self.events)

    def test_collab_agent_call_is_counted_as_tool(self):
        data = valid_events()
        data.insert(-1, {"type": "item.started", "item": {"id": "subagent", "type": "collab_tool_call"}})
        data.insert(-1, {"type": "item.completed", "item": {"id": "subagent", "type": "collab_tool_call", "status": "completed"}})
        write_lines(self.events, data)
        output = ledger.analyze("R", self.events)
        self.assertEqual(output["tool_events"]["observed_started"], 3)

    def test_declined_and_nonzero_exit_are_failures(self):
        data = valid_events()
        data[3]["item"]["status"] = "declined"
        data[5]["item"]["status"] = "completed"
        data[5]["item"]["exit_code"] = 1
        data[5]["type"] = "item.completed"
        write_lines(self.events, data)
        self.assertEqual(ledger.analyze("R", self.events)["tool_events"]["observed_item_failures"], 2)

    def test_turn_failed_and_error_event_are_blocking(self):
        for failure in ({"type": "turn.failed", "error": {"message": "oops"}},
                        {"type": "error", "message": "fatal"}):
            data = valid_events()
            data.insert(-1, failure)
            write_lines(self.events, data)
            with self.assertRaisesRegex(ledger.EvidenceError, "failed or incomplete"):
                ledger.analyze("R", self.events)

    def test_duplicate_and_missing_turn_start_are_blocking(self):
        data = valid_events()
        data.insert(2, {"type": "turn.started"})
        write_lines(self.events, data)
        with self.assertRaisesRegex(ledger.EvidenceError, "duplicate turn.started"):
            ledger.analyze("R", self.events)
        data = valid_events()
        data.pop(1)
        write_lines(self.events, data)
        with self.assertRaisesRegex(ledger.EvidenceError, "outside active turn"):
            ledger.analyze("R", self.events)

    def test_unknown_item_type_does_not_claim_complete_tool_capture(self):
        data = valid_events()
        data.insert(-1, {"type": "item.started", "item": {"id": "novel", "type": "new_vendor_tool"}})
        data.insert(-1, {"type": "item.completed", "item": {"id": "novel", "type": "new_vendor_tool"}})
        write_lines(self.events, data)
        output = ledger.analyze("R", self.events)["tool_events"]
        self.assertEqual(output["availability"], "OBSERVED_ONLY")
        self.assertEqual(output["unknown_item_types"], ["new_vendor_tool"])

    def test_cli_creates_once_and_never_overwrites(self):
        output_path = self.root / "summary.json"
        args = [sys.executable, str(SOURCE), "--run-id", "R", "--events", str(self.events), "--output", str(output_path)]
        first = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        second = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(second.returncode, 2)
        self.assertIn("EVIDENCE_BLOCKED", second.stderr)
        self.assertNotIn("mcp_tool_call", output_path.read_text())  # no tool payloads or raw messages


if __name__ == "__main__":
    unittest.main(verbosity=2)
