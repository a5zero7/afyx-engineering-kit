#!/usr/bin/env python3
"""Zero-model static contract regression for ACE provider companion onboarding."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ContextCompanionContractTests(unittest.TestCase):
    def test_on_demand_skill_exists_without_claiming_graph_mcp_interception(self) -> None:
        skill = (ROOT / "skills/afyx-context/SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(skill.startswith("---\n"))
        self.assertIn("name: afyx-context", skill)
        self.assertIn("metadata:\n  version: \"0.1.0\"", skill)
        self.assertIn("afyx-context get", skill)
        self.assertIn("AFYX_CONTEXT_OPT_IN=0", skill)
        self.assertIn("does not itself register an additional MCP tool", skill)

    def test_windows_selected_providers_receive_only_owned_companion(self) -> None:
        installer = (ROOT / "install.ps1").read_text(encoding="utf-8")
        uninstaller = (ROOT / "uninstall.ps1").read_text(encoding="utf-8")
        self.assertIn("contextCompanionDesired", installer)
        self.assertIn("AFYX_CONTEXT_OPT_IN -ne '0'", installer)
        self.assertIn("Get-AfyxSkillOwnership -Target $target -Component 'afyx-context'", installer)
        self.assertIn("Refusing automatic Context companion replacement", installer)
        self.assertIn("Remove-AfyxSkillSafely -SkillsRoot $root -Component 'afyx-context'", uninstaller)

    def test_unix_selected_providers_receive_only_owned_companion(self) -> None:
        installer = (ROOT / "install.sh").read_text(encoding="utf-8")
        uninstaller = (ROOT / "uninstall.sh").read_text(encoding="utf-8")
        self.assertIn("context_companion_desired=false", installer)
        self.assertIn("${AFYX_CONTEXT_OPT_IN:-}", installer)
        self.assertIn("afyx_classify_skill \"$context_skill_target\" afyx-context afyx", installer)
        self.assertIn("afyx_remove_skill afyx-context", uninstaller)

    def test_ide_only_provider_detection_is_read_only(self) -> None:
        installer = (ROOT / "install.ps1").read_text(encoding="utf-8")
        self.assertIn("claudeVsCodeDetected", installer)
        self.assertIn("antigravityIdeDetected", installer)
        self.assertIn("CLI not found, MCP integration unavailable", installer)
        self.assertIn("Enabled = $antigravityDetected", installer)
        self.assertIn("Enabled = $claudeDetected", installer)


if __name__ == "__main__":
    unittest.main(verbosity=2)
