class ApprovalRequest:
    """Lightweight Odoo 16 model stub for deterministic multi-company & ORM checks."""
    _name = "custom.approval.request"

    def __init__(self, name: str, company_id: int, state: str = "draft", line_ids: list | None = None):
        self.name = name
        self.company_id = company_id
        self.state = state
        self.line_ids = list(line_ids or [])

    def approve(self, user_company_ids: list[int]) -> dict:
        # BUG 1: missing multi-company check (must raise PermissionError if self.company_id not in user_company_ids)
        # BUG 2: uses Odoo 17+ Command.set style or mutates wrong state
        if self.state != "draft":
            raise ValueError("only draft requests can be approved")
        self.state = "approved"
        return {"state": self.state, "commands": [(6, 0, list(self.line_ids))]}
