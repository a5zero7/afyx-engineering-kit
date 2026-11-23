# -*- coding: utf-8 -*-
class CustomSaleOrder:
    _inherit = 'sale.order'

    def action_confirm(self):
        return super().action_confirm()

