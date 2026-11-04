#!/usr/bin/env python3
"""Actual-subprocess tests for the bounded Forge WSL lab adapter."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from evals.forge import controller, wsl_lab


ROOT = Path(__file__).resolve().parents[2]
ENVIRONMENT_FINGERPRINT = "b" * 64


class ReportedCleanupFailure(controller.DisposableWorkspaceManager):
    def cleanup(self, lease: controller.WorkspaceLease) -> bool:
        super().cleanup(lease)
        return False


class ForgeWslLabTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="afyx-wsl-lab-test-")
        self.root = Path(self.temporary.name)
        self.workspace_root = self.root / "workspaces"
        self.evidence_root = self.root / "retained-evidence"
        self.workspace_root.mkdir()
        self.manifest = controller.load_public_manifest()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def payload(self, *, timeout_seconds: int = 5) -> dict:
        scenario = self.manifest["scenarios"][0]
        candidate = self.manifest["candidates"]["B0"]
        return {
            "schema_version": 1,
            "evaluation_run_id": "wsl-lab-run-001",
            "control_run_id": "wsl-lab-control-001",
            "cell_id": f"{scenario['scenario_id']}::B0::r1",
            "candidate": {
                "id": "B0",
                "content_sha256": candidate["content_identity"],
                "activation": candidate["activation"],
            },
            "scenario": {
                "id": scenario["scenario_id"],
                "category": scenario["category"],
                "user_prompt": scenario["user_prompt"],
                "fixture_sha256": self.manifest["public_fixture"]["tree_sha256"],
                "allowed_file_scope": scenario["allowed_file_scope"],
                "validation_command": scenario["validation_command"],
            },
            "environment_sha256": ENVIRONMENT_FINGERPRINT,
            "limits": {"timeout_seconds": timeout_seconds, "model_retries": 0},
        }

    def run_lab(
        self,
        *,
        faults: wsl_lab.WslLabFaults | None = None,
        mode: str = "success",
        workspace_manager: controller.DisposableWorkspaceManager | None = None,
    ) -> tuple[dict, wsl_lab.WslLabEvidenceRecorder]:
        recorder = wsl_lab.WslLabEvidenceRecorder(self.evidence_root, faults=faults)
        verifier = wsl_lab.WslLabEvidenceVerifier(self.evidence_root)
        lab_controller = controller.PublicController(
            manifest=self.manifest,
            repository_root=ROOT,
            workspace_manager=workspace_manager
            or controller.DisposableWorkspaceManager(self.workspace_root),
            launcher=wsl_lab.BindingLauncher(recorder, mode=mode),
            artifact_validator=controller.DigestArtifactValidator(
                {"known_math.py": wsl_lab.synthetic_artifact_sha256()},
                command_exit_code=0,
            ),
            evidence_recorder=recorder,
            evidence_receipt_verifier=verifier,
            expected_environment_fingerprint=ENVIRONMENT_FINGERPRINT,
            expected_restricted_identity=wsl_lab.expected_identity(),
        )
        return lab_controller.run(
            self.payload(timeout_seconds=1 if mode == "timeout" else 5)
        ), recorder

    def only_session(self) -> Path:
        sessions = [path for path in self.evidence_root.iterdir() if path.name[0] != "."]
        self.assertEqual(len(sessions), 1)
        return sessions[0]

    def test_actual_process_retains_complete_originals_before_success(self) -> None:
        result, _ = self.run_lab()
        session = self.only_session()
        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["evidence_retention"]["archive_ready"])
        self.assertTrue(result["evidence_retention"]["archive_finalized"])
        self.assertEqual(result["cleanup"], "PASS")
        self.assertFalse(any(self.workspace_root.iterdir()))
        self.assertEqual((session / "stdout.bin").read_bytes(), wsl_lab.SYNTHETIC_STDOUT)
        self.assertEqual((session / "stderr.bin").read_bytes(), wsl_lab.SYNTHETIC_STDERR)
        capture = json.loads((session / "capture.json").read_text("utf-8"))
        self.assertEqual(
            capture["readiness_record_sha256"],
            hashlib.sha256((session / "readiness.json").read_bytes()).hexdigest(),
        )
        self.assertEqual(
            capture["process_state"]["launcher"], "fixed-wsl-synthetic-child-v1"
        )
        self.assertFalse(capture["process_state"]["timed_out"])
        self.assertEqual(
            result["evidence"]["stdout_sha256"],
            hashlib.sha256((session / "stdout.bin").read_bytes()).hexdigest(),
        )
        self.assertEqual(
            result["evidence"]["stderr_sha256"],
            hashlib.sha256((session / "stderr.bin").read_bytes()).hexdigest(),
        )
        self.assertTrue((session / "finalization.json").is_file())

    def test_capture_failure_fails_closed_after_actual_launch(self) -> None:
        result, recorder = self.run_lab(
            faults=wsl_lab.WslLabFaults(capture_failure=True)
        )
        self.assertEqual(recorder.process_start_count, 1)
        self.assertEqual(result["result"], "FAIL")
        self.assertIn("launcher_failure", result["validation_outcomes"]["failure_codes"])
        self.assertIn(
            "evidence_archive_finalize_failed",
            result["validation_outcomes"]["failure_codes"],
        )
        self.assertFalse(result["evidence_retention"]["archive_finalized"])

    def test_truncated_stream_fails_capture_and_public_coverage(self) -> None:
        result, _ = self.run_lab(faults=wsl_lab.WslLabFaults(truncate_stdout=True))
        self.assertEqual(result["result"], "FAIL")
        self.assertIn(
            "upstream_output_unverified",
            result["validation_outcomes"]["failure_codes"],
        )
        self.assertIn(
            "evidence_archive_finalize_failed",
            result["validation_outcomes"]["failure_codes"],
        )

    def test_tampered_original_is_rejected(self) -> None:
        result, _ = self.run_lab(faults=wsl_lab.WslLabFaults(tamper_after_capture=True))
        self.assertEqual(result["result"], "FAIL")
        self.assertIn(
            "evidence_archive_finalize_failed",
            result["validation_outcomes"]["failure_codes"],
        )

    def test_readiness_receipt_replay_is_rejected(self) -> None:
        recorder = wsl_lab.WslLabEvidenceRecorder(self.evidence_root)
        verifier = wsl_lab.WslLabEvidenceVerifier(self.evidence_root)
        binding = controller.EvidenceBinding(
            evaluation_run_id="wsl-lab-run-replay",
            control_run_id="wsl-lab-control-replay",
            cell_id="forge-known-file-001::B0::r1",
            candidate_id="B0",
            scenario_id="forge-known-file-001",
            candidate_fingerprint=self.manifest["candidates"]["B0"]["content_identity"],
            fixture_fingerprint=self.manifest["public_fixture"]["tree_sha256"],
            environment_fingerprint=ENVIRONMENT_FINGERPRINT,
            retention_challenge_id="1" * 32,
        )
        receipt = recorder.prepare(binding)
        verifier.verify_readiness(binding, receipt)
        with self.assertRaises(FileExistsError):
            verifier.verify_readiness(binding, receipt)

    def test_timeout_is_killed_captured_finalized_then_cleaned(self) -> None:
        result, _ = self.run_lab(mode="timeout")
        capture = json.loads((self.only_session() / "capture.json").read_text("utf-8"))
        self.assertEqual(result["result"], "FAIL")
        self.assertTrue(result["timeout"])
        self.assertIn("timeout", result["validation_outcomes"]["failure_codes"])
        self.assertTrue(result["evidence_retention"]["archive_finalized"])
        self.assertTrue(capture["process_state"]["timed_out"])
        self.assertLess(capture["process_state"]["exit_code"], 0)
        self.assertEqual(result["cleanup"], "PASS")

    def test_cleanup_failure_is_separate_from_finalization(self) -> None:
        manager = ReportedCleanupFailure(self.workspace_root)
        result, _ = self.run_lab(workspace_manager=manager)
        self.assertEqual(result["result"], "FAIL")
        self.assertTrue(result["evidence_retention"]["archive_finalized"])
        self.assertEqual(result["cleanup"], "FAIL")
        self.assertIn("cleanup_failed", result["validation_outcomes"]["failure_codes"])


if __name__ == "__main__":
    unittest.main()
