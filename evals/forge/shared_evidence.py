#!/usr/bin/env python3
"""AFYX Shared Evidence Interoperability & Independent Jira Acceptance Mapper.

Associates Forge A5/A6/A7 preview or cell outcomes, Phase 8 offline telemetry
ledger/discovery records, and Engineering Expert disclosure records through a
verified execution identity without duplicating raw evidence payloads or
conflating synthetic previews with real agent runs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from evals.forge import preview, validate as forge_validate
from scripts import phase8_event_ledger, phase8_evidence_discovery


SHARED_EVIDENCE_CONTRACT_ID = "AFYX_SHARED_EVIDENCE_BUNDLE_V1"
SHARED_EVIDENCE_SCHEMA_VERSION = 1
EXPERT_CANDIDATE_TREE_SHA256 = (
    "40cfa1f8b4fe3743a7eca81f8e4eb76c879d7adcd650c33b5611b0a2775ea138"
)
EXPERT_CANDIDATE_VERSION = "0.1.1"
EXPERT_MAX_INITIAL_REFERENCES = 3
EXECUTION_MODES = frozenset(
    {"PUBLIC_SYNTHETIC_PREVIEW", "CORRELATED_AGENT_EXECUTION"}
)
ROLLOUT_EVENT_TYPES = frozenset(
    {"session_meta", "turn_context", "token_usage_record", "event_msg"}
)
EXEC_EVENT_TYPES = frozenset(
    {
        "thread.started",
        "turn.started",
        "turn.completed",
        "turn.failed",
        "item.started",
        "item.updated",
        "item.completed",
        "item.failed",
        "error",
    }
)
PROVIDER_METRIC_KEYS = (
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "context_usage",
    "cache_usage",
    "agent_tool_calls",
    "repeated_reads",
    "rework",
    "human_intervention",
    "provider_reported_cost",
)
HOST_PATH_PATTERNS = (
    re.compile(r"^[A-Za-z]:[\\/]", re.I),
    re.compile(r"^\\\\[^\\]+\\", re.I),
    re.compile(r"^/(?:home|Users|root)/", re.I),
)


class SharedEvidenceError(ValueError):
    """Raised when shared evidence fails correlation, identity, or schema checks."""


def _canonical_json_bytes(payload: Any) -> bytes:
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def canonical_sha256(payload: Any) -> str:
    return hashlib.sha256(_canonical_json_bytes(payload)).hexdigest()


def _is_sha256_hex(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(ch in "0123456789abcdef" for ch in value.lower())
    )


def classify_jsonl_event_stream(path: Path) -> str:
    """Classify a JSONL file as CODEX_EXEC_JSONL or CODEX_ROLLOUT_JSONL.

    Rejects mixed, empty, oversized, or unrecognized event streams so raw
    rollout-*.jsonl files are never silently parsed as codex exec --json.
    """
    if not path.is_file():
        raise SharedEvidenceError(f"event stream file not found: {path.name}")
    seen_rollout = False
    seen_exec = False
    first_type: str | None = None
    with path.open("rb") as handle:
        for line_no, raw_line in enumerate(handle, 1):
            if len(raw_line) > 4 * 1024 * 1024:
                raise SharedEvidenceError(
                    f"{path.name}: oversized JSONL line {line_no}"
                )
            if not raw_line.strip():
                continue
            try:
                record = json.loads(raw_line)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise SharedEvidenceError(
                    f"{path.name}: invalid JSONL at line {line_no}"
                ) from exc
            if not isinstance(record, dict):
                raise SharedEvidenceError(
                    f"{path.name}: JSON object required at line {line_no}"
                )
            event_type = record.get("type")
            if not isinstance(event_type, str) or not event_type:
                raise SharedEvidenceError(
                    f"{path.name}: missing event type at line {line_no}"
                )
            if first_type is None:
                first_type = event_type
            if event_type in ROLLOUT_EVENT_TYPES:
                seen_rollout = True
            elif event_type in EXEC_EVENT_TYPES:
                seen_exec = True
            else:
                raise SharedEvidenceError(
                    f"{path.name}: unsupported event type '{event_type}' at line {line_no}"
                )

    if seen_rollout and seen_exec:
        raise SharedEvidenceError(
            f"{path.name}: mixed rollout and exec JSONL formats cannot be conflated"
        )
    if seen_rollout:
        return "CODEX_ROLLOUT_JSONL"
    if seen_exec:
        if first_type != "thread.started":
            raise SharedEvidenceError(
                f"{path.name}: CODEX_EXEC_JSONL must begin with thread.started"
            )
        return "CODEX_EXEC_JSONL"
    raise SharedEvidenceError(f"{path.name}: empty JSONL event stream")


def analyze_exec_events_strict(
    run_id: str,
    event_file: Path,
    annotations: Path | None = None,
    expected_thread_id: str | None = None,
) -> dict[str, Any]:
    """Validate format classification before running Phase 8 ledger analysis."""
    stream_kind = classify_jsonl_event_stream(event_file)
    if stream_kind != "CODEX_EXEC_JSONL":
        raise SharedEvidenceError(
            f"raw {stream_kind} cannot be silently parsed as codex exec --json"
        )
    try:
        return phase8_event_ledger.analyze(
            run_id,
            event_file,
            annotations=annotations,
            expected_thread_id=expected_thread_id,
        )
    except phase8_event_ledger.EvidenceError as exc:
        raise SharedEvidenceError(f"Phase 8 ledger validation failed: {exc}") from exc


def _validate_structural_sanitization(payload: Any) -> None:
    """Validate that the projected bundle contains no private evaluator data or host paths."""
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    lower = serialized.lower()
    for marker in forge_validate.PRIVATE_MARKERS:
        if marker.lower() in lower:
            raise SharedEvidenceError(
                f"private evaluator marker rejected: {marker}"
            )
    for forbidden in forge_validate.PUBLIC_HANDOFF_FORBIDDEN:
        if forbidden.lower() in lower:
            raise SharedEvidenceError(
                f"forbidden private path/identifier rejected: {forbidden}"
            )

    # Check for leaked absolute host paths or private directories
    def check_paths(obj: Any) -> None:
        if isinstance(obj, str):
            for pat in HOST_PATH_PATTERNS:
                if pat.search(obj):
                    raise SharedEvidenceError(
                        f"absolute host path rejected in evidence bundle: {obj}"
                    )
        elif isinstance(obj, dict):
            for k, v in obj.items():
                if any(
                    secret in k.lower()
                    for secret in ("password", "secret", "token_secret", "api_key", "bearer")
                ):
                    raise SharedEvidenceError(
                        f"credential field rejected in evidence bundle: {k}"
                    )
                check_paths(v)
        elif isinstance(obj, list):
            for item in obj:
                check_paths(item)

    check_paths(payload)


def _validate_and_resolve_identities(
    forge_outcome: Mapping[str, Any],
    manifest: Mapping[str, Any],
    repository_root: Path,
    candidate_sha256: str | None,
    fixture_sha256: str | None,
) -> tuple[str, str, dict[str, Any], str, str, str]:
    try:
        preview.validate_public_manifest(manifest)
    except preview.PreviewManifestInvalid as exc:
        raise SharedEvidenceError(str(exc)) from exc

    if not isinstance(forge_outcome, Mapping):
        raise SharedEvidenceError("forge_outcome must be a mapping")
    if forge_outcome.get("schema_version") != 1:
        raise SharedEvidenceError("incompatible forge_outcome schema_version")

    candidate_id = forge_outcome.get("candidate_id")
    if not isinstance(candidate_id, str) or candidate_id not in manifest["candidates"]:
        raise SharedEvidenceError(f"unknown or invalid candidate_id: {candidate_id}")

    scenarios = {item["scenario_id"]: item for item in manifest["scenarios"]}
    scenario_id = forge_outcome.get("scenario_id")
    if not isinstance(scenario_id, str) or scenario_id not in scenarios:
        raise SharedEvidenceError(f"unknown or invalid scenario_id: {scenario_id}")
    scenario = scenarios[scenario_id]

    expected_candidate_sha = manifest["candidates"][candidate_id]["content_identity"]
    supplied_candidate_sha = candidate_sha256 or forge_outcome.get("candidate_sha256")
    if supplied_candidate_sha is not None and supplied_candidate_sha != expected_candidate_sha:
        raise SharedEvidenceError("candidate_sha256 does not match frozen manifest")

    expected_fixture_sha = manifest["public_fixture"]["tree_sha256"]
    supplied_fixture_sha = fixture_sha256 or forge_outcome.get("fixture_sha256")
    if supplied_fixture_sha is not None and supplied_fixture_sha != expected_fixture_sha:
        raise SharedEvidenceError("fixture_sha256 does not match frozen manifest")

    fixture_path = repository_root / scenario["fixture"]
    if not fixture_path.is_dir():
        raise SharedEvidenceError("canonical public fixture directory is missing")
    actual_fixture_sha = forge_validate.directory_sha256(fixture_path)
    if actual_fixture_sha != expected_fixture_sha:
        raise SharedEvidenceError("on-disk fixture tree digest differs from manifest")

    manifest_sha = forge_validate.file_sha256(forge_validate.MANIFEST_PATH)
    return (
        candidate_id,
        scenario_id,
        scenario,
        expected_candidate_sha,
        expected_fixture_sha,
        manifest_sha,
    )


def _validate_execution_provenance(
    execution_mode: str, forge_outcome: Mapping[str, Any]
) -> dict[str, Any]:
    """Classify only provenance that this public contract can independently verify."""
    if execution_mode == "PUBLIC_SYNTHETIC_PREVIEW":
        return {
            "status": "VERIFIED_SYNTHETIC",
            "real_agent_verified": False,
            "verification_contract": "PUBLIC_PREVIEW_SCHEMA_V1",
            "reason": "public_preview_is_not_real_agent_execution",
        }

    preview_markers = sorted(
        key
        for key in ("preview_run_id", "preview_task", "guidance")
        if key in forge_outcome
    )
    if preview_markers:
        raise SharedEvidenceError(
            "synthetic preview outcome cannot be relabeled as correlated execution; "
            f"preview markers present: {', '.join(preview_markers)}"
        )
    return {
        "status": "UNVERIFIED_CORRELATED_RECORD",
        "real_agent_verified": False,
        "verification_contract": None,
        "reason": "independent_execution_attestation_contract_unavailable",
    }


def _validate_quality_and_efficiency(
    scenario: Mapping[str, Any],
    forge_outcome: Mapping[str, Any],
    execution_mode: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    computed_qg = preview.evaluate_public_quality_gate(scenario, forge_outcome)
    supplied_qg = forge_outcome.get("quality_gate")
    if supplied_qg is not None:
        if not isinstance(supplied_qg, Mapping) or supplied_qg.get("schema_version") != 1:
            raise SharedEvidenceError("incompatible quality_gate schema_version")
        if supplied_qg.get("quality_gate_id") != preview.PUBLIC_QUALITY_GATE_ID:
            raise SharedEvidenceError("unexpected quality_gate_id")
        if supplied_qg.get("enabled") is True:
            if (
                supplied_qg.get("verdict") != computed_qg["verdict"]
                or supplied_qg.get("gate_results") != computed_qg["gate_results"]
            ):
                raise SharedEvidenceError(
                    "supplied quality_gate verdict/results inconsistent with outcome evidence"
                )
            quality_gate = dict(supplied_qg)
        else:
            quality_gate = computed_qg
    else:
        quality_gate = computed_qg

    supplied_eff = forge_outcome.get("efficiency_report")
    if supplied_eff is not None:
        if (
            not isinstance(supplied_eff, Mapping)
            or supplied_eff.get("schema_version") != 1
            or supplied_eff.get("efficiency_report_id")
            != preview.PUBLIC_EFFICIENCY_REPORT_ID
        ):
            raise SharedEvidenceError("incompatible efficiency_report contract")
        if supplied_eff.get("quality_gate_id") != preview.PUBLIC_QUALITY_GATE_ID:
            raise SharedEvidenceError("efficiency_report quality_gate_id mismatch")
        if supplied_eff.get("quality_verdict") != quality_gate["verdict"]:
            raise SharedEvidenceError(
                "efficiency_report quality_verdict does not match quality_gate verdict"
            )
        if supplied_eff.get("superiority_claim") != "NOT_ESTABLISHED":
            raise SharedEvidenceError(
                "efficiency_report cannot assert superiority_claim from single/preview evidence"
            )
        if (
            quality_gate["verdict"] != "PASS"
            and supplied_eff.get("comparison_eligible") is True
        ):
            raise SharedEvidenceError(
                "efficiency_report cannot be comparison_eligible when quality_gate is not PASS"
            )
        provenance = supplied_eff.get("provenance", {})
        if provenance.get("synthetic_activity_is_agent_activity") is not False:
            raise SharedEvidenceError(
                "synthetic_activity_is_agent_activity must be False"
            )
        metrics = supplied_eff.get("metrics", {})
        if execution_mode == "PUBLIC_SYNTHETIC_PREVIEW":
            for key in PROVIDER_METRIC_KEYS:
                entry = metrics.get(key, {})
                if (
                    entry.get("availability") != "NOT_AVAILABLE"
                    or entry.get("value") is not None
                ):
                    raise SharedEvidenceError(
                        f"synthetic preview cannot report provider metric '{key}'"
                    )
        efficiency_report = dict(supplied_eff)
    else:
        efficiency_report = {
            "schema_version": 1,
            "efficiency_report_id": preview.PUBLIC_EFFICIENCY_REPORT_ID,
            "measurement_status": "NOT_AVAILABLE",
            "quality_gate_id": quality_gate["quality_gate_id"],
            "quality_verdict": quality_gate["verdict"],
            "comparison_eligible": False,
            "comparison_ineligibility_reasons": ["efficiency_report_not_recorded"],
            "superiority_claim": "NOT_ESTABLISHED",
            "metrics": {},
            "provenance": {
                "execution_surface": (
                    "public_development_preview"
                    if execution_mode == "PUBLIC_SYNTHETIC_PREVIEW"
                    else "correlated_agent_execution"
                ),
                "synthetic_activity_is_agent_activity": False,
            },
        }
    return quality_gate, efficiency_report


def _validate_phase8_records(
    execution_id: str,
    execution_mode: str,
    phase8_ledger: Mapping[str, Any] | None,
    phase8_discovery: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    if execution_mode == "PUBLIC_SYNTHETIC_PREVIEW":
        if phase8_ledger is not None or phase8_discovery is not None:
            raise SharedEvidenceError(
                "synthetic public preview cannot be associated with Phase 8 agent telemetry"
            )
        return None

    if phase8_ledger is None:
        raise SharedEvidenceError(
            "CORRELATED_AGENT_EXECUTION requires a correlated Phase 8 ledger record"
        )
    if not isinstance(phase8_ledger, Mapping) or phase8_ledger.get("schema_version") != 1:
        raise SharedEvidenceError("incompatible Phase 8 ledger schema_version")
    if phase8_ledger.get("run_id") != execution_id:
        raise SharedEvidenceError(
            "Phase 8 ledger run_id does not match execution_id"
        )
    thread_id = phase8_ledger.get("thread_id")
    if not isinstance(thread_id, str) or not phase8_evidence_discovery.UUID.fullmatch(
        thread_id
    ):
        raise SharedEvidenceError("Phase 8 ledger thread_id must be a valid UUID")
    source_sha = phase8_ledger.get("source_sha256")
    if not _is_sha256_hex(source_sha):
        raise SharedEvidenceError("Phase 8 ledger source_sha256 is invalid")

    claims = phase8_ledger.get("claims", {})
    if (
        claims.get("human_zero_if_missing") is not False
        or claims.get("rework_zero_if_missing") is not False
        or claims.get("provider_cost_is_estimated") is not False
    ):
        raise SharedEvidenceError("Phase 8 ledger conservative claims violated")

    tokens = phase8_ledger.get("tokens", {})
    token_avail = tokens.get("availability")
    if token_avail not in {
        "AUTHORITATIVE",
        "DERIVED_TOTAL",
        "INCOMPLETE",
        "NOT_AVAILABLE",
    }:
        raise SharedEvidenceError("Phase 8 ledger tokens availability invalid")
    if token_avail == "NOT_AVAILABLE" and tokens.get("values") is not None:
        raise SharedEvidenceError("NOT_AVAILABLE tokens must have null values")

    annotations = phase8_ledger.get("annotations", {})
    categories = annotations.get("categories", {})
    if set(categories) != set(phase8_event_ledger.CATEGORIES):
        raise SharedEvidenceError("Phase 8 ledger annotation categories incomplete")
    for cat_name, cat_data in categories.items():
        avail = cat_data.get("availability")
        if avail not in {"AUTHORITATIVE", "PARTIAL", "NOT_AVAILABLE"}:
            raise SharedEvidenceError(f"invalid availability for category {cat_name}")
        if avail in {"PARTIAL", "NOT_AVAILABLE"} and cat_data.get("total") is not None:
            raise SharedEvidenceError(
                f"category {cat_name} with availability {avail} cannot claim a total"
            )

    if phase8_discovery is not None:
        if (
            not isinstance(phase8_discovery, Mapping)
            or phase8_discovery.get("schema_version") != 1
        ):
            raise SharedEvidenceError("incompatible Phase 8 discovery schema_version")
        if (
            phase8_discovery.get("raw_content_exported") is not False
            or phase8_discovery.get("provider_calls") != 0
        ):
            raise SharedEvidenceError("Phase 8 discovery safety contract violated")
        runs = phase8_discovery.get("runs", {})
        run_info = runs.get(thread_id.lower())
        if not isinstance(run_info, Mapping):
            raise SharedEvidenceError(
                "Phase 8 discovery does not contain ledger thread_id"
            )
        status = run_info.get("status")
        matches = run_info.get("matches", [])
        if status != "FOUND" or not isinstance(matches, list) or len(matches) != 1:
            raise SharedEvidenceError(
                f"Phase 8 discovery status for thread is '{status}', expected unique FOUND"
            )
        if matches[0].get("sha256") != source_sha:
            raise SharedEvidenceError(
                "Phase 8 discovery match sha256 does not match ledger source_sha256"
            )

    return dict(phase8_ledger)


def _validate_expert_evidence(
    execution_id: str,
    scenario_id: str,
    expert_evidence: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    if expert_evidence is None:
        return None
    if not isinstance(expert_evidence, Mapping) or expert_evidence.get(
        "schema_version"
    ) not in {1, 2}:
        raise SharedEvidenceError("incompatible expert_evidence schema_version")
    if expert_evidence.get("run_id") != execution_id:
        raise SharedEvidenceError(
            "expert_evidence run_id does not match execution_id"
        )
    if (
        expert_evidence.get("scenario_id") is not None
        and expert_evidence.get("scenario_id") != scenario_id
    ):
        raise SharedEvidenceError(
            "expert_evidence scenario_id does not match scenario_id"
        )
    tree_sha = expert_evidence.get("candidate_tree_sha256")
    if tree_sha != EXPERT_CANDIDATE_TREE_SHA256:
        raise SharedEvidenceError(
            "expert_evidence candidate_tree_sha256 does not match frozen Expert v0.1.1"
        )

    activated = bool(expert_evidence.get("expert_activated", True))
    telemetry_observed = bool(
        expert_evidence.get("expert_reference_telemetry_observed", False)
    )
    initial_reads = expert_evidence.get("initial_reference_reads")
    expansion_reads = expert_evidence.get("justified_expansion_reads", [])
    expansion_reason = expert_evidence.get("expansion_justification")

    if activated:
        if not telemetry_observed or not isinstance(initial_reads, list):
            return {
                "expert_activated": True,
                "candidate_version": EXPERT_CANDIDATE_VERSION,
                "candidate_tree_sha256": tree_sha,
                "telemetry_observed": False,
                "initial_reference_reads": None,
                "justified_expansion_reads": [],
                "disclosure_bounded": False,
                "disclosure_verdict": "FAIL",
                "failure_reason": "expert_reference_telemetry_missing",
                "d6_substantive_verdict": "BLOCKED",
                "d6_verification_reason": (
                    "independent_evaluator_acceptance_contract_unavailable"
                ),
            }
        if not all(isinstance(r, str) and r.startswith("references/") for r in initial_reads):
            raise SharedEvidenceError("invalid initial_reference_reads format")
        if not isinstance(expansion_reads, list) or not all(
            isinstance(r, str) and r.startswith("references/") for r in expansion_reads
        ):
            raise SharedEvidenceError("invalid justified_expansion_reads format")
        unique_initial = sorted(set(r.casefold() for r in initial_reads))
        unique_expansion = sorted(
            set(r.casefold() for r in expansion_reads) - set(unique_initial)
        )
        initial_ok = 1 <= len(unique_initial) <= EXPERT_MAX_INITIAL_REFERENCES
        expansion_ok = not unique_expansion or (
            isinstance(expansion_reason, str) and bool(expansion_reason.strip())
        )
        bounded = initial_ok and expansion_ok
        failure_reason = None
        if not initial_ok:
            failure_reason = "initial_reference_selection_exceeds_bound"
        elif not expansion_ok:
            failure_reason = "unjustified_reference_expansion"
        return {
            "expert_activated": True,
            "candidate_version": EXPERT_CANDIDATE_VERSION,
            "candidate_tree_sha256": tree_sha,
            "telemetry_observed": True,
            "initial_reference_reads": unique_initial,
            "initial_reference_count": len(unique_initial),
            "justified_expansion_reads": unique_expansion,
            "expansion_justification": expansion_reason if unique_expansion else None,
            "disclosure_bounded": bounded,
            "disclosure_verdict": "PASS" if bounded else "FAIL",
            "failure_reason": failure_reason,
            "d6_substantive_verdict": "BLOCKED",
            "d6_verification_reason": (
                "independent_evaluator_acceptance_contract_unavailable"
            ),
        }

    return {
        "expert_activated": False,
        "candidate_version": EXPERT_CANDIDATE_VERSION,
        "candidate_tree_sha256": tree_sha,
        "telemetry_observed": telemetry_observed,
        "initial_reference_reads": [],
        "initial_reference_count": 0,
        "justified_expansion_reads": [],
        "expansion_justification": None,
        "disclosure_bounded": True,
        "disclosure_verdict": "PASS",
        "failure_reason": None,
        "d6_substantive_verdict": "BLOCKED",
        "d6_verification_reason": (
            "independent_evaluator_acceptance_contract_unavailable"
        ),
    }


def _build_combined_metrics(
    efficiency_report: Mapping[str, Any],
    ledger: Mapping[str, Any] | None,
) -> dict[str, Any]:
    eff_metrics = efficiency_report.get("metrics", {})
    combined: dict[str, Any] = {
        "validation_timing_and_activity": {
            key: eff_metrics.get(
                key,
                {
                    "availability": "NOT_AVAILABLE",
                    "value": None,
                    "unit": "unknown",
                    "source": "forge_a7_efficiency",
                },
            )
            for key in (
                "total_elapsed",
                "baseline_validation_duration",
                "target_validation_duration",
                "validation_subprocess_invocations",
                "validation_nonzero_exits",
                "validation_contract_mismatches",
                "validation_timeouts",
            )
        }
    }
    if ledger is None:
        combined["tokens"] = {
            "availability": "NOT_AVAILABLE",
            "values": None,
            "source": "phase8_event_ledger",
            "reason": "no_correlated_phase8_event_ledger",
        }
        combined["tool_events"] = {
            "availability": "NOT_AVAILABLE",
            "observed_started": None,
            "observed_item_failures": None,
            "retry_count": {"availability": "NOT_AVAILABLE", "value": None},
            "source": "phase8_event_ledger",
        }
        combined["interventions_and_rework"] = {
            cat: {
                "availability": "NOT_AVAILABLE",
                "observed_minimum": None,
                "total": None,
                "source": "phase8_event_ledger",
            }
            for cat in sorted(phase8_event_ledger.CATEGORIES)
        }
        combined["provider_monetary_cost"] = {
            "availability": "NOT_AVAILABLE",
            "value": None,
            "source": "phase8_event_ledger",
        }
    else:
        combined["tokens"] = {
            **ledger["tokens"],
            "source": "phase8_event_ledger",
        }
        combined["tool_events"] = {
            **ledger["tool_events"],
            "source": "phase8_event_ledger",
        }
        combined["interventions_and_rework"] = {
            cat: {
                **ledger["annotations"]["categories"][cat],
                "source": "phase8_event_ledger",
            }
            for cat in sorted(phase8_event_ledger.CATEGORIES)
        }
        combined["provider_monetary_cost"] = {
            **ledger["provider_monetary_cost"],
            "source": "phase8_event_ledger",
        }
    return combined


def _map_jira_acceptance(
    *,
    execution_mode: str,
    execution_provenance: Mapping[str, Any],
    forge_outcome: Mapping[str, Any],
    quality_gate: Mapping[str, Any],
    efficiency_report: Mapping[str, Any],
    ledger: Mapping[str, Any] | None,
    expert_summary: Mapping[str, Any] | None,
    representative_multi_scenario: bool,
) -> dict[str, dict[str, Any]]:
    """Map execution evidence to independent Jira criteria dispositions.

    Separates evidence capture validity from task outcome, comparison eligibility,
    and product-level acceptance.
    """
    qg_verdict = quality_gate["verdict"]
    baseline_ok = bool(
        forge_outcome.get("baseline_validation", {}).get("matches_expected")
    )
    cleaned_ok = forge_outcome.get("disposable_workspace_cleaned") is True

    # AFYX-93: Scenario identity, fixture integrity and representative coverage
    afyx_93_verdict = "PASS" if (baseline_ok and cleaned_ok) else "FAIL"
    afyx_93 = {
        "disposition": afyx_93_verdict,
        "scope": "scenario_identity_fixture_integrity_and_preview_harness",
        "coverage_scope": (
            "CALLER_REPORTED_MULTI_SCENARIO_UNVERIFIED"
            if representative_multi_scenario
            else "SINGLE_SCENARIO_BOUNDED"
        ),
        "campaign_36_cell_status": "0/36 NOT_RUN",
        "task_completion_inferred": False,
    }

    # AFYX-94: Correctness, scope, regression and evidence quality (A6)
    afyx_94 = {
        "disposition": qg_verdict,
        "quality_gate_id": quality_gate["quality_gate_id"],
        "gate_results": dict(quality_gate["gate_results"]),
        "failure_codes": list(quality_gate["failure_codes"]),
        "real_agent_correctness_established": bool(
            execution_provenance["real_agent_verified"] and qg_verdict == "PASS"
        ),
        "execution_provenance_status": execution_provenance["status"],
        "execution_provenance_reason": execution_provenance["reason"],
    }

    # AFYX-95: Observed efficiency metrics and comparison eligibility (A7)
    # A6 quality FAIL prevents comparison eligibility and superiority claims,
    # but does not invalidate the recording of observed timing counters.
    eff_status = efficiency_report.get("measurement_status")
    if qg_verdict == "FAIL" or eff_status == "INVALID":
        afyx_95_verdict = "FAIL"
    elif qg_verdict == "NOT_TESTED" or eff_status == "NOT_AVAILABLE":
        afyx_95_verdict = "NOT_TESTED"
    elif execution_mode == "PUBLIC_SYNTHETIC_PREVIEW":
        afyx_95_verdict = "PASS"
    else:
        token_avail = (ledger or {}).get("tokens", {}).get("availability")
        afyx_95_verdict = (
            "PASS"
            if token_avail in {"AUTHORITATIVE", "DERIVED_TOTAL"}
            else "BLOCKED"
        )

    afyx_95 = {
        "disposition": afyx_95_verdict,
        "efficiency_report_id": efficiency_report["efficiency_report_id"],
        "measurement_status": eff_status,
        "comparison_eligible": bool(efficiency_report.get("comparison_eligible")),
        "comparison_ineligibility_reasons": list(
            efficiency_report.get("comparison_ineligibility_reasons", [])
        ),
        "provider_telemetry_available": (
            ledger is not None
            and ledger.get("tokens", {}).get("availability")
            in {"AUTHORITATIVE", "DERIVED_TOTAL"}
        ),
        "superiority_claim": "NOT_ESTABLISHED",
        "token_or_monetary_savings_claimed": False,
    }

    # AFYX-68 & AFYX-69: Recorded token/tool/intervention/rework evidence
    # Evidence capture validity is independent of task success or tool failures.
    # A failed task or failed tool call is valid observed evidence.
    if ledger is None:
        afyx_68 = {
            "disposition": "NOT_TESTED",
            "reason": "no_correlated_phase8_event_ledger",
            "token_availability": "NOT_AVAILABLE",
            "tool_capture_availability": "NOT_AVAILABLE",
        }
        afyx_69 = {
            "disposition": "NOT_TESTED",
            "reason": "no_correlated_phase8_event_ledger",
            "human_intervention_availability": "NOT_AVAILABLE",
            "rework_availability": "NOT_AVAILABLE",
        }
    else:
        tok_avail = ledger["tokens"]["availability"]
        tool_avail = ledger["tool_events"]["availability"]
        tool_failures = ledger["tool_events"]["observed_item_failures"]
        if (
            tok_avail in {"AUTHORITATIVE", "DERIVED_TOTAL"}
            and tool_avail == "COMPLETE_CAPTURE_SCOPE_ONLY"
        ):
            afyx_68_verdict = "PASS"
        else:
            afyx_68_verdict = "BLOCKED"
        afyx_68 = {
            "disposition": afyx_68_verdict,
            "token_availability": tok_avail,
            "tool_capture_availability": tool_avail,
            "observed_item_failures": tool_failures,
            "telemetry_valid_despite_task_or_tool_failure": True,
        }

        cats = ledger["annotations"]["categories"]
        hi_avail = cats["human_intervention"]["availability"]
        rw_avail = cats["rework"]["availability"]
        if hi_avail == "AUTHORITATIVE" and rw_avail == "AUTHORITATIVE":
            afyx_69_verdict = "PASS"
        else:
            afyx_69_verdict = "BLOCKED"
        afyx_69 = {
            "disposition": afyx_69_verdict,
            "human_intervention_availability": hi_avail,
            "rework_availability": rw_avail,
            "historical_rollouts_complete": (
                hi_avail == "AUTHORITATIVE" and rw_avail == "AUTHORITATIVE"
            ),
        }

    # AFYX-283: Expert routing, reference selection and bounded disclosure
    if expert_summary is None:
        afyx_283 = {
            "disposition": "NOT_TESTED",
            "reason": "expert_evaluation_not_in_execution_scope",
            "candidate_version": EXPERT_CANDIDATE_VERSION,
            "candidate_tree_sha256": EXPERT_CANDIDATE_TREE_SHA256,
            "disclosure_gate_verdict": "NOT_TESTED",
            "d6_substantive_verdict": "BLOCKED",
        }
    else:
        disc_verdict = expert_summary["disclosure_verdict"]
        d6_verdict = expert_summary["d6_substantive_verdict"]
        if disc_verdict == "FAIL":
            afyx_283_verdict = "FAIL"
        else:
            afyx_283_verdict = "BLOCKED"
        afyx_283 = {
            "disposition": afyx_283_verdict,
            "candidate_version": expert_summary["candidate_version"],
            "candidate_tree_sha256": expert_summary["candidate_tree_sha256"],
            "disclosure_gate_verdict": disc_verdict,
            "initial_reference_reads": expert_summary["initial_reference_reads"],
            "justified_expansion_reads": expert_summary["justified_expansion_reads"],
            "failure_reason": expert_summary["failure_reason"],
            "d6_substantive_verdict": d6_verdict,
            "d6_verification_reason": expert_summary["d6_verification_reason"],
        }

    # AFYX-70: Engineering-value evidence, if representative and sufficient
    # Quality and security failures strictly invalidate engineering value claims.
    if qg_verdict == "FAIL":
        afyx_70_verdict = "FAIL"
        afyx_70_reason = "quality_or_security_gate_failed"
    elif execution_mode == "PUBLIC_SYNTHETIC_PREVIEW":
        afyx_70_verdict = "BLOCKED"
        afyx_70_reason = (
            "synthetic_preview_is_not_real_agent_engineering_value_evidence"
        )
    else:
        afyx_70_verdict = "BLOCKED"
        afyx_70_reason = (
            "independent_representative_acceptance_contract_unavailable"
        )

    afyx_70 = {
        "disposition": afyx_70_verdict,
        "reason": afyx_70_reason,
        "reusable_correctness_evidence": qg_verdict == "PASS",
        "engineering_value_established": afyx_70_verdict == "PASS",
    }

    return {
        "AFYX-93": afyx_93,
        "AFYX-94": afyx_94,
        "AFYX-95": afyx_95,
        "AFYX-68": afyx_68,
        "AFYX-69": afyx_69,
        "AFYX-283": afyx_283,
        "AFYX-70": afyx_70,
    }


def build_shared_evidence_bundle(
    forge_outcome: Mapping[str, Any],
    *,
    manifest: Mapping[str, Any] | None = None,
    repository_root: Path = REPO_ROOT,
    execution_mode: str = "PUBLIC_SYNTHETIC_PREVIEW",
    candidate_sha256: str | None = None,
    fixture_sha256: str | None = None,
    phase8_ledger: Mapping[str, Any] | None = None,
    phase8_discovery: Mapping[str, Any] | None = None,
    expert_evidence: Mapping[str, Any] | None = None,
    additional_evidence_refs: Sequence[Mapping[str, Any]] | None = None,
    representative_multi_scenario: bool = False,
) -> dict[str, Any]:
    """Create a deterministic, sanitized shared evidence bundle across Jira gates."""
    if execution_mode not in EXECUTION_MODES:
        raise SharedEvidenceError(f"unsupported execution_mode: {execution_mode}")

    _validate_structural_sanitization(
        {
            "forge_outcome": forge_outcome,
            "phase8_ledger": phase8_ledger,
            "phase8_discovery": phase8_discovery,
            "expert_evidence": expert_evidence,
            "additional_evidence_refs": list(additional_evidence_refs or ()),
        }
    )

    loaded_manifest = (
        dict(manifest)
        if manifest is not None
        else forge_validate.load_json(forge_validate.MANIFEST_PATH)
    )
    (
        candidate_id,
        scenario_id,
        scenario,
        verified_candidate_sha,
        verified_fixture_sha,
        manifest_sha,
    ) = _validate_and_resolve_identities(
        forge_outcome,
        loaded_manifest,
        repository_root,
        candidate_sha256,
        fixture_sha256,
    )

    execution_id = forge_outcome.get("preview_run_id") or forge_outcome.get("run_id")
    if not isinstance(execution_id, str) or not execution_id.strip():
        raise SharedEvidenceError("execution_id (preview_run_id or run_id) is required")

    if execution_mode == "CORRELATED_AGENT_EXECUTION":
        if forge_outcome.get("synthetic_fix_applied") is True:
            raise SharedEvidenceError(
                "synthetic_fix_applied outcome cannot be used in CORRELATED_AGENT_EXECUTION"
            )
        if execution_id.startswith("preview-"):
            raise SharedEvidenceError(
                "synthetic preview_run_id cannot be used in CORRELATED_AGENT_EXECUTION"
            )

    execution_provenance = _validate_execution_provenance(
        execution_mode, forge_outcome
    )

    quality_gate, efficiency_report = _validate_quality_and_efficiency(
        scenario, forge_outcome, execution_mode
    )
    validated_ledger = _validate_phase8_records(
        execution_id, execution_mode, phase8_ledger, phase8_discovery
    )
    expert_summary = _validate_expert_evidence(
        execution_id, scenario_id, expert_evidence
    )

    # Cross-run correlation check: verify run_id consistency across all inputs
    # A changed source with a reused run ID must be rejected.
    registered_run_sources: dict[str, str] = {}
    if validated_ledger is not None:
        registered_run_sources[execution_id] = validated_ledger["source_sha256"]

    # Build reference table without copying raw source evidence.
    # Deduplication does not reject legitimate references to the same immutable source,
    # but rejects conflicting digests for the same role or reused run_ids with different source hashes.
    evidence_refs: list[dict[str, Any]] = []
    seen_role_digests: dict[str, str] = {}

    def register_ref(
        role: str,
        schema_ver: int,
        digest: str,
        rec_run_id: str | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        clean_digest = digest.lower()
        if role in seen_role_digests:
            if seen_role_digests[role] == clean_digest:
                # Deduplicate identical legitimate reference
                return
            raise SharedEvidenceError(
                f"conflicting evidence record for role '{role}': "
                f"existing={seen_role_digests[role]}, new={clean_digest}"
            )
        seen_role_digests[role] = clean_digest

        if rec_run_id is not None and rec_run_id in registered_run_sources:
            if extra and "event_stream_sha256" in extra:
                if extra["event_stream_sha256"] != registered_run_sources[rec_run_id]:
                    raise SharedEvidenceError(
                        f"reused run_id '{rec_run_id}' with conflicting event stream source rejected"
                    )

        entry: dict[str, Any] = {
            "role": role,
            "schema_version": schema_ver,
            "sha256": clean_digest,
        }
        if rec_run_id is not None:
            entry["run_id"] = rec_run_id
        if extra:
            entry.update(extra)
        evidence_refs.append(entry)

    # Sanitize forge_outcome before computing reference digest
    sanitized_forge_ref = {
        "schema_version": forge_outcome["schema_version"],
        "execution_id": execution_id,
        "candidate_id": candidate_id,
        "scenario_id": scenario_id,
        "verdict": forge_outcome.get("verdict"),
        "synthetic_fix_applied": bool(forge_outcome.get("synthetic_fix_applied")),
        "files_modified": sorted(forge_outcome.get("files_modified", [])),
        "scope_adherence": bool(forge_outcome.get("scope_adherence")),
        "disposable_workspace_cleaned": bool(
            forge_outcome.get("disposable_workspace_cleaned")
        ),
        "quality_gate_verdict": quality_gate["verdict"],
    }
    register_ref(
        "forge_outcome",
        1,
        canonical_sha256(sanitized_forge_ref),
        execution_id,
    )

    if validated_ledger is not None:
        register_ref(
            "phase8_event_ledger",
            validated_ledger["schema_version"],
            canonical_sha256(validated_ledger),
            validated_ledger["run_id"],
            {
                "thread_id": validated_ledger["thread_id"],
                "event_stream_sha256": validated_ledger["source_sha256"],
            },
        )
    if phase8_discovery is not None:
        register_ref(
            "phase8_evidence_discovery",
            phase8_discovery["schema_version"],
            canonical_sha256(phase8_discovery),
            execution_id,
        )
    if expert_evidence is not None and expert_summary is not None:
        register_ref(
            "expert_disclosure_evidence",
            expert_evidence["schema_version"],
            canonical_sha256(expert_evidence),
            execution_id,
            {"candidate_tree_sha256": expert_summary["candidate_tree_sha256"]},
        )
    for extra_ref in additional_evidence_refs or ():
        if not isinstance(extra_ref, Mapping):
            raise SharedEvidenceError("additional_evidence_refs entries must be mappings")
        allowed_fields = {
            "role",
            "schema_version",
            "sha256",
            "run_id",
            "event_stream_sha256",
        }
        unexpected_fields = sorted(set(extra_ref) - allowed_fields)
        if unexpected_fields:
            raise SharedEvidenceError(
                "unexpected additional evidence reference fields: "
                + ", ".join(unexpected_fields)
            )
        role = extra_ref.get("role")
        schema_ver = extra_ref.get("schema_version")
        digest = extra_ref.get("sha256")
        rec_run_id = extra_ref.get("run_id")
        event_stream_sha = extra_ref.get("event_stream_sha256")
        if (
            not isinstance(role, str)
            or not role
            or type(schema_ver) is not int
            or not _is_sha256_hex(digest)
            or (rec_run_id is not None and not isinstance(rec_run_id, str))
            or (
                event_stream_sha is not None
                and not _is_sha256_hex(event_stream_sha)
            )
        ):
            raise SharedEvidenceError("invalid additional evidence reference entry")
        extra_fields = (
            {"event_stream_sha256": event_stream_sha}
            if event_stream_sha is not None
            else None
        )
        register_ref(
            role,
            schema_ver,
            digest,
            rec_run_id,
            extra_fields,
        )

    combined_metrics = _build_combined_metrics(efficiency_report, validated_ledger)
    jira_acceptance = _map_jira_acceptance(
        execution_mode=execution_mode,
        execution_provenance=execution_provenance,
        forge_outcome=forge_outcome,
        quality_gate=quality_gate,
        efficiency_report=efficiency_report,
        ledger=validated_ledger,
        expert_summary=expert_summary,
        representative_multi_scenario=representative_multi_scenario,
    )

    bundle: dict[str, Any] = {
        "contract_id": SHARED_EVIDENCE_CONTRACT_ID,
        "schema_version": SHARED_EVIDENCE_SCHEMA_VERSION,
        "execution_id": execution_id,
        "execution_mode": execution_mode,
        "execution_provenance": execution_provenance,
        "synthetic_preview": execution_mode == "PUBLIC_SYNTHETIC_PREVIEW",
        "identities": {
            "manifest_sha256": manifest_sha,
            "candidate_id": candidate_id,
            "candidate_sha256": verified_candidate_sha,
            "scenario_id": scenario_id,
            "scenario_category": scenario["category"],
            "fixture_path": scenario["fixture"],
            "fixture_sha256": verified_fixture_sha,
            "expert_candidate_tree_sha256": (
                expert_summary["candidate_tree_sha256"]
                if expert_summary is not None
                else EXPERT_CANDIDATE_TREE_SHA256
            ),
        },
        "evidence_refs": evidence_refs,
        "quality_summary": {
            "quality_gate_id": quality_gate["quality_gate_id"],
            "verdict": quality_gate["verdict"],
            "gate_results": dict(quality_gate["gate_results"]),
            "failure_codes": list(quality_gate["failure_codes"]),
        },
        "metrics": combined_metrics,
        "jira_acceptance": jira_acceptance,
        "boundaries_and_limitations": {
            "raw_source_duplicated": False,
            "private_payload_retained": False,
            "forge_b0_b5_campaign_status": "0/36 NOT_RUN",
            "a8_architecture_go_granted": False,
            "d6_independent_review_asserted": False,
            "superiority_or_savings_claimed": False,
        },
    }
    _validate_structural_sanitization(bundle)
    bundle["bundle_sha256"] = canonical_sha256(bundle)
    return bundle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="AFYX Shared Evidence Bundle & Jira Acceptance Mapper (Offline Demo)"
    )
    parser.add_argument(
        "--opt-in",
        action="store_true",
        help="Explicitly opt into running the public synthetic preview demonstration.",
    )
    parser.add_argument(
        "--candidate",
        default="B2",
        help="Forge candidate directive ID (default: B2).",
    )
    parser.add_argument(
        "--scenario",
        default="forge-cross-module-001",
        help="Public scenario ID (default: forge-cross-module-001).",
    )
    parser.add_argument(
        "--apply-synthetic-fix",
        action="store_true",
        help="Apply the scoped synthetic fix during the offline preview.",
    )
    args = parser.parse_args(argv)

    if not preview.check_opt_in(args.opt_in):
        print(
            "NOTICE: Shared evidence preview demonstration requires '--opt-in' "
            f"or {preview.PREVIEW_OPT_IN_ENV}=1.",
            file=sys.stderr,
        )
        return 1

    try:
        manifest = forge_validate.load_json(forge_validate.MANIFEST_PATH)
        outcome = preview.run_preview_scenario(
            manifest,
            args.candidate,
            args.scenario,
            repository_root=REPO_ROOT,
            apply_synthetic_fix=args.apply_synthetic_fix,
            quality_gate=True,
            efficiency_report=True,
        )
        bundle = build_shared_evidence_bundle(
            outcome,
            manifest=manifest,
            repository_root=REPO_ROOT,
            execution_mode="PUBLIC_SYNTHETIC_PREVIEW",
        )
        sys.stdout.write(json.dumps(bundle, indent=2, sort_keys=True) + "\n")
        return 0
    except (SharedEvidenceError, preview.PreviewManifestInvalid, ValueError) as exc:
        print(f"SHARED_EVIDENCE_BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
