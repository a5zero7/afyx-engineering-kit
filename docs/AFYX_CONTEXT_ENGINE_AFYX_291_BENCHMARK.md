# AFYX-291 — Native ACE Comparative Benchmark and Acceptance

Status: **BENCHMARK EXECUTED; EXACT-HEAD CI AND OWNER REVIEW PENDING**

## Identitas dan batas

- Foundation ACE: `594452d4722d4135ef04643639c1ad16c2c5e681`
  (`@a5zero7/afyx-context` 0.1.0), yaitu exact reviewed HEAD Draft PR #84.
- Benchmark branch dibuat langsung dari foundation tersebut, bukan dari `dev`.
- Raw evidence:
  `docs/evidence/afyx-291/afyx-291-ace-comparative-594452d-20261022-r1.json`.
- SHA-256 raw evidence:
  `5d115944220f438f431462ed91b636d9dc6cbbc7407fe41171b5a880ba61eb33`.
- Benchmark tooling identity:
  `a83e9fe46d51fc522477755e943871f2464d59e33b0d32130bfff0f64c2ae3d6`.
- Evidence run identity:
  `c48f537f4e1db3870a2ad7bfad12b3ad9d7bbe4146c06343727415dd454e6731`.

Tidak ada percakapan nyata, credential, corpus IJP, indeks historis, atau data
perusahaan yang digunakan. Worktree dogfood ACE, runtime Graph, konfigurasi
Headroom, konfigurasi global, dan bukti Alpha tidak dimodifikasi.

## Metodologi

Delapan fixture sintetis deterministik mencakup repeat-heavy, mostly-unique,
campuran inventory/tool output, protected diagnostic/security/source evidence,
tight budget, short no-gain, protected passthrough, dan recovery-heavy. Setiap
fixture dijalankan tujuh kali dalam dua mode, sehingga terdapat 112 sampel:

- `cold`: proses baru, state baru, satu operasi `reduce` terukur;
- `warm`: proses dan state baru, satu warm-up tidak terukur, lalu satu operasi
  `reduce` terukur pada session yang sama.

Raw dan ACE menerima segment serta budget identik. Token dihitung menggunakan
encoding aktual `o200k_base` dari `js-tiktoken` 1.0.21 (MIT), dipin sebagai
`devDependency` dan tidak masuk paket/runtime produksi ACE. Angka ini adalah
jumlah token encoding, bukan provider-billed usage, prefix-cache saving, atau
biaya model/network.

Context accounting memisahkan:

1. raw rendered context;
2. ACE rendered context yang sudah memuat reference marker;
3. request envelope dan original content untuk setiap recovery;
4. net context setelah recovery;
5. JSON request/result serialization sebagai overhead operasional terpisah.

Lingkungan run: Windows NT `10.0.26300` x64, Node `v26.8.1`, npm `11.19.0`,
AMD Ryzen 5 8645HS, 12 logical CPU, RAM fisik 33.62 GB. Lima window CPU 250 ms
menunjukkan mean host load 10.87% sebelum dan 19.29% sesudah run; free RAM
masing-masing 17.93 GB dan 17.99 GB.

## Hasil token dan recovery

| Fixture | Cold raw → gross / net token | Cold gross / net | Warm raw → gross / net token | Warm gross / net |
|---|---:|---:|---:|---:|
| repeat-heavy | 4,375 → 1,078 / 1,078 | 75.36% / 75.36% | 4,375 → 599 / 599 | 86.31% / 86.31% |
| mostly-unique | 1,871 → 1,871 / 1,871 | 0.00% / 0.00% | 1,871 → 552 / 552 | 70.50% / 70.50% |
| mixed repository/tool | 2,159 → 1,123 / 1,123 | 47.99% / 47.99% | 2,159 → 525 / 525 | 75.68% / 75.68% |
| protected evidence | 2,162 → 1,466 / 1,466 | 32.19% / 32.19% | 2,162 → 1,222 / 1,222 | 43.48% / 43.48% |
| tight budget, one recovery | 1,548 → 718 / 1,132 | 53.62% / 26.87% | 1,548 → 717 / 1,131 | 53.68% / 26.94% |
| short no-gain | 53 → 53 / 53 | 0.00% / 0.00% | 53 → 53 / 53 | 0.00% / 0.00% |
| protected passthrough | 435 → 435 / 435 | 0.00% / 0.00% | 435 → 435 / 435 | 0.00% / 0.00% |
| recovery-heavy | 4,183 → 998 / 5,100 | 76.14% / **-21.92%** | 4,183 → 559 / 5,263 | 86.64% / **-25.82%** |

