# AFYX Engineering Kit

**Engineering intelligence and assurance for evidence-driven software work.**

> **Individually Reliable. Collectively Solid.**
>
> **Best Verified Output. Maximum Accuracy & Precision. Peak Performance. Minimum Effort.**
>
> **Standalone by Design. Integrated by Contract. Activated by Need.**

AFYX Engineering Kit is a local-first ecosystem for understanding code,
orchestrating engineering decisions, validating changes, and managing supporting
tools safely. It is not a prompt collection, a replacement for tests, or a
promise of universal token savings.

The Kit provides six functional Afyx products (Graph, Engineering Expert, Forge,
Context Engine, Efficient Coding, and Odoo Engineering), an optional Windows
Codex Usage Tracking tool, and a shared lifecycle/control plane. Its four
engineering pillars are Graph, Expert, Forge, and Context Engine. Products remain
usable independently; cross-product collaboration is contract-driven, selected
by task relevance, and bounded by permissions and failure isolation.

## Why Afyx

Ordinary coding assistants can generate plausible changes while leaving the
engineer to establish repository structure, impact, version-specific behavior,
and acceptance evidence. Afyx adds reusable engineering controls around that
workflow:

- **Structural repository intelligence** with verifiable file, symbol, call-path,
  dependency, impact, and index-health evidence.
- **Cross-disciplinary engineering orchestration** that selects only the product,
  architecture, security, data, reliability, implementation, ERP, or QA guidance
  relevant to the task.
- **Fail-closed evaluation contracts** for controlled engineering comparison and
  evidence handling.
- **Optional context reduction with exact-original recovery**, never replacing the
  original when doing so would be unsafe or more expensive.
- **Transactional installation and recovery** with ownership boundaries, preview,
  verification, backup, update, and uninstall behavior shared across platforms.

Afyx is aimed at engineers and technical owners who value source evidence,
bounded change, explicit limitations, and reproducible acceptance more than
unqualified automation claims.

## Primary components

| Component | What it does today | Independence and maturity |
|---|---|---|
| [Afyx Graph](afyx-graph/engine/README.md) | Local structural indexing; CLI and optional MCP discovery, navigation, query, inventory, impact, affected-test, freshness, and daemon capabilities | Standalone Node.js runtime; **Technical Alpha** |
| [Afyx Engineering Expert](skills/afyx-engineering-expert/README.md) | Adaptive engineering skill spanning 13 disciplines and six optional workflows | Standalone instruction skill; v0.1.1; final D.6 substantive acceptance is not claimed |
| [Afyx Forge Core](afyx-forge/README.md) | Standalone Node.js v0.1.0 CLI for task classification, adaptive execution policy, bounded engineering plans, and `doctor`; separate formal evaluator fixtures and controller | **Technical Alpha assistive guidance**; available by explicit component selection on supported surfaces; A8 formal 36-cell campaign remains `0/36 NOT_RUN` |
| [Afyx Context Engine (ACE)](afyx-context/README.md) | Conservative context reduction, local crash-safe storage, and byte-exact original recovery | Standalone Node.js v0.1.0; managed explicit Kit opt-in; Graph integration default **OFF** |

Supporting products are [Afyx Efficient Coding](skills/efficient-coding/README.md)
and [Afyx Odoo Engineering](skills/odoo-engineering/README.md). The cross-platform
Kit lifecycle and optional Windows [Afyx Codex Usage Tracking](docs/CODEX_USAGE_TRACKER.md)
complete the current registry. The component registry—not this README—is the
source of truth for ownership, presets, host selection, and installable IDs.

## How the pieces fit

```mermaid
flowchart LR
    U[Engineer / Codex host]
    K[Kit lifecycle<br/>install · update · verify · doctor]
    E[Engineering Expert]
    G[Afyx Graph]
    F[Afyx Forge]
    A[ACE]
    S[Supporting skills<br/>Efficient Coding · Odoo Engineering]

    K -->|managed components| E
    K -->|managed runtime| G
    K -->|explicit opt-in only| A
    K -->|managed skills| S
    U --> E
    U --> G
    U --> S
    E -. optional repository evidence .-> G
    G -. graph.ace.consumer/v1<br/>default OFF .-> A
    F -. optional assistive plan;<br/>not autonomous execution .-> E
```

