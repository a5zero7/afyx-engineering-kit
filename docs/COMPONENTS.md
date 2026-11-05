# Afyx Component Guide

This guide describes the executable source tree, not a target architecture. The
canonical lifecycle inventory is [`scripts/components.json`](../scripts/components.json).
Historical reports remain useful evidence, but they do not override that contract
or the current implementation.

**Contract and implementation boundary:** the owner-approved [AfyxUniversalInterop/v1](AFYX_UNIVERSAL_COMPONENT_INTEROPERABILITY.md) defines **default-enabled discovery/integration for all installed Afyx-owned registry components**, including future components and passive, permission-gated Usage Tracking; tasks invoke only relevant capabilities. The six primary products remain the initial functional baseline, not a fixed allow-list. The AFYX-307/308/309 runtime implements deterministic discovery, selection, bounded adapter execution, real host adapters, and request/result contracts in `scripts/afyx-capability-orchestrator.mjs` and `scripts/afyx-host-adapters.mjs`. The installed component must still work alone; simple source edits invoke no unnecessary Afyx runtime.

## Six independent Afyx products

All six products are first-class parts of Afyx Engineering Kit. "Core" and
"optional" in the [component registry](../scripts/components.json) describe
**installation presets**, not a hierarchy of product importance.

| Product | Standalone interface | Kit selection | Current boundary |
|---|---|---|---|
| [**Afyx Graph**](../afyx-graph/engine/README.md) | Node.js CLI, optional MCP and local viewer | `full` or explicit component | Technical Alpha; static code intelligence |
| [**Afyx Forge**](../afyx-forge/README.md) | Node.js CLI/API with bounded policy and plans | Explicit component on Windows; dedicated standalone installer | Forge Core v0.1.0, Technical Alpha; A8 campaign pending |
| [**Afyx Efficient Coding**](tool-guides/AFYX_EFFICIENT_CODING.md) | Agent instruction skill | `minimal`, `recommended`, `full` | v1.2.1; source-backed implementation workflow |
| [**Afyx Odoo Engineering**](tool-guides/AFYX_ODOO_ENGINEERING.md) | Version-aware agent skill | `minimal`, `recommended`, `full` | v1.2.0; references for Odoo 10–20 |
| [**Afyx Context Engine (ACE)**](../afyx-context/README.md) | Node.js CLI/API | Explicit component only | v0.1.0, Technical Alpha; original-content recovery |
| [**Afyx Engineering Expert**](../skills/afyx-engineering-expert/README.md) | Cross-disciplinary agent skill | `recommended`, `full` | v0.1.1; final D.6 acceptance pending |

### Shared infrastructure and optional tooling

| Capability | Role | Availability |
|---|---|---|
| Kit lifecycle and capability router | Install, update, verify, doctor, discovery, and task-scoped routing; **not a seventh engineering product** | Cross-platform entrypoints; host support varies |
| [Afyx Codex Usage Tracking](CODEX_USAGE_TRACKER.md) | Optional observability utility; **not a seventh primary engineering product** | Windows; selected by `full` or explicit option |

## Afyx Graph

### Purpose

Afyx Graph is local structural code intelligence. It discovers eligible files,
extracts supported declarations and relationships, stores them in SQLite, and
exposes repository evidence through a CLI, an optional MCP server, and a local
viewer.

### Available capabilities

- Initialize, rebuild, sync, and report separate Git/content/extraction health.
- Search declarations and inspect a symbol with caller/callee context.
- Explore a concept with bounded source and call paths.
- Enumerate supported Python class assignments with explicit coverage/pagination.
- Analyze structural impact and select affected tests.
- Serve the `afyx_graph` MCP with tools named `afyx_graph_*`.
- Use project-local `.afyx-graph/` state or a bound external state directory.
- Run daemon/MCP lifecycle and local viewer routes.

Basic operation:

```bash
afyx-graph init /absolute/project --yes
afyx-graph status /absolute/project
afyx-graph query MySymbol --path /absolute/project --json
afyx-graph explore "MySymbol request lifecycle" --path /absolute/project --max-files 5
afyx-graph impact MySymbol --path /absolute/project --depth 2
afyx-graph affected --path /absolute/project src/service.ts
```

For exact supported Python inventory:

```bash
afyx-graph inventory _inherit sale.order --path /absolute/project --scope addons
```

### State and configuration

The default effective state is `<project>/.afyx-graph`. `AFYX_GRAPH_DIR` changes
only that project-relative directory name. For a read-only corpus, set
`AFYX_GRAPH_STATE_DIR` to an absolute external directory before every CLI/MCP
invocation:

```powershell
$env:AFYX_GRAPH_STATE_DIR = 'D:\AfyxState\project-a'
afyx-graph init 'D:\Source\project-a' --yes
```

```bash
export AFYX_GRAPH_STATE_DIR="$HOME/.local/state/afyx/project-a"
afyx-graph init "$HOME/src/project-a" --yes
```

