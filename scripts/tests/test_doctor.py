#!/usr/bin/env python3
"""Deterministic tests for the read-only Afyx doctor (PowerShell and Bash).

Synthetic skills roots and projects only: no network, no model, and no real
install is inspected beyond the machine facts (Codex/Git/Python) the doctor is
designed to report. Overall READY/NOT READY is asserted structurally (it must
agree with the presence of FAIL lines) because CI hosts have no Codex CLI.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PS_DOCTOR = ROOT / "scripts" / "afyx-doctor.ps1"
SH_DOCTOR = ROOT / "scripts" / "afyx-doctor.sh"
SQLITE_HEADER = b"SQLite format 3\x00" + b"\x00" * 84


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def snapshot(*roots: Path) -> str:
    digest = hashlib.sha256()
    for root in roots:
        for path in sorted(root.rglob("*")):
            if path.is_file() and ".git" not in path.parts:
                digest.update(path.relative_to(root).as_posix().encode())
                digest.update(path.read_bytes())
    return digest.hexdigest()


def run_bash(skills: Path, project: Path) -> tuple[int, str]:
    bash = shutil.which("bash")
    if not bash:
        return -1, ""
    done = subprocess.run([bash, str(SH_DOCTOR), "--skills-root", skills.as_posix(), "--project", project.as_posix()], capture_output=True, encoding="utf-8", errors="replace")
    return done.returncode, done.stdout


def run_pwsh(skills: Path, project: Path) -> tuple[int, str]:
    pwsh = shutil.which("pwsh") or shutil.which("powershell")
    if not pwsh:
        return -1, ""
    # Force UTF-8 for this child process only, so the report decodes identically on every host.
    command = (
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); "
        f"& '{PS_DOCTOR}' -SkillsRoot '{skills}' -ProjectPath '{project}'; exit $LASTEXITCODE"
    )
    done = subprocess.run([pwsh, "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, encoding="utf-8", errors="replace")
    return done.returncode, done.stdout


class DoctorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.skills, self.project = base / "skills", base / "project"
        self.skills.mkdir()
        self.project.mkdir()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def doctors(self) -> dict[str, tuple[int, str]]:
        results = {"bash": run_bash(self.skills, self.project), "pwsh": run_pwsh(self.skills, self.project)}
        active = {name: value for name, value in results.items() if value[0] != -1}
        self.assertTrue(active, "neither bash nor PowerShell is available")
        return active

    def install_core(self) -> None:
        for name in ("efficient-coding", "odoo-engineering"):
            shutil.copytree(ROOT / "skills" / name, self.skills / name)

    def git_project(self) -> str:
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)
        write(self.project / "app.py", "print('hello')\n")
        env = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]
        subprocess.run(["git", "-C", str(self.project), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.project), *env, "commit", "-q", "-m", "init"], check=True)
        return subprocess.run(["git", "-C", str(self.project), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()

    def index(self, head: str | None, header: bytes = SQLITE_HEADER, meta: bool = True, tracked_clean: bool = True) -> None:
        state = self.project / ".afyx-graph"
        state.mkdir(exist_ok=True)
        (state / "afyx-graph.db").write_bytes(header)
        if meta:
            head_json = f'"{head}"' if head else "null"
            clean_json = "true" if tracked_clean else "false"
            write(
                state / "freshness.json",
                '{"schema_version": 1, "indexed_at": "2026-01-01T00:00:00Z", "git_head": %s, "tracked_clean": %s}\n' % (head_json, clean_json),
            )

    def test_missing_core_components_fail_and_exit_nonzero(self) -> None:
        for shell, (code, out) in self.doctors().items():
            self.assertEqual(code, 1, shell)
            self.assertIn("NOT READY", out, shell)
            for name in ("Efficient Coding", "Odoo Engineering"):
                self.assertIn(f"[FAIL] {name}", out, shell)

    def test_healthy_core_is_reported_with_versions(self) -> None:
        self.install_core()
        for shell, (_code, out) in self.doctors().items():
            self.assertIn("[OK] Efficient Coding — 1.2.1", out, shell)
            self.assertIn("[OK] Odoo Engineering — 1.2.0", out, shell)
            self.assertNotIn("[FAIL] Efficient Coding", out, shell)

    def test_optional_expert_is_reported_without_affecting_core_readiness(self) -> None:
        self.install_core()
        for shell, (_code, out) in self.doctors().items():
            self.assertIn("[INFO] Afyx Engineering Expert", out, shell)
            self.assertNotIn("[FAIL] Afyx Engineering Expert", out, shell)

        shutil.copytree(ROOT / "skills" / "afyx-engineering-expert", self.skills / "afyx-engineering-expert")
        for shell, (_code, out) in self.doctors().items():
            self.assertIn("[OK] Afyx Engineering Expert — 0.1.1", out, shell)

    def test_verdict_agrees_with_fail_lines(self) -> None:
        self.install_core()
        for shell, (code, out) in self.doctors().items():
            failed = "[FAIL]" in out
            self.assertEqual("NOT READY" in out, failed, shell)
            self.assertEqual(code, 1 if failed else 0, shell)
            if not failed:
                self.assertRegex(out, r"\nREADY( \(with warnings\))?\n", shell)

    def test_sections_are_present_in_order(self) -> None:
        self.install_core()
        for shell, (_code, out) in self.doctors().items():
            positions = [out.index(title) for title in ("CORE", "OPTIONAL", "ENVIRONMENT", "PROJECT")]
            self.assertEqual(positions, sorted(positions), shell)

    def test_graph_index_states(self) -> None:
        head = self.git_project()
        cases = []
        cases.append(("MISSING", lambda: None))
        cases.append(("INVALID", lambda: self.index(head, header=b"not a database")))
        cases.append(("UNKNOWN", lambda: self.index(head, meta=False)))
        cases.append(("FRESH", lambda: self.index(head)))

        def make_stale() -> None:
            self.index(head)
            write(self.project / "app.py", "print('changed')\n")

        cases.append(("STALE", make_stale))
        for expected, arrange in cases:
            with self.subTest(expected=expected):
                shutil.rmtree(self.project / ".afyx-graph", ignore_errors=True)
                subprocess.run(["git", "-C", str(self.project), "checkout", "-q", "--", "."], check=True)
                arrange()
                for shell, (_code, out) in self.doctors().items():
                    self.assertIn(f"Afyx Graph index: {expected}", out, f"{shell}: {out}")

    def test_stale_when_the_index_was_built_from_uncommitted_edits(self) -> None:
        head = self.git_project()
        self.index(head, tracked_clean=False)
        for shell, (_code, out) in self.doctors().items():
            self.assertIn("Afyx Graph index: STALE", out, shell)
            self.assertIn("uncommitted changes", out, shell)

    def test_stale_when_head_moves(self) -> None:
        self.git_project()
        self.index("0" * 40)
        for shell, (_code, out) in self.doctors().items():
            self.assertIn("Afyx Graph index: STALE", out, shell)

    def test_odoo_project_version_is_reported(self) -> None:
        write(self.project / "odoo" / "release.py", "version_info = (17, 0, 0, FINAL, 0, '')\n")
        for shell, (_code, out) in self.doctors().items():
            self.assertIn("[OK] Odoo detected", out, shell)
            self.assertIn("[OK] Version: 17 — proven by source evidence", out, shell)

    def test_conflicting_odoo_evidence_is_a_warning_not_a_guess(self) -> None:
        write(self.project / "addons" / "a" / "__manifest__.py", "{'version': '15.0.1.0.0'}\n")
        write(self.project / "addons" / "b" / "__manifest__.py", "{'version': '16.0.1.0.0'}\n")
        for shell, (_code, out) in self.doctors().items():
            self.assertIn("[WARN] Version — conflicting evidence", out, shell)
            self.assertNotIn("[OK] Version:", out, shell)

    def test_doctor_is_read_only(self) -> None:
        self.install_core()
        head = self.git_project()
        self.index(head)
        before = snapshot(self.skills, self.project)
        self.doctors()
        self.assertEqual(before, snapshot(self.skills, self.project))


if __name__ == "__main__":
    unittest.main(verbosity=2)
