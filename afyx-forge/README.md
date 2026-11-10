# Afyx Forge Core

**Standalone adaptive engineering guidance — Technical Alpha v0.1.0.**

Forge Core is an Afyx-owned Node.js runtime that analyzes an engineering task and
returns a bounded, actionable **plan**. Its primary job is to determine which
investigation, source evidence, specialist guidance and validation are warranted
by the task's complexity and risk. It is useful **without** Afyx Graph, Context
Engine, Expert, or the unified Kit installer.

> **Standalone by Design. Integrated by Contract. Activated by Need.**

## What works today

- Deterministic task classification across known-file bugfixes, unknown
  defects, cross-module changes, security-sensitive work, data reliability,
  and negative/simple cases.
- Adaptive execution policies: `DIRECT_MINIMAL`, `FOCUSED_INVESTIGATION`,
  `STRUCTURAL_GRAPH_AWARE`, `DOMAIN_SPECIALIST`, and
  `SECURITY_DEFENSE_IN_DEPTH`.
- Recommendations for source reading, Afyx Graph, Odoo/Expert guidance,
  proportionate checks, and explicit completion criteria.
- `plan` CLI with JSON or Markdown output; `doctor` for local environment
  diagnostics; programmatic `createForgePlan` API for Node.js ESM consumers.
- Refusal of recognized unsafe directives. Plans describe permissible work;
  they do **not** authorize the agent or execute the proposed steps.
- Optional on-demand companion `skills/afyx-forge/SKILL.md` on supported hosts.

## Quick start

Requires **Node.js 22.5+**. From this directory, no model account or daemon
is needed for the local deterministic CLI:

~~~bash
node bin/afyx-forge.js --version
node bin/afyx-forge.js doctor
node bin/afyx-forge.js plan --task "Investigate a cross-module authorization regression" --format markdown
npm test
~~~

After an installation that places the launcher on your PATH:

~~~bash
afyx-forge doctor
afyx-forge plan --task-file ./task.md --format json --output ./plan.json
~~~

The result has contract `afyx-forge-plan/v1` and is a **proposal**, not proof
that source code was changed or tests ran. The available task and guidance
fields are defined by `src/index.js` and `contracts/forge-plan-v1.schema.json`.

## Installation and lifecycle

Forge Core is registered as component ID `afyx-forge` in the Kit registry but
**not** included in the implicit `minimal`, `recommended`, or `full` presets.

On Windows, from the Kit root:

~~~powershell
.\install.ps1 -WhatIf -Preset custom -CustomComponent afyx-forge
.\install.ps1 -Preset custom -CustomComponent afyx-forge
.\verify.ps1 -Preset custom -CustomComponent afyx-forge
~~~

For standalone lifecycle on Windows or Unix, inspect the dedicated installers:

~~~powershell
.\scripts\install-afyx-forge.ps1 -ValidateOnly
~~~

~~~bash
./scripts/install-afyx-forge.sh --validate-only
~~~

The current Kit-level Unix preset flow should not be assumed to select Forge
Core: use the dedicated standalone installer when that capability is needed.
Read [Installation](../docs/INSTALLATION.md) and the
[Forge Core Alpha guide](../docs/AFYX_FORGE_CORE_ALPHA.md) for supported flags,
ownership and rollback. Never overwrite foreign/user-owned runtime state.

## Optional component cooperation

Forge recommends **Graph** only when structural or cross-file relationships
materially help. If Graph is absent, its plan suggests direct-source methods.

A healthy installed **Context Engine** may be considered available for on-demand
use by the current policy; `AFYX_CONTEXT_OPT_IN=0` explicitly disables it.
The `ACTIVE` policy value means *available for a selected task*, **not** proof
of actual context reduction, automatic Graph MCP interception, or token savings.

**Engineering Expert** and **Odoo Engineering** provide specialist instructions,
not mandatory Forge runtime dependencies. Forge does not replace their
source-grounded review.

## Governance and known limits

**MB8.1 owner decision (2026-11-10):** A8 is GO for the local-first, assistive Forge Planner and adaptive guidance architecture. The Project Owner waived the formal 36-cell campaign for this scoped decision; its result remains `0/36 NOT_RUN`. Autonomous execution is not authorized, provider token savings are not measured, and public npm publication is deferred. Historical campaign requirements remain recorded in `evals/forge/`.

**Important distinction:** Forge Core Alpha is **not** the formal Forge
B0–B5 benchmark campaign under `evals/forge/`.

| Boundary | Current state on the verified `dev` baseline |
|---|---|
| Forge Core CLI/API and deterministic guidance | Implemented as Technical Alpha v0.1.0 |
| Standalone ordinary task planning | Available; examine output against the task |
| Autonomous source mutation or tool execution | Not provided |
| Formal benchmark campaign | `0/36 NOT_RUN`; waived by owner for local-first scope |
| Forge A8 architecture decision | `GO_OWNER_APPROVED_LOCAL_SCOPE` |
| Full Forge A12 / Stable v1 acceptance | Not claimed |

The presence of a plan, a passing unit test, or successful Kit CI must not be
relabelled as a formal campaign verdict. Follow the separate
[A0–A3 contract](../docs/AFYX_FORGE_A0_A3_CONTRACT.md),
[evaluator readiness](../docs/AFYX_FORGE_T09_P0_READINESS.md), and
[master roadmap](../docs/AFYX_V1_MASTER_ROADMAP.md).

## Source, validation and license

- Runtime: `src/`; launcher: `bin/`; plan schema: `contracts/`.
- Validation from this directory: `npm test`.
- Package: `@afyx/forge-core` v0.1.0, declaring `Apache-2.0` in
  `package.json`. Review distribution-specific notices independently of the
  Kit root's MIT license.

Source baseline: `dev` at `e332230a2c0ba162b447af1359cf591057ce26b6`
(2026-11-05). This identifies the reviewed **source**, not a signed public release.
