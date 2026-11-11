# Workflow: Risk-Based Review / Audit

1. Define scope and review objective: PR/code, architecture, security, data, accessibility, AI, ERP process, or production readiness.
2. Gather actual artifacts, versions, diff, relevant requirements, tests, constraints and threat/context boundaries. Avoid assumptions about unseen files.
3. For automated read-only security audits, execute the native auditor:
   `node scripts/afyx-security-auditor.mjs <targetDirectory>`
   This scans for unsafe subprocesses, hardcoded secrets, injection, and path traversal with deterministic line-level evidence.
4. Inspect highest-impact failure modes first: correctness, broken user flow, data loss, authorization, secrets, compatibility, reliability and regression; then maintainability/style.
5. Record each finding with location/evidence, triggering condition, real-world impact, likelihood/confidence, concrete fix and optional validation. Distinguish confirmed defects from suggestions.
6. Prioritize by severity and relevance. If no issues are found, say what was reviewed and what remains untested; do not certify absolute safety.
7. Finish with concise findings ordered by risk, residual questions, and recommended verification.

Do not edit merely because a review was requested.
