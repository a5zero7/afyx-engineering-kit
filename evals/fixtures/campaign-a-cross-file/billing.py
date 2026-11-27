from rates import fetch_rate


def convert(amount: float, currency: str) -> float:
    # Intentional bug: multiplies instead of dividing when converting to USD
    return amount * fetch_rate(currency)
