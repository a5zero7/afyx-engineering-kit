import unittest
from billing import convert


class TestCrossFile(unittest.TestCase):
    def test_convert_to_usd(self):
        self.assertAlmostEqual(convert(15500.0, "IDR"), 1.0)
        self.assertAlmostEqual(convert(10.0, "USD"), 10.0)


if __name__ == "__main__":
    unittest.main()
