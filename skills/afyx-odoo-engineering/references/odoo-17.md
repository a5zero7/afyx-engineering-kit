# Odoo 17

Status: stable
Last verified: 2026-09-23

## Runtime baseline and assets

- Official `17.0/setup.py` declares `python_requires >=3.10`.
- Exact `17.0/addons/web/__manifest__.py` declares the manifest `assets` key.

## High-risk version traps

Keep Odoo 17 server and client implementation checks separate when a task crosses the UI boundary. Validate inherited views and assets narrowly before changing frontend code; do not carry 18–20 assumptions backward.

## Validation

Use targeted Python/module, XML view, and asset/client checks under the target Odoo 17 runtime.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/17.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/17.0/addons/web/__manifest__.py`
- Official source: `https://github.com/odoo/odoo/blob/17.0/odoo/tools/sql.py`
- Official documentation: `https://www.odoo.com/documentation/17.0/developer/reference/frontend/javascript_modules.html`
- Official documentation: `https://www.odoo.com/documentation/17.0/developer/reference/user_interface/view_architectures.html`

## ORM / Python

Exact `17.0/odoo/tools/sql.py` defines the `SQL` wrapper. Prefer ORM where appropriate; when custom SQL is required, inspect the target 17.0 wrapper/source instead of copying raw-SQL patterns blindly.

## Views / XML

Odoo 17 view documentation describes direct Python-expression modifiers such as `invisible`, `readonly`, and `required`. Do not copy Odoo 16 `attrs`/`states` patterns without checking the target repository; this wording does not by itself claim every legacy attribute is rejected.

## Frontend / JavaScript

Odoo 17 JavaScript documentation uses `@odoo-module` as the native-module conversion marker. Inspect local module style before adding or removing the marker.

## Concrete Odoo 17 Examples

### 1. Model Inheritance & `Command` ORM API

```python
from odoo import Command, api, fields, models

class SaleOrder(models.Model):
    _inherit = 'sale.order'

    x_approval_note = fields.Char(string='Approval Note')

    def action_add_service_line(self, product, qty=1.0):
        self.ensure_one()
        self.write({
            'order_line': [
                Command.create({
                    'product_id': product.id,
                    'product_uom_qty': qty,
                }),
            ],
        })
```

### 2. OWL 2 Component & Service Usage

```javascript
/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class ApprovalBanner extends Component {
    static template = "my_module.ApprovalBanner";
    setup() {
        this.orm = useService("orm");
        this.state = useState({ count: 0 });
    }
    async refreshCount(orderId) {
        const rows = await this.orm.read("sale.order", [orderId], ["x_approval_note"]);
        this.state.count = rows.length;
    }
}
```

### 3. Security (`ir.model.access.csv` + Record Rule XML)

```csv
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_sale_approval_user,sale.approval.user,model_sale_approval,sales_team.group_sale_salesman,1,1,1,0
```

```xml
<record id="rule_sale_approval_own" model="ir.rule">
    <field name="name">Sale Approval: Own Records</field>
    <field name="model_id" ref="model_sale_approval"/>
    <field name="domain_force">[('create_uid', '=', user.id)]</field>
    <field name="groups" eval="[Command.link(ref('sales_team.group_sale_salesman'))]"/>
</record>
```
