import unittest
from extract_errors import extract_protected_errors

class DiagSummaryTests(unittest.TestCase):
    def test_preserves_all_error_and_fatal_codes(self):
        items = extract_protected_errors("app.log")
        codes = [item.get("code") for item in items]
        self.assertEqual(codes, ["E_DB_CONN", "E_AUTH_LOCK"])

if __name__ == "__main__":
    unittest.main()
