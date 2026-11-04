# Workflow: Incident & Reliability

Use only for operational instability, outage, data risk, recovery or resilience design.

1. State observed impact, affected critical paths, onset, source/time of evidence, and uncertain facts. Classify severity provisionally using actual impact.
2. Prioritize user/data safety and containment: choose reversible mitigations, identify owner and permission for operational commands, protect evidence, and communicate status.
3. Assess rollback/failover/runbook options and their preconditions. Do not execute production-impacting changes without authorization.
4. Confirm recovery with user-facing signals and data integrity checks, not only process status. Monitor for recurrence.
5. Build a non-blaming timeline, contributing causes, missing detection/guardrails, and targeted follow-up actions.
6. If proactive SRE design: define representative SLIs/SLOs, alert thresholds, observability, capacity tests, and rollback from available baselines rather than fabricated targets.

Never promise to monitor later or perform continuous checks unless an available scheduling mechanism is configured and actually used.
