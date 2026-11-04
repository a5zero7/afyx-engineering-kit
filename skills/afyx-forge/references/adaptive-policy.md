# Afyx Forge Adaptive Policy Reference

## Execution Modes

| Execution Mode | Applicable Scenarios | Tooling Discipline |
| :--- | :--- | :--- |
| **`DIRECT_MINIMAL`** | Known file bugs, simple edits, typos, doc updates | Read target file directly, edit cleanly, run single unit test. Avoid Graph and Context. |
| **`FOCUSED_INVESTIGATION`** | Unknown defect diagnosis, flaky tests, stack traces | Reproduce failure signal first, isolate root-cause with ripgrep, verify fix. |
| **`STRUCTURAL_GRAPH_AWARE`** | Cross-module changes, inter-service API changes | Explore dependency graph via Afyx Graph (callers, callees, affected tests) or trace imports via ripgrep if Graph is absent. |
| **`DOMAIN_SPECIALIST`** | Framework-specific logic (e.g. Odoo ORM, XML views) | Engage domain engineering guidelines (e.g. Odoo Engineering Skill). Track inheritance and schema versions. |
| **`SECURITY_DEFENSE_IN_DEPTH`** | Auth, tokens, crypto, permissions, ACL, data sanitization | Perform security boundary audit, fail closed, write negative regression tests. |

## Bounded Execution Rules

Forge Core enforces strict safety boundaries:
1. **No Autonomous Commits/Pushes:** Requests containing force-push, bypassing review gates, or automatic branch publishing without explicit owner authorization are refused with status `REFUSED_UNSAFE`.
2. **No Secret Exfiltration:** Directives that attempt to dump, expose, or transmit credentials or private keys are immediately blocked.
3. **No Destructive Drops:** Refuse commands requesting table drops, mass file deletions, or disk formatting without prior backup and authorization.

