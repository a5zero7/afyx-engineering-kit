#!/usr/bin/env python3
"""Offline deterministic readiness checks for V1.3.0-B4 Campaign A benchmark harness."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVAL_ROOT = ROOT / "evals"
sys.path.insert(0, str(EVAL_ROOT / "harness"))
import freeze  # noqa: E402


class BenchmarkReadinessTests(unittest.TestCase):
    def test_campaign_a_matrix_budget_and_scenarios_are_valid(self) -> None:
        manifest = json.loads((EVAL_ROOT / "manifest.json").read_text(encoding="utf-8"))
        matrix = manifest.get("campaign_a_matrix", {})
        self.assertEqual(set(matrix.keys()), {"N", "S", "G", "F"})
        self.assertEqual(manifest.get("campaign_a_budget", {}).get("max_runs"), 27)

        expected_metrics = {
            "task_correctness",
            "regression_rate",
            "total_session_tokens",
            "tool_calls",
            "capability_activation",
            "end_to_end_duration_ms",
            "afyx_runtime_overhead_ms",
            "ace_retrieval_cost",
            "graph_extraction_accuracy",
        }
        self.assertTrue(expected_metrics.issubset(set(manifest.get("measurement_fields", []))))

        categories = {s["category"] for s in manifest.get("scenarios", [])}
        for required_cat in (
            "direct/non-odoo",
            "direct/odoo",
            "cross-file-dependency-analysis",
            "regression-diagnosis",
            "long-diagnostic-output",
            "multi-module-validation-planning",
        ):
            self.assertIn(required_cat, categories)

    def test_b4_environment_fingerprint_matches_repository_skills(self) -> None:
        env = json.loads((EVAL_ROOT / "environment-v1.3.0-b4.json").read_text(encoding="utf-8"))
        self.assertFalse(env.get("secrets_recorded"))
        for skill in ("efficient-coding", "odoo-engineering", "afyx-engineering-expert"):
            expected = env["skills"][skill]["content_sha256"]
            actual = freeze.directory_content_sha256(freeze.resolve_skill_directory(skill))
            self.assertEqual(actual, expected, f"Skill hash drift for {skill}")

    def test_campaign_a_coding_oracles_fail_before_fix_and_diag_passes(self) -> None:
        # Cross-file and regression fixtures have intentional failing oracles until solved
        cross = subprocess.run(
            [sys.executable, "-m", "unittest", "test_deps.py"],
            cwd=str(EVAL_ROOT / "fixtures" / "campaign-a-cross-file"),
            capture_output=True, text=True,
        )
        self.assertNotEqual(cross.returncode, 0)

        reg = subprocess.run(
            [sys.executable, "-m", "unittest", "test_regression.py"],
            cwd=str(EVAL_ROOT / "fixtures" / "campaign-a-regression"),
            capture_output=True, text=True,
        )
        self.assertNotEqual(reg.returncode, 0)

        diag = subprocess.run(
            [sys.executable, "-m", "unittest", "test_diag.py"],
            cwd=str(EVAL_ROOT / "fixtures" / "campaign-a-long-diag"),
            capture_output=True, text=True,
        )
        self.assertEqual(diag.returncode, 0)


if __name__ == "__main__":
    unittest.main()
