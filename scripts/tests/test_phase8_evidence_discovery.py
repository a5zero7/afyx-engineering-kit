"""No-provider tests for local Codex session metadata discovery."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / "phase8_evidence_discovery.py"
SPEC = importlib.util.spec_from_file_location("phase8_evidence_discovery", SOURCE)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

T1 = "01a183a6-1ff8-73f2-9371-d82bfcc0cb25"
T2 = "01a183a6-f803-7842-b4b8-71eef5d0384c"
OTHER = "01a183aa-0c77-7e22-bcc1-3d054bff1cd6"


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, events):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
        return p

    def test_rollout_id_match_and_hash(self):
        path = self.write("2026/10/29/rollout-t1.jsonl", [{"type": "session_meta", "payload": {"id": T1, "cwd": "secret"}}])
        data = mod.discover(self.root, [T1, T2])
        self.assertEqual(data["runs"][T1]["status"], "FOUND")
        self.assertEqual(data["runs"][T1]["matches"][0]["sha256"], mod.file_sha256(path))
        self.assertEqual(data["runs"][T2]["status"], "NOT_FOUND_IN_SCOPE")
        self.assertNotIn("secret", json.dumps(data))
        self.assertNotIn(str(self.root), json.dumps(data))

    def test_cli_structured_thread_identity_only_when_opted_in(self):
        self.write("capture.jsonl", [{"type": "thread.started", "thread_id": T2}])
        self.assertEqual(mod.discover(self.root, [T2])["runs"][T2]["status"], "NOT_FOUND_IN_SCOPE")
        self.assertEqual(mod.discover(self.root, [T2], include_cli_json=True)["runs"][T2]["status"], "FOUND")

    def test_prompt_text_does_not_falsely_match(self):
        self.write("rollout-message.jsonl", [{"type": "item.completed", "item": {"text": T1}}])
        self.assertEqual(mod.discover(self.root, [T1])["runs"][T1]["status"], "NOT_FOUND_IN_SCOPE")

    def test_multiple_matches_are_not_arbitrarily_resolved(self):
        for i in range(2):
            self.write(f"folder{i}/rollout-{i}.jsonl", [{"type": "session_meta", "payload": {"id": T1}}])
        self.assertEqual(mod.discover(self.root, [T1])["runs"][T1]["status"], "MULTIPLE_MATCHES")

    def test_invalid_json_marks_scan_incomplete_not_missing(self):
        self.write("rollout-bad.jsonl", [{"type": "session_meta", "payload": {"id": T2}}])
        (self.root / "rollout-bad.jsonl").write_text("{bad-json}\n")
        r = mod.discover(self.root, [T1])
        self.assertEqual(r["runs"][T1]["status"], "INCOMPLETE_SCAN")
        self.assertEqual(r["file_scan"]["unreadable"], 1)

    def test_found_match_remains_incomplete_when_scan_is_partial(self):
        self.write("rollout-found.jsonl", [
            {"type": "session_meta", "payload": {"id": T1}}
        ])
        (self.root / "rollout-bad.jsonl").write_text("{bad-json}\n", encoding="utf-8")

        r = mod.discover(self.root, [T1])

        self.assertEqual(len(r["runs"][T1]["matches"]), 1)
        self.assertEqual(r["runs"][T1]["status"], "INCOMPLETE_SCAN")

    def test_directory_links_are_counted_and_make_scan_incomplete(self):
        self.write("symlink-dir/rollout-symlink.jsonl", [
            {"type": "session_meta", "payload": {"id": T1}}
        ])
        self.write("junction-dir/rollout-junction.jsonl", [
            {"type": "session_meta", "payload": {"id": T1}}
        ])
        original = mod.link_kind

        def classify(path):
            if path.name == "symlink-dir":
                return "SYMLINK"
            if path.name == "junction-dir":
                return "REPARSE_POINT"
            return original(path)

        with mock.patch.object(mod, "link_kind", side_effect=classify):
            r = mod.discover(self.root, [T1])

        self.assertEqual(r["file_scan"]["symlinks_skipped"], 1)
        self.assertEqual(r["file_scan"]["reparse_points_skipped"], 1)
        self.assertEqual(r["runs"][T1]["status"], "INCOMPLETE_SCAN")

    def test_windows_reparse_attribute_is_detected_without_following(self):
        path = mock.Mock()
        path.is_symlink.return_value = False
        path.lstat.return_value = SimpleNamespace(st_file_attributes=0x400)

        self.assertEqual(mod.link_kind(path), "REPARSE_POINT")

    @unittest.skipUnless(os.name == "nt", "Windows junctions are platform-specific")
    def test_windows_junction_is_counted_as_incomplete(self):
        target = self.root / "target"
        target.mkdir()
        junction = self.root / "junction"
        created = subprocess.run(
            ["cmd", "/d", "/c", "mklink", "/J", str(junction), str(target)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(created.returncode, 0, created.stderr)

        r = mod.discover(self.root, [T1])

        self.assertEqual(r["file_scan"]["reparse_points_skipped"], 1)
        self.assertEqual(r["runs"][T1]["status"], "INCOMPLETE_SCAN")

    def test_oversized_file_marks_incomplete(self):
        self.write("rollout-too-big.jsonl", [{"type": "session_meta", "payload": {"id": T2}}])
        r = mod.discover(self.root, [T1], max_file_bytes=5)
        self.assertEqual(r["file_scan"]["oversized"], 1)
        self.assertEqual(r["runs"][T1]["status"], "INCOMPLETE_SCAN")

    def test_max_files_cap_is_fail_closed(self):
        for i in range(3):
            self.write(f"rollout-{i}.jsonl", [{"type": "session_meta", "payload": {"id": T2}}])
        r = mod.discover(self.root, [T1], max_files=1)
        self.assertTrue(r["file_scan"]["cap_reached"])
        self.assertEqual(r["runs"][T1]["status"], "INCOMPLETE_SCAN")

    def test_missing_root_is_incomplete(self):
        r = mod.discover(self.root / "notfound", [T1])
        self.assertEqual(r["runs"][T1]["status"], "INCOMPLETE_SCAN")
        self.assertEqual(r["scope_status"], "ROOT_NOT_FOUND")

    def test_invalid_thread_id_fails(self):
        with self.assertRaises(mod.DiscoveryError):
            mod.discover(self.root, ["not-a-uuid"])

    def test_cli_exclusive_output_and_safe_report(self):
        self.write("rollout-found.jsonl", [{"type": "session_meta", "payload": {"id": T1}}])
        output = self.root / "out.json"
        cmd = [sys.executable, str(SOURCE), "--root", str(self.root), "--thread-id", T1, "--output", str(output)]
        first = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        second = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(second.returncode, 2)
        self.assertIn("DISCOVERY_BLOCKED", second.stderr)
        self.assertTrue(json.loads(output.read_text())["runs"][T1]["matches"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
