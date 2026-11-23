#!/usr/bin/env python3
"""Actual-subprocess tests for the developer-only native-Windows Forge lab."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from evals.forge import controller, windows_lab


ROOT = Path(__file__).resolve().parents[2]
ENVIRONMENT_FINGERPRINT = "7" * 64


@unittest.skipUnless(os.name == "nt", "native-Windows lab")
class ForgeWindowsLabTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="afyx-windows-lab-test-")
        self.root = Path(self.temporary.name)
        self.workspace_root = self.root / "workspaces"
        self.evidence_root = self.root / "retained-evidence"
        self.workspace_root.mkdir()
        self.manifest = controller.load_public_manifest()
        self.current_token = windows_lab._inspect_current_token()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def require_unelevated_host(self) -> None:
        try:
            windows_lab._require_nonprivileged_token(self.current_token)
        except PermissionError as error:
            self.skipTest(f"actual lab requires an unelevated token: {error}")

    def payload(self, timeout_seconds: int = 5) -> dict[str, object]:
        scenario = self.manifest["scenarios"][0]
        candidate = self.manifest["candidates"]["B0"]
        return {
            "schema_version": 1,
            "evaluation_run_id": "windows-lab-run-001",
            "control_run_id": "windows-lab-control-001",
            "cell_id": "forge-known-file-001::B0::r1",
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
        mode: str = "success",
        faults: windows_lab.WindowsLabFaults | None = None,
    ) -> tuple[dict, windows_lab.WindowsLabEvidenceRecorder]:
        recorder = windows_lab.WindowsLabEvidenceRecorder(
            self.evidence_root, faults=faults
        )
        verifier = windows_lab.WindowsLabEvidenceVerifier(self.evidence_root)
        lab_controller = controller.PublicController(
            manifest=self.manifest,
            repository_root=ROOT,
            workspace_manager=controller.DisposableWorkspaceManager(
                self.workspace_root
            ),
            launcher=windows_lab.BindingLauncher(recorder, mode=mode),
            artifact_validator=controller.DigestArtifactValidator(
                {"known_math.py": windows_lab.synthetic_artifact_sha256()},
                command_exit_code=0,
            ),
            evidence_recorder=recorder,
            evidence_receipt_verifier=verifier,
            expected_environment_fingerprint=ENVIRONMENT_FINGERPRINT,
            expected_restricted_identity=windows_lab.expected_identity(),
        )
        return (
            lab_controller.run(
                self.payload(timeout_seconds=1 if mode == "timeout" else 5)
            ),
            recorder,
        )

    def only_session(self) -> Path:
        sessions = [
            path
            for path in self.evidence_root.iterdir()
            if not path.name.startswith(".")
        ]
        self.assertEqual(len(sessions), 1)
        return sessions[0]

    def test_actual_windows_process_identity_retention_and_cleanup(self) -> None:
        self.require_unelevated_host()
        result, recorder = self.run_lab()
        session = self.only_session()
        capture = json.loads((session / "capture.json").read_text("utf-8"))

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(recorder.process_start_count, 1)
        self.assertEqual(result["provider_tokens"], "NOT_AVAILABLE")
        self.assertEqual(result["retry_count"], 0)
        self.assertTrue(
            all(
                verdict == "NOT_TESTED"
                for verdict in result["hard_gate_results"].values()
            )
        )
        self.assertTrue(result["evidence_retention"]["archive_ready"])
        self.assertTrue(result["evidence_retention"]["archive_finalized"])
        self.assertEqual(result["cleanup"], "PASS")
        self.assertFalse(any(self.workspace_root.iterdir()))
        self.assertTrue((session / "finalization.json").is_file())
        self.assertEqual(
            capture["process_state"]["launcher"],
            "fixed-windows-synthetic-child-v1",
        )
        self.assertTrue(
            capture["process_state"]["profile_redirected_to_workspace"]
        )
        self.assertEqual(
            capture["process_state"]["expected_identity"],
            self.current_token.public_identity,
        )
        self.assertEqual(
            capture["process_state"]["observed_child_identity"],
            self.current_token.public_identity,
        )
        self.assertFalse(
            capture["process_state"]["observed_child_token_elevated"]
        )
        self.assertLessEqual(
            capture["process_state"]["observed_child_integrity_rid"], 0x2000
        )
        self.assertFalse(capture["process_state"]["timed_out"])
        self.assertTrue(capture["process_state"]["process_tree_terminated"])

    def test_timeout_terminates_owned_process_tree_and_retains_failure(self) -> None:
        self.require_unelevated_host()
        result, _ = self.run_lab(mode="timeout")
        capture = json.loads(
            (self.only_session() / "capture.json").read_text("utf-8")
        )

        self.assertEqual(result["result"], "FAIL")
        self.assertTrue(result["timeout"])
        self.assertIn("timeout", result["validation_outcomes"]["failure_codes"])
        self.assertEqual(result["cleanup"], "PASS")
        self.assertTrue(result["evidence_retention"]["archive_finalized"])
        self.assertTrue(capture["process_state"]["child_pid_observed"])
        self.assertFalse(capture["process_state"]["child_alive_after_cleanup"])
        self.assertTrue(capture["process_state"]["process_tree_terminated"])

    def test_persisted_verifier_rejects_replay_after_restart(self) -> None:
        recorder = windows_lab.WindowsLabEvidenceRecorder(self.evidence_root)
        binding = controller.EvidenceBinding(
            evaluation_run_id="windows-lab-run-replay",
            control_run_id="windows-lab-control-replay",
            cell_id="forge-known-file-001::B0::r1",
            candidate_id="B0",
            scenario_id="forge-known-file-001",
            candidate_fingerprint=self.manifest["candidates"]["B0"][
                "content_identity"
            ],
            fixture_fingerprint=self.manifest["public_fixture"]["tree_sha256"],
            environment_fingerprint=ENVIRONMENT_FINGERPRINT,
            retention_challenge_id="1" * 32,
        )
        receipt = recorder.prepare(binding)
        restarted_verifier = windows_lab.WindowsLabEvidenceVerifier(
            self.evidence_root
        )
        restarted_verifier.verify_readiness(binding, receipt)

        another_restart = windows_lab.WindowsLabEvidenceVerifier(self.evidence_root)
        with self.assertRaises(FileExistsError):
            another_restart.verify_readiness(binding, receipt)

    def test_capture_interruption_fails_without_false_finalization(self) -> None:
        self.require_unelevated_host()
        result, recorder = self.run_lab(
            faults=windows_lab.WindowsLabFaults(capture_failure=True)
        )

        self.assertEqual(recorder.process_start_count, 1)
        self.assertEqual(result["result"], "FAIL")
        self.assertIn("launcher_failure", result["validation_outcomes"]["failure_codes"])
        self.assertFalse(result["evidence_retention"]["archive_finalized"])
        self.assertEqual(result["cleanup"], "PASS")

    def test_failed_job_assignment_kills_actual_process_and_cleans_workspace(
        self,
    ) -> None:
        self.require_unelevated_host()
        observed_pids: list[int] = []

        def reject_assignment(process) -> int:
            observed_pids.append(process.pid)
            raise OSError("injected job assignment failure")

        with mock.patch.object(
            windows_lab, "_create_owned_job", side_effect=reject_assignment
        ):
            result, recorder = self.run_lab()

        self.assertEqual(len(observed_pids), 1)
        self.assertFalse(windows_lab._pid_exists(observed_pids[0]))
        self.assertEqual(recorder.process_start_count, 1)
        self.assertEqual(result["result"], "FAIL")
        self.assertIn(
            "launcher_failure", result["validation_outcomes"]["failure_codes"]
        )
        self.assertEqual(result["cleanup"], "PASS")
        self.assertFalse(any(self.workspace_root.iterdir()))

    def test_corrupted_archive_is_rejected_after_actual_process(self) -> None:
        self.require_unelevated_host()
        result, recorder = self.run_lab(
            faults=windows_lab.WindowsLabFaults(tamper_after_capture=True)
        )

        self.assertEqual(recorder.process_start_count, 1)
        self.assertEqual(result["result"], "FAIL")
        self.assertIn(
            "evidence_archive_finalize_failed",
            result["validation_outcomes"]["failure_codes"],
        )
        self.assertFalse(result["evidence_retention"]["archive_finalized"])
        self.assertEqual(result["cleanup"], "PASS")

    def test_elevated_parent_is_rejected_before_child_creation(self) -> None:
        elevated = windows_lab.WindowsTokenIdentity(
            sid=self.current_token.sid,
            elevated=True,
            integrity_rid=0x3000,
        )
        with mock.patch.object(
            windows_lab, "_inspect_current_token", return_value=elevated
        ), mock.patch.object(windows_lab.subprocess, "Popen") as popen:
            result, recorder = self.run_lab()

        popen.assert_not_called()
        self.assertEqual(recorder.process_start_count, 0)
        self.assertEqual(result["result"], "FAIL")
        self.assertIn(
            "launcher_failure", result["validation_outcomes"]["failure_codes"]
        )
        self.assertEqual(result["cleanup"], "PASS")

    def test_observed_child_identity_mismatch_fails_closed(self) -> None:
        self.require_unelevated_host()
        mismatch = windows_lab.WindowsTokenIdentity(
            sid="S-1-5-21-1-2-3-1001",
            elevated=False,
            integrity_rid=self.current_token.integrity_rid,
        )
        with mock.patch.object(
            windows_lab, "_inspect_child_token", return_value=mismatch
        ):
            result, recorder = self.run_lab()

        self.assertEqual(recorder.process_start_count, 1)
        self.assertEqual(result["result"], "FAIL")
        self.assertIn(
            "launcher_failure", result["validation_outcomes"]["failure_codes"]
        )
        self.assertEqual(result["cleanup"], "PASS")
        self.assertFalse(any(self.workspace_root.iterdir()))

    def test_child_identity_observation_failure_fails_closed(self) -> None:
        self.require_unelevated_host()
        with mock.patch.object(
            windows_lab,
            "_inspect_child_token",
            side_effect=OSError("injected child token observation failure"),
        ):
            result, recorder = self.run_lab()

        self.assertEqual(recorder.process_start_count, 1)
        self.assertEqual(result["result"], "FAIL")
        self.assertIn(
            "launcher_failure", result["validation_outcomes"]["failure_codes"]
        )
        self.assertEqual(result["cleanup"], "PASS")
        self.assertFalse(any(self.workspace_root.iterdir()))

    def test_negative_filesystem_path_traversal_control(self) -> None:
        traversal_paths = [
            "../outside.txt",
            "..\\outside.txt",
            "subdir/../../escaped.txt",
            "/absolute/root.txt",
            "C:\\Windows\\System32\\calc.exe",
        ]
        for bad_path in traversal_paths:
            with self.subTest(bad_path=bad_path):
                with self.assertRaises(controller.ContractViolation):
                    controller.normalize_relative_path(bad_path)

    def test_external_sentinel_boundary_and_integrity_preserved(self) -> None:
        """Verify non-interference: out-of-workspace external sentinel is unmodified."""
        self.require_unelevated_host()
        external_sentinel = self.root / "external-sentinel.txt"
        sentinel_content = b"afyx-forge-sentinel-ground-truth-unmodified"
        external_sentinel.write_bytes(sentinel_content)

        result, _ = self.run_lab()

        self.assertEqual(result["result"], "PASS")
        self.assertTrue(external_sentinel.is_file())
        self.assertEqual(external_sentinel.read_bytes(), sentinel_content)

    def test_disposable_os_enforced_acl_denial(self) -> None:
        """Verify true Windows ACL enforcement on a disposable synthetic target."""
        self.require_unelevated_host()
        token_sid = self.current_token.sid if self.current_token else None
        if not token_sid:
            self.fail("Windows token SID is missing from current token inspection")

        principal = f"*{token_sid}"
        denied_target = self.root / "disposable-acl-denied.txt"
        denied_target.write_text("initial protected content", encoding="utf-8")

        acl_result = subprocess.run(
            ["icacls", str(denied_target), "/deny", f"{principal}:(W)"],
            capture_output=True,
            text=True,
        )
        if acl_result.returncode != 0:
            self.fail(
                f"icacls /deny setup failed (code {acl_result.returncode}): "
                f"{acl_result.stderr.strip() or acl_result.stdout.strip()}"
            )

        restore_result = None
        try:
            with self.assertRaises(PermissionError):
                denied_target.write_text("tampered content", encoding="utf-8")
        finally:
            restore_result = subprocess.run(
                ["icacls", str(denied_target), "/remove:d", principal],
                capture_output=True,
                text=True,
            )

        self.assertIsNotNone(restore_result)
        self.assertEqual(
            restore_result.returncode,
            0,
            f"icacls /remove:d failed: {restore_result.stderr.strip() or restore_result.stdout.strip()}",
        )
        denied_target.write_text("restored authorized content", encoding="utf-8")
        self.assertEqual(
            denied_target.read_text(encoding="utf-8"),
            "restored authorized content",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
