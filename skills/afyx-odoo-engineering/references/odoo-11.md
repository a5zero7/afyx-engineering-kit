# Odoo 11

Status: stable
Last verified: 2026-09-23

## Runtime baseline

- Official `11.0/setup.py` declares `python_requires >=3.5`; confirm deployed runtime and repository constraints.
- Official `11.0/addons/web/__manifest__.py` does not use the later manifest `assets` key.

## High-risk version traps

Keep Odoo 11 ORM, view, QWeb, and web-module conventions local to the target repository. Do not infer compatibility from Odoo 12+ examples.

## Validation

Use targeted module import/update, XML loading, and affected web/report checks under the target Odoo 11 runtime.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/11.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/11.0/addons/web/__manifest__.py`

## ORM / Python

Exact `11.0/odoo/api.py` still defines `multi()` and `one()`. Preserve recordset/decorator semantics during maintenance and inspect the 12→13 boundary before migration.
