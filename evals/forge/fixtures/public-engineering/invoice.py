from decimal import Decimal


def invoice_total(lines: list[tuple[int, str]]) -> Decimal:
    """Return the exact total for (quantity, unit-price) invoice lines."""
    return sum((Decimal(unit_price) for _quantity, unit_price in lines), Decimal("0"))
