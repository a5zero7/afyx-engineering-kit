# Afyx Odoo Engineering

**Version-aware Odoo domain skill · v1.2.0 · Reference coverage: Odoo 10–20**

Odoo Engineering is an independently usable Afyx Agent Skill for Odoo models,
ORM, views, server logic, security, reports, migrations, troubleshooting and
module development. It remains **separate** from Afyx Engineering Expert and
Forge; those components may request Odoo expertise but must not supersede it
on version-specific framework facts.

## Correct version first

Identify the Odoo major release from the actual repository or running server:
`odoo/release.py`, `odoo-bin --version`, branch/tag, module manifests, or other
supported source/runtime evidence. Do **not** import patterns from newer Odoo
releases into an older codebase by assumption.

For a normal task, load:

1. [SKILL.md](../../skills/odoo-engineering/SKILL.md) and `references/common.md`.
2. `references/version-detection.md` if the version is missing or conflicting.
3. Exactly one `references/odoo-<version>.md` for the proven target.

For a migration, consult the **source and destination** references actually
needed, without eagerly loading all eleven versions.

## Practical engineering boundaries

- Inspect target module manifests, inherited models, callers, computed fields,
  constraints, view/XML-ID/xpath chains, ACLs and record rules where relevant.
- Distinguish Community from Enterprise and custom module behavior from
  Odoo-standard behavior.
- Use targeted checks first; database migration, broad module updates,
  production changes and risky schema operations need explicit authorization.
- Treat actual source, registry and database behavior as authoritative.
  Version reference files are guidance, not a substitute for project evidence.

## Installation and independence

- Component ID: `odoo-engineering`.
- Available in `minimal`, `recommended` and `full` presets.
- No Afyx Graph, Forge, Expert or Context dependency is required to use the
  skill. Combine capabilities only for real cross-file, context, or review needs.
- The Kit installer manages host placement; see
  [Installation](../INSTALLATION.md) and
  [Component Guide](../COMPONENTS.md#odoo-engineering).

**Current status:** implemented version-scoped instruction skill, v1.2.0.
References support Odoo 10–20 but do **not** certify arbitrary third-party
modules, release migrations, or installed-product routing without testing.
