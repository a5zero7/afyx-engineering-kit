from decimal import Decimal

from tax import tax_amount


def checkout_total(subtotal: Decimal, rate_percent: Decimal) -> Decimal:
    return subtotal + tax_amount(subtotal, rate_percent / Decimal("100"))
