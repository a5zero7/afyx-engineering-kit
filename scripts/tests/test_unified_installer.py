#!/usr/bin/env python3
"""Disposable Midnight Circuit integration tests for the three-provider path."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from scripts.tests.test_claude_provider_integration import fake_claude, fake_server
from scripts.tests.test_provider_transaction import fake_codex


ROOT = Path(__file__).resolve().parents[2]
WINDOWS = os.name == "nt"
COMPONENTS = [
    "efficient-coding",
    "odoo-engineering",
    "afyx-engineering-expert",
    "afyx-graph",
    "afyx-context",
]
SKILLS = COMPONENTS[:3]


def ps_literal(value: Path | str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(WINDOWS, "Midnight Circuit integration requires native Windows")
class UnifiedInstallerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shell = shutil.which("pwsh") or shutil.which("powershell")
        cls.node = shutil.which("node")
        if not cls.shell or not cls.node:
            raise unittest.SkipTest("PowerShell and Node.js are required")

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="afyx-unified-installer-")
        self.base = Path(self.temporary.name)
        self.home = self.base / "home"
        self.skills = self.home / ".agents" / "skills"
        self.graph = self.base / "graph"
        self.context = self.base / "context"
        self.codex_home = self.base / "codex"
        self.gemini_home = self.base / "gemini"
        self.claude_home = self.base / "claude-home"
        self.claude_config = self.base / "claude-config"
        self.workspace = self.base / "workspace"
        self.fake_bin = self.base / "bin"
        for directory in (self.home, self.workspace, self.fake_bin, self.claude_config):
            directory.mkdir(parents=True, exist_ok=True)

        suffix = ".cmd" if WINDOWS else ""
        codex_script = self.base / "fake-codex.cjs"
        fake_codex(self.fake_bin / f"codex{suffix}", codex_script)
        codex_script.write_text(
            "const _args = process.argv.slice(2);\n"
            "if (_args[0] === '--version' || _args[0] === '-v') { console.log('codex 1.0.0'); process.exit(0); }\n"
            + codex_script.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        (self.fake_bin / "codex.ps1").write_text(
            "throw 'PowerShell shim must not be selected for native MCP configuration'\n",
            encoding="utf-8",
        )
        claude_script = self.base / "fake-claude.cjs"
        fake_claude(self.fake_bin / f"claude{suffix}", claude_script)
        claude_script.write_text(
            "const _args = process.argv.slice(2);\n"
            "if (_args[0] === '--version' || _args[0] === '-v') { console.log('claude 1.0.0'); process.exit(0); }\n"
            + claude_script.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        (self.fake_bin / "agy.cmd").write_text("@echo off\r\necho 1.0.0\r\n", encoding="utf-8")

        entry = self.graph / "current" / "lib" / "dist" / "bin" / "afyx-graph.js"
        fake_server(entry)
        launcher = self.graph / "current" / "bin" / "afyx-graph.cmd"
        launcher.parent.mkdir(parents=True, exist_ok=True)
        launcher.write_text("@echo off\r\necho Afyx Graph 1.0.0\r\n", encoding="utf-8")
        public_launcher = self.graph / "bin" / "afyx-graph.cmd"
        public_launcher.parent.mkdir(parents=True, exist_ok=True)
        public_launcher.write_text("@echo off\r\necho Afyx Graph 1.0.0\r\n", encoding="utf-8")
        (self.graph / "metadata.json").write_text(
            json.dumps({"product_name": "Afyx Graph", "product_version": "1.0.0"}) + "\n",
            encoding="utf-8",
        )

        system_paths = [
            p
            for p in os.environ.get("PATH", "").split(os.pathsep)
            if not any(token in p.lower() for token in ("npm", "codex", "openai.chatgpt", ".vscode"))
        ]
        self.environment = {
            **os.environ,
            "HOME": str(self.home),
            "USERPROFILE": str(self.home),
            "CODEX_HOME": str(self.codex_home),
            "CLAUDE_CONFIG_DIR": str(self.claude_config),
            "AFYX_GRAPH_RUNTIME_ROOT": str(self.graph),
            "AFYX_CONTEXT_RUNTIME_ROOT": str(self.context),
            "CI": "1",
            "PATH": str(self.fake_bin) + os.pathsep + os.pathsep.join(system_paths),
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def invoke(self, script: str, arguments: str, *, expected: int = 0) -> subprocess.CompletedProcess[str]:
        command = f"& {ps_literal(ROOT / script)} {arguments}"
        result = subprocess.run(
            [self.shell, "-NoProfile", "-NonInteractive", "-Command", command],
            cwd=self.workspace,
            env=self.environment,
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def common(self, *, providers: str = "@('codex','antigravity','claude')", scope: str = "global") -> str:
        components = ",".join(f"'{item}'" for item in COMPONENTS)
        return " ".join(
            (
                f"-SkillsRoot {ps_literal(self.skills)}",
                "-Preset custom",
                f"-CustomComponent @({components})",
                f"-Provider {providers}",
                f"-ProviderScope {scope}",
                f"-WorkspaceRoot {ps_literal(self.workspace)}",
                f"-GeminiHome {ps_literal(self.gemini_home)}",
                f"-ClaudeHome {ps_literal(self.claude_home)}",
                f"-ClaudeConfigDir {ps_literal(self.claude_config)}",
                f"-ContextRuntimeRoot {ps_literal(self.context)}",
            )
        )

    def assert_skill_roots(self) -> None:
        roots = (
            self.skills,
            self.gemini_home / "config" / "skills",
            self.gemini_home / "antigravity-cli" / "skills",
            self.claude_home / "skills",
        )
        for root in roots:
            for component in SKILLS:
                self.assertTrue((root / component / ".afyx-install.json").is_file(), f"missing {component} in {root}")

    def test_three_provider_install_verify_idempotency_and_uninstall(self) -> None:
        arguments = self.common() + " -Confirm:$false"
        installed = self.invoke("install.ps1", arguments)
        self.assertIn("Provider transaction: CONFIGURED_RESTART_REQUIRED", installed.stdout)
        self.assert_skill_roots()
        # Selected ACE runtime also installs an owned on-demand companion skill
        # to each selected provider without replacing Graph MCP responses.
        for root in (self.skills, self.gemini_home / "config" / "skills", self.gemini_home / "antigravity-cli" / "skills", self.claude_home / "skills"):
            self.assertTrue((root / "afyx-context" / "SKILL.md").is_file())
            self.assertTrue((root / "afyx-context" / ".afyx-install.json").is_file())
        self.assertTrue((self.codex_home / "config.toml").is_file())
        self.assertTrue((self.gemini_home / "config" / "mcp_config.json").is_file())
        self.assertTrue((self.claude_config / ".claude.json").is_file())
        self.assertTrue((self.context / "metadata.json").is_file())
        self.assertEqual(json.loads((self.context / "metadata.json").read_text(encoding="utf-8"))["integration_default"], "OFF")

        tracked = (
            self.codex_home / "config.toml",
            self.gemini_home / "config" / "mcp_config.json",
            self.claude_config / ".claude.json",
            self.context / "metadata.json",
        )
        before = {path: digest(path) for path in tracked}
        repeated = self.invoke("install.ps1", arguments)
        self.assertIn("Provider transaction: CONFIGURED_RESTART_REQUIRED", repeated.stdout)
        self.assertEqual({path: digest(path) for path in tracked}, before)

        verified = self.invoke("verify.ps1", self.common())
        for provider in ("codex", "antigravity", "claude"):
            self.assertIn(f"[HEALTHY] {provider} MCP", verified.stdout)

        selected = "-SelectedComponent @(" + ",".join(f"'{item}'" for item in SKILLS) + ")"
        removed = self.invoke(
            "uninstall.ps1",
            " ".join(
                (
                    f"-SkillsRoot {ps_literal(self.skills)}",
                    selected,
                    "-RemoveProviderConfiguration",
                    "-RemoveAfyxContext",
                    "-Provider @('codex','antigravity','claude')",
                    "-ProviderScope global",
                    f"-WorkspaceRoot {ps_literal(self.workspace)}",
                    f"-GeminiHome {ps_literal(self.gemini_home)}",
                    f"-ClaudeHome {ps_literal(self.claude_home)}",
                    f"-ClaudeConfigDir {ps_literal(self.claude_config)}",
                    f"-ContextRuntimeRoot {ps_literal(self.context)}",
                    "-Confirm:$false",
                )
            ),
        )
        self.assertIn("Provider removal: READY", removed.stdout)
        self.assertFalse(self.context.exists())
        for root in (self.skills, self.gemini_home / "config" / "skills", self.gemini_home / "antigravity-cli" / "skills", self.claude_home / "skills"):
            self.assertFalse((root / "afyx-context").exists())
        self.assertTrue(self.graph.exists(), "shared Graph runtime must be preserved unless explicitly removed")
        for root in (self.skills, self.gemini_home / "config" / "skills", self.gemini_home / "antigravity-cli" / "skills", self.claude_home / "skills"):
            for component in SKILLS:
                self.assertFalse((root / component).exists())

    def test_incompatible_mixed_workspace_scope_fails_before_mutation(self) -> None:
        result = self.invoke("install.ps1", self.common(scope="workspace") + " -Confirm:$false", expected=1)
        self.assertIn("SCOPE_UNSUPPORTED", result.stdout + result.stderr)
        self.assertFalse(self.skills.exists())
        self.assertFalse((self.workspace / ".agents").exists())
        self.assertFalse((self.workspace / ".claude").exists())

    def test_missing_selected_claude_host_fails_before_mutation(self) -> None:
        (self.fake_bin / "claude.cmd").unlink()
        result = self.invoke("install.ps1", self.common(providers="@('claude')") + " -Confirm:$false", expected=1)
        self.assertIn("Selected Claude Code provider host was not detected", result.stdout + result.stderr)
        self.assertFalse((self.claude_home / "skills").exists())

    def test_extension_only_codex_selection_fails_before_mutation(self) -> None:
        (self.fake_bin / "codex.cmd").unlink()
        extension = self.home / ".vscode" / "extensions" / "openai.chatgpt-fixture"
        extension.mkdir(parents=True)
        result = self.invoke("install.ps1", self.common(providers="@('codex')") + " -Confirm:$false", expected=1)
        output = result.stdout + result.stderr
        self.assertIn("native Codex CLI", output)
        self.assertFalse(self.skills.exists())
        self.assertFalse(self.context.exists())
        self.assertFalse(self.codex_home.exists())

    def test_claude_only_verification_succeeds_without_codex(self) -> None:
        (self.fake_bin / "codex.cmd").unlink()
        args = self.common(providers="@('claude')")
        installed = self.invoke("install.ps1", args + " -Confirm:$false")
        self.assertIn("Provider transaction: READY", installed.stdout)
        self.assertNotIn("Codex host [REQUIRED]", installed.stdout)
        verified = self.invoke("verify.ps1", args)
        self.assertIn("[HEALTHY] claude MCP", verified.stdout)
        self.assertIn("[HEALTHY] Claude Code host", verified.stdout)
        self.assertIn("[HEALTHY] Core readiness", verified.stdout)

    def test_antigravity_only_verification_succeeds_without_codex(self) -> None:
        (self.fake_bin / "codex.cmd").unlink()
        args = self.common(providers="@('antigravity')")
        installed = self.invoke("install.ps1", args + " -Confirm:$false")
        self.assertIn("Provider transaction: CONFIGURED_RESTART_REQUIRED", installed.stdout)
        self.assertNotIn("Codex host [REQUIRED]", installed.stdout)
        verified = self.invoke("verify.ps1", args)
        self.assertIn("[HEALTHY] antigravity MCP", verified.stdout)
        self.assertIn("[HEALTHY] Antigravity host", verified.stdout)
        self.assertIn("[HEALTHY] Core readiness", verified.stdout)

    def test_codex_selected_without_codex_fails_verification(self) -> None:
        (self.fake_bin / "codex.cmd").unlink()
        args = self.common(providers="@('codex')")
        verified = self.invoke("verify.ps1", args, expected=1)
        self.assertIn("[BLOCKED] Codex host", verified.stdout)
        self.assertIn("[BLOCKED] Core readiness", verified.stdout)

    def test_explicit_context_off_preserves_unmodified_provider_state(self) -> None:
        # Runtime may be installed, but a deliberate Context OFF must never
        # materialize a newly enabled provider skill.
        self.environment["AFYX_CONTEXT_OPT_IN"] = "0"
        installed = self.invoke("install.ps1", self.common(providers="@('codex')") + " -Confirm:$false")
        self.assertIn("Afyx Context Engine", installed.stdout)
        self.assertTrue((self.context / "metadata.json").is_file())
        self.assertFalse((self.skills / "afyx-context").exists())

    def test_foreign_context_companion_blocks_before_mutation(self) -> None:
        foreign = self.skills / "afyx-context"
        foreign.mkdir(parents=True)
        sentinel = foreign / "SKILL.md"
        sentinel.write_text("foreign user skill\\n", encoding="utf-8")
        result = self.invoke("install.ps1", self.common(providers="@('codex')") + " -Confirm:$false", expected=1)
        self.assertIn("Provider companion preflight blocked before mutation", result.stdout + result.stderr)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "foreign user skill\\n")
        self.assertFalse((self.skills / "efficient-coding").exists())
        self.assertFalse((self.context / "metadata.json").exists())
        self.assertFalse((self.codex_home / "config.toml").exists())

    def test_wizard_contract_uses_three_provider_multiselect(self) -> None:
        source = (ROOT / "install.ps1").read_text(encoding="utf-8")
        self.assertIn("Id = 'claude'; Label = 'Claude Code'", source)
        self.assertIn("Read-AfyxMultiChoice -Prompt 'Select provider integrations'", source)
        self.assertIn("Id = 'skip'; Label = 'Skip provider configuration'", source)
        self.assertNotIn("Id = 'both'; Label = 'Codex + Antigravity'", source)
        self.assertIn("ProviderAdapter/v1 owns one transactional MCP configuration pass", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
