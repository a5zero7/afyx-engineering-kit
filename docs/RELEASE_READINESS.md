# AFYX v1.0 — Draf catatan rilis dan kandidat freeze

**Status: RC freeze candidate, untuk peninjauan internal.** Baseline sumber
adalah `eaa409691064b37beed47b2939797c6517a7ad05` pada `dev`. Artefak RC harus
dibangun dari commit pengiriman yang persis dan membawa SHA tersebut. Identitas
rilis publik, versi final, dan tanda tangan komersial menunggu keputusan Owner.
Metadata Kit tetap `0.1.0-alpha.12` dan metadata Graph `1.0.0`.
`main` dibekukan pada `9adf4271da76283ef3b63185c92de4b1238ab03f` menunggu AFYX-87.

## Cakupan kandidat

- Graph menyediakan indeks lokal, penelusuran simbol dan relasi, CLI, dan MCP
  opsional. Target paket Kit mencakup bundel Graph Windows x64, Linux x64,
  macOS ARM64, dan macOS Intel x64. Pemeriksaan paket dan pengujian runtime
  pada host asli merupakan bukti terpisah.
- Context mengurangi keluaran secara lokal dan memungkinkan pemulihan bukti
  asli. Forge menyediakan perencanaan dan diagnostik engineering. Kit juga
  membawa skill Efficient Coding, Odoo Engineering, dan Engineering Expert.
  Dukungan provider serta batas tiap komponen mengikuti
  [kontrak komponen](COMPONENTS.md).
- Ikuti [panduan Kit](../README.md) untuk instalasi, pembaruan, verifikasi,
  uninstall, dan pemulihan. Runtime Graph memerlukan Node.js 22.5 atau lebih
  baru. Jalankan preview bila tersedia, simpan backup, dan gunakan opsi
  pemulihan yang sesuai dengan komponen dan host.
- Integrasi bergantung pada izin provider dan workspace. Konfigurasi milik
  pengguna, data sumber, dan profil harian tetap tunduk pada batas ownership.
  Ukuran token dan durasi teramati per sesi. Satu pasangan evaluasi tidak
  menetapkan penghematan umum atau keunggulan pada host lain.

## Dasar keputusan dan gerbang

Snapshot yang diberikan Owner mencatat **355 dari 363 Done** serta delapan
gerbang terbuka (AFYX-77, AFYX-83, AFYX-84, AFYX-85, AFYX-86, AFYX-9, AFYX-87,
AFYX-11). Snapshot itu mencatat AFYX-346, AFYX-8, dan AFYX-359 Done berdasarkan
keputusan Owner. Status Jira tersebut belum dibaca ulang lewat konektor.
Bukti teknis OFF/ON sebelumnya menunjukkan satu panggilan Graph di sesi ON,
dengan batas pada atribusi jawaban, persetujuan MCP, dan review independen.
Keputusan distribusi tanpa notice historis dicatat di
[rencana independensi](AFYX_INDEPENDENCE_PLAN.md#status-teknis-afyx-359).
Manifest 514 berkas adalah cakupan validasi teknis. Komparator historis tetap
terbatas dan cakupan hash tidak menentukan kepemilikan hak cipta secara hukum.

## Verifikasi artefak

1. Cocokkan commit checkout bersih dengan SHA remote yang disetujui.
2. Bangun paket Kit dan Graph dengan skrip repositori. Cocokkan penanda
   sumber Kit dan metadata bundel dengan commit tersebut.
3. Hitung ulang SHA-256 setiap file dan bandingkan dengan `SHA256SUMS` dan
   `RELEASE-MANIFEST.json`. Periksa target, versi, identitas sumber, isi
   tarball, payload lisensi AFYX, dan absennya notice historis.
4. Untuk executable installer Windows yang akan didistribusikan, gunakan
   sertifikat tepercaya di bawah kendali Owner. Verifikasi dengan
   `Get-AuthenticodeSignature` dan `signtool verify /pa /v`. Setelah
   penandatanganan, terbitkan checksum atas byte yang sudah ditandatangani
   melalui proses rilis yang disetujui.

Publikasi tetap diblokir sampai pemeriksaan lintas platform pada SHA kandidat,
penandatanganan tepercaya, dan gerbang akhir AFYX-87 serta AFYX-11 terpenuhi.

## Riwayat Technical Alpha

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
| **G9: Native Ownership & Legal Clearance** | Governance (AFYX-320) | **PASS** | Full production inventory (381 files) classified & hash-verified; native effects refactored; zero prohibited patterns; owner authorized. |
| **G10: Programmatic TUI Layout** | UI & Terminal | **PASS** | 48/48 unit tests pass (`test_terminal_tui.py`); wide (80-col) and narrow (40-col) layouts, NO_COLOR fallback. |
| **G11: Human Windows Terminal Visual** | UI & Terminal | **NOT TESTED** | Automated CLI agent execution only; live interactive human visual inspection gate remains unexecuted. |
| **G12: Authenticode Code Signing** | Distribution Security | **BLOCKED** | Binary is unsigned (`UNSIGNED_ALPHA_CANDIDATE`); official code-signing certificate is not provisioned. |
| **G13: Cross-Platform Parity** | Platform Support | **BLOCKED** | macOS/Linux packaging and full adapter parity are deferred; Technical Alpha scope is Windows-first. |
| **G14: Public CDN & Release Publishing** | Release Automation | **BLOCKED** | External spending limits / account restrictions active; release publishing gate remains closed. |
| **G15: MSI / AppX Native Installer** | Packaging | **NOT APPLICABLE** | Standalone bootstrapper (`AfyxSetup.exe`) is the approved Technical Alpha packaging target. |

---

## 2. Detailed Gate Analysis & Known Blockers

### Gate G9: Native Ownership and Legal Clearance (`PASS`)
- **Verified Deliverables (AFYX-320, AFYX-165, AFYX-157, AFYX-163, AFYX-166, AFYX-167):**
  - Comprehensive source provenance inventory covering 381 production engine and UI source files in `scripts/native-source-ownership.json`.
  - Dynamic verification guard in `scripts/verify-native-source-ownership.mjs` verifying SHA-256 integrity, zero unclassified files, zero duplicate paths, and fail-closed substantive pattern checks.
  - Substantive remediation of `effects.ts`: replaced with clean AFYX native tokenization architecture, bounded memory allocations, and explicit set lookups; verified by 14/14 unit tests and negative gate tests.
  - Automated identity string/token sanitization (`scripts/audit-legacy-identity.py` PASS with zero unclassified legacy tokens).
  - Clean third-party carve-out and single-license AFYX model explicitly authorized by project owner for local and dev distribution.
- **Vindication & Clearance:**
  - Technical copyright independence and operational release compliance verified. Gate G9 is cleared for internal evaluation, developer dogfooding, and Git delivery to `dev`.

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

**Verdict:** **TECHNICAL ALPHA INTERNAL EVALUATION PASS (DISTRIBUTION GATED)**

The Windows Alpha source and artifact lifecycle is hermetic, idempotent, and fully verified for internal developer dogfooding and technical evaluation. General public distribution remains gated pending Authenticode code-signing (G12) and interactive human visual acceptance (G11). Gate G9 (Native Ownership & Legal Clearance) is fully cleared.
