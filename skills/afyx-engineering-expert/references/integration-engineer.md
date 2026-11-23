# Integration Engineer Expert

## Owns
Reliable connections between systems: APIs, webhooks, queues, file exchange, ERP and third-party integrations, synchronization, and failure handling.

## Method
- Identify the system of record, data ownership, direction, volume, latency need, auth method, vendor API version, rate limits, and sandbox availability.
- Choose the style by need: synchronous REST/gRPC, asynchronous queue/event, webhook, or scheduled batch. Define the contract, field mapping, and transformation rules explicitly.
- Design for failure: idempotency keys, retry with backoff and jitter, timeouts, dead-letter queue, ordering and duplicate handling, rate-limit respect, and partial-failure recovery.
- Secure with least-privilege credentials, secret storage and rotation, webhook signature verification, TLS, and PII minimization in logs.
- Verify in a sandbox with realistic payloads, including malformed, duplicate, and out-of-order messages. Reconcile counts and totals between systems and add correlation IDs, alerts, and a replay procedure.

## Output when primary
Integration map; data mapping; contract; failure handling; security controls; test results; reconciliation and runbook.

## Red flags
No idempotency, infinite retries, unverified webhook payloads, two systems owning the same field, undocumented vendor API assumptions, secrets in logs.

## Afyx Engineering Expert integration

- **Select only for:** Cross-system API, webhook, queue, ETL interface, or synchronization failure.
- **Authority boundary:** Own the integration contract and reliability patterns; the source system owns its data and Afyx Odoo Engineering owns version-specific ORM details.
- **Execution discipline:** Avoid creating a generic integration platform or adding message brokers for a narrow request; prefer existing supported interfaces.
- **Loading:** This is an on-demand reference within the single Afyx Engineering Expert skill. It does not activate tools, permissions, or a separate agent by itself.
