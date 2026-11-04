#!/usr/bin/env python3
"""Ownership and transaction tests use disposable roots only."""

from __future__ import annotations

import hashlib
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


class SkillLifecycleSecurityTests(unittest.TestCase):
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

    def run_install(self, action: str, expected: int = 0) -> subprocess.CompletedProcess[str]:
        if WINDOWS:
            command = [
                self.shell,
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(ROOT / "install.ps1"),
                "-SkillsRoot",
                str(self.skills),
                "-ComponentAction",
                f"efficient-coding={action}",
                "-SkipUsageTracker",
                "-SkipGraphMcp",
            ]
        else:
            command = [
                self.shell,
                str(ROOT / "install.sh"),
                "--skills-root",
                str(self.skills),
                "--component",
                f"efficient-coding={action}",
                "--skip-graph-mcp",
            ]
        result = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def run_uninstall(self, expected: int = 0) -> subprocess.CompletedProcess[str]:
        if WINDOWS:
            command = [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "uninstall.ps1"), "-SkillsRoot", str(self.skills), "-Confirm:$false"]
        else:
            command = [self.shell, str(ROOT / "uninstall.sh"), "--skills-root", str(self.skills)]
        result = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_fresh_install_idempotent_repair_backup_and_restore(self) -> None:
        self.run_install("install")
        target = self.skills / "efficient-coding"
        marker = json.loads((target / ".afyx-install.json").read_text(encoding="utf-8"))
        self.assertEqual((marker["component"], marker["owner"]), ("efficient-coding", "afyx"))
        self.assertRegex(marker["content_sha256"], r"^[0-9a-f]{64}$")

        self.run_install("update")
        copies = list((self.backups / "efficient-coding").iterdir())
        self.assertEqual(len(copies), 1)
        self.assertTrue((copies[0] / ".afyx-install.json").is_file())

        shutil.rmtree(target)
        shutil.copytree(copies[0], target)
        restored = json.loads((target / ".afyx-install.json").read_text(encoding="utf-8"))
        self.assertEqual(restored["content_sha256"], marker["content_sha256"])

    def test_modified_foreign_and_malformed_targets_are_not_deleted(self) -> None:
        self.run_install("install")
        target = self.skills / "efficient-coding"
        skill = target / "SKILL.md"
        skill.write_text(skill.read_text(encoding="utf-8") + "\nuser modification\n", encoding="utf-8")
        refused = self.run_uninstall(expected=1)
        self.assertIn("AFYX_OWNED_MODIFIED", refused.stdout + refused.stderr)
        self.assertTrue(skill.is_file())

        shutil.rmtree(target)
        target.mkdir(parents=True)
        (target / "SKILL.md").write_text("---\nname: foreign\ndescription: foreign\n---\n", encoding="utf-8")
        refused = self.run_uninstall(expected=1)
        self.assertIn("FOREIGN_UNPROVEN", refused.stdout + refused.stderr)
        self.assertTrue(target.is_dir())

        (target / ".afyx-install.json").write_text("{ malformed", encoding="utf-8")
        refused = self.run_uninstall(expected=1)
        self.assertIn("FOREIGN_UNPROVEN", refused.stdout + refused.stderr)
        self.assertTrue(target.is_dir())

    def test_failed_backup_preserves_existing_installation(self) -> None:
        self.run_install("install")
        target = self.skills / "efficient-coding"
        before = hashlib.sha256((target / "SKILL.md").read_bytes()).hexdigest()
        shutil.rmtree(self.backups, ignore_errors=True)
        self.backups.write_text("blocks backup directory creation", encoding="utf-8")
        self.run_install("update", expected=1)
        self.assertEqual(hashlib.sha256((target / "SKILL.md").read_bytes()).hexdigest(), before)
        self.assertTrue((target / ".afyx-install.json").is_file())

    @unittest.skipUnless(WINDOWS, "provider replica lifecycle is exercised by the PowerShell installer")
    def test_antigravity_secondary_roots_repair_owned_drift_and_reject_unowned(self) -> None:
        (self.fake_bin / "agy.cmd").write_text("@echo agy-test\r\n", encoding="utf-8")
        primary = self.base / "primary-skills"
        gemini = self.base / "gemini"
        command = [
            self.shell,
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(ROOT / "install.ps1"),
            "-SkillsRoot",
            str(primary),
            "-Preset",
            "recommended",
            "-Provider",
            "antigravity",
            "-ProviderScope",
            "global",
            "-GeminiHome",
            str(gemini),
            "-SkipGraphMcp",
            "-Confirm:$false",
        ]

        first = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        source = (ROOT / "skills/efficient-coding/SKILL.md").read_bytes()
        ide_target = gemini / "config/skills/efficient-coding"
        cli_target = gemini / "antigravity-cli/skills/efficient-coding"
        for target in (ide_target, cli_target):
            with (target / "SKILL.md").open("a", encoding="utf-8") as handle:
                handle.write("\n<!-- secondary-root drift -->\n")

        repaired = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(repaired.returncode, 0, repaired.stdout + repaired.stderr)
        self.assertEqual((ide_target / "SKILL.md").read_bytes(), source)
        self.assertEqual((cli_target / "SKILL.md").read_bytes(), source)

        (cli_target / ".afyx-install.json").unlink()
        with (cli_target / "SKILL.md").open("a", encoding="utf-8") as handle:
            handle.write("\nforeign-preserve-sentinel\n")
        before = (cli_target / "SKILL.md").read_bytes()
        refused = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(refused.returncode, 0, refused.stdout + refused.stderr)
        self.assertEqual((cli_target / "SKILL.md").read_bytes(), before)

    def test_interrupted_swap_is_recovered_before_retry(self) -> None:
        self.run_install("install")
        target = self.skills / "efficient-coding"
        recovery = self.skills / ".efficient-coding.afyx-old"
        target.rename(recovery)
        result = self.run_install("install")
        self.assertIn("Recovered interrupted skill transaction", result.stdout + result.stderr)
        self.assertTrue((target / ".afyx-install.json").is_file())
        self.assertFalse(recovery.exists())

    def test_missing_option_value_fails_without_mutation(self) -> None:
        if WINDOWS:
            command = [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"), "-SkillsRoot"]
        else:
            command = [self.shell, str(ROOT / "install.sh"), "--skills-root"]
        result = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.skills.exists())

    def test_symlink_target_is_refused_without_touching_destination(self) -> None:
        destination = self.base / "foreign-destination"
        destination.mkdir()
        sentinel = destination / "sentinel.txt"
        sentinel.write_text("keep", encoding="utf-8")
        self.skills.mkdir()
        try:
            (self.skills / "efficient-coding").symlink_to(destination, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symlink creation unavailable: {error}")
        self.run_uninstall(expected=1)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main(verbosity=2)
