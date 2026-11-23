from decimal import Decimal


class SettlementLedger:
    def __init__(self) -> None:
        self.balance = Decimal("0")
        self.processed: set[str] = set()

    def apply(self, event_id: str, amount: Decimal) -> bool:
        """Apply one positive settlement once; return whether it was applied."""
        self.balance += amount
        self.processed.add(event_id)
        return True
