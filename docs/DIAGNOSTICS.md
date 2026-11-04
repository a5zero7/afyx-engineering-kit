# Diagnostik dan validasi tanpa token

Semua alat di halaman ini bersifat lokal, deterministik, dan tidak memanggil model. Tidak ada yang memasang, memperbaiki, atau mengubah konfigurasi.

## Kontrak komponen

Satu sumber kebenaran: [`scripts/components.json`](../scripts/components.json). Installer, updater, uninstaller, verifier, dan doctor membaca kontrak yang sama melalui modul PowerShell [`scripts/lib/AfyxComponents.psm1`](../scripts/lib/AfyxComponents.psm1) dan library Bash [`scripts/lib/afyx-components.sh`](../scripts/lib/afyx-components.sh) (Bash 3.2 compatible).

| Komponen | Tier | Pemilik | Lokasi |
|---|---|---|---|
| Efficient Coding | core | afyx | `<skills-root>/efficient-coding` |
| Odoo Engineering | core | afyx | `<skills-root>/odoo-engineering` |
| Afyx Engineering Expert | optional | afyx | `<skills-root>/afyx-engineering-expert` |
| Afyx Graph | optional | afyx | `~/.afyx/graph` |
| Afyx Context Engine | optional | afyx | `~/.afyx/context` (explicit Custom/action only) |
| Codex Usage Tracking | optional | afyx | `<codex-home>/tools` (Windows) |

Status komponen selalu salah satu dari `NOT INSTALLED`, `HEALTHY`, `INCOMPLETE`,
`INVALID`, `DRIFTED`, atau `UNKNOWN`. Action yang tersedia bergantung pada state,
ownership, preset, dan mode interaktif; target asing/tidak terbukti tidak diambil
alih secara diam-diam.

ID lama `prompt-master` dan `headroom` tidak termasuk inventaris aktif, tidak
dideteksi oleh doctor/verifier, dan tidak dikelola oleh lifecycle Kit. Permintaan
eksplisit ditolak sebelum mutasi; instalasi eksternal yang sudah ada tetap utuh.

`python scripts/validate-components.py` memvalidasi kontrak secara statis (format satu pasangan `"key": "value"` per baris agar terbaca Bash, file yang dijanjikan benar-benar dikirim, dan konsistensi dengan metadata Afyx Graph).

## Afyx Doctor

```powershell
.\scripts\afyx-doctor.ps1 [-ProjectPath <dir>] [-SkillsRoot <dir>]
```

```bash
scripts/afyx-doctor.sh [--project DIR] [--skills-root DIR]
```

Laporan berisi bagian `CORE`, `OPTIONAL`, `ENVIRONMENT`, dan `PROJECT`, lalu verdict `READY`, `READY (with warnings)`, atau `NOT READY` (exit code 1 hanya bila ada `FAIL`). Komponen core yang tidak `HEALTHY` dan ketiadaan host Codex (CLI maupun ekstensi VS Code) dihitung `FAIL`; komponen opsional, Git, dan Python hanya `WARN`/`INFO`.

Doctor bersifat read-only dan tidak pernah membuka database Afyx Graph. Freshness dibaca dari bukti lokal yang murah:

| State | Arti |
|---|---|
| `MISSING` | tidak ada database pada state efektif (`.afyx-graph/` atau binding eksternal) |
| `INVALID` | database bukan berkas SQLite, atau `freshness.json` rusak |
| `FRESH` | `git_head` tercatat sama dengan HEAD, tracked tree bersih, dan index dibangun dari tree bersih |
| `STALE` | HEAD berubah, tracked file berubah, atau index dibangun dari edit yang belum di-commit |
| `UNKNOWN` | metadata index belum tercatat, atau project bukan git working tree |

Afyx Graph menulis `freshness.json` pada state efektif setelah setiap index atau sync yang berhasil, dan `afyx-graph status` (teks maupun `--json`) melaporkan state yang sama dengan aturan yang sama ([`src/freshness.ts`](../afyx-graph/engine/src/freshness.ts)):

```json
{ "schema_version": 1, "indexed_at": "2026-01-01T00:00:00.000Z", "git_head": "<sha atau null>", "tracked_clean": true }
```

`FRESH` mensyaratkan HEAD sama, tracked tree bersih sekarang, dan `tracked_clean: true` (index dibangun dari tree yang bersih). Index yang dibangun dari edit yang belum di-commit dilaporkan `STALE`, karena isinya tidak dapat dibuktikan cocok dengan commit mana pun.

## Deteksi konteks project

```powershell
.\scripts\afyx-project.ps1 [-Path <dir>] [-Format json|text] [-AllowExec] [-WriteCache]
```

```bash
scripts/afyx-project.sh [--path DIR] [--format json|text] [--allow-exec] [--write-cache]
```

Mendeteksi project root (ancestor terdekat dengan `.git`, `odoo/release.py`, atau `odoo-bin`), tipe project (`odoo`, `python`, `node`, `unknown`), versi mayor Odoo beserta buktinya, dan addon root.

Prioritas bukti versi Odoo mengikuti skill Odoo Engineering:

1. **Kuat:** `odoo/release.py`, `odoo.egg-info/PKG-INFO`, `odoo-bin --version` (hanya dengan `-AllowExec` / `--allow-exec`, karena menjalankan kode project).
2. **Lemah:** branch/tag git, versi `__manifest__.py` (`17.0.x.y.z`), berkas dependensi (`requirements.txt`, `pyproject.toml`, Dockerfile, compose).

Hasil `version_status`: `proven` (bukti kuat konsisten), `inferred` (hanya bukti lemah konsisten), `conflict` (bukti bertentangan: versi tidak ditebak, `major_version` null), `unsupported` (di luar Odoo 10-20), atau `unknown`. Bukti lemah yang berbeda dari bukti kuat dilaporkan di `conflicts`.

`.afyx/project.json` hanyalah petunjuk dan tidak pernah mengalahkan bukti source/runtime. Detektor tidak menulisnya kecuali diminta dengan `-WriteCache` / `--write-cache`.

## Validasi routing skill tanpa token

`python evals/harness/routing.py` mengevaluasi fixture di [`evals/routing/cases.json`](../evals/routing/cases.json) terhadap model kata kunci statis di [`evals/routing/router.json`](../evals/routing/router.json). Setiap kasus memakai `required`, `allowed`, dan `forbidden`, sehingga komposisi seperti Efficient Coding + Odoo Engineering atau Afyx Engineering Expert + Odoo Engineering dapat dinyatakan. Matrix Expert mencakup discovery/architecture, ordinary debugging yang tidak boleh memicu Expert, advisory ERP, security review, production reliability, AI/data, dan pertanyaan sederhana.

Pemeriksaan statis mendeteksi tabrakan deskripsi yang jelas (kemiripan kosakata), anchor routing yang hilang dari deskripsi skill, cakupan skenario, dan kontradiksi fixture. Ini adalah regression guard untuk maksud routing. Ini bukan bukti kualitas routing model saat runtime.

## Menjalankan semua tes deterministik

```bash
python scripts/validate-afyx-graph.py
python scripts/validate-components.py
python evals/harness/routing.py
python -m unittest discover -s scripts/tests -p "test_*.py" -v
```

Tes lintas-shell menjalankan PowerShell dan Bash pada fixture yang sama dan mensyaratkan hasil yang identik. Shell yang tidak tersedia dilewati, tetapi minimal satu harus berjalan.
