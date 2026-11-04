#!/usr/bin/env python3
"""Synthetic-only regressions for the AFYX-286 public controller boundary."""

from __future__ import annotations

import copy
import hashlib
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from evals.forge import controller, validate as forge_validate


ROOT = Path(__file__).resolve().parents[2]
ENVIRONMENT_FINGERPRINT = "a" * 64
RESTRICTED_IDENTITY = r"SYNTHETIC\restricted_agent"
CORRECT_CONTENT = (
    "def clamp(value: int, lower: int, upper: int) -> int:\n"
    "    \"\"\"Return value constrained to the inclusive lower/upper bounds.\"\"\"\n"
    "    return max(lower, min(upper, value))\n"
)
CORRECT_DIGEST = hashlib.sha256(CORRECT_CONTENT.encode("utf-8")).hexdigest()


def complete_outcome(**kwargs) -> controller.ProcessOutcome:
    return controller.ProcessOutcome(
        stdout_upstream_truncated=False,
        stderr_upstream_truncated=False,
        **kwargs,
    )


class FakeLauncher:
    def __init__(
        self,
        *,
        outcome: controller.ProcessOutcome | None = None,
        content: str | None = CORRECT_CONTENT,
        extra_file: bool = False,
        extra_files: dict[str, str] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.outcome = outcome or complete_outcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            stdout="synthetic completion",
            provider_tokens={"input": 10, "output": 5},
            tool_calls=1,
        )
        self.content = content
        self.extra_file = extra_file
        self.extra_files = extra_files or {}
        self.error = error
        self.requests: list[controller.LaunchRequest] = []

    def launch(self, request: controller.LaunchRequest) -> controller.ProcessOutcome:
        self.requests.append(request)
        if self.error:
            raise self.error
        if self.content is not None:
            (request.workspace / "known_math.py").write_text(self.content, encoding="utf-8")
        if self.extra_file:
            (request.workspace / "unexpected.py").write_text("x = 1\n", encoding="utf-8")
        for relative, value in self.extra_files.items():
            target = request.workspace / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(value, encoding="utf-8")
        return self.outcome


class FakeEvidenceRecorder:
    def __init__(
        self,
        *,
        prepare_factory=None,
        finalize_factory=None,
        prepare_error: Exception | None = None,
        finalize_error: Exception | None = None,
    ) -> None:
        self.prepare_factory = prepare_factory
        self.finalize_factory = finalize_factory
        self.prepare_error = prepare_error
        self.finalize_error = finalize_error
        self.bindings: list[controller.EvidenceBinding] = []
        self.finalization_requests: list[controller.EvidenceFinalizationRequest] = []

    def prepare(
        self, binding: controller.EvidenceBinding
    ) -> controller.ArchiveReadinessReceipt:
        self.bindings.append(binding)
        if self.prepare_error is not None:
            raise self.prepare_error
        if self.prepare_factory is not None:
            return self.prepare_factory(binding)
        return controller.build_archive_readiness_receipt(
            binding, "synthetic-evidence-session-001"
        )

    def finalize(
        self, request: controller.EvidenceFinalizationRequest
    ) -> controller.EvidenceFinalizationReceipt:
        self.finalization_requests.append(request)
        if self.finalize_error is not None:
            raise self.finalize_error
        if self.finalize_factory is not None:
            return self.finalize_factory(request)
        return controller.build_evidence_finalization_receipt(request)


class FakeEvidenceReceiptVerifier:
    def __init__(
        self,
        *,
        readiness_error: Exception | None = None,
        finalization_error: Exception | None = None,
        readiness_return=None,
        finalization_return=None,
    ) -> None:
        self.readiness_error = readiness_error
        self.finalization_error = finalization_error
        self.readiness_return = readiness_return
        self.finalization_return = finalization_return
        self.readiness_receipts: list[controller.ArchiveReadinessReceipt] = []
        self.finalization_receipts: list[controller.EvidenceFinalizationReceipt] = []

    def verify_readiness(self, binding, receipt):
        self.readiness_receipts.append(receipt)
        if self.readiness_error is not None:
            raise self.readiness_error
        return self.readiness_return

    def verify_finalization(self, request, receipt):
        self.finalization_receipts.append(receipt)
        if self.finalization_error is not None:
            raise self.finalization_error
        return self.finalization_return


