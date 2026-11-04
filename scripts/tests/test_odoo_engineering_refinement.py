#!/usr/bin/env python3
"""Deterministic AFYX-262 baseline/candidate contract matrix; no model or network."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / "scripts" / "tests" / "fixtures" / "legacy-odoo-engineering-1.1.0"
CANDIDATE = ROOT / "skills" / "odoo-engineering"


def corpus(root: Path) -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in sorted(root.rglob("*.md"))).lower()


CASES = {
    "odoo-10-legacy-boundary": (("odoo 10",), ("legacy boundary",), ("multi()",), ("do not backport owl",)),
    "odoo-17-multirecord-orm": (("_inherit",), ("super",), ("multi-record",), ("n+1",)),
    "odoo-19-security-boundary": (
        ("ui visibility is not security",),
        ("group implications",),
        ("sudo` is an explicit privilege boundary",),
    ),
    "odoo-20-exact-evidence": (("exact 20.0",), ("do not carry odoo 19",), ("infer replacement apis",)),
    "conflict-and-migration-isolation": (
        ("two independent supporting signals",),
        ("keep the version unresolved",),
        ("source and target versions separately",),
    ),
    "xml-and-authorization-negative": (
        ("external id",),
        ("parent view",),
        ("xpath target",),
        ("priority",),
        ("module dependency",),
        ("ui visibility is not security",),
    ),
}


def covered(text: str) -> set[str]:
    return {
        name
        for name, requirements in CASES.items()
        if all(any(option in text for option in alternatives) for alternatives in requirements)
    }


class OdooEngineeringRefinementTests(unittest.TestCase):
    def test_equivalent_six_case_matrix(self) -> None:
        baseline, candidate = corpus(BASELINE), corpus(CANDIDATE)
        self.assertEqual(
            covered(baseline),
            {"odoo-10-legacy-boundary", "odoo-20-exact-evidence", "xml-and-authorization-negative"},
        )
        self.assertEqual(covered(candidate), set(CASES))

    def test_progressive_disclosure_version_and_data_safety(self) -> None:
        text = corpus(CANDIDATE)
        for anchor in (
            "simple explanation",
            "avoid heavyweight investigation",
            "persisted technical identifiers",
            "display-label change alone is not authorization",
        ):
            self.assertIn(anchor, text)
        self.assertRegex((CANDIDATE / "SKILL.md").read_text(encoding="utf-8"), r'(?m)^\s+version: "1\.2\.0"$')

    def test_no_unjustified_major_or_blanket_reference_rewrite(self) -> None:
        manifest = (CANDIDATE / "SKILL.md").read_text(encoding="utf-8")
        self.assertNotRegex(manifest, r'(?m)^\s+version: "2\.')
        self.assertEqual(len(list((CANDIDATE / "references").glob("odoo-*.md"))), 11)


if __name__ == "__main__":
    baseline, candidate = corpus(BASELINE), corpus(CANDIDATE)
    print(f"AFYX-262 matrix: baseline={len(covered(baseline))}/6 FULL candidate={len(covered(candidate))}/6 FULL")
    unittest.main(verbosity=2)
