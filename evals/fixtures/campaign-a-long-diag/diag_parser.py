def extract_error_code(log_text: str) -> str:
    for line in log_text.splitlines():
        if "FATAL:" in line:
            return line.split("FATAL:", 1)[1].strip()
    return "UNKNOWN"
