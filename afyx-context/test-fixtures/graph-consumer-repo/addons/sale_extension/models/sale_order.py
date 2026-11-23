class SaleOrder:
    _inherit = "sale.order"

    def synthetic_total(self):
        return 42