class FailedCleanupManager(controller.DisposableWorkspaceManager):
    def cleanup(self, lease: controller.WorkspaceLease) -> bool:
        return False


class RaisingCleanupManager(controller.DisposableWorkspaceManager):
    def cleanup(self, lease: controller.WorkspaceLease) -> bool:
        raise OSError("synthetic-private-cleanup-path")


class PrivateCapableArtifactValidator:
    def validate(self, request, outcome, files_modified):
        return controller.ArtifactValidation(
            command_exit_code=0,
            content_checks={"artifact": {"private": "synthetic-secret"}},
        )


class SecretKeyArtifactValidator:
    def validate(self, request, outcome, files_modified):
        return controller.ArtifactValidation(
            command_exit_code=0,
            content_checks={"opaqueSecret7x9": True},
        )


class PublicControllerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = controller.load_public_manifest()
        self.temporary = tempfile.TemporaryDirectory(prefix="afyx-controller-test-")
        self.workspace_parent = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_streaming_hash_matches_authoritative_canonical_content(self) -> None:
        cases = {
            "utf8-lf": "alpha\nβeta\n".encode("utf-8"),
            "utf8-crlf": b"alpha\r\nbeta\r\n",
            "isolated-cr": b"alpha\rbeta\r",
            "mixed-endings": b"alpha\r\nbeta\rgamma\ndelta",
            "chunk-boundary-crlf": (b"a" * (64 * 1024 - 1)) + b"\r\nz",
            "chunk-boundary-cr": (b"a" * (64 * 1024 - 1)) + b"\rz",
            "invalid-utf8-raw-fallback": b"alpha\xff\r\nbeta\r",
        }
        for name, content in cases.items():
            with self.subTest(case=name):
                path = self.workspace_parent / f"{name}.bin"
                path.write_bytes(content)
                digest, size = controller._stream_file_sha256(
                    path, normalize_lf=True
                )
                self.assertEqual(digest, forge_validate.file_sha256(path))
                self.assertEqual(size, len(content))

    def input(self, candidate_id: str = "B0", scenario_index: int = 0) -> dict:
        scenario = self.manifest["scenarios"][scenario_index]
        candidate = self.manifest["candidates"][candidate_id]
        return {
            "schema_version": 1,
            "evaluation_run_id": "synthetic-run-001",
            "control_run_id": "synthetic-control-001",
            "cell_id": f"{scenario['scenario_id']}::{candidate_id}::r1",
            "candidate": {
                "id": candidate_id,
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
            "limits": {"timeout_seconds": 30, "model_retries": 0},
        }

    def make_controller(
        self,
        launcher: FakeLauncher,
        *,
        workspace_manager: controller.DisposableWorkspaceManager | None = None,
        validator: controller.ArtifactValidator | None = None,
        recorder: controller.EvidenceRetentionRecorder | None = None,
        receipt_verifier: controller.EvidenceReceiptVerifier | None = None,
        **controller_options,
    ) -> controller.PublicController:
        return controller.PublicController(
            manifest=self.manifest,
            repository_root=ROOT,
            workspace_manager=workspace_manager
            or controller.DisposableWorkspaceManager(self.workspace_parent),
            launcher=launcher,
            artifact_validator=validator
            or controller.DigestArtifactValidator(
                {"known_math.py": CORRECT_DIGEST}, command_exit_code=0
            ),
            evidence_recorder=recorder or FakeEvidenceRecorder(),
            evidence_receipt_verifier=receipt_verifier
            or FakeEvidenceReceiptVerifier(),
            expected_environment_fingerprint=ENVIRONMENT_FINGERPRINT,
            expected_restricted_identity=RESTRICTED_IDENTITY,
            **controller_options,
        )

    def test_positive_cell_materializes_validates_and_cleans(self) -> None:
        launcher = FakeLauncher()
        result = self.make_controller(launcher).run(self.input())
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["files_modified"], ["known_math.py"])
        self.assertEqual(result["cleanup"], "PASS")
        self.assertEqual(result["retry_count"], 0)
        self.assertEqual(result["hard_gate_results"]["correctness"], "NOT_TESTED")
        self.assertNotIn("stdout", result)
        self.assertEqual(
            launcher.requests[0].forbidden_output_markers,
            controller.DEFAULT_FORBIDDEN_OUTPUT_MARKERS,
        )
        self.assertFalse(any(self.workspace_parent.iterdir()))

    def test_evidence_retention_is_verified_before_pass(self) -> None:
        recorder = FakeEvidenceRecorder()
        result = self.make_controller(FakeLauncher(), recorder=recorder).run(self.input())
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(
            result["evidence_retention"]["archive_ready"], True
        )
        self.assertEqual(
            result["evidence_retention"]["archive_finalized"], True
        )
        self.assertRegex(
            result["evidence_retention"]["readiness_receipt_sha256"],
            r"^[0-9a-f]{64}$",
        )
        self.assertRegex(
            result["evidence_retention"]["finalization_receipt_sha256"],
            r"^[0-9a-f]{64}$",
        )
        self.assertEqual(len(recorder.bindings), 1)
        self.assertEqual(len(recorder.finalization_requests), 1)
        self.assertNotIn("synthetic-evidence-session-001", str(result))

    def test_archive_readiness_failure_prevents_launch_and_leaks_nothing(self) -> None:
        launcher = FakeLauncher()
        recorder = FakeEvidenceRecorder(
            prepare_error=RuntimeError("private-path synthetic-secret")
        )
        result = self.make_controller(launcher, recorder=recorder).run(self.input())
        self.assertEqual(result["result"], "FAIL")
        self.assertEqual(launcher.requests, [])
        self.assertIn(
            "evidence_archive_not_ready",
            result["validation_outcomes"]["failure_codes"],
        )
        self.assertFalse(result["evidence_retention"]["archive_ready"])
        self.assertFalse(result["evidence_retention"]["archive_finalized"])
        self.assertNotIn("private-path", str(result))
        self.assertNotIn("synthetic-secret", str(result))

    def test_missing_stale_or_malformed_readiness_receipt_prevents_launch(self) -> None:
        def stale(binding):
            stale_binding = replace(binding, retention_challenge_id="0" * 32)
            return controller.build_archive_readiness_receipt(
                stale_binding, "synthetic-stale-session"
            )

        def bad_digest(binding):
            receipt = controller.build_archive_readiness_receipt(
                binding, "synthetic-bad-digest-session"
            )
            return replace(receipt, receipt_sha256="0" * 64)

        def private_path_session(binding):
            return controller.ArchiveReadinessReceipt(
                schema_version=1,
                stage="READY",
                evidence_session_id=r"C:\private\archive",
                binding=binding,
                receipt_sha256="0" * 64,
            )

        cases = (
            lambda binding: None,
            lambda binding: {"success": True},
            stale,
            bad_digest,
            private_path_session,
        )
        for factory in cases:
            with self.subTest(factory=getattr(factory, "__name__", "anonymous")):
                launcher = FakeLauncher()
                recorder = FakeEvidenceRecorder(prepare_factory=factory)
                result = self.make_controller(launcher, recorder=recorder).run(
                    self.input()
                )
                self.assertEqual(result["result"], "FAIL")
                self.assertEqual(launcher.requests, [])
                self.assertIn(
                    "evidence_receipt_invalid",
                    result["validation_outcomes"]["failure_codes"],
                )

    def test_failed_or_partial_finalization_cannot_pass(self) -> None:
        def partial(request):
            receipt = controller.build_evidence_finalization_receipt(request)
            return replace(receipt, capture_scope=("raw_stdout",))

        recorders = (
            FakeEvidenceRecorder(
                finalize_error=RuntimeError("private finalization detail")
            ),
            FakeEvidenceRecorder(finalize_factory=lambda request: None),
            FakeEvidenceRecorder(finalize_factory=partial),
        )
        for recorder in recorders:
            with self.subTest(recorder=type(recorder).__name__):
                result = self.make_controller(
                    FakeLauncher(), recorder=recorder
                ).run(self.input())
                self.assertEqual(result["result"], "FAIL")
                self.assertTrue(result["evidence_retention"]["archive_ready"])
                self.assertFalse(result["evidence_retention"]["archive_finalized"])
                self.assertTrue(
                    {"evidence_archive_finalize_failed", "evidence_receipt_invalid"}
                    & set(result["validation_outcomes"]["failure_codes"])
                )
                self.assertNotIn("private finalization detail", str(result))

    def test_public_retention_metadata_is_strict_and_path_free(self) -> None:
        result = self.make_controller(FakeLauncher()).run(self.input())
        for mutation in (
            {**result["evidence_retention"], "private_path": "synthetic-secret"},
            {**result["evidence_retention"], "readiness_receipt_sha256": "secret"},
            {
                "archive_ready": False,
                "archive_finalized": False,
                "readiness_receipt_sha256": None,
                "finalization_receipt_sha256": None,
            },
        ):
            with self.subTest(fields=sorted(mutation)):
                candidate = copy.deepcopy(result)
                candidate["evidence_retention"] = mutation
                with self.assertRaises(controller.ContractViolation):
                    controller.validate_public_result(candidate, self.manifest)

    def test_independent_receipt_verification_is_required(self) -> None:
        launcher = FakeLauncher()
        readiness_verifier = FakeEvidenceReceiptVerifier(
            readiness_error=RuntimeError("unverified readiness")
        )
        readiness_result = self.make_controller(
            launcher, receipt_verifier=readiness_verifier
        ).run(self.input())
        self.assertEqual(readiness_result["result"], "FAIL")
        self.assertEqual(launcher.requests, [])
        self.assertIn(
            "evidence_receipt_invalid",
            readiness_result["validation_outcomes"]["failure_codes"],
        )

        finalization_verifier = FakeEvidenceReceiptVerifier(
            finalization_error=RuntimeError("unverified finalization")
        )
        finalization_result = self.make_controller(
            FakeLauncher(), receipt_verifier=finalization_verifier
        ).run(self.input())
        self.assertEqual(finalization_result["result"], "FAIL")
        self.assertTrue(
            finalization_result["evidence_retention"]["archive_ready"]
        )
        self.assertFalse(
            finalization_result["evidence_retention"]["archive_finalized"]
        )
        self.assertIn(
            "evidence_receipt_invalid",
            finalization_result["validation_outcomes"]["failure_codes"],
        )

    def test_unexpected_readiness_verifier_return_prevents_launch(self) -> None:
        for unexpected in (False, True, "synthetic-secret", {"verified": True}, object()):
            with self.subTest(return_type=type(unexpected).__name__):
                launcher = FakeLauncher()
                verifier = FakeEvidenceReceiptVerifier(readiness_return=unexpected)
                result = self.make_controller(
                    launcher, receipt_verifier=verifier
                ).run(self.input())
                self.assertEqual(result["result"], "FAIL")
                self.assertEqual(launcher.requests, [])
                self.assertIn(
                    "evidence_receipt_invalid",
                    result["validation_outcomes"]["failure_codes"],
                )
                self.assertNotIn("synthetic-secret", str(result))

    def test_unexpected_finalization_verifier_return_prevents_pass(self) -> None:
        for unexpected in (False, True, "synthetic-secret", {"verified": True}, object()):
            with self.subTest(return_type=type(unexpected).__name__):
                verifier = FakeEvidenceReceiptVerifier(finalization_return=unexpected)
                result = self.make_controller(
                    FakeLauncher(), receipt_verifier=verifier
                ).run(self.input())
                self.assertEqual(result["result"], "FAIL")
                self.assertTrue(result["evidence_retention"]["archive_ready"])
                self.assertFalse(result["evidence_retention"]["archive_finalized"])
                self.assertIn(
                    "evidence_receipt_invalid",
                    result["validation_outcomes"]["failure_codes"],
                )
                self.assertNotIn("synthetic-secret", str(result))

    def test_all_frozen_candidates_materialize_without_contamination(self) -> None:
        for candidate_id in self.manifest["candidate_order"]:
            with self.subTest(candidate_id=candidate_id):
                result = self.make_controller(FakeLauncher()).run(self.input(candidate_id))
                self.assertEqual(result["result"], "PASS")
                self.assertEqual(result["candidate_id"], candidate_id)
                self.assertFalse(any(self.workspace_parent.iterdir()))

    def test_advisory_cell_preserves_null_command_and_zero_mutation(self) -> None:
        launcher = FakeLauncher(
            content=None,
            outcome=complete_outcome(
                identity=RESTRICTED_IDENTITY,
                exit_code=0,
                tool_calls=0,
            ),
        )
        validator = controller.DigestArtifactValidator({}, command_exit_code=None)
        result = self.make_controller(launcher, validator=validator).run(
            self.input(scenario_index=5)
        )
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["files_modified"], [])
        self.assertIsNone(result["validation_outcomes"]["command_exit_code"])

    def test_malformed_input_is_rejected_before_workspace_creation(self) -> None:
        payload = self.input()
        payload.pop("control_run_id")
        with self.assertRaisesRegex(controller.ContractViolation, "public schema"):
            self.make_controller(FakeLauncher()).run(payload)
        self.assertFalse(any(self.workspace_parent.iterdir()))

    def test_candidate_fingerprint_mismatch_is_rejected(self) -> None:
        payload = self.input()
        payload["candidate"]["content_sha256"] = "0" * 64
        with self.assertRaisesRegex(controller.ContractViolation, "fingerprint mismatch"):
            self.make_controller(FakeLauncher()).run(payload)

    def test_unsafe_allowed_path_is_rejected(self) -> None:
        payload = self.input()
        payload["scenario"]["allowed_file_scope"] = ["../outside.py"]
        with self.assertRaises(controller.ContractViolation) as caught:
            self.make_controller(FakeLauncher()).run(payload)
        self.assertEqual(caught.exception.code, "unsafe_path")

    def test_reparse_tree_is_rejected_fail_closed(self) -> None:
        tree = self.workspace_parent / "synthetic-tree"
        tree.mkdir()
        with mock.patch.object(controller, "_is_reparse", return_value=True):
            with self.assertRaises(controller.ContractViolation) as caught:
                controller.assert_safe_tree(tree)
        self.assertEqual(caught.exception.code, "unsafe_reparse")

    def test_identity_mismatch_fails_result(self) -> None:
        outcome = complete_outcome(
            identity=r"SYNTHETIC\unexpected_identity", exit_code=0
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertEqual(result["result"], "FAIL")
        self.assertIn("identity_mismatch", result["validation_outcomes"]["failure_codes"])

    def test_timeout_and_owned_process_tree_status_are_recorded(self) -> None:
        outcome = complete_outcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=None,
            timed_out=True,
            process_tree_terminated=False,
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertTrue(result["timeout"])
        self.assertIn("timeout", result["validation_outcomes"]["failure_codes"])
        self.assertIn(
            "process_tree_not_terminated", result["validation_outcomes"]["failure_codes"]
        )

    def test_launcher_exception_fails_sanitization_and_preserves_cleanup(self) -> None:
        recorder = FakeEvidenceRecorder()
        result = self.make_controller(
            FakeLauncher(error=RuntimeError("synthetic launcher failure")),
            recorder=recorder,
        ).run(self.input())
        self.assertEqual(result["result"], "FAIL")
        self.assertEqual(result["sanitization"], "FAIL")
        self.assertEqual(result["cleanup"], "PASS")
        self.assertIn("launcher_failure", result["validation_outcomes"]["failure_codes"])
        self.assertIn(
            "upstream_output_unverified",
            result["validation_outcomes"]["failure_codes"],
        )
        self.assertEqual(result["evidence"], {})
        self.assertTrue(result["evidence_retention"]["archive_finalized"])
        self.assertEqual(len(recorder.finalization_requests), 1)
        self.assertTrue(recorder.finalization_requests[0].launcher_started)
        self.assertFalse(recorder.finalization_requests[0].outcome_observed)

    def test_unexpected_process_termination_fails(self) -> None:
        outcome = complete_outcome(identity=RESTRICTED_IDENTITY, exit_code=None)
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertIn(
            "unexpected_process_termination", result["validation_outcomes"]["failure_codes"]
        )

    def test_cleanup_failure_is_correlated_and_fails(self) -> None:
        manager = FailedCleanupManager(self.workspace_parent)
        result = self.make_controller(FakeLauncher(), workspace_manager=manager).run(self.input())
        self.assertEqual(result["cleanup"], "FAIL")
        self.assertIn("cleanup_failed", result["validation_outcomes"]["failure_codes"])
        self.assertTrue(result["evidence_retention"]["archive_finalized"])

    def test_cleanup_exception_is_sanitized_and_fails(self) -> None:
        manager = RaisingCleanupManager(self.workspace_parent)
        result = self.make_controller(FakeLauncher(), workspace_manager=manager).run(self.input())
        self.assertEqual(result["result"], "FAIL")
        self.assertEqual(result["cleanup"], "FAIL")
        self.assertIn("cleanup_failed", result["validation_outcomes"]["failure_codes"])
        self.assertNotIn("synthetic-private-cleanup-path", str(result))

    def test_unsafe_output_marker_is_not_published(self) -> None:
        outcome = complete_outcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            stdout="Authorization: Bearer synthetic-secret",
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertEqual(result["sanitization"], "FAIL")
        self.assertIn("unsafe_output_marker", result["validation_outcomes"]["failure_codes"])
        self.assertNotIn("synthetic-secret", str(result))

    def test_unsafe_output_marker_beyond_capture_limit_fails_closed(self) -> None:
        outcome = complete_outcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            stdout=("x" * 70_000) + " Authorization: Bearer synthetic-secret",
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertEqual(result["sanitization"], "FAIL")
        self.assertTrue(result["evidence"]["stdout_truncated"])
        self.assertIn("unsafe_output_marker", result["validation_outcomes"]["failure_codes"])
        self.assertNotIn("synthetic-secret", str(result))

    def test_upstream_truncation_without_complete_suffix_scan_fails_closed(self) -> None:
        outcome = controller.ProcessOutcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            stdout="clean-prefix-only",
            stdout_upstream_truncated=True,
            stderr_upstream_truncated=False,
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertEqual(result["result"], "FAIL")
        self.assertEqual(result["sanitization"], "FAIL")
        self.assertIn(
            "upstream_output_unverified",
            result["validation_outcomes"]["failure_codes"],
        )
        self.assertFalse(result["evidence"]["stdout_truncated"])
        self.assertNotIn("clean-prefix-only", str(result))

    def test_invalid_or_missing_upstream_capture_metadata_fails_closed(self) -> None:
        cases = (
            controller.ProcessOutcome(identity=RESTRICTED_IDENTITY, exit_code=0),
            controller.ProcessOutcome(
                identity=RESTRICTED_IDENTITY,
                exit_code=0,
                stdout_upstream_truncated="invalid",
                stderr_upstream_truncated=False,
            ),
        )
        for outcome in cases:
            with self.subTest(metadata=outcome.stdout_upstream_truncated):
                result = self.make_controller(FakeLauncher(outcome=outcome)).run(
                    self.input()
                )
                self.assertEqual(result["sanitization"], "FAIL")
                self.assertIn(
                    "upstream_output_unverified",
                    result["validation_outcomes"]["failure_codes"],
                )

    def test_verified_bounded_upstream_scan_does_not_require_full_buffering(self) -> None:
        outcome = controller.ProcessOutcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            stdout="bounded-clean-prefix",
            stdout_upstream_truncated=True,
            stderr_upstream_truncated=False,
            stdout_stream_scan_complete=True,
            stdout_stream_forbidden_marker=False,
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["sanitization"], "PASS")
        self.assertFalse(result["evidence"]["stdout_truncated"])
        self.assertNotIn("bounded-clean-prefix", str(result))

    def test_verified_upstream_scan_marker_fails_without_publishing_content(self) -> None:
        outcome = controller.ProcessOutcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            stdout="bounded-clean-prefix",
            stdout_upstream_truncated=True,
            stderr_upstream_truncated=False,
            stdout_stream_scan_complete=True,
            stdout_stream_forbidden_marker=True,
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertEqual(result["sanitization"], "FAIL")
        self.assertIn(
            "unsafe_output_marker", result["validation_outcomes"]["failure_codes"]
        )
        self.assertNotIn("bounded-clean-prefix", str(result))

    def test_exit_zero_with_incorrect_artifact_fails(self) -> None:
        result = self.make_controller(
            FakeLauncher(content="def clamp(*args):\n    return 999\n")
        ).run(self.input())
        self.assertIn(
            "artifact_validation_failed", result["validation_outcomes"]["failure_codes"]
        )

    def test_unexpected_file_mutation_fails_scope(self) -> None:
        result = self.make_controller(FakeLauncher(extra_file=True)).run(self.input())
        self.assertIn("file_scope_violation", result["validation_outcomes"]["failure_codes"])
        self.assertNotIn("unexpected.py", result["files_modified"])

    def test_secret_like_unknown_filename_is_not_published(self) -> None:
        secret_like_name = "opaque-7x9-private-value.py"
        result = self.make_controller(
            FakeLauncher(extra_files={secret_like_name: "x = 1\n"})
        ).run(self.input())
        self.assertEqual(result["result"], "FAIL")
        self.assertIn("file_scope_violation", result["validation_outcomes"]["failure_codes"])
        self.assertNotIn(secret_like_name, str(result))

    def test_workspace_inventory_limits_fail_closed_and_cleanup(self) -> None:
        cases = (
            (
                "file-count",
                FakeLauncher(extra_files={"count-limit.txt": "x"}),
                {"max_workspace_files": 11},
                "workspace_file_count_limit",
            ),
            (
                "per-file-size",
                FakeLauncher(extra_files={"size-limit.txt": "x" * 1_014}),
                {"max_workspace_file_bytes": 1_013},
                "workspace_file_size_limit",
            ),
            (
                "aggregate-bytes",
                FakeLauncher(extra_files={"total-limit.txt": "x" * 1_000}),
                {"max_workspace_total_bytes": 5_000},
                "workspace_total_bytes_limit",
            ),
        )
        for name, launcher, options, failure_code in cases:
            with self.subTest(limit=name):
                result = self.make_controller(launcher, **options).run(self.input())
                self.assertEqual(result["result"], "FAIL")
                self.assertEqual(result["cleanup"], "PASS")
                self.assertIn(
                    failure_code, result["validation_outcomes"]["failure_codes"]
                )
                self.assertFalse(any(self.workspace_parent.iterdir()))

        ticks = iter(float(value) for value in range(1, 1_000))
        with mock.patch.object(
            controller.time, "monotonic", side_effect=lambda: next(ticks)
        ):
            result = self.make_controller(
                FakeLauncher(), inventory_deadline_seconds=2.0
            ).run(self.input())
        self.assertEqual(result["result"], "FAIL")
        self.assertEqual(result["cleanup"], "PASS")
        self.assertIn(
            "workspace_inventory_timeout",
            result["validation_outcomes"]["failure_codes"],
        )
        self.assertFalse(any(self.workspace_parent.iterdir()))

    def test_retry_policy_is_zero_and_enforced(self) -> None:
        payload = self.input()
        payload["limits"]["model_retries"] = 1
        with self.assertRaises(controller.ContractViolation) as caught:
            self.make_controller(FakeLauncher()).run(payload)
        self.assertEqual(caught.exception.code, "retry_policy")

    def test_observed_retry_is_reported_as_failure(self) -> None:
        outcome = complete_outcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            retry_count=1,
        )
        result = self.make_controller(FakeLauncher(outcome=outcome)).run(self.input())
        self.assertEqual(result["retry_count"], 1)
        self.assertIn("retry_policy", result["validation_outcomes"]["failure_codes"])

    def test_public_result_rejects_raw_output_fields(self) -> None:
        result = self.make_controller(FakeLauncher()).run(self.input())
        result["stdout"] = "not publishable"
        with self.assertRaises(controller.ContractViolation) as caught:
            controller.validate_public_result(result, self.manifest)
        self.assertEqual(caught.exception.code, "result_schema")

    def test_public_result_schema_transition_is_explicit(self) -> None:
        current = self.make_controller(FakeLauncher()).run(self.input())
        self.assertEqual(
            controller.validate_public_result(current, self.manifest),
            controller.PUBLIC_RESULT_COMPATIBILITY_CURRENT,
        )

        historical = copy.deepcopy(current)
        historical["schema_version"] = 1
        historical.pop("evidence_retention")
        with self.assertRaises(controller.ContractViolation):
            controller.validate_public_result(historical, self.manifest)
        self.assertEqual(
            controller.validate_public_result(
                historical, self.manifest, allow_historical_v1=True
            ),
            controller.PUBLIC_RESULT_COMPATIBILITY_HISTORICAL,
        )

    def test_public_result_schema_rejects_mixed_or_unknown_versions(self) -> None:
        current = self.make_controller(FakeLauncher()).run(self.input())
        cases = []
        mixed_v1 = copy.deepcopy(current)
        mixed_v1["schema_version"] = 1
        cases.append((mixed_v1, True))
        mixed_v2 = copy.deepcopy(current)
        mixed_v2.pop("evidence_retention")
        cases.append((mixed_v2, False))
        unknown = copy.deepcopy(current)
        unknown["schema_version"] = 3
        cases.append((unknown, True))
        for candidate, allow_historical in cases:
            with self.subTest(
                version=candidate["schema_version"],
                allow_historical=allow_historical,
            ):
                with self.assertRaises(controller.ContractViolation) as caught:
                    controller.validate_public_result(
                        candidate,
                        self.manifest,
                        allow_historical_v1=allow_historical,
                    )
                self.assertEqual(caught.exception.code, "result_schema")

    def test_public_result_rejects_private_capable_nested_adapter_values(self) -> None:
        mutations = (
            ("provider_tokens", {"input": {"private": "synthetic-secret"}}),
            ("provider_tokens", {"opaqueSecret7x9": 1}),
            ("provider_tokens", {f"metric-{index}": 1 for index in range(17)}),
            (
                "validation_outcomes",
                {
                    "command_exit_code": 0,
                    "content_checks": {"artifact": "synthetic-secret"},
                    "failure_codes": [],
                },
            ),
            (
                "validation_outcomes",
                {
                    "command_exit_code": 0,
                    "content_checks": {
                        f"check-{index}": True
                        for index in range(controller.MAX_PUBLIC_METADATA_ITEMS + 1)
                    },
                    "failure_codes": [],
                },
            ),
            (
                "lifecycle",
                {
                    "workspace_created": True,
                    "process_tree_terminated": True,
                    "cleanup_correlated": {"private": "synthetic-secret"},
                },
            ),
            ("evidence", {"private": "synthetic-secret"}),
        )
        baseline = self.make_controller(FakeLauncher()).run(self.input())
        for field, value in mutations:
            with self.subTest(field=field, value_type=type(value).__name__):
                result = copy.deepcopy(baseline)
                result[field] = value
                with self.assertRaises(controller.ContractViolation) as caught:
                    controller.validate_public_result(result, self.manifest)
                self.assertEqual(caught.exception.code, "result_schema")

    def test_injected_adapters_cannot_publish_private_capable_metadata(self) -> None:
        outcome = complete_outcome(
            identity=RESTRICTED_IDENTITY,
            exit_code=0,
            provider_tokens={"opaqueSecret7x9": 1},
        )
        cases = (
            (FakeLauncher(outcome=outcome), None, "opaqueSecret7x9"),
            (
                FakeLauncher(),
                PrivateCapableArtifactValidator(),
                "synthetic-secret",
            ),
        )
        for launcher, validator, private_value in cases:
            with self.subTest(adapter=type(validator or launcher).__name__):
                result = self.make_controller(launcher, validator=validator).run(
                    self.input()
                )
                self.assertEqual(result["result"], "FAIL")
                self.assertNotIn(private_value, str(result))
                self.assertEqual(
                    set(result["validation_outcomes"]["content_checks"]),
                    controller.PUBLIC_CONTENT_CHECK_FIELDS,
                )
                self.assertFalse(any(self.workspace_parent.iterdir()))

    def test_adapter_check_names_are_reduced_to_public_aggregate(self) -> None:
        result = self.make_controller(
            FakeLauncher(), validator=SecretKeyArtifactValidator()
        ).run(self.input())
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(
            result["validation_outcomes"]["content_checks"],
            {"artifact_validation": True},
        )
        self.assertNotIn("opaqueSecret7x9", str(result))


if __name__ == "__main__":
    unittest.main(verbosity=2)
