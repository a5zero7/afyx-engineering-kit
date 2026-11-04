#!/usr/bin/env python3
"""Reproducibly build and validate the public Forge synthetic OCI fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path
from typing import Sequence


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "evals/forge/synthetic_image/cell_x86_64.S"
CONTAINERFILE = ROOT / "evals/forge/synthetic_image/Containerfile"
EXPECTED_STDOUT = b"AFYX_FORGE_SYNTHETIC_STDOUT_V1\n"
EXPECTED_STDERR = b"AFYX_FORGE_SYNTHETIC_STDERR_V1\n"
EXPECTED_ARGUMENT_ERROR = b"AFYX_FORGE_SYNTHETIC_ARGUMENT_ERROR_V1\n"
IMAGE_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
PINNED_REFERENCE = re.compile(
    r"^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$"
)
ROOTLESS_DOCKER_ENDPOINT = "unix:///run/user/1000/afyx-forge/docker.sock"
APPROVED_CONTAINERFILE_INSTRUCTIONS = (
    "FROM scratch",
    'LABEL org.opencontainers.image.title="Afyx Forge public synthetic cell" '
    'org.opencontainers.image.version="1" '
    'org.opencontainers.image.source="https://github.com/a5zero7/'
    'afyx-codex-engineering-kit"',
    "COPY --chown=65532:65532 --chmod=0555 forge-synthetic-cell "
    "/opt/afyx/bin/forge-synthetic-cell",
    "USER 65532:65532",
    "WORKDIR /workspace",
    'ENTRYPOINT ["/opt/afyx/bin/forge-synthetic-cell"]',
    'CMD ["--mode", "public-synthetic"]',
)
CONTAINERFILE_PARSER_DIRECTIVE = re.compile(
    r"^#\s*(?:syntax|escape|check)\s*=", re.IGNORECASE
)


class FixtureBuildError(RuntimeError):
    """The fixture or image could not be built or verified."""


def docker_cli_prefix(
    runtime: Path, endpoint: str = ROOTLESS_DOCKER_ENDPOINT
) -> tuple[str, ...]:
    """Return the only approved explicit rootless Docker CLI prefix."""

    if not runtime.is_absolute() or ".." in runtime.parts:
        raise FixtureBuildError("an absolute container runtime is required")
    if endpoint != ROOTLESS_DOCKER_ENDPOINT:
        raise FixtureBuildError("rootless Docker endpoint is invalid")
    return (str(runtime), "--host", endpoint)


def compiler_argv(compiler: Path, output: Path) -> tuple[str, ...]:
    """Return the fixed Linux x86-64 standalone build command."""

    if (
        not compiler.is_absolute()
        or not compiler.is_file()
        or not os.access(compiler, os.X_OK)
    ):
        raise FixtureBuildError("an absolute compiler executable is required")
    return (
        str(compiler),
        "-nostdlib",
        "-static",
        "-no-pie",
        "-fno-ident",
        "-fno-asynchronous-unwind-tables",
        "-fno-stack-protector",
        "-Wl,--build-id=none",
        "-Wl,-z,noexecstack",
        "-Wl,-s",
        "-o",
        str(output),
        str(SOURCE),
    )


def verify_elf_x86_64(path: Path) -> str:
    """Verify a static little-endian x86-64 ELF and return its SHA-256."""

    data = path.read_bytes()
    if len(data) < 64 or data[:6] != b"\x7fELF\x02\x01":
        raise FixtureBuildError("fixture is not a 64-bit little-endian ELF")
    elf_type, machine = struct.unpack_from("<HH", data, 16)
    if elf_type != 2 or machine != 62:
        raise FixtureBuildError("fixture must be an x86-64 executable")
    program_offset = struct.unpack_from("<Q", data, 32)[0]
    entry_size, entry_count = struct.unpack_from("<HH", data, 54)
    if entry_size < 56 or program_offset + entry_size * entry_count > len(data):
        raise FixtureBuildError("fixture program headers are invalid")
    for index in range(entry_count):
        segment_type = struct.unpack_from(
            "<I", data, program_offset + index * entry_size
        )[0]
        if segment_type == 3:
            raise FixtureBuildError("fixture must not contain a dynamic interpreter")
    return hashlib.sha256(data).hexdigest()


def _containerfile_instructions(text: str) -> tuple[str, ...]:
    """Parse only the whitespace, comments, and continuations we approve."""

    instructions: list[str] = []
    continued: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if continued is not None:
                raise FixtureBuildError(
                    "blank lines are forbidden inside a continued instruction"
                )
            continue
        if line.startswith("#"):
            if continued is not None or CONTAINERFILE_PARSER_DIRECTIVE.match(line):
                raise FixtureBuildError("Containerfile comment is unsupported")
            continue
        logical = (
            f"{continued} {line}".strip() if continued is not None else line
        )
        if logical.endswith("\\"):
            continued = logical[:-1].rstrip()
            continue
        instructions.append(logical)
        continued = None
    if continued is not None:
        raise FixtureBuildError("Containerfile has a dangling continuation")
    return tuple(instructions)


def validate_containerfile(text: str) -> None:
    """Require the exact approved one-stage, one-file image recipe."""

    if _containerfile_instructions(text) != APPROVED_CONTAINERFILE_INSTRUCTIONS:
        raise FixtureBuildError("Containerfile does not match the frozen fixture contract")


def build_fixture(compiler: Path, output: Path) -> str:
    output.parent.mkdir(parents=True, exist_ok=True)
    environment = {
        "HOME": "/nonexistent",
        "LANG": "C",
        "LC_ALL": "C",
        "PATH": "/usr/bin:/bin",
        "SOURCE_DATE_EPOCH": "0",
    }
    completed = subprocess.run(
        compiler_argv(compiler, output),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=30,
        env=environment,
    )
    if completed.returncode != 0:
        raise FixtureBuildError(
            "fixture compilation failed: "
            + completed.stderr.decode("utf-8", errors="replace").strip()
        )
    output.chmod(0o555)
    return verify_elf_x86_64(output)


def verify_fixture_execution(executable: Path) -> None:
    completed = subprocess.run(
        (str(executable), "--mode", "public-synthetic"),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=5,
        env={"HOME": "/nonexistent", "PATH": "/usr/bin:/bin"},
    )
    if (
        completed.returncode != 0
        or completed.stdout != EXPECTED_STDOUT
        or completed.stderr != EXPECTED_STDERR
    ):
        raise FixtureBuildError("fixture execution contract failed")


def _run_checked(argv: Sequence[str], *, environment: dict[str, str]) -> bytes:
    completed = subprocess.run(
        tuple(argv),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=120,
        env=environment,
    )
    if completed.returncode != 0:
        raise FixtureBuildError(
            completed.stderr.decode("utf-8", errors="replace").strip()
        )
    return completed.stdout


def verify_image_metadata(image: object) -> dict[str, object]:
    """Verify inspected image metadata and return only usable identities."""

    if not isinstance(image, dict) or not isinstance(image.get("Config"), dict):
        raise FixtureBuildError("container image inspection is invalid")
    image_id = image.get("Id")
    config = image["Config"]
    if (
        not isinstance(image_id, str)
        or not IMAGE_ID.fullmatch(image_id)
        or image.get("Architecture") != "amd64"
        or image.get("Os") != "linux"
        or config.get("User") != "65532:65532"
        or config.get("Entrypoint") != ["/opt/afyx/bin/forge-synthetic-cell"]
        or config.get("Cmd") != ["--mode", "public-synthetic"]
    ):
        raise FixtureBuildError("container image metadata violates the contract")
    repo_digests = image.get("RepoDigests") or []
    if not isinstance(repo_digests, list) or any(
        not isinstance(item, str) for item in repo_digests
    ):
        raise FixtureBuildError("container repository digests are invalid")
    pinned = [item for item in repo_digests if PINNED_REFERENCE.fullmatch(item)]
    return {
        "architecture": "linux/amd64",
        "image_id": image_id,
        "launcher_references": pinned,
    }


def build_image(
    runtime: Path,
    executable: Path,
    tag: str,
    *,
    endpoint: str = ROOTLESS_DOCKER_ENDPOINT,
) -> dict[str, object]:
    """Build and verify an amd64 image; never fabricate a pinned reference."""

    if (
        not runtime.is_absolute()
        or not runtime.is_file()
        or not os.access(runtime, os.X_OK)
    ):
        raise FixtureBuildError("an absolute container runtime is required")
    prefix = docker_cli_prefix(runtime, endpoint)
    validate_containerfile(CONTAINERFILE.read_text("utf-8"))
    environment = {
        "HOME": "/nonexistent",
        "LANG": "C",
        "LC_ALL": "C",
        "PATH": "/usr/bin:/bin",
        "SOURCE_DATE_EPOCH": "0",
    }
    with tempfile.TemporaryDirectory(prefix="afyx-forge-image-") as temporary:
        context = Path(temporary)
        shutil.copyfile(CONTAINERFILE, context / "Containerfile")
        shutil.copyfile(executable, context / "forge-synthetic-cell")
        (context / "forge-synthetic-cell").chmod(0o555)
        os.utime(context / "Containerfile", (0, 0))
        os.utime(context / "forge-synthetic-cell", (0, 0))
        _run_checked(
            (
                *prefix,
                "build",
                "--file",
                str(context / "Containerfile"),
                "--platform",
                "linux/amd64",
                "--network",
                "none",
                "--pull=false",
                "--no-cache",
                "--build-arg",
                "SOURCE_DATE_EPOCH=0",
                "--tag",
                tag,
                str(context),
            ),
            environment=environment,
        )
    raw = _run_checked(
        (*prefix, "image", "inspect", tag), environment=environment
    )
    try:
        inspection = json.loads(raw)
        image = inspection[0]
    except (json.JSONDecodeError, IndexError, TypeError) as error:
        raise FixtureBuildError("container image inspection is invalid") from error
    return verify_image_metadata(image)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler", type=Path, default=Path("/usr/bin/gcc"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--image-tag", default="afyx/forge-synthetic:t09-e7-local")
    arguments = parser.parse_args()

    validate_containerfile(CONTAINERFILE.read_text("utf-8"))
    digest = build_fixture(arguments.compiler, arguments.output)
    verify_fixture_execution(arguments.output)
    result: dict[str, object] = {
        "architecture": "linux/amd64",
        "executable_sha256": digest,
        "image": "NOT TESTED",
    }
    if arguments.runtime is not None:
        result["image"] = build_image(
            arguments.runtime, arguments.output, arguments.image_tag
        )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
