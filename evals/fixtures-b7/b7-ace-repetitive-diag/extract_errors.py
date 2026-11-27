import json
from pathlib import Path

def extract_protected_errors(log_path: str) -> list[dict]:
    # BUG: currently returns empty list; must extract ERROR/FATAL code and line
    return []

if __name__ == "__main__":
    res = extract_protected_errors("app.log")
    Path("summary.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
