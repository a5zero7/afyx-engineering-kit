import unittest
from decimal import Decimal

from settlement import SettlementLedger


class SettlementTests(unittest.TestCase):
    def test_duplicate_event_is_not_applied_twice(self):
        ledger = SettlementLedger()
        self.assertTrue(ledger.apply("evt-1", Decimal("12.50")))
        self.assertFalse(ledger.apply("evt-1", Decimal("12.50")))
        self.assertEqual(ledger.balance, Decimal("12.50"))

    def test_invalid_event_is_rejected_without_mutation(self):
        ledger = SettlementLedger()
        with self.assertRaises(ValueError):
            ledger.apply("", Decimal("5"))
        with self.assertRaises(ValueError):
            ledger.apply("evt-2", Decimal("-1"))
        self.assertEqual(ledger.balance, Decimal("0"))
        self.assertEqual(ledger.processed, set())


if __name__ == "__main__":
    unittest.main()
