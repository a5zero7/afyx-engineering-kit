from services.ledger import process_ledger

def emit_audit_log(amount: float) -> float:
    return process_ledger(amount)
