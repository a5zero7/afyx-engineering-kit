#!/usr/bin/env python3
"""Focused tests for AFYX Shared Evidence Interoperability & A5-A7 Gap Closure."""

from __future__ import annotations

import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from evals.forge import preview, shared_evidence, validate as forge_validate
from scripts import phase8_evidence_discovery


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_UUID = "12345678-1234-4234-8234-123456789abc"


def _write_exec_jsonl(
    path: Path,
    thread_id: str = SAMPLE_UUID,
    with_usage: bool = True,
    tool_status: str = "completed",
    exit_code: int = 0,
) -> None:
    usage = (
        {
            "input_tokens": 1200,
            "cached_input_tokens": 800,
            "cache_write_input_tokens": 0,
            "output_tokens": 150,
            "reasoning_output_tokens": 40,
        }
        if with_usage
        else None
    )
    events = [
        {"type": "thread.started", "thread_id": thread_id},
        {"type": "turn.started"},
        {
            "type": "item.started",
            "item": {"id": "cmd-1", "type": "command_execution"},
        },
        {
            "type": "item.completed",
            "item": {
                "id": "cmd-1",
                "type": "command_execution",
                "status": tool_status,
                "exit_code": exit_code,
            },
        },
        {
            "type": "item.completed",
            "item": {"id": "msg-1", "type": "agent_message", "text": "Fixed."},
        },
        {"type": "turn.completed", **({"usage": usage} if usage is not None else {})},
    ]
    path.write_text(
        "\n".join(json.dumps(event) for event in events) + "\n",
        encoding="utf-8",
    )


def _write_annotations_jsonl(path: Path, complete: bool = True) -> None:
    records = []
    if complete:
        records.append(
            {
                "type": "coverage",
                "complete_categories": [
                    "human_intervention",
                    "policy_denial",
                    "agent_fallback",
                    "rework",
                    "explicit_retry",
                ],
            }
        )
    records.append(
        {
            "event_type": "agent_fallback",
            "actor": "agent",
            "timestamp": "2026-10-29T09:00:00Z",
            "evidence_ref": "cmd-1",
        }
    )
    path.write_text(
        "\n".join(json.dumps(r) for r in records) + "\n",
        encoding="utf-8",
    )


class SharedEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = forge_validate.load_json(forge_validate.MANIFEST_PATH)
        cls.synthetic_pass_outcome = preview.run_preview_scenario(
            cls.manifest,
            "B2",
            "forge-cross-module-001",
            repository_root=ROOT,
            apply_synthetic_fix=True,
            quality_gate=True,
            efficiency_report=True,
        )

    def _correlated_forge_outcome(self, run_id: str = "cell-b4-cross-001") -> dict:
        outcome = copy.deepcopy(self.synthetic_pass_outcome)
        outcome.pop("preview_run_id", None)
        outcome.pop("preview_task", None)
        outcome.pop("guidance", None)
        outcome["run_id"] = run_id
        outcome["candidate_id"] = "B4"
        outcome["synthetic_fix_applied"] = False
        outcome["applied_files"] = []
        scenarios = {s["scenario_id"]: s for s in self.manifest["scenarios"]}
        scenario = scenarios[outcome["scenario_id"]]
        outcome["quality_gate"] = preview.evaluate_public_quality_gate(
            scenario, outcome
        )
        outcome["efficiency_report"]["quality_verdict"] = outcome["quality_gate"][
            "verdict"
        ]
        return outcome

    def test_public_synthetic_preview_bundle_and_jira_mapping(self) -> None:
        bundle = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
            execution_mode="PUBLIC_SYNTHETIC_PREVIEW",
        )
        self.assertEqual(
            bundle["contract_id"], shared_evidence.SHARED_EVIDENCE_CONTRACT_ID
        )
        self.assertTrue(bundle["synthetic_preview"])
        self.assertEqual(len(bundle["evidence_refs"]), 1)
        self.assertEqual(bundle["evidence_refs"][0]["role"], "forge_outcome")

        jira = bundle["jira_acceptance"]
        self.assertEqual(jira["AFYX-93"]["disposition"], "PASS")
        self.assertEqual(jira["AFYX-93"]["campaign_36_cell_status"], "0/36 NOT_RUN")
        self.assertFalse(jira["AFYX-93"]["task_completion_inferred"])

        self.assertEqual(jira["AFYX-94"]["disposition"], "PASS")
        self.assertFalse(jira["AFYX-94"]["real_agent_correctness_established"])

        self.assertEqual(jira["AFYX-95"]["disposition"], "PASS")
        self.assertTrue(jira["AFYX-95"]["comparison_eligible"])
        self.assertFalse(jira["AFYX-95"]["provider_telemetry_available"])
        self.assertEqual(jira["AFYX-95"]["superiority_claim"], "NOT_ESTABLISHED")
        self.assertFalse(jira["AFYX-95"]["token_or_monetary_savings_claimed"])

        self.assertEqual(jira["AFYX-68"]["disposition"], "NOT_TESTED")
        self.assertEqual(jira["AFYX-69"]["disposition"], "NOT_TESTED")
        self.assertEqual(jira["AFYX-283"]["disposition"], "NOT_TESTED")
        self.assertEqual(jira["AFYX-70"]["disposition"], "BLOCKED")
        self.assertTrue(jira["AFYX-70"]["reusable_correctness_evidence"])
        self.assertFalse(jira["AFYX-70"]["engineering_value_established"])

        # Verify raw prompt/stdout is not duplicated in bundle
        serialized = json.dumps(bundle)
        self.assertNotIn(
            self.synthetic_pass_outcome["guidance"]["user_prompt"], serialized
        )

    def test_synthetic_preview_cannot_be_relabelled_as_agent_execution(self) -> None:
        relabelled = copy.deepcopy(self.synthetic_pass_outcome)
        relabelled["run_id"] = "claimed-agent-run-001"
        relabelled.pop("preview_run_id", None)
        relabelled["synthetic_fix_applied"] = False

        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError,
            "synthetic preview outcome cannot be relabeled",
        ):
            shared_evidence.build_shared_evidence_bundle(
                relabelled,
                manifest=self.manifest,
                repository_root=ROOT,
                execution_mode="CORRELATED_AGENT_EXECUTION",
            )

    def test_correlated_agent_execution_supports_multiple_jira_acceptances(self) -> None:
        run_id = "cell-b4-cross-001"
        outcome = self._correlated_forge_outcome(run_id)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            event_file = tmp_path / f"rollout-{SAMPLE_UUID}.jsonl"
            ann_file = tmp_path / "annotations.jsonl"
            _write_exec_jsonl(event_file, SAMPLE_UUID, with_usage=True)
            _write_annotations_jsonl(ann_file, complete=True)

            discovery = phase8_evidence_discovery.discover(
                tmp_path, [SAMPLE_UUID]
            )
            ledger = shared_evidence.analyze_exec_events_strict(
                run_id,
                event_file,
                annotations=ann_file,
                expected_thread_id=SAMPLE_UUID,
            )
            expert_rec = {
                "schema_version": 2,
                "run_id": run_id,
                "scenario_id": outcome["scenario_id"],
                "candidate_tree_sha256": shared_evidence.EXPERT_CANDIDATE_TREE_SHA256,
                "expert_activated": True,
                "expert_reference_telemetry_observed": True,
                "initial_reference_reads": [
                    "references/solutions-architect.md",
                    "references/software-engineer.md",
                    "references/qa-engineer.md",
                ],
                "justified_expansion_reads": [],
                "d6_substantive_verdict": "BLOCKED",
            }

            bundle = shared_evidence.build_shared_evidence_bundle(
                outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                execution_mode="CORRELATED_AGENT_EXECUTION",
                phase8_ledger=ledger,
                phase8_discovery=discovery,
                expert_evidence=expert_rec,
                representative_multi_scenario=False,
            )

            roles = [ref["role"] for ref in bundle["evidence_refs"]]
            self.assertEqual(
                roles,
                [
                    "forge_outcome",
                    "phase8_event_ledger",
                    "phase8_evidence_discovery",
                    "expert_disclosure_evidence",
                ],
            )
            jira = bundle["jira_acceptance"]
            self.assertEqual(jira["AFYX-93"]["disposition"], "PASS")
            self.assertEqual(jira["AFYX-94"]["disposition"], "PASS")
            self.assertFalse(jira["AFYX-94"]["real_agent_correctness_established"])
            self.assertEqual(
                jira["AFYX-94"]["execution_provenance_status"],
                "UNVERIFIED_CORRELATED_RECORD",
            )
            self.assertEqual(jira["AFYX-95"]["disposition"], "PASS")
            self.assertTrue(jira["AFYX-95"]["provider_telemetry_available"])
            self.assertEqual(jira["AFYX-68"]["disposition"], "PASS")
            self.assertEqual(jira["AFYX-69"]["disposition"], "PASS")
            self.assertEqual(jira["AFYX-283"]["disclosure_gate_verdict"], "PASS")
            # Overall AFYX-283 remains BLOCKED until independent D.6 KEEP verdict
            self.assertEqual(jira["AFYX-283"]["disposition"], "BLOCKED")
            # AFYX-70 remains BLOCKED on single scenario
            self.assertEqual(jira["AFYX-70"]["disposition"], "BLOCKED")

            # Caller claims cannot self-authorize representative or D.6 acceptance.
            expert_keep = copy.deepcopy(expert_rec)
            expert_keep["d6_substantive_verdict"] = "KEEP"
            bundle_full = shared_evidence.build_shared_evidence_bundle(
                outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                execution_mode="CORRELATED_AGENT_EXECUTION",
                phase8_ledger=ledger,
                phase8_discovery=discovery,
                expert_evidence=expert_keep,
                representative_multi_scenario=True,
            )
            self.assertEqual(
                bundle_full["jira_acceptance"]["AFYX-283"]["disposition"],
                "BLOCKED",
            )
            self.assertEqual(
                bundle_full["jira_acceptance"]["AFYX-283"][
                    "d6_substantive_verdict"
                ],
                "BLOCKED",
            )
            self.assertEqual(
                bundle_full["jira_acceptance"]["AFYX-70"]["disposition"],
                "BLOCKED",
            )
            self.assertEqual(
                bundle_full["jira_acceptance"]["AFYX-93"]["coverage_scope"],
                "CALLER_REPORTED_MULTI_SCENARIO_UNVERIFIED",
            )

    def test_valid_telemetry_from_failed_task_and_failed_tool_calls(self) -> None:
        """Verify A6 task failure and failed tool calls do not invalidate observed telemetry."""
        run_id = "cell-task-failed-001"
        failed_task_outcome = self._correlated_forge_outcome(run_id)
        # Simulate A6 failure (e.g. wrong exit code or out-of-scope edit)
        failed_task_outcome["files_modified"] = ["unauthorized_file.py"]
        scenarios = {s["scenario_id"]: s for s in self.manifest["scenarios"]}
        scenario = scenarios[failed_task_outcome["scenario_id"]]
        failed_task_outcome["quality_gate"] = preview.evaluate_public_quality_gate(
            scenario, failed_task_outcome
        )
        self.assertEqual(failed_task_outcome["quality_gate"]["verdict"], "FAIL")
        failed_task_outcome["efficiency_report"]["quality_verdict"] = "FAIL"
        failed_task_outcome["efficiency_report"]["comparison_eligible"] = False
        failed_task_outcome["efficiency_report"]["comparison_ineligibility_reasons"] = ["quality_failed"]

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            event_file = tmp_path / f"rollout-{SAMPLE_UUID}.jsonl"
            ann_file = tmp_path / "annotations.jsonl"
            # Simulate a non-zero exit code on command_execution (failed tool call)
            _write_exec_jsonl(
                event_file,
                SAMPLE_UUID,
                with_usage=True,
                tool_status="failed",
                exit_code=1,
            )
            _write_annotations_jsonl(ann_file, complete=True)

            ledger = shared_evidence.analyze_exec_events_strict(
                run_id,
                event_file,
                annotations=ann_file,
                expected_thread_id=SAMPLE_UUID,
            )
            self.assertEqual(ledger["tool_events"]["observed_item_failures"], 1)

            bundle = shared_evidence.build_shared_evidence_bundle(
                failed_task_outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                execution_mode="CORRELATED_AGENT_EXECUTION",
                phase8_ledger=ledger,
            )
            jira = bundle["jira_acceptance"]
            # A6 failed task
            self.assertEqual(jira["AFYX-94"]["disposition"], "FAIL")
            # A6 failure prevents comparison eligibility and engineering value
            self.assertEqual(jira["AFYX-95"]["disposition"], "FAIL")
            self.assertFalse(jira["AFYX-95"]["comparison_eligible"])
            self.assertEqual(jira["AFYX-70"]["disposition"], "FAIL")
            # BUT telemetry observation itself remains valid PASS!
            self.assertEqual(jira["AFYX-68"]["disposition"], "PASS")
            self.assertEqual(jira["AFYX-68"]["observed_item_failures"], 1)
            self.assertTrue(
                jira["AFYX-68"]["telemetry_valid_despite_task_or_tool_failure"]
            )
            self.assertEqual(jira["AFYX-69"]["disposition"], "PASS")

    def test_reused_run_id_with_changed_source_rejected(self) -> None:
        """Reject mismatched or reused run ID when associated with conflicting source hashes."""
        run_id = "cell-b4-cross-001"
        outcome = self._correlated_forge_outcome(run_id)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            event_file1 = tmp_path / "events1.jsonl"
            event_file2 = tmp_path / "events2.jsonl"
            _write_exec_jsonl(event_file1, SAMPLE_UUID)
            # Write different event file content (different hash)
            event_file2.write_text(
                event_file1.read_text(encoding="utf-8") + '{"type":"error"}\n',
                encoding="utf-8",
            )
            # Legitimate ledger from file1
            ledger1 = shared_evidence.analyze_exec_events_strict(run_id, event_file1)
            # Conflicting additional reference claiming same run_id but with different source hash
            conflicting_ref = {
                "role": "phase8_audit_stream",
                "schema_version": 1,
                "sha256": "a" * 64,
                "run_id": run_id,
                "event_stream_sha256": "b" * 64,
            }
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError, "conflicting event stream source"
            ):
                shared_evidence.build_shared_evidence_bundle(
                    outcome,
                    manifest=self.manifest,
                    repository_root=ROOT,
                    execution_mode="CORRELATED_AGENT_EXECUTION",
                    phase8_ledger=ledger1,
                    additional_evidence_refs=[conflicting_ref],
                )

    def test_deduplication_allows_legitimate_immutable_source_references(self) -> None:
        """Deduplication must allow referencing the same immutable digest under different roles

        and safely deduplicate identical entries without crashing.
        """
        immutable_sha = "c" * 64
        # Two distinct roles referencing the same immutable digest
        refs = [
            {"role": "base_snapshot", "schema_version": 1, "sha256": immutable_sha},
            {"role": "parent_fixture", "schema_version": 1, "sha256": immutable_sha},
            # Exact duplicate entry of base_snapshot
            {"role": "base_snapshot", "schema_version": 1, "sha256": immutable_sha},
        ]
        bundle = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
            additional_evidence_refs=refs,
        )
        registered_roles = [r["role"] for r in bundle["evidence_refs"]]
        self.assertIn("base_snapshot", registered_roles)
        self.assertIn("parent_fixture", registered_roles)
        # Duplicate base_snapshot entry was safely deduplicated
        self.assertEqual(registered_roles.count("base_snapshot"), 1)

        # Conflicting digest for the same role is rejected
        conflicting = [
            {"role": "base_snapshot", "schema_version": 1, "sha256": "d" * 64}
        ]
        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError, "conflicting evidence record"
        ):
            shared_evidence.build_shared_evidence_bundle(
                self.synthetic_pass_outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                additional_evidence_refs=refs + conflicting,
            )

    def test_additional_evidence_reference_rejects_unexpected_fields(self) -> None:
        ref = {
            "role": "sanitized_supporting_record",
            "schema_version": 1,
            "sha256": "a" * 64,
            "private_note": "must not be projected",
        }

        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError,
            "unexpected additional evidence reference fields: private_note",
        ):
            shared_evidence.build_shared_evidence_bundle(
                self.synthetic_pass_outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                additional_evidence_refs=[ref],
            )

    def test_wrong_source_fixture_candidate_or_expert_identity_rejected(self) -> None:
        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError, "candidate_sha256"
        ):
            shared_evidence.build_shared_evidence_bundle(
                self.synthetic_pass_outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                candidate_sha256="0" * 64,
            )

        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError, "fixture_sha256"
        ):
            shared_evidence.build_shared_evidence_bundle(
                self.synthetic_pass_outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                fixture_sha256="f" * 64,
            )

        tampered_manifest = copy.deepcopy(self.manifest)
        tampered_manifest["candidates"]["B2"]["content_identity"] = "a" * 64
        with self.assertRaises(shared_evidence.SharedEvidenceError):
            shared_evidence.build_shared_evidence_bundle(
                self.synthetic_pass_outcome,
                manifest=tampered_manifest,
                repository_root=ROOT,
            )

        bad_expert = {
            "schema_version": 2,
            "run_id": self.synthetic_pass_outcome["preview_run_id"],
            "scenario_id": self.synthetic_pass_outcome["scenario_id"],
            "candidate_tree_sha256": "1" * 64,
        }
        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError, "frozen Expert v0.1.1"
        ):
            shared_evidence.build_shared_evidence_bundle(
                self.synthetic_pass_outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                expert_evidence=bad_expert,
            )

    def test_missing_or_incomplete_telemetry_remains_unavailable_never_zero(self) -> None:
        run_id = "cell-no-usage-001"
        outcome = self._correlated_forge_outcome(run_id)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            event_file = tmp_path / f"rollout-{SAMPLE_UUID}.jsonl"
            _write_exec_jsonl(event_file, SAMPLE_UUID, with_usage=False)
            ledger = shared_evidence.analyze_exec_events_strict(
                run_id, event_file, expected_thread_id=SAMPLE_UUID
            )
            bundle = shared_evidence.build_shared_evidence_bundle(
                outcome,
                manifest=self.manifest,
                repository_root=ROOT,
                execution_mode="CORRELATED_AGENT_EXECUTION",
                phase8_ledger=ledger,
            )
            metrics = bundle["metrics"]
            self.assertEqual(metrics["tokens"]["availability"], "NOT_AVAILABLE")
            self.assertIsNone(metrics["tokens"]["values"])
            self.assertEqual(
                metrics["interventions_and_rework"]["human_intervention"][
                    "availability"
                ],
                "NOT_AVAILABLE",
            )
            self.assertIsNone(
                metrics["interventions_and_rework"]["human_intervention"]["total"]
            )
            self.assertEqual(
                metrics["interventions_and_rework"]["rework"]["availability"],
                "NOT_AVAILABLE",
            )
            self.assertIsNone(
                metrics["interventions_and_rework"]["rework"]["total"]
            )
            self.assertEqual(
                metrics["provider_monetary_cost"]["availability"], "NOT_AVAILABLE"
            )
            self.assertIsNone(metrics["provider_monetary_cost"]["value"])

            jira = bundle["jira_acceptance"]
            self.assertEqual(jira["AFYX-95"]["disposition"], "BLOCKED")
            self.assertEqual(jira["AFYX-68"]["disposition"], "BLOCKED")
            self.assertEqual(jira["AFYX-69"]["disposition"], "BLOCKED")
            self.assertEqual(jira["AFYX-70"]["disposition"], "BLOCKED")

    def test_a6_failure_invalidates_positive_a7_and_jira_claims(self) -> None:
        failed_outcome = preview.run_preview_scenario(
            self.manifest,
            "B2",
            "forge-cross-module-001",
            repository_root=ROOT,
            apply_synthetic_fix=False,
            quality_gate=True,
            efficiency_report=True,
        )
        bundle = shared_evidence.build_shared_evidence_bundle(
            failed_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
            execution_mode="PUBLIC_SYNTHETIC_PREVIEW",
        )
        jira = bundle["jira_acceptance"]
        self.assertEqual(jira["AFYX-94"]["disposition"], "FAIL")
        self.assertEqual(jira["AFYX-95"]["disposition"], "FAIL")
        self.assertFalse(jira["AFYX-95"]["comparison_eligible"])
        self.assertEqual(jira["AFYX-70"]["disposition"], "FAIL")

        # Tampering efficiency_report to claim comparison_eligible=True on FAIL is rejected
        tampered = copy.deepcopy(failed_outcome)
        tampered["efficiency_report"]["comparison_eligible"] = True
        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError, "comparison_eligible"
        ):
            shared_evidence.build_shared_evidence_bundle(
                tampered,
                manifest=self.manifest,
                repository_root=ROOT,
            )

    def test_synthetic_measurements_cannot_masquerade_as_provider_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            event_file = Path(tmp) / "events.jsonl"
            _write_exec_jsonl(event_file, SAMPLE_UUID)
            ledger = shared_evidence.analyze_exec_events_strict(
                self.synthetic_pass_outcome["preview_run_id"], event_file
            )
            # Attaching Phase 8 ledger to PUBLIC_SYNTHETIC_PREVIEW is rejected
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError,
                "synthetic public preview cannot be associated",
            ):
                shared_evidence.build_shared_evidence_bundle(
                    self.synthetic_pass_outcome,
                    manifest=self.manifest,
                    repository_root=ROOT,
                    execution_mode="PUBLIC_SYNTHETIC_PREVIEW",
                    phase8_ledger=ledger,
                )

            # Claiming CORRELATED_AGENT_EXECUTION on synthetic outcome is rejected
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError, "synthetic"
            ):
                shared_evidence.build_shared_evidence_bundle(
                    self.synthetic_pass_outcome,
                    manifest=self.manifest,
                    repository_root=ROOT,
                    execution_mode="CORRELATED_AGENT_EXECUTION",
                    phase8_ledger=ledger,
                )

        # Injecting fake provider tokens into synthetic efficiency_report is rejected
        forged_synthetic = copy.deepcopy(self.synthetic_pass_outcome)
        forged_synthetic["efficiency_report"]["metrics"]["input_tokens"] = {
            "availability": "AVAILABLE",
            "value": 500,
            "unit": "tokens",
            "source": "provider_adapter",
        }
        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError,
            "synthetic preview cannot report provider metric",
        ):
            shared_evidence.build_shared_evidence_bundle(
                forged_synthetic,
                manifest=self.manifest,
                repository_root=ROOT,
            )

    def test_jsonl_formats_classified_and_never_silently_conflated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            rollout_file = tmp_path / "rollout-session.jsonl"
            rollout_file.write_text(
                json.dumps(
                    {"type": "session_meta", "payload": {"id": SAMPLE_UUID}}
                )
                + "\n"
                + json.dumps(
                    {"type": "token_usage_record", "usage": {"input_tokens": 10}}
                )
                + "\n",
                encoding="utf-8",
            )
            exec_file = tmp_path / "exec.jsonl"
            _write_exec_jsonl(exec_file, SAMPLE_UUID)

            mixed_file = tmp_path / "mixed.jsonl"
            mixed_file.write_text(
                json.dumps({"type": "thread.started", "thread_id": SAMPLE_UUID})
                + "\n"
                + json.dumps({"type": "session_meta", "payload": {"id": SAMPLE_UUID}})
                + "\n",
                encoding="utf-8",
            )

            self.assertEqual(
                shared_evidence.classify_jsonl_event_stream(rollout_file),
                "CODEX_ROLLOUT_JSONL",
            )
            self.assertEqual(
                shared_evidence.classify_jsonl_event_stream(exec_file),
                "CODEX_EXEC_JSONL",
            )
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError, "cannot be silently parsed"
            ):
                shared_evidence.analyze_exec_events_strict("run-1", rollout_file)

            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError, "mixed rollout and exec"
            ):
                shared_evidence.classify_jsonl_event_stream(mixed_file)

    def test_uncorrelated_incomplete_and_incompatible_contracts_rejected(
        self,
    ) -> None:
        run_id = "cell-b4-cross-001"
        outcome = self._correlated_forge_outcome(run_id)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            event_file = tmp_path / f"rollout-{SAMPLE_UUID}.jsonl"
            _write_exec_jsonl(event_file, SAMPLE_UUID)
            ledger = shared_evidence.analyze_exec_events_strict(
                "different-run-id", event_file
            )
            # Mismatched run_id
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError, "run_id does not match"
            ):
                shared_evidence.build_shared_evidence_bundle(
                    outcome,
                    manifest=self.manifest,
                    repository_root=ROOT,
                    execution_mode="CORRELATED_AGENT_EXECUTION",
                    phase8_ledger=ledger,
                )

            ledger_matching = shared_evidence.analyze_exec_events_strict(
                run_id, event_file
            )
            discovery = phase8_evidence_discovery.discover(
                tmp_path, [SAMPLE_UUID]
            )
            # Tamper discovery status to INCOMPLETE_SCAN
            incomplete_disc = copy.deepcopy(discovery)
            incomplete_disc["runs"][SAMPLE_UUID]["status"] = "INCOMPLETE_SCAN"
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError, "expected unique FOUND"
            ):
                shared_evidence.build_shared_evidence_bundle(
                    outcome,
                    manifest=self.manifest,
                    repository_root=ROOT,
                    execution_mode="CORRELATED_AGENT_EXECUTION",
                    phase8_ledger=ledger_matching,
                    phase8_discovery=incomplete_disc,
                )

            # Tamper discovery sha256
            mismatch_disc = copy.deepcopy(discovery)
            mismatch_disc["runs"][SAMPLE_UUID]["matches"][0]["sha256"] = "e" * 64
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError,
                "sha256 does not match ledger source_sha256",
            ):
                shared_evidence.build_shared_evidence_bundle(
                    outcome,
                    manifest=self.manifest,
                    repository_root=ROOT,
                    execution_mode="CORRELATED_AGENT_EXECUTION",
                    phase8_ledger=ledger_matching,
                    phase8_discovery=mismatch_disc,
                )

            # Incompatible schema_version
            bad_schema = copy.deepcopy(outcome)
            bad_schema["schema_version"] = 99
            with self.assertRaisesRegex(
                shared_evidence.SharedEvidenceError, "schema_version"
            ):
                shared_evidence.build_shared_evidence_bundle(
                    bad_schema,
                    manifest=self.manifest,
                    repository_root=ROOT,
                )

    def test_expert_initial_selection_vs_justified_expansion_and_missing_telemetry(
        self,
    ) -> None:
        run_id = self.synthetic_pass_outcome["preview_run_id"]
        scenario_id = self.synthetic_pass_outcome["scenario_id"]

        # 1. Overloaded initial selection (4 references > 3 bound)
        overloaded = {
            "schema_version": 2,
            "run_id": run_id,
            "scenario_id": scenario_id,
            "candidate_tree_sha256": shared_evidence.EXPERT_CANDIDATE_TREE_SHA256,
            "expert_activated": True,
            "expert_reference_telemetry_observed": True,
            "initial_reference_reads": [
                "references/solutions-architect.md",
                "references/software-engineer.md",
                "references/qa-engineer.md",
                "references/database-administrator.md",
            ],
        }
        b_over = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
            expert_evidence=overloaded,
        )
        self.assertEqual(
            b_over["jira_acceptance"]["AFYX-283"]["disclosure_gate_verdict"], "FAIL"
        )
        self.assertEqual(
            b_over["jira_acceptance"]["AFYX-283"]["disposition"], "FAIL"
        )
        self.assertEqual(
            b_over["jira_acceptance"]["AFYX-283"]["failure_reason"],
            "initial_reference_selection_exceeds_bound",
        )

        # 2. Unjustified expansion fails
        unjustified_exp = {
            "schema_version": 2,
            "run_id": run_id,
            "scenario_id": scenario_id,
            "candidate_tree_sha256": shared_evidence.EXPERT_CANDIDATE_TREE_SHA256,
            "expert_activated": True,
            "expert_reference_telemetry_observed": True,
            "initial_reference_reads": [
                "references/solutions-architect.md",
                "references/software-engineer.md",
            ],
            "justified_expansion_reads": ["references/cybersecurity-devsecops.md"],
            "expansion_justification": "",
        }
        b_unjust = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
            expert_evidence=unjustified_exp,
        )
        self.assertEqual(
            b_unjust["jira_acceptance"]["AFYX-283"]["disclosure_gate_verdict"],
            "FAIL",
        )
        self.assertEqual(
            b_unjust["jira_acceptance"]["AFYX-283"]["failure_reason"],
            "unjustified_reference_expansion",
        )

        # 3. Justified expansion passes disclosure gate
        justified_exp = copy.deepcopy(unjustified_exp)
        justified_exp["expansion_justification"] = (
            "Concrete cross-module auth boundary risk identified in checkout flow"
        )
        b_just = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
            expert_evidence=justified_exp,
        )
        self.assertEqual(
            b_just["jira_acceptance"]["AFYX-283"]["disclosure_gate_verdict"],
            "PASS",
        )

        # 4. Missing reference telemetry fails closed
        missing_tel = {
            "schema_version": 2,
            "run_id": run_id,
            "scenario_id": scenario_id,
            "candidate_tree_sha256": shared_evidence.EXPERT_CANDIDATE_TREE_SHA256,
            "expert_activated": True,
            "expert_reference_telemetry_observed": False,
            "initial_reference_reads": None,
        }
        b_miss = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
            expert_evidence=missing_tel,
        )
        self.assertEqual(
            b_miss["jira_acceptance"]["AFYX-283"]["disclosure_gate_verdict"],
            "FAIL",
        )
        self.assertEqual(
            b_miss["jira_acceptance"]["AFYX-283"]["failure_reason"],
            "expert_reference_telemetry_missing",
        )

    def test_deterministic_sanitized_output_and_cli_demo(self) -> None:
        b1 = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
        )
        b2 = shared_evidence.build_shared_evidence_bundle(
            self.synthetic_pass_outcome,
            manifest=self.manifest,
            repository_root=ROOT,
        )
        self.assertEqual(b1["bundle_sha256"], b2["bundle_sha256"])
        self.assertEqual(
            json.dumps(b1, sort_keys=True), json.dumps(b2, sort_keys=True)
        )

        # Private marker injection rejected
        leaked = copy.deepcopy(self.synthetic_pass_outcome)
        leaked["files_modified"] = ["private_holdout.py"]
        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError, "private evaluator marker"
        ):
            shared_evidence.build_shared_evidence_bundle(
                leaked,
                manifest=self.manifest,
                repository_root=ROOT,
            )

        # Host path injection rejected
        leaked_host = copy.deepcopy(self.synthetic_pass_outcome)
        leaked_host["files_modified"] = ["C:\\Users\\alice\\work\\file.py"]
        with self.assertRaisesRegex(
            shared_evidence.SharedEvidenceError, "absolute host path rejected"
        ):
            shared_evidence.build_shared_evidence_bundle(
                leaked_host,
                manifest=self.manifest,
                repository_root=ROOT,
            )

        # CLI requires --opt-in
        err = io.StringIO()
        with redirect_stderr(err):
            code = shared_evidence.main([])
        self.assertEqual(code, 1)

        out = io.StringIO()
        with redirect_stdout(out):
            code_ok = shared_evidence.main(
                [
                    "--opt-in",
                    "--candidate",
                    "B2",
                    "--scenario",
                    "forge-cross-module-001",
                    "--apply-synthetic-fix",
                ]
            )
        self.assertEqual(code_ok, 0)
        parsed_cli = json.loads(out.getvalue())
        self.assertEqual(
            parsed_cli["contract_id"],
            shared_evidence.SHARED_EVIDENCE_CONTRACT_ID,
        )
        self.assertEqual(
            parsed_cli["jira_acceptance"]["AFYX-94"]["disposition"], "PASS"
        )


if __name__ == "__main__":
    unittest.main()
