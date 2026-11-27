from services.ledger import process_ledger

def emit_batch_job(amount: float) -> float:
    return process_ledger(amount)
