# Workflow: Bounded Implementation and Validation

Use only when implementation or file changes are requested and permitted.

1. **Preflight:** inspect repository instructions, relevant files, actual versions, current behavior, tests, worktree status, and requested scope. Avoid overwriting unrelated local work.
2. **Plan:** state the desired behavior, primary domain, other impacted components, security/data risks, minimal change, and matching validation. For high-risk changes, note rollback and authorization boundary.
3. **Implement:** change the smallest coherent surface, following existing conventions. Preserve backward compatibility unless explicitly changed. For schema/data/security changes, validate impacts across callers/roles/versions.
4. **Validate:** run the available targeted checks; cover intended result and negative/regression scenarios based on risk. Report exact commands and actual output status. Never assert screenshots or manual behavior without observation.
5. **Review:** inspect diff, check for stray files or secrets, note migration/config/documentation impact and remaining gaps. Do not silently deploy, push, publish, or alter production.
6. **Close:** short summary of changes, locations, validation PASS/FAIL/NOT RUN, limitations, and reviewer-ready test instructions where useful.

Recommended division of labor: Software Engineer primary; BA/System Analyst for acceptance; QA for evidence; Security/DBA/SRE/ERP/AI/UX if truly impacted.
