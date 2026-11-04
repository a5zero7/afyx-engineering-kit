#!/usr/bin/env python3
"""Focused AFYX-259 tests for the cross-platform artifact identity seam."""

from __future__ import annotations

import json
import hashlib
import os
import platform
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/afyx-graph-artifact.mjs"


def host_target() -> tuple[str, str]:
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    family = "win32" if os.name == "nt" else ("darwin" if platform.system() == "Darwin" else "linux")
    return family, f"{family}-{arch}"


def write(path: Path, text: str, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    if executable:
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def create_bundle(release: Path, revision: str) -> Path:
    family, target = host_target()
    name = f"afyx-graph-{target}"
    stage = release / "stage" / name
    metadata = {
        "product_name": "Afyx Graph",
        "product_version": "1.0.0",
        "cli": "afyx-graph",
        "release_channel": "technical-alpha",
        "supported_platforms": [target],
        "artifact_identity_schema": 1,
        "artifact_target": target,
        "source_revision": revision,
        "build_identity": f"git:{revision}",
        "extraction_version": 27,
    }
    write(stage / "metadata.json", json.dumps(metadata))
    write(stage / "LICENSE", "Synthetic MIT fixture\n")
    write(stage / "lib/package.json", json.dumps({"name": "@a5zero7/afyx-graph", "bin": {"afyx-graph": "./dist/bin/afyx-graph.js"}}))
    write(stage / "lib/dist/bin/afyx-graph.js", "console.log(process.argv[2] === '--version' ? '1.0.0' : 'help');\n")
    write(stage / "lib/dist/index.js", "exports.ok = true;\n")
    write(stage / "lib/dist/index.js.map", "{}\n")
    write(stage / "lib/dist/ui/shimmer-progress.js", "exports.ok = true;\n")
    write(stage / "lib/dist/extraction/extraction-version.js", "exports.EXTRACTION_VERSION = 27;\n")
    html = '<!doctype html><html><body><div id="app"></div><script src="./assets/index.js"></script>' + (" " * 180) + "</body></html>"
    write(stage / "lib/dist/viewer/index.html", html)
    write(stage / "lib/dist/viewer/assets/index.js", "console.log('fixture');\n")
    if family == "win32":
        write(stage / "bin/afyx-graph.cmd", '@echo off\r\nwhere node >nul 2>&1\r\nif errorlevel 1 echo Node.js was not found on PATH\r\nnode "%~dp0..\\lib\\dist\\bin\\afyx-graph.js" %*\r\n')
        archive = release / f"{name}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    bundle.write(path, path.relative_to(stage.parent))
    else:
        write(stage / "bin/afyx-graph", '#!/bin/sh\ncommand -v node >/dev/null 2>&1 || { echo "Node.js was not found on PATH" >&2; exit 1; }\nBUNDLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"\nexec node "$BUNDLE_DIR/lib/dist/bin/afyx-graph.js" "$@"\n', executable=True)
        archive = release / f"{name}.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(stage, arcname=name)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    write(release / "SHA256SUMS", f"{digest}  {archive.name}\n")
    shutil.rmtree(release / "stage")
    return archive


class ArtifactIdentityTests(unittest.TestCase):
    def run_tool(self, *args: str, expected: int = 0) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["node", str(SCRIPT), *args], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_stamp_match_mismatch_unknown_and_install_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            metadata = root / "metadata.json"
            archive = root / "bundle.zip"
            metadata.write_text(
                json.dumps({"product_name": "Afyx Graph", "product_version": "1.0.0", "release_channel": "technical-alpha"}),
                encoding="utf-8",
            )
            archive.write_bytes(b"synthetic-afyx-artifact")
            revision_a = "a" * 40
            revision_b = "b" * 40

            self.run_tool("stamp", "--metadata", str(metadata), "--target", "win32-x64", "--revision", revision_a, "--extraction-version", "27")
            match = self.run_tool("require-revision", "--metadata", str(metadata), "--requested-revision", revision_a)
            self.assertEqual(json.loads(match.stdout)["revisionStatus"], "MATCH")
            mismatch = self.run_tool("require-revision", "--metadata", str(metadata), "--requested-revision", revision_b, expected=3)
            self.assertEqual(json.loads(mismatch.stdout)["revisionStatus"], "REVISION_MISMATCH")

            self.run_tool("record-install", "--metadata", str(metadata), "--archive", str(archive), "--provenance", "explicit-archive", "--requested-revision", revision_b)
            installed = json.loads(metadata.read_text(encoding="utf-8"))
            self.assertEqual(installed["source_revision"], revision_a)
            self.assertEqual(installed["requested_checkout_revision"], revision_b)
            self.assertEqual(installed["revision_status"], "REVISION_MISMATCH")
            self.assertEqual(len(installed["archive_sha256"]), 64)

            installed.pop("source_revision")
            metadata.write_text(json.dumps(installed), encoding="utf-8")
            unknown = self.run_tool("require-revision", "--metadata", str(metadata), "--requested-revision", revision_b, expected=4)
            self.assertEqual(json.loads(unknown.stdout)["revisionStatus"], "UNKNOWN")

    def test_release_manifest_binds_digest_target_revision_and_version(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            release = Path(raw)
            revision = "c" * 40
            archive = create_bundle(release, revision)
            family, target = host_target()
            metadata = release / "metadata.json"
            write(metadata, json.dumps({
                "product_name": "Afyx Graph", "product_version": "1.0.0",
                "release_channel": "technical-alpha", "artifact_identity_schema": 1,
                "artifact_target": target, "source_revision": revision,
                "build_identity": f"git:{revision}", "extraction_version": 27,
            }))
            manifest = release / "RELEASE-MANIFEST.json"
            self.run_tool(
                "create-release-manifest", "--directory", str(release), "--output", str(manifest),
                "--revision", revision, "--version", "1.0.0", "--tag", "afyx-graph-v1.0.0",
            )
            verified = self.run_tool(
                "verify-release-manifest", "--manifest", str(manifest), "--archive", str(archive), "--metadata", str(metadata)
            )
            self.assertEqual(json.loads(verified.stdout)["status"], "VERIFIED")

            metadata_record = json.loads(metadata.read_text(encoding="utf-8"))
            metadata_record["artifact_target"] = "linux-arm64" if target != "linux-arm64" else "win32-x64"
            metadata.write_text(json.dumps(metadata_record), encoding="utf-8")
            wrong_target = self.run_tool(
                "verify-release-manifest", "--manifest", str(manifest), "--archive", str(archive),
                "--metadata", str(metadata), expected=1,
            )
            self.assertIn("target does not match", wrong_target.stderr)
            metadata_record["artifact_target"] = target
            metadata.write_text(json.dumps(metadata_record), encoding="utf-8")

            manifest_record = json.loads(manifest.read_text(encoding="utf-8"))
            manifest_record["source_revision"] = "d" * 40
            manifest.write_text(json.dumps(manifest_record), encoding="utf-8")
            wrong_revision = self.run_tool(
                "verify-release-manifest", "--manifest", str(manifest), "--archive", str(archive),
                "--metadata", str(metadata), expected=1,
            )
            self.assertIn("revision does not match", wrong_revision.stderr)
            manifest_record["source_revision"] = revision
            manifest_record["product_version"] = "9.9.9"
            manifest.write_text(json.dumps(manifest_record), encoding="utf-8")
            wrong_version = self.run_tool(
                "verify-release-manifest", "--manifest", str(manifest), "--archive", str(archive),
                "--metadata", str(metadata), expected=1,
            )
            self.assertIn("version does not match", wrong_version.stderr)
            manifest_record["product_version"] = "1.0.0"
            manifest.write_text(json.dumps(manifest_record), encoding="utf-8")

            archive.write_bytes(archive.read_bytes() + b"tampered")
            failed = self.run_tool(
                "verify-release-manifest", "--manifest", str(manifest), "--archive", str(archive), "--metadata", str(metadata), expected=1
            )
            self.assertIn("digest mismatch", failed.stderr)

    def test_matching_cache_installs_and_stale_cache_preserves_existing_runtime(self) -> None:
        current = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        installer = ROOT / "scripts" / ("install-afyx-graph.ps1" if os.name == "nt" else "install-afyx-graph.sh")
        shell = shutil.which("pwsh") if os.name == "nt" else (shutil.which("bash") or "/bin/bash")
        if not shell:
            self.skipTest("host lifecycle shell is unavailable")
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            release, runtime, public_bin = base / "release", base / "runtime", base / "bin"
            release.mkdir()
            create_bundle(release, current)
            self.run_tool(
                "create-release-manifest", "--directory", str(release), "--output", str(release / "RELEASE-MANIFEST.json"),
                "--revision", current, "--version", "1.0.0", "--tag", "afyx-graph-v1.0.0",
            )
            env = os.environ.copy()
            env.update({
                "AFYX_GRAPH_RELEASE_ROOT": str(release),
                "AFYX_GRAPH_RUNTIME_ROOT": str(runtime),
                "AFYX_GRAPH_BIN_DIR": str(public_bin),
            })
            command = ([shell, "-NoProfile", "-NonInteractive", "-File", str(installer), "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-Offline", "-NoBuildFallback"]
                       if os.name == "nt" else [shell, str(installer), "--offline", "--no-build-fallback"])
            installed = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
            metadata = json.loads((runtime / "metadata.json").read_text(encoding="utf-8-sig"))
            self.assertEqual(metadata["source_revision"], current)
            self.assertEqual(metadata["extraction_version"], 27)
            self.assertEqual(metadata["artifact_provenance"], "local-release-cache")
            self.assertEqual(metadata["revision_status"], "MATCH")
            self.assertEqual(metadata["release_manifest_status"], "VERIFIED")
            self.assertEqual(metadata["publisher_authenticity"], "UNVERIFIED")
            self.assertEqual(metadata["build_provenance"], "COMMIT_BOUND_MANIFEST")
            self.assertEqual(len(metadata["archive_sha256"]), 64)

            update_command = command + (["-Update"] if os.name == "nt" else ["--update"])
            updated = subprocess.run(update_command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(updated.returncode, 0, updated.stdout + updated.stderr)
            self.assertFalse(Path(f"{runtime}.afyx-old").exists())

            metadata["source_revision"] = "b" * 40
            write(runtime / "metadata.json", json.dumps(metadata))
            validate = ([shell, "-NoProfile", "-NonInteractive", "-File", str(installer), "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-ValidateOnly"]
                        if os.name == "nt" else [shell, str(installer), "--validate-only"])
            drift = subprocess.run(validate, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(drift.returncode, 0, drift.stdout + drift.stderr)
            self.assertIn("REVISION MISMATCH", drift.stdout)
            self.assertIn("UpdateAvailable", drift.stdout)

            old_metadata = {"product_name": "Afyx Graph", "product_version": "0.9.0", "sentinel": "preserve-me"}
            write(runtime / "metadata.json", json.dumps(old_metadata))
            create_bundle(release, "b" * 40)
            stale_command = command[:-1] + (["-Replace", "-NoBuildFallback"] if os.name == "nt" else ["--replace", "--no-build-fallback"])
            stale = subprocess.run(stale_command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(stale.returncode, 0)
            self.assertIn("valid but stale", (stale.stdout + stale.stderr).lower())
            preserved = json.loads((runtime / "metadata.json").read_text(encoding="utf-8-sig"))
            self.assertEqual(preserved["sentinel"], "preserve-me")

    def test_interrupted_graph_swap_recovers_owned_runtime_and_fails_closed(self) -> None:
        installer = ROOT / "scripts" / ("install-afyx-graph.ps1" if os.name == "nt" else "install-afyx-graph.sh")
        shell = shutil.which("pwsh") if os.name == "nt" else (shutil.which("bash") or "/bin/bash")
        if not shell:
            self.skipTest("host lifecycle shell unavailable")

        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            runtime = base / "runtime"
            recovery = Path(f"{runtime}.afyx-old")
            write(recovery / "metadata.json", json.dumps({
                "product_name": "Afyx Graph",
                "product_version": "0.9.0",
                "sentinel": "preserve-interrupted-runtime",
            }))
            if os.name == "nt":
                write(recovery / "current/bin/afyx-graph.cmd", "@echo off\r\nexit /b 0\r\n")
                update = [shell, "-NoProfile", "-NonInteractive", "-File", str(installer),
                          "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-Update",
                          "-Offline", "-ArchivePath", str(base / "missing.zip")]
                validate = [shell, "-NoProfile", "-NonInteractive", "-File", str(installer),
                            "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-ValidateOnly"]
            else:
                write(recovery / "current/bin/afyx-graph", "#!/bin/sh\nexit 0\n", executable=True)
                update = [shell, str(installer), "--update", "--offline", "--archive", str(base / "missing.tar.gz")]
                validate = [shell, str(installer), "--validate-only"]

            env = os.environ.copy()
            env.update({"AFYX_GRAPH_RUNTIME_ROOT": str(runtime), "AFYX_GRAPH_BIN_DIR": str(base / "bin")})
            recovered = subprocess.run(update, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(recovered.returncode, 0)
            self.assertIn("Recovered interrupted Afyx Graph transaction", recovered.stdout + recovered.stderr)
            self.assertTrue(runtime.is_dir())
            self.assertFalse(recovery.exists())
            restored = json.loads((runtime / "metadata.json").read_text(encoding="utf-8-sig"))
            self.assertEqual(restored["sentinel"], "preserve-interrupted-runtime")

            runtime.rename(recovery)
            refused_validate = subprocess.run(validate, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(refused_validate.returncode, 0)
            self.assertTrue(recovery.is_dir())
            self.assertFalse(runtime.exists())

            shutil.copytree(recovery, runtime)
            refused_ambiguous = subprocess.run(update, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(refused_ambiguous.returncode, 0)
            self.assertIn("ambiguous", (refused_ambiguous.stdout + refused_ambiguous.stderr).lower())
            self.assertTrue(runtime.is_dir())
            self.assertTrue(recovery.is_dir())

            def tree_fingerprint(root: Path) -> str:
                if not root.exists():
                    return "MISSING"
                digest = hashlib.sha256()
                for entry in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
                    relative = entry.relative_to(root).as_posix().encode("utf-8")
                    if entry.is_dir():
                        digest.update(b"D\0" + relative + b"\0")
                    elif entry.is_file():
                        digest.update(b"F\0" + relative + b"\0" + entry.read_bytes() + b"\0")
                    else:
                        digest.update(b"O\0" + relative + b"\0")
                return digest.hexdigest()

            ownership_cases = {
                "foreign": json.dumps({"product_name": "External Graph", "product_version": "0.9.0"}),
                "missing": None,
                "invalid": "{not-json",
            }
            for case, metadata_text in ownership_cases.items():
                case_runtime = base / case / "runtime"
                case_recovery = Path(f"{case_runtime}.afyx-old")
                write(case_recovery / "sentinel.bin", f"preserve-{case}\n")
                if metadata_text is not None:
                    write(case_recovery / "metadata.json", metadata_text)
                if os.name == "nt":
                    write(case_recovery / "current/bin/afyx-graph.cmd", "@echo off\r\nexit /b 0\r\n")
                    case_update = [shell, "-NoProfile", "-NonInteractive", "-File", str(installer),
                                   "-RuntimeRoot", str(case_runtime), "-SkipPathUpdate", "-Update",
                                   "-Offline", "-ArchivePath", str(base / "missing.zip")]
                else:
                    write(case_recovery / "current/bin/afyx-graph", "#!/bin/sh\nexit 0\n", executable=True)
                    case_update = [shell, str(installer), "--update", "--offline", "--archive",
                                   str(base / "missing.tar.gz")]

                recovery_before = tree_fingerprint(case_recovery)
                runtime_before = tree_fingerprint(case_runtime)
                case_env = env.copy()
                case_env["AFYX_GRAPH_RUNTIME_ROOT"] = str(case_runtime)
                refused = subprocess.run(case_update, cwd=ROOT, env=case_env, capture_output=True, text=True)
                self.assertNotEqual(refused.returncode, 0, case)
                self.assertIn("ownership cannot be verified", (refused.stdout + refused.stderr).lower(), case)
                self.assertEqual(tree_fingerprint(case_recovery), recovery_before, case)
                self.assertEqual(tree_fingerprint(case_runtime), runtime_before, case)

    def test_explicit_archive_preserves_unknown_revision_truthfully(self) -> None:
        installer = ROOT / "scripts" / ("install-afyx-graph.ps1" if os.name == "nt" else "install-afyx-graph.sh")
        shell = shutil.which("pwsh") if os.name == "nt" else (shutil.which("bash") or "/bin/bash")
        if not shell:
            self.skipTest("host lifecycle shell is unavailable")
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            release, runtime = base / "release", base / "runtime"
            release.mkdir()
            archive = create_bundle(release, "UNKNOWN")
            env = os.environ.copy()
            env.update({"AFYX_GRAPH_RUNTIME_ROOT": str(runtime), "AFYX_GRAPH_BIN_DIR": str(base / "bin")})
            command = ([shell, "-NoProfile", "-NonInteractive", "-File", str(installer), "-RuntimeRoot", str(runtime), "-SkipPathUpdate", "-Offline", "-ArchivePath", str(archive)]
                       if os.name == "nt" else [shell, str(installer), "--offline", "--archive", str(archive)])
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            installed = json.loads((runtime / "metadata.json").read_text(encoding="utf-8-sig"))
            self.assertEqual(installed["source_revision"], "UNKNOWN")
            self.assertEqual(installed["revision_status"], "UNKNOWN")
            self.assertEqual(installed["artifact_provenance"], "explicit-archive")
            self.assertEqual(installed["release_manifest_status"], "MISSING")
            self.assertEqual(installed["publisher_authenticity"], "UNVERIFIED")
            self.assertEqual(installed["build_provenance"], "UNVERIFIED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
