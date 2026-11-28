# AFYX Engineering Kit — Catatan rilis dan verifikasi

## Kandidat v1.2.1

Kit dan Graph memakai versi `1.2.1`. Penerimaan distribusi memerlukan
kecocokan commit sumber, CI, tag, serta checksum tarball yang sama pada
GitHub Release dan npm. Verifikasi status publik melalui tag dan registry.
[Changelog](../CHANGELOG.md)

Cakupan rilis adalah tarball Kit dengan bundel Graph, launcher, dan skrip
lifecycle. Build dan attestation bundel Graph diverifikasi terpisah dari
Authenticode untuk executable Windows mandiri. Waiver AFYX-85 di bawah
berlaku untuk kandidat historis yang disebutkan di keputusan Owner.

## Rilis v1.1.0

Kit dan Graph menggunakan versi Stable `1.1.0` (berlanjut dari baseline `v1.0.2` pada
`bcfeae9` / `977b7af`). Cocokkan SHA pada manifest distribusi dengan sumber artefak yang diperiksa.

Untuk kandidat historis `AfyxSetup.exe`, Owner mengizinkan distribusi tanpa tanda tangan berdasarkan
`OWNER_SIGNING_WAIVER_V1` (AFYX-85, komentar 11458, rujukan Owner).
Status Authenticode yang diharapkan adalah `NotSigned`. Windows dapat
menampilkan peringatan SmartScreen. Verifikasi sumber, SHA-256, dan
manifest sebelum menjalankan paket. Attestation build memiliki cakupan
provenance yang terpisah dari Authenticode.

