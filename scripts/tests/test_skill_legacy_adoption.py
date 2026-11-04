#!/usr/bin/env python3
"""AFYX-264 legacy adoption tests use disposable skill and backup roots only."""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WINDOWS = os.name == "nt"


def lifecycle_shell() -> str | None:
    if WINDOWS:
        return shutil.which("pwsh") or shutil.which("powershell")
    return shutil.which("bash") or "/bin/bash"


class LegacySkillAdoptionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.skills = self.base / "skills"
        self.backups = self.base / "backups"
        self.fake_bin = self.base / "fake-bin"
        self.fake_bin.mkdir()
        self.shell = lifecycle_shell()
        if not self.shell:
            self.skipTest("host lifecycle shell unavailable")
        self.env = os.environ.copy()
        self.env.update(
            {
                "HOME": str(self.base),
                "USERPROFILE": str(self.base),
                "CODEX_HOME": str(self.base / "codex"),
                "AFYX_GRAPH_RUNTIME_ROOT": str(self.base / "graph"),
                "AFYX_GRAPH_BIN_DIR": str(self.base / "bin"),
                "AFYX_BACKUP_ROOT": str(self.backups),
                "CI": "1",
            }
        )
        if WINDOWS:
            (self.fake_bin / "codex.cmd").write_text("@echo codex-test\r\n", encoding="utf-8")
        else:
            codex = self.fake_bin / "codex"
            codex.write_text("#!/bin/sh\necho codex-test\n", encoding="utf-8")
            codex.chmod(codex.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        self.env["PATH"] = str(self.fake_bin) + os.pathsep + self.env.get("PATH", "")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_legacy_fixture_line_endings_are_pinned_for_exact_provenance(self) -> None:
        attributes = subprocess.run(
            [
                "git", "check-attr", "eol", "--",
                "scripts/tests/fixtures/legacy-efficient-coding-1.1.0/SKILL.md",
                "scripts/tests/fixtures/legacy-odoo-engineering-1.1.0/SKILL.md",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        self.assertEqual(attributes.count("eol: lf"), 2, attributes)
        for fixture in ("efficient-coding", "odoo-engineering"):
            files = (ROOT / "scripts" / "tests" / "fixtures" / f"legacy-{fixture}-1.1.0").rglob("*")
            self.assertTrue(all(b"\r\n" not in path.read_bytes() for path in files if path.is_file()))

    def run_install(self, component: str, action: str, *, dry_run: bool = False, expected: int = 0) -> subprocess.CompletedProcess[str]:
        if WINDOWS:
            command = [
                self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                "-SkillsRoot", str(self.skills), "-ComponentAction", f"{component}={action}",
                "-SkipUsageTracker", "-SkipGraphMcp",
            ]
            if dry_run:
                command.append("-WhatIf")
        else:
            command = [
                self.shell, str(ROOT / "install.sh"), "--skills-root", str(self.skills),
                "--component", f"{component}={action}", "--skip-graph-mcp",
            ]
            if dry_run:
                command.append("--dry-run")
        result = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    @staticmethod
    def content_snapshot(target: Path) -> dict[str, bytes]:
        return {
            path.relative_to(target).as_posix(): path.read_bytes()
            for path in sorted(target.rglob("*"))
            if path.is_file() and path.name != ".afyx-install.json" and ".git" not in path.parts
        }

    def copy_legacy(self, component: str) -> Path:
        target = self.skills / component
        target.parent.mkdir(parents=True, exist_ok=True)
        source = (
            ROOT / "scripts" / "tests" / "fixtures" / f"legacy-{component}-1.1.0"
            if component in {"efficient-coding", "odoo-engineering"}
            else ROOT / "skills" / component
        )
        shutil.copytree(source, target)
        return target

    def test_matching_afyx_skills_dry_run_adopt_and_repeat(self) -> None:
        for component in ("efficient-coding", "odoo-engineering"):
            with self.subTest(component=component):
                target = self.copy_legacy(component)
                before = self.content_snapshot(target)
                preview = self.run_install(component, "adopt", dry_run=True)
                self.assertIn("planned adoption", (preview.stdout + preview.stderr).lower())
                self.assertFalse((target / ".afyx-install.json").exists())
                self.assertFalse((self.backups / component).exists())

                adopted = self.run_install(component, "adopt")
                self.assertIn("ADOPTED", adopted.stdout + adopted.stderr)
                marker = json.loads((target / ".afyx-install.json").read_text(encoding="utf-8"))
                self.assertEqual((marker["component"], marker["owner"], marker["version"]), (component, "afyx", "1.1.0"))
                self.assertEqual(self.content_snapshot(target), before)
                backups = list((self.backups / component).iterdir())
                self.assertEqual(len(backups), 1)
                self.assertFalse((backups[0] / ".afyx-install.json").exists())
                self.assertEqual(self.content_snapshot(backups[0]), before)

                repeated = self.run_install(component, "adopt")
                self.assertIn("already adopted", (repeated.stdout + repeated.stderr).lower())
                self.assertEqual(len(list((self.backups / component).iterdir())), 1)
                shutil.rmtree(target)

    def test_modified_foreign_and_backup_failure_are_refused(self) -> None:
        modified = self.copy_legacy("efficient-coding")
        skill = modified / "SKILL.md"
        skill.write_text(skill.read_text(encoding="utf-8") + "\nuser change\n", encoding="utf-8")
        result = self.run_install("efficient-coding", "adopt", expected=1)
        self.assertIn("MODIFIED", result.stdout + result.stderr)
        self.assertFalse((modified / ".afyx-install.json").exists())
        shutil.rmtree(modified)

        foreign = self.skills / "efficient-coding"
        foreign.mkdir(parents=True)
        (foreign / "SKILL.md").write_text("---\nname: foreign-skill\nmetadata:\n  version: \"1.1.0\"\n---\n", encoding="utf-8")
        result = self.run_install("efficient-coding", "adopt", expected=1)
        self.assertIn("FOREIGN", result.stdout + result.stderr)
        self.assertFalse((foreign / ".afyx-install.json").exists())
        shutil.rmtree(foreign)

        target = self.copy_legacy("efficient-coding")
        self.backups.write_text("backup root blocked", encoding="utf-8")
        self.run_install("efficient-coding", "adopt", expected=1)
        self.assertFalse((target / ".afyx-install.json").exists())

    def test_unsafe_target_is_refused(self) -> None:
        destination = self.base / "foreign-destination"
        shutil.copytree(ROOT / "skills" / "efficient-coding", destination)
        self.skills.mkdir()
        target = self.skills / "efficient-coding"
        try:
            target.symlink_to(destination, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symlink creation unavailable: {error}")
        self.run_install("efficient-coding", "adopt", expected=1)
        self.assertFalse((destination / ".afyx-install.json").exists())

    def test_upstream_requires_exact_clean_origin_and_revision(self) -> None:
        target = self.skills / "prompt-master"
        target.mkdir(parents=True)
        (target / "SKILL.md").write_text("---\nname: prompt-master\nversion: 1.8.0\n---\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(target), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(target), "config", "user.email", "fixture@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(target), "config", "user.name", "Fixture"], check=True)
        repository = "https://example.invalid/prompt-master.git"
        subprocess.run(["git", "-C", str(target), "remote", "add", "origin", repository], check=True)
        subprocess.run(["git", "-C", str(target), "add", "SKILL.md"], check=True)
        subprocess.run(["git", "-C", str(target), "commit", "-q", "-m", "fixture"], check=True)
        revision = subprocess.check_output(["git", "-C", str(target), "rev-parse", "HEAD"], text=True).strip()

        self.env.update(
            {
                "AFYX_TEST_ROOT": str(ROOT),
                "AFYX_TEST_SKILLS": str(self.skills),
                "AFYX_TEST_TARGET": str(target),
                "AFYX_TEST_REPOSITORY": repository,
                "AFYX_TEST_REVISION": revision,
            }
        )
        self.assertEqual(self.provenance("https://wrong.example/prompt-master.git", revision), "FOREIGN")
        original = (target / "SKILL.md").read_text(encoding="utf-8")
        (target / "SKILL.md").write_text(original + "dirty\n", encoding="utf-8")
        self.assertEqual(self.provenance(repository, revision), "MODIFIED")
        (target / "SKILL.md").write_text(original, encoding="utf-8")
        self.assertEqual(self.provenance(repository, "0" * 40), "UNKNOWN")

        adopted = self.adopt_upstream()
        self.assertIn("ADOPTED", adopted.stdout + adopted.stderr)
        marker = json.loads((target / ".afyx-install.json").read_text(encoding="utf-8"))
        self.assertEqual((marker["owner"], marker["source_repository"], marker["source_revision"]), ("upstream", repository, revision))
        self.assertEqual(subprocess.check_output(["git", "-C", str(target), "status", "--porcelain"], text=True).strip(), "")
        repeated = self.adopt_upstream()
        self.assertIn("ALREADY_ADOPTED", repeated.stdout + repeated.stderr)
        self.assertEqual(len(list((self.backups / "prompt-master").iterdir())), 1)

    def provenance(self, repository: str, revision: str) -> str:
        env = {**self.env, "AFYX_TEST_EXPECTED_REPOSITORY": repository, "AFYX_TEST_EXPECTED_REVISION": revision}
        if WINDOWS:
            script = (
                "Import-Module (Join-Path $env:AFYX_TEST_ROOT 'scripts/lib/AfyxSkillLifecycle.psm1') -Force -DisableNameChecking; "
                "Get-AfyxLegacySkillProvenance -Target $env:AFYX_TEST_TARGET -Component prompt-master -Owner upstream "
                "-SourceRepository $env:AFYX_TEST_EXPECTED_REPOSITORY -SourceRevision $env:AFYX_TEST_EXPECTED_REVISION"
            )
            command = [self.shell, "-NoProfile", "-NonInteractive", "-Command", script]
        else:
            script = (
                'source "$AFYX_TEST_ROOT/scripts/lib/afyx-skill-lifecycle.sh"; '
                'afyx_legacy_skill_provenance "$AFYX_TEST_TARGET" prompt-master upstream "" "" '
                '"$AFYX_TEST_EXPECTED_REPOSITORY" "$AFYX_TEST_EXPECTED_REVISION"; printf "%s" "$AFYX_LEGACY_PROVENANCE"'
            )
            command = [self.shell, "-c", script]
        return subprocess.check_output(command, cwd=ROOT, env=env, text=True).strip()

    def adopt_upstream(self) -> subprocess.CompletedProcess[str]:
        if WINDOWS:
            script = (
                "Import-Module (Join-Path $env:AFYX_TEST_ROOT 'scripts/lib/AfyxSkillLifecycle.psm1') -Force -DisableNameChecking; "
                "Adopt-AfyxLegacySkill -SkillsRoot $env:AFYX_TEST_SKILLS -Target $env:AFYX_TEST_TARGET "
                "-Component prompt-master -Owner upstream -Version 1.8.0 "
                "-SourceRepository $env:AFYX_TEST_REPOSITORY -SourceRevision $env:AFYX_TEST_REVISION"
            )
            command = [self.shell, "-NoProfile", "-NonInteractive", "-Command", script]
        else:
            script = (
                'source "$AFYX_TEST_ROOT/scripts/lib/afyx-skill-lifecycle.sh"; '
                'skills_root="$AFYX_TEST_SKILLS"; afyx_backup_root="$AFYX_BACKUP_ROOT"; '
                'afyx_adopt_legacy_skill prompt-master "$AFYX_TEST_TARGET" upstream 1.8.0 "" "" '
                '"$AFYX_TEST_REPOSITORY" "$AFYX_TEST_REVISION"'
            )
            command = [self.shell, "-c", script]
        result = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result


if __name__ == "__main__":
    unittest.main(verbosity=2)
