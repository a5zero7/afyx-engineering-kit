# Odoo 14

Status: stable
Last verified: 2026-09-23

## Runtime baseline

- Official `14.0/setup.py` declares `python_requires >=3.6`.
- Official `14.0/addons/web/__manifest__.py` does not use the later manifest `assets` key.

## High-risk version traps

Treat Odoo 14 as its own compatibility boundary. Inspect exact framework, ORM, view, and asset conventions before importing a newer pattern.

## Validation

Validate the affected module, inherited XML, and relevant frontend/report loading under the target Odoo 14 runtime.

## ORM / Python

An exact source search of `14.0/odoo/fields.py` found no `class Command`. Do not generate `fields.Command.create/update/set` for Odoo 14 unless the target repository provides its own compatibility abstraction; inspect the existing tuple-command pattern and RPC boundary.

## Migration trap: 14 → 15

The absence claim is source-based, not documentation-silence-based. Verify custom abstractions before changing working relational commands.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/14.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/14.0/addons/web/__manifest__.py`
- Official source: `https://github.com/odoo/odoo/blob/14.0/odoo/fields.py`
