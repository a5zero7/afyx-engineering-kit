#!/usr/bin/env python3
"""Pure static validation for the Afyx evaluation manifest and references."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
import subprocess
from datetime import date
from pathlib import Path


EVAL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_ROOT.parent
MANIFEST_PATH = EVAL_ROOT / "manifest.json"
FIXTURES_ROOT = (EVAL_ROOT / "fixtures").resolve()
ODOO_REFERENCES = REPO_ROOT / "skills" / "odoo-engineering" / "references"
AFYX_SKILLS = {
    "efficient-coding", "odoo-engineering", "prompt-master",
    "afyx-engineering-expert",
}
FORMAL_ALIASES = {"A0": "N", "A1": "CORE", "B0": "X", "B1": "CORE_X"}

REQUIRED_TOP_LEVEL_KEYS = {
    "schema_version",
    "random_seed",
    "environment",
    "configurations",
    "scenarios",
}
REQUIRED_SCENARIO_KEYS = {
    "scenario_id",
    "category",
    "fixture",
    "user_prompt",
    "configurations",
    "required_skill_reads",
    "forbidden_skill_reads",
    "expected_assertions",
    "forbidden_patterns",
    "validation_command",
    "allowed_file_scope",
    "expected_file_scope",
    "output_kind",
}
LAST_VERIFIED_PATTERN = re.compile(
    r"^Last verified: (?P<value>\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE
)


def validate_manifest(violations: list[str]) -> None:
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        violations.append(f"manifest.json is not readable JSON: {error}")
        return
    if not isinstance(manifest, dict):
        violations.append("manifest.json top level must be an object")
        return

    missing_top = sorted(REQUIRED_TOP_LEVEL_KEYS - manifest.keys())
    for key in missing_top:
        violations.append(f"manifest.json missing top-level key: {key}")

    configurations = manifest.get("configurations")
    if not isinstance(configurations, dict):
        violations.append("manifest.json configurations must be an object")
        configuration_names: set[str] = set()
    else:
        configuration_names = set(configurations)
        for name, skills in configurations.items():
            if not isinstance(skills, list) or any(skill not in AFYX_SKILLS for skill in skills):
                violations.append(f"configuration {name!r} contains invalid skills")

    aliases = manifest.get("evaluation_aliases")
    if aliases != FORMAL_ALIASES:
        violations.append(f"evaluation_aliases must equal {FORMAL_ALIASES}")

    scenarios = manifest.get("scenarios")
    if not isinstance(scenarios, list):
        violations.append("manifest.json scenarios must be an array")
        return

    scenario_ids = []
    for index, scenario in enumerate(scenarios):
        prefix = f"scenario[{index}]"
        if not isinstance(scenario, dict):
            violations.append(f"{prefix} must be an object")
            continue

        scenario_id = scenario.get("scenario_id")
        if isinstance(scenario_id, str) and scenario_id:
            scenario_ids.append(scenario_id)
            prefix = f"scenario {scenario_id!r}"
        else:
            violations.append(f"{prefix} scenario_id must be a non-empty string")

        for key in sorted(REQUIRED_SCENARIO_KEYS - scenario.keys()):
            violations.append(f"{prefix} missing required key: {key}")

        for key in ("required_skill_reads", "forbidden_skill_reads"):
            if key in scenario and not isinstance(scenario[key], list):
                violations.append(f"{prefix} {key} must be an array")

        fixture_value = scenario.get("fixture")
        if not isinstance(fixture_value, str) or not fixture_value:
            violations.append(f"{prefix} fixture must be a non-empty string")
        else:
            fixture_path = (EVAL_ROOT / fixture_value).resolve()
            try:
                fixture_path.relative_to(FIXTURES_ROOT)
            except ValueError:
                violations.append(
                    f"{prefix} fixture must resolve under evals/fixtures: {fixture_value}"
                )
            else:
                if not fixture_path.exists():
                    violations.append(f"{prefix} fixture does not exist: {fixture_value}")

        referenced_configs = scenario.get("configurations")
        if not isinstance(referenced_configs, list):
            violations.append(f"{prefix} configurations must be an array")
        else:
            for name in referenced_configs:
                canonical = aliases.get(name, name) if isinstance(aliases, dict) else name
                if canonical not in configuration_names:
                    violations.append(
                        f"{prefix} references unknown configuration: {name!r}"
                    )

        for key in ("required_skill_reads", "forbidden_skill_reads"):
            values = scenario.get(key, [])
            if isinstance(values, list) and any(value not in AFYX_SKILLS for value in values):
                violations.append(f"{prefix} {key} contains an unknown skill")

        if scenario.get("stage") == "development-pilot":
            rubric = scenario.get("evaluator_rubric")
            required_gates = {"correctness", "task_fidelity", "evidence_quality", "security"}
            if not isinstance(rubric, dict) or set(rubric) != required_gates:
                violations.append(
                    f"{prefix} evaluator_rubric must define exactly {sorted(required_gates)}"
                )

    duplicates = sorted(
        scenario_id for scenario_id, count in Counter(scenario_ids).items()
        if count > 1
    )
    for scenario_id in duplicates:
        violations.append(f"duplicate scenario_id: {scenario_id!r}")


def git_ok(*args: str) -> bool | None:
    try:
        return subprocess.run(["git", "-C", str(REPO_ROOT), *args], capture_output=True).returncode == 0
    except OSError:
        return None


def validate_subject_ancestry(subject: str, violations: list[str]) -> None:
    """Best effort: needs full history, so shallow clones and non-git trees are skipped."""
    if git_ok("rev-parse", "--git-dir") is not True:
        return
    shallow = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "--is-shallow-repository"], capture_output=True, text=True
    ).stdout.strip()
    if shallow == "true":
        return
    if not git_ok("cat-file", "-e", f"{subject}^{{commit}}"):
        violations.append(f"repository.benchmark_subject_commit {subject[:12]} is not a commit in this repository")
    elif not git_ok("merge-base", "--is-ancestor", subject, "HEAD"):
        violations.append(f"repository.benchmark_subject_commit {subject[:12]} is not an ancestor of HEAD")


def validate_environment(violations: list[str]) -> None:
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        path = (EVAL_ROOT / manifest["environment"]).resolve()
        path.relative_to(EVAL_ROOT.resolve())
    except (OSError, json.JSONDecodeError, KeyError, ValueError) as error:
        violations.append(f"selected environment path is invalid: {error}")
        return
    try:
        environment = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        violations.append(f"environment.json is not readable JSON: {error}")
        return
    if environment.get("schema_version") != 3:
        violations.append(f"{path.name} schema_version must be 3")
    if "afyx_commit" in environment:
        violations.append("environment.json must not carry the ambiguous top-level afyx_commit")
    repository = environment.get("repository")
    if not isinstance(repository, dict):
        violations.append("environment.json requires a repository object")
        return
    subject = repository.get("benchmark_subject_commit")
    if not isinstance(subject, str) or not re.fullmatch(r"[0-9a-f]{40}", subject):
        violations.append("repository.benchmark_subject_commit must be a full 40-hex commit SHA")
    else:
        validate_subject_ancestry(subject, violations)
    if not repository.get("branch"):
        violations.append("repository.branch is required")
    skills = environment.get("skills")
    if not isinstance(skills, dict) or set(skills) != AFYX_SKILLS:
        violations.append(f"{path.name} must fingerprint exactly the four Afyx skills")
    runtime = environment.get("runtime")
    if not isinstance(runtime, dict):
        violations.append(f"{path.name} requires runtime details")
    else:
        for key in ("codex_cli", "model", "provider", "reasoning_effort", "runtime_flags"):
            if not runtime.get(key):
                violations.append(f"{path.name} runtime.{key} is required")
    if not isinstance(environment.get("execution"), dict):
        violations.append(f"{path.name} requires execution permissions/tooling details")


def validate_odoo_headers(violations: list[str]) -> None:
    references = sorted(ODOO_REFERENCES.glob("odoo-*.md"))
    if not references:
        violations.append(f"no Odoo version references found under {ODOO_REFERENCES}")
        return
    for path in references:
        try:
            content = path.read_text(encoding="utf-8")
        except OSError as error:
            violations.append(f"{path.name} is not readable: {error}")
            continue
        match = LAST_VERIFIED_PATTERN.search(content)
        if not match:
            violations.append(
                f"{path.name} missing parseable 'Last verified: YYYY-MM-DD' header"
            )
            continue
        value = match.group("value")
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            violations.append(f"{path.name} has invalid Last verified date: {value}")
            continue
        if parsed.isoformat() != value:
            violations.append(f"{path.name} has non-canonical Last verified date: {value}")


def main() -> int:
    violations: list[str] = []
    validate_manifest(violations)
    validate_environment(violations)
    validate_odoo_headers(violations)
    if violations:
        print(f"Static evaluation validation failed ({len(violations)} violation(s)):")
        for violation in violations:
            print(f"- {violation}")
        return 1
    print("Static evaluation validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
