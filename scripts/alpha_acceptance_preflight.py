#!/usr/bin/env python3
"""Offline, zero-provider alpha/v1 evidence preflight (never grants release approval).

Checks the structure and internal consistency of *claims*, not the truth of external
artifacts or evaluator conclusions. Raw workspaces, prompts and private telemetry
are neither scanned nor included in the public output.
"""
from __future__ import annotations

import argparse
import json
import re
import stat
import sys
from pathlib import Path

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REASON = re.compile(r"^[A-Z][A-Z0-9_]{2,79}$")
REF = re.compile(
    r"^(?:urn:afyx:evidence:[0-9a-f]{64}|"
    r"https://github\.com/a5zero7/afyx-codex-engineering-kit/actions/runs/[0-9]+)$"
)
STATUSES = frozenset(("PASS", "FAIL", "NOT_RUN", "BLOCKED"))
# Order is dependency order. Every gate is release-blocking in the expanded v1
# contract. An Alpha pilot can proceed only through its separately authorized gate.
GATES = {
    "GRAPH_STANDALONE": ("owner", ()),
    "CONTEXT_STANDALONE": ("owner", ()),
    "FORGE_STANDALONE": ("owner", ()),
    "ODOO_STANDALONE": ("owner", ()),
    "EXPERT_STANDALONE": ("owner", ()),
    "GRAPH_ACE_RUNTIME": ("owner", ("GRAPH_STANDALONE", "CONTEXT_STANDALONE")),
    "PROVIDER_THREE_HOST": ("owner", ("GRAPH_STANDALONE",)),
    "INSTALLER_LIFECYCLE": ("owner", ()),
    "EXPERT_D6": ("independent_evaluator", ("EXPERT_STANDALONE", "ODOO_STANDALONE")),
    "FORGE_FORMAL_36": ("independent_evaluator", ("FORGE_STANDALONE",)),
    "FORGE_A8_DECISION": ("independent_evaluator", ("FORGE_FORMAL_36",)),
    "FORGE_A9_A12": ("independent_evaluator", ("FORGE_A8_DECISION",)),
    "PLATFORM_TB7": ("owner", ("PROVIDER_THREE_HOST",)),
    "PHASE8_REAL_DOGFOOD": ("independent_evaluator", ("GRAPH_ACE_RUNTIME", "EXPERT_D6")),
    "PHASE9_HARDENING": ("owner", ("INSTALLER_LIFECYCLE",)),
    "T12_INSTALLED_PRODUCT": ("release_reviewer", (
        "GRAPH_ACE_RUNTIME", "PLATFORM_TB7", "FORGE_A9_A12",
        "PHASE8_REAL_DOGFOOD", "PHASE9_HARDENING", "EXPERT_D6",
    )),
    "PHASE10_PRIVATE_BETA": ("release_reviewer", ("T12_INSTALLED_PRODUCT",)),
    "PHASE11_STABLE": ("release_reviewer", ("PHASE10_PRIVATE_BETA",)),
}
SCENARIOS = {
    "KNOWN_SYMBOL_DIRECT": ("known_symbol", "small", "CONTROL_TREATMENT"),
    "ODOO_CROSS_MODULE": ("odoo_multimodule", "large", "CONTROL_TREATMENT"),
    "PYTHON_REGRESSION": ("python", "medium", "CONTROL_TREATMENT"),
    "TYPESCRIPT_MONOREPO": ("typescript_monorepo", "large", "CONTROL_TREATMENT"),
    "ACE_LARGE_REPEAT_RECOVERY": ("context_recovery", "large", "CONTROL_TREATMENT"),
    "PROVIDER_RESTART_ROLLBACK": ("provider_lifecycle", "medium", "OBSERVATIONAL"),
}
REQUIRES_INSTALLED_ARTIFACT = frozenset((
    "GRAPH_ACE_RUNTIME", "PROVIDER_THREE_HOST", "INSTALLER_LIFECYCLE",
    "PLATFORM_TB7", "T12_INSTALLED_PRODUCT", "PHASE10_PRIVATE_BETA",
    "PHASE11_STABLE",
))
MAX_LEDGER_BYTES = 1024 * 1024


class LedgerError(ValueError):
    pass


def require(condition: bool, error_code: str) -> None:
    if not condition:
        raise LedgerError(error_code)


def sha40(value: object) -> bool:
    return isinstance(value, str) and SHA40.fullmatch(value) is not None


