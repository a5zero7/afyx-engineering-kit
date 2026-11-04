#!/usr/bin/env python3
"""Freeze and verify content-addressed benchmark inputs."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


EVAL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_ROOT.parent
ENVIRONMENT_PATH = EVAL_ROOT / "environment.json"
MANIFEST_PATH = EVAL_ROOT / "manifest.json"
REPOSITORY_SKILLS = (
    "efficient-coding",
    "odoo-engineering",
    "afyx-engineering-expert",
)


def directory_content_sha256(root: Path) -> str:
    """Hash sorted POSIX-relative paths and full file bytes deterministically."""
    if not root.is_dir():
        raise FileNotFoundError(f"skill directory not found: {root}")
    digest = hashlib.sha256()
    files = sorted(
        (path for path in root.rglob("*") if path.is_file()),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def prompt_master_git_sha(checkout: Path) -> str:
    """Return Prompt Master's checked-out commit without changing Git config."""
    if not checkout.is_dir():
        raise FileNotFoundError(f"prompt-master checkout not found: {checkout}")
    command = [
        "git", "-c", f"safe.directory={checkout.as_posix()}",
        "-C", str(checkout), "rev-parse", "HEAD",
    ]
    completed = subprocess.run(
        command, text=True, encoding="utf-8", errors="replace",
        capture_output=True, check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"cannot read prompt-master Git SHA: {detail}")
    return completed.stdout.strip()


def selected_environment_path() -> Path:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return EVAL_ROOT / manifest["environment"]


def freeze_environment(path: Path | None = None) -> dict:
    path = path or selected_environment_path()
    environment = json.loads(path.read_text(encoding="utf-8"))
    for name in REPOSITORY_SKILLS:
        skill_root = REPO_ROOT / "skills" / name
        environment["skills"][name]["content_sha256"] = directory_content_sha256(skill_root)
    path.write_text(json.dumps(environment, indent=2) + "\n", encoding="utf-8")
    return environment


def main() -> int:
    environment = freeze_environment()
    for name in REPOSITORY_SKILLS:
        print(f"{name}: {environment['skills'][name]['content_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
