import unittest
from pricing import normalize_discount


class TestRegression(unittest.TestCase):
    def test_zero_discount_allowed(self):
        self.assertEqual(normalize_discount(0), 0.0)
        self.assertEqual(normalize_discount(25), 0.25)

    def test_bounds(self):
        with self.assertRaises(ValueError):
            normalize_discount(-1)


if __name__ == "__main__":
    unittest.main()
