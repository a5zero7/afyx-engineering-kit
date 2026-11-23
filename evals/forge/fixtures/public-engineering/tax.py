from decimal import Decimal


def tax_amount(subtotal: Decimal, rate_percent: Decimal) -> Decimal:
    """Return tax for a percentage expressed as points, for example 20 for 20%."""
    return (subtotal * rate_percent).quantize(Decimal("0.01"))
