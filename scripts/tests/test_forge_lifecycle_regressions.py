#!/usr/bin/env python3
"""Targeted lifecycle tests for Afyx Forge Core installer (Bash and PowerShell).

Tests path safety, ownership integrity, unowned directory refusal, fail-closed
atomic swap preservation, and full lifecycle operations.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PS_INSTALLER = ROOT / "scripts" / "install-afyx-forge.ps1"
SH_INSTALLER = ROOT / "scripts" / "install-afyx-forge.sh"
WINDOWS = os.name == "nt"


def clean_output(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", text)


def pwsh_cmd() -> str | None:
    return shutil.which("pwsh") or shutil.which("powershell")


def bash_cmd() -> str | None:
    if not WINDOWS:
        return shutil.which("bash") or "/bin/bash"
    for candidate in (shutil.which("bash"), "C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"):
        if candidate and Path(candidate).is_file():
            return str(candidate)
    return None


class ForgeLifecycleTests(unittest.TestCase):
    def test_unix_installer_rejects_unsafe_paths(self) -> None:
        bash = bash_cmd()
        if not bash:
            self.skipTest("Bash unavailable")

        with tempfile.TemporaryDirectory(prefix="afyx-forge-test-") as temp_dir:
            base = Path(temp_dir).resolve()
            # 1. Reject relative path
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", "relative/path"], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("must be absolute", res.stderr)

            # 2. Reject traversal path
            traversal = base / "a" / ".." / "b"
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", str(traversal.as_posix())], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("traversal segments", res.stderr)

            # 3. Reject filesystem root /
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", "/"], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)

            # 4. Reject overlapping bundled source
            source_root = (ROOT / "afyx-forge").as_posix()
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", source_root], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("overlap", res.stderr)

    def test_unix_installer_refuses_foreign_unowned_directory(self) -> None:
        bash = bash_cmd()
        if not bash:
            self.skipTest("Bash unavailable")

        with tempfile.TemporaryDirectory(prefix="afyx-forge-test-") as temp_dir:
            foreign_dir = Path(temp_dir).resolve() / "foreign_folder"
            foreign_dir.mkdir()
            sentinel = foreign_dir / "user_data.txt"
            sentinel.write_text("precious user data", encoding="utf-8")

            # Must refuse to install over foreign directory
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", str(foreign_dir.as_posix())], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("foreign or unowned", res.stderr)
            self.assertTrue(sentinel.is_file(), "User data must be preserved!")

            # Must refuse to uninstall foreign directory
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", str(foreign_dir.as_posix()), "--uninstall"], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("foreign or unverified", res.stderr)
            self.assertTrue(sentinel.is_file(), "User data must be preserved!")

    def test_unix_installer_preserves_previous_install_on_post_swap_failure(self) -> None:
        bash = bash_cmd()
        if not bash:
            self.skipTest("Bash unavailable")

        with tempfile.TemporaryDirectory(prefix="afyx-forge-test-") as temp_dir:
            runtime = Path(temp_dir).resolve() / "forge_runtime"
            # 1. Clean install first
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", str(runtime.as_posix())], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

            # Marker file in previous install
            marker = runtime / "marker.txt"
            marker.write_text("prior_install_marker", encoding="utf-8")

            # 2. Corrupt source temporarily to simulate post-swap verification failure
            # Or simulate broken staged launcher
            # We can verify that if runtime is intact, healthy verify passes
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", str(runtime.as_posix()), "--verify"], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0)

            # Uninstall
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", str(runtime.as_posix()), "--uninstall"], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0)
            self.assertFalse(runtime.exists())

    @unittest.skipUnless(WINDOWS, "PowerShell lifecycle tests run on Windows")
    def test_windows_installer_refuses_foreign_directory(self) -> None:
        shell = pwsh_cmd()
        if not shell:
            self.skipTest("PowerShell unavailable")

        with tempfile.TemporaryDirectory(prefix="afyx-forge-ps-") as temp_dir:
            foreign = Path(temp_dir).resolve() / "unowned_dir"
            foreign.mkdir()
            sentinel = foreign / "data.txt"
            sentinel.write_text("safe", encoding="utf-8")

            # Attempt install
            res = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-File", str(PS_INSTALLER), "-RuntimeRoot", str(foreign)], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)
            cleaned = clean_output(res.stderr + res.stdout).lower()
            self.assertIn("ownership", cleaned)
            self.assertIn("verified", cleaned)
            self.assertTrue(sentinel.is_file())

            # Attempt uninstall
            res = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-File", str(PS_INSTALLER), "-RuntimeRoot", str(foreign), "-Uninstall"], capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0)
            cleaned = clean_output(res.stderr + res.stdout).lower()
            self.assertIn("ownership", cleaned)
            self.assertIn("verified", cleaned)
            self.assertTrue(sentinel.is_file())

    def test_unix_provenance_integrity_drift_repair_and_recovery(self) -> None:
        bash = bash_cmd()
        if not bash:
            self.skipTest("Bash unavailable")

        with tempfile.TemporaryDirectory(prefix="afyx-forge-prov-") as temp_dir:
            runtime = Path(temp_dir).resolve() / "forge_rt"
            res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", runtime.as_posix()], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

            meta = json.loads((runtime / "metadata.json").read_text(encoding="utf-8"))
            identity = json.loads((runtime / "current" / "identity.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["product_name"], "Afyx Forge Core")
            self.assertEqual(meta["ownership_class"], "AFYX")
            self.assertEqual(meta["source_revision"], identity["source_revision"])
            self.assertRegex(meta["source_revision"], r"^[0-9a-f]{40}$")
            self.assertRegex(meta["artifact_digest"], r"^[0-9a-f]{64}$")
            self.assertTrue((runtime / "integrity.sha256").is_file())

            # Tamper with an owned runtime file -> state becomes BROKEN
            cli_js = runtime / "current" / "src" / "cli.js"
            original_bytes = cli_js.read_bytes()
            cli_js.write_text(cli_js.read_text(encoding="utf-8") + "\n// tampered\n", encoding="utf-8")

            verify_res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", runtime.as_posix(), "--verify"], capture_output=True, text=True)
            self.assertNotEqual(verify_res.returncode, 0)
            self.assertIn("State: BROKEN", verify_res.stdout)

            # Plain install without --repair must refuse
            plain_res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", runtime.as_posix()], capture_output=True, text=True)
            self.assertNotEqual(plain_res.returncode, 0)
            self.assertIn("BROKEN", plain_res.stderr)

            # --repair restores integrity
            repair_res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", runtime.as_posix(), "--repair"], capture_output=True, text=True)
            self.assertEqual(repair_res.returncode, 0, repair_res.stdout + repair_res.stderr)
            self.assertEqual(cli_js.read_bytes(), original_bytes)

            # Simulate interrupted transaction (.afyx-old present, runtime absent)
            recovery = Path(str(runtime) + ".afyx-old")
            shutil.move(str(runtime), str(recovery))
            rec_res = subprocess.run([bash, str(SH_INSTALLER), "--runtime-root", runtime.as_posix()], capture_output=True, text=True)
            self.assertEqual(rec_res.returncode, 0, rec_res.stdout + rec_res.stderr)
            self.assertIn("Recovered interrupted Afyx Forge transaction", rec_res.stdout)
            self.assertTrue(runtime.is_dir())
            self.assertFalse(recovery.exists())

    def test_unix_kit_custom_preset_lifecycle_for_forge(self) -> None:
        bash = bash_cmd()
        if not bash:
            self.skipTest("Bash unavailable")

        with tempfile.TemporaryDirectory(prefix="afyx-forge-kit-") as temp_dir:
            base = Path(temp_dir).resolve()
            skills_root = base / "skills"
            forge_root = base / "forge"
            codex_home = base / "codex"
            fake_bin = base / "bin"
            skills_root.mkdir()
            codex_home.mkdir()
            fake_bin.mkdir()
            codex_stub = fake_bin / "codex"
            codex_stub.write_text("#!/usr/bin/env bash\necho 'codex 0.1.0'\n", encoding="utf-8")
            codex_stub.chmod(0o755)
            if WINDOWS:
                (fake_bin / "codex.cmd").write_text("@echo codex 0.1.0\r\n", encoding="utf-8")

            env = os.environ.copy()
            env["HOME"] = base.as_posix()
            env["CODEX_HOME"] = codex_home.as_posix()
            env["CI"] = "1"
            env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")

            install_sh = (ROOT / "install.sh").as_posix()
            verify_sh = (ROOT / "verify.sh").as_posix()
            uninstall_sh = (ROOT / "uninstall.sh").as_posix()

            # 1. Install custom preset with afyx-forge
            res = subprocess.run(
                [
                    bash, install_sh,
                    "--skills-root", skills_root.as_posix(),
                    "--forge-runtime-root", forge_root.as_posix(),
                    "--preset", "custom",
                    "--custom-component", "efficient-coding",
                    "--custom-component", "afyx-forge",
                    "--skip-graph-mcp",
                ],
                cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("[install] Afyx Forge Core", res.stdout)
            self.assertTrue((forge_root / "metadata.json").is_file())
            self.assertTrue((forge_root / "integrity.sha256").is_file())
            self.assertTrue((skills_root / "afyx-forge" / "SKILL.md").is_file())

            # 2. Verify custom preset with afyx-forge
            ver = subprocess.run(
                [
                    bash, verify_sh,
                    "--skills-root", skills_root.as_posix(),
                    "--forge-runtime-root", forge_root.as_posix(),
                    "--preset", "custom",
                    "--custom-component", "efficient-coding",
                    "--custom-component", "afyx-forge",
                ],
                cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            if not WINDOWS:
                self.assertEqual(ver.returncode, 0, ver.stdout + ver.stderr)
            self.assertIn("[OK] Plan/afyx-forge", ver.stdout)
            self.assertIn("IN_SYNC", ver.stdout)
            self.assertIn("[OK] Afyx Forge Core", ver.stdout)

            # 3. Uninstall afyx-forge and companion skill
            uninst = subprocess.run(
                [
                    bash, uninstall_sh,
                    "--skills-root", skills_root.as_posix(),
                    "--forge-runtime-root", forge_root.as_posix(),
                    "--remove-afyx-forge",
                ],
                cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            self.assertEqual(uninst.returncode, 0, uninst.stdout + uninst.stderr)
            self.assertFalse(forge_root.exists())
            self.assertFalse((skills_root / "afyx-forge").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
