RATES = {"ID": 0.11, "SG": 0.09, "US": 0.07}

def compute_tax_rate(region: str, tier: str) -> float:
    base = RATES.get(region, 0.05)
    return base if tier == "standard" else round(base * 0.5, 4)
