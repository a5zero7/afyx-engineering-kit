#!/usr/bin/env python3
"""Mutation tests proving the zero-token routing guard is not vacuous.

Each test breaks the routing model, a fixture, or a skill description in one
specific way and asserts the guard notices. Deterministic; no model, no network.
"""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals" / "harness"))

import routing  # noqa: E402


class RoutingGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.router = routing.load(routing.ROUTER_PATH)
        self.cases = routing.load(routing.CASES_PATH)

    def failures(self, router: dict, cases: dict) -> list[str]:
        signals = routing.compile_signals(router)
        found = routing.static_checks(router, cases)
        for case in cases["cases"]:
            found += [f"{case['id']}: {problem}" for problem in routing.check_case(router, case, signals)]
        return found

    def test_shipped_fixtures_pass(self) -> None:
        self.assertEqual(self.failures(self.router, self.cases), [])

    def test_required_scenarios_route_as_specified(self) -> None:
        expected = {
            "Fix the failing test in calculator.py": {"efficient-coding"},
            "Fix record rule Odoo 17": {"efficient-coding", "odoo-engineering"},
            "Write a prompt for Claude that summarizes legal contracts": {"prompt-master"},
            "Write a prompt that asks an LLM to review Odoo 17 record rules": {"prompt-master", "odoo-engineering"},
            "Run product discovery and design the system architecture for a multi-tenant approval platform": {"afyx-engineering-expert"},
            "Review an Odoo transactional workflow that creates multi-vendor RFQs from an approved Purchase Request, including quantity limits, company permissions, duplicate operations and concurrency. Advisory only; do not edit the repository.": {"afyx-engineering-expert", "odoo-engineering"},
            "Add a computed field to res.partner in Odoo 16": {"efficient-coding", "odoo-engineering"},
            "Review the database reliability architecture and migration strategy for a multi-region service": {"afyx-engineering-expert"},
            "What is the capital of France?": set(),
        }
        for prompt, skills in expected.items():
            self.assertEqual(routing.route(self.router, prompt), skills, prompt)

    def test_routing_is_deterministic(self) -> None:
        for case in self.cases["cases"]:
            self.assertEqual(routing.route(self.router, case["prompt"]), routing.route(self.router, case["prompt"]))

    def test_wrong_expectation_is_caught(self) -> None:
        cases = copy.deepcopy(self.cases)
        cases["cases"][0]["required"] = ["prompt-master"]
        self.assertTrue(any(cases["cases"][0]["id"] in failure for failure in self.failures(self.router, cases)))

    def test_dropping_prompt_suppression_is_caught(self) -> None:
        router = copy.deepcopy(self.router)
        for rule in router["rules"]:
            if rule["skill"] == "efficient-coding":
                rule["when"] = "coding"
        failed = self.failures(router, self.cases)
        self.assertTrue(any("prompt-claude-summary" in item or "odoo-prompt-record-rules" in item or "prompt-for-coding-agent" in item for item in failed), failed)

    def test_dropping_odoo_gating_is_caught(self) -> None:
        router = copy.deepcopy(self.router)
        for rule in router["rules"]:
            if rule["skill"] == "odoo-engineering":
                rule["when"] = "odoo_domain"
        self.assertTrue(any("conversation-odoo-what-is" in item for item in self.failures(router, self.cases)))

    def test_expanding_expert_to_ordinary_coding_is_caught(self) -> None:
        router = copy.deepcopy(self.router)
        for rule in router["rules"]:
            if rule["skill"] == "afyx-engineering-expert":
                rule["when"] = "expert_domain or coding"
        failed = self.failures(router, self.cases)
        self.assertTrue(any("expert-ordinary-debugging" in item for item in failed), failed)

    def test_expert_candidate_preserves_bounded_odoo_composition_contract(self) -> None:
        description = routing.description_of(
            "afyx-engineering-expert", self.router["skills"]["afyx-engineering-expert"]
        ).lower()
        self.assertIn("cross-disciplinary odoo/erp", description)
        self.assertIn("narrow odoo implementation questions", description)
        body = (ROOT / "skills" / "afyx-engineering-expert" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("Expert owns problem framing, process invariants", body)
        self.assertIn("Odoo Engineering for release-specific ORM", body)
        self.assertIn("one primary Expert domain and at most two supporting domains", body)
        self.assertIn("Do not duplicate its version references", body)

    def test_efficient_coding_losing_its_prompt_exclusion_is_caught(self) -> None:
        original = routing.description_of

        def patched(skill: str, spec: dict) -> str:
            text = original(skill, spec)
            return text.replace("prompt writing", "prose") if skill == "efficient-coding" else text

        routing.description_of = patched
        try:
            failed = routing.static_checks(self.router, self.cases)
        finally:
            routing.description_of = original
        self.assertTrue(any("efficient-coding" in item for item in failed), failed)

    def test_description_collision_is_caught(self) -> None:
        original = routing.description_of
        routing.description_of = lambda skill, spec: "Quality-first workflow for software implementation debugging refactoring investigation prompt writing coding tasks Odoo"
        try:
            failed = routing.static_checks(self.router, self.cases)
        finally:
            routing.description_of = original
        self.assertTrue(any("description collision" in item for item in failed), failed)

    def test_missing_scenario_coverage_is_caught(self) -> None:
        cases = copy.deepcopy(self.cases)
        cases["cases"] = [case for case in cases["cases"] if case["scenario"] != "odoo-prompt-authoring"]
        self.assertTrue(any("odoo-prompt-authoring" in item for item in routing.static_checks(self.router, cases)))

    def test_unknown_skill_and_contradiction_are_caught(self) -> None:
        cases = copy.deepcopy(self.cases)
        cases["cases"][0]["required"] = ["does-not-exist"]
        cases["cases"][1]["allowed"] = ["efficient-coding"]
        cases["cases"][1]["forbidden"] = ["efficient-coding"]
        failed = routing.static_checks(self.router, cases)
        self.assertTrue(any("unknown skill" in item for item in failed), failed)
        self.assertTrue(any("both wanted and forbidden" in item for item in failed), failed)

    def test_rule_language_rejects_unknown_terms(self) -> None:
        with self.assertRaises(ValueError):
            routing.evaluate_rule("coding and __import__", {"coding": True})


if __name__ == "__main__":
    unittest.main(verbosity=2)
