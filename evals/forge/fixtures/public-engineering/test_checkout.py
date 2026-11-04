import unittest
from decimal import Decimal

from checkout import checkout_total
from tax import tax_amount


class CheckoutTests(unittest.TestCase):
    def test_tax_api_accepts_percentage_points(self):
        self.assertEqual(tax_amount(Decimal("100"), Decimal("20")), Decimal("20.00"))

    def test_checkout_uses_same_percentage_contract(self):
        self.assertEqual(checkout_total(Decimal("100"), Decimal("20")), Decimal("120.00"))


if __name__ == "__main__":
    unittest.main()