def sha256(value: object) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def verify_evidence(items: object, candidate: str | None, role: str, status: str) -> None:
    require(isinstance(items, list) and len(items) <= 16, "INVALID_EVIDENCE_COLLECTION")
    if status == "PASS":
        require(candidate is not None, "PASS_WITHOUT_CANDIDATE")
        require(bool(items), "PASS_WITHOUT_EVIDENCE")
    for value in items:
        require(isinstance(value, dict), "INVALID_EVIDENCE_RECORD")
        require(set(value) == {"reference", "digest_sha256", "source_sha", "verifier_role", "scope"},
                "INVALID_EVIDENCE_FIELDS")
        require(isinstance(value["reference"], str) and REF.fullmatch(value["reference"]) is not None,
                "INVALID_EVIDENCE_REFERENCE")
        require(sha256(value["digest_sha256"]), "INVALID_EVIDENCE_DIGEST")
        require(sha40(value["source_sha"]) and value["source_sha"] == candidate, "EVIDENCE_IDENTITY_MISMATCH")
        require(value["verifier_role"] == role, "EVIDENCE_AUTHORITY_MISMATCH")
        require(isinstance(value["scope"], str) and REASON.fullmatch(value["scope"]) is not None,
                "INVALID_EVIDENCE_SCOPE")


def validate(document: object, *, expected_source_sha: str | None = None) -> dict:
    require(isinstance(document, dict), "INVALID_LEDGER_ROOT")
    require(set(document) == {"schema_version", "contract", "purpose", "baseline", "execution", "gates", "scenarios"},
            "LEDGER_FIELDS_MISMATCH")
    require(type(document["schema_version"]) is int and document["schema_version"] == 1
            and document["contract"] == "afyx.alpha.acceptance/v1", "UNSUPPORTED_LEDGER_CONTRACT")
    baseline = document["baseline"]
    require(isinstance(baseline, dict)
            and set(baseline) == {"branch", "observed_source_sha", "candidate_source_sha", "artifact_digest_sha256"},
            "INVALID_BASELINE")
    require(baseline["branch"] == "dev" and sha40(baseline["observed_source_sha"]), "INVALID_OBSERVED_SOURCE")
    candidate = baseline["candidate_source_sha"]
    require(candidate is None or sha40(candidate), "INVALID_CANDIDATE_SHA")
    artifact = baseline["artifact_digest_sha256"]
    require(artifact is None or sha256(artifact), "INVALID_ARTIFACT_DIGEST")
    if expected_source_sha is not None:
        require(sha40(expected_source_sha) and candidate == expected_source_sha, "CANDIDATE_REVISION_MISMATCH")
    execution = document["execution"]
    require(isinstance(execution, dict) and set(execution) == {
        "provider_calls_observed", "real_world_pilot_executed",
        "independent_evaluator_run", "owner_release_approval"
    }, "INVALID_EXECUTION_RECORD")
    require(type(execution["provider_calls_observed"]) is int and execution["provider_calls_observed"] >= 0,
            "INVALID_PROVIDER_CALL_COUNT")
    for key in ("real_world_pilot_executed", "independent_evaluator_run", "owner_release_approval"):
        require(type(execution[key]) is bool, "INVALID_EXECUTION_FLAG")
    gates = document["gates"]
    scenarios = document["scenarios"]
    require(isinstance(gates, list) and len(gates) == len(GATES), "GATE_COVERAGE_INCOMPLETE")
    require(isinstance(scenarios, list) and len(scenarios) == len(SCENARIOS), "SCENARIO_COVERAGE_INCOMPLETE")
    seen_gates: dict[str, str] = {}
    gate_counts = {status: 0 for status in STATUSES}
    for entry in gates:
        require(isinstance(entry, dict) and set(entry) == {
            "id", "required_verifier", "depends_on", "status", "reason_code", "evidence"
        }, "INVALID_GATE_FIELDS")
        identity = entry["id"]
        require(isinstance(identity, str) and identity in GATES and identity not in seen_gates,
                "INVALID_GATE_IDENTITY")
        role, prerequisites = GATES[identity]
        require(entry["required_verifier"] == role and entry["depends_on"] == list(prerequisites),
                "GATE_CONTRACT_DRIFT")
        status = entry["status"]
        require(status in STATUSES, "INVALID_GATE_STATUS")
        require(isinstance(entry["reason_code"], str) and REASON.fullmatch(entry["reason_code"]) is not None,
                "INVALID_REASON_CODE")
        verify_evidence(entry["evidence"], candidate, role, status)
        if status == "PASS":
            require(all(seen_gates.get(parent) == "PASS" for parent in prerequisites),
                    "PASS_WITHOUT_PREREQUISITE_ACCEPTANCE")
            if identity in REQUIRES_INSTALLED_ARTIFACT:
                require(artifact is not None, "PASS_WITHOUT_INSTALLED_ARTIFACT_IDENTITY")
            if role == "independent_evaluator":
                require(execution["independent_evaluator_run"], "INDEPENDENT_EVALUATION_NOT_OBSERVED")
            if identity == "PHASE8_REAL_DOGFOOD":
                require(execution["real_world_pilot_executed"], "PILOT_NOT_OBSERVED")
            if identity == "PHASE11_STABLE":
                require(execution["owner_release_approval"], "RELEASE_APPROVAL_NOT_OBSERVED")
        seen_gates[identity] = status
        gate_counts[status] += 1
    require(tuple(seen_gates) == tuple(GATES), "GATE_ORDER_MISMATCH")
    seen_scenarios: set[str] = set()
    scenario_counts = {status: 0 for status in STATUSES}
    for entry in scenarios:
        require(isinstance(entry, dict) and set(entry) == {
            "id", "task_family", "size_band", "method", "status", "reason_code", "evidence"
        }, "INVALID_SCENARIO_FIELDS")
        identity = entry["id"]
        require(isinstance(identity, str) and identity in SCENARIOS and identity not in seen_scenarios,
                "INVALID_SCENARIO_ID")
        require((entry["task_family"], entry["size_band"], entry["method"]) == SCENARIOS[identity],
                "SCENARIO_CONTRACT_DRIFT")
        status = entry["status"]
        require(status in STATUSES and isinstance(entry["reason_code"], str)
                and REASON.fullmatch(entry["reason_code"]) is not None, "INVALID_SCENARIO_STATUS")
        role = "independent_evaluator" if entry["method"] == "CONTROL_TREATMENT" else "owner"
        verify_evidence(entry["evidence"], candidate, role, status)
        if status == "PASS":
            require(execution["real_world_pilot_executed"], "PILOT_NOT_OBSERVED")
            if role == "independent_evaluator":
                require(execution["independent_evaluator_run"], "INDEPENDENT_EVALUATION_NOT_OBSERVED")
        seen_scenarios.add(identity)
        scenario_counts[status] += 1
    require(seen_scenarios == set(SCENARIOS), "SCENARIO_IDS_INCOMPLETE")
    if seen_gates.get("PHASE8_REAL_DOGFOOD") == "PASS":
        require(all(e["status"] == "PASS" for e in scenarios), "PHASE8_WITHOUT_SCENARIO_ACCEPTANCE")
    all_claimed_pass = gate_counts["PASS"] == len(GATES) and scenario_counts["PASS"] == len(SCENARIOS)
    # This program never verifies independent evidence bytes or signs an
    # acceptance verdict. It is a schema+consistency checker only.
    return {
        "contract": "afyx.alpha.preflight.report/v1",
        "validation": "CLAIM_SCHEMA_AND_DEPENDENCIES_ONLY",
        "external_evidence_verified": False,
        "status": "READY_FOR_INDEPENDENT_REVIEW" if all_claimed_pass else "BLOCKED",
        "gates": gate_counts,
        "scenarios": scenario_counts,
        "pending_gate_ids": [e["id"] for e in gates if e["status"] != "PASS"],
        "pending_scenario_ids": [e["id"] for e in scenarios if e["status"] != "PASS"],
        "release_approved_by_tool": False,
        "provider_calls_by_tool": 0,
    }


