# Odoo 20

Status: stable
Last verified: 2026-09-23

## Runtime baseline

- Official `20.0/odoo/release.py` reports `version_info` 20.0 at `FINAL`, `MIN_PY_VERSION = (3, 12)`, `MAX_PY_VERSION = (3, 14)`, and `MIN_PG_VERSION = 16`.
- Treat those constants as release metadata, not as a substitute for checking the target deployment and repository configuration.

## Runtime / assets

- Exact `20.0/addons/web/__manifest__.py` declares the manifest `assets` key. Inspect exact bundle declarations and source before changing frontend loading.

## ORM / Python

- Exact 19.0 `odoo/orm/models.py` contains `_table_query`; an exact source search of 20.0 `odoo/orm/models.py` found no `_table_query` symbol. Treat this as a removal boundary for SQL-backed/report models, not as a reason to invent a replacement: inspect the exact 20.0 source and model design.
- Exact 20.0 ORM source still contains `search_fetch`, `fetch`, `_search_display_name`, access helpers, and `read_group`; preserve call-site semantics when migrating from 19.0.

## High-risk version traps

Odoo 20 is a stable target, but exact 20.0 source and documentation remain authoritative. Distinguish removed from deprecated; do not carry Odoo 19 `_table_query` assumptions forward or infer replacement APIs without exact 20.0 evidence.

## Validation

Validate Python/PostgreSQL prerequisites, SQL-backed/report models, affected ORM calls, inherited XML, and frontend/assets under the target Odoo 20 runtime.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/19.0/odoo/orm/models.py`
- Official source: `https://github.com/odoo/odoo/blob/20.0/odoo/orm/models.py`
- Official documentation: `https://www.odoo.com/documentation/20.0/developer/reference/backend/orm.html`
- Official source: `https://github.com/odoo/odoo/blob/20.0/odoo/release.py`
- Official source: `https://github.com/odoo/odoo/blob/20.0/addons/web/__manifest__.py`
- Official documentation: `https://www.odoo.com/documentation/20.0/administration/on_premise/source.html`

## Delta from previous major

Odoo 19 source contains `Model._table_query`; exact 20.0 source does not, and the official 20.0 ORM changelog states that `Model._table_query` was removed. This is a true removal, not a deprecation. For SQL-backed/report models, inspect the exact 20.0 architecture and do not invent a replacement API.