External state is bound to exactly one canonical project root. Empty, relative,
overlapping, aliased, foreign, malformed, or cross-project locations fail closed;
there is no silent fallback into the source tree.

Kit installation may configure the Codex MCP entry through the native `codex mcp`
interface. Use `-SkipGraphMcp` / `--skip-graph-mcp` to prevent this. To inspect a
provider snippet without writing configuration, use:

```bash
afyx-graph install --print-config codex
```

### Validation and limitations

Use `afyx-graph status` before relying on results. A `STALE`, incomplete,
unsupported, skipped, or ignored coverage dimension must remain visible in the
engineering conclusion. Graph is static structural evidence: runtime dispatch,
generated behavior, database state, permissions, and tests still require their
own evidence. Markdown and generic JSON are catalogued as metadata rather than
structurally indexed content.

Troubleshooting:

- `not initialized`: run `init` for the exact project/state pairing.
- `STALE`: inspect pending changes, then run `sync` only when updating that index
  is intended.
- external-state ownership/path error: verify absolute canonical containment and
  `project.json`; do not delete or rebind foreign state automatically.
- MCP unavailable: run the Kit verifier and distinguish not configured, blocked,
  and failed handshake states.
- daemon shutdown/startup issue: preserve lock/registry evidence; do not kill a
  process based on PID alone.

Detailed implementation notes are in the [Graph README](../afyx-graph/engine/README.md).

## Afyx Engineering Expert

### Purpose and capabilities

Engineering Expert is one adaptive instruction skill, not 13 simultaneous agents.
It chooses a primary discipline and initially at most two supporting disciplines
from product, analysis, architecture, UX, software, AI/data, ERP, security,
reliability, database, and QA guidance. Six optional workflows cover discovery,
implementation, debugging, review, incident/reliability, and AI/data/ERP work.

Invoke it explicitly for substantive cross-disciplinary work:

```text
Use afyx-engineering-expert to review this payment-service change. Establish the
requirements, trust boundary, failure modes, data impact, and acceptance tests.
```

It composes with Efficient Coding for implementation and with Odoo Engineering
for release-specific Odoo facts. Graph is optional repository intelligence, not
an activation dependency.

### Installation, validation, and limitations

It is installed by Recommended/Full or explicit component selection. Open a new
host session and verify it appears in the skill picker or invoke its exact name.
The skill has no runtime dependency, implicit network access, or hidden download.

It is an evidence-oriented instruction system, not a production certification.
Final Expert D.6 substantive acceptance, broad SME sign-off, and universal
framework expertise are not claimed. When repository or runtime evidence is
missing, its conclusions must say so.

Troubleshooting: remove duplicate same-named skill copies across user/project
scope, reopen the host session, and verify the installed `SKILL.md` metadata.
See the [Expert README](../skills/afyx-engineering-expert/README.md).

## Afyx Forge Core

### Implemented Technical Alpha runtime

Afyx Forge Core `0.1.0` is an independent, **assistive guidance** runtime in
`afyx-forge/` (`@afyx/forge-core`). The `afyx-forge` CLI and Node.js API
classify engineering tasks, select proportional policies, recommend source/Graph/
domain guidance, and produce investigation, validation, and completion plans.
It does **not** autonomously edit code, dispatch arbitrary agents, run a
benchmark model, or certify that a proposed task has been executed.

```bash
afyx-forge --version
afyx-forge doctor
afyx-forge plan --task "Investigate cross-module authorization failure" --format markdown
```

`skills/afyx-forge/SKILL.md` is an optional, on-demand provider companion.
When ACE is installed and healthy, Forge planning may mark it available by
default; explicit `AFYX_CONTEXT_OPT_IN=0` disables this. Availability or
routing is **not** evidence that ACE ran or that Graph MCP output was intercepted.
Graph remains an optional source of structural evidence.

Forge Core is registered as `afyx-forge` in `scripts/components.json` but
is **not included in implicit presets**. On Windows it can be selected with
`-Preset custom -CustomComponent afyx-forge`; standalone installers exist for
Windows and Unix. Do not assume the current Kit-level Unix preset orchestration
installs Forge automatically.

### Formal Forge evaluation remains gated

Separate from the Alpha guidance runtime, `evals/forge/` maintains B0–B5
candidates, deterministic fixtures, validation tools, controller and isolated
evaluation preparations. The authorized **36-cell** campaign is still
`0/36 NOT_RUN`; A8 has **no GO**. Do not equate native CLI availability,
synthetic validation, or healthy CI with final Forge A8/A12 acceptance.

See [Forge Core README](../afyx-forge/README.md),
[Alpha product guide](AFYX_FORGE_CORE_ALPHA.md),
[A0–A3 contract](AFYX_FORGE_A0_A3_CONTRACT.md), and
[T09 readiness](AFYX_FORGE_T09_P0_READINESS.md).

## Afyx Context Engine

### Purpose and capabilities

ACE is a standalone local Node.js API/CLI for conservative reduction and
byte-exact recovery. It stores originals in a content-addressed state root,
verifies digests on retrieval, serializes local writers, and recovers only when
same-host process evidence safely proves a stale lock.

