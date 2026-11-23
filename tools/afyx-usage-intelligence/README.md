# Afyx Usage Intelligence

Usage Intelligence `1.0.0` is the Kit's optional Windows PowerShell component
for local usage metadata. The Codex collector reads observed counters.
Unavailable provider data is reported as `NOT_AVAILABLE`. API-equivalent
estimates depend on a local pricing table and represent neither billing nor
measured savings.

From the Kit checkout, run the read-only reporter:

```powershell
pwsh -NoProfile -File tools/afyx-usage-intelligence/afyx-usage-intelligence.ps1 -Providers codex -Json
```

Use the Kit installer or uninstaller for ownership-aware lifecycle operations.
Hook or watcher activation requires the relevant host configuration. See the
[installation and usage guide](../../docs/CODEX_USAGE_TRACKER.md).
