---
name: efficient-coding
description: Quality-first workflow for software implementation, debugging, refactoring, and code investigation. Applies to coding work, not general conversation, prompt writing, or document-only tasks.
metadata:
  version: "1.2.0"
---

# Efficient Coding

Prioritize **correctness → evidence → scoped change → validation → efficiency**. The target repository is authoritative.

## Core loop

- **GROUND:** establish the requested target, observable problem or outcome, material impact, and validation signal.
- **LOCATE:** route known targets directly, narrow unknown defects from evidence, and trace cross-cutting relationships only as far as correctness requires.
- **REPRODUCE:** for bugs, establish a reliable failure signal or behavioral baseline before changing code when feasible.
- **CHANGE:** make the smallest safe, authorized change that resolves the evidenced problem.
- **VALIDATE:** run focused checks first, expanding only for material regression risk.
- **REPORT:** be concise by default; include the evidence and detail warranted by task complexity.

Read `references/investigation.md` when the target, reproduction, impact, or change boundary is unclear. Read `references/tool-routing.md` when tool choice matters. For genuinely large or noisy evidence, read `references/token-efficiency.md`.

## Change contract

Preserve relevant architecture, compatibility, conventions, and public behavior. Existing explicit user authorization is sufficient within its stated scope; request approval before unapproved destructive operations, dependencies, public API/schema changes, or scope expansion.

Stop exploring once material uncertainty is resolved. Never trade away evidence required for a correct result merely to reduce tool calls or tokens.
