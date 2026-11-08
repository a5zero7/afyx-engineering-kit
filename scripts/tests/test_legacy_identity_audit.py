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


if __name__ == "__main__":
    unittest.main()
