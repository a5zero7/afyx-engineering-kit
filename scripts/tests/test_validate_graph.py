#!/usr/bin/env python3
"""Tests for the Afyx Graph identity/legal validator on a minimal synthetic tree.

Copies only the files the validator reads, so no build output and no network are
involved. Proves the legal files are enforced and that a locally built bundle
with a stale or incomplete layout is rejected.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts" / "validate-afyx-graph.py"

COPIED = (
    "LICENSE",
    "scripts/validate-afyx-graph.py",
    "scripts/install-afyx-graph.ps1",
    "scripts/install-afyx-graph.sh",
    "afyx-graph/afyx-graph.json",
    "afyx-graph/engine/LICENSE",
    "afyx-graph/engine/package.json",
    "afyx-graph/engine/ui/package.json",
    "afyx-graph/engine/src/product.ts",
    "afyx-graph/engine/src/bin/afyx-graph.ts",
    "afyx-graph/engine/scripts/build-bundle.sh",
    "afyx-graph/engine/scripts/deterministic-archive.mjs",
    "afyx-graph/engine/scripts/distribution-product.json",
)
BUNDLE = "afyx-graph-win32-x64"


class ValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tree = Path(self._tmp.name)
        for rel in COPIED:
            target = self.tree / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / rel, target)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def validate(self) -> subprocess.CompletedProcess[str]:
        script = self.tree / "scripts" / "validate-afyx-graph.py"
        return subprocess.run([sys.executable, str(script)], capture_output=True, text=True)

    def write_bundle(self, files: list[str]) -> None:
        release = self.tree / "afyx-graph" / "engine" / "release"
        release.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(release / f"{BUNDLE}.zip", "w") as archive:
            for name in files:
                archive.writestr(f"{BUNDLE}/{name}", "x")

    def test_synthetic_tree_passes(self) -> None:
        result = self.validate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_bundle_with_current_license_passes(self) -> None:
        self.write_bundle(["metadata.json", "LICENSE"])
        self.assertEqual(self.validate().returncode, 0)

    def test_bundle_missing_current_license_is_rejected(self) -> None:
        self.write_bundle(["metadata.json"])
        result = self.validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("root-level LICENSE", result.stdout + result.stderr)

    def test_bundle_with_stale_historical_payload_is_rejected(self) -> None:
        self.write_bundle(["metadata.json", "LICENSE", "licenses/THIRD_PARTY_ENGINE_MIT.txt"])
        result = self.validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("obsolete or unexplained legal payload", result.stdout + result.stderr)

    def test_reintroduced_old_source_notice_is_rejected(self) -> None:
        path = self.tree / "afyx-graph" / "THIRD_PARTY_NOTICES.md"
        path.write_text("historical notice", encoding="utf-8")
        self.assertNotEqual(self.validate().returncode, 0)

    def test_reintroduced_old_source_license_is_rejected(self) -> None:
        path = self.tree / "afyx-graph" / "LICENSES" / "THIRD_PARTY_ENGINE_MIT.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("historical license", encoding="utf-8")
        self.assertNotEqual(self.validate().returncode, 0)

    def test_changed_engine_license_is_rejected(self) -> None:
        path = self.tree / "afyx-graph" / "engine" / "LICENSE"
        path.write_text(path.read_text(encoding="utf-8").replace("Copyright (c) 2026 Afyx", "Copyright (c) 2026 Elsewhere"), encoding="utf-8")
        self.assertNotEqual(self.validate().returncode, 0)

    def test_installer_that_stops_requiring_license_is_rejected(self) -> None:
        path = self.tree / "scripts" / "install-afyx-graph.sh"
        path.write_text(path.read_text(encoding="utf-8").replace("metadata.json LICENSE", "metadata.json"), encoding="utf-8")
        self.assertNotEqual(self.validate().returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
