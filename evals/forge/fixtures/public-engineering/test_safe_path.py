import tempfile
import unittest
from pathlib import Path

from safe_path import resolve_export_path


class SafePathTests(unittest.TestCase):
    def test_child_path_is_allowed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            self.assertEqual(resolve_export_path(root, "reports/output.txt"), root / "reports/output.txt")

    def test_parent_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with self.assertRaises(ValueError):
                resolve_export_path(root, "../outside.txt")

    def test_absolute_outside_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            outside = root.parent / "outside.txt"
            with self.assertRaises(ValueError):
                resolve_export_path(root, str(outside))


if __name__ == "__main__":
    unittest.main()
