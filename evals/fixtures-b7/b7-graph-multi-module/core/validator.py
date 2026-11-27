def require_positive(value: float, name: str) -> float:
    if value < 0:
        raise ValueError(f"{name} must be non-negative")
    return value
