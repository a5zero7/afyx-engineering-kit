# Supplemental Specialist Routing Index

This index provides selective routing for the 16 deep engineering specialists available in `references/`. These references are **task-lazy** and should be consulted only when a task's technical scope warrants specialization beyond the 13 core disciplines in `SKILL.md`.

## Principles

1. **Selective Loading:** Do not load all specialists. Select **one primary reference** and at most **two supporting references** (which can be from core disciplines or specialists).
2. **Direct Source Fast Path:** If source files, error logs, or exact symbols are already known, inspect them directly using standard tools (`rg`, file reads) before loading specialist guidance.
3. **Odoo Engineering Authority:** For version-specific Odoo ORM, views, models, and transactions, defer to the `odoo-engineering` skill.
4. **Forge A8 Authorization:** Destructive actions, production deployments, firmware flashing, or infrastructure mutations require explicit user approval.
5. **No Overhead:** Do not trigger Graph, Context, or external tools unless the specific task complexity demands it.

## Specialist Routing Table

| Signal | Primary reference | Common supporting reference |
|---|---|---|
| Line-by-line code craft, readability, idioms, anti-overabstraction | `references/clean-code-engineer.md` | software-engineer, qa-engineer |
| PR / patch diff review, security & correctness audit | `references/code-reviewer.md` | qa-engineer, software-engineer |
| Business metrics, SQL queries, BI dashboards, ERP data reconciliation | `references/data-analyst-bi.md` | business-analyst, database-administrator |
| ETL/ELT pipelines, data warehouse marts, CDC, non-blocking ingestion | `references/data-engineer.md` | database-administrator, ai-ml-engineer |
| Systematic root-cause bug isolation, hypothesis ranking, minimal fix | `references/debugging-specialist.md` | software-engineer, qa-engineer |
| Microcontroller, firmware, RTOS, bare-metal, peripherals (UART/SPI/I2C) | `references/embedded-iot-engineer.md` | hardware-electronics-engineer, solutions-architect |
| Non-destructive PC/laptop audit, battery/SMART wear, MDM lock check | `references/hardware-diagnostics-auditor.md` | cybersecurity-devsecops, system-analyst |
| Circuit schematics, power regulators (LDO/switching), PCB layout, EMC | `references/hardware-electronics-engineer.md` | embedded-iot-engineer, solutions-architect |
| Third-party API integration, webhooks, idempotency keys, retries/DLQ | `references/integration-engineer.md` | solutions-architect, erp-technical-specialist |
| Legacy code refactoring, characterization tests, strangler pattern | `references/legacy-modernization-engineer.md` | software-engineer, solutions-architect |
| Prompt engineering, RAG retrieval/chunking, tool schemas, eval sets | `references/llmops-prompt-engineer.md` | ai-ml-engineer, software-engineer |
| Cloud topology, VPC/subnets, CIDR, VPN/Zero Trust, inter-service latency | `references/network-engineer.md` | solutions-architect, site-reliability-engineer |
| Load/stress/soak testing, profiling, latency percentiles (p50/p95/p99) | `references/performance-benchmark-engineer.md` | site-reliability-engineer, qa-engineer |
| Internal Developer Platform (IDP), golden path templates, IaC, CI/CD | `references/platform-engineer.md` | site-reliability-engineer, solutions-architect |
| Sprint delivery cadence, capacity planning, risk tracking, agile sync | `references/technical-project-manager.md` | product-manager, solutions-architect |
| Technical documentation, OpenAPI/Swagger specs, SOPs, release notes | `references/technical-writer.md` | software-engineer, product-manager |

