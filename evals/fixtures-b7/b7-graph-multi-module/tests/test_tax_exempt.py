import unittest
from core.tax import compute_tax_rate
from services.invoice import total_invoice
from services.quote import total_quote
from services.subscription import total_subscription
from adapters.rest_api import handle_invoice_request
from adapters.cli_export import render_quote_line

class TaxExemptTests(unittest.TestCase):
    def test_exempt_zero_tax_across_all_callers(self):
        self.assertEqual(compute_tax_rate("ID", "standard", exempt=True), 0.0)
        self.assertEqual(total_invoice(100.0, "ID", "standard", exempt=True), 100.0)
        self.assertEqual(total_quote(100.0, "ID", "standard", exempt=True), 100.0)
        self.assertEqual(total_subscription(100.0, "ID", "standard", exempt=True), 100.0)
        self.assertEqual(handle_invoice_request(100.0, "ID", "standard", exempt=True)["total"], 100.0)
        self.assertEqual(render_quote_line(100.0, "ID", "standard", exempt=True), "QUOTE=100.0")

    def test_non_exempt_preserves_rate(self):
        self.assertEqual(total_invoice(100.0, "ID", "standard", exempt=False), 111.0)

if __name__ == "__main__":
    unittest.main()
