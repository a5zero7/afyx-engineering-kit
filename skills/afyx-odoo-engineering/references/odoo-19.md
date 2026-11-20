# Odoo 19

Status: stable
Last verified: 2026-09-23

## Runtime baseline and assets

- Official `19.0/odoo/release.py` declares `MIN_PY_VERSION = (3, 10)`, `MAX_PY_VERSION = (3, 14)`, and `MIN_PG_VERSION = 13`.
- Exact `19.0/addons/web/__manifest__.py` declares the manifest `assets` key.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/19.0/odoo/release.py`
- Official source: `https://github.com/odoo/odoo/blob/19.0/addons/web/__manifest__.py`
- Official source: `https://github.com/odoo/odoo/blob/19.0/odoo/orm/models.py`
- Official source: `https://github.com/odoo/odoo/blob/19.0/odoo/http.py`
- Official documentation: `https://www.odoo.com/documentation/19.0/developer/reference/backend/orm.html`

## Delta from previous major

### Odoo 19.0

- Odoo 19 supports dynamic date values in domains; use them for date/datetime criteria where appropriate rather than replacing explicit dates mechanically.
- `odoo.osv` is deprecated, not removed. Do not introduce it in new Odoo 19 code, and do not rewrite compatible existing code without migration scope.
- `record._cr`, `record._context`, and `record._uid` are deprecated, not removed. Prefer `self.env.cr`, `self.env.context`, and `self.env.uid` where semantically equivalent.

## ORM / Python

The exact 19.0 ORM source contains `search_fetch`, `fetch`, `_search_display_name`, access helpers, and `read_group`; inspect deprecation guidance before introducing older helpers into new code.

### Inherited Online 18.x lineage

- Controller route `type='json'` was renamed to `type='jsonrpc'` in the Odoo Online 18.1 lineage; this is present in the later stable line, not a 19.0 introduction.
- `read_group` was deprecated in the Odoo Online 18.2 lineage. For new backend code, check `_read_group` or `formatted_read_group` semantics; deprecated does not mean unavailable.
- The same lineage includes `odoo.Domain` and `@api.private`; classify these as inherited online changes when relevant.

## High-risk version traps

Do not treat deprecated as removed. For custom modules, inspect exact 19.0 source/docs and existing callers before replacing access, domain, controller, or aggregation APIs.

## Validation

Validate affected ORM calls, access behavior, domains, controllers, and views against the target 19.0 runtime.
