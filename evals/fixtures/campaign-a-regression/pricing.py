def normalize_discount(percent: int) -> float:
    # Regression: rejects valid 0% discount
    if percent <= 0 or percent > 100:
        raise ValueError("invalid discount")
    return percent / 100.0
