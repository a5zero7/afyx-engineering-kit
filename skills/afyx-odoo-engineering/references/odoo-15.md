# Odoo 15

Status: stable
Last verified: 2026-09-23

## Runtime baseline and assets

- Official `15.0/setup.py` declares `python_requires >=3.7`.
- Exact `15.0/addons/web/__manifest__.py` is the first inspected branch in this set that declares the manifest `assets` key. Do not backport this loading shape to 14.0 or earlier without evidence.

## High-risk version traps

Confirm Odoo 15 backend/frontend conventions before changing established module APIs. Asset loading is a version boundary; inspect the exact manifest and bundle names.

## Validation

Validate the affected module, XML, asset bundle, and integration surface under Odoo 15.

## ORM / Python

Exact `15.0/odoo/fields.py` defines `class Command` with helpers including `create`, `update`, `delete`, `unlink`, `link`, `clear`, and `set`. Use it only when the target version supports it.

Python helpers do not change the RPC representation automatically; inspect integrations that require literal three-element relational command tuples.

## Frontend / JavaScript

Odoo 15 official JavaScript documentation describes `@odoo-module` as the opt-in marker for native-module conversion while legacy `odoo.define` and external/plain JavaScript remain compatibility concerns. Inspect local module style before changing it.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/15.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/15.0/addons/web/__manifest__.py`
- Official source: `https://github.com/odoo/odoo/blob/15.0/odoo/fields.py`
- Official documentation: `https://www.odoo.com/documentation/15.0/developer/reference/frontend/javascript_modules.html`
