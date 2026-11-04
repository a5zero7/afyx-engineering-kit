# Odoo 10

Status: stable
Last verified: 2026-09-23

## Runtime baseline

- Exact `10.0/odoo/release.py` identifies Odoo 10. Exact `10.0/setup.py` does not declare `python_requires`; inspect the target deployment/runtime before changing Python syntax.
- Exact `10.0/addons/web/__manifest__.py` does not use the later manifest `assets` key. Do not copy that later asset declaration shape into an Odoo 10 module without repository evidence.

## High-risk version traps

- Treat Odoo 10 as a legacy boundary. Do not backport OWL, modern JavaScript imports, newer asset-bundle declarations, or newer view/ORM conveniences based on familiarity.
- Preserve the target repository's existing ORM, XML, QWeb, and web-module patterns; validate migrations/backports against the actual 10.0 source and deployment runtime.

## Validation

Prefer targeted Python/module import, XML loading, and affected report/web asset checks in the target Odoo 10 environment.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/10.0/odoo/release.py`
- Official source: `https://github.com/odoo/odoo/blob/10.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/10.0/addons/web/__manifest__.py`

## ORM / Python

Exact `10.0/odoo/api.py` defines `multi()` and `one()`. Odoo 10 code can therefore contain legacy/new-API coexistence; do not mechanically replace working decorators or imports during maintenance.

## Frontend / JavaScript

Treat the legacy web module and import generation as a compatibility boundary. Do not introduce OWL or modern module/asset patterns without target-repository evidence.
