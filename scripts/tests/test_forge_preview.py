#!/usr/bin/env python3
"""Focused regressions for the Afyx Forge A5 opt-in development preview runner."""

from __future__ import annotations

import copy
import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from evals.forge import controller, preview, validate as forge_validate


ROOT = Path(__file__).resolve().parents[2]


class ForgePreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = forge_validate.load_json(forge_validate.MANIFEST_PATH)

    def test_opt_in_is_disabled_by_default(self) -> None:
        # Check function
        old_env = os.environ.get(preview.PREVIEW_OPT_IN_ENV)
        try:
            os.environ.pop(preview.PREVIEW_OPT_IN_ENV, None)
            self.assertFalse(preview.check_opt_in(False))
            self.assertTrue(preview.check_opt_in(True))

            os.environ[preview.PREVIEW_OPT_IN_ENV] = "1"
            self.assertTrue(preview.check_opt_in(False))
        finally:
            if old_env is not None:
                os.environ[preview.PREVIEW_OPT_IN_ENV] = old_env
            else:
                os.environ.pop(preview.PREVIEW_OPT_IN_ENV, None)

    def test_cli_requires_opt_in_flag_or_env(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "evals.forge.preview"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 1)
        self.assertIn("DISABLED by default", completed.stdout)

    def test_guidance_extraction_is_bounded_and_non_modifying(self) -> None:
        scenarios = {s["scenario_id"]: s for s in self.manifest["scenarios"]}
        scenario = scenarios["forge-cross-module-001"]
        guidance = preview.extract_task_guidance("B2", scenario, self.manifest, ROOT)

        self.assertEqual(guidance["candidate_id"], "B2")
        self.assertEqual(guidance["scenario_id"], "forge-cross-module-001")
        self.assertEqual(guidance["allowed_file_scope"], ["tax.py", "checkout.py"])
        self.assertIn("percentage-point", guidance["user_prompt"])
        self.assertIn("Baseline", guidance["directive_summary"])

    def test_cli_candidate_b3_guidance_and_materialization(self) -> None:
        observed_materializations: list[tuple[bool, bool]] = []

        def validate_materialization(
            command: list[str] | None, cwd: Path, timeout: int = 30
        ) -> tuple[int, str, str]:
            observed_materializations.append(
                (
                    (cwd / ".agents/skills/efficient-coding/SKILL.md").is_file(),
                    (cwd / "AGENTS.md").is_file(),
                )
            )
            return 1, "", ""

        stdout = io.StringIO()
        with (
            mock.patch.object(
                preview,
                "execute_validation_command",
                side_effect=validate_materialization,
            ),
            redirect_stdout(stdout),
        ):
            exit_code = preview.main(
                [
                    "--opt-in",
                    "--candidate",
                    "B3",
                    "--scenario",
                    "forge-known-file-001",
                    "--json",
                ]
            )

        result = json.loads(stdout.getvalue())
        guidance = result["guidance"]
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["candidate_id"], "B3")
        self.assertEqual(guidance["composition_order"], ["B1", "B2"])
        self.assertEqual(
            [item["candidate_id"] for item in guidance["component_definitions"]],
            ["B1", "B2"],
        )
        self.assertIn("B1 (Efficient Coding 1.2.0)", guidance["directive_summary"])
        self.assertIn(
            "B2 (Afyx Independent Engineering Baseline 0.1.0)",
            guidance["directive_summary"],
        )
        self.assertEqual(observed_materializations, [(True, True), (True, True)])
        self.assertTrue(result["disposable_workspace_cleaned"])

    def test_tampered_manifests_fail_before_preview_actions(self) -> None:
        mutations = {
            "prompt": lambda manifest: manifest["scenarios"][0].update(
                user_prompt="substituted prompt"
            ),
            "command": lambda manifest: manifest["scenarios"][0].update(
                validation_command=["python", "-c", "raise SystemExit(0)"]
            ),
            "candidate": lambda manifest: manifest["candidates"]["B2"].update(
                content_identity="0" * 64
            ),
            "fixture": lambda manifest: manifest["scenarios"][0].update(
                fixture="evals/forge/candidates/B2"
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                tampered = copy.deepcopy(self.manifest)
                mutate(tampered)
                with (
                    mock.patch.object(preview, "extract_task_guidance") as guidance,
                    mock.patch.object(controller, "_copy_tree_contents") as materialize,
                    mock.patch.object(preview, "execute_validation_command") as execute,
                ):
                    with self.assertRaises(preview.PreviewManifestInvalid):
                        preview.run_preview_scenario(
                            tampered, "B2", "forge-cross-module-001"
                        )
                guidance.assert_not_called()
                materialize.assert_not_called()
                execute.assert_not_called()

    def test_inspect_guidance_rejects_tampered_manifest_before_read(self) -> None:
        tampered = copy.deepcopy(self.manifest)
        tampered["scenarios"][0]["user_prompt"] = "substituted prompt"
        stderr = io.StringIO()
        with (
            mock.patch.object(forge_validate, "load_json", return_value=tampered),
            mock.patch.object(preview, "extract_task_guidance") as guidance,
            redirect_stderr(stderr),
        ):
            exit_code = preview.main(["--opt-in", "--inspect-guidance-only"])
        self.assertEqual(exit_code, 2)
        self.assertIn("frozen public Forge manifest validation failed", stderr.getvalue())
        guidance.assert_not_called()

    def test_preview_end_to_end_baseline_and_target_validation(self) -> None:
        # Test candidate B2 on forge-cross-module-001 with synthetic fix
        result = preview.run_preview_scenario(
            self.manifest,
            "B2",
            "forge-cross-module-001",
            repository_root=ROOT,
            apply_synthetic_fix=True,
        )
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(result["candidate_id"], "B2")
        self.assertEqual(result["baseline_validation"]["exit_code"], 1)
        self.assertEqual(result["target_validation"]["exit_code"], 0)
        self.assertTrue(result["scope_adherence"])
        self.assertEqual(set(result["files_modified"]), {"checkout.py", "tax.py"})
        self.assertTrue(result["disposable_workspace_cleaned"])
        self.assertFalse(result["quality_gate"]["enabled"])
        self.assertEqual(result["quality_gate"]["verdict"], "NOT_TESTED")
        self.assertNotIn("efficiency_report", result)

    def test_efficiency_report_uses_observed_deterministic_measurements(self) -> None:
        stdout = io.StringIO()
        with (
            mock.patch.object(
                preview,
                "monotonic",
                side_effect=[10.0, 11.0, 13.0, 14.0, 17.0, 20.0],
            ),
            redirect_stdout(stdout),
        ):
            exit_code = preview.main(
                [
                    "--opt-in",
                    "--candidate",
                    "B4",
                    "--scenario",
                    "forge-known-file-001",
                    "--apply-synthetic-fix",
                    "--efficiency-report",
                    "--json",
                ]
            )

        result = json.loads(stdout.getvalue())
        report = result["efficiency_report"]
        metrics = report["metrics"]
        self.assertEqual(exit_code, 0)
        self.assertEqual(
            report["efficiency_report_id"],
            "AFYX_FORGE_A7_PUBLIC_EFFICIENCY",
        )
        self.assertEqual(report["quality_gate_id"], preview.PUBLIC_QUALITY_GATE_ID)
        self.assertEqual(result["quality_gate"]["verdict"], "PASS")
        self.assertEqual(report["measurement_status"], "AVAILABLE")
        self.assertTrue(report["comparison_eligible"])
        self.assertEqual(metrics["total_elapsed"]["value"], 10.0)
        self.assertEqual(metrics["baseline_validation_duration"]["value"], 2.0)
        self.assertEqual(metrics["target_validation_duration"]["value"], 3.0)
        self.assertEqual(metrics["validation_subprocess_invocations"]["value"], 2)
        self.assertEqual(metrics["validation_nonzero_exits"]["value"], 1)
        self.assertEqual(metrics["validation_contract_mismatches"]["value"], 0)
        self.assertEqual(metrics["validation_timeouts"]["value"], 0)
        self.assertEqual(metrics["input_tokens"]["availability"], "NOT_AVAILABLE")
        self.assertEqual(
            metrics["provider_reported_cost"]["availability"], "NOT_AVAILABLE"
        )
        self.assertEqual(metrics["agent_tool_calls"]["availability"], "NOT_AVAILABLE")
        self.assertEqual(metrics["retry_count"]["availability"], "NOT_AVAILABLE")
        self.assertFalse(report["provenance"]["synthetic_activity_is_agent_activity"])

    def test_efficiency_comparison_requires_quality_pass(self) -> None:
        failed = preview.run_preview_scenario(
            self.manifest,
            "B4",
            "forge-known-file-001",
            repository_root=ROOT,
            efficiency_report=True,
        )
        not_tested = preview.run_preview_scenario(
            self.manifest,
            "B0",
            "forge-negative-simple-001",
            repository_root=ROOT,
            efficiency_report=True,
        )

        self.assertEqual(failed["quality_gate"]["verdict"], "FAIL")
        self.assertFalse(failed["efficiency_report"]["comparison_eligible"])
        self.assertIn(
            "quality_failed",
            failed["efficiency_report"]["comparison_ineligibility_reasons"],
        )
        self.assertEqual(not_tested["quality_gate"]["verdict"], "NOT_TESTED")
        self.assertFalse(not_tested["efficiency_report"]["comparison_eligible"])
        self.assertIn(
            "quality_not_tested",
            not_tested["efficiency_report"]["comparison_ineligibility_reasons"],
        )
        self.assertEqual(
            not_tested["efficiency_report"]["metrics"][
                "validation_subprocess_invocations"
            ]["value"],
            0,
        )
        self.assertEqual(
            not_tested["efficiency_report"]["metrics"][
                "baseline_validation_duration"
            ]["availability"],
            "NOT_AVAILABLE",
        )

    def test_efficiency_records_timeout_and_validation_failure(self) -> None:
        validation_results = [
            (1, "", ""),
            (124, "", "validation command timed out after 30 seconds"),
        ]

        def observed_validation(
            command: list[str] | None,
            cwd: Path,
            timeout: int = 30,
            *,
            observation: dict[str, bool] | None = None,
        ) -> tuple[int, str, str]:
            result = validation_results.pop(0)
            if result[0] == 124 and observation is not None:
                observation["timed_out"] = True
            return result

        with (
            mock.patch.object(
                preview,
                "execute_validation_command",
                side_effect=observed_validation,
            ),
            mock.patch.object(
                preview,
                "monotonic",
                side_effect=[1.0, 2.0, 3.0, 4.0, 6.0, 8.0],
            ),
        ):
            result = preview.run_preview_scenario(
                self.manifest,
                "B4",
                "forge-known-file-001",
                repository_root=ROOT,
                apply_synthetic_fix=True,
                efficiency_report=True,
            )

        report = result["efficiency_report"]
        self.assertEqual(result["quality_gate"]["verdict"], "FAIL")
        self.assertFalse(report["comparison_eligible"])
        self.assertEqual(report["metrics"]["validation_nonzero_exits"]["value"], 2)
        self.assertEqual(report["metrics"]["validation_contract_mismatches"]["value"], 1)
        self.assertEqual(report["metrics"]["validation_timeouts"]["value"], 1)

    def test_exit_124_is_not_timeout_without_timeout_observation(self) -> None:
        observation: dict[str, bool] = {}
        code, _, _ = preview.execute_validation_command(
            [sys.executable, "-c", "raise SystemExit(124)"],
            ROOT,
            observation=observation,
        )

        self.assertEqual(code, 124)
        self.assertFalse(observation["timed_out"])

        with mock.patch.object(
            preview.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(["python"], 1),
        ):
            code, _, _ = preview.execute_validation_command(
                [sys.executable, "-c", "pass"],
                ROOT,
                timeout=1,
                observation=observation,
            )

        self.assertEqual(code, 124)
        self.assertTrue(observation["timed_out"])

    def test_efficiency_measurements_fail_closed_when_invalid_or_inconsistent(
        self,
    ) -> None:
        quality_pass = {
            "quality_gate_id": preview.PUBLIC_QUALITY_GATE_ID,
            "enabled": True,
            "verdict": "PASS",
        }

        def observation() -> dict[str, int | float | None]:
            return {
                "total_elapsed_seconds": 5.0,
                "baseline_validation_seconds": 1.0,
                "target_validation_seconds": 2.0,
                "validation_subprocess_invocations": 2,
                "validation_nonzero_exit_count": 1,
                "validation_contract_mismatch_count": 0,
                "validation_timeout_count": 0,
            }

        negative = observation()
        negative["total_elapsed_seconds"] = -1.0
        inconsistent = observation()
        inconsistent["validation_subprocess_invocations"] = 1
        missing = observation()
        missing.pop("target_validation_seconds")
        zero = observation()
        zero.update(
            {
                "total_elapsed_seconds": 0.0,
                "baseline_validation_seconds": 0.0,
                "target_validation_seconds": 0.0,
                "validation_nonzero_exit_count": 0,
            }
        )

        for label, candidate in {
            "negative": negative,
            "inconsistent": inconsistent,
            "missing": missing,
        }.items():
            with self.subTest(label=label):
                report = preview.build_public_efficiency_report(
                    quality_pass, candidate
                )
                self.assertEqual(report["measurement_status"], "INVALID")
                self.assertFalse(report["comparison_eligible"])

        zero_report = preview.build_public_efficiency_report(quality_pass, zero)
        self.assertEqual(zero_report["measurement_status"], "AVAILABLE")
        self.assertTrue(zero_report["comparison_eligible"])

    def test_efficiency_rejects_invalid_or_disabled_quality_gate_link(self) -> None:
        observation = {
            "total_elapsed_seconds": 5.0,
            "baseline_validation_seconds": 1.0,
            "target_validation_seconds": 2.0,
            "validation_subprocess_invocations": 2,
            "validation_nonzero_exit_count": 1,
            "validation_contract_mismatch_count": 0,
            "validation_timeout_count": 0,
        }
        quality_links = {
            "missing_identity": {"enabled": True, "verdict": "PASS"},
            "incorrect_identity": {
                "quality_gate_id": "AFYX_FORGE_UNKNOWN_QUALITY_GATE",
                "enabled": True,
                "verdict": "PASS",
            },
            "disabled": {
                "quality_gate_id": preview.PUBLIC_QUALITY_GATE_ID,
                "enabled": False,
                "verdict": "PASS",
            },
        }

        for label, quality in quality_links.items():
            with self.subTest(label=label):
                report = preview.build_public_efficiency_report(
                    quality, observation
                )
                self.assertEqual(report["measurement_status"], "INVALID")
                self.assertFalse(report["comparison_eligible"])
                self.assertIn(
                    "quality_gate_link_invalid",
                    report["comparison_ineligibility_reasons"],
                )

    def test_efficiency_cleanup_failure_retains_diagnostics_but_blocks_comparison(
        self,
    ) -> None:
        scenario = next(
            item
            for item in self.manifest["scenarios"]
            if item["scenario_id"] == "forge-known-file-001"
        )
        outcome = {
            "baseline_validation": {
                "exit_code": 1,
                "expected_exit_code": 1,
                "matches_expected": True,
            },
            "target_validation": {
                "exit_code": 0,
                "expected_exit_code": 0,
                "matches_expected": True,
            },
            "synthetic_fix_applied": True,
            "applied_files": ["known_math.py"],
            "files_modified": ["known_math.py"],
            "scope_adherence": True,
            "disposable_workspace_cleaned": False,
        }
        quality = preview.evaluate_public_quality_gate(scenario, outcome)
        report = preview.build_public_efficiency_report(
            quality,
            {
                "total_elapsed_seconds": 5.0,
                "baseline_validation_seconds": 1.0,
                "target_validation_seconds": 2.0,
                "validation_subprocess_invocations": 2,
                "validation_nonzero_exit_count": 1,
                "validation_contract_mismatch_count": 0,
                "validation_timeout_count": 0,
            },
        )

        self.assertEqual(quality["verdict"], "FAIL")
        self.assertEqual(report["measurement_status"], "AVAILABLE")
        self.assertFalse(report["comparison_eligible"])
        self.assertEqual(report["metrics"]["total_elapsed"]["value"], 5.0)

    def test_quality_gate_cli_passes_complete_public_synthetic_result(self) -> None:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = preview.main(
                [
                    "--opt-in",
                    "--candidate",
                    "B4",
                    "--scenario",
                    "forge-known-file-001",
                    "--apply-synthetic-fix",
                    "--quality-gate",
                    "--json",
                ]
            )

        result = json.loads(stdout.getvalue())
        quality = result["quality_gate"]
        self.assertEqual(exit_code, 0)
        self.assertEqual(
            quality["quality_gate_id"],
            "AFYX_FORGE_A6_PUBLIC_QUALITY_GATE",
        )
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(quality["verdict"], "PASS")
        self.assertEqual(
            set(quality["gate_results"].values()),
            {"PASS"},
        )
        self.assertTrue(
            quality["evidence"]["artifact_validation"]["passed"]
        )

    def test_quality_gate_fails_closed_for_invalid_or_incomplete_outcomes(self) -> None:
        scenario = next(
            item
            for item in self.manifest["scenarios"]
            if item["scenario_id"] == "forge-cross-module-001"
        )

        def complete_outcome() -> dict[str, object]:
            return {
                "baseline_validation": {
                    "exit_code": 1,
                    "expected_exit_code": 1,
                    "matches_expected": True,
                },
                "target_validation": {
                    "exit_code": 0,
                    "expected_exit_code": 0,
                    "matches_expected": True,
                },
                "synthetic_fix_applied": True,
                "applied_files": ["checkout.py", "tax.py"],
                "files_modified": ["checkout.py", "tax.py"],
                "scope_adherence": True,
                "disposable_workspace_cleaned": True,
            }

        cases: dict[str, tuple[dict[str, object], str]] = {}

        missing_required = complete_outcome()
        missing_required["applied_files"] = ["tax.py"]
        missing_required["files_modified"] = ["tax.py"]
        cases["exit_zero_missing_required_change"] = (
            missing_required,
            "required_changes_incomplete",
        )

        no_op = complete_outcome()
        no_op["applied_files"] = []
        no_op["files_modified"] = []
        cases["no_op"] = (no_op, "required_changes_incomplete")

        out_of_scope = complete_outcome()
        out_of_scope["applied_files"] = ["checkout.py", "tax.py", "unexpected.py"]
        out_of_scope["files_modified"] = ["checkout.py", "tax.py", "unexpected.py"]
        out_of_scope["scope_adherence"] = False
        cases["out_of_scope"] = (out_of_scope, "quality_scope_violation")

        failed_regression = complete_outcome()
        failed_regression["target_validation"] = {
            "exit_code": 1,
            "expected_exit_code": 0,
            "matches_expected": False,
        }
        cases["failed_regression"] = (
            failed_regression,
            "regression_check_failed",
        )

        missing_evidence = complete_outcome()
        missing_evidence.pop("target_validation")
        cases["missing_evidence"] = (
            missing_evidence,
            "quality_evidence_incomplete",
        )

        inconsistent_evidence = complete_outcome()
        inconsistent_evidence["files_modified"] = [
            "checkout.py",
            "tax.py",
            "unexpected.py",
        ]
        cases["inconsistent_evidence"] = (
            inconsistent_evidence,
            "quality_evidence_inconsistent",
        )

        cleanup_failure = complete_outcome()
        cleanup_failure["disposable_workspace_cleaned"] = False
        cases["cleanup_failure"] = (
            cleanup_failure,
            "workspace_cleanup_failed",
        )

        for label, (outcome, expected_failure) in cases.items():
            with self.subTest(label=label):
                quality = preview.evaluate_public_quality_gate(scenario, outcome)
                self.assertEqual(quality["verdict"], "FAIL")
                self.assertIn(expected_failure, quality["failure_codes"])

    def test_quality_gate_marks_trusted_no_change_without_validation_not_tested(
        self,
    ) -> None:
        scenario = next(
            item
            for item in self.manifest["scenarios"]
            if item["scenario_id"] == "forge-negative-simple-001"
        )
        outcome = {
            "baseline_validation": {
                "exit_code": 0,
                "expected_exit_code": None,
                "matches_expected": True,
            },
            "target_validation": {
                "exit_code": 0,
                "expected_exit_code": None,
                "matches_expected": True,
            },
            "synthetic_fix_applied": False,
            "applied_files": [],
            "files_modified": [],
            "scope_adherence": True,
            "disposable_workspace_cleaned": True,
        }

        quality = preview.evaluate_public_quality_gate(scenario, outcome)

        self.assertEqual(quality["verdict"], "NOT_TESTED")
        self.assertEqual(quality["gate_results"]["task_fidelity"], "PASS")
        self.assertEqual(quality["gate_results"]["scope_adherence"], "PASS")
        self.assertEqual(quality["gate_results"]["evidence_quality"], "PASS")
        self.assertEqual(quality["gate_results"]["correctness"], "NOT_TESTED")
        self.assertEqual(
            quality["gate_results"]["regression_safety"], "NOT_TESTED"
        )

    def test_preview_candidate_b4_direct_scenario(self) -> None:
        # Test candidate B4 on forge-known-file-001 with synthetic fix
        result = preview.run_preview_scenario(
            self.manifest,
            "B4",
            "forge-known-file-001",
            repository_root=ROOT,
            apply_synthetic_fix=True,
        )
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(result["candidate_id"], "B4")
        self.assertEqual(result["baseline_validation"]["exit_code"], 1)
        self.assertEqual(result["target_validation"]["exit_code"], 0)
        self.assertTrue(result["scope_adherence"])
        self.assertEqual(result["files_modified"], ["known_math.py"])
        self.assertTrue(result["disposable_workspace_cleaned"])

    def test_preview_catches_scope_violation(self) -> None:
        original_fix = preview.apply_scenario_synthetic_fix

        def out_of_scope_fix(scenario_id: str, work: Path) -> list[str]:
            applied = original_fix(scenario_id, work)
            (work / "unexpected.py").write_text("UNEXPECTED = True\n", encoding="utf-8")
            return [*applied, "unexpected.py"]

        with mock.patch.object(
            preview, "apply_scenario_synthetic_fix", side_effect=out_of_scope_fix
        ):
            result = preview.run_preview_scenario(
                self.manifest,
                "B2",
                "forge-cross-module-001",
                repository_root=ROOT,
                apply_synthetic_fix=True,
            )
        self.assertFalse(result["scope_adherence"])
        self.assertEqual(result["verdict"], "FAIL")
        self.assertTrue(result["disposable_workspace_cleaned"])

    def test_cleanup_false_fails_result_and_cli_exit(self) -> None:
        original_manager = controller.DisposableWorkspaceManager

        class FalseCleanupManager(original_manager):
            def cleanup(self, lease: controller.WorkspaceLease) -> bool:
                super().cleanup(lease)
                return False

        stdout = io.StringIO()
        with (
            mock.patch.object(controller, "DisposableWorkspaceManager", FalseCleanupManager),
            redirect_stdout(stdout),
        ):
            exit_code = preview.main(
                ["--opt-in", "--apply-synthetic-fix", "--json"]
            )
        result = json.loads(stdout.getvalue())
        self.assertEqual(exit_code, 2)
        self.assertEqual(result["verdict"], "FAIL")
        self.assertFalse(result["disposable_workspace_cleaned"])
        self.assertEqual(result["failure_codes"], ["workspace_cleanup_failed"])

    def test_cleanup_exception_is_sanitized_and_fails(self) -> None:
        original_manager = controller.DisposableWorkspaceManager

        class RaisingCleanupManager(original_manager):
            def cleanup(self, lease: controller.WorkspaceLease) -> bool:
                super().cleanup(lease)
                raise RuntimeError("private path must not be reported")

        with mock.patch.object(
            controller, "DisposableWorkspaceManager", RaisingCleanupManager
        ):
            result = preview.run_preview_scenario(
                self.manifest,
                "B2",
                "forge-cross-module-001",
                repository_root=ROOT,
                apply_synthetic_fix=True,
            )
        serialized = json.dumps(result)
        self.assertEqual(result["verdict"], "FAIL")
        self.assertFalse(result["disposable_workspace_cleaned"])
        self.assertEqual(result["failure_codes"], ["workspace_cleanup_failed"])
        self.assertNotIn("private path", serialized)

    def test_inventory_deadline_is_duration_bounded_to_30_seconds(self) -> None:
        real_limits = controller.InventoryLimits
        observed: list[float] = []

        def capture_limits(**kwargs: object) -> controller.InventoryLimits:
            observed.append(float(kwargs["deadline_seconds"]))
            return real_limits(**kwargs)  # type: ignore[arg-type]

        with mock.patch.object(controller, "InventoryLimits", side_effect=capture_limits):
            result = preview.run_preview_scenario(
                self.manifest,
                "B4",
                "forge-known-file-001",
                repository_root=ROOT,
                apply_synthetic_fix=True,
            )
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(observed, [30.0])

    def test_unknown_candidate_or_scenario_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            preview.run_preview_scenario(self.manifest, "NONEXISTENT", "forge-cross-module-001")
        with self.assertRaises(ValueError):
            preview.run_preview_scenario(self.manifest, "B2", "NONEXISTENT")


if __name__ == "__main__":
    unittest.main(verbosity=2)

