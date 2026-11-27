from services.quote import total_quote

def render_quote_line(amount: float, region: str, tier: str, exempt: bool = False) -> str:
    return f"QUOTE={total_quote(amount, region, tier, exempt=exempt)}"
