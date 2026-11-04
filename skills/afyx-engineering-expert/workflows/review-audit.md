# Workflow: Risk-Based Review / Audit

1. Define scope and review objective: PR/code, architecture, security, data, accessibility, AI, ERP process, or production readiness.
2. Gather actual artifacts, versions, diff, relevant requirements, tests, constraints and threat/context boundaries. Avoid assumptions about unseen files.
3. Inspect highest-impact failure modes first: correctness, broken user flow, data loss, authorization, secrets, compatibility, reliability and regression; then maintainability/style.
4. Record each finding with location/evidence, triggering condition, real-world impact, likelihood/confidence, concrete fix and optional validation. Distinguish confirmed defects from suggestions.
5. Prioritize by severity and relevance. If no issues are found, say what was reviewed and what remains untested; do not certify absolute safety.
6. Finish with concise findings ordered by risk, residual questions, and recommended verification.

Do not edit merely because a review was requested.
