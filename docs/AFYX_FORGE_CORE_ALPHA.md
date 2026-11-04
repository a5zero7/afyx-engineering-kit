# Afyx Forge Core v0.1 (Alpha) — Product Specification & User Guide

**Status:** TECHNICAL ALPHA  
**Contract Version:** `afyx-forge-plan/v1`  
**Governance State:** Formal Campaign A8 remains `EVALUATION_GATED (0/36 NOT_RUN)`  
**Runtime Mode:** `ASSISTIVE_GUIDANCE_ONLY`  

---

## 1. Ikhtisar Produk (Product Overview)

**Afyx Forge Core** adalah runtime native yang mandiri (*standalone*) dan terintegrasi dengan Afyx Code Engineering Kit, dirancang untuk merumuskan **kebijakan rekayasa perangkat lunak adaptif** (*adaptive engineering policy*) dan **panduan terstruktur yang dapat langsung ditindaklanjuti** (*actionable engineering guidance*) untuk berbagai tugas rekayasa nyata.

Forge Core menjembatani kebutuhan antara instruksi tingkat tinggi dan eksekusi konkret oleh software engineer atau agen AI (Codex, Antigravity, Claude Code), dengan mematuhi disiplin ketat **Afyx Adaptive Tool Routing** dan **Bounded Execution**.

---

## 2. Fitur Utama (Core Capabilities)

1. **Standalone Native Runtime:**
   - Dijalankan via CLI `afyx-forge` atau programmatic API Node.js ESM.
   - Ringan, tanpa dependensi eksternal berat, tanpa background daemon yang selalu berjalan.
2. **Observable Task Classification (6 Strata Forge A0–A3):**
   - Mengklasifikasikan tugas ke dalam 6 kategori standar: `KNOWN_FILE_BUG`, `UNKNOWN_DEFECT_DIAGNOSIS`, `CROSS_MODULE_CHANGE`, `SECURITY_SENSITIVE`, `DATA_RELIABILITY`, dan `NEGATIVE_SIMPLE`.
   - Mendeteksi framework otomatis (Odoo, TypeScript, Python) dan mengekstrak referensi path berkas.
3. **Adaptive Engineering Policy:**
   - Menetapkan mode eksekusi proporsional: `DIRECT_MINIMAL`, `FOCUSED_INVESTIGATION`, `STRUCTURAL_GRAPH_AWARE`, `DOMAIN_SPECIALIST`, atau `SECURITY_DEFENSE_IN_DEPTH`.
   - Menghindari pemborosan token dan biaya komputasi yang tidak perlu.
4. **Graph-Aware Routing & Context Cooperation:**
   - Merekomendasikan Afyx Graph **hanya** jika relasi modul/inheritance terbukti diperlukan.
   - Melakukan *graceful fallback* ke direct-source inspection jika Graph tidak terpasang.
   - Mempertahankan kebijakan Context Engine `DEFAULT_OFF` (hanya aktif jika user memberikan opt-in eksplisit `AFYX_CONTEXT_OPT_IN=1`).
5. **Bounded Execution & Safety Guardrails:**
   - Penolakan tegas (*fail-closed*) terhadap permintaan tidak aman seperti bypass keamanan, force-push tanpa izin, eksfiltrasi rahasia/token, dan operasi destruktif (`REFUSED_UNSAFE`).
   - Tidak melakukan eksekusi kode otonom tanpa izin (*zero unapproved autonomous mutation*).
6. **Agent Surface Integration:**
   - Terintegrasi dengan Codex, Antigravity, dan Claude Code melalui skill `skills/afyx-forge/SKILL.md`.

---

## 3. Antarmuka Baris Perintah (CLI Commands)

### 3.1. Pemeriksaan Versi
```bash
afyx-forge --version
# Output: afyx-forge 0.1.0 (Afyx Forge Core Alpha - Bounded Engineering Guidance)
```

