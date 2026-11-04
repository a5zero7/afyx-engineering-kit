# Workflow: Specialization Gates (AI / Data / ERP)

Load this only if AI/ML, significant database changes, or ERP transactional flows materially affect the task.

## AI/ML gate
- Define data source/permissions, baseline, target behavior and error costs.
- Specify training/evaluation separation or a verifiable evaluation set for generative applications; guard against leakage and untrusted prompt/tool inputs.
- Review deployment constraints (latency, cost, privacy, rollback) and ongoing measurement. Do not claim model quality without a run.

## DBA/data gate
- Confirm DBMS/version, schema, workload, integrity constraints and backup/restore reality.
- Design migrations with idempotency, compatibility, validation/reconciliation, locks/downtime and rollback limits.
- Measure query/index changes where feasible; avoid destructive production commands without approval.

## ERP gate
- Confirm vendor/edition/version, core vs customization, module dependencies, companies/warehouses/fiscal settings and existing business rules.
- Trace full transaction lifecycle, exceptions, security roles, accounting/stock repercussions, and integration boundaries.
- Validate positive/negative/permission/regression scenarios. For migration test mapping, balancing/reconciliation, backup/cutover and operational signoff.

If multiple gates apply, consolidate shared evidence and tests rather than performing duplicate audits.
