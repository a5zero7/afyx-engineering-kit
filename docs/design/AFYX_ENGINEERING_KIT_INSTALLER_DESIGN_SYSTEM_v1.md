# AFYX Engineering Kit — Brand, CLI and Installer TUI Design System

**Status:** Design baseline v1 — approved concept; implementation and npm publication pending  
**Jira:** [AFYX-316](https://afifbendol.atlassian.net/browse/AFYX-316)  
**Product:** AFYX Engineering Kit (independent AFYX family product)  
**CLI npm package (proposed):** `afyx-engineering-kit`  
**Intended command (after publishing):** `npx afyx-engineering-kit install`

## 1. AFYX philosophy (product-author statement)

> **A — Origin / Awal:** Simbol awal; berangkat dari kesadaran diri, bukan label dari pihak lain.  
> **F — Focus / Foundation:** Konsistensi dan fondasi; bukan sekadar cepat, tetapi fokus dan stabil.  
> **Y — Choice / Why:** Persimpangan pilihan dan kebiasaan bertanya; memilih jalannya sendiri.  
> **X — Unknown / Edge:** Variabel yang belum didefinisikan; kemampuan menjelajah hal yang tidak pasti.

**Unified meaning:** Afyx adalah identitas yang memulai dari diri sendiri, membangun fondasi, sadar menentukan arah, dan tetap berkembang saat menghadapi hal yang belum diketahui.

**Brand signature:** **“Afyx — I choose my path, even in the unknown.”**  
Secondary: “Afyx — the chosen path.”

Guiding product character: **independent, focused, stable, intentional, modern, efficient**. Wolf motif is optional original supporting artwork, not a copied logo or required CLI decoration.

## 2. Naming architecture / collision avoidance

| Level | Identifier | Rule |
| --- | --- | --- |
| Brand umbrella | AFYX | May cover multiple independent products |
| Current product | AFYX Engineering Kit | Specific engineering-kit identity |
| npm package | `afyx-engineering-kit` | Verify npm registry availability/ownership before publication |
| Executable binary | `afyx-engineering-kit` | Keep package/bin 1:1 for predictable `npx` semantics |
| Primary command | `npx afyx-engineering-kit install` | **Planned**, not a currently verified executable |
| Other products | e.g. AFYX Notch | Separate package name, CLI and release lifecycle |
| Scoped alternative | `@afyx/engineering-kit` | Only if scope is acquired/available and product owner chooses it |

`npx` requires an npm package exposing an executable `bin`; a CLI with a single bin entry avoids ambiguity. Reserve/package ownership early and verify in npm before implementing publishing. The existence of an unclaimed name is not a reservation.

Proposed command surface (only activate when implemented):

```console
npx afyx-engineering-kit install
npx afyx-engineering-kit doctor
npx afyx-engineering-kit verify
npx afyx-engineering-kit update
npx afyx-engineering-kit uninstall
```

## 3. Terminal design tokens

| Token | Color | Purpose |
| --- | --- | --- |
| Background | `#0B1020` Midnight Graphite | Calm dark canvas |
| Surface | `#11192B` Deep Slate | Dialogs/panels |
| Primary | `#22D3EE` Electric Cyan | Active steps, focus, progress |
| Secondary | `#8B5CF6` Spectral Violet | Selection, accents |
| Accent | `#60A5FA` Frost Blue | Neutral highlights |
| Text | `#E5F2FF` Ice White | Readability |
| Muted | `#93A4BB` | Secondary metadata |
| Success | `#34D399` Emerald | Verified success only |
| Warning | `#FBBF24` Amber | Risk/consent |
| Error | `#FB7185` Coral | Failed state |

**Visual motif:** subtle lines suggesting the branch of **Y** and crossing of **X**, restrained angled corner geometry, softly luminous borders; never at the cost of text clarity. Modern terminal UI with ASCII fallback.

**Animation and accessibility:** spinner when stage duration unknown, progress only if measurable; `NO_COLOR`, reduced motion, low-color and monochrome/TTYless fallback; <=80-column readability; no fabricated completion values, sizes or ETA. Animated visual is decorative and must not hide errors.

## 4. Installation interaction

1. **Detect platform & providers (read-only):** Windows/macOS/Linux, architecture, terminal capabilities, available provider CLI/installations; distinguish detected vs configured vs healthy.
2. **Select provider scope:** all detected or manually multi-select; support no compatible provider with clear guidance.
3. **Select kit preset:** Low, Medium, Full, Custom. Presets must reference a versioned component registry and show actual included features/dependencies, not mock examples as facts.
4. **Review install plan:** paths, versions, checksums, disk need (if measurable), backup/rollback, permission/credential impact.
5. **Explicit user confirmation:** no global provider settings or installed candidate touched before approval.
6. **Install transactionally:** versioned artifacts, measured progress, safe retry/rollback, cancellation handling, redacted logs.
7. **Verify & receipt:** inspect actual results, provider binding, health and recovery procedures.

**Non-interactive:** `--json` for machine use; `--dry-run` never mutates; CI/TTYless requires explicit selected providers/preset/consent flags or safely fails with guidance.

## 5. Architecture and cross-platform

Use a lightweight npm package/Node CLI as an orchestrating launcher over **existing AFYX native component installers, registry, lifecycle and provider adapters**, avoiding duplicate implementation. PowerShell, Bash and platform-specific dependencies must be tested in disposable fixtures across Windows, macOS and Linux; never assume provider path equivalence.

Scope and existing constraints: preserve 30 worktrees, AFYX-305A frozen candidate, native Graph DB and historical AFYX-305 evidence. This product installer design work is not Phase 8 acceptance.

## 6. Design acceptance / release gates

- Correct package/bin behavior confirmed by local `npm exec` / `npx` tests before publishing.
- npm name, ownership and supply-chain identity checked explicitly before publication.
- Provider discovery and multi-select, presets, Custom and recovery flows tested with fixtures.
- No install without consent; no unauthorized profile/global changes.
- Installer uses real progress and verifies immutable artifacts.
- Cross-platform functional validation, contrast/responsive/reduced-motion and non-interactive regression.
- Existing Graph/Forge/Expert and unified installer regression PASS; preserve immutable AFYX-305A.
- No third-party Skillfish source/assets/branding copied to AFYX; original design and provenance retained.

## 7. Saved concept asset

`AFYX_Code_Kit_Terminal_Installer_Concept_v1.png`

The concept is an aesthetic **mockup**, not working CLI evidence. Example component counts, sizes, execution durations and successful statuses in the image are illustrative only; production UI must use verifiable live values.

**Backlog Jira:** AFYX-316 (planned, not yet implemented). Do not publish to npm or mutate owner configurations without explicit authorization.
