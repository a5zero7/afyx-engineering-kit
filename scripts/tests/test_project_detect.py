#!/usr/bin/env python3
"""Deterministic tests for the zero-model project detector (PowerShell and Bash).

Every case builds a throwaway project tree, runs both implementations, and checks
the result against the expected outcome and against each other. No network, no
model, no real project touched.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PS_SCRIPT = ROOT / "scripts" / "afyx-project.ps1"
SH_SCRIPT = ROOT / "scripts" / "afyx-project.sh"


def write(base: Path, relative: str, text: str) -> None:
    target = base / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def manifest(version: str) -> str:
    return "{'name': 'Fixture', 'version': '%s', 'depends': ['base']}\n" % version


def run_bash(project: Path, *extra: str) -> dict:
    bash = shutil.which("bash")
    if not bash:
        return {}
    out = subprocess.run([bash, str(SH_SCRIPT), "--path", project.as_posix(), *extra], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def run_pwsh(project: Path, *extra: str) -> dict:
    pwsh = shutil.which("pwsh") or shutil.which("powershell")
    if not pwsh:
        return {}
    out = subprocess.run([pwsh, "-NoProfile", "-NonInteractive", "-File", str(PS_SCRIPT), "-Path", str(project), *extra], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def normalise(result: dict) -> dict:
    result = json.loads(json.dumps(result))
    result.pop("project_root", None)  # path spelling differs per shell (C:\ vs /c/)
    return result


class ProjectDetectTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.project = Path(self._tmp.name) / "project"
        self.project.mkdir()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def detect(self, *extra: str) -> dict:
        results = {"bash": run_bash(self.project, *extra), "pwsh": run_pwsh(self.project, *extra)}
        active = {name: value for name, value in results.items() if value}
        self.assertTrue(active, "neither bash nor PowerShell is available")
        normalised = {name: normalise(value) for name, value in active.items()}
        if len(normalised) == 2:
            self.assertEqual(normalised["bash"], normalised["pwsh"], "bash and PowerShell disagree")
        first = next(iter(active.values()))
        self.assertEqual(Path(first["project_root"]).name, "project")
        return normalise(first)

    def test_empty_directory_is_unknown(self) -> None:
        result = self.detect()
        self.assertEqual(result["project_type"], "unknown")
        self.assertFalse(result["odoo"]["detected"])
        self.assertEqual(result["odoo"]["version_status"], "unknown")
        self.assertIsNone(result["odoo"]["major_version"])

    def test_non_odoo_python_project(self) -> None:
        write(self.project, "pyproject.toml", "[project]\nname = 'x'\n")
        result = self.detect()
        self.assertEqual(result["project_type"], "python")
        self.assertFalse(result["odoo"]["detected"])

    def test_release_py_proves_the_version(self) -> None:
        write(self.project, "odoo/release.py", "version_info = (17, 0, 0, FINAL, 0, '')\n")
        write(self.project, "addons/sale_x/__manifest__.py", manifest("17.0.1.0.0"))
        result = self.detect()
        self.assertEqual(result["root_evidence"], "odoo-source")
        self.assertEqual(result["project_type"], "odoo")
        self.assertEqual((result["odoo"]["major_version"], result["odoo"]["version_status"]), (17, "proven"))
        self.assertEqual([e["source"] for e in result["odoo"]["evidence"]], ["odoo/release.py", "__manifest__.py"])
        self.assertEqual(result["odoo"]["addon_roots"], ["addons"])

    def test_saas_release_uses_the_series_number(self) -> None:
        write(self.project, "odoo/release.py", "version_info = ('saas~16', 3, 0, FINAL, 0, '')\n")
        self.assertEqual(self.detect()["odoo"]["major_version"], 16)

    def test_strong_evidence_wins_but_weak_disagreement_is_reported(self) -> None:
        write(self.project, "odoo/release.py", "version_info = (18, 0, 0, FINAL, 0, '')\n")
        write(self.project, "custom_addons/legacy/__manifest__.py", manifest("17.0.1.0.0"))
        result = self.detect()
        self.assertEqual((result["odoo"]["major_version"], result["odoo"]["version_status"]), (18, "proven"))
        self.assertEqual(result["odoo"]["conflicts"], [{"source": "__manifest__.py", "major": 17}])

    def test_weak_only_evidence_is_inferred(self) -> None:
        write(self.project, "custom_addons/a/__manifest__.py", manifest("16.0.1.0.0"))
        write(self.project, "custom_addons/b/__manifest__.py", manifest("16.0.2.1.0"))
        write(self.project, "docker-compose.yml", "services:\n  odoo:\n    image: odoo:16.0\n")
        result = self.detect()
        self.assertEqual((result["odoo"]["major_version"], result["odoo"]["version_status"]), (16, "inferred"))
        self.assertEqual(result["odoo"]["addon_roots"], ["custom_addons"])
        manifests = [e for e in result["odoo"]["evidence"] if e["source"] == "__manifest__.py"]
        self.assertEqual(manifests[0]["count"], 2)

    def test_conflicting_weak_evidence_is_not_guessed(self) -> None:
        write(self.project, "addons/a/__manifest__.py", manifest("15.0.1.0.0"))
        write(self.project, "addons/b/__manifest__.py", manifest("16.0.1.0.0"))
        result = self.detect()
        self.assertEqual(result["odoo"]["version_status"], "conflict")
        self.assertIsNone(result["odoo"]["major_version"])

    def test_conflicting_strong_evidence_is_not_guessed(self) -> None:
        write(self.project, "odoo/release.py", "version_info = (17, 0, 0, FINAL, 0, '')\n")
        write(self.project, "odoo.egg-info/PKG-INFO", "Metadata-Version: 2.1\nName: odoo\nVersion: 16.0\n")
        result = self.detect()
        self.assertEqual(result["odoo"]["version_status"], "conflict")
        self.assertIsNone(result["odoo"]["major_version"])

    def test_requirements_pin_is_weak_evidence(self) -> None:
        write(self.project, "requirements.txt", "odoo==14.0\nrequests\n")
        write(self.project, "addons/m/__manifest__.py", manifest("1.0"))  # no series prefix: ignored
        result = self.detect()
        self.assertEqual((result["odoo"]["major_version"], result["odoo"]["version_status"]), (14, "inferred"))

    def test_unsupported_series_is_flagged_not_reinterpreted(self) -> None:
        write(self.project, "odoo/release.py", "version_info = (9, 0, 0, FINAL, 0, '')\n")
        result = self.detect()
        self.assertEqual(result["odoo"]["version_status"], "unsupported")

    def test_git_branch_is_weak_evidence(self) -> None:
        if not shutil.which("git"):
            self.skipTest("git not available")
        subprocess.run(["git", "init", "-q", "-b", "17.0-feature", str(self.project)], check=True)
        write(self.project, "addons/m/__manifest__.py", manifest("17.0.1.0.0"))
        result = self.detect()
        self.assertEqual(result["root_evidence"], ".git")
        sources = {e["source"] for e in result["odoo"]["evidence"]}
        self.assertEqual(sources, {"git branch", "__manifest__.py"})
        self.assertEqual((result["odoo"]["major_version"], result["odoo"]["version_status"]), (17, "inferred"))

    def test_cache_is_a_hint_and_never_overrides_evidence(self) -> None:
        write(self.project, "odoo/release.py", "version_info = (17, 0, 0, FINAL, 0, '')\n")
        write(self.project, ".afyx/project.json", '{"odoo_major": 14}\n')
        result = self.detect()
        self.assertEqual(result["odoo"]["major_version"], 17)
        self.assertEqual(result["cache"], {"path": ".afyx/project.json", "present": True, "hint_major": 14, "agrees": False})

    def test_detection_writes_nothing_by_default(self) -> None:
        write(self.project, "odoo/release.py", "version_info = (17, 0, 0, FINAL, 0, '')\n")
        before = sorted(p.relative_to(self.project).as_posix() for p in self.project.rglob("*"))
        self.detect()
        after = sorted(p.relative_to(self.project).as_posix() for p in self.project.rglob("*"))
        self.assertEqual(before, after)

    def test_manifest_traversal_respects_the_depth_cap(self) -> None:
        write(self.project, "deep/one/two/three/four/module/__manifest__.py", manifest("17.0.1.0.0"))
        result = self.detect()
        self.assertFalse(result["odoo"]["detected"])
        self.assertEqual(result["odoo"]["addon_roots"], [])

    def test_cache_is_only_written_on_explicit_request(self) -> None:
        write(self.project, "odoo/release.py", "version_info = (17, 0, 0, FINAL, 0, '')\n")
        if shutil.which("bash"):
            subprocess.run([shutil.which("bash"), str(SH_SCRIPT), "--path", self.project.as_posix(), "--write-cache"], check=True, capture_output=True)
            cache = json.loads((self.project / ".afyx" / "project.json").read_text(encoding="utf-8"))
            self.assertEqual(cache["odoo_major"], 17)


if __name__ == "__main__":
    unittest.main(verbosity=2)
