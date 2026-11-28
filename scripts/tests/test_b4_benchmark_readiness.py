#!/usr/bin/env python3
"""Offline deterministic readiness and execution tests for V1.3.0-B4 Campaign A."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
EVAL_ROOT = ROOT / "evals"
sys.path.insert(0, str(EVAL_ROOT / "harness"))
import freeze  # noqa: E402
import run  # noqa: E402


class BenchmarkReadinessTests(unittest.TestCase):
    def test_campaign_a_matrix_budget_and_scenarios_are_valid(self) -> None:
        manifest = json.loads((EVAL_ROOT / "manifest.json").read_text(encoding="utf-8"))
        matrix = manifest.get("campaign_a_matrix", {})
        self.assertEqual(set(matrix.keys()), {"N", "S", "G", "F"})
        self.assertEqual(manifest.get("campaign_a_budget", {}).get("max_runs"), 27)

        plan = run.build_campaign_a_plan(manifest, max_budget=27)
        self.assertEqual(plan["control_invocations"], 2)
        self.assertEqual(plan["max_budget"], 27)
        self.assertLessEqual(
            plan["control_invocations"] + plan["planned_scenario_cells"] + plan["confirmation_budget"],
            27,
        )
        self.assertEqual(plan["planned_scenario_cells"], 20)
        self.assertEqual(plan["confirmation_budget"], 5)

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

    def test_b4_environment_fingerprint_and_drift_rejection(self) -> None:
        env = json.loads((EVAL_ROOT / "environment-v1.3.0-b4.json").read_text(encoding="utf-8"))
        self.assertFalse(env.get("secrets_recorded"))
        # Must pass cleanly against current repository state without prompt-master
        run.verify_frozen_environment(env)

        drifted_skill = copy.deepcopy(env)
        drifted_skill["skills"]["efficient-coding"]["content_sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "efficient-coding: content SHA256 mismatch"):
            run.verify_frozen_environment(drifted_skill)

        drifted_fixture = copy.deepcopy(env)
        drifted_fixture["fixtures_sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "fixtures: content SHA256 mismatch"):
            run.verify_frozen_environment(drifted_fixture)

    def test_nsgf_capability_differences_and_isolation(self) -> None:
        manifest = json.loads((EVAL_ROOT / "manifest.json").read_text(encoding="utf-8"))
        with mock.patch.dict("os.environ", {"AFYX_GRAPH_OPT_IN": "1", "AFYX_TRACE_ENABLED": "1"}):
            n_cfg, n_skills, n_caps = run.resolve_campaign_a_configuration(manifest, "N")
            s_cfg, s_skills, s_caps = run.resolve_campaign_a_configuration(manifest, "S")
            g_cfg, g_skills, g_caps = run.resolve_campaign_a_configuration(manifest, "G")
            f_cfg, f_skills, f_caps = run.resolve_campaign_a_configuration(manifest, "F")

            self.assertEqual(n_skills, [])
            self.assertEqual(s_skills, g_skills)
            self.assertEqual(g_skills, f_skills)
            self.assertEqual(n_caps, {"graph": False, "ace": False, "forge": False})
            self.assertEqual(s_caps, {"graph": False, "ace": False, "forge": False})
            self.assertEqual(g_caps, {"graph": True, "ace": False, "forge": False})
            self.assertEqual(f_caps, {"graph": True, "ace": True, "forge": True})

            env_n = run.isolated_capability_env(n_caps, n_cfg)
            env_g = run.isolated_capability_env(g_caps, g_cfg)
            env_f = run.isolated_capability_env(f_caps, f_cfg)
            self.assertNotIn("AFYX_TRACE_ENABLED", env_n)
            self.assertEqual(env_n["AFYX_GRAPH_OPT_IN"], "0")
            self.assertEqual(env_g["AFYX_GRAPH_OPT_IN"], "1")
            self.assertEqual(env_g["AFYX_CONTEXT_OPT_IN"], "0")
            self.assertEqual(env_f["AFYX_CONTEXT_OPT_IN"], "1")
            self.assertEqual(env_f["AFYX_FORGE_OPT_IN"], "1")

            cmd_n = run.codex_command(Path("."), "test", capabilities=n_caps)
            cmd_g = run.codex_command(Path("."), "test", capabilities=g_caps)
            cmd_f = run.codex_command(Path("."), "test", capabilities=f_caps)
            self.assertIn("mcp_servers={}", cmd_n)
            self.assertFalse(any("mcp_servers.afyx_graph=" in item for item in cmd_n))
            self.assertTrue(any("mcp_servers.afyx_graph=" in item for item in cmd_g))
            self.assertFalse(any("mcp_servers.afyx_workflow=" in item for item in cmd_g))
            self.assertTrue(any("mcp_servers.afyx_graph=" in item for item in cmd_f))
            self.assertTrue(any("mcp_servers.afyx_workflow=" in item for item in cmd_f))

    def test_budget_enforcement_and_interrupted_resume(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ledger_path = Path(tmp) / "campaign-a-budget.json"
            ledger = run.CampaignBudgetLedger(ledger_path, max_invocations=4, campaign_fingerprint="fp-1")
            id1 = ledger.reserve("child_health")
            ledger.finalize(id1, "COMPLETED")
            id2 = ledger.reserve("discovery", "s1::N::r1")
            ledger.finalize(id2, "INTERRUPTED", "s1::N::r1")
            id3 = ledger.reserve("discovery", "s1::S::r1")
            rpath = Path(tmp) / "run-s1-S" / "result.json"
            rpath.parent.mkdir(parents=True, exist_ok=True)
            rpath.write_text(json.dumps({"run_id": "run-s1-S", "result": "PASS"}), encoding="utf-8")
            ledger.finalize(id3, "COMPLETED", "s1::S::r1", "run-s1-S", rpath)
            id4 = ledger.reserve("discovery", "s1::G::r1")
            ledger.finalize(id4, "FAILED", "s1::G::r1")

            # Omitting --resume MUST fail closed instead of silently deleting existing ledger
            with self.assertRaisesRegex(RuntimeError, "pass --resume"):
                run.CampaignBudgetLedger(ledger_path, max_invocations=4, resume=False, campaign_fingerprint="fp-1")

            # Drifted fingerprint on --resume MUST fail closed
            with self.assertRaisesRegex(RuntimeError, "fingerprint mismatch"):
                run.CampaignBudgetLedger(ledger_path, max_invocations=4, resume=True, campaign_fingerprint="fp-OTHER")

            # Interrupted/failed invocations do NOT restore budget
            self.assertEqual(ledger.reserved_count, 4)
            self.assertEqual(ledger.remaining, 0)
            with self.assertRaises(run.BudgetExhaustedError):
                ledger.reserve("discovery", "s1::F::r1")

            # Reloading on resume reconstructs completed records
            resumed = run.CampaignBudgetLedger(ledger_path, max_invocations=4, resume=True, campaign_fingerprint="fp-1")
            self.assertTrue(resumed.is_cell_completed("s1::S::r1"))
            self.assertFalse(resumed.is_cell_completed("s1::N::r1"))
            recs, corrupt = resumed.reconstruct_completed_records()
            self.assertEqual(len(recs), 1)
            self.assertEqual(corrupt, [])

            # Missing result.json on resume is caught
            rpath.unlink()
            recs2, corrupt2 = resumed.reconstruct_completed_records()
            self.assertEqual(corrupt2, ["s1::S::r1"])

            # Concurrent lock blocks second active runner
            lock_path = Path(tmp) / "campaign-a.lock"
            with run.campaign_execution_lock(lock_path):
                with self.assertRaisesRegex(RuntimeError, "already active"):
                    with run.campaign_execution_lock(lock_path):
                        pass

    def test_end_to_end_offline_campaign_a_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_results = Path(tmp) / "results"
            observed_envs: list[dict] = []

            def fake_bounded(command, cwd, timeout, env=None):
                cmd_str = " ".join(command)
                if "Isolation control only" in cmd_str:
                    # Emit positive control read + negative control denials without leaking canary
                    out = "\n".join([
                        json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "cat allowed.txt", "status": "completed", "exit_code": 0, "aggregated_output": "AFYX_CONTROL_workspace:ok"}}),
                        json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "cat canary.txt", "status": "failed", "exit_code": 1, "aggregated_output": "AFYX_CONTROL_canary:READ_DENIED"}}),
                        json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "cat manifest.json", "status": "failed", "exit_code": 1, "aggregated_output": "AFYX_CONTROL_manifest:READ_DENIED"}}),
                        json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "cat rubric.json", "status": "failed", "exit_code": 1, "aggregated_output": "AFYX_CONTROL_rubric:READ_DENIED"}}),
                        json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "cat private-holdout.json", "status": "failed", "exit_code": 1, "aggregated_output": "AFYX_CONTROL_private_holdout:READ_DENIED"}}),
                    ])
                    return {"started": True, "pid": 1, "returncode": 0, "stdout": out, "stderr": "", "timed_out": False, "cleanup_required": False, "cleanup_succeeded": True, "cleanup_method": "none", "elapsed_seconds": 0.01, "executable": "codex", "launcher_kind": "mock"}
                if env is None:
                    out = "\n".join([
                        json.dumps({"type": "thread.started"}),
                        json.dumps({"type": "turn.started"}),
                        json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "OK"}}),
                    ])
                    return {"started": True, "pid": 1, "returncode": 0, "stdout": out, "stderr": "", "timed_out": False, "cleanup_required": False, "cleanup_succeeded": True, "cleanup_method": "none", "elapsed_seconds": 0.01, "executable": "codex", "launcher_kind": "mock"}
                # Scenario cell execution
                observed_envs.append({
                    "config": env.get("AFYX_EVAL_CONFIG") if env else None,
                    "graph": env.get("AFYX_GRAPH_OPT_IN") if env else None,
                    "ace": env.get("AFYX_CONTEXT_OPT_IN") if env else None,
                    "forge": env.get("AFYX_FORGE_OPT_IN") if env else None,
                    "has_manifest_in_work": (cwd / "manifest.json").exists(),
                })
                out = "\n".join([
                    json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "contract rollback verified"}}),
                    json.dumps({"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 20, "output_tokens": 30, "total_tokens": 130}}),
                ])
                return {"started": True, "pid": 1, "returncode": 0, "stdout": out, "stderr": "", "timed_out": False, "cleanup_required": False, "cleanup_succeeded": True, "cleanup_method": "none", "elapsed_seconds": 0.02, "executable": "codex", "launcher_kind": "mock"}

            def fake_health(timeout, provenance):
                return {**provenance, "result": "PASS", "classification": "HEALTHY", "elapsed_seconds": 0.01}

            def fake_canary(timeout, provenance):
                return {**provenance, "result": "PASS", "canary_exposed": False, "external_read_succeeded": False, "elapsed_seconds": 0.01}

            with mock.patch.object(run, "RESULTS_ROOT", tmp_results), \
                 mock.patch.object(run, "verify_runtime_fingerprint", return_value={"codex_cli": "0.167.0"}), \
                 mock.patch.object(run, "run_child_health_probe", side_effect=fake_health), \
                 mock.patch.object(run, "run_isolation_canary", side_effect=fake_canary), \
                 mock.patch.object(run, "bounded_process", side_effect=fake_bounded), \
                 mock.patch.object(sys, "argv", [
                     "run.py", "--mode", "campaign-a",
                     "--scenario", "campaign-a-validation-plan-001",
                     "--config", "N", "--config", "F", "--budget", "4",
                 ]):
                rc = run.main()

            self.assertEqual(rc, 0)
            summary = json.loads((tmp_results / "latest-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["completion_state"], "COMPLETE")
            self.assertEqual(summary["pass_count"], 2)
            self.assertEqual(summary["campaign_a_plan"]["reserved_invocations"], 4)
            self.assertEqual({e["config"] for e in observed_envs}, {"N", "F"})
            for e in observed_envs:
                self.assertFalse(e["has_manifest_in_work"])

    def test_campaign_a_coding_oracles_fail_before_fix_and_diag_passes(self) -> None:
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

    def test_quota_exhaustion_stops_immediately_and_preserves_null_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_results = Path(tmp) / "results"
            launch_count = {"calls": 0}

            def fake_bounded(command, cwd, timeout, env=None):
                launch_count["calls"] += 1
                out = "\n".join([
                    json.dumps({"type": "thread.started", "thread_id": "t-quota"}),
                    json.dumps({"type": "turn.started"}),
                    json.dumps({"type": "turn.failed", "error": {"message": "You've hit your usage limit. Try again later."}}),
                ])
                return {
                    "started": True, "pid": 1, "returncode": 1,
                    "stdout": out, "stderr": "", "timed_out": False,
                    "cleanup_required": False, "cleanup_succeeded": True,
                    "cleanup_method": "none", "elapsed_seconds": 0.05,
                    "executable": "codex", "launcher_kind": "mock",
                }

            def fake_health(timeout, provenance):
                return {**provenance, "result": "PASS", "classification": "PASS", "elapsed_seconds": 0.01}

            def fake_canary(timeout, provenance):
                return {**provenance, "result": "PASS", "canary_exposed": False, "external_read_succeeded": False, "elapsed_seconds": 0.01}

            with mock.patch.object(run, "RESULTS_ROOT", tmp_results), \
                 mock.patch.object(run, "verify_runtime_fingerprint", return_value={"codex_cli": "0.167.0"}), \
                 mock.patch.object(run, "run_child_health_probe", side_effect=fake_health), \
                 mock.patch.object(run, "run_isolation_canary", side_effect=fake_canary), \
                 mock.patch.object(run, "bounded_process", side_effect=fake_bounded), \
                 mock.patch.object(sys, "argv", [
                     "run.py", "--mode", "campaign-a",
                     "--scenario", "campaign-a-validation-plan-001",
                     "--config", "N", "--config", "S", "--config", "G", "--config", "F",
                     "--budget", "6",
                 ]):
                rc = run.main()

            self.assertEqual(rc, 2)
            # Only 1 cell may be launched before immediate stop; no confirmation runs allowed.
            self.assertEqual(launch_count["calls"], 1)
            summary = json.loads((tmp_results / "latest-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["completion_state"], "INCOMPLETE")
            self.assertEqual(summary["error_classification"], "PROVIDER_QUOTA_EXHAUSTED")
            self.assertEqual(len(summary["results"]), 1)
            rec = summary["results"][0]
            self.assertEqual(rec["provider_execution_status"], "QUOTA_EXHAUSTED")
            self.assertEqual(rec["measurement_coverage"], "NOT_EXECUTED")
            self.assertIsNone(rec["input_tokens"])
            self.assertIsNone(rec["output_tokens"])
            self.assertEqual(len(summary["not_run_cells"]), 3)
            self.assertTrue(all(v == "NOT_RUN_PROVIDER_LIMIT" for v in summary["not_run_cells"].values()))

    def test_functional_correctness_separated_from_skill_read_compliance(self) -> None:
        manifest = json.loads((EVAL_ROOT / "manifest.json").read_text(encoding="utf-8"))
        scenario = next(s for s in manifest["scenarios"] if s["scenario_id"] == "campaign-a-validation-plan-001")
        scenario = copy.deepcopy(scenario)
        scenario["required_skill_reads"] = ["afyx-engineering-expert"]

        with tempfile.TemporaryDirectory() as tmp:
            tmp_results = Path(tmp) / "results"
            def fake_bounded(command, cwd, timeout, env=None):
                out = "\n".join([
                    json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "contract and rollback plan"}}),
                    json.dumps({"type": "turn.completed", "usage": {"input_tokens": 50, "cached_input_tokens": 10, "output_tokens": 20}}),
                ])
                return {
                    "started": True, "pid": 1, "returncode": 0,
                    "stdout": out, "stderr": "", "timed_out": False,
                    "cleanup_required": False, "cleanup_succeeded": True,
                    "cleanup_method": "none", "elapsed_seconds": 0.01,
                    "executable": "codex", "launcher_kind": "mock",
                }

            with mock.patch.object(run, "RESULTS_ROOT", tmp_results), \
                 mock.patch.object(run, "bounded_process", side_effect=fake_bounded):
                rec = run.run_cell(manifest, scenario, "S", 1, 30, mode="campaign-a")

            self.assertEqual(rec["functional_correctness"], "PASS")
            self.assertEqual(rec["skill_read_compliance"], "FAIL")
            self.assertEqual(rec["overall_acceptance"], "FAIL")
            self.assertEqual(rec["result"], "FAIL")
            self.assertEqual(rec["measurement_coverage"], "COMPLETE")

    def test_confirmation_quota_exhaustion_marks_summary_incomplete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_results = Path(tmp) / "results"
            calls = {"n": 0}

            def fake_bounded(command, cwd, timeout, env=None):
                calls["n"] += 1
                cmd_str = " ".join(command)
                if calls["n"] <= 2:
                    # First 2 discovery cells: one PASS (N) and one FAIL (F) -> ambiguous triggers confirmation
                    ok = calls["n"] == 1
                    out = "\n".join([
                        json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "contract rollback" if ok else "incomplete"}}),
                        json.dumps({"type": "turn.completed", "usage": {"input_tokens": 20, "cached_input_tokens": 0, "output_tokens": 10}}),
                    ])
                    return {"started": True, "pid": 1, "returncode": 0, "stdout": out, "stderr": "", "timed_out": False, "cleanup_required": False, "cleanup_succeeded": True, "cleanup_method": "none", "elapsed_seconds": 0.01, "executable": "codex", "launcher_kind": "mock"}
                out = "\n".join([
                    json.dumps({"type": "thread.started", "thread_id": "t-conf-q"}),
                    json.dumps({"type": "turn.failed", "error": {"message": "You've hit your usage limit."}}),
                ])
                return {"started": True, "pid": 1, "returncode": 1, "stdout": out, "stderr": "", "timed_out": False, "cleanup_required": False, "cleanup_succeeded": True, "cleanup_method": "none", "elapsed_seconds": 0.02, "executable": "codex", "launcher_kind": "mock"}

            def fake_health(timeout, provenance):
                return {**provenance, "result": "PASS", "classification": "PASS", "elapsed_seconds": 0.01}

            def fake_canary(timeout, provenance):
                return {**provenance, "result": "PASS", "canary_exposed": False, "external_read_succeeded": False, "elapsed_seconds": 0.01}

            with mock.patch.object(run, "RESULTS_ROOT", tmp_results), \
                 mock.patch.object(run, "verify_runtime_fingerprint", return_value={"codex_cli": "0.167.0"}), \
                 mock.patch.object(run, "run_child_health_probe", side_effect=fake_health), \
                 mock.patch.object(run, "run_isolation_canary", side_effect=fake_canary), \
                 mock.patch.object(run, "bounded_process", side_effect=fake_bounded), \
                 mock.patch.object(sys, "argv", [
                     "run.py", "--mode", "campaign-a",
                     "--scenario", "campaign-a-validation-plan-001",
                     "--config", "N", "--config", "F", "--budget", "6",
                 ]):
                rc = run.main()

            self.assertEqual(rc, 2)
            self.assertEqual(calls["n"], 3)
            summary = json.loads((tmp_results / "latest-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["completion_state"], "INCOMPLETE")
            self.assertEqual(summary["error_classification"], "PROVIDER_QUOTA_EXHAUSTED")
            self.assertEqual(summary["results"][-1]["provider_execution_status"], "QUOTA_EXHAUSTED")

    def test_b7_resume_rejects_mismatched_env_substituted_result_and_hollow_forge_rubric(self) -> None:
        manifest = json.loads((EVAL_ROOT / "manifest.json").read_text(encoding="utf-8"))
        # 1. Selective B7 matrices isolate ACE (A) and Forge (R)
        _, _, ace_caps = run.resolve_campaign_a_configuration(manifest, "A")
        _, _, forge_caps = run.resolve_campaign_a_configuration(manifest, "R")
        self.assertEqual(ace_caps, {"graph": False, "ace": True, "forge": False})
        self.assertEqual(forge_caps, {"graph": False, "ace": False, "forge": True})

        # 2. Hollow keyword-stuffed Forge response fails substantive_planning_rubric
        forge_scen = next(s for s in manifest["scenarios"] if s["scenario_id"] == "b7-forge-validation-plan-001")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            hollow = "contract regression rollback"
            hollow_checks = run.check_assertions(forge_scen, work, hollow, None, [])
            self.assertFalse(all(c["passed"] for c in hollow_checks))
            substantive = (
                "Affected modules: core/tax.py, services/invoice.py, and adapters/rest_api.py.\n"
                "Contract checks: verify public API signatures and schema invariants before merge.\n"
                "Regression gates: run unittest suite and negative boundary checks on each module.\n"
                "Risk mitigation: isolate feature flags and validate rollback trigger thresholds.\n"
                "Rollback trigger: revert immediately if error rate or contract failure exceeds 0%."
            )
            good_checks = run.check_assertions(forge_scen, work, substantive, None, [])
            self.assertTrue(all(c["passed"] for c in good_checks))

        # 3. Reconstruct rejects substituted result.json and incompatible control env SHA
        with tempfile.TemporaryDirectory() as tmp:
            tpath = Path(tmp)
            ledger_path = tpath / "b7-budget.json"
            ledger = run.CampaignBudgetLedger(ledger_path, max_invocations=15, campaign_fingerprint="fp-b7")
            inv = ledger.reserve("discovery", "b7-localized-edit-001::N::r1")
            rfile = tpath / "res.json"
            rfile.write_text(json.dumps({
                "run_id": "r-1",
                "evaluation_run_id": "ev-1",
                "scenario_id": "b7-localized-edit-001",
                "configuration": "S",  # mismatched config vs cell_key N!
                "environment_fingerprint": {"sha256": "wrong-sha"},
            }), encoding="utf-8")
            ledger.finalize(inv, "COMPLETED", "b7-localized-edit-001::N::r1", "r-1", rfile)
            recs, corrupt = ledger.reconstruct_completed_records(expected_env_sha="expected-sha")
            self.assertEqual(recs, [])
            self.assertEqual(corrupt, ["b7-localized-edit-001::N::r1"])

            ctrl_file = tpath / "ctrl.json"
            ctrl_file.write_text(json.dumps({
                "result": "PASS",
                "environment_fingerprint": {"sha256": "old-env"},
                "source_revision": "old-rev",
            }), encoding="utf-8")
            ledger.record_control("child_health", "PASS", ctrl_file)
            self.assertIsNone(ledger.get_valid_control("child_health", expected_env_sha="new-env", expected_source_rev="old-rev"))
            self.assertIsNone(ledger.get_valid_control("child_health", expected_env_sha="old-env", expected_source_rev="new-rev"))
            self.assertIsNotNone(ledger.get_valid_control("child_health", expected_env_sha="old-env", expected_source_rev="old-rev"))

        # 4. b7_fixtures_sha256 drift is rejected by verify_frozen_environment
        b7_env = json.loads((EVAL_ROOT / "environment-v1.3.0-b7.json").read_text(encoding="utf-8"))
        drifted_b7 = copy.deepcopy(b7_env)
        drifted_b7["b7_fixtures_sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "b7_fixtures: content SHA256 mismatch"):
            run.verify_frozen_environment(drifted_b7)

    def test_validate_accepts_b7_manifest_and_rejects_fixture_escapes_and_unknown_configs(self) -> None:
        import validate as eval_validate
        self.assertEqual(eval_validate.main(), 0)
        manifest = json.loads((EVAL_ROOT / "manifest.json").read_text(encoding="utf-8"))
        bad_manifest = copy.deepcopy(manifest)
        # Path traversal & unauthorized fixture root for non-b7 stage
        bad_manifest["scenarios"][0]["fixture"] = "../harness"
        bad_manifest["scenarios"][1]["fixture"] = "fixtures-b7/b7-graph-multi-module"
        bad_manifest["scenarios"][0]["configurations"] = ["UNKNOWN_CFG"]
        with tempfile.TemporaryDirectory() as tmp:
            mpath = Path(tmp) / "manifest.json"
            mpath.write_text(json.dumps(bad_manifest), encoding="utf-8")
            violations: list[str] = []
            with mock.patch.object(eval_validate, "MANIFEST_PATH", mpath):
                eval_validate.validate_manifest(violations)
            self.assertGreaterEqual(len(violations), 3)
            self.assertTrue(any("authorized fixture root" in v for v in violations))
            self.assertTrue(any("UNKNOWN_CFG" in v for v in violations))


if __name__ == "__main__":
    unittest.main()
