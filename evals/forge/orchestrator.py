#!/usr/bin/env python3
"""Deterministic public Forge A5 plan generation; never executes model cells."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from evals.forge import validate as forge_validate


class OrchestrationRefusal(ValueError):
    """The public manifest cannot safely produce a non-executable plan."""


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _split_cell(cell_id: str) -> tuple[str, str]:
    parts = cell_id.split("::")
    if len(parts) != 3 or parts[2] != "r1":
        raise OrchestrationRefusal(f"invalid frozen cell id: {cell_id}")
    return parts[0], parts[1]


def build_public_plan(
    manifest: Mapping[str, Any],
    *,
    manifest_path: Path = forge_validate.MANIFEST_PATH,
) -> dict[str, Any]:
    """Build the public identity/order plan while keeping execution fail-closed."""

    document = dict(manifest)
    try:
        recorded_manifest = forge_validate.load_json(manifest_path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise OrchestrationRefusal(f"manifest source is unavailable: {error}") from error
    if document != recorded_manifest:
        raise OrchestrationRefusal("manifest object differs from its recorded source")
    violations = forge_validate.validate_manifest(document)
    if violations:
        raise OrchestrationRefusal("manifest validation failed: " + "; ".join(violations))

    discovery = document["discovery"]
    campaign = document["campaign_gate"]
    if (
        discovery["execution_authorized"] is not False
        or discovery["budget"] != "NOT_APPROVED"
        or campaign["execution_authorization"] != "NOT_GRANTED"
        or campaign["benchmark_execution"] is not False
    ):
        raise OrchestrationRefusal("public orchestration cannot authorize execution")

    candidates = document["candidates"]
    scenarios = {item["scenario_id"]: item for item in document["scenarios"]}
    fixture_identity = document["public_fixture"]["tree_sha256"]
    cells: list[dict[str, Any]] = []
    for ordinal, cell_id in enumerate(forge_validate.discovery_cells(document), start=1):
        scenario_id, candidate_id = _split_cell(cell_id)
        scenario = scenarios.get(scenario_id)
        candidate = candidates.get(candidate_id)
        if scenario is None or candidate is None:
            raise OrchestrationRefusal(f"cell references unknown identity: {cell_id}")
        cells.append(
            {
                "ordinal": ordinal,
                "cell_id": cell_id,
                "candidate_id": candidate_id,
                "candidate_sha256": candidate["content_identity"],
                "scenario_id": scenario_id,
                "scenario_category": scenario["category"],
                "fixture_sha256": fixture_identity,
            }
        )

    if len(cells) != discovery["expected_cells"]:
        raise OrchestrationRefusal("planned cell count differs from frozen discovery contract")

    plan = {
        "schema_version": 1,
        "task": "T09.A5_PUBLIC_ORCHESTRATION_PLAN",
        "execution_authorized": False,
        "benchmark_execution": False,
        "manifest_sha256": forge_validate.file_sha256(manifest_path),
        "cell_order_sha256": forge_validate.discovery_order_sha256(document),
        "cell_count": len(cells),
        "cells": cells,
        "campaign_blockers": list(document["benchmark_execution_blockers"]),
    }
    plan["plan_sha256"] = _canonical_sha256(plan)
    return plan


def main() -> int:
    manifest = forge_validate.load_json(forge_validate.MANIFEST_PATH)
    print(json.dumps(build_public_plan(manifest), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
