# Odoo 13

Status: stable
Last verified: 2026-09-23

## Runtime baseline

- Official `13.0/setup.py` declares `python_requires >=3.6`; inspect the actual deployment/runtime as well.
- Official `13.0/addons/web/__manifest__.py` does not use the later manifest `assets` key.

## High-risk version traps

Verify Odoo 13 manifest, ORM, view, report, and JavaScript conventions against exact source before importing newer examples.

## Validation

Prefer targeted Python/module, XML, report, and affected web checks under the target Odoo 13 runtime.

## ORM / Python

Exact `13.0/odoo/api.py` defines `model_create_multi()` but no longer defines `multi()` or `one()`. Do not generate those Odoo 12-era decorators for Odoo 13+; preserve recordset semantics rather than assuming every method is singleton.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/13.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/13.0/addons/web/__manifest__.py`
- Official source: `https://github.com/odoo/odoo/blob/13.0/odoo/api.py`
