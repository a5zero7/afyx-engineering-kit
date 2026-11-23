# Workflow: Diagnosis → Minimal Fix → Regression

1. Capture observed symptom and expected outcome, time/version/environment, logs and reproducible steps; sanitize sensitive material.
2. Identify changed surface, hypotheses, and evidence required to distinguish them. Inspect root causes, not merely the visible UI message.
3. Reproduce or triangulate using safe methods; if not reproducible, say so and rank hypotheses by available evidence.
4. Identify smallest coherent fix, expected side effects, and rollback if necessary. Do not couple a broad refactor to an urgent fix.
5. Run a focused regression test and check relevant callers/permissions/data/concurrency.
6. Report root cause status (`confirmed` vs `probable`), implementation or recommendation, evidence, validation, and outstanding uncertainty.

If a live incident threatens availability or data integrity, use `incident-reliability.md` for containment-first decisions.
