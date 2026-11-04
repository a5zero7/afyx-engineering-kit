---
name: odoo-engineering
description: Version-aware Odoo engineering for Odoo repositories, modules, ORM, views, reports, security, migrations, and debugging. Stable references cover Odoo 10–20; select one target version from repository evidence.
metadata:
  version: "1.1.0"
---

# Odoo Engineering

Apply only to Odoo work. Determine the actual major version from repository/runtime evidence before using version-specific behavior. Prefer `odoo/release.py`, release metadata, `odoo-bin --version`, explicit branch/tag, server runtime, manifest conventions, dependency files, and established code patterns.

Never import Python/runtime features, ORM APIs, view/XML syntax, JavaScript/OWL modules, asset declarations, security behavior, report patterns, or migration conventions from another release based on familiarity. Repository evidence is authoritative.

## Routing

1. Read `references/common.md` for all Odoo tasks.
2. Determine one target version from repository/runtime evidence. Read `references/version-detection.md` when evidence is missing or conflicting.
3. Read exactly one `references/odoo-<version>.md` for a normal task. For a migration, read only the source and target references that are actually required.
4. Inspect the actual module inheritance, manifest dependencies, model/view references, and local patterns needed for the task.

If evidence conflicts, do not guess: report the conflict, prioritize executable/source/runtime evidence, and use only the version it proves. Never mix APIs from conflicting versions. For upgrades, treat source and target versions separately.

`references/reference-schema.md` defines the compact evidence-backed shape for future version-reference expansion; it is not a reason to load every version reference for one task.

For an Odoo upgrade spanning versions, treat each source and target version separately. Do not convert an existing module merely because a newer pattern exists.

## Scope and validation

Search before editing. For model behavior inspect inheritance, fields, compute/onchange/constraint methods, access rules, domains, and callers when material. For views inspect external IDs, parent views, inheritance chains, xpath targets, and module dependencies.

Prefer a targeted module update or test first. Do not run a full database update, alter production data, change schema, or perform a migration without explicit authorization.
