from services.invoice import total_invoice

def handle_invoice_request(amount: float, region: str, tier: str, exempt: bool = False) -> dict:
    return {"total": total_invoice(amount, region, tier, exempt=exempt)}
