from core.currency import round_money
from core.validator import require_positive

def process_credit_note(amount: float) -> float:
    return round_money(require_positive(amount, "amount"))
