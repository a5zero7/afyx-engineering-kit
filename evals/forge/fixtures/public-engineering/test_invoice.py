import unittest
from decimal import Decimal

from invoice import invoice_total


class InvoiceTests(unittest.TestCase):
    def test_quantities_are_applied(self):
        self.assertEqual(
            invoice_total([(2, "10.25"), (3, "1.50")]),
            Decimal("25.00"),
        )

    def test_empty_invoice_is_zero(self):
        self.assertEqual(invoice_total([]), Decimal("0"))


if __name__ == "__main__":
    unittest.main()
