"""Source checkout and packaged Forge provenance contracts; disposable runtimes."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ForgeSourceRevisionTests(unittest.TestCase):
    def shells(self):
        if os.name == "nt":
            shell = shutil.which("pwsh") or shutil.which("powershell")
            return [(shell, "ps1")] if shell else []
        return [(shutil.which("bash") or "/bin/bash", "sh")]

    def invoke(self, shell, extension, package, runtime, *extra):
        if extension == "ps1":
            args = [shell, "-NoProfile", "-File", str(package / "scripts/install-afyx-forge.ps1"),
                    "-RuntimeRoot", str(runtime), *extra]
        else:
            args = [shell, str(package / "scripts/install-afyx-forge.sh"), "--runtime-root", str(runtime), *extra]
        return subprocess.run(args, cwd=package, capture_output=True, text=True, timeout=30)

    def package(self, root, marker):
        package = root / "package"
        (package / "scripts").mkdir(parents=True)
        for name in ["install-afyx-forge.sh", "install-afyx-forge.ps1", "afyx-forge-artifact.mjs"]:
            shutil.copyfile(ROOT / "scripts" / name, package / "scripts" / name)
        shutil.copytree(ROOT / "afyx-forge", package / "afyx-forge", ignore=shutil.ignore_patterns("test"))
        (package / ".afyx-source-revision").write_text(marker, encoding="utf-8")
        return package

    def test_checkout_uses_git_head_instead_of_unexpanded_archive_placeholder(self):
        expected = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
        for shell, extension in self.shells():
            with self.subTest(shell=shell), tempfile.TemporaryDirectory(prefix="afyx-forge-head-") as raw:
                runtime = Path(raw).resolve() / "runtime"
                result = self.invoke(shell, extension, ROOT, runtime)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                metadata = json.loads((runtime / "metadata.json").read_text())
                self.assertEqual(metadata["source_revision"], expected)
                self.assertIn(metadata["build_provenance"], {"LOCAL_SOURCE_CLEAN", "LOCAL_SOURCE_DIRTY"})

    def test_package_marker_is_validated_and_invalid_repair_preserves_runtime(self):
        revision = "1" * 40
        for shell, extension in self.shells():
            with self.subTest(shell=shell), tempfile.TemporaryDirectory(prefix="afyx-forge-marker-") as raw:
                root = Path(raw).resolve()
                package = self.package(root, revision + "\n")
                runtime = root / "runtime"
                installed = self.invoke(shell, extension, package, runtime)
                self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
                before = {p.relative_to(runtime).as_posix(): p.read_bytes() for p in runtime.rglob("*") if p.is_file()}
                metadata = json.loads((runtime / "metadata.json").read_text())
                self.assertEqual(metadata["source_revision"], revision)
                self.assertEqual(metadata["build_provenance"], "RELEASE_CANDIDATE_SNAPSHOT")
                for invalid in ["$Format:%H$", "z" * 40, "1" * 39]:
                    (package / ".afyx-source-revision").write_text(invalid, encoding="utf-8")
                    result = self.invoke(shell, extension, package, runtime,
                                         "-Update" if extension == "ps1" else "--update")
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn("source revision marker is invalid", (result.stdout + result.stderr).lower())
                    self.assertEqual(before, {p.relative_to(runtime).as_posix(): p.read_bytes()
                                             for p in runtime.rglob("*") if p.is_file()})


if __name__ == "__main__":
    unittest.main(verbosity=2)
