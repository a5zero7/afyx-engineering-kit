#!/usr/bin/env python3
"""Focused native Codex launcher resolution tests for Windows hosts."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "lib" / "AfyxComponents.psm1"


@unittest.skipUnless(os.name == "nt", "Codex launcher resolution is Windows-specific")
class CodexHostResolutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shells = [path for name in ("pwsh", "powershell") if (path := shutil.which(name))]
        if not cls.shells:
            raise unittest.SkipTest("PowerShell is unavailable")

    def resolve(self, shell: str, names: tuple[str, ...]) -> dict[str, str]:
        with tempfile.TemporaryDirectory(prefix="afyx-codex-resolver-") as raw:
            fake_bin = Path(raw)
            for name in names:
                (fake_bin / name).write_bytes(b"@exit /b 0\r\n" if name.endswith(".cmd") else b"")
            module_path = str(MODULE).replace("'", "''")
            script = (
                f"Import-Module '{module_path}' -Force; "
                "$result = Get-AfyxCodexHost; $result | ConvertTo-Json -Compress"
            )
            environment = {
                **os.environ,
                "PATH": str(fake_bin),
                "PATHEXT": ".COM;.EXE;.BAT;.CMD",
            }
            completed = subprocess.run(
                [shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
                cwd=ROOT,
                env=environment,
                text=True,
                capture_output=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertTrue(completed.stdout.strip(), completed.stderr or "resolver produced no JSON")
            return json.loads(completed.stdout)

    def test_native_exe_is_preferred_over_powershell_shim(self) -> None:
        for shell in self.shells:
            with self.subTest(shell=shell):
                result = self.resolve(shell, ("codex.exe", "codex.ps1"))
                self.assertEqual(result["State"], "CLI_READY")
                self.assertTrue(result["Path"].lower().endswith("codex.exe"))

    def test_cmd_launcher_is_supported_when_exe_is_absent(self) -> None:
        for shell in self.shells:
            with self.subTest(shell=shell):
                result = self.resolve(shell, ("codex.cmd",))
                self.assertEqual(result["State"], "CLI_READY")
                self.assertTrue(result["Path"].lower().endswith("codex.cmd"))

    def test_powershell_shim_is_rejected_with_actionable_state(self) -> None:
        for shell in self.shells:
            with self.subTest(shell=shell):
                result = self.resolve(shell, ("codex.ps1",))
                self.assertEqual(result["State"], "UNSUPPORTED_POWERSHELL_SHIM")
                self.assertTrue(result["Path"].lower().endswith("codex.ps1"))
                self.assertIn("codex.exe", result["Detail"])

    def test_absent_launcher_is_distinct_from_unsupported_shim(self) -> None:
        for shell in self.shells:
            with self.subTest(shell=shell):
                result = self.resolve(shell, ())
                self.assertEqual(result["State"], "CLI_NOT_FOUND")
                self.assertEqual(result["Path"], "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
