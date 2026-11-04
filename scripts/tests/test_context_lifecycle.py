#!/usr/bin/env python3
"""Managed Afyx Context lifecycle and control-plane regressions."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PS_INSTALLER = ROOT / "scripts" / "install-afyx-context.ps1"
SH_INSTALLER = ROOT / "scripts" / "install-afyx-context.sh"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fake_windows_codex_environment(home: Path, lab: Path) -> dict[str, str]:
    """Isolate Context lifecycle tests from a real Codex CLI/user profile."""
    fake_bin = lab / "bin"
    fake_bin.mkdir(exist_ok=True)
    (fake_bin / "codex.cmd").write_text(
        '@echo off\r\nif /I "%~1"=="--version" (echo codex 1.0.0 & exit /b 0)\r\nexit /b 1\r\n',
        encoding="utf-8",
    )
    return {
        **os.environ,
        "USERPROFILE": str(home),
        "CODEX_HOME": str(home / ".codex"),
        "CI": "1",
        "PATH": str(fake_bin) + os.pathsep + os.environ.get("PATH", ""),
    }


class ContextLifecycleContractTests(unittest.TestCase):
    def test_contract_is_explicit_only_and_defaults_are_unchanged(self) -> None:
        contract = json.loads((ROOT / "scripts" / "components.json").read_text(encoding="utf-8"))
        by_id = {item["id"]: item for item in contract["components"]}
        context = by_id["afyx-context"]
        self.assertEqual(context["ownership_class"], "AFYX")
        self.assertEqual(context["install_root"], "afyx_context_root")
        self.assertEqual(context["presets"], "")
        expected = {
            "minimal": {"efficient-coding", "odoo-engineering"},
            "recommended": {"efficient-coding", "odoo-engineering", "afyx-engineering-expert"},
            "full": {"efficient-coding", "odoo-engineering", "afyx-engineering-expert", "afyx-graph", "codex-usage-tracking"},
        }
        for preset, members in expected.items():
            actual = {item["id"] for item in contract["components"] if preset in item["presets"].split(";")}
            self.assertEqual(actual, members)
        product = json.loads((ROOT / "afyx-context" / "afyx-context.json").read_text(encoding="utf-8"))
        self.assertEqual(product["kit_management"]["lifecycle_integration"], "managed-optional")
        self.assertEqual(product["kit_management"]["default_presets"], [])
        self.assertFalse(product["optional_consumers"]["graph"]["default_enabled"])

    def test_entrypoints_forward_context_root_without_path_or_config_mutation(self) -> None:
        ps = (ROOT / "install.ps1").read_text(encoding="utf-8")
        sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("$contextArguments = @{ RuntimeRoot = $ContextRuntimeRoot }", ps)
        self.assertIn("context_args=(--runtime-root \"$context_root\")", sh)
        for source in (PS_INSTALLER.read_text(encoding="utf-8"), SH_INSTALLER.read_text(encoding="utf-8")):
            self.assertNotIn("codex mcp", source.lower())
            self.assertNotIn("setx", source.lower())
            self.assertNotIn("config.toml", source.lower())

    @unittest.skipUnless(os.name == "nt" and (shutil.which("pwsh") or shutil.which("powershell")),
                         "Windows PowerShell lifecycle requires a Windows host")
    def test_windows_install_verify_repeat_repair_recovery_and_uninstall(self) -> None:
        shell = shutil.which("pwsh") or shutil.which("powershell")
        assert shell
        with tempfile.TemporaryDirectory(prefix="afyx-context-lifecycle-") as temporary:
            lab = Path(temporary)
            runtime = lab / "runtime"
            state = lab / "user-state"
            ace_state = lab / "ace-state"
            sentinel = state / "preserve.txt"
            state.mkdir()
            sentinel.write_text("user-owned", encoding="utf-8")
            home = lab / "home"
            (home / ".vscode" / "extensions" / "openai.chatgpt-test").mkdir(parents=True)
            environment = fake_windows_codex_environment(home, lab)
            base = [shell, "-NoProfile", "-NonInteractive", "-File", str(PS_INSTALLER), "-RuntimeRoot", str(runtime)]

            control_install = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                               "-SkillsRoot", str(home / ".agents" / "skills"), "-ContextRuntimeRoot", str(runtime),
                               "-ComponentAction", "afyx-context=install", "-Confirm:$false"]
            installed = subprocess.run(control_install, env=environment, text=True, capture_output=True)
            self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
            metadata = json.loads((runtime / "metadata.json").read_text(encoding="utf-8"))
            expected_revision = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
            self.assertEqual(metadata["source_revision"], expected_revision)
            self.assertEqual(metadata["artifact_digest"], digest(runtime / "integrity.sha256"))
            self.assertEqual(metadata["integration_default"], "OFF")

            verified = subprocess.run(base + ["-Verify"], text=True, capture_output=True)
            self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
            control_verify = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "verify.ps1"),
                              "-SkillsRoot", str(home / ".agents" / "skills"), "-ContextRuntimeRoot", str(runtime),
                              "-Preset", "custom", "-CustomComponent", "afyx-context"]
            verified_control = subprocess.run(control_verify, env=environment, text=True, capture_output=True)
            self.assertEqual(verified_control.returncode, 0, verified_control.stdout + verified_control.stderr)
            before = digest(runtime / "metadata.json")
            repeated = subprocess.run(base, text=True, capture_output=True)
            control_update = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "update.ps1"),
                              "-SkipSelfUpdate", "-SkillsRoot", str(home / ".agents" / "skills"),
                              "-ContextRuntimeRoot", str(runtime), "-ComponentAction", "afyx-context=update"]
            updated = subprocess.run(control_update, env=environment, text=True, capture_output=True)
            self.assertEqual((repeated.returncode, updated.returncode), (0, 0), repeated.stderr + updated.stderr)
            self.assertEqual(digest(runtime / "metadata.json"), before)

            cli = runtime / "current" / "bin" / "afyx-context.cmd"
            content = "installed exact original " * 30
            request = json.dumps({"segments": [{"id": "a", "content": content}, {"id": "b", "content": content}]})
            reduced = subprocess.run([str(cli), "reduce", "--state", str(ace_state), "--owner", "owner", "--session", "session", "--input", "-"], input=request, text=True, capture_output=True)
            self.assertEqual(reduced.returncode, 0, reduced.stderr)
            reference = json.loads(reduced.stdout)["items"][1]["reference"]
            restored = subprocess.run([str(cli), "get", "--state", str(ace_state), "--owner", "owner", "--session", "session", "--reference", reference], text=True, capture_output=True)
            self.assertEqual((restored.returncode, restored.stdout), (0, content))

            (runtime / "current" / "dist" / "index.js").write_text("modified", encoding="utf-8")
            denied = subprocess.run(base + ["-Update"], text=True, capture_output=True)
            self.assertNotEqual(denied.returncode, 0)
            repaired = subprocess.run(base + ["-Repair"], text=True, capture_output=True)
            self.assertEqual(repaired.returncode, 0, repaired.stdout + repaired.stderr)

            recovery = Path(f"{runtime}.afyx-old")
            runtime.rename(recovery)
            read_only = subprocess.run(base + ["-ValidateOnly"], text=True, capture_output=True)
            self.assertNotEqual(read_only.returncode, 0)
            self.assertTrue(recovery.is_dir())
            self.assertFalse(runtime.exists())
            recovered = subprocess.run(base, text=True, capture_output=True)
            self.assertEqual(recovered.returncode, 0, recovered.stdout + recovered.stderr)

            control_uninstall = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "uninstall.ps1"),
                                 "-SkillsRoot", str(home / ".agents" / "skills"), "-ContextRuntimeRoot", str(runtime),
                                 "-RemoveAfyxContext", "-Confirm:$false"]
            removed = subprocess.run(control_uninstall, env=environment, text=True, capture_output=True)
            self.assertEqual(removed.returncode, 0, removed.stdout + removed.stderr)
            self.assertFalse(runtime.exists())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "user-owned")

    @unittest.skipIf(os.name == "nt", "Unix lifecycle executes on Linux/macOS CI")
    def test_unix_install_verify_repeat_repair_and_uninstall(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-context-lifecycle-") as temporary:
            lab = Path(temporary)
            runtime = lab / "runtime"
            base = ["bash", str(SH_INSTALLER), "--runtime-root", str(runtime)]
            home = lab / "home"
            (home / ".vscode" / "extensions" / "openai.chatgpt-test").mkdir(parents=True)
            environment = {**os.environ, "HOME": str(home), "CI": "1"}
            control_install = ["bash", str(ROOT / "install.sh"), "--skills-root", str(home / ".agents" / "skills"),
                               "--context-runtime-root", str(runtime), "--component", "afyx-context=install"]
            installed = subprocess.run(control_install, env=environment, text=True, capture_output=True)
            self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
            self.assertEqual(subprocess.run(base + ["--verify"]).returncode, 0)
            control_verify = ["bash", str(ROOT / "verify.sh"), "--skills-root", str(home / ".agents" / "skills"),
                              "--context-runtime-root", str(runtime), "--preset", "custom", "--custom-component", "afyx-context"]
            self.assertEqual(subprocess.run(control_verify, env=environment).returncode, 0)
            before = digest(runtime / "metadata.json")
            self.assertEqual(subprocess.run(base).returncode, 0)
            control_update = ["bash", str(ROOT / "update.sh"), "--skip-self-update", "--skills-root", str(home / ".agents" / "skills"),
                              "--context-runtime-root", str(runtime), "--component", "afyx-context=update"]
            self.assertEqual(subprocess.run(control_update, env=environment).returncode, 0)
            self.assertEqual(digest(runtime / "metadata.json"), before)
            (runtime / "current" / "dist" / "index.js").write_text("modified", encoding="utf-8")
            self.assertNotEqual(subprocess.run(base + ["--update"]).returncode, 0)
            self.assertEqual(subprocess.run(base + ["--repair"]).returncode, 0)
            control_uninstall = ["bash", str(ROOT / "uninstall.sh"), "--skills-root", str(home / ".agents" / "skills"),
                                 "--context-runtime-root", str(runtime), "--remove-afyx-context"]
            self.assertEqual(subprocess.run(control_uninstall, env=environment).returncode, 0)
            self.assertFalse(runtime.exists())

    @unittest.skipUnless(os.name == "nt" and (shutil.which("pwsh") or shutil.which("powershell")),
                         "Windows PowerShell lifecycle requires a Windows host")
    def test_windows_foreign_and_ambiguous_destinations_are_nonmutating(self) -> None:
        shell = shutil.which("pwsh") or shutil.which("powershell")
        assert shell
        with tempfile.TemporaryDirectory(prefix="afyx-context-negative-") as temporary:
            runtime = Path(temporary) / "runtime"
            runtime.mkdir()
            sentinel = runtime / "sentinel.txt"
            sentinel.write_text("foreign", encoding="utf-8")
            command = [shell, "-NoProfile", "-NonInteractive", "-File", str(PS_INSTALLER), "-RuntimeRoot", str(runtime)]
            rejected = subprocess.run(command, text=True, capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "foreign")

            shutil.rmtree(runtime)
            self.assertEqual(subprocess.run(command, text=True, capture_output=True).returncode, 0)
            recovery = Path(f"{runtime}.afyx-old")
            shutil.copytree(runtime, recovery)
            runtime_hash = digest(runtime / "metadata.json")
            recovery_hash = digest(recovery / "metadata.json")
            ambiguous = subprocess.run(command + ["-Repair"], text=True, capture_output=True)
            self.assertNotEqual(ambiguous.returncode, 0)
            self.assertEqual(digest(runtime / "metadata.json"), runtime_hash)
            self.assertEqual(digest(recovery / "metadata.json"), recovery_hash)

    @unittest.skipUnless(os.name == "nt" and (shutil.which("pwsh") or shutil.which("powershell")),
                         "Windows PowerShell lifecycle requires a Windows host")
    def test_installer_idempotency_and_version_governance_windows(self) -> None:
        shell = shutil.which("pwsh") or shutil.which("powershell")
        assert shell
        with tempfile.TemporaryDirectory(prefix="afyx-context-idempotent-") as temporary:
            lab = Path(temporary)
            runtime = lab / "runtime"
            home = lab / "home"
            (home / ".codex").mkdir(parents=True)
            environment = fake_windows_codex_environment(home, lab)

            # 1. Install fresh instance
            control_install = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                               "-SkillsRoot", str(home / ".agents" / "skills"), "-ContextRuntimeRoot", str(runtime),
                               "-ComponentAction", "afyx-context=install", "-Confirm:$false"]
            installed = subprocess.run(control_install, env=environment, text=True, capture_output=True)
            self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
            metadata = json.loads((runtime / "metadata.json").read_text(encoding="utf-8"))
            initial_digest = digest(runtime / "metadata.json")

            # 2. Subsequent run with same version must SKIP (idempotent, no update loop)
            idempotent_cmd = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                              "-SkillsRoot", str(home / ".agents" / "skills"), "-ContextRuntimeRoot", str(runtime),
                              "-Preset", "custom", "-CustomComponent", "afyx-context", "-WhatIf"]
            preview = subprocess.run(idempotent_cmd, env=environment, text=True, capture_output=True)
            self.assertEqual(preview.returncode, 0, preview.stdout + preview.stderr)
            output = preview.stdout + preview.stderr
            self.assertIn("afyx-context - action=skip", output)
            self.assertIn("Afyx Context Engine - outcome=skipped", output)
            self.assertNotIn("afyx-context - action=update", output)
            self.assertEqual(digest(runtime / "metadata.json"), initial_digest)

            # 3. Corrupt/missing file triggers repair under -UpdateInstalled
            cli_js = runtime / "current" / "dist" / "cli.js"
            cli_backup = runtime / "current" / "dist" / "cli.js.bak"
            cli_js.rename(cli_backup)
            try:
                repair_preview = subprocess.run(idempotent_cmd + ["-UpdateInstalled"], env=environment, text=True, capture_output=True)
                self.assertEqual(repair_preview.returncode, 0, repair_preview.stdout + repair_preview.stderr)
                repair_output = repair_preview.stdout + repair_preview.stderr
                self.assertIn("afyx-context - action=repair", repair_output)
            finally:
                if cli_backup.exists():
                    cli_backup.rename(cli_js)

            # 4. Rollback and recovery verification on interrupted update (.afyx-old)
            recovery_dir = Path(f"{runtime}.afyx-old")
            runtime.rename(recovery_dir)
            self.assertTrue(recovery_dir.is_dir())
            self.assertFalse(runtime.exists())
            recover_cmd = [shell, "-NoProfile", "-NonInteractive", "-File", str(PS_INSTALLER), "-RuntimeRoot", str(runtime)]
            recovered = subprocess.run(recover_cmd, env=environment, text=True, capture_output=True)
            self.assertEqual(recovered.returncode, 0, recovered.stdout + recovered.stderr)
            self.assertTrue(runtime.is_dir())
            self.assertFalse(recovery_dir.exists())
            self.assertEqual(digest(runtime / "metadata.json"), initial_digest)


if __name__ == "__main__":
    unittest.main(verbosity=2)
