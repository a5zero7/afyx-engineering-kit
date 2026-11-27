def fetch_rate(currency: str) -> float:
    rates = {"USD": 1.0, "IDR": 15500.0, "EUR": 0.92}
    return rates[currency]
