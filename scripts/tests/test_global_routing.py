"""Offline global policy installer tests with disposable provider homes."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts" / "afyx-global-routing.mjs"


class GlobalRoutingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name)
        self.codex, self.gemini, self.claude = home / ".codex", home / ".gemini", home / ".claude"
        self.targets = {
            "codex": self.codex / "AGENTS.md",
            "antigravity": self.gemini / "GEMINI.md",
            "claude": self.claude / "CLAUDE.md",
        }

    def run_tool(self, *args, expected=0):
        proc = subprocess.run(
            ["node", str(SOURCE), "--codex-home", str(self.codex),
             "--gemini-home", str(self.gemini), "--claude-home", str(self.claude), *args],
            text=True, capture_output=True,
        )
        self.assertEqual(proc.returncode, expected, proc.stderr or proc.stdout)
        return json.loads(proc.stdout or proc.stderr)

    def test_default_plan_has_no_side_effects(self):
        result = self.run_tool()
        self.assertEqual({row["provider"] for row in result["providers"]}, set(self.targets))
        self.assertFalse(result["changed"])
        self.assertFalse(any(path.exists() for path in self.targets.values()))

    def test_apply_all_three_and_verify_idempotent(self):
        self.run_tool("--apply")
        for path in self.targets.values():
            self.assertIn("Afyx adaptive tool routing", path.read_text())
        original = {path: path.read_bytes() for path in self.targets.values()}
        self.assertFalse(self.run_tool("--apply")["changed"])
        self.assertEqual(original, {path: path.read_bytes() for path in self.targets.values()})
        self.assertEqual([r["status"] for r in self.run_tool("--verify")["providers"]], ["IN_SYNC"] * 3)

    def test_append_preserves_user_rules_and_uninstall_only_owned(self):
        self.codex.mkdir(parents=True)
        original = "# Private instruction\nDo not merge without approval.\n"
        self.targets["codex"].write_text(original)
        self.run_tool("--apply")
        self.assertTrue(self.targets["codex"].read_text().startswith(original))
        self.run_tool("--uninstall", "--apply")
        self.assertEqual(self.targets["codex"].read_text(), original)
        self.assertEqual(self.targets["antigravity"].read_text(), "")

    def test_mandatory_legacy_rule_blocks_all_changes(self):
        self.codex.mkdir(parents=True)
        self.targets["codex"].write_text("Always invoke " + "code" + "graph before direct search.\n")
        result = self.run_tool("--apply", expected=2)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["providers"][0]["status"], "BLOCKED_CONFLICT")
        self.assertFalse(self.targets["antigravity"].exists())
        self.assertFalse(self.targets["claude"].exists())

    def test_codex_override_is_effective_active_file(self):
        self.codex.mkdir(parents=True)
        override = self.codex / "AGENTS.override.md"
        override.write_text("# Personal override\n")
        self.run_tool("--apply")
        self.assertIn("Afyx adaptive tool routing", override.read_text())
        self.assertFalse(self.targets["codex"].exists())

    def test_provider_selection(self):
        self.run_tool("--apply", "--providers", "claude")
        self.assertTrue(self.targets["claude"].exists())
        self.assertFalse(self.targets["codex"].exists())
        self.assertFalse(self.targets["antigravity"].exists())

    def test_unsupported_provider_fails_closed(self):
        result = self.run_tool("--apply", "--providers", "unknown-host", expected=2)
        self.assertEqual(result["reason"], "UNSUPPORTED_PROVIDER")
        self.assertFalse(self.targets["codex"].exists())

    def test_target_symlink_prohibited(self):
        self.codex.mkdir(parents=True)
        actual = self.codex.parent / "target.md"
        actual.write_text("Private")
        try:
            self.targets["codex"].symlink_to(actual)
        except OSError:
            self.skipTest("symlink unavailable")
        result = self.run_tool("--apply", expected=2)
        self.assertIn("SYMLINK_OR_REPARSE_BLOCKED", result["reason"])
        self.assertEqual(actual.read_text(), "Private")

    def test_user_backup_before_mutation(self):
        self.claude.mkdir(parents=True)
        original = b"# Existing rules\r\nPreserve.\r\n"
        self.targets["claude"].write_bytes(original)
        self.run_tool("--apply")
        directory = self.claude / ".afyx-global-routing-backups"
        self.assertTrue(any(f.read_bytes() == original for f in directory.glob("*.bak")))

    def test_owned_block_drifts_and_repair_is_scoped(self):
        self.run_tool("--apply")
        path = self.targets["codex"]
        path.write_text(path.read_text().replace("Use the lowest-cost reliable", "Use the fastest available"))
        self.assertEqual(self.run_tool("--verify")["providers"][0]["status"], "DRIFTED_OWNED")
        self.run_tool("--apply")
        self.assertIn("Use the lowest-cost reliable", path.read_text())

    def test_duplicate_marker_denied(self):
        self.run_tool("--apply")
        path = self.targets["codex"]
        path.write_text(path.read_text() + "\n<!-- AFYX-ADAPTIVE-ROUTING:START v1 -->")
        result = self.run_tool("--apply", expected=2)
        self.assertEqual(result["providers"][0]["status"], "BLOCKED_MARKER")

    def test_crlf_file_idempotence(self):
        self.claude.mkdir(parents=True)
        self.targets["claude"].write_bytes(b"# Existing\r\n")
        self.run_tool("--apply")
        self.assertEqual(self.run_tool("--verify")["providers"][2]["status"], "IN_SYNC")
        self.assertFalse(self.run_tool("--apply")["changed"])

    def test_crlf_policy_idempotence(self):
        policy = Path(self.tmp.name) / "policy.md"
        source_policy = ROOT / "scripts" / "afyx-global-routing-policy.md"
        policy.write_bytes(
            source_policy.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        )
        script = (
            "import {runGlobalRouting} from " + json.dumps(SOURCE.as_uri()) + ";"
            "const result=runGlobalRouting(JSON.parse(process.argv[1]));"
            "console.log(JSON.stringify(result));"
        )
        options = {
            "operation": "apply",
            "apply": True,
            "policyFile": str(policy),
            "roots": {
                "codexHome": str(self.codex),
                "geminiHome": str(self.gemini),
                "claudeHome": str(self.claude),
            },
        }
        command = ["node", "--input-type=module", "-e", script, json.dumps(options)]
        first = subprocess.run(command, text=True, capture_output=True, check=True)
        self.assertTrue(json.loads(first.stdout)["changed"])
        second = subprocess.run(command, text=True, capture_output=True, check=True)
        self.assertFalse(json.loads(second.stdout)["changed"])

    def test_invalid_utf8_blocked(self):
        self.codex.mkdir(parents=True)
        self.targets["codex"].write_bytes(b"\xff\xfe\xfa")
        result = self.run_tool("--apply", expected=2)
        self.assertEqual(result["providers"][0]["status"], "BLOCKED_ENCODING")
        self.assertEqual(self.targets["codex"].read_bytes(), b"\xff\xfe\xfa")

    def test_codex_override_symlink_blocked(self):
        self.codex.mkdir(parents=True)
        actual = self.codex.parent / "override.md"
        actual.write_text("Private")
        try:
            (self.codex / "AGENTS.override.md").symlink_to(actual)
        except OSError:
            self.skipTest("symlink unavailable")
        result = self.run_tool("--apply", expected=2)
        self.assertIn("SYMLINK_OR_REPARSE_BLOCKED", result["reason"])
        self.assertEqual(actual.read_text(), "Private")


if __name__ == "__main__":
    unittest.main(verbosity=2)
