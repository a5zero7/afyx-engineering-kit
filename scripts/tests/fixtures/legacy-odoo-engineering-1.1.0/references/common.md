# Common Odoo evidence rules

The repository is the source of truth. Before changing code, establish the Odoo release, Python runtime, module dependencies, and applicable custom inheritance. Odoo tasks may cross Python/backend, XML views, QWeb, JavaScript/OWL, assets, controllers, or reports; inspect only the relevant boundary.

For models, inspect `_name`, `_inherit`, `_inherits`, fields, computed dependencies, inverse/search methods, `@api.depends`, onchange/constraints, create/write/unlink overrides, access rights, record rules, domains, company boundaries, `sudo`, and affected callers as relevant. For XML, resolve external ID, model, parent view, inheritance order, xpath target, priority, and module dependency before editing.

Treat ACLs, record rules, field groups, view visibility, business validation, and `sudo` as different controls. UI visibility is not security. Preserve persisted technical identifiers, database columns, XML IDs, context keys, and stored values unless an authorized migration explicitly requires changing them; a display-label change alone is not authorization.

Validate the affected module first. Expand testing only when shared models, inherited views, security, reporting, frontend/backend boundaries, integrations, or dependencies raise regression risk.
