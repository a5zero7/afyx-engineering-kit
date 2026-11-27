from services.ledger import process_ledger

def emit_csv_report(amount: float) -> float:
    return process_ledger(amount)
