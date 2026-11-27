# Benchmark methodology

This document defines the methodology for future Afyx benchmark campaigns. It is scaffolding only: smoke runs validate the harness, while comparative conclusions require a separately executed and reviewed benchmark campaign.

## Methodology

### Harness design

Scenarios are declared in `evals/manifest.json`. The agent receives only the scenario's `user_prompt`; evaluator assertions, forbidden patterns, validation commands, and allowed file scope remain evaluator-only. Each scenario/configuration/repetition cell runs in a fresh copy of its canonical fixture, and the harness verifies that the canonical fixture was not modified.

Runs produce machine-readable records under `evals/results/`. Correctness assertions and validation commands determine pass/fail before efficiency metrics are considered. Provider-reported token fields are retained as reported, derived token fields remain explicitly labeled, and unavailable observations are recorded as `null` rather than estimated. Raw artifacts are not committed.

Smoke mode uses one repetition to test isolation, fixture reset, capture, and serialization. Benchmark mode requires at least three repetitions and is the only mode intended for a comparative campaign.

### Activation semantics

The configurations `N`, `E`, `O`, `P`, `EO`, `PO`, `CORE`, `X`, and `CORE_X` control which Afyx skills are available in a run. For Campaign A screening, `evals/manifest.json` also defines the four-tier `campaign_a_matrix` (`N`: Native agent without AFYX, `S`: AFYX Skills only, `G`: Skills + Graph, `F`: Full AFYX Kit) across representative scenarios (`simple coding`, `cross-file dependency analysis`, `regression diagnosis`, `long diagnostic output`, `Odoo engineering`, and `multi-module validation planning`). The harness applies session-only `skills.config` overrides and copies only the selected frozen skills into the fresh fixture; it does not modify the user's installed skills or production configuration.

Availability is not treated as proof of activation. Each scenario explicitly declares required and forbidden skill reads. The evaluator records three independent conditions:

- every required skill read was observed;
- no forbidden skill read was observed;
- every observed Afyx skill read was available in the selected configuration.

A cell must satisfy its scenario-authored activation expectations. The full configuration skill list is not automatically required, because a skill may be available without being relevant to that scenario.

### Content-hash freezing

`evals/environment.json` records the repository commit, component versions, runtime selection, provider settings, and optional-tool availability without secrets. `evals/harness/freeze.py` computes deterministic SHA256 fingerprints from the sorted POSIX-relative file names and complete file bytes under the bundled Efficient Coding and Odoo Engineering skill directories.

Before constructing any run or making a model call, the harness recomputes those content hashes and compares the installed Prompt Master checkout SHA with the frozen value. A mismatch aborts the run. A campaign must use one frozen environment and repository revision throughout; any intentional input change starts a new fingerprint and a separate campaign rather than mixing incompatible records.

### Adaptive run strategy

Round 1 (discovery) executes exactly one repetition for every declared scenario/configuration cell. Cells are interleaved in deterministic, seed-recorded order so one configuration is not systematically favored by execution order.

Round 2 (confirmation) adds repetitions only for cells whose Round 1 result is ambiguous: either efficiency metrics are a near-tie between configurations, or a failure needs confirmation before it can trigger a skill-content change. Unambiguous cells are retained as directional evidence with `n=1` and are not re-run.

The combined total for Round 1 and Round 2 must not exceed 27 runs. The campaign log records which cells entered confirmation, the ambiguity trigger, added repetitions, exclusions, failures, and the stopping decision. Additional runs retain recorded seeds, fresh sessions, and fresh fixtures.

This adaptive policy controls evidence collection; it does not change assertions after results are observed, combine records from different frozen environments, or turn unavailable metrics into estimates.

## Results

### Campaign A: Exploratory Partial Baseline (`campA-9da5e996dfa1`)

- **Provenance & Subjek Uji:** `benchmark_subject_commit` `c48129ec16af6d70072a11d900f025bdd6d85644` dengan harness/environment revision `1bde4df8f790ac8bcdfb492d3e07d4d5903d7d7b` (melanjutkan perbaikan harness `b96a36c`, `ca02136`). Seluruh 27 otorisasi invocation asli telah terpakai (`2` kontrol Windows gagal + `2` kontrol WSL2 lulus + `20` discovery + `3` konfirmasi).
- **Lingkungan Eksekusi & Fallback WSL2:** Pada Windows 11 Build 26300, backend `windows.sandbox="mxc"` pada `codex-cli 0.167.0` gagal deterministik (`0xc0000142` saat meluncurkan biner runtime). Seluruh eksekusi live Campaign A dijalankan secara konsisten pada **WSL2 Ubuntu Linux** (`bwrap`/`landlock`, `afyx-evaluation` profile, `network.enabled=false`) yang lulus 7/7 kontrol isolasi non-model.
- **Ringkasan Observasi:** `17/17` sel yang menerima respons model lulus validasi fungsional/oracle, `14/23` lulus assertion ketat (`3` sel `smoke-odoo-001` `S/G/F` lulus fungsional namun gagal `required_skill_reads`, `6` sel akhir terkena batas kuota provider dengan `0` token), serta `0` panggilan MCP pada fixture mikro 1–3 file.

### Rencana Konfirmasi Terarah Berikutnya (B7, Belum Dieksekusi)

1. Pasangan micro-task setara (`N/S/G/F`) untuk memverifikasi pengurangan overhead aktivasi pasca-B6.
2. Repositori multi-modul skala menengah (>=20 file dengan ketergantungan lintas-file nyata) dan oracle unittest independen.
3. Beban kerja bukti struktural (analisis caller/callees/impact lintas-modul).
4. Beban kerja diagnostik/konteks berulang untuk mengukur net reduction ACE pasca-D2.
5. Tugas Odoo engineering dengan oracle kompatibilitas versi yang dapat diverifikasi.