### 3.2. Diagnostik Lingkungan (Doctor)
```bash
afyx-forge doctor
```
Memeriksa integritas surface agen (Codex, Antigravity, Claude Code), runtime pendukung (Graph, Context), skill yang terpasang, dan memastikan gerbang tata kelola A8 tetap terkunci.

### 3.3. Perumusan Rencana Rekayasa (Plan)
Dari teks langsung:
```bash
afyx-forge plan --task "Fix NullPointerException in billing calculation at src/billing.py"
```

Dari berkas deskripsi tugas dengan output Markdown:
```bash
afyx-forge plan --task-file ./task.md --format markdown --output ./plan.md
```

---

## 4. Matriks Fitur dan Batasan (Honest Feature/Limitation Matrix)

| Kemampuan | Afyx Forge Core v0.1 (Alpha) | Formal Forge Campaign (A8 Gate) |
| :--- | :--- | :--- |
| **Tujuan Utama** | Panduan rekayasa harian & kebijakan adaptif | Evaluasi benchmark komparatif 36-sel B0–B5 |
| **Model Eksekusi** | Deterministik, zero model invocation cost | Model-driven benchmark cells |
| **Status Tata Kelola** | **DELIVERED & OPERATIONAL (Alpha)** | **EVALUATION_GATED (0/36 NOT_RUN)** |
| **Eksekusi Kode Otonom** | **DILARANG (Assistive guidance only)** | Memerlukan lingkungan isolasi formal |
| **Ketergantungan Graph** | Opsional (fallback direct-source) | Opsional per kandidat |
| **Ketergantungan Context** | Default OFF (Opt-in eksplisit) | Evaluated baseline |
| **Target Pengguna** | Developer & Pair-Programming Agents | Evaluator & QA Independen |

---

## 5. Instalasi & Siklus Hidup Lintas-Platform (Platform Support Matrix)

### 5.1. Dukungan Windows Unified Kit (Alpha)
Pada sistem Windows, Afyx Forge Core terintegrasi penuh ke dalam siklus hidup terpadu Afyx Code Engineering Kit:
- **Instalasi Terpadu:**
  ```powershell
  .\install.ps1 -Preset custom -CustomComponent @('efficient-coding', 'afyx-forge')
  ```
- **Verifikasi Kesiapan Terpadu:**
  ```powershell
  .\verify.ps1 -ForgeRuntimeRoot <path>
  ```
- **Pembaruan & Perbaikan Terpadu:**
  ```powershell
  .\update.ps1 -ForgeRuntimeRoot <path>
  ```
- **Pencopotan Terarah:**
  ```powershell
  .\uninstall.ps1 -RemoveAfyxForge
  ```
- **Installer Mandiri Windows:**
  ```powershell
  .\scripts\install-afyx-forge.ps1 [-RuntimeRoot <dir>] [-Update] [-Repair] [-Uninstall] [-ValidateOnly]
  ```

### 5.2. Dukungan Unix / Linux / macOS (Standalone Support)
Pada sistem Unix/Linux/macOS, Afyx Forge Core didukung secara penuh melalui **Standalone Native Installer**:
- **Instalasi & Verifikasi Standalone:**
  ```bash
  ./scripts/install-afyx-forge.sh [--runtime-root <path>] [--update] [--repair] [--uninstall] [--validate-only]
  ```
- **Catatan Integrasi Kit Unix (Tracked Follow-up):**
  Skrip kit-level Unix (`./install.sh`, `./update.sh`, `./uninstall.sh`) saat ini mempertahankan cakupan komponen stabil (skills, Afyx Graph, Afyx Context Engine). Perluasan seleksi Forge Core ke dalam orkestrasi `install.sh` Unix dicatat sebagai item follow-up terencana pada roadmap pasca-Alpha, menjaga kontrak platform kit tetap stabil tanpa memaksakan perubahan orkestrasi Unix di luar cakupan Alpha.

Setiap metode instalasi menerapkan validasi canonical path ownership, penolakan foreign/unowned directory, *atomic swap directory* dengan pencadangan (*recovery root*), serta verifikasi kesehatan pasca-instalasi yang fail-closed.

