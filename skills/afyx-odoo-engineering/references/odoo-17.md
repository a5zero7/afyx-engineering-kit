# Odoo 17

Status: stable
Last verified: 2026-09-23

## Runtime baseline and assets

- Official `17.0/setup.py` declares `python_requires >=3.10`.
- Exact `17.0/addons/web/__manifest__.py` declares the manifest `assets` key.

## High-risk version traps

Keep Odoo 17 server and client implementation checks separate when a task crosses the UI boundary. Validate inherited views and assets narrowly before changing frontend code; do not carry 18–20 assumptions backward.

## Validation

Use targeted Python/module, XML view, and asset/client checks under the target Odoo 17 runtime.

## Evidence

- Official source: `https://github.com/odoo/odoo/blob/17.0/setup.py`
- Official source: `https://github.com/odoo/odoo/blob/17.0/addons/web/__manifest__.py`
- Official source: `https://github.com/odoo/odoo/blob/17.0/odoo/tools/sql.py`
- Official documentation: `https://www.odoo.com/documentation/17.0/developer/reference/frontend/javascript_modules.html`
- Official documentation: `https://www.odoo.com/documentation/17.0/developer/reference/user_interface/view_architectures.html`

## ORM / Python

Exact `17.0/odoo/tools/sql.py` defines the `SQL` wrapper. Prefer ORM where appropriate; when custom SQL is required, inspect the target 17.0 wrapper/source instead of copying raw-SQL patterns blindly.

## Views / XML

Odoo 17 view documentation describes direct Python-expression modifiers such as `invisible`, `readonly`, and `required`. Do not copy Odoo 16 `attrs`/`states` patterns without checking the target repository; this wording does not by itself claim every legacy attribute is rejected.

## Frontend / JavaScript

Odoo 17 JavaScript documentation uses `@odoo-module` as the native-module conversion marker. Inspect local module style before adding or removing the marker.