Warm mostly-unique menjadi reducible karena original sudah dimiliki session dari
warm-up. Itu bukan klaim penghematan first-use. Recovery-heavy membuktikan bahwa
semua original yang diminta kembali dapat membuat net context lebih besar dari
raw; gross reduction tidak boleh dilaporkan sebagai net saving.

Serialized request berada pada 646–21,477 byte (178–4,580 token) dan serialized
result pada 2,235–17,619 byte (966–4,864 token). Overhead tersebut bukan context
model kecuali caller memilih mengirimkannya ke model.

## Latency dan resource

Median internal `reduce` cold berada pada 7.811–18.503 ms antar-fixture; median
warm 5.705–11.705 ms. Seluruh min/median/max per fixture dan setiap sampel ada
di raw evidence. Dua-point observed process RSS pada 112 sampel berada pada
67,129,344–68,341,760 byte; observed RSS delta 163,840–1,302,528 byte.

RSS tersebut hanya maksimum dari observasi sebelum/sesudah, bukan sampled atau
instantaneous peak dan bukan alokasi incremental ACE murni. Process wall time
mencakup startup Node; tokenizer berjalan di orchestrator terpisah dan tidak
tercampur dalam metrik proses worker ACE.

## Correctness dan recovery

Semua pemeriksaan berikut PASS sebelum hasil efisiensi diterima:

- exact original recovery dan digest/reference integrity;
- protected diagnostic tetap inline;
- foreign-owner dan cross-session retrieval ditolak;
- protected-budget overflow menghasilkan byte-complete passthrough;
- fallback `originalComplete=false` memakai `originalInput` ketika input valid;
- fallback incomplete dengan original malformed gagal tertutup;
- output identity stabil pada ketujuh repetisi per fixture/mode.

Regresi foundation 22 test tetap menjadi gate terpisah, termasuk interrupted
metadata commit, corrupt-blob preflight, truncated metadata, CLI prevalidation,
ownership, dan malformed optional adapter.

## Headroom comparison

`HEADROOM_COMPARABILITY: BLOCKED`; eksekusi A/B `NOT_RUN`.

Headroom 0.37.0 terdeteksi, tetapi interface yang tersedia adalah provider proxy
dan eval atas LLM atau recorded sessions, bukan standalone transform dengan
input/output yang setara ACE. Menjalankannya secara aktual memerlukan proxy dan
upstream routing/credential, atau dummy wire protocol yang tidak setara serta
berpotensi memakai model/cache state. Provider routing aktif, private session,
lifetime saving, credential, dan global configuration sengaja tidak digunakan.
Status ini nonblocking bagi penerimaan benchmark ACE.

## Reproduksi

Gunakan output path baru karena harness menolak overwrite:

```text
cd afyx-context
npm ci
npm test
npm run build:clean
npm run test:comparative -- --samples 1 --summary
node scripts/comparative-benchmark.mjs --samples 7 --output <new-owned-output.json>
npm pack --dry-run --cache .npm-cache
```

Validator repository dijalankan dari root:

```text
python scripts/validate-components.py
python scripts/validate-engineering-assurance.py
git diff --check
```

## Acceptance

| Gate | Verdict | Evidence |
|---|---|---|
| `BENCHMARK_REPRODUCIBILITY` | PASS | Pinned source/tooling/tokenizer, fixture hashes, 112 raw samples, exact command |
| `ACE_CORRECTNESS_PRESERVATION` | PASS | Recovery, protected evidence, boundaries, fallback/passthrough checks |
| `ACE_TOKEN_MEASUREMENT` | PASS | Actual pinned `o200k_base` counts, clearly separated from provider billing |
| `ACE_RECOVERY_OVERHEAD` | PASS | Gross and net accounting, including negative net recovery-heavy result |
| `HEADROOM_COMPARABILITY` | BLOCKED | Equivalent isolated standalone transform unavailable; A/B NOT_RUN |
| `FOUNDATION_NONREGRESSION` | PASS | Foundation suite/build/package and benchmark smoke pass locally; final exact-head CI identity is recorded on the Draft PR/Jira closure evidence |

Hasil ini hanya menerima baseline sintetis yang dinyatakan. Tidak ada klaim
general savings, Headroom superiority, production integration, Alpha GO, atau
release authorization.
