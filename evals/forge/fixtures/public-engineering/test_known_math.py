import unittest

from known_math import clamp


class ClampTests(unittest.TestCase):
    def test_inside_range_is_unchanged(self):
        self.assertEqual(clamp(5, 1, 10), 5)

    def test_below_range_uses_lower_bound(self):
        self.assertEqual(clamp(-2, 1, 10), 1)

    def test_above_range_uses_upper_bound(self):
        self.assertEqual(clamp(20, 1, 10), 10)


if __name__ == "__main__":
    unittest.main()
