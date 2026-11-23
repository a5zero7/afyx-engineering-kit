#!/usr/bin/env python3
"""Afyx Forge A5: Opt-in functional development preview for engineering directives.

Enables developers to preview, test, and validate public directive candidates (B0-B5)
against public engineering fixtures in a disposable unprivileged workspace without
executing protected benchmark campaigns or modifying daily host configurations.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from time import monotonic
from typing import Any, Mapping

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from evals.forge import controller, validate as forge_validate


PREVIEW_OPT_IN_ENV = "AFYX_FORGE_PREVIEW_OPT_IN"


class PreviewOptInRequired(RuntimeError):
    """Raised when Forge development preview is invoked without explicit opt-in."""


class PreviewManifestInvalid(RuntimeError):
    """Raised when preview input differs from the frozen public Forge manifest."""


def check_opt_in(opt_in_flag: bool = False) -> bool:
    """Return True if explicit opt-in is provided via CLI argument or environment variable."""
    return bool(opt_in_flag or os.environ.get(PREVIEW_OPT_IN_ENV) == "1")


def validate_public_manifest(manifest: Mapping[str, Any]) -> None:
    """Fail closed unless input is the valid, exact frozen public manifest."""
    try:
        supplied = dict(manifest)
        canonical = forge_validate.load_json(forge_validate.MANIFEST_PATH)
        violations = forge_validate.validate_manifest(supplied)
    except Exception:
        raise PreviewManifestInvalid("frozen public Forge manifest validation failed") from None
    if violations or supplied != canonical:
        raise PreviewManifestInvalid("frozen public Forge manifest validation failed")


def extract_task_guidance(
    candidate_id: str,
    scenario: Mapping[str, Any],
    manifest: Mapping[str, Any],
    repository_root: Path,
) -> dict[str, Any]:
    """Extract directive contract and bounded execution guidance for a scenario."""
    candidate = manifest["candidates"][candidate_id]
    materialization = candidate.get("materialization", {})
    composition_order = (
        list(materialization.get("components", []))
        if materialization.get("kind") == "ordered_composition"
        else []
    )
    component_definitions = [
        {
            "candidate_id": component_id,
            "definition": manifest["candidates"][component_id]["definition"],
        }
        for component_id in composition_order
    ]
    directive_file: str | None = None
    directive_summary = "(no additional directive)"
    directive_body = ""

    if candidate.get("source"):
        candidate_path = repository_root / candidate["source"]
        if candidate_path.is_dir():
            agents_md = candidate_path / "AGENTS.md"
            skill_md = candidate_path / "SKILL.md"
            if agents_md.exists():
                directive_file = agents_md.relative_to(repository_root).as_posix()
                directive_body = agents_md.read_text(encoding="utf-8")
            elif skill_md.exists():
                directive_file = skill_md.relative_to(repository_root).as_posix()
                directive_body = skill_md.read_text(encoding="utf-8")
        elif candidate_path.is_file():
            directive_file = candidate_path.relative_to(repository_root).as_posix()
            directive_body = candidate_path.read_text(encoding="utf-8")

    if directive_body:
        lines = [line.strip() for line in directive_body.splitlines() if line.strip()]
        for line in lines:
            if line.startswith("#"):
                directive_summary = line.lstrip("# ").strip()
                break
    elif component_definitions:
        directive_summary = "Ordered composition: " + " + ".join(
            f"{component['candidate_id']} ({component['definition']})"
            for component in component_definitions
        )

    return {
        "candidate_id": candidate_id,
        "candidate_definition": candidate["definition"],
        "comparison_role": candidate.get("comparison_role", "baseline"),
        "activation": candidate.get("activation", "none"),
        "entry_point": candidate.get("entry_point", "none"),
        "composition_order": composition_order,
        "component_definitions": component_definitions,
        "directive_file": directive_file,
        "directive_summary": directive_summary,
        "scenario_id": scenario["scenario_id"],
        "category": scenario["category"],
        "user_prompt": scenario["user_prompt"],
        "allowed_file_scope": list(scenario.get("allowed_file_scope", [])),
        "expected_file_scope": list(scenario.get("expected_file_scope", [])),
        "baseline_expected_exit": scenario.get("baseline_expected_exit"),
        "target_validation_exit": scenario.get("target_validation_exit"),
        "validation_command": scenario.get("validation_command"),
    }


def execute_validation_command(
    command: list[str] | None,
    cwd: Path,
    timeout: int = 30,
    *,
    observation: dict[str, bool] | None = None,
) -> tuple[int, str, str]:
    """Run validation command safely within the disposable workspace."""
    if observation is not None:
        observation["timed_out"] = False
    if not command:
        return 0, "", ""
    executable = command[0]
    if executable == "python":
        executable = sys.executable
    cmd = [executable, *command[1:]]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        if observation is not None:
            observation["timed_out"] = True
        return 124, "", f"validation command timed out after {timeout} seconds"
    except Exception as error:
        return 127, "", f"execution error: {error}"


QUALITY_GATE_NAMES = (
    "correctness",
    "task_fidelity",
    "scope_adherence",
    "regression_safety",
    "evidence_quality",
)
PUBLIC_QUALITY_GATE_ID = "AFYX_FORGE_A6_PUBLIC_QUALITY_GATE"


def _quality_gate_not_requested() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "quality_gate_id": PUBLIC_QUALITY_GATE_ID,
        "enabled": False,
        "verdict": "NOT_TESTED",
        "gate_results": {gate: "NOT_TESTED" for gate in QUALITY_GATE_NAMES},
        "failure_codes": [],
        "not_tested_reasons": ["quality_gate_not_requested"],
        "evidence": {},
    }


def evaluate_public_quality_gate(
    scenario: Mapping[str, Any], outcome: Mapping[str, Any]
) -> dict[str, Any]:
    """Evaluate a public preview outcome against its trusted task contract."""
    gate_results = {gate: "NOT_TESTED" for gate in QUALITY_GATE_NAMES}
    failure_codes: list[str] = []
    not_tested_reasons: list[str] = []
    required_evidence = {
        "baseline_validation",
        "target_validation",
        "synthetic_fix_applied",
        "applied_files",
        "files_modified",
        "scope_adherence",
        "disposable_workspace_cleaned",
    }
    missing_evidence = sorted(required_evidence - set(outcome))
    if missing_evidence:
        gate_results["evidence_quality"] = "FAIL"
        return {
            "schema_version": 1,
            "quality_gate_id": PUBLIC_QUALITY_GATE_ID,
            "enabled": True,
            "verdict": "FAIL",
            "gate_results": gate_results,
            "failure_codes": ["quality_evidence_incomplete"],
            "not_tested_reasons": not_tested_reasons,
            "evidence": {"missing_fields": missing_evidence},
        }

    baseline = outcome["baseline_validation"]
    target = outcome["target_validation"]
    files_modified = outcome["files_modified"]
    applied_files = outcome["applied_files"]
    evidence_well_formed = (
        isinstance(baseline, Mapping)
        and isinstance(target, Mapping)
        and isinstance(files_modified, list)
        and all(isinstance(path, str) for path in files_modified)
        and len(files_modified) == len(set(files_modified))
        and isinstance(applied_files, list)
        and all(isinstance(path, str) for path in applied_files)
        and type(outcome["synthetic_fix_applied"]) is bool
        and type(outcome["scope_adherence"]) is bool
        and type(outcome["disposable_workspace_cleaned"]) is bool
    )

    def validation_evidence_consistent(record: Mapping[str, Any]) -> bool:
        required = {"exit_code", "expected_exit_code", "matches_expected"}
        if not required.issubset(record) or type(record["matches_expected"]) is not bool:
            return False
        if record["exit_code"] is not None and type(record["exit_code"]) is not int:
            return False
        if (
            record["expected_exit_code"] is not None
            and type(record["expected_exit_code"]) is not int
        ):
            return False
        expected = record["expected_exit_code"]
        computed = expected is None or record["exit_code"] == expected
        return record["matches_expected"] == computed

    if evidence_well_formed:
        evidence_well_formed = validation_evidence_consistent(
            baseline
        ) and validation_evidence_consistent(target)
    if not evidence_well_formed:
        gate_results["evidence_quality"] = "FAIL"
        return {
            "schema_version": 1,
            "quality_gate_id": PUBLIC_QUALITY_GATE_ID,
            "enabled": True,
            "verdict": "FAIL",
            "gate_results": gate_results,
            "failure_codes": ["quality_evidence_incomplete"],
            "not_tested_reasons": not_tested_reasons,
            "evidence": {"malformed": True},
        }

    actual_files = set(files_modified) if isinstance(files_modified, list) else set()
    allowed_files = set(scenario.get("allowed_file_scope", []))
    expected_files = set(scenario.get("expected_file_scope", []))
    computed_scope_adherence = not bool(actual_files - allowed_files)
    required_file_set_complete = actual_files == expected_files
    synthetic_evidence_consistent = (
        not outcome["synthetic_fix_applied"] or set(applied_files) == actual_files
    )
    cleanup_complete = outcome["disposable_workspace_cleaned"] is True

    artifact_validation = controller.ArtifactValidation(
        command_exit_code=(
            target.get("exit_code") if isinstance(target.get("exit_code"), int) else None
        ),
        content_checks={
            "baseline_contract": bool(baseline.get("matches_expected")),
            "target_expected_behavior": bool(target.get("matches_expected")),
            "required_file_set": required_file_set_complete,
            "allowed_file_scope": computed_scope_adherence,
        },
    )

    gate_results["task_fidelity"] = (
        "PASS" if required_file_set_complete else "FAIL"
    )
    if not required_file_set_complete:
        failure_codes.append("required_changes_incomplete")

    gate_results["scope_adherence"] = (
        "PASS" if computed_scope_adherence else "FAIL"
    )
    if not computed_scope_adherence:
        failure_codes.append("quality_scope_violation")

    validation_available = scenario.get("validation_command") is not None
    if validation_available:
        correctness_passed = bool(
            baseline.get("matches_expected") and target.get("matches_expected")
        )
        gate_results["correctness"] = "PASS" if correctness_passed else "FAIL"
        gate_results["regression_safety"] = (
            "PASS" if bool(target.get("matches_expected")) else "FAIL"
        )
        if not correctness_passed:
            failure_codes.append("correctness_not_demonstrated")
        if not target.get("matches_expected"):
            failure_codes.append("regression_check_failed")
    else:
        not_tested_reasons.extend(
            ["correctness_validation_unavailable", "regression_validation_unavailable"]
        )

    evidence_consistent = (
        evidence_well_formed
        and outcome["scope_adherence"] == computed_scope_adherence
        and synthetic_evidence_consistent
        and cleanup_complete
    )
    gate_results["evidence_quality"] = "PASS" if evidence_consistent else "FAIL"
    if not synthetic_evidence_consistent or (
        outcome["scope_adherence"] != computed_scope_adherence
    ):
        failure_codes.append("quality_evidence_inconsistent")
    if not cleanup_complete:
        failure_codes.append("workspace_cleanup_failed")

    gate_values = set(gate_results.values())
    if "FAIL" in gate_values:
        verdict = "FAIL"
    elif "NOT_TESTED" in gate_values:
        verdict = "NOT_TESTED"
    else:
        verdict = "PASS"

    return {
        "schema_version": 1,
        "quality_gate_id": PUBLIC_QUALITY_GATE_ID,
        "enabled": True,
        "verdict": verdict,
        "gate_results": gate_results,
        "failure_codes": list(dict.fromkeys(failure_codes)),
        "not_tested_reasons": not_tested_reasons,
        "evidence": {
            "validation_command": scenario.get("validation_command"),
            "expected_files": sorted(expected_files),
            "observed_files": sorted(actual_files),
            "artifact_validation": {
                "command_exit_code": artifact_validation.command_exit_code,
                "content_checks": dict(artifact_validation.content_checks),
                "passed": artifact_validation.passed,
            },
            "cleanup_complete": cleanup_complete,
        },
    }


PUBLIC_EFFICIENCY_REPORT_ID = "AFYX_FORGE_A7_PUBLIC_EFFICIENCY"
EFFICIENCY_DURATION_LIMIT_SECONDS = 86_400.0
PROVIDER_METRIC_UNAVAILABLE_REASON = (
    "public_synthetic_preview_has_no_trustworthy_provider_adapter_telemetry"
)


def _available_metric(value: int | float, unit: str, source: str) -> dict[str, Any]:
    return {
        "availability": "AVAILABLE",
        "value": value,
        "unit": unit,
        "source": source,
    }


def _unavailable_metric(unit: str, source: str, reason: str) -> dict[str, Any]:
    return {
        "availability": "NOT_AVAILABLE",
        "value": None,
        "unit": unit,
        "source": source,
        "reason": reason,
    }


def build_public_efficiency_report(
    quality_gate: Mapping[str, Any], observation: Mapping[str, Any]
) -> dict[str, Any]:
    """Build fail-closed public telemetry from directly observed preview activity."""
    invalid_reasons: list[str] = []
    required = {
        "total_elapsed_seconds",
        "baseline_validation_seconds",
        "target_validation_seconds",
        "validation_subprocess_invocations",
        "validation_nonzero_exit_count",
        "validation_contract_mismatch_count",
        "validation_timeout_count",
    }
    missing = sorted(required - set(observation))
    if missing:
        invalid_reasons.append("efficiency_measurement_incomplete")

    def valid_duration(value: Any, *, optional: bool = False) -> bool:
        if optional and value is None:
            return True
        return (
            type(value) in {int, float}
            and math.isfinite(value)
            and 0 <= value <= EFFICIENCY_DURATION_LIMIT_SECONDS
        )

    total = observation.get("total_elapsed_seconds")
    baseline_duration = observation.get("baseline_validation_seconds")
    target_duration = observation.get("target_validation_seconds")
    durations_valid = (
        valid_duration(total)
        and valid_duration(baseline_duration, optional=True)
        and valid_duration(target_duration, optional=True)
    )
    if not durations_valid:
        invalid_reasons.append("efficiency_duration_invalid")

    count_names = (
        "validation_subprocess_invocations",
        "validation_nonzero_exit_count",
        "validation_contract_mismatch_count",
        "validation_timeout_count",
    )
    counts = {name: observation.get(name) for name in count_names}
    counts_valid = all(type(value) is int and value >= 0 for value in counts.values())
    if not counts_valid:
        invalid_reasons.append("efficiency_counter_invalid")
    else:
        invocations = counts["validation_subprocess_invocations"]
        available_validation_durations = sum(
            duration is not None for duration in (baseline_duration, target_duration)
        )
        if (
            invocations != available_validation_durations
            or counts["validation_timeout_count"]
            > counts["validation_nonzero_exit_count"]
            or counts["validation_nonzero_exit_count"] > invocations
            or counts["validation_contract_mismatch_count"] > invocations
        ):
            invalid_reasons.append("efficiency_measurement_inconsistent")

    if durations_valid:
        measured_validation = sum(
            duration or 0 for duration in (baseline_duration, target_duration)
        )
        if total < measured_validation:
            invalid_reasons.append("efficiency_measurement_inconsistent")

    quality_verdict = quality_gate.get("verdict")
    quality_link_valid = (
        quality_gate.get("quality_gate_id") == PUBLIC_QUALITY_GATE_ID
        and quality_gate.get("enabled") is True
    )
    if (
        not quality_link_valid
        or quality_verdict not in {"PASS", "FAIL", "NOT_TESTED"}
    ):
        invalid_reasons.append("quality_gate_link_invalid")

    invalid_reasons = list(dict.fromkeys(invalid_reasons))
    comparison_reasons: list[str] = []
    if invalid_reasons:
        comparison_reasons.extend(invalid_reasons)
    if quality_verdict != "PASS":
        comparison_reasons.append(
            "quality_failed"
            if quality_verdict == "FAIL"
            else "quality_not_tested"
        )

    metrics: dict[str, Any] = {
        "total_elapsed": _available_metric(
            total, "seconds", "python_time_monotonic"
        )
        if valid_duration(total)
        else _unavailable_metric(
            "seconds", "python_time_monotonic", "invalid_observation"
        ),
    }
    for metric_name, observation_name, source in (
        (
            "validation_subprocess_invocations",
            "validation_subprocess_invocations",
            "preview_validation_dispatch",
        ),
        (
            "validation_nonzero_exits",
            "validation_nonzero_exit_count",
            "preview_subprocess_exit_status",
        ),
        (
            "validation_contract_mismatches",
            "validation_contract_mismatch_count",
            "public_task_contract",
        ),
        (
            "validation_timeouts",
            "validation_timeout_count",
            "preview_subprocess_timeout",
        ),
    ):
        observed_count = counts.get(observation_name)
        metrics[metric_name] = (
            _available_metric(observed_count, "count", source)
            if type(observed_count) is int and observed_count >= 0
            else _unavailable_metric("count", source, "invalid_observation")
        )
    for metric_name, duration in (
        ("baseline_validation_duration", baseline_duration),
        ("target_validation_duration", target_duration),
    ):
        metrics[metric_name] = (
            _available_metric(duration, "seconds", "python_time_monotonic")
            if valid_duration(duration, optional=False)
            else _unavailable_metric(
                "seconds",
                "preview_validation_subprocess",
                "validation_command_not_configured"
                if duration is None
                else "invalid_observation",
            )
        )

    metrics["retry_count"] = _unavailable_metric(
        "count",
        "preview_execution",
        "preview_has_no_instrumented_retry_loop",
    )
    for metric_name, unit in {
        "input_tokens": "tokens",
        "output_tokens": "tokens",
        "reasoning_tokens": "tokens",
        "context_usage": "tokens",
        "cache_usage": "tokens",
        "agent_tool_calls": "count",
        "repeated_reads": "count",
        "rework": "count",
        "human_intervention": "count",
        "provider_reported_cost": "currency",
    }.items():
        metrics[metric_name] = _unavailable_metric(
            unit,
            "provider_adapter",
            PROVIDER_METRIC_UNAVAILABLE_REASON,
        )

    return {
        "schema_version": 1,
        "efficiency_report_id": PUBLIC_EFFICIENCY_REPORT_ID,
        "measurement_status": "INVALID" if invalid_reasons else "AVAILABLE",
        "quality_gate_id": quality_gate.get("quality_gate_id"),
        "quality_verdict": quality_verdict,
        "comparison_eligible": (
            not invalid_reasons and quality_link_valid and quality_verdict == "PASS"
        ),
        "comparison_ineligibility_reasons": list(dict.fromkeys(comparison_reasons)),
        "superiority_claim": "NOT_ESTABLISHED",
        "metrics": metrics,
        "provenance": {
            "execution_surface": "public_development_preview",
            "clock": "python_time_monotonic",
            "validation_activity": "local_subprocess_observation",
            "provider_activity": "not_observed",
            "synthetic_activity_is_agent_activity": False,
        },
    }


def apply_scenario_synthetic_fix(scenario_id: str, work: Path) -> list[str]:
    """Apply a minimal scoped fix for public demonstration / testing."""
    if scenario_id in {"forge-direct-001", "forge-known-file-001"}:
        math_file = work / "known_math.py"
        math_file.write_text(
            'def clamp(value: int, lower: int, upper: int) -> int:\n'
            '    """Return value constrained to the inclusive lower/upper bounds."""\n'
            '    return max(lower, min(upper, value))\n',
            encoding="utf-8",
        )
        return ["known_math.py"]
    if scenario_id == "forge-cross-module-001":
        tax_file = work / "tax.py"
        tax_file.write_text(
            'from decimal import Decimal\n\n\n'
            'def tax_amount(subtotal: Decimal, rate_percent: Decimal) -> Decimal:\n'
            '    """Return tax for a percentage expressed as points, for example 20 for 20%."""\n'
            '    return (subtotal * rate_percent / Decimal("100")).quantize(Decimal("0.01"))\n',
            encoding="utf-8",
        )
        checkout_file = work / "checkout.py"
        checkout_file.write_text(
            'from decimal import Decimal\n\n'
            'from tax import tax_amount\n\n\n'
            'def checkout_total(subtotal: Decimal, rate_percent: Decimal) -> Decimal:\n'
            '    return subtotal + tax_amount(subtotal, rate_percent)\n',
            encoding="utf-8",
        )
        return ["checkout.py", "tax.py"]
    if scenario_id == "forge-security-001":
        safe_file = work / "safe_path.py"
        safe_file.write_text(
            'from pathlib import Path\n\n\n'
            'def resolve_export_path(root: Path, requested: str) -> Path:\n'
            '    """Resolve an export destination that must remain inside root."""\n'
            '    resolved_root = root.resolve()\n'
            '    candidate = (resolved_root / requested).resolve()\n'
            '    if candidate == resolved_root or resolved_root not in candidate.parents:\n'
            '        raise ValueError("path traversal detected")\n'
            '    return candidate\n',
            encoding="utf-8",
        )
        return ["safe_path.py"]
    return []


def run_preview_scenario(
    manifest: Mapping[str, Any],
    candidate_id: str,
    scenario_id: str,
    *,
    repository_root: Path = REPO_ROOT,
    apply_synthetic_fix: bool = False,
    quality_gate: bool = False,
    efficiency_report: bool = False,
    timeout: int = 30,
    temp_dir: Path | None = None,
) -> dict[str, Any]:
    """Execute a single public preview scenario end-to-end in a disposable workspace."""
    efficiency_started = monotonic() if efficiency_report else None
    validate_public_manifest(manifest)
    if candidate_id not in manifest["candidates"]:
        raise ValueError(f"unknown candidate id: {candidate_id}")

    scenarios = {item["scenario_id"]: item for item in manifest["scenarios"]}
    if scenario_id not in scenarios:
        raise ValueError(f"unknown scenario id: {scenario_id}")
    scenario = scenarios[scenario_id]

    # 1. Task understanding and execution guidance
    guidance = extract_task_guidance(candidate_id, scenario, manifest, repository_root)

    # 2. Prepare disposable workspace
    temp_root = temp_dir or Path(tempfile.gettempdir())
    workspace_manager = controller.DisposableWorkspaceManager(temp_root)
    preview_run_id = f"preview-{uuid.uuid4().hex[:12]}"
    lease = workspace_manager.create(preview_run_id)

    cleanup_succeeded = False
    baseline_validation_seconds: float | None = None
    target_validation_seconds: float | None = None
    validation_subprocess_invocations = 0
    baseline_validation_observation = {"timed_out": False}
    target_validation_observation = {"timed_out": False}
    try:
        work = lease.work
        limits = controller.InventoryLimits(
            max_files=100,
            max_file_bytes=1024 * 1024,
            max_total_bytes=10 * 1024 * 1024,
            deadline_seconds=30.0,
        )

        # 3. Materialize public fixture
        fixture_relative = controller.normalize_relative_path(scenario["fixture"])
        fixture_source = repository_root / fixture_relative
        controller._copy_tree_contents(fixture_source, work)

        # 4. Materialize public candidate directive
        controller._materialize_candidate(manifest, candidate_id, repository_root, work)

        # 5. Snapshot before any changes
        initial_snapshot = controller._snapshot(work, limits)

        # 6. Baseline validation check
        validation_cmd = scenario.get("validation_command")
        if efficiency_report and validation_cmd:
            baseline_started = monotonic()
            baseline_code, baseline_stdout, baseline_stderr = (
                execute_validation_command(
                    validation_cmd,
                    work,
                    timeout=timeout,
                    observation=baseline_validation_observation,
                )
            )
            baseline_validation_seconds = round(monotonic() - baseline_started, 6)
            validation_subprocess_invocations += 1
        else:
            baseline_code, baseline_stdout, baseline_stderr = (
                execute_validation_command(validation_cmd, work, timeout=timeout)
            )

        expected_baseline_exit = scenario.get("baseline_expected_exit")
        baseline_matches_expected = (
            expected_baseline_exit is None or baseline_code == expected_baseline_exit
        )

        # 7. Apply synthetic fix if requested
        applied_files: list[str] = []
        if apply_synthetic_fix:
            applied_files = apply_scenario_synthetic_fix(scenario_id, work)

        # 8. Snapshot after modification
        terminal_snapshot = controller._snapshot(work, limits)
        changed_files = controller._changed_files(initial_snapshot, terminal_snapshot)

        # Check scope boundary
        allowed_scope = set(scenario.get("allowed_file_scope", []))
        # Exclude directive files from scope violation
        actual_code_changes = [
            f
            for f in changed_files
            if not f.endswith("AGENTS.md")
            and not f.startswith(".agents")
            and not f.startswith("__pycache__")
            and not f.endswith(".pyc")
            and "/__pycache__/" not in f
            and "\\__pycache__\\" not in f
        ]
        scope_adherence = not bool(set(actual_code_changes) - allowed_scope)

        # 9. Target validation check
        if efficiency_report and validation_cmd:
            target_started = monotonic()
            target_code, target_stdout, target_stderr = execute_validation_command(
                validation_cmd,
                work,
                timeout=timeout,
                observation=target_validation_observation,
            )
            target_validation_seconds = round(monotonic() - target_started, 6)
            validation_subprocess_invocations += 1
        else:
            target_code, target_stdout, target_stderr = execute_validation_command(
                validation_cmd, work, timeout=timeout
            )

        expected_target_exit = scenario.get("target_validation_exit")
        target_matches_expected = (
            expected_target_exit is None or target_code == expected_target_exit
        )

        # 10. Formulate result verdict
        if apply_synthetic_fix:
            passed = baseline_matches_expected and target_matches_expected and scope_adherence
        else:
            passed = baseline_matches_expected

        result = {
            "schema_version": 1,
            "preview_task": "AFYX_FORGE_A5_DEV_PREVIEW",
            "preview_run_id": preview_run_id,
            "candidate_id": candidate_id,
            "scenario_id": scenario_id,
            "guidance": guidance,
            "baseline_validation": {
                "exit_code": baseline_code,
                "expected_exit_code": expected_baseline_exit,
                "matches_expected": baseline_matches_expected,
                "stdout": baseline_stdout.strip(),
                "stderr": baseline_stderr.strip(),
            },
            "synthetic_fix_applied": apply_synthetic_fix,
            "applied_files": applied_files,
            "files_modified": actual_code_changes,
            "scope_adherence": scope_adherence,
            "target_validation": {
                "exit_code": target_code,
                "expected_exit_code": expected_target_exit,
                "matches_expected": target_matches_expected,
                "stdout": target_stdout.strip(),
                "stderr": target_stderr.strip(),
            },
            "failure_codes": [],
            "verdict": "PASS" if passed else "FAIL",
            "disposable_workspace_cleaned": False,
        }
    finally:
        try:
            cleanup_succeeded = workspace_manager.cleanup(lease)
        except Exception:
            cleanup_succeeded = False
        if "result" in locals():
            result["disposable_workspace_cleaned"] = cleanup_succeeded
            if not cleanup_succeeded:
                result["failure_codes"].append("workspace_cleanup_failed")
                result["verdict"] = "FAIL"

    quality_enabled = quality_gate or efficiency_report
    result["quality_gate"] = (
        evaluate_public_quality_gate(scenario, result)
        if quality_enabled
        else _quality_gate_not_requested()
    )
    if quality_enabled:
        for failure_code in result["quality_gate"]["failure_codes"]:
            if failure_code not in result["failure_codes"]:
                result["failure_codes"].append(failure_code)
        if result["verdict"] == "PASS":
            result["verdict"] = result["quality_gate"]["verdict"]

    if efficiency_report:
        assert efficiency_started is not None
        total_elapsed_seconds = round(monotonic() - efficiency_started, 6)
        validation_codes = (baseline_code, target_code) if validation_cmd else ()
        validation_matches = (
            (baseline_matches_expected, target_matches_expected)
            if validation_cmd
            else ()
        )
        result["efficiency_report"] = build_public_efficiency_report(
            result["quality_gate"],
            {
                "total_elapsed_seconds": total_elapsed_seconds,
                "baseline_validation_seconds": baseline_validation_seconds,
                "target_validation_seconds": target_validation_seconds,
                "validation_subprocess_invocations": validation_subprocess_invocations,
                "validation_nonzero_exit_count": sum(
                    code != 0 for code in validation_codes
                ),
                "validation_contract_mismatch_count": sum(
                    not matches for matches in validation_matches
                ),
                "validation_timeout_count": sum(
                    observation["timed_out"]
                    for observation in (
                        baseline_validation_observation,
                        target_validation_observation,
                    )
                ),
            },
        )

    return result


def main(argv: list[str] | None = None) -> int:
    try:
        manifest = forge_validate.load_json(forge_validate.MANIFEST_PATH)
        validate_public_manifest(manifest)
    except PreviewManifestInvalid as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    parser = argparse.ArgumentParser(
        description="Afyx Forge A5: Opt-in Functional Development Preview Runner"
    )
    parser.add_argument(
        "--opt-in",
        action="store_true",
        help="Explicitly opt into the development preview (required to run).",
    )
    parser.add_argument(
        "--candidate",
        default="B2",
        choices=manifest["candidate_order"],
        help="Candidate engineering directive to evaluate (default: B2).",
    )
    parser.add_argument(
        "--scenario",
        default="forge-cross-module-001",
        help="Public scenario ID to execute (default: forge-cross-module-001).",
    )
    parser.add_argument(
        "--apply-synthetic-fix",
        action="store_true",
        help="Apply the known scoped synthetic fix to verify target validation passes.",
    )
    parser.add_argument(
        "--quality-gate",
        action="store_true",
        help="Evaluate the public outcome contract and emit PASS/FAIL/NOT_TESTED.",
    )
    parser.add_argument(
        "--efficiency-report",
        action="store_true",
        help="Report directly observed preview timing and activity telemetry.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit results as structured JSON.",
    )
    parser.add_argument(
        "--inspect-guidance-only",
        action="store_true",
        help="Extract and print directive guidance without running validation.",
    )

    args = parser.parse_args(argv)

    if not check_opt_in(args.opt_in):
        msg = (
            "NOTICE: Afyx Forge development preview is DISABLED by default.\n"
            "Pass '--opt-in' or set AFYX_FORGE_PREVIEW_OPT_IN=1 to activate."
        )
        print(msg)
        return 1

    if args.inspect_guidance_only:
        scenarios = {s["scenario_id"]: s for s in manifest["scenarios"]}
        scenario = scenarios.get(args.scenario)
        if not scenario:
            print(f"ERROR: unknown scenario {args.scenario}", file=sys.stderr)
            return 2
        guidance = extract_task_guidance(args.candidate, scenario, manifest, REPO_ROOT)
        if args.json:
            print(json.dumps(guidance, indent=2))
        else:
            print(f"=== FORGE TASK GUIDANCE: {guidance['candidate_id']} on {guidance['scenario_id']} ===")
            print(f"Directive: {guidance['candidate_definition']}")
            print(f"Summary:   {guidance['directive_summary']}")
            print(f"Prompt:    {guidance['user_prompt']}")
            print(f"Scope:     {guidance['allowed_file_scope']}")
            print(f"Command:   {guidance['validation_command']}")
        return 0

    result = run_preview_scenario(
        manifest,
        args.candidate,
        args.scenario,
        apply_synthetic_fix=args.apply_synthetic_fix,
        quality_gate=args.quality_gate,
        efficiency_report=args.efficiency_report,
    )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"=== AFYX FORGE A5 PREVIEW: {result['verdict']} ===")
        print(f"Run ID:    {result['preview_run_id']}")
        print(f"Candidate: {result['candidate_id']} ({result['guidance']['candidate_definition']})")
        print(f"Scenario:  {result['scenario_id']}")
        print(f"Baseline:  exit={result['baseline_validation']['exit_code']} (expected={result['baseline_validation']['expected_exit_code']})")
        if result['synthetic_fix_applied']:
            print(f"Target:    exit={result['target_validation']['exit_code']} (expected={result['target_validation']['expected_exit_code']})")
            print(f"Files Mod: {result['files_modified']} (in-scope: {result['scope_adherence']})")
        print(f"Quality: {result['quality_gate']['verdict']}")
        if "efficiency_report" in result:
            efficiency = result["efficiency_report"]
            print(
                "Efficiency: "
                f"{efficiency['measurement_status']} "
                f"(comparison eligible: {efficiency['comparison_eligible']})"
            )
        print(f"Workspace Cleaned: {result['disposable_workspace_cleaned']}")

    return 0 if result["verdict"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
