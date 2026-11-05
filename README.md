# AFYX Engineering Kit

**Engineering intelligence and assurance for evidence-driven software work.**

> **Individually Reliable. Collectively Solid.**
>
> **Best Verified Output. Maximum Accuracy & Precision. Peak Performance. Minimum Effort.**
>
> **Standalone by Design. Integrated by Contract.**

AFYX Engineering Kit is a local-first ecosystem for understanding code,
orchestrating engineering decisions, validating changes, and managing supporting
tools safely. It is not a prompt collection, a replacement for tests, or a
promise of universal token savings.

The Kit combines four primary product components with focused supporting skills
and lifecycle tooling. Each primary component has an independent operating
boundary; integrations are explicit, versioned, and designed to fall back safely.

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
| [Afyx Forge](afyx-forge/README.md) | Standalone `plan`/`doctor` engineering-guidance CLI plus a separate deterministic evaluation foundation | Core CLI v0.1.0 exists; formal evaluator campaign and Kit preset activation are not accepted |
| [Afyx Context Engine (ACE)](afyx-context/README.md) | Conservative context reduction, local crash-safe storage, and byte-exact original recovery | Standalone Node.js v0.1.0; managed explicit Kit opt-in; Graph integration default **OFF** |

Supporting components are [Efficient Coding](skills/efficient-coding/README.md),
[Odoo Engineering](skills/odoo-engineering/README.md), the cross-platform Kit
lifecycle, and optional Windows [Usage Tracking](tools/codex-usage/README.md).
The [Graph UI](afyx-graph/engine/ui/README.md) is bundled with Graph, not a separately installed product.

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
    F -. evaluation contracts;<br/>not a default runtime path .-> E
```

Solid lines are implemented normal-use paths. Dashed lines are optional or
evaluation contracts; they are not prerequisites for standalone operation.

## Current product status

This repository is a **Technical Alpha prerelease**. It is not Stable v1, no
formal public Alpha approval is implied, and publisher authenticity remains
unverified unless an artifact has an independently verified attestation.

- Graph, the Kit lifecycle, ACE standalone operation, and the supporting skills
  have executable implementations and regression evidence.
- ACE can be installed and managed by the Kit only through explicit component
  selection; it is absent from Minimal, Recommended, and Full.
- Graph–ACE integration is opt-in and disabled by default. Measurements include
  both positive and negative net-context cases; no universal savings claim is made.
- Forge Core exposes a standalone `plan`/`doctor` CLI; its separate evaluator
  foundation has prepared validation surfaces, but full candidate campaigns
  and native release acceptance are not complete.
- Engineering Expert is usable as a skill, while final D.6 substantive review is
  still outside the accepted claims.

**Verified development checkpoint — 5 November 2026:** the Graph semantic-mapping,
monorepo alias, and Windows CI fixes are integrated into `dev` via
[PR #1](https://github.com/a5zero7/afyx-engineering-kit/pull/1) and
[PR #2](https://github.com/a5zero7/afyx-engineering-kit/pull/2).
The engineering baseline at `e332230a2c0ba162b447af1359cf591057ce26b6`
has successful post-merge Graph Build, repository CI, representative dogfood,
and Windows installer workflows. Accuracy claims are limited to named fixtures
and supported static constructs, not every extension or runtime behavior.
The formal v1 release and remaining provider/dogfood acceptance are separate.
See [current development status](docs/DEVELOPMENT_STATUS.md) for exact evidence.

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
git checkout dev  # current validated development line
.\install.ps1 -ValidateOnly
.\install.ps1 -WhatIf -Preset recommended
```

Linux or macOS:

```bash
git clone https://github.com/a5zero7/afyx-engineering-kit.git
cd afyx-engineering-kit
git checkout dev  # current validated development line
./install.sh --validate-only
./install.sh --dry-run --preset recommended
```

Cloning defaults to GitHub's `main` branch; the updated Technical Alpha work
is on `dev`. Preview is non-mutating. Inspect every destination and planned
action before continuing.

### 2. Select an actual preset

| Preset | Desired components |
|---|---|
| `minimal` | Efficient Coding, Odoo Engineering |
| `recommended` | Minimal + Afyx Engineering Expert |
| `full` | Recommended + Afyx Graph + Windows-only Usage Tracking |
| `custom` | Only components repeated with `CustomComponent` / `--custom-component` |

ACE is absent from all implicit presets. Install ACE explicitly
without enabling Graph integration:

```powershell
.\install.ps1 -Preset custom -CustomComponent afyx-context -Confirm:$false
```

```bash
./install.sh --preset custom --custom-component afyx-context
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
- Branch-verified milestone and CI evidence: [Development Status](docs/DEVELOPMENT_STATUS.md)

## License and third-party boundaries

AFYX-owned repository content uses the [MIT License](LICENSE), except where
individual package metadata or license files define another applicable license
(e.g. Forge Core currently declares Apache-2.0). Third-party software and
assets retain their own applicable terms. Historic provenance and license
evidence remains in the repository's retained documentation and Git history.
This development README does not substitute for a release-specific rights or
artifact review.