def read_ledger(file: Path) -> object:
    item = file.lstat()
    require(stat.S_ISREG(item.st_mode) and not file.is_symlink()
            and not (getattr(item, "st_file_attributes", 0) & 0x400), "UNSAFE_LEDGER_PATH")
    require(item.st_size <= MAX_LEDGER_BYTES, "LEDGER_TOO_LARGE")
    with file.open("rb") as handle:
        return json.load(handle)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path(__file__).resolve().parents[1] /
                        "docs" / "AFYX_ALPHA_ACCEPTANCE_LEDGER.json")
    parser.add_argument("--expected-source-sha", default=None)
    parser.add_argument("--require-review-ready", action="store_true")
    parser.add_argument("--output", type=Path, default=None, help="Create a new sanitized report; refuse overwrite")
    args = parser.parse_args(argv)
    try:
        report = validate(read_ledger(args.ledger), expected_source_sha=args.expected_source_sha)
        serialized = json.dumps(report, indent=2, sort_keys=True) + "\n"
        if args.output:
            with args.output.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(serialized)
        else:
            sys.stdout.write(serialized)
        if args.require_review_ready and report["status"] != "READY_FOR_INDEPENDENT_REVIEW":
            return 3
        return 0
    except (LedgerError, OSError, ValueError, TypeError) as exc:
        # Do not expose absolute private file paths or raw evidence in errors.
        code = str(exc) if isinstance(exc, LedgerError) else "LEDGER_UNREADABLE_OR_OUTPUT_UNAVAILABLE"
        print("ALPHA_PREFLIGHT_BLOCKED: " + code, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
