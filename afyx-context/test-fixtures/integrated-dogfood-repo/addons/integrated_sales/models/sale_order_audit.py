from odoo import fields, models


class SaleOrderAudit(models.Model):
    _inherit = "sale.order"

    afyx_audit_marker = fields.Char(copy=False)

    def afyx_diagnostic_boundary(self):
        """ERROR FAILURE TRACEBACK evidence must remain byte complete."""
        return self.afyx_audit_marker
