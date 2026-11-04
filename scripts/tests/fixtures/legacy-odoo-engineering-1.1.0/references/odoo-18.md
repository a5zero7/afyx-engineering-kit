# Odoo 18

Status: stable
Last verified: 2026-09-23

## Runtime baseline and assets

- Official `18.0/setup.py` declares `python_requires >=3.10`.
- Exact `18.0/addons/web/__manifest__.py` declares the manifest `assets` key.

## High-risk version traps

Select Odoo 18 APIs and conventions from the target repository and exact source. Do not apply generic latest-version guidance or assume Odoo 17/19 behavior is identical.

## Validation

Validate affected ORM, inherited XML, and relevant frontend/asset paths under Odoo 18.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/18.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/18.0/addons/web/__manifest__.py`
- Official documentation: `https://www.odoo.com/documentation/18.0/developer/reference/backend/orm.html` — `_search_display_name`, access helpers, Environment translations
- Official documentation: `https://www.odoo.com/documentation/18.0/developer/reference/frontend/javascript_modules.html`
- Official documentation: `https://www.odoo.com/documentation/18.0/developer/reference/user_interface/view_architectures.html` — `<list>` root and `<tree>` previous name
- Official Odoo ORM changelog — `aggregator` rename in Online 17.2 (inherited by stable 18)

## Delta from previous major

- `_search_display_name` implements name searching like other fields. When adapting custom name-search behavior, inspect `_search_display_name` and display-name behavior before carrying older overrides forward.
- `check_access`, `has_access`, and `_filtered_access` combine access-right and rule handling. They are available helpers, not a mandate to mechanically replace existing `check_access_rights` plus `check_access_rule` calls.
- Translations are available from the `Environment`; keep translation changes scoped to the actual call site.

### Stable-line inherited terminology

Odoo 18 stable uses post-17.2 `aggregator` terminology (`group_operator` → `aggregator`); that rename originated in the Odoo Online 17.2 line, not in 18.0. JSONB translation storage is an Odoo 16 change and is inherited, not an Odoo 18 introduction.

## ORM / Python

Use the 18.0 helpers above only after checking call-site semantics; availability does not require refactoring.

## Views / XML

The official 18.0 view architecture names the root element of list views `list` and identifies `tree` as its previous name. Before changing XML, inspect view type identifiers, inheritance XPath targets, and external inherited views; do not assume `tree` is rejected solely from the documentation wording.

## Frontend / JavaScript

Odoo 18 documentation describes files under `/static/src` and `/static/tests` as automatically transpiled into Odoo modules. Do not blindly add or remove `@odoo-module`; inspect local source and aliases first.
