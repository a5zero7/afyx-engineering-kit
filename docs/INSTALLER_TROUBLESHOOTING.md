# Afyx Installer Troubleshooting and Recovery Guide

This guide documents diagnostic steps, common failure modes, and recovery procedures
for the Afyx Code Engineering Kit Windows installer (`install.ps1`, `AfyxSetup.exe`, `update.ps1`, `verify.ps1`, and `uninstall.ps1`).

---

## 1. Prerequisite and Host Detection Failures

### Node.js runtime missing or version < 22.5.0
- **Symptom:** Installer preflight fails with `Node.js >=22.5.0 is required for Graph/Context`.
- **Cause:** Afyx Graph engine and Afyx Context Engine require Node.js 22.5.0+ for native V8 features and ESM compatibility.
- **Resolution:**
  - Verify installed Node.js version: `node --version`.
  - Install or update Node.js 22.5.0+ from [nodejs.org](https://nodejs.org/).
  - Ensure the Node.js installation directory is on the system or user `PATH`.

### Codex CLI detected as VS Code extension only
- **Symptom:** Preflight reports `Codex host: native CLI unavailable; VS Code extension detected`.
- **Cause:** Automatic MCP registration requires `codex.exe` or `codex.cmd` CLI on `PATH`. The VS Code extension does not provide headless MCP configuration CLI tooling.
- **Resolution:**
  - Install the native Codex CLI tool.
  - Or skip Codex provider MCP registration using `-SkipProviderConfiguration` or `-Provider skip`.

### Git or tar command missing during source staging
- **Symptom:** Installation stops with `Git and tar are required for clean source staging when building from local repository`.
- **Cause:** When building Afyx Graph without a pre-existing release archive, the installer extracts a clean commit tree via `git archive` and `tar` to prevent uncommitted local changes from polluting the artifact.
- **Resolution:**
  - Ensure Git for Windows is installed (it includes both `git.exe` and `tar.exe` in `C:\Program Files\Git\usr\bin`).
  - Or provide a pre-packaged verified archive via `-ArchivePath <path>` with matching `SHA256SUMS`.

---

## 2. Artifact and Release Cache Issues

### Afyx Graph release archive not found or revision mismatch
- **Symptom:** Build or install stops with `Afyx Graph win32 release artifact not found` or `Ignoring valid but stale local release cache`.
- **Cause:** The release zip `afyx-graph-win32-x64.zip` in `afyx-graph\engine\release\` is missing, corrupted, or built from a different Git revision than requested.
- **Resolution:**
  - Build the Graph engine release archive:
    ```powershell
    Set-Location afyx-graph\engine
    npm run build
    node scripts/build-release.mjs
    ```
  - Verify that `afyx-graph-win32-x64.zip` and `SHA256SUMS` exist in `afyx-graph\engine\release\`.

### Mandatory capability contract preflight failure
- **Symptom:** Builder fails with `Required capability contracts directory missing: scripts\contracts`.
- **Cause:** Fail-closed preflight (AFYX-304) requires `afyx-capability-request-v1.schema.json` and `afyx-capability-result-v1.schema.json` to ensure host-bridge productization integrity.
- **Resolution:**
  - Ensure `scripts/contracts/` contains valid schema definitions.
  - Do not bypass this check; packaging requires authoritative capability contracts.

---

## 3. Ownership and Integrity Conflicts

### Unknown or foreign ownership detected (`FOREIGN_EXISTS` / `AMBIGUOUS`)
- **Symptom:** Installer aborts with `Refusing to replace skill ... because ownership is FOREIGN`.
- **Cause:** A file or skill exists in the destination root that was not installed by Afyx or has conflicting provenance metadata.
- **Resolution:**
  - The installer enforces fail-closed isolation and will never overwrite unowned third-party files.
  - Inspect the destination directory. If you intentionally wish to adopt the file, back it up first, remove it, or use custom component targeting.

### Modified Afyx-owned component (`AFYX_OWNED_MODIFIED`)
- **Symptom:** Installer reports that an owned component has been modified locally.
- **Resolution:**
  - Re-running the installer with `-Preset` or `-ComponentAction <id>=repair` safely archives the modified version to `$env:AFYX_BACKUP_ROOT` before restoring the canonical version.

---

## 4. Interrupted Operations and Rollback

### Restoring from automatic backups
- **Location:** By default, backups are archived in `~/.afyx/backups/<component-id>/<timestamp>-<hash>/` (or `$env:AFYX_BACKUP_ROOT`).
- **Procedure:**
  1. Inspect the backup directory:
     ```powershell
     Get-ChildItem -Path "$env:USERPROFILE\.afyx\backups" -Recurse
     ```
  2. Verify ownership metadata in the candidate backup before manual restoration.
  3. To re-apply clean canonical state, run:
     ```powershell
     .\install.ps1 -Preset recommended -Confirm:$false
     ```

### Staged atomic transaction cleanup
- **Symptom:** Stale `.stage-*` or `.backup-*` directories remain in runtime roots.
- **Cause:** A hard crash or power interruption during file copy.
- **Resolution:**
  - The lifecycle managers (`afyx-host-bridge-lifecycle.mjs`, `install-afyx-graph.ps1`) automatically clean up orphaned staging directories on subsequent runs.
  - Run verification to confirm current active runtime status:
     ```powershell
     .\verify.ps1 -Preset recommended
     ```
