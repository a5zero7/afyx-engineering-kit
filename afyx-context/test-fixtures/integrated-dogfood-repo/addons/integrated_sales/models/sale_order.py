from odoo import api, fields, models


class SaleOrder(models.Model):
    _inherit = "sale.order"

    afyx_review_note = fields.Char(copy=False)
    afyx_total_snapshot = fields.Monetary(compute="_compute_afyx_total_snapshot")

    @api.depends("order_line.price_subtotal")
    def _compute_afyx_total_snapshot(self):
        for order in self:
            order.afyx_total_snapshot = sum(order.order_line.mapped("price_subtotal"))

    def afyx_repeated_summary(self):
        return "AFYX integrated sale summary " * 48

    def SECURITY(self):
        """SECURITY ACCESS DENIED evidence must remain byte complete."""
        return self.afyx_review_note
