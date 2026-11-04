# Odoo version detection

Use the strongest available repository or runtime evidence first:

1. `odoo/release.py`, release/version metadata, `odoo-bin --version`, explicit source branch/tag, or server runtime evidence.
2. Supporting evidence such as manifest conventions, Python compatibility, framework APIs, frontend conventions, and repository configuration/history.
3. Weak evidence such as one syntax fragment, folder naming, developer assumption, or similarity to another project.

Do not choose a version from a weak signal when stronger evidence is available. If evidence conflicts, do not guess: report the conflict, prioritize executable/source/runtime evidence, and use only the version it proves. Never mix APIs from conflicting versions.

Odoo 10–20 references are stable for this project. Odoo 20 requires exact 20.0 source/documentation evidence; do not carry Odoo 19 assumptions forward.

For migrations, identify source and target versions separately. Load both references only when the migration task requires both.