Rilis **`v1.0.2`** adalah distribusi **100% AFYX-native** (`Copyright (c) 2026 Afyx` pada
`LICENSE`) dengan nol atribusi pihak ketiga, nol berkas notice pihak ketiga, dan
nol dependensi runtime eksternal (`dependencies: {}`). Topologi riwayat Git
menyatukan dua akar (`eaa4096` dan `9adf427`) pada `1753aa76` secara bersih tanpa
mengubah riwayat terpublikasi. Dasar verifikasi provenance tercatat dalam
[rencana independensi](AFYX_INDEPENDENCE_PLAN.md#status-teknis-afyx-359).

## Cakupan rilis

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

Snapshot Owner untuk promosi mencatat **361 dari 363 Done**, dengan
AFYX-87 dan AFYX-11 masih terbuka. Snapshot itu mencatat AFYX-346, AFYX-8, dan AFYX-359 Done berdasarkan
keputusan Owner. Status Jira tersebut belum dibaca ulang lewat konektor.
Bukti teknis OFF/ON sebelumnya menunjukkan satu panggilan Graph di sesi ON,
dengan batas pada atribusi jawaban, persetujuan MCP, dan review independen.
Bukti atribusi sumber dan retensi notice tercatat di
[rencana independensi](AFYX_INDEPENDENCE_PLAN.md#status-teknis-afyx-359).
Manifest produksi menetapkan cakupan validasi teknis. Komparator historis tetap
terbatas dan cakupan hash tidak menentukan kepemilikan hak cipta secara hukum.

## Verifikasi artefak

1. Cocokkan commit checkout bersih dengan SHA remote yang disetujui.
2. Bangun paket Kit dan Graph dengan skrip repositori. Cocokkan penanda
   sumber Kit dan metadata bundel dengan commit tersebut.
3. Hitung ulang SHA-256 setiap file dan bandingkan dengan `SHA256SUMS` dan
   `RELEASE-MANIFEST.json`. Periksa target, versi, identitas sumber, isi
   tarball, payload lisensi AFYX, dan notice MIT upstream yang diverifikasi.
4. Untuk executable installer Windows yang akan didistribusikan, gunakan
   sertifikat tepercaya di bawah kendali Owner. Verifikasi dengan
   `Get-AuthenticodeSignature` dan `signtool verify /pa /v`. Setelah
   penandatanganan, terbitkan checksum atas byte yang sudah ditandatangani
   melalui proses rilis yang disetujui.

Penerimaan AFYX-87 memerlukan parity sumber, CI, tag, checksum, waiver
dan publikasi yang terverifikasi. AFYX-11 menunggu penerimaan AFYX-87
dan ketersediaan distribusi publik.

## Riwayat Git dan kanal

Akar `eaa4096` dan `9adf427` digabung pada `1753aa76`. Tag
`v0.1.0-alpha.*` dan paket npm Alpha yang telah terbit tetap menjadi
riwayat publik yang tidak diubah. Tag Git Alpha yang masih tercantum di
remote adalah `v0.1.0-alpha.2`, `v0.1.0-alpha.6`, `v0.1.0-alpha.7`, dan
`v0.1.0-alpha.8`. Commit tag tersebut tidak terjangkau dari baseline
Stable `35b89bd`. Pilot eksternal macOS masih terbuka.

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

---

## Penilaian Kesiapan Rilis V1.3.0 (Audit B9)

**Tanggal:** 2026-11-28 | **Branch:** `dev` | **Baseline Sebelum Perbaikan B9:** `cf67834207eb86a9cb4dc723c9ca21dc78aed02f` | **Versi Paket:** `1.2.1` (belum dinaikkan ke `1.3.0`)

### 1. Ringkasan Audit Terstruktur & Perbaikan Material (R1–R2)
- **Tingkat Independensi Audit:** `LIMITED_STRUCTURED_INTERNAL_AUDIT` (audit terstruktur internal tanpa sesi model eksternal terpisah di luar anggaran B7).
- **Temuan Material yang Diperbaiki (`CONFIRMED_DEFECT`):**
  1. **Planner B7 (`evals/harness/run.py`):** Perbaikan `build_campaign_a_plan` agar skenario `b7-targeted` mempertahankan seluruh `10` sel (`5` pasangan cocok `N/F`, `S/G`, `S/A`, `S/R`, `N/S`) saat `configs=None`, alih-alih membuang konfigurasi `A` dan `R`.
  2. **Isolasi Kapabilitas A/R (`scripts/afyx-universal-runtime.mjs`, `scripts/afyx-capability-orchestrator.mjs`):** Penegakan `AFYX_FORGE_OPT_IN=0` dan `AFYX_GRAPH_OPT_IN=0` setara dengan `AFYX_CONTEXT_OPT_IN=0` agar konfigurasi `A` (ACE saja) dan `R` (Forge saja) terisolasi secara nyata pada runtime terpadu.
- **Observasi Reliabilitas Historis:** `afyx-graph/engine/__tests__/mcp-staleness-banner.test.ts` lulus (`7/7` tests dalam `5.65s`); `PROVIDER_BACKUP_PERMISSION_UNVERIFIED` dan guard kepemilikan (`UNVERIFIED:USER`, `SCOPE_UNSUPPORTED`, `CODEX_UNAVAILABLE`) terkonfirmasi sebagai proteksi *fail-closed* yang bekerja sesuai desain; kegagalan sandbox Windows `0xc0000142` diisolasi melalui fallback WSL2 Ubuntu.

### 2. Status Benchmark & Anggaran B7 (R3)
- **Campaign A:** `27/27` terpakai (`0` tersisa) — ledger `evals/results/campaign-a-budget.json` terjaga utuh.
- **B7 Targeted Confirmation:** `2/16` terpakai (`b7-budget.json` `1/16`, `b7-budget-r3.json` `1/15`), **`14` otorisasi tersisa**, `0` pemanggilan model baru selama B8 dan B9. Status eksekusi live tetap **`DEFERRED_PROVIDER_QUOTA`** menunggu pemulihan kuota provider.
- **Syarat Masuk Minimum B7:** `planner_ten_cells_verified=PASS`, `actual_capability_isolation=PASS`, `static_evaluation_validation=PASS`.

### 3. Rekomendasi Keputusan Rilis Final
- **Rekomendasi Utama:** **`CONDITIONAL_GO`** (bukan otorisasi publikasi `v1.3.0`).
- **Gerbang Eksternal / Keputusan Owner yang Masih Tertunda:**
  1. Pemulihan kuota provider & eksekusi live **B7** (`14` pemanggilan tersisa) untuk bukti komparatif akhir dan penerimaan **Expert D.6** berbasis model.
  2. Pilot/penerimaan host eksternal terpasang (**Claude Code** pada host terpasang nyata, **Antigravity** sesi model terautentikasi, dan **macOS** host eksternal terpasang).
  3. Keputusan **Owner** untuk: penandatanganan executable Windows (atau cakupan waiver `OWNER_SIGNING_WAIVER_V1` untuk `v1.3.0`), kenaikan versi ke `1.3.0`, promosi `git merge --ff-only dev` ke `main`, pembuatan tag, publikasi npm/GitHub Release, dan penutupan `AFYX-375`.


## Register penutupan FINAL-01R

Basis produk awal `f684bfe7f49eb9c6731cb4405a0f0c093fe54a35`. Baseline `main` yang dilindungi `56f046638570a86b5228efd01bfdba20d392c845`. Versi publik tetap 1.2.1. Kontrol perubahan merujuk ke [checkpoint FINAL-01 #11513](https://afifbendol.atlassian.net/browse/AFYX-375?focusedCommentId=11513). Catatan ini mencakup bukti yang dapat diverifikasi dari checkout kanonik dan batas yang masih memerlukan penerimaan.

| Tahap | Prasyarat dan identitas | Bukti yang digunakan atau dihasilkan | Hasil dan keputusan |
| --- | --- | --- | --- |
| S0 | Git kanonik, CI, ledger, artefak FINAL-01, host dan reviewer | Ref remote cocok. Enam workflow dan 21 job sukses pada `f684bfe`. MB12 attempt 2 mencakup `140874179237` di macOS Intel. AFYX-375 berstatus In Progress. | Rekonsiliasi CI selesai. Arsip historis ARTIFACT_UNAVAILABLE. Pengganti CI diperiksa dan lulus uji instalasi terfokus. Kuota aktual, host dan reviewer masih menunggu bukti. |
| S1 | Plan B7, identitas lingkungan, oracle, isolasi dan korelasi | Sepuluh sel dan lima pasangan benar. Metadata hasil memakai lingkungan terpilih. Tes resume memeriksa sumber, reservasi, kampanye, sel, revisi dan hash bukti. Validator statis harness dan Forge lulus. | PARTIAL. Lingkungan historis dipertahankan. Lingkungan FINAL-01R mencatat subjek produk yang cocok, versi skill dan fingerprint fixture. Bukti runtime terpilih, isolasi protokol, atribusi dan migrasi anggaran masih terbuka. |
| S2 | S1 lulus dan runtime Codex terotorisasi | Ubuntu WSL2 dan `bwrap` terdeteksi. `codex` tidak ditemukan pada PATH sesi Ubuntu yang diperiksa. Status kuota terakhir di checkpoint bersifat historis. | NOT RUN. 0/5 pasangan. 2/16 terpakai, 14 tersisa, 0 pemanggilan baru. |
| S3 | Reviewer D.6, host provider dan host macOS | D.5 tercatat 5/5 sebagai masukan. Bukti Claude hermetik terdahulu 22/22. macOS ARM64 dan Intel CI lulus pada baseline. | D.6 PENDING_EXTERNAL_REVIEW. Claude dan macOS eksternal BLOCKED_EXTERNAL_HOST. Antigravity masih memerlukan discovery, pemanggilan dan autentikasi host. |
| S4 | Hanya masalah material yang dikonfirmasi | Koreksi terbatas pada harness, oracle ACE dan Forge, metadata lingkungan, serta dokumentasi. Hasil task dipisahkan dari keberhasilan kapabilitas dan konfigurasi dari observasi. | Perilaku produk dan kontrak instalasi tidak diubah. Penerimaan harness tetap terbuka mengikuti S1. |
| S5 | Penerimaan eksternal, kandidat yang terverifikasi dan keputusan distribusi | Arsip CI alternatif berasal dari build exact-commit. Checksum, inventaris dan penerimaan terfokus diverifikasi terpisah. | NO_GO untuk publikasi. Arsip staging tersedia. Freeze rilis menunggu gerbang penerimaan. |

### Bukti kandidat dan CI

- Arsip FINAL-01 yang tercatat adalah `afyx-engineering-kit-1.2.1.tgz`, 259 berkas, SHA-256 `7d44361ba0d722ac3b028795fb006ce7277bf81c3eff37c61d5008fa6507c1f2`. Arsip ini berstatus ARTIFACT_UNAVAILABLE setelah pencarian di lokasi staging, testing, benchmark, administrasi dan temporary. Bukti instalasi historis tetap terkait dengan checksum tersebut.
- Artefak `installer-npm-candidate` GitHub Actions pada `f684bfe` berisi tarball dengan SHA-256 `bf11039b1ecc84a67b49832a40d4d1b326494e61e2b66fa0697f293ed41798a0`. Checksum tersebut dan SHA-512 cocok dengan log job build `140845055878`. Marker revisi dan manifest Graph cocok dengan SHA sumber. Inventaris 259 berkas mencakup lisensi dan empat bundle Graph dengan checksum yang cocok. Uji npx minimal/custom 2/2 dan instalasi Windows full, verify, uninstall 3/3 lulus pada profil sementara. Konfigurasi Codex yang tidak terkait tetap identik. Arsip serta bukti terfokus tersimpan di `testing/integration/AFYX-375-final01r-ci-f684bfe` pada workspace induk. [Artefak CI](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/46101600765/artifacts/15246295093)
- Probe MCP langsung pada kandidat Windows mengonfirmasi inisialisasi, daftar tool dan discovery Forge. Launcher lama menghasilkan `UNAUTHORIZED_OR_UNVERIFIED`. Launcher host dengan otorisasi cakupan Forge menghasilkan `AVAILABLE`. Flag OFF menghasilkan `EXPLICITLY_DISABLED`. Harness memberi launcher B7 otorisasi sesuai matriks. A mengizinkan Context, R mengizinkan Forge, dan F mengizinkan ketiga kapabilitas. Probe deterministik mengeksekusi Forge pada R dan F. Probe deterministik A mengeksekusi Context dengan Graph dan Forge berstatus EXPLICITLY_DISABLED. F mengonfirmasi Context dan Forge tersedia. Graph pada probe F memerlukan indeks fixture yang siap. Isolasi sesi Codex WSL2 untuk seluruh matriks tetap terbuka. Probe ini tidak menjalankan sesi provider.
- Bukti `f684bfe` mencakup [CI](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/46101600867), [Graph](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/46101600821), [MB12](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/46101600868), [installer native](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/46101600765), [installer Windows](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/46101600818) dan [tool routing](https://github.com/a5zero7/afyx-engineering-kit/actions/runs/46101600823). Rerun macOS Intel sudah selesai pada attempt 2. Tidak ada rerun baru.

### Register gerbang dan tindakan minimum

| ID | Kontrak dan bukti saat ini | Tindakan minimum, penanggung jawab dan dampak |
| --- | --- | --- |
| S1-IDENTITAS | Lingkungan B7 historis tetap menunjuk `36624d614c303205b77e3a39b639341c3fb0bfbb`. `environment-v1.3.0-b7-final01r.json` memisahkan target produk `f684bfe` dari revisi harness yang dicatat saat eksekusi. | Pelaksana B7 mengikat fingerprint target ke runtime, artefak dan konfigurasi yang benar-benar diamati sebelum eksekusi live. Memblokir S1 dan B7. |
| S1-ORACLE | Baseline rusak gagal dan referensi positif lulus pada empat fixture coding. Oracle ACE kini menolak keluaran tanpa teks diagnostik utuh. Oracle Forge B7 kini memeriksa cakupan modul, urutan verifikasi antarmuka dan regresi, respons terhadap kegagalan, dan batas tindakan produksi. Rencana yang membalik urutan, salah cakupan atau mengizinkan mutasi produksi ditolak. | Pertahankan batas oracle Forge pada keputusan terstruktur yang diuji. Bukti kualitas perencanaan aktual, akurasi struktural Graph dan biaya ACE memerlukan observasi terpisah dari kelulusan task. |
| S1-ISOLASI | Bukti OFF terpasang berasal dari FINAL-01. Plan statis tidak membuktikan ketersediaan setiap kapabilitas lewat protokol. | Pelaksana menguji N/S/G/A/R/F pada kandidat dan runtime terpilih melalui CLI/MCP yang didukung. Catat skill aktual pada Odoo N/S. Memblokir S1. |
| S1-ANGGARAN | B7 memiliki dua ledger dengan masing-masing satu reservasi. Campaign A tercatat 27/27 di checkpoint. Ledger aktif dan arsip MXC yang ditemukan menjelaskan 25 + 1 reservasi. | Pertahankan batas konservatif 0 sisa Campaign A. Pemilik bukti merekonsiliasi satu reservasi historis yang belum terlacak. Pelaksana B7 harus menautkan 2 reservasi sebelumnya ke kelanjutan maksimum 14. |
| S2-B7 | Lima pasangan tersedia dan belum dieksekusi. | Setelah S1 lulus, operator menyediakan runtime dan konfirmasi kuota melalui informasi non-model. Jalankan pasangan berimbang dalam sisa otorisasi. Memblokir penerimaan komparatif. |
| S3-D6 | [Kontrak reviewer T06.R0](AFYX_T06_R0_EVALUATOR_READINESS.md). D.5 `384826dee91d45f0a3388d5d276407ae` 5/5 tercatat. | Pemilik menunjuk reviewer independen dengan prinsipal terpisah, salinan bukti reviewer yang terisolasi, dan otorisasi biaya tersendiri jika diperlukan. Reviewer menguji kontrol pemisahan dan menilai pilihan spesialis, akurasi, referensi, komposisi Odoo, keamanan dan overhead sebelum memilih KEEP, REVISE atau REJECT. Memblokir D.6. |
| S3-PROVIDER | Penerimaan konfigurasi dan siklus hidup yang terdahulu berlaku pada batasnya. | Operator host menjalankan discovery, inisialisasi, pemanggilan dan siklus hidup. Antigravity memerlukan sesi terautentikasi yang berwenang. Pilot macOS memerlukan host nyata. Memblokir penerimaan host. |
| S5-DISTRIBUSI | Waiver historis AFYX-85 berlingkup versi terdahulu. Sertifikat dan cakupan V1.3.0 belum disahkan. | Pemilik memilih penandatanganan, waiver terbatas, atau penundaan artefak Windows yang terdampak. Inventaris tarball dan empat bundle Graph tidak memuat executable atau pustaka native dengan ekstensi EXE, DLL, NODE, SO atau DYLIB. Pertimbangkan cakupan npm dan penundaan EXE standalone setelah persetujuan pemilik. Memblokir publikasi yang terdampak. |
| S5-T12 | [Roadmap master](AFYX_V1_MASTER_ROADMAP.md) dan [kontrak integrasi Alpha](AFYX_ALPHA_INTEGRATION_ROADMAP.md) mengharuskan bukti kandidat Unified Kit final dan gerbang yang berlaku. | Evaluator menjalankan T12 pada artefak versi final yang persis, setelah persetujuan cakupan distribusi dan seluruh prasyarat komponen. Publikasi menunggu penerimaan formal. |

### Matriks kompatibilitas dan penerimaan produk

| Batas | Bukti tersedia | Verifikasi yang masih diperlukan |
| --- | --- | --- |
| Codex / Windows dan WSL2 | Bukti konfigurasi, lifecycle dan instalasi terdahulu. | B7 live, kuota terkini dan verifikasi protokol pada runtime evaluasi yang dipilih. |
| Claude Code | 22/22 tes hermetik adapter/readiness pada B8. | Host terpasang, discovery skill/MCP, inisialisasi, invocation deterministik, roots, OFF, error, uninstall dan preservasi konfigurasi. |
| Antigravity | Konfigurasi dan lifecycle terdahulu. | Discovery dan pemanggilan host aktual serta sesi terautentikasi dengan otorisasi yang sesuai. |
| macOS ARM64 / Intel | CI native pada kedua arsitektur, termasuk build dan installer. | Pilot instalasi eksternal, MCP, update atau repair, uninstall dan preservasi konfigurasi. |
| Graph | Bukti CLI/MCP, freshness dan structural intelligence pada cakupan yang diterima. | Akurasi struktural dan atribusi manfaat B7. |
| ACE | Bukti pengurangan, pemulihan tepat, integritas, privasi dan pemisahan state pada cakupan yang diterima. | Biaya transfer dan retrieval aktual, serta pemeriksaan diagnostik lengkap B7. |
| Forge | Track A dan batas perencanaan asisif A8 mengikuti persetujuan terdahulu. | Kualitas substantif B7. Waiver matriks formal historis berlaku sesuai cakupan tercatat. |
| Efficient Coding dan Odoo Engineering | Bukti lifecycle skill, panduan dan kecocokan versi terdahulu. | Bukti penggunaan skill dan perbandingan B7 pada fixture Odoo sintetis. |
| Engineering Expert | Bukti D.5 dan kontrak pemilihan referensi terdahulu. | D.6 independen. |
| Runtime bersama dan Usage Intelligence | Bukti integrasi opsional, OFF dan observabilitas terbatas. | Cocokkan observasi hidup dengan hasil provider. Penggunaan yang tidak teramati tetap kosong. |
| Installer | Bukti siklus hidup FINAL-01 terkait checksum kandidat yang tercatat. | Artefak CI alternatif lulus verifikasi identitas dan uji lifecycle terfokus. Penerimaan host masih terbuka. |

Phase 8 representatif dan Phase 9 memakai bukti yang sudah diterima dalam cakupan asal. Phase 10 dan Phase 11, serta T12 formal, tetap mengikuti kontrak kandidat final. Lima gerbang wajib lokal lulus. Bukti CI baseline tidak dipindahkan ke revisi harness baru secara otomatis.

### Serah terima FINAL-02

Status saat ini NO_GO. Selesaikan gerbang B7, D.6, provider dan kandidat yang terbuka sebelum meminta otorisasi rilis. Setelah otorisasi terpisah, naikkan versi ke 1.3.0 dan susun changelog. Bangun distribusi dari SHA bersih, terapkan keputusan penandatanganan, selesaikan T12 dan gerbang Phase 9–11 yang berlaku, lalu konfirmasi CI pada SHA final. Promosi `dev` ke `main` dilakukan fast-forward sebelum tag dan publikasi. Verifikasi checksum serta instalasi publik sebelum penutupan AFYX-375 yang diotorisasi pemilik.

### Pembaruan Eksekusi FINAL-01R-RESUME (2026-11-28)

- **R1 Pemulihan Runtime Codex WSL2 (`PASS`):** `codex-cli 0.167.0` dipulihkan secara terisolasi di `~/.cache/afyx-eval-codex-0.167.0/node_modules/.bin/codex` (Node.js `v24.22.2`, WSL2 Ubuntu, `bubblewrap 0.11.1`, `codex login status`: `Logged in using ChatGPT`) tanpa menyentuh profil harian.
- **R2 Penutupan Entry Gate B7 (`PASS`):** `evals/harness/run.py --mode campaign-a --environment environment-v1.3.0-b7-final01r.json --preflight-only` lulus (`PREFLIGHT_EXIT=0`); matriks isolasi `N/S/G/A/R/F` terverifikasi pada WSL2 (`N/S` `MCP_ARGS=2`, `G/A/R` `MCP_ARGS=4`, `F` `MCP_ARGS=6` dengan flag `AFYX_*_OPT_IN` terisolasi); Campaign A `27/27` terjaga (`25` di `campaign-a-budget.json` + `1` arsip MXC + `1_RESERVATION_UNTRACED`, sisa `0`).
- **R3 Eksekusi B7 (`DEFERRED_PROVIDER_QUOTA`):** Eksekusi B7 di WSL2 (`--budget 14 --ledger-path evals/results/b7-budget-final01r.json`) berhenti langsung pada kontrol `child_health-1-c71c86a6` akibat kuota provider habis (`You've hit your usage limit... try again at 11:32 PM`, `B7_RUN_EXIT=2`). Konsumsi kumulatif B7 menjadi **`3/16`** (`2` historis + `1` kontrol health ini), **`13` otorisasi tersisa**, `0/5` pasangan selesai.
- **R4 Penerimaan Independen & Eksternal:** `D6_STATUS = PENDING_EXTERNAL_REVIEW` (memerlukan prinsipal evaluator terpisah sesuai `AFYX_T06_R0_EVALUATOR_READINESS.md` dan tinjauan atas D.5 `384826dee91d45f0a3388d5d276407ae`; `T07 A1/B1` menyusul setelah `D.6`); `Claude Code` & `macOS` host eksternal berstatus `BLOCKED_EXTERNAL_HOST`; `Antigravity` sesi terautentikasi tetap `PENDING_EXTERNAL_REVIEW`.
- **R5 Rekomendasi Distribusi & Keputusan:** Kandidat tervalidasi `testing/integration/AFYX-375-final01r-ci-f684bfe/afyx-engineering-kit-1.2.1.tgz` (`sha256: bf11039b1ecc84a67b49832a40d4d1b326494e61e2b66fa0697f293ed41798a0`, `259` berkas) tetap dibekukan. Rekomendasi cakupan distribusi untuk persetujuan Owner: `NPM_DISTRIBUTION` + `DEFER_STANDALONE_WINDOWS_EXE` (tidak ada `EXE/DLL/NODE/SO/DYLIB` dalam tarball maupun 4 bundle Graph). Keputusan rilis saat ini tetap **`NO_GO`** untuk publikasi langsung hingga kuota B7 (`13` sisa), `D.6`, host eksternal, dan keputusan Owner untuk `FINAL-02` terpenuhi.

### Penutupan Tata Kelola Final V1.3.0 (FINAL-ACCEPTANCE-AND-GOVERNANCE)

- **Keputusan Distribusi Resmi Owner (Item #22–#23):**
  - `distribution_scope`: **`NPM_DISTRIBUTION`** (disetujui; tarball `afyx-engineering-kit-1.2.1.tgz` dan empat bundle Graph terverifikasi memuat `0` berkas `.exe`, `.dll`, `.node`, `.so`, maupun `.dylib`).
  - `standalone_windows_exe`: **`DEFER_STANDALONE_WINDOWS_EXE`** (saluran distribusi ditunda tanpa menghapus kode sumber maupun CI installer Windows).
  - `unsigned_exe_publication`: **`NOT_AUTHORIZED`**; `historical_signing_waiver_extension`: **`NOT_AUTHORIZED`**.
- **Status S0–S3 pada `ea6e07c`:**
  - `S0`: CI `ea6e07c` (`46122746851`) lulus `3/3 jobs SUCCESS`; `codex-cli 0.167.0` + `bubblewrap 0.11.1` + `PREFLIGHT_EXIT=0` terverifikasi di WSL2 Ubuntu.
  - `S1 (#01–#11)`: Rencana `10` sel B7 (`#02`) & isolasi protokol MCP WSL2 pada kandidat terpasang (`#03`: `A`, `R`, `N` `EXPLICITLY_DISABLED`) terverifikasi. Fingerprint resume (`#01`) berbeda (`d9ebbad1...` vs `b00fc529...`) akibat commit dokumentasi `ea6e07c`. Kuota (`#04`) tetap `DEFERRED_PROVIDER_QUOTA` (`13` sisa otorisasi di `evals/results/b7-budget-final01r.json`, `0/5` pasangan dieksekusi).
  - `S2 (#12–#16)`: `D6 = PENDING_EXTERNAL_REVIEW`, `T07 = BLOCKED_BY_D6` (prinsipal evaluator terpisah `AFYX_T06_R0_EVALUATOR_READINESS.md` belum tersedia).
  - `S3 (#17–#21)`: `Claude Code` & `macOS` eksternal `BLOCKED_EXTERNAL_HOST`; `Antigravity` `PARTIAL` (sesi model terautentikasi `PENDING_EXTERNAL_REVIEW`).
- **Putusan Final & Batas `FINAL-02` (#24–#26):**
  - Kandidat produk `f684bfe7f49eb9c6731cb4405a0f0c093fe54a35` (`sha256: bf11039b1ecc84a67b49832a40d4d1b326494e61e2b66fa0697f293ed41798a0`) tetap dibekukan.
  - Putusan saat ini: **`NO_GO`** (gerbang wajib eksternal B7 `0/5`, `D.6`/`T07`, dan host eksternal belum tertutup; item `#26` berstatus **`AWAITING_FINAL_02_AUTHORIZATION`**). Publikasi, bump versi `1.3.0`, promosi `main`, tag, dan penutupan `AFYX-375` belum diotorisasi.

### Penutupan Teknis Offline B7 (Item #01 & #03 — 2026-11-28)

- **Item #01 (`CLOSED`):** `compute_campaign_fingerprint` di `evals/harness/run.py` diperbaiki agar mengikat `product_subject` (`f684bfe7f49eb9c6731cb4405a0f0c093fe54a35`), `harness_sha256`, `built_artifacts` (Graph, Context, Forge, Universal Runtime, Capability Orchestrator), `environment`, `manifest_sha256`, `fixtures_sha256`, `b7_fixtures_sha256`, dan `cells` rencana B7, tanpa bergantung pada `git rev-parse HEAD` yang berubah akibat commit dokumentasi. Ledger `evals/results/b7-budget-final01r.json` dimigrasikan secara teraudit ke fingerprint `22250d8c9c74143c87a4894afaf1bd9b78050bade4a82b7460625f7936bfcdfd` (menyimpan `historical_fingerprints`, `max_invocations=14`, `reserved_count=1`, sisa global **`13`**). Regresi `16/16` di `scripts/tests/test_b4_benchmark_readiness.py` lulus.
- **Item #03 (`CLOSED`):** Matriks penuh `N/S/G/A/R/F` terverifikasi di WSL2 Ubuntu pada kandidat terpasang `afyx-engineering-kit-1.2.1.tgz` (`bf11039b...`) melalui `afyx-graph serve --mcp` dan `afyx-host-bridge.mjs --authorize ...`: `S` (`EXPLICITLY_DISABLED` seluruhnya), `A` (`invoked: ["afyx-context"]`, Graph/Forge `EXPLICITLY_DISABLED`), `R` (`forge: AVAILABLE`, Graph/ACE `EXPLICITLY_DISABLED`), `G` (`afyx_graph` MCP 2 tools `isError: false`), `F` (`invoked: ["afyx-graph"]`, Graph/ACE/Forge `AVAILABLE`).
- **Kesiapan Offline B7:** `B7_OFFLINE_TECHNICAL_READINESS = PASS`, `B7_REMAINING_INVOCATIONS = 13`, `ADDITIONAL_MODEL_INVOCATIONS = 0`, `B7_LIVE_EXECUTION = WAITING_FOR_PROVIDER_QUOTA`.

### Penutupan Bukti Residu Item #03 & Status Akhir Pra-FINAL-02 (2026-11-28)

- **Bukti Residu Item #03 (`PASS` tanpa pemanggilan model):** Pada kandidat terpasang `afyx-engineering-kit-1.2.1.tgz` (`bf11039b...`) di WSL2 Ubuntu:
  - `R` (`afyx-forge` diotorisasi, `Graph/ACE` `EXPLICITLY_DISABLED`): `execStatus=EXECUTED`, `invoked=["afyx-forge"]`, menghasilkan `afyx-forge-plan/v1` v`0.1.0`.
  - `F` (`afyx-context` & `afyx-forge` pada `AFYX_GRAPH/CONTEXT/FORGE_OPT_IN=1`): `afyx-context` `execStatus=EXECUTED` (`mode="optimized"`, referensi `ace:v1:...`) dan `afyx-forge` `execStatus=EXECUTED` (`afyx-forge-plan/v1`).
- **Status Phase 2–3:** Kuota provider masih belum melewati jendela reset (`try again at 11:32 PM`) tanpa bukti pemulihan sehingga `B7_LIVE_STATUS = NOT_RUN_PROVIDER_LIMIT` (`13` otorisasi tersisa dijaga utuh, `0` pemanggilan baru). `D6 = PENDING_EXTERNAL_REVIEW`, `T07 = BLOCKED_BY_D6`, `Claude Code` & `macOS` eksternal `BLOCKED_EXTERNAL_HOST`, `Antigravity` `PENDING_AUTHENTICATION`.
- **CI `1b8fb70`:** `4/4` workflows (`CI`, `Windows Unified Installer CI`, `MB12 Native Capability Acceptance`, `Installer UX v2 native acceptance`) terkonfirmasi `completed/success`. Keputusan rilis: **`NO_GO`** hingga B7 live, D.6/T07, dan host eksternal terpenuhi.

### Penutupan Penerimaan 3-Provider & B7 (V1.3.0-PROVIDER-AND-B7-ACCEPTANCE — 2026-11-28)

- **CI `9914550`:** `CI` (`46130576821`) terkonfirmasi `completed/success` (`3/3` jobs).
- **Codex B7 & Host:** `B7_LIVE_STATUS = NOT_RUN_PROVIDER_LIMIT` (`0` pemanggilan baru, `3/16` terpakai, `13` sisa terjaga utuh). `Codex CLI` WSL2 berstatus `PARTIAL` (runtime & isolasi MCP PASS; sesi model `BLOCKED_PROVIDER_QUOTA`); `Codex VS Code Extension` (`openai.chatgpt`) berstatus `BLOCKED_PROVIDER_QUOTA` (`0` request).
- **Antigravity:** `Antigravity agy CLI` (`1.5.10`) pada workspace `$env:TEMP` terisolasi berstatus `PARTIAL` (`install`/`uninstall` PASS, autentikasi lokal terkonfirmasi `conversation_id: 9d465566-74ab-4f70-894b-7695d8d1d0f0` dengan `1` model request yang terkena `DEADLINE_EXCEEDED` pada `--print-timeout 60s`, `0` retry); `Antigravity VS Code Extension` (`google.google-antigravity`) berstatus `BLOCKED_AUTOMATION_INTERFACE` (`0` request).
- **Claude Code:** `Claude Code VS Code Extension` (`anthropic.claude-code`) berstatus `BLOCKED_AUTOMATION_INTERFACE` (`0` model request terpakai, `0` retry; CLI `claude` tidak terpasang).
- **Eksternal & Keputusan Final:** `macOS` eksternal (`NOT_AVAILABLE_LOCAL_ENVIRONMENT`), `Expert D.6` (`PENDING_EXTERNAL_REVIEW`), `T07` (`BLOCKED_BY_D6`). Cakupan distribusi terkunci `NPM_DISTRIBUTION` + `DEFER_STANDALONE_WINDOWS_EXE`. Putusan final: **`NO_GO`** (berhenti sebelum `FINAL-02`).
