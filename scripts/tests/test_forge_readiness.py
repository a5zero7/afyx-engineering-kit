#!/usr/bin/env python3
"""Deterministic T09.P0 Forge readiness regressions; no model or network."""

from __future__ import annotations

import copy
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = ROOT / "evals" / "forge" / "validate.py"
SPEC = importlib.util.spec_from_file_location("forge_readiness", VALIDATOR_PATH)
forge = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(forge)


class ForgeReadinessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = forge.load_json(forge.MANIFEST_PATH)

    def test_frozen_manifest_is_consistent(self) -> None:
        self.assertEqual(forge.validate_manifest(copy.deepcopy(self.manifest)), [])

    def test_discovery_matrix_is_unique_and_deterministic(self) -> None:
        first = forge.discovery_cells(self.manifest)
        second = forge.discovery_cells(self.manifest)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 36)
        self.assertEqual(len(set(first)), 36)
        self.assertEqual(
            forge.discovery_order_sha256(self.manifest),
            self.manifest["discovery"]["cell_order_sha256"],
        )

    def test_content_identity_is_stable_across_text_line_endings(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-forge-hash-") as temporary:
            root = Path(temporary)
            lf = root / "lf"
            crlf = root / "crlf"
            lf.mkdir()
            crlf.mkdir()
            (lf / "entry.txt").write_bytes(b"first\nsecond\n")
            (crlf / "entry.txt").write_bytes(b"first\r\nsecond\r\n")
            self.assertEqual(
                forge.file_sha256(lf / "entry.txt"),
                forge.file_sha256(crlf / "entry.txt"),
            )
            self.assertEqual(forge.directory_sha256(lf), forge.directory_sha256(crlf))

    def test_pristine_public_fixtures_have_expected_failing_baselines(self) -> None:
        self.assertEqual(forge.validate_pristine_fixtures(self.manifest), [])

    def test_all_candidates_materialize_with_exact_identities(self) -> None:
        self.assertEqual(forge.validate_candidate_materialization(self.manifest), [])

    def test_b1_snapshot_is_frozen_independently_of_active_product_source(self) -> None:
        candidate = self.manifest["candidates"]["B1"]
        frozen = ROOT / candidate["source"]
        active = ROOT / "skills" / "efficient-coding"

        self.assertEqual(
            candidate["source"],
            "evals/forge/candidates/B1/efficient-coding",
        )
        self.assertNotEqual(frozen.resolve(), active.resolve())
        self.assertEqual(
            forge.directory_sha256(frozen),
            candidate["content_identity"],
        )

        with tempfile.TemporaryDirectory(prefix="afyx-forge-b1-tamper-") as temporary:
            repository = Path(temporary) / "repository"
            tampered = repository / candidate["source"]
            shutil.copytree(frozen, tampered)
            skill = tampered / "SKILL.md"
            skill.write_text(
                skill.read_text(encoding="utf-8") + "\n# tampered\n",
                encoding="utf-8",
            )
            self.assertNotEqual(
                forge.directory_sha256(tampered),
                candidate["content_identity"],
            )
            with mock.patch.object(forge, "REPO_ROOT", repository):
                violations = forge.validate_manifest(copy.deepcopy(self.manifest))
            self.assertIn("candidate B1 content identity mismatch", violations)

    def test_campaign_authorization_gate_fails_closed(self) -> None:
        self.assertEqual(
            forge.campaign_blockers(self.manifest),
            forge.EXPECTED_CAMPAIGN_BLOCKERS,
        )
        tampered = copy.deepcopy(self.manifest)
        tampered["campaign_gate"]["execution_authorization"] = "APPROVED"
        tampered["campaign_gate"]["benchmark_execution"] = True
        violations = forge.validate_manifest(tampered)
        self.assertIn("campaign execution cannot be self-authorized", violations)
        self.assertIn("T09.P2A must not execute the benchmark", violations)

    def test_candidate_identity_tamper_is_rejected(self) -> None:
        tampered = copy.deepcopy(self.manifest)
        tampered["candidates"]["B5"]["content_identity"] = "0" * 64
        self.assertIn(
            "candidate B5 content identity mismatch",
            forge.validate_manifest(tampered),
        )

    def test_route_b_history_composition_and_fixture_traversal_are_enforced(self) -> None:
        tampered = copy.deepcopy(self.manifest)
        tampered["a0_amendment"]["historical_b2"]["replacement_claim"] = True
        tampered["candidates"]["B2"]["historical_original_b2_status"] = "REPLACED"
        tampered["candidates"]["B3"]["composition_order"] = ["B2", "B1"]
        tampered["candidates"]["B1"]["materialization"]["destination"] = "../outside"
        tampered["scenarios"][0]["allowed_file_scope"] = ["../outside.py"]
        violations = forge.validate_manifest(tampered)
        self.assertIn("controlled A0 Route B amendment contract mismatch", violations)
        self.assertIn("Route B B2 identity/history contract mismatch", violations)
        self.assertIn("B3 composition order must be B1 then B2", violations)
        self.assertIn("candidate B1 materialization contract mismatch", violations)
        self.assertTrue(any("escapes fixture" in item for item in violations))
        self.assertIn(
            "candidate B1 materialization escapes workspace",
            forge.validate_candidate_materialization(tampered),
        )

    def test_b3_ordered_identity_and_candidate_differentiation_are_enforced(self) -> None:
        candidates = self.manifest["candidates"]
        expected = forge.ordered_composition_sha256(
            [(candidate_id, candidates[candidate_id]["content_identity"]) for candidate_id in ("B1", "B2")]
        )
        self.assertEqual(candidates["B3"]["content_identity"], expected)
        identities = [candidates[candidate_id]["content_identity"] for candidate_id in forge.EXPECTED_CANDIDATES]
        self.assertEqual(len(identities), len(set(identities)))

        tampered = copy.deepcopy(self.manifest)
        tampered["candidates"]["B3"]["content_identity"] = forge.ordered_composition_sha256(
            [(candidate_id, candidates[candidate_id]["content_identity"]) for candidate_id in ("B2", "B1")]
        )
        self.assertIn(
            "B3 ordered composition identity mismatch",
            forge.validate_manifest(tampered),
        )

    def test_route_b_sources_have_bounded_dependencies_and_no_private_markers(self) -> None:
        self.assertEqual(
            self.manifest["candidates"]["B2"]["dependencies"],
            ["public A0-A3 behavior contract"],
        )
        self.assertEqual(
            self.manifest["candidates"]["B4"]["dependencies"],
            ["B1", "B2", "A3 behavior contract"],
        )
        for candidate_id in ("B2", "B4"):
            source = ROOT / self.manifest["candidates"][candidate_id]["source"]
            content = "\n".join(
                path.read_text(encoding="utf-8").lower()
                for path in source.rglob("*")
                if path.is_file()
            )
            for marker in forge.PRIVATE_MARKERS:
                self.assertNotIn(marker, content)

    def test_candidate_roles_and_activation_contracts_are_distinct_and_enforced(self) -> None:
        candidates = self.manifest["candidates"]
        roles = {
            candidate_id: candidates[candidate_id]["comparison_role"]
            for candidate_id in forge.EXPECTED_CANDIDATES
        }
        self.assertEqual(roles, forge.EXPECTED_COMPARISON_ROLES)
        self.assertEqual(len(roles), len(set(roles.values())))

        tampered = copy.deepcopy(self.manifest)
        tampered["candidates"]["B2"]["activation"] = "manual untracked injection"
        self.assertIn(
            "candidate activation contract mismatch",
            forge.validate_manifest(tampered),
        )

    def test_public_handoff_is_fingerprinted_sanitized_and_blocked(self) -> None:
        handoff = self.manifest["public_handoff"]
        path = ROOT / handoff["path"]
        self.assertEqual(forge.file_sha256(path), handoff["sha256"])
        self.assertEqual(handoff["benchmark_cells_executed"], 0)
        text = path.read_text(encoding="utf-8").lower()
        for forbidden in forge.PUBLIC_HANDOFF_FORBIDDEN:
            self.assertNotIn(forbidden.lower(), text)

        input_contract = json.loads(
            text.split("## public cell input contract", 1)[1]
            .split("```json", 1)[1]
            .split("```", 1)[0]
        )
        self.assertIn("user_prompt", input_contract["scenario"])
        self.assertIsNone(input_contract["scenario"]["validation_command"])

        result_contract = json.loads(
            text.split("## sanitized public result contract", 1)[1]
            .split("```json", 1)[1]
            .split("```", 1)[0]
        )
        self.assertTrue(
            set(self.manifest["result_schema"]["required_fields"])
            .issubset(result_contract)
        )
        self.assertNotIn("candidate_sha256", result_contract)

        tampered = copy.deepcopy(self.manifest)
        tampered["public_handoff"]["sha256"] = "0" * 64
        tampered["public_handoff"]["status"] = "AUTHORIZED"
        tampered["public_handoff"]["benchmark_cells_executed"] = 1
        violations = forge.validate_manifest(tampered)
        self.assertIn("public handoff SHA-256 mismatch", violations)
        self.assertIn("public handoff must remain campaign-blocked", violations)
        self.assertIn("public handoff cannot record benchmark execution", violations)


if __name__ == "__main__":
    unittest.main(verbosity=2)
