# AFYX Engineering Kit — Development Status

**Evidence snapshot:** 5 November 2026, Asia/Jakarta. This file records the
engineering baseline that preceded the documentation-only refresh. For the
current moving head use GitHub's [`dev` branch](https://github.com/a5zero7/afyx-engineering-kit/tree/dev).

## Verified source integration

| Item | Evidence |
|---|---|
| Active development line | `dev` (repository default is `main`, which is **not** this development snapshot) |
| PR #1 | [Native Graph source/semantic and monorepo integration](https://github.com/a5zero7/afyx-engineering-kit/pull/1), merged as `8fb94a8008b880818ce3c02d648e422e71319627` |
| PR #2 | [Windows test-hook timeout correction](https://github.com/a5zero7/afyx-engineering-kit/pull/2), merged as `e332230a2c0ba162b447af1359cf591057ce26b6` |
| GitHub Graph Build | [Run 41988333699](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333699) — success |
| Repository CI | [Run 41988333765](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333765) — success |
| Phase 8 representative dogfood | [Run 41988333780](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333780) — success |
| Windows installer smoke | [Run 41988333733](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333733) — success |

The four workflows above completed on the **post-merge `dev` commit** on
Windows/Linux/macOS where applicable. The owner-reported Graph Build count is
5,836 passed tests with CLI/MCP smoke 21/21; specific successful run and tested
conditions are the evidence, not a general claim of flawless code semantics.

## Actual component state

| Component | Implemented now | Remaining acceptance boundary |
|---|---|---|
| [AFYX Graph](../afyx-graph/README.md) | Native SQLite-backed indexing, source/symbol relations, CLI/MCP, local viewer, cross-package nested tsconfig alias/project-reference resolution and static impact/inventory | Not every registered extension/construct has a separately validated precision/recall matrix; live agent-task and release acceptance continue |
| [AFYX Context Engine](../afyx-context/README.md) | Standalone local reduction/retrieval with owner/session-bound digest-verified recovery; controlled Graph bridge | Opt-in/default OFF, recovery-heavy cases may be net-negative; not a universal provider-token-saving claim |
| [AFYX Forge Core](../afyx-forge/README.md) | Standalone `plan`/`doctor` CLI, deterministic engineering-guidance plan; separate evaluator fixtures/controller | Formal evaluator campaigns and Kit preset activation are not accepted/authorized |
| [Engineering Expert](../skills/afyx-engineering-expert/README.md) | Adaptive instruction skill with 13 core disciplines and six optional workflows | Final D.6 broad substantive acceptance not claimed |
| [Efficient Coding](../skills/efficient-coding/README.md) | v1.2.1 evidence-first coding instruction skill | Not a standalone execution engine |
| [Odoo Engineering](../skills/odoo-engineering/README.md) | v1.2.0 version-aware Odoo 10–20 reference skill | Task-specific repository/version/runtime validation remains mandatory |
| [Usage Tracking](../tools/codex-usage/README.md) | Windows-only local Codex session usage summary | API-equivalent costs are not provider invoices |
| [Kit installers](../docs/INSTALLATION.md) | Windows/Linux/macOS lifecycle and isolated ownership-aware setup/verification | Exact shipped, signed unified v1 release is not implied by CI |

## Provider and product boundaries

Codex and Antigravity/Google MCP connectivity have owner-local evidence; Claude
provider adapter testing was isolated, and not every IDE/CLI/provider surface
was confirmed in an installed, authenticated model session. Check the actual
host/environment rather than inferring blanket provider parity.

Graph's type references, imports, and executable calls are distinct. When a
symbol cannot be resolved statically, the engine should report ambiguity or
unresolved state rather than invent a target. The latest reported monorepo
accuracy fixtures passed, but **100% on small fixtures is not 100% accuracy
across all indexed file types or real repositories**.

## Jira is a checkpoint ledger, not a linear schedule

- [AFYX-127](https://afifbendol.atlassian.net/browse/AFYX-127): native symbol/module resolution implementation — Done
- [AFYX-8](https://afifbendol.atlassian.net/browse/AFYX-8): representative real-repository and agent-task dogfood — In Progress
- [AFYX-294](https://afifbendol.atlassian.net/browse/AFYX-294): multi-provider acceptance — In Progress
- [AFYX-320](https://afifbendol.atlassian.net/browse/AFYX-320): native/release clearance tracking — In Progress; technical integration success does not automatically close every release condition

Do not rewrite protected historical reports to align them with this newer
snapshot. This document does not authorize a `main` merge, package publication,
release, or new integration enablement. The maintained status vocabulary and
release gates remain in [Product Vision](PRODUCT_VISION.md) and the
[master roadmap](AFYX_V1_MASTER_ROADMAP.md).
