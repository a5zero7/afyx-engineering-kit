#!/usr/bin/env python3
"""Regression tests for repository-local Git environment isolation in pre-push."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / ".githooks" / "pre-push"
LOCAL_GIT_ENV = {
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
}


def sanitized_environment() -> dict[str, str]:
    env = os.environ.copy()
    for name in list(env):
        if name in LOCAL_GIT_ENV or (
            name.startswith("GIT_CONFIG_KEY_")
            or name.startswith("GIT_CONFIG_VALUE_")
        ):
            env.pop(name, None)
    return env


def run(*args: str | Path, cwd: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(arg) for arg in args],
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def protected_git_snapshot(git_dir: Path) -> dict[str, str]:
    protected: list[Path] = [git_dir / "config", git_dir / "index"]
    for relative in ("refs", "worktrees"):
        root = git_dir / relative
        if root.exists():
            protected.extend(path for path in root.rglob("*") if path.is_file())
    return {
        path.relative_to(git_dir).as_posix(): sha256(path)
        for path in sorted(protected)
        if path.exists()
    }


class PrePushEnvironmentIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if os.name != "nt":
            raise unittest.SkipTest("The incident regression requires native Windows Git.")
        git = shutil.which("git")
        if not git:
            raise unittest.SkipTest("Git is unavailable.")
        cls.git = Path(git)
        cls.sh = cls.git.parent.parent / "bin" / "sh.exe"
        if not cls.sh.is_file():
            raise unittest.SkipTest(f"Git for Windows shell is unavailable: {cls.sh}")

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="afyx-hook-isolation-")
        self.workspace = Path(self.temp.name) / "workspace"
        self.repo = self.workspace / "repo"
        self.linked = self.workspace / "linked"
        self.admin = self.workspace / "_afyx-admin"
        self.repo.mkdir(parents=True)
        self.admin.mkdir()
        self.clean_env = sanitized_environment()

        for command in (
            (self.git, "init", "-b", "main"),
            (self.git, "config", "user.name", "AFYX Fixture"),
            (self.git, "config", "user.email", "fixture@example.invalid"),
        ):
            result = run(*command, cwd=self.repo, env=self.clean_env)
            self.assertEqual(result.returncode, 0, result.stderr)
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        for command in (
            (self.git, "add", "README.md"),
            (self.git, "commit", "-m", "fixture baseline"),
            (self.git, "worktree", "add", "-b", "fixture-linked", self.linked, "HEAD"),
        ):
            result = run(*command, cwd=self.repo, env=self.clean_env)
            self.assertEqual(result.returncode, 0, result.stderr)

        hook_dir = self.repo / ".githooks"
        hook_dir.mkdir()
        self.hook = hook_dir / "pre-push"
        shutil.copyfile(HOOK, self.hook)
        self.hook.chmod(self.hook.stat().st_mode | stat.S_IXUSR)
        self._write_fixture_commands()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_fixture_commands(self) -> None:
        checker_py = textwrap.dedent(
            """\
            import os
            import pathlib
            import sys

            blocked = {
                "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG",
                "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_OBJECT_DIRECTORY",
                "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
                "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE",
                "GIT_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR",
            }
            dirty = sorted(
                name for name in os.environ
                if name in blocked or name.startswith("GIT_CONFIG_KEY_")
                or name.startswith("GIT_CONFIG_VALUE_")
            )
            if dirty:
                print("repository-local Git environment leaked: " + ", ".join(dirty), file=sys.stderr)
                raise SystemExit(86)
            marker = pathlib.Path(os.environ["AFYX_HOOK_MARKER"])
            with marker.open("a", encoding="utf-8") as stream:
                stream.write(pathlib.Path(sys.argv[0]).name + "\\n")
            """
        )
        scripts = self.repo / "scripts"
        scripts.mkdir()
        for name in ("validate-afyx-graph.py", "audit-legacy-identity.py"):
            (scripts / name).write_text(checker_py, encoding="utf-8")

        node_checker = textwrap.dedent(
            """\
            import fs from 'node:fs';
            const blocked = new Set([
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
              'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
              'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
              'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
              'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR'
            ]);
            const dirty = Object.keys(process.env).filter((name) =>
              blocked.has(name) || name.startsWith('GIT_CONFIG_KEY_') ||
              name.startsWith('GIT_CONFIG_VALUE_'));
            if (dirty.length) {
              console.error(`repository-local Git environment leaked: ${dirty.sort().join(', ')}`);
              process.exit(86);
            }
            fs.appendFileSync(process.env.AFYX_HOOK_MARKER, `${process.argv[1].split(/[\\\\/]/).pop()}\\n`);
            """
        )
        (scripts / "verify-native-source-ownership.mjs").write_text(node_checker, encoding="utf-8")
        engine = self.repo / "afyx-graph" / "engine"
        engine_scripts = engine / "scripts"
        engine_scripts.mkdir(parents=True)
        (engine_scripts / "verify-release-ready.mjs").write_text(node_checker, encoding="utf-8")
        (engine_scripts / "assert-clean-env.mjs").write_text(node_checker, encoding="utf-8")
        (engine / "package.json").write_text(
            json.dumps(
                {
                    "name": "afyx-hook-isolation-fixture",
                    "version": "1.0.0",
                    "private": True,
                    "scripts": {
                        "build:clean": "node scripts/assert-clean-env.mjs",
                        "test": "node scripts/assert-clean-env.mjs",
                        "test:semantic": "node scripts/assert-clean-env.mjs",
                        "test:smoke": "node scripts/assert-clean-env.mjs",
                    },
                }
            ),
            encoding="utf-8",
        )

        validator = textwrap.dedent(
            """\
            $blocked = @(
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
              'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
              'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
              'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
              'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR'
            )
            $dirty = @($blocked | Where-Object { Test-Path "Env:$_" })
            $dirty += @(Get-ChildItem Env: | Where-Object {
              $_.Name -match '^GIT_CONFIG_(KEY|VALUE)_[0-9]+$'
            } | ForEach-Object Name)
            if ($dirty.Count -gt 0) {
              Write-Error "repository-local Git environment leaked: $($dirty -join ', ')"
              exit 86
            }
            Add-Content -LiteralPath $env:AFYX_HOOK_MARKER -Value 'workspace-hygiene'
            exit 0
            """
        )
        (self.admin / "Test-AfyxWorkspaceHygiene.ps1").write_text(validator, encoding="utf-8")

    def _contaminated_environment(self) -> dict[str, str]:
        env = self.clean_env.copy()
        git_dir = self.repo / ".git"
        env.update(
            {
                "AFYX_HOOK_MARKER": str(self.workspace / "hook-phases.txt"),
                "GIT_DIR": str(git_dir),
                "GIT_WORK_TREE": str(self.repo),
                "GIT_COMMON_DIR": str(git_dir),
                "GIT_INDEX_FILE": str(git_dir / "index"),
                "GIT_OBJECT_DIRECTORY": str(git_dir / "objects"),
                "GIT_ALTERNATE_OBJECT_DIRECTORIES": str(git_dir / "objects"),
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": "user.name",
                "GIT_CONFIG_VALUE_0": "contaminated fixture identity",
                "GIT_CONFIG_KEY_7": "core.bare",
                "GIT_CONFIG_VALUE_7": "true",
            }
        )
        return env

    def _invoke(self, hook: Path) -> subprocess.CompletedProcess[str]:
        return run(self.sh, hook, cwd=self.repo, env=self._contaminated_environment())

    def test_actual_hook_isolates_children_and_preserves_git_metadata(self) -> None:
        before = protected_git_snapshot(self.repo / ".git")
        result = self._invoke(self.hook)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(protected_git_snapshot(self.repo / ".git"), before)
        phases = (self.workspace / "hook-phases.txt").read_text(encoding="utf-8").splitlines()
        self.assertIn("workspace-hygiene", phases)
        self.assertIn("validate-afyx-graph.py", phases)
        self.assertIn("audit-legacy-identity.py", phases)
        self.assertGreaterEqual(phases.count("assert-clean-env.mjs"), 4)

    def test_disabled_isolation_fails_closed(self) -> None:
        text = self.hook.read_text(encoding="utf-8")
        start = text.index("# AFYX_GIT_ENV_SANITIZE_BEGIN")
        end = text.index("# AFYX_GIT_ENV_SANITIZE_END") + len(
            "# AFYX_GIT_ENV_SANITIZE_END"
        )
        disabled = self.repo / ".githooks" / "pre-push-disabled"
        disabled.write_text(
            text[:start] + ": # isolation intentionally disabled\n" + text[end:],
            encoding="utf-8",
        )
        disabled.chmod(disabled.stat().st_mode | stat.S_IXUSR)
        before = protected_git_snapshot(self.repo / ".git")
        result = self._invoke(disabled)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("repository-local Git environment leaked", result.stdout + result.stderr)
        self.assertEqual(protected_git_snapshot(self.repo / ".git"), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
