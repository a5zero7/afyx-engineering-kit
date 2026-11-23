#!/usr/bin/env python3
"""Public A5 orchestration regressions; no model, network, or campaign execution."""

from __future__ import annotations

import copy
import json
import subprocess
import unittest
from pathlib import Path

from evals.forge import orchestrator
from evals.forge import validate as forge_validate


ROOT = Path(__file__).resolve().parents[2]


class ForgeOrchestratorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = forge_validate.load_json(forge_validate.MANIFEST_PATH)

    def test_plan_is_deterministic_complete_and_non_executable(self) -> None:
        first = orchestrator.build_public_plan(copy.deepcopy(self.manifest))
        second = orchestrator.build_public_plan(copy.deepcopy(self.manifest))

        self.assertEqual(first, second)
        self.assertEqual(first["cell_count"], 36)
        self.assertEqual(len(first["cells"]), 36)
        self.assertEqual(len({cell["cell_id"] for cell in first["cells"]}), 36)
        self.assertEqual(
            first["cell_order_sha256"],
            self.manifest["discovery"]["cell_order_sha256"],
        )
        self.assertFalse(first["execution_authorized"])
        self.assertFalse(first["benchmark_execution"])
        self.assertEqual(
            first["campaign_blockers"], self.manifest["benchmark_execution_blockers"]
        )

    def test_plan_exposes_only_public_identity_and_order_fields(self) -> None:
        plan = orchestrator.build_public_plan(copy.deepcopy(self.manifest))
        serialized = json.dumps(plan).casefold()
        for forbidden in (
            "user_prompt",
            "validation_command",
            "private_bundle",
            "ground_truth",
            "canary",
            "evaluator_identity",
            "credential",
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(
            set(plan["cells"][0]),
            {
                "ordinal",
                "cell_id",
                "candidate_id",
                "candidate_sha256",
                "scenario_id",
                "scenario_category",
                "fixture_sha256",
            },
        )

    def test_authorization_or_order_drift_fails_closed(self) -> None:
        for mutate in (
            lambda value: value["discovery"].__setitem__("execution_authorized", True),
            lambda value: value["discovery"].__setitem__("cell_order_sha256", "0" * 64),
            lambda value: value["campaign_gate"].__setitem__(
                "execution_authorization", "GRANTED"
            ),
        ):
            tampered = copy.deepcopy(self.manifest)
            mutate(tampered)
            with self.subTest(tampered=tampered), self.assertRaises(
                orchestrator.OrchestrationRefusal
            ):
                orchestrator.build_public_plan(tampered)

    def test_cli_emits_the_same_read_only_plan(self) -> None:
        completed = subprocess.run(
            ["python", "-m", "evals.forge.orchestrator"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertEqual(
            json.loads(completed.stdout),
            orchestrator.build_public_plan(copy.deepcopy(self.manifest)),
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
