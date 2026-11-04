---
name: afyx-forge
description: Standalone Afyx Forge Core adaptive engineering policy and actionable guidance engine. Formulates structured investigation plans, tool recommendations, validation scopes, and completion criteria for ordinary engineering tasks.
metadata:
  version: "0.1.0"
---

# Afyx Forge Core — Adaptive Engineering Guidance

Afyx Forge Core turns engineering directives into bounded, structured, and actionable guidance without uncontrolled model costs or unauthorized autonomous operations.

## When to Use

Use `afyx-forge` when:
1. Approaching complex, cross-module, security-sensitive, or data-critical engineering tasks.
2. Formulating an adaptive execution plan before modifying unfamiliar codebases.
3. Deciding the proportional level of tooling (direct source vs. Afyx Graph vs. domain specialist) under the Afyx Adaptive Tool Routing discipline.

Do NOT use for trivial single-line changes, pure conversation, or when direct source inspection is already sufficient.

## CLI Usage

The standalone runtime is available via the CLI:

```bash
# Verify health, host surfaces, and component status
afyx-forge doctor

# Formulate plan from task description
afyx-forge plan --task "Refactor authentication tokens across api and storage services"

# Formulate plan from task file with markdown output
afyx-forge plan --task-file ./task.md --format markdown --output ./plan.md
```

## Core Principles

1. **Proportional Execution:** Select between `DIRECT_MINIMAL`, `FOCUSED_INVESTIGATION`, `STRUCTURAL_GRAPH_AWARE`, `DOMAIN_SPECIALIST`, and `SECURITY_DEFENSE_IN_DEPTH`.
2. **Graph-Aware Routing:** Use Afyx Graph only when cross-file relationships, inheritance, or impact analysis materially justify it. Fall back gracefully to direct-source tools when Graph is absent.
3. **Context Engine Default Enabled:** A healthy installed Context Engine is available without an opt-in variable; use it only for substantial or repeated context, honor explicit `AFYX_CONTEXT_OPT_IN=0`, and never claim Graph MCP interception without runtime evidence.
4. **Bounded Execution:** Forge operates in assistive guidance mode. Autonomous destructive operations, unapproved git push/commit, and secret leaks are strictly refused.
5. **Governance Integrity:** The formal A8 benchmark campaign remains `EVALUATION_GATED`. Forge Core Alpha provides guidance for day-to-day engineering without executing unapproved benchmark models.

