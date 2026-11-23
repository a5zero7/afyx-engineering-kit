#!/usr/bin/env python3
"""Tests for the legacy identity audit and its bounded evidence classifications."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / "scripts" / "audit-legacy-identity.py"

# Neutral fragments: the forbidden identity is never spelled out in this file.
PRODUCT = "code" + "graph"
HANDLE = "colby" + "mchenry"


def run_audit(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(AUDIT), "--root", str(root)], capture_output=True, text=True)


class AuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def write(self, rel: str, text: str) -> None:
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def test_this_repository_is_clean(self) -> None:
        result = run_audit(ROOT)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("PASS", result.stdout)

    def test_clean_tree_passes(self) -> None:
        self.write("src/app.ts", "export const name = 'afyx-graph';\n")
        self.assertEqual(run_audit(self.repo).returncode, 0)

    def test_obsolete_product_notice_is_not_exempt(self) -> None:
        self.write(
            "afyx-graph/THIRD_PARTY_NOTICES.md",
            f"Portions of Afyx Graph incorporate historical {PRODUCT} software.\n",
        )
        result = run_audit(self.repo)
        self.assertEqual(result.returncode, 1)
        self.assertIn("afyx-graph/THIRD_PARTY_NOTICES.md", result.stdout)

    def test_historical_evidence_is_classified(self) -> None:
        self.write("docs/AFYX_INDEPENDENCE_PLAN.md", f"Historical ancestor: {PRODUCT}.\n")
        result = run_audit(self.repo)
        self.assertEqual(result.returncode, 0)
        self.assertIn("HISTORICAL_EVIDENCE=1", result.stdout)

    def test_source_reference_fails_and_is_redacted(self) -> None:
        self.write("src/app.ts", f"const legacy = '{PRODUCT}';\n")
        result = run_audit(self.repo)
        self.assertEqual(result.returncode, 1)
        self.assertIn("src/app.ts:1", result.stdout)
        self.assertNotIn(PRODUCT, result.stdout.lower())

    def test_active_files_are_not_exempt(self) -> None:
        for rel in ("README.md", "scripts/audit-legacy-identity.py", "src/runtime.ts"):
            with self.subTest(rel=rel):
                self.write(rel, f"{PRODUCT}\n")
                self.assertEqual(run_audit(self.repo).returncode, 1)
                (self.repo / rel).unlink()

    def test_every_case_and_upstream_host_is_caught(self) -> None:
        variants = [
            PRODUCT.capitalize(),
            PRODUCT.upper() + "_DIR",
            f"github.com/{HANDLE}/x",
            f"https://get{PRODUCT}.com",
        ]
        for index, text in enumerate(variants):
            with self.subTest(index=index):
                self.write(f"docs/f{index}.md", text + "\n")
                self.assertEqual(run_audit(self.repo).returncode, 1)
                (self.repo / f"docs/f{index}.md").unlink()

    def test_legacy_file_name_fails_even_with_clean_content(self) -> None:
        self.write(f"assets/{PRODUCT}-logo.txt", "harmless\n")
        result = run_audit(self.repo)
        self.assertEqual(result.returncode, 1)
        self.assertIn("file name", result.stdout)

    def test_external_index_directory_is_classified(self) -> None:
        (self.repo / f".{PRODUCT}").mkdir()
        result = run_audit(self.repo)
        self.assertEqual(result.returncode, 0)
        self.assertIn("EXTERNAL_EXCEPTION=1", result.stdout)

    def test_nested_legacy_directory_name_fails_even_when_empty(self) -> None:
        (self.repo / "src" / f".{PRODUCT}").mkdir(parents=True)
        result = run_audit(self.repo)
        self.assertEqual(result.returncode, 1)
        self.assertIn("directory name", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
