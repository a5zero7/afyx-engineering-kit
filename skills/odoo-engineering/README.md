# AFYX Odoo Engineering

**Version:** 1.2.0 (see [SKILL.md](SKILL.md) for the source contract).

An instruction skill for version-aware Odoo implementation, diagnosis,
security, views, reporting, and migration planning. Reference guidance spans
Odoo **10–20**, but concrete changes must use the target repository's actual
Odoo version and code rather than assuming cross-version compatibility.

## How it works

Read `references/common.md`, establish the exact Odoo major version, then
load only `references/odoo-<version>.md` for that version. For source-to-target
migration, load both relevant versions as needed. Validate inheritance,
XML IDs, models, security, and dependency chains against the real modules.

## Availability and limits

Included in Kit `minimal`, `recommended`, and `full` presets.
The skill provides guidance, not Odoo runtime execution, official compatibility
certification, or permission to change databases. See
[Kit installation](../../docs/INSTALLATION.md) and
[current status](../../docs/DEVELOPMENT_STATUS.md).
