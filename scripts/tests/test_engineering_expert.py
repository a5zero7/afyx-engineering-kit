#!/usr/bin/env python3
"""Afyx Engineering Expert bundle and isolated lifecycle acceptance."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXPERT = ROOT / "skills" / "afyx-engineering-expert"
WINDOWS = os.name == "nt"
HISTORICAL_SOURCE_TREE_SHA256 = "9ebefe30bf9c7f73b101a53542b3cb09c993cfe9a4d565d15afc5834465569b7"
CANDIDATE_SOURCE_TREE_SHA256 = "8be03f6375d293cd341a2aa1694ed94d61862504263a588d9216649928b02f59"
CORE_REFERENCES = {
    "ai-ml-engineer.md", "business-analyst.md", "cybersecurity-devsecops.md",
    "database-administrator.md", "erp-technical-specialist.md", "product-manager.md",
    "qa-engineer.md", "site-reliability-engineer.md", "software-engineer.md",
    "solutions-architect.md", "subject-matter-expert.md", "system-analyst.md",
    "ui-ux-designer.md",
}
SPECIALIST_REFERENCES = {
    "clean-code-engineer.md", "code-reviewer.md", "data-analyst-bi.md",
    "data-engineer.md", "debugging-specialist.md", "embedded-iot-engineer.md",
    "hardware-diagnostics-auditor.md", "hardware-electronics-engineer.md",
    "integration-engineer.md", "legacy-modernization-engineer.md",
    "llmops-prompt-engineer.md", "network-engineer.md",
    "performance-benchmark-engineer.md", "platform-engineer.md",
    "technical-project-manager.md", "technical-writer.md",
}
REFERENCES = CORE_REFERENCES | SPECIALIST_REFERENCES | {"specialists-index.md"}
WORKFLOWS = {
    "ai-data-erp.md", "debugging.md", "discovery-design.md", "implementation.md",
    "incident-reliability.md", "review-audit.md",
}


def normalized_tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    files = [
        (path.relative_to(root).as_posix(), path)
        for path in root.rglob("*")
        if path.is_file()
    ]
    for relative, path in sorted(files, key=lambda item: item[0].casefold()):
        digest.update(relative.encode("utf-8") + b"\0")
        digest.update(path.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8"))
    return digest.hexdigest()


def shell_path() -> str | None:
    if WINDOWS:
        return shutil.which("pwsh") or shutil.which("powershell")
    return shutil.which("bash") or "/bin/bash"


class ExpertBundleTests(unittest.TestCase):
    def test_bundle_digest_uses_case_normalized_posix_order(self) -> None:
        relative_paths = [
            path.relative_to(EXPERT).as_posix()
            for path in EXPERT.rglob("*")
            if path.is_file()
        ]
        canonical = sorted(relative_paths, key=str.casefold)
        self.assertEqual(canonical[0], "assets/result-template.md")
        self.assertEqual(canonical[1], "README.md")
        with mock.patch.object(
            type(EXPERT),
            "__lt__",
            lambda left, right: left.as_posix() < right.as_posix(),
        ):
            self.assertEqual(normalized_tree_digest(EXPERT), CANDIDATE_SOURCE_TREE_SHA256)

    def test_candidate_structure_metadata_and_content(self) -> None:
        files = {path.relative_to(EXPERT).as_posix() for path in EXPERT.rglob("*") if path.is_file()}
        self.assertEqual(len(files), 39)
        self.assertEqual({Path(item).name for item in files if item.startswith("references/")}, REFERENCES)
        self.assertEqual({Path(item).name for item in files if item.startswith("workflows/")}, WORKFLOWS)
        self.assertIn("assets/result-template.md", files)
        self.assertNotEqual(normalized_tree_digest(EXPERT), HISTORICAL_SOURCE_TREE_SHA256)
        manifest = (EXPERT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn('name: afyx-engineering-expert', manifest)
        self.assertIn('version: "0.1.1"', manifest)
        self.assertIn("one adaptive workflow", manifest)
        self.assertIn("Bahasa Indonesia", manifest)

    def test_component_contract_is_optional_owned_and_has_no_legacy_claim(self) -> None:
        contract = json.loads((ROOT / "scripts" / "components.json").read_text(encoding="utf-8"))
        component = next(item for item in contract["components"] if item["id"] == "afyx-engineering-expert")
        self.assertEqual(
            (component["type"], component["tier"], component["ownership"], component["install_root"], component["install_path"]),
            ("skill", "optional", "afyx", "skills_root", "afyx-engineering-expert"),
        )
        self.assertEqual(component["version_source"], "SKILL.md#metadata.version")
        self.assertEqual(component["version_required"], "true")
        self.assertFalse(any(key.startswith("legacy_") for key in component))
        self.assertEqual(set(component["required_files"].split(";")), {
            path.relative_to(EXPERT).as_posix() for path in EXPERT.rglob("*") if path.is_file()
        })


class ExpertLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.skills = self.base / "skills"
        self.backups = self.base / "backups"
        self.fake_bin = self.base / "bin"
        self.fake_bin.mkdir()
        self.shell = shell_path()
        if not self.shell:
            self.skipTest("supported lifecycle shell unavailable")
        self.env = os.environ.copy()
        self.env.update({
            "HOME": str(self.base),
            "USERPROFILE": str(self.base),
            "CODEX_HOME": str(self.base / "codex"),
            "AFYX_GRAPH_RUNTIME_ROOT": str(self.base / "graph"),
            "AFYX_GRAPH_BIN_DIR": str(self.base / "graph-bin"),
            "AFYX_BACKUP_ROOT": str(self.backups),
            "CI": "1",
        })
        if WINDOWS:
            (self.fake_bin / "codex.cmd").write_text("@echo codex-test\r\n", encoding="utf-8")
        else:
            codex = self.fake_bin / "codex"
            codex.write_text("#!/bin/sh\necho codex-test\n", encoding="utf-8")
            codex.chmod(codex.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        self.env["PATH"] = str(self.fake_bin) + os.pathsep + self.env.get("PATH", "")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @property
    def target(self) -> Path:
        return self.skills / "afyx-engineering-expert"

    def install(self, action: str | None, *, dry_run: bool = False, expected: int = 0) -> subprocess.CompletedProcess[str]:
        if WINDOWS:
            command = [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                       "-SkillsRoot", str(self.skills), "-SkipUsageTracker", "-SkipGraphMcp"]
            if action:
                command += ["-ComponentAction", f"afyx-engineering-expert={action}"]
            if dry_run:
                command.append("-WhatIf")
        else:
            command = [self.shell, str(ROOT / "install.sh"), "--skills-root", str(self.skills), "--skip-graph-mcp"]
            if action:
                command += ["--component", f"afyx-engineering-expert={action}"]
            if dry_run:
                command.append("--dry-run")
        result = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def uninstall(self) -> subprocess.CompletedProcess[str]:
        if WINDOWS:
            command = [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "uninstall.ps1"),
                       "-SkillsRoot", str(self.skills), "-Component", "afyx-engineering-expert", "-Confirm:$false"]
        else:
            command = [self.shell, str(ROOT / "uninstall.sh"), "--skills-root", str(self.skills),
                       "--component", "afyx-engineering-expert"]
        return subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)

    def validate_only(self) -> subprocess.CompletedProcess[str]:
        if WINDOWS:
            command = [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                       "-SkillsRoot", str(self.skills), "-ValidateOnly"]
        else:
            command = [self.shell, str(ROOT / "install.sh"), "--skills-root", str(self.skills), "--validate-only"]
        result = subprocess.run(command, cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("BundledAfyxEngineeringExpert", result.stdout)
        return result

    def test_skip_dry_run_fresh_install_update_repair_and_uninstall(self) -> None:
        self.validate_only()
        self.assertFalse(self.target.exists())
        self.install("skip")
        self.assertFalse(self.target.exists())
        self.install("install", dry_run=True)
        self.assertFalse(self.target.exists())

        self.install("install")
        self.assertFalse((self.base / "codex").exists())
        self.assertFalse((self.base / "graph").exists())
        marker = json.loads((self.target / ".afyx-install.json").read_text(encoding="utf-8"))
        self.assertEqual((marker["component"], marker["owner"], marker["version"]),
                         ("afyx-engineering-expert", "afyx", "0.1.1"))

        self.install("update")
        self.assertEqual(len(list((self.backups / "afyx-engineering-expert").iterdir())), 1)
        (self.target / "workflows" / "review-audit.md").unlink()
        self.install("repair")
        self.assertTrue((self.target / "workflows" / "review-audit.md").is_file())

        shutil.copytree(ROOT / "skills" / "efficient-coding", self.skills / "efficient-coding")
        removed = self.uninstall()
        self.assertEqual(removed.returncode, 0, removed.stdout + removed.stderr)
        self.assertFalse(self.target.exists())
        self.assertTrue((self.skills / "efficient-coding" / "SKILL.md").is_file())

    def test_existing_modified_install_is_not_silently_overwritten(self) -> None:
        self.install("install")
        manifest = self.target / "SKILL.md"
        manifest.write_text(manifest.read_text(encoding="utf-8") + "\nuser change\n", encoding="utf-8")
        before = manifest.read_bytes()
        self.install(None)
        self.assertEqual(manifest.read_bytes(), before)

    def test_backup_failure_preserves_existing_install(self) -> None:
        self.install("install")
        before = (self.target / "SKILL.md").read_bytes()
        shutil.rmtree(self.backups, ignore_errors=True)
        self.backups.write_text("not a directory", encoding="utf-8")
        self.install("update", expected=1)
        self.assertEqual((self.target / "SKILL.md").read_bytes(), before)
        self.assertTrue((self.target / ".afyx-install.json").is_file())

    def test_adoption_without_historical_evidence_fails_closed(self) -> None:
        shutil.copytree(EXPERT, self.target)
        result = self.install("adopt", expected=1)
        self.assertIn("provenance", (result.stdout + result.stderr).lower())
        self.assertFalse((self.target / ".afyx-install.json").exists())


class ExpertSpecialistRoutingTests(unittest.TestCase):
    """AFYX-310: Selective expertise routing and specialist contract validation."""

    def test_all_specialist_references_conform_to_contract(self) -> None:
        for ref_name in SPECIALIST_REFERENCES:
            ref_path = EXPERT / "references" / ref_name
            self.assertTrue(ref_path.is_file(), f"Missing specialist reference: {ref_name}")
            content = ref_path.read_text(encoding="utf-8")
            self.assertTrue(content.startswith("# "), f"{ref_name} must start with an H1 title")
            self.assertIn("## Owns", content, f"{ref_name} missing '## Owns' section")
            self.assertIn("## Method", content, f"{ref_name} missing '## Method' section")
            self.assertIn("## Output when primary", content, f"{ref_name} missing '## Output when primary' section")
            self.assertIn("## Red flags", content, f"{ref_name} missing '## Red flags' section")

    def test_specialists_index_routing_table_completeness(self) -> None:
        index_path = EXPERT / "references" / "specialists-index.md"
        self.assertTrue(index_path.is_file())
        content = index_path.read_text(encoding="utf-8")
        self.assertIn("# Supplemental Specialist Routing Index", content)
        self.assertIn("## Specialist Routing Table", content)
        for ref_name in SPECIALIST_REFERENCES:
            self.assertIn(f"`references/{ref_name}`", content, f"{ref_name} not indexed in specialists-index.md")

    def test_representative_routing_and_lazy_unloaded_discipline(self) -> None:
        # Representative domains specified in AFYX-310
        representative_scenarios = [
            ("software engineering", "references/clean-code-engineer.md", {"software-engineer", "qa-engineer"}),
            ("odoo/erp", "references/erp-technical-specialist.md", {"business-analyst", "software-engineer"}),
            ("debugging", "references/debugging-specialist.md", {"software-engineer", "qa-engineer"}),
            ("architecture", "references/solutions-architect.md", {"cybersecurity-devsecops", "sre"}),
            ("data", "references/data-engineer.md", {"database-administrator", "ai-ml-engineer"}),
            ("llmops", "references/llmops-prompt-engineer.md", {"ai-ml-engineer", "software-engineer"}),
            ("hardware", "references/hardware-diagnostics-auditor.md", {"cybersecurity-devsecops", "system-analyst"}),
            ("documentation", "references/technical-writer.md", {"software-engineer", "product-manager"}),
        ]
        all_specialist_files = {f"references/{r}" for r in SPECIALIST_REFERENCES}

        for domain, primary_ref, supporting in representative_scenarios:
            # Selected references must only contain primary + at most 2 supporting
            loaded = {primary_ref} | {f"references/{s}.md" for s in supporting}
            self.assertLessEqual(len(loaded), 3, f"Scenario {domain} loaded more than 3 references")
            # Unloaded specialists must remain unloaded
            unloaded = all_specialist_files - loaded
            self.assertGreater(len(unloaded), 12, f"Scenario {domain} did not keep irrelevant specialists lazy/unloaded")
            # Verify primary file exists on disk
            self.assertTrue((EXPERT / primary_ref).is_file(), f"Primary ref {primary_ref} missing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
