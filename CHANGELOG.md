# Changelog

## [Unreleased]

## [1.2.0] - 2026-11-26

### Graph dan engineering intelligence

- Memperluas resolusi GraphQL dan gRPC untuk Rust, C#/.NET, PHP, dan Ruby
  melalui pipeline native. Refleksi dan dispatch memakai bukti statis yang
  terbatas. Target dinamis atau ambigu tetap tidak terselesaikan.
- Menemukan peer dari deklarasi workspace statis dan sibling yang diizinkan.
  Indeks peer yang sudah ada harus segar dan memiliki binding kontrak sah.

### Usage Intelligence

- Koleksi baca-saja metadata lokal Claude Code dan rekaman Gemini CLI yang
  kompatibel melalui persetujuan eksplisit. Pelaporan memisahkan counter cache
  dan menahan total saat cakupan parsial. Biaya dan format Antigravity IDE yang
  belum diverifikasi tetap tidak tersedia. Penerimaan provider memakai fixture.

### Inspeksi database

- PostgreSQL dan MySQL menyediakan inspeksi opt-in dengan klien native, host
  dan role yang disetujui, TLS, transaksi baca-saja, kebijakan query terbatas,
  dan redaksi kredensial. SQLite, CSV, dan JSON tetap lokal. Pengujian koneksi
  memakai mock.

### CLI dan distribusi

- Installer memakai `node:util.parseArgs`. `afyx clean` menyediakan preview dan
  memeriksa receipt spill yang selesai dengan retensi minimum enam jam.
- Instalasi Graph dapat mewajibkan verifikasi attestation dengan identitas
  repo, workflow, SHA sumber, dan digest artefak yang sesuai.
- Paket menyertakan kebijakan keamanan dan tata tertib kontribusi.

## [1.1.0] - 2026-11-25

- **Batch 1 — Documentation hygiene, historical archives, and governance:**
  Archived completed engineering reports and added contributor verification
  and release-branch guidance.
- **Batch 2 — Cross-language GraphQL/gRPC resolver linking:** Linked GraphQL SDL
  fields to explicit resolver bindings in TypeScript, JavaScript, Python, and Go,
  and linked Protobuf RPC declarations to gRPC handlers in Go, TypeScript,
  JavaScript, Python, and Java with incremental dispatch-edge reconciliation.
- **Batch 3 — Cross-repository contract impact and massive-context Forge
  integration:** Added [cross-repository contract impact](docs/tool-guides/AFYX_CROSS_REPO_CONTRACT_IMPACT.md)
  for explicitly configured, fresh sibling indexes, with bounded Context
  evidence, producer-first Forge advisory plans, and canonical macOS path
  resolution.
- **Batch 4 — Unified Node.js installer core consolidation:** Added
  `scripts/afyx-installer-core.mjs` (pure Node.js standard library, zero external
  runtime dependencies) consolidating path normalization/containment, component
  contract & version checks, skill manifest validation, ownership/backup
  digests, receipt validation, atomic receipt persistence, and backup retention
  planning across PowerShell, Bash, and npm installers while preserving existing
  TUI, CLI flags, exit codes, security boundaries, and shell-only bootstrap
  fallbacks.
- **Compatibility, Platforms & Signing:** Targets Windows x64, Linux x64, macOS
  ARM64 (`macos-15`), and macOS Intel x64 (`macos-15-intel`) with Node.js >=
  22.5.0. Windows installer remains unsigned under `OWNER_SIGNING_WAIVER_V1`
  (`NotSigned`). Upgrade from `v1.0.x` via `npx afyx-engineering-kit@1.1.0 update`.

## [1.0.2] — 2026-11-24

- Completed the release's AFYX-native Graph and UI rewrites. The distribution
  uses Afyx copyright, ships zero third-party notice files, and has zero external
  runtime dependencies.
- Expanded security auditor coverage for embedded credentials, unsafe YAML
  loading, interpolated SQL, and configuration secrets. Graph extraction now
  reports duplicate and out-of-root symlinks in index accounting.
- Changed `--purge-backups` to remove all completed, verified AFYX backups in
  scope. Added `--prune-backups` to retain the five newest per selected skill.
  Both preserve active rollback and foreign backups.
- Published from `bcfeae9`. Follow-up baseline `977b7af` completed six
  successful `dev` workflows, including CI on Windows, Linux, and macOS.

## [1.0.1] — 2026-11-24

- Published a Stable npm patch for the Kit.
- Fixed macOS terminal installer selection for extension-only providers and
  Bash 3.2 empty-array handling. Aligned version reporting and uninstall options.

## [1.0.0] — 2026-11-24

- Published the initial Stable npm release for the AFYX Engineering Kit,
  with the shared installer, updater, verifier, and uninstaller.
