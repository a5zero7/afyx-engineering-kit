from core.tax import compute_tax_rate
from core.currency import round_money

def total_invoice(amount: float, region: str, tier: str, exempt: bool = False) -> float:
    rate = compute_tax_rate(region, tier)
    return round_money(amount * (1.0 + rate))
