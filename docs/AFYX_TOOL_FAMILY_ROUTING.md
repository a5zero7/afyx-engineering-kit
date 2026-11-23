# Afyx-first Tool Family Routing — candidate v1

Owner decision: 2026-10-29. Scope: Afyx Code Engineering Kit and its host/editor/CLI/MCP integrations. This contract **does not install or enable anything** and does not change the existing ProviderAdapter/v1, AfyxEngineeringTask/v1 or Result/v1 schemas.

## Principle

For a required *capability*, prefer an **installed, enabled, authorized, reachable, healthy, compatible, sufficiently fresh Afyx-family component** over a comparable external tool. "Installed" alone is not readiness or permission. The rule applies to Graph, Context, and future tool families, rather than hard-coding one brand's name.

| Situation | Route |
|---|---|
| Exact known file, symbol or small source question | Direct source inspection / `rg` |
| Native Afyx component is ready for the required capability | Native Afyx MCP/CLI first |
| Native Afyx component absent, unsupported, unhealthy, stale or otherwise unsuitable | External equivalent *only if* independently installed, individually enabled/authorized and fallback expressly permitted; otherwise direct source |
| External graph MCP disabled, external graph CLI on PATH | Do not infer CLI consent from binary presence; separate CLI authorization required |
| Native Afyx deliberately disabled | Do not silently re-enable or override its user setting |
| Legacy external index folder exists, Afyx Graph available | Afyx Graph wins on relevant relational queries |
| External unavailable or forbidden | Direct source inspection; report unsupported functionality when needed |

External fallback includes a compatible independently installed graph indexer or other tool. **No external code is bundled, copied, relicensed, auto-downloaded or auto-configured as an Afyx component.** External tools retain their own ownership and licensing. Never bypass a denied permission or disabled endpoint through a shell, alias or second surface. The user can explicitly authorize an alternative for a task, subject to applicable access controls.

If graph evidence is stale/partial/unsupported, verify exact source rather than treating an index as authoritative. The same functional routing rules govern each installed provider; presence of a tool schema on one host never proves it exists on another.

## Versioned pure resolver (reference only)

`scripts/afyx-tool-family-routing.mjs` exports `AfyxToolFamilyRouting/v1` and `resolveAfyxToolFamilyRoute`. It accepts caller-verified candidate observations per MCP/CLI surface: `id`, `ownership: AFYX|EXTERNAL`, `surface`, `capabilities[]`, `installed`, `enabled`, `reachable`, `healthy`, `authorized`, `compatible` and verified boolean `fresh`. `allowExternalFallback` defaults to false. It returns a route and reason **without probing, invoking, installing, or changing any tool or setting**.

This candidate is **not wired into an arbitrary live agent or provider adapter yet**. Host-agnostic synthetic tests establish routing semantics only; an uncontrolled agent can still invoke a legacy external binary if it reads stale workspace instructions.

## Remaining live acceptance (AFYX-302)

1. Investigate effective user, parent and workspace `AGENTS.md`, installed skills and session policy in the Odoo 17 DEV-2026-4885 workspace; locate the instruction that caused the observed external graph exploration shell call.
2. Update installed/user instructions only after owner approval, preserving unrelated configuration and existing external installations.
3. Run a fresh real-agent comparison: known-source direct read; relational native Afyx first even with an external graph executable on PATH and legacy external index state present; Afyx missing + independently authorized external fallback; disabled external MCP and unauthorized CLI both rejected.
4. Extend the helper's integration to real host surfaces under a separate reviewed change; this source-only policy must not be claimed as end-to-end enforcement.
5. Preserve owner Odoo files, source worktrees, and independent PRs #126/#127. Do not auto-merge.
