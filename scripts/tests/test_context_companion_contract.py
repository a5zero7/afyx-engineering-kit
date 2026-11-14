#!/usr/bin/env python3
"""Zero-model static contract regression for ACE provider companion onboarding."""

from pathlib import Path
import subprocess
import tempfile
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
        self.assertIn("Enabled = $claudeEnabled", installer)
        with tempfile.TemporaryDirectory(prefix="afyx-provider-readonly-") as profile:
            config = Path(profile) / ".gemini/config/mcp_config.json"
            config.parent.mkdir(parents=True)
            original = b'{"mcpServers":{"foreign":{"command":"owner-tool"}}}\r\n'
            config.write_bytes(original)
            program = """
import assert from 'node:assert/strict';
import { discoverProviderInventory } from './scripts/afyx-provider-inventory.mjs';
const probe = { commands: {}, desktops: {}, files: [], extensions: [
  { id: 'anthropic.claude-code', path: '/fixture/extension', version: '1' }
] };
const before = JSON.stringify(probe);
const inventory = discoverProviderInventory({ env: { PATH: '' }, home: process.argv[1], probe });
const claude = inventory.find(item => item.id === 'claude');
assert.equal(claude.installed, true);
assert.deepEqual(claude.products.map(item => item.type), ['VS Code Extension']);
assert.ok(claude.products.every(item => item.configuration === 'NOT_VERIFIED'));
assert.equal(JSON.stringify(probe), before);
"""
            result = subprocess.run(["node", "--input-type=module", "-e", program, profile],
                                    cwd=ROOT, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(config.read_bytes(), original)


if __name__ == "__main__":
    unittest.main(verbosity=2)