Solid lines are regular, implemented paths. Dashed lines represent optional
collaboration or an independent evaluation boundary; they do not mean every
component runs on every task. The installed-component discovery/router contract
is not permission to bypass user OFF settings, provider scope, or Forge A8.

## Current product status

This repository is a **Technical Alpha prerelease**. It is not Stable v1, no
formal public Alpha approval is implied, and publisher authenticity remains
unverified unless an artifact has an independently verified attestation.

- Graph, the Kit lifecycle, ACE standalone operation, and the supporting skills
  have executable implementations and regression evidence.
- ACE and Forge are absent from Minimal, Recommended, and Full presets and must
  be selected explicitly. Healthy installed ACE can be discovered for eligible
  on-demand work, respecting explicit disable, without running on every task.
- Automatic Graph–ACE MCP interception remains unproven/default OFF; optional
  consumer paths have exact-original fallback. Context measurements include
  positive and negative net results—no universal savings claim is made.
- Forge Core has a real standalone assistive CLI/API and explicitly selectable
  runtime on supported installation paths. This is distinct from the formal Forge
  B0–B5 evaluator campaign: its 36 cells are still `NOT_RUN` and A8 has no GO.
- Engineering Expert is usable as a skill, while final D.6 substantive review is
  still outside the accepted claims.

