"""Installed Graph archive resolution against a disposable source checkout."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.name == "nt", "Windows Graph installer contract")
class GraphArchiveResolutionTests(unittest.TestCase):
    def test_build_cache_explicit_and_native_failure(self) -> None:
        shell = shutil.which("pwsh")
        if not all(shutil.which(name) for name in ("git", "tar", "node", "npm")) or not shell:
            self.skipTest("Git, tar, Node.js, npm, and PowerShell 7 are required")

        with tempfile.TemporaryDirectory(prefix="afyx-graph-archive-") as raw:
            base = Path(raw)
            kit = base / "kit"
            kit.mkdir()
            archive = subprocess.run(
                ["git", "archive", "HEAD", "afyx-graph", "scripts"],
                cwd=ROOT, check=True, capture_output=True,
            )
            subprocess.run(["tar", "-xf", "-", "-C", str(kit)], input=archive.stdout, check=True, capture_output=True)
            subprocess.run(["git", "init", "-q"], cwd=kit, check=True, capture_output=True)
            subprocess.run(["git", "add", "-A"], cwd=kit, check=True, capture_output=True)
            subprocess.run(
                ["git", "-c", "user.name=Afyx Test", "-c", "user.email=afyx-test@example.invalid", "commit", "-qm", "fixture"],
                cwd=kit, check=True, capture_output=True,
            )
            shutil.copy2(ROOT / "scripts" / "install-afyx-graph.ps1", kit / "scripts" / "install-afyx-graph.ps1")

            env = os.environ.copy()
            env["USERPROFILE"] = str(base / "profile")
            env["npm_config_cache"] = str(base / "npm-cache")
            env["AFYX_GRAPH_RELEASE_ROOT"] = str(base / "release")
            installer = kit / "scripts" / "install-afyx-graph.ps1"

            def install(name: str, *, explicit: Path | None = None, custom_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
                args = [shell, "-NoProfile", "-NonInteractive", "-File", str(installer),
                        "-RuntimeRoot", str(base / name), "-SkipPathUpdate", "-SkipMcp", "-Offline"]
                if explicit is not None:
                    args.extend(["-ArchivePath", str(explicit)])
                result = subprocess.run(args, cwd=kit, env=custom_env or env, text=True,
                                        capture_output=True, timeout=240)
                (base / f"{name}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
                return result

            built = install("runtime-build")
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            self.assertIn("Artifact source: local-build", built.stdout)
            architecture = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
            asset = base / "release" / f"afyx-graph-win32-{architecture}.zip"
            self.assertTrue(asset.is_file())
            checksum = hashlib.sha256(asset.read_bytes()).hexdigest()
            self.assertIn(checksum, (base / "release" / "SHA256SUMS").read_text(encoding="ascii"))

            cached = install("runtime-cache")
            self.assertEqual(cached.returncode, 0, cached.stdout + cached.stderr)
            self.assertIn("Artifact source: local-release-cache", cached.stdout)

            explicit_result = install("runtime-explicit", explicit=asset)
            self.assertEqual(explicit_result.returncode, 0, explicit_result.stdout + explicit_result.stderr)
            self.assertIn("Artifact source: explicit-archive", explicit_result.stdout)

            malformed_dir = base / "malformed-release"
            malformed_dir.mkdir()
            malformed_asset = malformed_dir / asset.name
            replaced_metadata = 0
            with zipfile.ZipFile(asset) as source_zip, zipfile.ZipFile(malformed_asset, "w") as malformed_zip:
                for member in source_zip.infolist():
                    data = source_zip.read(member.filename)
                    normalized = member.filename.replace("\\", "/")
                    if normalized == f"afyx-graph-win32-{architecture}/metadata.json":
                        data = b"{}"
                        replaced_metadata += 1
                    malformed_zip.writestr(member, data)
            self.assertEqual(replaced_metadata, 1)
            malformed_hash = hashlib.sha256(malformed_asset.read_bytes()).hexdigest()
            (malformed_dir / "SHA256SUMS").write_text(f"{malformed_hash} {asset.name}\n", encoding="ascii")
            malformed = install("runtime-malformed", explicit=malformed_asset)
            self.assertNotEqual(malformed.returncode, 0)
            self.assertFalse((base / "runtime-malformed" / "current").exists())

            fake_bin = base / "fake-bin"
            fake_bin.mkdir()
            (fake_bin / "npm.cmd").write_text(
                "@echo off\r\necho AFYX_SYNTHETIC_BUILD_FAILURE 1>&2\r\nexit /b 23\r\n", encoding="ascii"
            )
            rejected_env = env.copy()
            rejected_env["PATH"] = str(fake_bin) + os.pathsep + env.get("PATH", "")
            rejected_env["AFYX_GRAPH_RELEASE_ROOT"] = str(base / "failed-release")
            rejected = install("runtime-failed", custom_env=rejected_env)
            failure_text = rejected.stdout + rejected.stderr
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("npm ci failed", failure_text)
            self.assertIn("Log:", failure_text)
            log_match = re.search(r"([A-Za-z]:\\[^\s]+afyx-graph-installer-[0-9a-f]+\.log)", failure_text)
            self.assertIsNotNone(log_match, failure_text)
            diagnostic = Path(log_match.group(1))
            self.assertIn("AFYX_SYNTHETIC_BUILD_FAILURE", diagnostic.read_text(errors="replace"))
            self.assertFalse((base / "runtime-failed" / "current").exists())


if __name__ == "__main__":
    unittest.main()
