# AFYX Codex Usage Tracking (Windows)

A local PowerShell toolset that summarizes Codex token usage from existing
rollout telemetry. It is **not** a billing integration and does not transmit
prompts, responses, or source code to external services.

## Components

- `CodexUsage.psm1`: usage parsing and per-turn accounting
- `codex-usage-stop.ps1`: completed-turn hook output
- `codex-usage-watch.ps1`: optional local watcher
- `codex-usage-doctor.ps1`: diagnostics
- `codex-usage-pricing.json`: API-equivalent rates, not invoice amounts

## Installation and limits

Windows-only; the `full` Kit preset includes this tool when Codex is selected.
It can also be explicitly selected or skipped through Kit setup. Its readings
depend on the available Codex rollout telemetry/schema and known pricing data;
unknown model pricing is reported as unavailable, not guessed.

Use [the maintained usage guide](../../docs/CODEX_USAGE_TRACKER.md) for
configuration, privacy, verification, and troubleshooting, or
[Kit installation](../../docs/INSTALLATION.md) for preset behavior.
