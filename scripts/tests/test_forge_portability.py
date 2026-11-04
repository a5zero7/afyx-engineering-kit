import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]


class ForgeFingerprintPortabilityTests(unittest.TestCase):
    def test_frozen_text_assets_stay_lf_when_git_would_use_crlf(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            repository = Path(temporary_directory)
            environment = os.environ.copy()
            environment["GIT_CONFIG_GLOBAL"] = os.devnull
            environment["GIT_CONFIG_SYSTEM"] = os.devnull
            environment["XDG_CONFIG_HOME"] = str(repository / "xdg")

            (repository / ".gitattributes").write_bytes(
                (REPO_ROOT / ".gitattributes").read_bytes()
            )
            candidate_relative = Path("evals/forge/candidates/B2/AGENTS.md")
            fixture_relative = Path("evals/forge/fixtures/public-engineering/sample.py")
            candidate = repository / candidate_relative
            fixture = repository / fixture_relative
            unprotected = repository / "unprotected.txt"
            for path in (candidate, fixture, unprotected):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"first\nsecond\n")

            def git(*arguments: str) -> subprocess.CompletedProcess[str]:
                return subprocess.run(
                    ["git", *arguments],
                    cwd=repository,
                    env=environment,
                    check=True,
                    capture_output=True,
                    text=True,
                )

            git("init", "--quiet")
            git("config", "core.autocrlf", "true")
            git("config", "core.eol", "crlf")
            git(
                "add",
                ".gitattributes",
                candidate_relative.as_posix(),
                fixture_relative.as_posix(),
                unprotected.name,
            )

            for path in (candidate, fixture, unprotected):
                path.unlink()
            git(
                "checkout",
                "--",
                candidate_relative.as_posix(),
                fixture_relative.as_posix(),
                unprotected.name,
            )

            self.assertNotIn(b"\r\n", candidate.read_bytes())
            self.assertNotIn(b"\r\n", fixture.read_bytes())
            self.assertIn(b"\r\n", unprotected.read_bytes())


if __name__ == "__main__":
    unittest.main()
