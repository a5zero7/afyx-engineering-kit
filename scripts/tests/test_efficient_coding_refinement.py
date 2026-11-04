#!/usr/bin/env python3
"""Deterministic AFYX-261 baseline/candidate contract matrix; no model or network."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / "scripts" / "tests" / "fixtures" / "legacy-efficient-coding-1.1.0"
CANDIDATE = ROOT / "skills" / "efficient-coding"


def corpus(root: Path) -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in sorted(root.rglob("*.md"))).lower()


CASES = {
    "known-file-grounding": (("known target",), ("observable problem",), ("impact",), ("validation",)),
    "unknown-defect-reproduction": (("unknown target",), ("reliable failure signal",), ("stopping rule",)),
    "cross-module-graph": (("cross-cutting",), ("afyx graph",), ("cross-module impact",)),
    "unavailable-graph-fallback": (("afyx graph",), ("missing",), ("stale",), ("direct reads", "direct source")),
    "authorization-boundary": (("existing explicit user authorization",), ("destructive operations",), ("public api",), ("scope expansion",)),
    "proportional-reporting": (("concise by default",), ("task complexity",), ("exact original evidence",)),
}


def covered(text: str) -> set[str]:
    return {
        name
        for name, requirements in CASES.items()
        if all(any(option in text for option in alternatives) for alternatives in requirements)
    }


class EfficientCodingRefinementTests(unittest.TestCase):
    def test_equivalent_six_case_matrix(self) -> None:
        baseline, candidate = corpus(BASELINE), corpus(CANDIDATE)
        self.assertEqual(
            covered(baseline),
            {"cross-module-graph", "unavailable-graph-fallback"},
        )
        self.assertEqual(covered(candidate), set(CASES))

    def test_cost_tool_and_version_contract(self) -> None:
        text = corpus(CANDIDATE)
        for anchor in ("n+1", "memory", "i/o", "concurrency", "afyx-first", "external fallback"):
            self.assertIn(anchor, text)
        self.assertRegex((CANDIDATE / "SKILL.md").read_text(encoding="utf-8"), r'(?m)^\s+version: "1\.2\.1"$')

    def test_rejected_rigid_suggestions_are_absent(self) -> None:
        text = corpus(CANDIDATE)
        self.assertIsNone(re.search(r"\b(three|3)[ -]search", text))
        self.assertIsNone(re.search(r"\b(six|6)[ -]line", text))


if __name__ == "__main__":
    baseline, candidate = corpus(BASELINE), corpus(CANDIDATE)
    print(f"AFYX-261 matrix: baseline={len(covered(baseline))}/6 FULL candidate={len(covered(candidate))}/6 FULL")
    unittest.main(verbosity=2)
