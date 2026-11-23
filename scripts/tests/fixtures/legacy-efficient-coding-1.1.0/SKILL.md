---
name: efficient-coding
description: Quality-first workflow for software implementation, debugging, refactoring, and code investigation. Applies to coding work, not general conversation, prompt writing, or document-only tasks.
metadata:
  version: "1.1.0"
---

# Efficient Coding

Prioritize **correctness → evidence → scoped change → validation → efficiency**. The target repository is authoritative; establish material framework, runtime, dependency, and behavior facts before editing.

## Route the task

- Known target: open the named symbol/file/failure path, inspect only material relationships, edit, then validate narrowly.
- Unknown target: identify the failure signal, search and narrow candidates, inspect the implementation and relevant relationships, then edit and validate.
- Cross-cutting or architectural: identify the source of truth, trace dependency/inheritance/caller impact, define the boundary, then implement with expanded validation.

Read `references/investigation.md` when the target or impact boundary is not already clear. Read `references/tool-routing.md` when tool choice or stopping criteria materially affect the investigation. For genuinely large/noisy context, read `references/token-efficiency.md`.

## Change contract

Make the smallest change that resolves the evidenced problem while preserving relevant architecture, compatibility, conventions, and public behavior. Do not add dependencies, perform destructive actions, change schema, or expand scope without authorization.

Stop exploring once material uncertainty is resolved. Start with targeted validation and expand only for shared behavior, dependencies, inheritance, configuration, failures, or material regression risk.

Report the root cause or key reasoning, changed files, executed validation, and remaining uncertainty.