```bash
afyx-context reduce --state /absolute/owned/state --owner owner-a \
  --session source-sha --input request.json --budget 16000
afyx-context get --state /absolute/owned/state --owner owner-a \
  --session source-sha --reference 'ace:v1:...'
```

API usage and input limits are documented in the [ACE README](../afyx-context/README.md).

### Kit and Graph integration

ACE lifecycle is `managed-optional`. It is absent from Minimal, Recommended, and
Full and must be selected explicitly:

```powershell
.\install.ps1 -Preset custom -CustomComponent afyx-context -Confirm:$false
```

```bash
./install.sh --preset custom --custom-component afyx-context
```

The `ace.integration/v1` optional-consumer contract and
`graph.ace.consumer/v1` bridge retain the complete Graph result as authoritative
fallback. Automatic Graph MCP interception remains default OFF and is not enabled by installation.
On-demand ACE discovery/guidance for a healthy, selected component may be enabled
without automatically reducing any output; explicit user/provider OFF settings
always override availability.

### Limitations and troubleshooting

ACE does not guarantee a context or token reduction. Unique/small content and a
recovery exchange can be net-negative. Protected diagnostic, security, and
source-evidence content remains inline. Coordination is local, not distributed;
state is plaintext and the operator owns access control and retention.

On `LOCK_TIMEOUT` or `LOCK_RECOVERY_UNSAFE`, inspect the recorded process/host
and preserve ambiguous artifacts. Do not delete a lock solely because it is old.
Owner/session mismatch and corrupt content fail closed by design.

## Efficient Coding

Efficient Coding 1.2.1 is a quality-first implementation workflow:
`GROUND → LOCATE → REPRODUCE → CHANGE → VALIDATE → REPORT`. It routes known-file
work directly, uses structural intelligence only when relationships matter, and
expands validation according to risk.

It is a core skill in every implicit preset and has no runtime dependency. Invoke
it for coding, debugging, refactoring, or code investigation—not general chat or
prompt-writing tasks. Validation still depends on the target repository's actual
toolchain. See the [Efficient Coding Guide](tool-guides/AFYX_EFFICIENT_CODING.md) and
its authoritative [`SKILL.md`](../skills/efficient-coding/SKILL.md).

## Odoo Engineering

Odoo Engineering 1.2.0 provides version-aware source guidance for Odoo 10–20,
including ORM, models, views, reports, security, migrations, and debugging. It
selects exactly one target major version from repository/runtime evidence and
loads only that reference (or source plus target for migration work).

It is a core skill in every implicit preset. “Stable references” does not mean
every project customization is known: inspect inheritance, enterprise/community
edition, installed modules, ACL/rules, runtime registry, and database behavior
when material. See the [Odoo Engineering Guide](tool-guides/AFYX_ODOO_ENGINEERING.md) and
its authoritative [`SKILL.md`](../skills/odoo-engineering/SKILL.md).

## Kit installer, updater, verifier, and doctor

The Kit uses one component/control-plane contract across PowerShell and Bash.

| Surface | Role | Mutation |
|---|---|---|
| `install.ps1` / `install.sh` | Inventory, desired-state plan, staged install/repair/update | Only after selected/confirmed action |
| `update.ps1` / `update.sh` | Clean fast-forward self-update, then component lifecycle | Yes; dirty checkout stops before install |
| `verify.ps1` / `verify.sh` | Validate installed desired state and optional capabilities | No |
| `scripts/afyx-doctor.*` | Report host/component/project diagnostics | No |
| `uninstall.ps1` / `uninstall.sh` | Remove only ownership-verified selected components | Yes |

State is one of `NOT INSTALLED`, `HEALTHY`, `INCOMPLETE`, `INVALID`, `DRIFTED`,
or `UNKNOWN`. Foreign/unknown targets are preserved. Preview, ownership,
transaction, backup, rollback, and recovery behavior is detailed in the
[Installation Guide](INSTALLATION.md).

## Usage Tracking

Usage Tracking is an optional Windows-only local toolset installed under the
Codex tools directory. It consumes Codex session events and can display a summary
through the global Stop hook; a VS Code watcher is retained for fallback/debug.
Full selects it on Windows and marks it not applicable on Linux/macOS.

It estimates token categories and API-equivalent cost from available local
events and a pricing table. It is not provider-authoritative billing, does not
reconstruct unavailable data, and can report partial/unavailable fields. Review
and trust hooks explicitly. See [Usage Tracking](CODEX_USAGE_TRACKER.md).

## Optional host integrations

- **Codex MCP:** Graph registration is optional, consented, and managed through
  the native Codex CLI. Conflicting/unproven entries are preserved.
- **ChatGPT Skills:** Expert can be packaged manually where account/workspace
  policy supports Skills upload. Kit installation does not perform that upload.

Provider, credentials, model, proxy, unrelated MCP entries, and external product
state are outside the Kit's ownership boundary. Retired external integrations
are not discovered or managed; existing user-owned installations remain untouched.
