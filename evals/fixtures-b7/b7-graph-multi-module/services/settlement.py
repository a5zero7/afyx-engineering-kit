from core.currency import round_money
from core.validator import require_positive

def process_settlement(amount: float) -> float:
    return round_money(require_positive(amount, "amount"))
