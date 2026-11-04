from helpers import normalize

class PaymentService:
    def charge(self, amount: int) -> int:
        return normalize(amount)

DECOY = "def ghost(): pass"
# def phantom(): pass
