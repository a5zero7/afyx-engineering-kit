from services.ledger import process_ledger

def emit_webhook(amount: float) -> float:
    return process_ledger(amount)
