#!/usr/bin/env python3
"""Focused lifecycle tests that never touch the user's installed components."""

from __future__ import annotations

import json
import os
import platform
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WINDOWS = os.name == "nt"
SELECTABLE = [
    "efficient-coding",
    "odoo-engineering",
    "afyx-engineering-expert",
    "afyx-graph",
    "afyx-context",
    "afyx-forge",
    "codex-usage-tracking",
]


def shell_path() -> str | None:
    if not WINDOWS:
        return shutil.which("bash") or "/bin/bash"
    found = shutil.which("bash")
    if found:
        return found
    for candidate in (Path("C:/Program Files/Git/bin/bash.exe"), Path("C:/Program Files/Git/usr/bin/bash.exe")):
        if candidate.is_file():
            return str(candidate)
    return None


def pwsh_path() -> str | None:
    return shutil.which("pwsh") or shutil.which("powershell")


def write(path: Path, text: str, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    if executable:
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


class LifecycleContractTests(unittest.TestCase):
    def test_selectable_components_and_prerequisite_classes(self) -> None:
        contract = json.loads((ROOT / "scripts/components.json").read_text(encoding="utf-8"))
        actual = [item["id"] for item in contract["components"]]
        self.assertEqual(actual, SELECTABLE)
        classes = {item["class"] for item in contract["prerequisites"]}
        self.assertEqual(classes, {"REQUIRED", "COMPONENT_REQUIRED", "BUILD_ONLY"})

    def test_update_entrypoints_do_not_apply_blanket_force(self) -> None:
        powershell = (ROOT / "update.ps1").read_text(encoding="utf-8")
        bash = (ROOT / "update.sh").read_text(encoding="utf-8")
        self.assertIn("-UpdateInstalled", powershell)
        self.assertNotIn(" $installer -SkillsRoot $SkillsRoot -Force", powershell)
        self.assertIn("--update-installed", bash)
        self.assertNotIn('install.sh" --force', bash)

    def test_offline_mode_skips_self_update(self) -> None:
        ps_update = (ROOT / "update.ps1").read_text(encoding="utf-8")
        sh_update = (ROOT / "update.sh").read_text(encoding="utf-8")
        self.assertIn("Offline mode: self-update skipped", ps_update)
        self.assertIn("Offline mode: self-update skipped", sh_update)

    def test_release_channel_is_distribution_metadata(self) -> None:
        operational = json.loads((ROOT / "afyx-graph/afyx-graph.json").read_text(encoding="utf-8"))
        distribution = json.loads((ROOT / "afyx-graph/engine/scripts/distribution-product.json").read_text(encoding="utf-8"))
        self.assertNotIn("release_channel", operational)
        self.assertEqual(distribution["releaseChannel"], "technical-alpha")
        for relative in ("scripts/install-afyx-graph.ps1", "scripts/install-afyx-graph.sh"):
            source = (ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("release_channel", source)
            self.assertIn("local build", source.lower())

    def test_dry_run_does_not_create_component_roots(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            skills, graph, codex, fake_bin = base / "skills", base / "graph", base / "codex", base / "bin"
            fake_bin.mkdir()
            env = os.environ.copy()
            env.update({"HOME": raw, "USERPROFILE": raw, "CODEX_HOME": str(codex), "AFYX_GRAPH_RUNTIME_ROOT": str(graph)})
            env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")
            if WINDOWS:
                shell = pwsh_path()
                if not shell:
                    self.skipTest("PowerShell is unavailable")
                write(fake_bin / "codex.cmd", "@echo codex-test\r\n")
                command = [
                    shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                    "-SkillsRoot", str(skills), "-WhatIf", "-ComponentAction", "afyx-graph=install",
                ]
            else:
                shell = shell_path()
                if not shell:
                    self.skipTest("Bash is unavailable")
                write(fake_bin / "codex", "#!/bin/sh\necho codex-test\n", executable=True)
                command = [
                    shell, str(ROOT / "install.sh"), "--skills-root", str(skills), "--dry-run",
                    "--component", "afyx-graph=install",
                ]
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertFalse(skills.exists())
            self.assertFalse(graph.exists())
            self.assertFalse(codex.exists())

    def test_incompatible_node_fails_before_installation(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            runtime, fake_bin = base / "graph", base / "bin"
            fake_bin.mkdir()
            env = os.environ.copy()
            env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")
            if WINDOWS:
                shell = pwsh_path()
                if not shell:
                    self.skipTest("PowerShell is unavailable")
                write(fake_bin / "node.cmd", "@echo v20.0.0\r\n")
                command = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "scripts/install-afyx-graph.ps1"), "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-Offline"]
            else:
                shell = shell_path()
                if not shell:
                    self.skipTest("Bash is unavailable")
                write(fake_bin / "node", "#!/bin/sh\necho v20.0.0\n", executable=True)
                command = [shell, str(ROOT / "scripts/install-afyx-graph.sh"), "--offline"]
                env["AFYX_GRAPH_RUNTIME_ROOT"] = str(runtime)
                env["AFYX_GRAPH_BIN_DIR"] = str(base / "public-bin")
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("22.5", result.stdout + result.stderr)
            self.assertFalse(runtime.exists())

    def test_checksum_failure_preserves_owned_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            runtime, fake_bin = base / "graph", base / "bin"
            fake_bin.mkdir()
            metadata = '{"product_name":"Afyx Graph","product_version":"0.9.0"}\n'
            write(runtime / "metadata.json", metadata)
            system = platform.system().lower()
            machine = platform.machine().lower()
            arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
            if WINDOWS:
                shell = pwsh_path()
                if not shell:
                    self.skipTest("PowerShell is unavailable")
                write(fake_bin / "node.cmd", "@echo v22.5.0\r\n")
                write(runtime / "current/bin/afyx-graph.cmd", "@echo 0.9.0\r\n")
                asset = base / f"afyx-graph-win32-{arch}.zip"
                command = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "scripts/install-afyx-graph.ps1"), "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-Replace", "-ArchivePath", str(asset)]
            else:
                shell = shell_path()
                if not shell:
                    self.skipTest("Bash is unavailable")
                write(fake_bin / "node", "#!/bin/sh\necho v22.5.0\n", executable=True)
                write(runtime / "current/bin/afyx-graph", "#!/bin/sh\necho 0.9.0\n", executable=True)
                target_os = "darwin" if system == "darwin" else "linux"
                asset = base / f"afyx-graph-{target_os}-{arch}.tar.gz"
                command = [shell, str(ROOT / "scripts/install-afyx-graph.sh"), "--replace", "--archive", str(asset)]
            asset.write_bytes(b"not a valid artifact")
            write(base / "SHA256SUMS", "0" * 64 + f"  {asset.name}\n")
            env = os.environ.copy()
            env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")
            env["AFYX_GRAPH_RUNTIME_ROOT"] = str(runtime)
            env["AFYX_GRAPH_BIN_DIR"] = str(base / "public-bin")
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checksum mismatch", (result.stdout + result.stderr).lower())
            self.assertEqual((runtime / "metadata.json").read_text(encoding="utf-8"), metadata)
            self.assertTrue((runtime / ("current/bin/afyx-graph.cmd" if WINDOWS else "current/bin/afyx-graph")).is_file())

    def test_user_owned_runtime_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            runtime = base / "graph"
            write(runtime / "metadata.json", '{"product_name":"Another Product","product_version":"1.0.0"}\n')
            if WINDOWS:
                shell = pwsh_path()
                if not shell:
                    self.skipTest("PowerShell is unavailable")
                write(runtime / "current/bin/afyx-graph.cmd", "@echo external\r\n")
                command = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "scripts/install-afyx-graph.ps1"), "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-Replace", "-Offline"]
            else:
                shell = shell_path()
                if not shell:
                    self.skipTest("Bash is unavailable")
                write(runtime / "current/bin/afyx-graph", "#!/bin/sh\necho external\n", executable=True)
                command = [shell, str(ROOT / "scripts/install-afyx-graph.sh"), "--replace", "--offline"]
            env = os.environ.copy()
            env["AFYX_GRAPH_RUNTIME_ROOT"] = str(runtime)
            env["AFYX_GRAPH_BIN_DIR"] = str(base / "public-bin")
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            output = " ".join((result.stdout + result.stderr).split())
            self.assertIn("ownership", output)
            self.assertIn("verified", output)
            self.assertIn("Another Product", (runtime / "metadata.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
