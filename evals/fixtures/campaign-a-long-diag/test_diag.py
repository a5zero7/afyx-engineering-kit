import unittest
from diag_parser import extract_error_code


class TestLongDiag(unittest.TestCase):
    def test_extracts_fatal_after_noise(self):
        noise = "\n".join(f"INFO step {i}: ok" for i in range(200))
        log = noise + "\nFATAL: E_SCHEMA_DRIFT\n" + noise
        self.assertEqual(extract_error_code(log), "E_SCHEMA_DRIFT")


if __name__ == "__main__":
    unittest.main()
