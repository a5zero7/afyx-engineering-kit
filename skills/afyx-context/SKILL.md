---
name: afyx-context
description: Use the locally installed Afyx Context Engine to reduce genuinely large or repeated agent tool output while retaining recoverable original evidence. Activate only when context optimization materially helps; do not alter source evidence, diagnostics, security findings, or user data.
metadata:
  version: "0.1.0"
---

# Afyx Context Engine — Provider Companion

This skill is an **integration surface** of the standalone Afyx Context Engine, not a separate Afyx product. The selected provider can discover ACE without a global environment opt-in. It does not activate on every task.

## On-demand routing

1. For ordinary short tasks, use the original source/tools; do not run ACE.
2. For large or repetitive noncritical output, find the installed CLI at `$HOME/.afyx/context/current/bin/afyx-context` on Linux/macOS or `$env:USERPROFILE\.afyx\context\current\bin\afyx-context.cmd` on Windows. If `AFYX_CONTEXT_RUNTIME_ROOT` is set, prefer that runtime root. If the CLI is absent or unhealthy, keep the original output.
3. Treat source code, security findings, errors, stack traces, and diagnostic details as protected. Never claim they can be dropped or lossily summarized.
4. Use `afyx-context reduce --state <absolute-owned-state> --owner <stable-owner> --session <bounded-session> --input <json-file|->` on a JSON object with `segments` and an appropriate `budgetChars`. Create or use an isolated, local, non-symlinked state directory outside the project repository. Do not send context to external services.
5. When ACE produces a reference, retain the owner/session/state identity and recover exact original content using `afyx-context get --state <state> --owner <owner> --session <session> --reference <ace:v1:...>` before making claims that require omitted evidence.
6. On missing identity, timeout, unsafe path, lock error, integrity failure, unsupported provider, or explicit user disable, use the authoritative unmodified output. Do not mark validation PASS based on context reduction.

## Activation and consent

- The companion is installed only when the user selects Afyx Context Engine and the selected provider supports native skills. It remains independently removable from the provider.
- Respect `AFYX_CONTEXT_OPT_IN=0` and explicit provider/user-off configuration as a hard disable, including after reinstall or update.
- This skill does not itself register an additional MCP tool or guarantee automatic Graph-to-ACE MCP interception. Graph consumer wiring has a separate runtime acceptance gate.
- Minimize task/token overhead; only load this guidance when relevant.
