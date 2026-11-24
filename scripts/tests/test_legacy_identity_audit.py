"""Keep historical handoff evidence without relaxing active-source identity checks."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


AUDIT = Path(__file__).resolve().parents[1] / "audit-legacy-identity.py"
HANDOFF = "AFYX-320-execution-handoff-2026-11-05.md"
LEGACY_TOKEN = "code" + "graph"


class LegacyIdentityAuditTests(unittest.TestCase):
    def test_ownership_ledger_is_legal_evidence_but_lookalike_metadata_is_not(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-identity-ledger-") as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
            scripts = root / "scripts"
            scripts.mkdir()
            (scripts / "native-source-ownership.json").write_text(
                '{"evidence":"historical ' + LEGACY_TOKEN + ' source requires review"}', encoding="utf-8"
            )
            allowed = subprocess.run([sys.executable, str(AUDIT), "--root", str(root)], capture_output=True, text=True)
            self.assertEqual(allowed.returncode, 0, allowed.stdout + allowed.stderr)
            self.assertIn("LEGAL_PROVENANCE=1", allowed.stdout)
            (scripts / "native-source-ownership-unverified.json").write_text(LEGACY_TOKEN, encoding="utf-8")
            blocked = subprocess.run([sys.executable, str(AUDIT), "--root", str(root)], capture_output=True, text=True)
            self.assertEqual(blocked.returncode, 1, blocked.stdout + blocked.stderr)

    def test_historical_handoff_is_classified_but_active_untracked_source_fails(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-identity-audit-") as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
            (root / HANDOFF).write_text(f"Historical comparison: {LEGACY_TOKEN}\n", encoding="utf-8")
            allowed = subprocess.run([sys.executable, str(AUDIT), "--root", str(root)], capture_output=True, text=True)
            self.assertEqual(allowed.returncode, 0, allowed.stdout + allowed.stderr)
            self.assertIn("HISTORICAL_EVIDENCE=1", allowed.stdout)

            source = root / "src" / "runtime.ts"
            source.parent.mkdir()
            source.write_text(f"export const inherited = '{LEGACY_TOKEN}';\n", encoding="utf-8")
            blocked = subprocess.run([sys.executable, str(AUDIT), "--root", str(root)], capture_output=True, text=True)
            self.assertEqual(blocked.returncode, 1, blocked.stdout + blocked.stderr)
            self.assertIn("src/runtime.ts", blocked.stdout)


    def test_machine_specific_paths_are_rejected_without_echoing_values(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-path-guard-") as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
            marker = "private-fixture-marker"
            item = root / "usage.md"
            item.write_text("\n".join([
                "/".join(("D:", "Project", marker)),
                "\\".join(("D:", "Project", marker)),
                "file:" + "/" * 3 + marker,
                "/".join(("~", ".gemini", "antigravity", marker)),
            ]), encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", "usage.md"], check=True, capture_output=True)
            cmd = [sys.executable, str(AUDIT), "--root", str(root)]
            blocked = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(blocked.returncode, 1, blocked.stdout + blocked.stderr)
            self.assertEqual(blocked.stdout.count(": machine-specific path"), 4)
            self.assertNotIn(marker, blocked.stdout)
            item.write_text("See [examples](examples/usage.md).\n", encoding="utf-8")
            allowed = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(allowed.returncode, 0, allowed.stdout + allowed.stderr)


if __name__ == "__main__":
    unittest.main()
