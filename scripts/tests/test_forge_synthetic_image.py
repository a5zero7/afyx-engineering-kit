#!/usr/bin/env python3
"""Focused source tests for the public Forge synthetic image fixture."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/build_forge_synthetic_image.py"
SPEC = importlib.util.spec_from_file_location("forge_synthetic_image", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)


class ForgeSyntheticImageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="afyx-fixture-test-")
        self.root = Path(self.temporary.name)
        self.compiler = Path("/usr/bin/gcc")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def build(self, name: str = "forge-synthetic-cell") -> Path:
        output = self.root / name
        fixture.build_fixture(self.compiler, output)
        return output

    def test_fixture_build_is_reproducible_static_x86_64(self) -> None:
        first = self.build("first")
        second = self.build("second")
        self.assertEqual(
            fixture.verify_elf_x86_64(first), fixture.verify_elf_x86_64(second)
        )
        argv = fixture.compiler_argv(self.compiler, first)
        self.assertIn("-static", argv)
        self.assertNotIn("-march=native", argv)

    def test_fixture_emits_exact_bounded_public_streams(self) -> None:
        executable = self.build()
        completed = subprocess.run(
            (str(executable), "--mode", "public-synthetic"),
            capture_output=True,
            check=False,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, fixture.EXPECTED_STDOUT)
        self.assertEqual(completed.stderr, fixture.EXPECTED_STDERR)

    def test_fixture_rejects_argument_drift(self) -> None:
        executable = self.build()
        for arguments in ((), ("--mode",), ("--mode", "other"), ("extra",)):
            with self.subTest(arguments=arguments):
                completed = subprocess.run(
                    (str(executable), *arguments),
                    capture_output=True,
                    check=False,
                    timeout=5,
                )
                self.assertEqual(completed.returncode, 64)
                self.assertEqual(completed.stdout, b"")
                self.assertEqual(completed.stderr, fixture.EXPECTED_ARGUMENT_ERROR)

    def test_fixture_syscalls_are_present_in_frozen_seccomp_allowlist(self) -> None:
        profile = json.loads(
            (ROOT / "evals/forge/policies/synthetic-seccomp-v1.json").read_text(
                "utf-8"
            )
        )
        allowed = {
            name
            for rule in profile["syscalls"]
            if rule["action"] == "SCMP_ACT_ALLOW"
            for name in rule["names"]
        }
        self.assertTrue({"write", "exit_group"} <= allowed)

    def test_containerfile_is_scratch_non_root_and_fixed(self) -> None:
        text = fixture.CONTAINERFILE.read_text("utf-8")
        fixture.validate_containerfile(text)
        self.assertEqual(text.count("FROM "), 1)
        self.assertNotIn("latest", text)

    def test_containerfile_drift_is_rejected(self) -> None:
        original = fixture.CONTAINERFILE.read_text("utf-8")
        for changed in (
            original.replace("FROM scratch", "FROM alpine"),
            original + "\nRUN true\n",
            original.replace("USER 65532:65532", "USER 0:0"),
        ):
            with self.subTest(changed=changed), self.assertRaises(
                fixture.FixtureBuildError
            ):
                fixture.validate_containerfile(changed)

    def test_containerfile_rejects_additional_stage_or_copy(self) -> None:
        original = fixture.CONTAINERFILE.read_text("utf-8")
        for directive in (
            "FROM scratch",
            "COPY unexpected /opt/afyx/bin/unexpected",
        ):
            with self.subTest(directive=directive), self.assertRaises(
                fixture.FixtureBuildError
            ):
                fixture.validate_containerfile(f"{original}\n{directive}\n")

    def test_containerfile_rejects_duplicate_or_overridden_runtime_directives(
        self,
    ) -> None:
        original = fixture.CONTAINERFILE.read_text("utf-8")
        directives = (
            'ENTRYPOINT ["/opt/afyx/bin/forge-synthetic-cell"]',
            'ENTRYPOINT ["/bin/other"]',
            'CMD ["--mode", "public-synthetic"]',
            'CMD ["--mode", "other"]',
            "USER 65532:65532",
            "USER 0:0",
        )
        for directive in directives:
            with self.subTest(directive=directive), self.assertRaises(
                fixture.FixtureBuildError
            ):
                fixture.validate_containerfile(f"{original}\n{directive}\n")

    def test_containerfile_comment_and_whitespace_rules_are_explicit(self) -> None:
        original = fixture.CONTAINERFILE.read_text("utf-8")
        fixture.validate_containerfile(
            f"  # ordinary full-line comment\n\n{original}\n  # trailing comment\n"
        )
        for changed in (
            original.replace("FROM scratch", "FROM scratch # inline comment"),
            "# syntax=docker/dockerfile:1\n" + original,
            original.replace(
                'LABEL org.opencontainers.image.title="Afyx Forge public synthetic cell" \\\n',
                'LABEL org.opencontainers.image.title="Afyx Forge public synthetic cell" \\\n# interrupted\n',
            ),
            original + "\\\n",
        ):
            with self.subTest(changed=changed), self.assertRaises(
                fixture.FixtureBuildError
            ):
                fixture.validate_containerfile(changed)

    def test_image_metadata_yields_only_verified_pinned_reference(self) -> None:
        digest = "a" * 64
        result = fixture.verify_image_metadata(
            {
                "Id": "sha256:" + "b" * 64,
                "Architecture": "amd64",
                "Os": "linux",
                "RepoDigests": ["registry.example.invalid/afyx/forge@sha256:" + digest],
                "Config": {
                    "User": "65532:65532",
                    "Entrypoint": ["/opt/afyx/bin/forge-synthetic-cell"],
                    "Cmd": ["--mode", "public-synthetic"],
                },
            }
        )
        self.assertEqual(
            result["launcher_references"],
            ["registry.example.invalid/afyx/forge@sha256:" + digest],
        )

    def test_image_metadata_drift_is_rejected(self) -> None:
        base = {
            "Id": "sha256:" + "b" * 64,
            "Architecture": "amd64",
            "Os": "linux",
            "RepoDigests": [],
            "Config": {
                "User": "65532:65532",
                "Entrypoint": ["/opt/afyx/bin/forge-synthetic-cell"],
                "Cmd": ["--mode", "public-synthetic"],
            },
        }
        for key, value in (
            ("Architecture", "arm64"),
            ("Os", "windows"),
            ("Id", "not-a-digest"),
        ):
            changed = dict(base)
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(fixture.FixtureBuildError):
                fixture.verify_image_metadata(changed)
        changed = dict(base)
        changed["Config"] = dict(base["Config"], User="0:0")
        with self.assertRaises(fixture.FixtureBuildError):
            fixture.verify_image_metadata(changed)

    def test_image_operations_use_only_explicit_rootless_endpoint(self) -> None:
        runtime = self.root / "docker"
        runtime.write_bytes(b"synthetic runtime placeholder")
        runtime.chmod(0o755)
        executable = self.root / "forge-synthetic-cell"
        executable.write_bytes(b"synthetic executable placeholder")
        executable.chmod(0o555)
        image = {
            "Id": "sha256:" + "b" * 64,
            "Architecture": "amd64",
            "Os": "linux",
            "RepoDigests": [],
            "Config": {
                "User": "65532:65532",
                "Entrypoint": ["/opt/afyx/bin/forge-synthetic-cell"],
                "Cmd": ["--mode", "public-synthetic"],
            },
        }
        with mock.patch.object(
            fixture,
            "_run_checked",
            side_effect=(b"", json.dumps([image]).encode("utf-8")),
        ) as run:
            fixture.build_image(runtime, executable, "afyx/forge:test")
        expected = (
            str(runtime),
            "--host",
            fixture.ROOTLESS_DOCKER_ENDPOINT,
        )
        self.assertEqual(run.call_args_list[0].args[0][:3], expected)
        self.assertEqual(run.call_args_list[0].args[0][3], "build")
        self.assertEqual(run.call_args_list[1].args[0][:3], expected)
        self.assertEqual(run.call_args_list[1].args[0][3:5], ("image", "inspect"))
        for invocation in run.call_args_list:
            environment = invocation.kwargs["environment"]
            self.assertNotIn("DOCKER_HOST", environment)
            self.assertNotIn("DOCKER_CONTEXT", environment)

    def test_image_helper_rejects_fallback_or_invalid_endpoint(self) -> None:
        for endpoint in (
            "unix:///var/run/docker.sock",
            "tcp://127.0.0.1:2375",
            "unix:///run/user/1000/afyx-forge/../docker.sock",
            "",
        ):
            with self.subTest(endpoint=endpoint), self.assertRaises(
                fixture.FixtureBuildError
            ):
                fixture.docker_cli_prefix(Path("/usr/bin/docker"), endpoint)


if __name__ == "__main__":
    unittest.main()
