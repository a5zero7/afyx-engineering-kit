# Odoo 16

Status: stable
Last verified: 2026-09-23

## Runtime baseline and assets

- Official `16.0/setup.py` declares `python_requires >=3.7`.
- Exact `16.0/addons/web/__manifest__.py` declares the manifest `assets` key; inspect exact bundle declarations rather than copying a neighboring version.

## High-risk version traps

Use target-repository Odoo 16 patterns for ORM, views, assets, and client code. Treat frontend/backend crossings as separate validation surfaces.

## Validation

Validate the affected Python/module path, inherited views, and relevant asset/client bundle under Odoo 16.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/16.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/16.0/addons/web/__manifest__.py`
- Official Odoo 16 ORM changelog — translated fields stored as JSONB; `search_count(limit)` behavior
- Official documentation: `https://www.odoo.com/documentation/16.0/developer/reference/backend/orm.html` — `attrs` / `states` dynamic-view era

## Delta from previous major

- Translated fields are stored as `JSONB` in Odoo 16; migration, reporting, and custom SQL must not assume pre-16 translation storage.
- `search_count()` takes `limit` into account. Recheck partial/existence-like counts and performance-sensitive code ported from older versions.

## ORM / Python

Use the exact Odoo 16 count and translation semantics above; method availability alone is not an introduction-version claim.

## Views / XML

Odoo 16 documentation remains the reference for the `attrs`/`states`-era dynamic-view patterns. When migrating to 17+, inspect the target architecture rather than mechanically carrying those attributes forward.