**Verified CI checkpoint (2026-11-05):** the `dev` merge
[`e332230`](https://github.com/a5zero7/afyx-engineering-kit/commit/e332230a2c0ba162b447af1359cf591057ce26b6)
closed a Windows Vitest hook-timeout regression. The four post-merge workflows
reported `SUCCESS`: [Graph Build](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333699),
[Kit CI](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333765),
[Windows Installer](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333733), and
[Phase 8 Dogfood](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/41988333780).
This is a CI checkpoint, **not** independent installed-product or Stable v1 acceptance.

See [Product Vision](docs/PRODUCT_VISION.md) for the maintained product contract
and [Component Guide](docs/COMPONENTS.md) for capability and limitation details.

## Quick start

### Prerequisites

- Git.
- Windows PowerShell 5.1+ / PowerShell 7, or Bash 3.2+ on Linux/macOS.
- Codex CLI or the ChatGPT/Codex VS Code extension.
- Node.js 22.5+ when selecting Afyx Graph or ACE.
- npm only when a local build fallback is needed.

### 1. Clone and preview

Windows:

```powershell
git clone https://github.com/a5zero7/afyx-engineering-kit.git
Set-Location afyx-engineering-kit
.\install.ps1 -ValidateOnly
.\install.ps1 -WhatIf -Preset recommended
```

Linux or macOS:

```bash
git clone https://github.com/a5zero7/afyx-engineering-kit.git
cd afyx-engineering-kit
./install.sh --validate-only
./install.sh --dry-run --preset recommended
```

Preview is non-mutating. Inspect every destination and planned action before
continuing.

### 2. Select an actual preset

| Preset | Desired components |
|---|---|
| `minimal` | Efficient Coding, Odoo Engineering |
| `recommended` | Minimal + Afyx Engineering Expert |
| `full` | Recommended + Afyx Graph + Windows-only Usage Tracking |
| `custom` | Only components repeated with `CustomComponent` / `--custom-component` |

ACE and Forge Core are absent from implicit presets. On Windows, select
specific runtimes explicitly; installation does not authorize autonomous
Forge execution or automatic Graph MCP interception:

```powershell
.\install.ps1 -Preset custom -CustomComponent afyx-context -Confirm:$false
.\install.ps1 -Preset custom -CustomComponent afyx-forge -Confirm:$false
```

```bash
./install.sh --preset custom --custom-component afyx-context
# Forge Core has a dedicated standalone Unix installer:
./scripts/install-afyx-forge.sh --validate-only
```

Install Recommended:

```powershell
.\install.ps1 -Preset recommended
```

Codex remains the default host. Native provider-aware onboarding also supports
Antigravity without changing credentials, models, or provider routing:

```powershell
.\install.ps1 -Preset full -Provider codex,antigravity -ProviderScope workspace -WorkspaceRoot (Get-Location)
```

Antigravity-only plans exclude the Codex Usage Tracking component. See the
[Installation Guide](docs/INSTALLATION.md#provider-aware-onboarding) for global
IDE/CLI skill paths, dry-run, verification, and ownership-safe rollback.

```bash
./install.sh --preset recommended
```

Open a new Codex session after skill installation.

### 3. Verify

```powershell
.\verify.ps1 -Preset recommended
.\scripts\afyx-doctor.ps1 -ProjectPath .
```

```bash
./verify.sh --preset recommended
./scripts/afyx-doctor.sh --project .
```

`verify` checks the desired lifecycle state. `doctor` reports local environment
and project diagnostics without installing, repairing, or calling a model.

## First useful workflows

### Discover and navigate a repository

```bash
afyx-graph init . --yes
afyx-graph query getAfyxGraphDir --path .
afyx-graph explore "external state database lifecycle" --path . --max-files 4
```

### Review change impact

```bash
afyx-graph impact getAfyxGraphDir --path . --depth 2
afyx-graph affected --path . src/directory.ts
```

Graph output is static repository evidence. It does not prove runtime behavior;
run the relevant tests and runtime checks before accepting a change.

### Plan a substantial engineering task with Forge Core

After installing the explicitly selected Forge runtime, ask it for a bounded
plan; it does not edit source files or execute tests on your behalf:

```bash
afyx-forge doctor
afyx-forge plan --task "Trace a cross-module data consistency regression" --format markdown
```

For source and full usage, see [Forge Core](afyx-forge/README.md). A planned
validation checklist is **not** a completed validation or formal A8 verdict.

### Ask for a cross-disciplinary review

```text
Use afyx-engineering-expert to review this authentication change. Cover the
architecture, threat boundary, operational failure modes, and acceptance tests;
load only the relevant disciplines.
```

For Odoo implementation facts, pair Expert with Odoo Engineering and establish
the target Odoo major version from repository or runtime evidence.

### Reduce and recover exact content with ACE

```bash
afyx-context reduce --state /absolute/owned/ace-state --owner local-owner \
  --session reviewed-source-sha --input request.json --budget 16000
afyx-context get --state /absolute/owned/ace-state --owner local-owner \
  --session reviewed-source-sha --reference 'ace:v1:...'
```

ACE state is local plaintext and must be protected by host filesystem controls.
References are owner/session-bound, and retrieval verifies the stored digest.

## Lifecycle and safety

The installer inventories before mutation and distinguishes `NOT INSTALLED`,
`HEALTHY`, `INCOMPLETE`, `INVALID`, `DRIFTED`, and `UNKNOWN`. Unknown or foreign
ownership is not silently adopted. Update/repair uses staging, validation,
backup, atomic promotion, and rollback. Project Graph indexes, credentials,
providers, models, unrelated MCP entries, and external tools are preserved.

- Safe installation, update, uninstall, and recovery: [Installation Guide](docs/INSTALLATION.md)
- Component capabilities and troubleshooting: [Component Guide](docs/COMPONENTS.md)
- Read-only diagnostics: [Diagnostics](docs/DIAGNOSTICS.md)
- Product principles and maturity: [Product Vision](docs/PRODUCT_VISION.md)
- Canonical development plan: [Afyx v1 Master Roadmap](docs/AFYX_V1_MASTER_ROADMAP.md)
- Benchmark scope and interpretation: [Benchmarks](docs/BENCHMARKS.md)

## License and third-party boundaries

License scope must be checked **per package**. The Kit root, Graph and ACE are
MIT-licensed in their respective license/metadata files; the standalone Forge
Core package currently declares `Apache-2.0` in `afyx-forge/package.json`.
Do not infer one blanket license from the umbrella README. The Phase 5/AFYX-320
native Graph/UI replacement and provenance review are recorded as completed
for their declared artifact boundary, not as a legal guarantee about every
future dependency or distribution. External tools remain under their own terms;
retain required notices and review provenance before release.
