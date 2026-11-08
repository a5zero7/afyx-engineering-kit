# Afyx Technical Alpha — Distribution Readiness & Release Checklist

**Target:** Windows Technical Alpha Distribution Gate (AFYX-77 / AFYX-130 / AFYX-131)\
**Baseline Build Source:** `2586f084ba0e7a10ef8246281f3c790c9932100d`\
**Artifact Candidate:** `dist/AfyxSetup.exe` (SHA-256: `737909c5fa2d5c755b2ab7a4c89ec8fe6420dd3868046d8c86fbdbbed0bab6b5`)\
**Package Status:** Technical Alpha Candidate (Internal / Dogfood Evaluation Only; Not Public Release Ready)

---

## 1. Readiness Gate Summary Matrix

| Gate | Category | Status | Evidence & Verification Detail |
|---|---|:---:|---|
| **G1: Source-Artifact Parity** | Artifact Integrity | **PASS** | Exact source revision match in `build-manifest.json` (`2586f08`), SHA-256 checksums verified in `SHA256SUMS`. |
| **G2: Hermetic Contract Preflight** | Architecture | **PASS** | Mandatory capability schemas (`afyx-capability-request-v1`, `afyx-capability-result-v1`) embedded and verified against source. |
| **G3: 7-Component Clean Installation** | Runtime Lifecycle | **PASS** | All 7 components verified physically present on disk; CLIs for Graph, Context, and Forge active. |
| **G4: Verification & Idempotence** | Runtime Lifecycle | **PASS** | `AfyxSetup.exe --verify` passes; repeated execution preserves healthy state without unintended mutation. |
| **G5: Safe Uninstall & Preservation** | Safety & Isolation | **PASS** | Managed runtimes cleanly removed; user files and foreign configuration (Codex, Antigravity, Claude) preserved. |
| **G6: Graph Vitest Suite** | Engine Test | **PASS** | 5,836 passed, 32 skipped across 338 test files (pre-push hook). |
| **G7: Semantic Baseline & MCP Smoke** | Engine Test | **PASS** | Extraction v28 and Odoo v29 additive contracts pass (6 fixtures); 21 CLI/MCP smoke checks pass. |
| **G8: Workspace Hygiene** | Repository | **PASS** | Canonical worktree layout, zero dangling junctions, clean index boundaries (`Test-AfyxWorkspaceHygiene.ps1`). |
| **G9: Legal & Identity Provenance** | Governance (AFYX-320) | **PASS** | Permitted classified historical residue verified; proprietary licensing headers and author provenance intact. |
| **G10: Programmatic TUI Layout** | UI & Terminal | **PASS** | 48/48 unit tests pass (`test_terminal_tui.py`); wide (80-col) and narrow (40-col) layouts, NO_COLOR fallback. |
| **G11: Human Windows Terminal Visual** | UI & Terminal | **NOT TESTED** | Automated CLI agent execution only; live interactive human visual inspection gate remains unexecuted. |
| **G12: Authenticode Code Signing** | Distribution Security | **BLOCKED** | Binary is unsigned (`UNSIGNED_ALPHA_CANDIDATE`); official code-signing certificate is not provisioned. |
| **G13: Cross-Platform Parity** | Platform Support | **BLOCKED** | macOS/Linux packaging and full adapter parity are deferred; Technical Alpha scope is Windows-first. |
| **G14: Public CDN & Release Publishing** | Release Automation | **BLOCKED** | External spending limits / account restrictions active; release publishing gate remains closed. |
| **G15: MSI / AppX Native Installer** | Packaging | **NOT APPLICABLE** | Standalone bootstrapper (`AfyxSetup.exe`) is the approved Technical Alpha packaging target. |

---

## 2. Detailed Gate Analysis & Known Blockers

### Gate G11: Human Windows Terminal Visual Review (`NOT TESTED`)
- **Condition:** The Midnight Circuit dashboard, scrollable event log, and keyboard selection are programmatically verified across PowerShell 5.1 and PowerShell 7.
- **Requirement for Release:** A human operator must visually verify the rendering in a native Windows Terminal window before public general availability. For source backup to `dev`, this gate is non-blocking under the owner's policy.

### Gate G12: Authenticode Code Signing (`BLOCKED`)
- **Condition:** `AfyxSetup.exe` is built using the .NET C# compiler (`csc.exe`) without a digital signature certificate.
- **Requirement for Release:** Public Windows distributions trigger Microsoft Defender SmartScreen warnings unless signed with a trusted EV / Authenticode code-signing certificate.

### Gate G13: Cross-Platform Parity (`BLOCKED`)
- **Condition:** The Bash lifecycle scripts (`install.sh`, `update.sh`) support Codex and Antigravity, but lack full feature parity with the Windows Midnight Circuit wizard and Forge companion staging.
- **Requirement for Release:** Non-Windows platform acceptance must be tracked under separate milestones.

---

## 3. Release Recommendation

**Verdict:** **TECHNICAL ALPHA INTERNAL EVALUATION PASS**

The Windows Alpha source and artifact lifecycle is hermetic, idempotent, and fully verified for developer dogfooding and internal evaluation. General distribution remains **GATED** until code-signing and human visual acceptance are completed.
