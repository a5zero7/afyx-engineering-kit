#!/usr/bin/env python3
"""Negative precision regressions for the offline Alpha evidence preflight."""
from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "alpha_acceptance_preflight.py"
LEDGER = ROOT / "docs" / "AFYX_ALPHA_ACCEPTANCE_LEDGER.json"
spec = importlib.util.spec_from_file_location("alpha_acceptance_preflight", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class AlphaAcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads(LEDGER.read_text(encoding="utf-8"))

    def assert_blocked(self, data, code):
        with self.assertRaises(mod.LedgerError) as caught:
            mod.validate(data)
        self.assertEqual(str(caught.exception), code)

    def evidence(self, role: str, source: str = "c" * 40):
        return {
            "reference": "urn:afyx:evidence:" + "d" * 64,
            "digest_sha256": "d" * 64,
            "source_sha": source,
            "verifier_role": role,
            "scope": "CONTROLLED_ACCEPTANCE",
        }

    def test_initial_alpha_ledger_is_truthfully_blocked(self):
        result = mod.validate(self.data)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["gates"]["PASS"], 0)
        self.assertEqual(result["gates"]["NOT_RUN"] + result["gates"]["BLOCKED"], 18)
        self.assertEqual(result["scenarios"]["NOT_RUN"], 6)
        self.assertFalse(result["external_evidence_verified"])
        self.assertFalse(result["release_approved_by_tool"])
        self.assertEqual(result["provider_calls_by_tool"], 0)

    def test_missing_and_duplicate_gate_are_rejected(self):
        data = copy.deepcopy(self.data)
        data["gates"].pop()
        self.assert_blocked(data, "GATE_COVERAGE_INCOMPLETE")
        data = copy.deepcopy(self.data)
        data["gates"][1] = data["gates"][0]
        self.assert_blocked(data, "INVALID_GATE_IDENTITY")

    def test_pass_requires_source_and_evidence(self):
        data = copy.deepcopy(self.data)
        data["gates"][0]["status"] = "PASS"
        self.assert_blocked(data, "PASS_WITHOUT_CANDIDATE")
        data["baseline"]["candidate_source_sha"] = "c" * 40
        self.assert_blocked(data, "PASS_WITHOUT_EVIDENCE")

    def test_source_identity_and_evaluator_must_match(self):
        data = copy.deepcopy(self.data)
        data["baseline"]["candidate_source_sha"] = "c" * 40
        data["gates"][0]["status"] = "PASS"
        data["gates"][0]["evidence"] = [self.evidence("independent_evaluator")]
        self.assert_blocked(data, "EVIDENCE_AUTHORITY_MISMATCH")
        data["gates"][0]["evidence"] = [self.evidence("owner", "a" * 40)]
        self.assert_blocked(data, "EVIDENCE_IDENTITY_MISMATCH")

    def test_forge_a8_no_go_without_formal_campaign(self):
        data = copy.deepcopy(self.data)
        data["baseline"]["candidate_source_sha"] = "c" * 40
        data["execution"]["independent_evaluator_run"] = True
        a8 = next(e for e in data["gates"] if e["id"] == "FORGE_A8_DECISION")
        a8["status"] = "PASS"
        a8["evidence"] = [self.evidence("independent_evaluator")]
        self.assert_blocked(data, "PASS_WITHOUT_PREREQUISITE_ACCEPTANCE")

    def test_phase8_cannot_claim_pass_with_unaccepted_scenarios(self):
        data = self.valid_all_claims()
        data["scenarios"][0]["status"] = "NOT_RUN"
        data["scenarios"][0]["evidence"] = []
        self.assert_blocked(data, "PHASE8_WITHOUT_SCENARIO_ACCEPTANCE")

    def test_installed_candidate_gate_requires_artifact_identity(self):
        data = copy.deepcopy(self.data)
        data["baseline"]["candidate_source_sha"] = "c" * 40
        data["gates"][0]["status"] = "PASS"
        data["gates"][0]["evidence"] = [self.evidence("owner")]
        data["gates"][1]["status"] = "PASS"
        data["gates"][1]["evidence"] = [self.evidence("owner")]
        graph_ace = next(e for e in data["gates"] if e["id"] == "GRAPH_ACE_RUNTIME")
        graph_ace["status"] = "PASS"
        graph_ace["evidence"] = [self.evidence("owner")]
        self.assert_blocked(data, "PASS_WITHOUT_INSTALLED_ARTIFACT_IDENTITY")

    def test_claim_ready_is_not_acceptance_or_release(self):
        data = self.valid_all_claims()
        report = mod.validate(data)
        self.assertEqual(report["status"], "READY_FOR_INDEPENDENT_REVIEW")
        self.assertEqual(report["validation"], "CLAIM_SCHEMA_AND_DEPENDENCIES_ONLY")
        self.assertFalse(report["external_evidence_verified"])
        self.assertFalse(report["release_approved_by_tool"])

    def test_candidate_shas_are_never_inferred_from_worktree(self):
        with self.assertRaises(mod.LedgerError) as ctx:
            mod.validate(self.data, expected_source_sha="c" * 40)
        self.assertEqual(str(ctx.exception), "CANDIDATE_REVISION_MISMATCH")

    def test_not_run_has_no_fabricated_zero_or_private_data_leak(self):
        data = copy.deepcopy(self.data)
        data["purpose"] = "PRIVATE_REPOSITORY_NAME_OR_PROMPT_PAYLOAD"
        report = json.dumps(mod.validate(data))
        self.assertNotIn("PRIVATE_REPOSITORY_NAME_OR_PROMPT_PAYLOAD", report)
        self.assertNotIn(str(ROOT), report)
        self.assertNotIn("input_tokens", report)

    def test_unsupported_evidence_ref_rejected(self):
        data = copy.deepcopy(self.data)
        data["baseline"]["candidate_source_sha"] = "c" * 40
        data["gates"][0]["status"] = "PASS"
        evidence = self.evidence("owner")
        evidence["reference"] = "file:///C:/private/secret.txt"
        data["gates"][0]["evidence"] = [evidence]
        self.assert_blocked(data, "INVALID_EVIDENCE_REFERENCE")

    def test_cli_reports_blocked_and_require_review_ready_exits_3(self):
        normal = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(normal.returncode, 0, normal.stderr)
        self.assertEqual(json.loads(normal.stdout)["status"], "BLOCKED")
        forced = subprocess.run([sys.executable, str(SCRIPT), "--require-review-ready"],
                                capture_output=True, text=True)
        self.assertEqual(forced.returncode, 3, forced.stderr)

    def test_cli_output_is_exclusive_and_sanitized(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "report.json"
            args = [sys.executable, str(SCRIPT), "--output", str(target)]
            first = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertFalse(json.loads(target.read_text(encoding="utf-8"))["release_approved_by_tool"])
            second = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(second.returncode, 2)
            self.assertIn("LEDGER_UNREADABLE_OR_OUTPUT_UNAVAILABLE", second.stderr)
            self.assertNotIn(str(target), second.stderr)

    def valid_all_claims(self):
        data = copy.deepcopy(self.data)
        data["baseline"]["candidate_source_sha"] = "c" * 40
        data["baseline"]["artifact_digest_sha256"] = "e" * 64
        data["execution"]["independent_evaluator_run"] = True
        data["execution"]["real_world_pilot_executed"] = True
        data["execution"]["owner_release_approval"] = True
        for entry in data["gates"]:
            entry["status"] = "PASS"
            entry["reason_code"] = "EVIDENCE_PRESENT"
            entry["evidence"] = [self.evidence(entry["required_verifier"])]
        for entry in data["scenarios"]:
            entry["status"] = "PASS"
            entry["reason_code"] = "EVIDENCE_PRESENT"
            role = "independent_evaluator" if entry["method"] == "CONTROL_TREATMENT" else "owner"
            entry["evidence"] = [self.evidence(role)]
        return data


if __name__ == "__main__":
    unittest.main(verbosity=2)
