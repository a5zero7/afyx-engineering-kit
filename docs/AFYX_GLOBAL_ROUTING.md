# Adaptive global routing for supported Afyx providers

Status: **Draft PR #128 implementation; real owner host acceptance pending**.

The authoritative provider registry is `scripts/components.json`. Its currently supported providers are Codex, Antigravity, and Claude Code. The same short global instruction policy is installed for each **selected** provider, not assumed to be loaded on every provider surface. Policy source: `scripts/afyx-global-routing-policy.md`.

| Provider | Managed global instruction file | Notes |
|---|---|---|
| Codex | `~/.codex/AGENTS.md` | If a nonempty `AGENTS.override.md` is active, manage that existing file instead; respect `CODEX_HOME` |
| Antigravity IDE/CLI | `~/.gemini/GEMINI.md` | Other global and workspace rules may also be loaded and can take precedence |
| Claude Code | `~/.claude/CLAUDE.md` | Respect the absolute `CLAUDE_CONFIG_DIR` override, if set |

References: [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Antigravity global rules](https://antigravity.google/docs/rules/), [Claude Code global CLAUDE.md](https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts).

## Routing rule

**Do not invoke Afyx just because it is installed.** Inspect task intent first. A known file or symbol, a small change, straightforward bug investigation or a simple test usually benefits from direct source inspection. For dependency/impact/relationship questions or large context selection, use an Afyx-family capability only when it materially reduces uncertainty or effort and is verified healthy, fresh and authorized on the **actual** provider surface. Never start all Afyx components or rebuild an index automatically.

If a needed native capability is missing, stale, unavailable or inappropriate, use direct source or a separately authorized external equivalent. A disabled MCP does not authorize a CLI workaround. An external binary/index left on disk never overrides healthy Afyx priority. Respect user/provider permissions and higher-priority workspace instructions.

## Preview, apply, verify and uninstall

From the PR #128 checkout, **preview first**:

```powershell
node scripts/afyx-global-routing.mjs
node scripts/afyx-global-routing.mjs --apply
node scripts/afyx-global-routing.mjs --verify
node scripts/afyx-global-routing.mjs --uninstall --apply
```

By default, all provider names are loaded from the registry. To install the global rule for a subset, use `--providers codex,antigravity`. Disposable test or custom root overrides: `--codex-home`, `--gemini-home`, `--claude-home`; each path must be absolute.

**Safety:** preview and verify do not write. Apply only adds/replaces the bounded Afyx-owned marked block while preserving other instructions and creating a local exact-byte backup under `<provider-home>/.afyx-global-routing-backups/` before overwriting any existing global file. Subsequent apply is idempotent. Uninstall only removes the marked block; backups remain. Files with unsafe symlinks/reparse links, invalid encoding, damaged or duplicate markers, or recognized mandatory legacy external-tool-first instructions are `BLOCKED` and never silently rewritten. A blocked multi-provider preflight prevents writes to any selected provider.

When the owner's existing global `AGENTS.md` has a mandatory external graph-first rule, this operation correctly reports `BLOCKED_CONFLICT`, including line numbers but **not private line contents**. Review/reconcile that instruction manually with backup and explicit approval before applying; do not remove unrelated user preferences. The tool does not edit other global or workspace files and cannot guarantee their priority: inspect effective instructions in a fresh agent session.

**Important limitations:** the script changes only global instructions, not MCP registrations, indexes, credentials, tools, provider model settings or run-time executor permissions. It does **not** install the PR on the owner's machine automatically. Instruction-based routing is a preference, not a hard tool-execution guard. Real end-to-end acceptance requires fresh Codex/Antigravity/Claude sessions on Windows verifying native-first and zero unapproved fallback, with the Odoo 17 workspace as a regression. Keep PR #128 Draft, preserve PR #126/#127 and all unrelated owner worktrees.

Tests: `python -m unittest scripts.tests.test_global_routing scripts.tests.test_tool_family_routing scripts.tests.test_efficient_coding_refinement -v`.
