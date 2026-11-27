def apply_discount(amount: float, pct: float) -> float:
    if pct < 0 or pct > 100:
        raise ValueError("invalid discount")
    return amount * (1.0 - pct / 100.0)
