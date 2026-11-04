# Afyx Installer — Default Enablement and Provider Discovery Contract

**Status:** Alpha refinement (partial implementation; not an acceptance or release claim)

**Baseline:** `dev` at `b273b7b27ba33838075c86870e0b8a58fdbaca95`

**Principle:** Install by Choice. Enable by Default. Integrate by Contract. Execute by Need.

## User-facing requirements

1. Discover compatible installed AI hosts at installation time and show each detected host as a selectable provider. Do not silently install or configure a host that was not selected.
2. For an **interactive fresh installation**, preselect every host that has passed the installer detection requirement; allow the user to deselect any host or skip configuration. Existing explicit CLI flags and non-interactive behavior must remain deterministic.
3. Install only the Afyx components selected by the user/preset. Each newly installed and healthy Afyx component is **enabled by default** on its supported surface.
4. Integrate selected components with the selected providers wherever a supported adapter exists; avoid duplicate registrations and preserve all unrelated provider configuration.
5. **Enablement != invocation**. Choose task-level capability execution only when relevant; expensive Graph indexing, Context optimization, orchestration, and validation must remain demand-driven.
6. Preserve existing user preferences, explicit disablement, security boundaries, consent, privacy, and ownership claims. Never re-enable a deliberately disabled existing configuration as a side effect of an update.
7. Verify installation and registered-provider state independently. Distinguish `INSTALLED`, `CONFIGURED`, `ENABLED`, `RUNTIME_VERIFIED`, `BLOCKED`, `INCOMPATIBLE` and `NOT_TESTED`; do not equate a source file or planned route with live provider functionality.
8. Preserve standalone operation and independent lifecycle. A broken or absent optional component must not break unrelated Afyx capabilities. Support dry-run, rollback, and repeatable installations.

## Context Engine decision

The installed and healthy Context Engine is available by default to Afyx Forge's guidance planner and Afyx modular capability routing. `AFYX_CONTEXT_OPT_IN=1` is no longer required for those *planning surfaces*. `AFYX_CONTEXT_OPT_IN=0` remains an explicit disable override in Forge. Modular routing respects `task.optInContextEngine=false` and `userPreferences.disableContext=true`. A small routine task does not automatically invoke ACE; a `large-context` task or explicit optimization demand can select it.

**Native source candidate added (pending host acceptance):** Graph's MCP session now calls an installed-ACE bridge only for substantial repetitive structural output and exposes exact recovery when an Afyx-owned installed ACE artifact passes manifest verification. A source candidate is not proof of activated provider runtime. Exact installed Windows/provider restart, persisted user-level OFF precedence, corrupted/missing recovery, resource measurements and independent ownership review are still required. Do **not** change legacy artifact `integration_default=OFF` metadata merely to claim success; the design boundary and regression coverage are documented in [AFYX_GRAPH_ACE_MCP_RUNTIME.md](AFYX_GRAPH_ACE_MCP_RUNTIME.md).

## Provider companion integration (implemented in draft PR #139)

On Windows, a selected, installed ACE runtime now receives an Afyx-owned on-demand `skills/afyx-context` companion in every selected provider skill root. A selected Forge Core runtime similarly receives the existing `skills/afyx-forge` Alpha guidance companion. On Linux/macOS, the ACE companion is installed in supported Codex/Antigravity skill roots; Forge host parity is not yet available in the Bash installer. The companion is not a new product, does not add an MCP server, and does not claim automatic Graph output interception. The installer checks Afyx ownership and preserves foreign or modified destinations. An explicit `AFYX_CONTEXT_OPT_IN=0` suppresses automatic ACE companion installation. Explicit uninstall removes only verifiably owned companions. Regression coverage includes three-provider Windows fixtures, Bash syntax and native Graph–ACE consumer fallback tests; live user-session activation remains to be proven.

## Provider selection and integration

- Windows PowerShell wizard preselects all *detected and supported* Codex, Antigravity, and Claude Code CLI hosts. Unavailable hosts remain visible but not selectable.
- The interactive Bash installer preselects detected supported hosts; Bash provider coverage remains limited to its currently implemented adapters.
- Provider configuration remains an explicitly user-confirmed installer operation; no silent changes to a host's existing OFF toggles or external third-party tools.
- Installation receipts must eventually report per-component and per-provider effective enablement, not simply whether the installer command succeeded.

## Acceptance scenarios

| Scenario | Expected behavior |
| --- | --- |
| Three supported providers detected | All selected by default in interactive wizard; operator can deselect any |
| Zero supported providers detected | No provider configuration; no fabricated successful registration |
| New selected healthy Context Engine | Planner marks it available without setting an opt-in variable |
| Small task with Context installed | Context is available but optimizer is not selected |
| Large-context task with Context installed | Context selected by routing policy; execution verified only if actually invoked |
| Explicit Context OFF | No automatic reactivation through a new install/update |
| Provider has unrelated MCP entries | Exact unrelated settings preserved |
| Repeated install | No duplicate skill/MCP entries and no unexpected toggles |
| Graph/Context integration error | Original Graph source output preserved; no false success claim |
| Upgrade, uninstall, interrupted operation | Independent component lifecycle and safe rollback |

## Evidence and remaining work

The draft implementation covers planning defaults, interactive host default selection, IDE-only detection diagnostics, owned on-demand ACE/Forge provider skills on supported hosts, and regression expectations. Full acceptance additionally requires: provider-host integration tests, real Windows installation and restart/readback, verified Graph-to-ACE consumer wiring, parity and limitations on Linux/macOS, preservation of explicit user-level disabled settings, and proof of recovery/fallback. Until those checks pass, report **PARTIAL / NOT_RUN**, never `FULLY_INTEGRATED` or `RELEASE_READY`.

This contract complements the existing Afyx component registry and ProviderAdapter/v1; it must not introduce a second installer or orchestrator.
