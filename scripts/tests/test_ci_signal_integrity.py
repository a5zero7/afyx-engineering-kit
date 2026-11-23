#!/usr/bin/env python3
"""Regression tests for required-command exit aggregation in Windows CI."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class CiSignalIntegrityTests(unittest.TestCase):
    def test_windows_required_command_blocks_are_aggregated(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        windows = workflow.split("  windows:\n", 1)[1].split("  macos:\n", 1)[0]
        self.assertEqual(windows.count("$commands = @("), 2)
        self.assertEqual(windows.count("foreach ($arguments in $commands)"), 2)
        self.assertEqual(windows.count("if ($LASTEXITCODE -ne 0) { $failed = $true }"), 2)
        self.assertEqual(windows.count("if ($failed) { exit 1 }"), 2)
        self.assertNotIn("continue-on-error", windows)

    def test_later_success_cannot_mask_required_failure(self) -> None:
        pwsh = shutil.which("pwsh") or shutil.which("powershell")
        if not pwsh:
            self.skipTest("PowerShell is unavailable")
        script = """
$commands = @(
  @('-c', 'import sys; sys.exit(7)'),
  @('-c', 'print("later-success")')
)
$failed = $false
foreach ($arguments in $commands) {
  & $env:AFYX_TEST_PYTHON @arguments
  if ($LASTEXITCODE -ne 0) { $failed = $true }
}
if ($failed) { exit 1 }
"""
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "aggregate.ps1"
            path.write_text(script, encoding="utf-8")
            result = subprocess.run(
                [pwsh, "-NoProfile", "-NonInteractive", "-File", str(path)],
                env={**os.environ, "AFYX_TEST_PYTHON": sys.executable},
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("later-success", result.stdout)

    def test_all_successful_required_commands_remain_successful(self) -> None:
        pwsh = shutil.which("pwsh") or shutil.which("powershell")
        if not pwsh:
            self.skipTest("PowerShell is unavailable")
        command = (
            "$failed=$false; "
            "& $env:AFYX_TEST_PYTHON -c 'print(\"first-success\")'; "
            "if ($LASTEXITCODE -ne 0) {$failed=$true}; "
            "& $env:AFYX_TEST_PYTHON -c 'print(\"second-success\")'; "
            "if ($LASTEXITCODE -ne 0) {$failed=$true}; "
            "if ($failed) {exit 1}"
        )
        result = subprocess.run(
            [pwsh, "-NoProfile", "-NonInteractive", "-Command", command],
            env={**os.environ, "AFYX_TEST_PYTHON": sys.executable},
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("first-success", result.stdout)
        self.assertIn("second-success", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
