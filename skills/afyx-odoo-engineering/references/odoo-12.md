# Odoo 12

Status: stable
Last verified: 2026-09-23

## Runtime baseline

- Official `12.0/setup.py` declares `python_requires >=3.5`; inspect target deployment/runtime rather than assuming a newer baseline.
- Official `12.0/addons/web/__manifest__.py` does not use the later manifest `assets` key.

## High-risk version traps

Keep Odoo 12 model, view, report, and web asset conventions tied to repository evidence. Do not import Odoo 13+ changes without checking exact source behavior.

## Validation

Validate the affected module, XML inheritance, report path, and web assets with the target Odoo 12 runtime.

## ORM / Python

Exact `12.0/odoo/api.py` defines `multi()`, `one()`, and `model_create_multi()`. Do not collapse Odoo 12 recordset behavior into post-13 assumptions; inspect method semantics and callers when migrating.

## Migration trap: 12 → 13

The decorator boundary must be handled semantically, not by a mechanical `ensure_one()` rewrite.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/12.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/12.0/addons/web/__manifest__.py`
- Official source: `https://github.com/odoo/odoo/blob/12.0/odoo/api.py`
