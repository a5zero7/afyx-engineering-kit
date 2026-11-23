# Phase 8 — Paired engineering evidence intake

## Audit integritas metrik DEV-S02

| Temuan | Lokasi | Koreksi |
|---|---|---|
| Angka token diperkirakan dari byte, kemudian diberi label penghematan token | `scripts/dogfood_engineering_comparison.mjs`, diagnostik pilot manual | Laporkan `sourceBytesRead` dan `stdoutBytes` dengan batas pengukuran masing-masing. Token dan penghematan sesi `null`. |
| Angka 350 menggantikan hasil Graph yang gagal diparse | Diagnostik pilot, `parseInventoryCount` | Count dari satu header inventaris yang valid. Kegagalan proses, header hilang atau ganda menghasilkan `null`. Count merupakan keluaran Graph, belum diperiksa terhadap oracle. |
| Akurasi 100%, jumlah panggilan dan keberhasilan selalu ditulis tetap | Diagnostik pilot dan `scripts/phase8-representative-workload.mjs`, bagian laporan | Skor akurasi pilot `null`. Runner menyatakan hasil pemeriksaan fungsional fixture dan memakai hasil indeks aktual. Jumlah panggilan agent `null`. |
| Panjang string dianggap byte, tokenizer lokal dilabeli token generik | Runner Phase 8 yang aktif di CI | Pakai panjang UTF-8 dan `localTokenizerTokens` dengan provenance tokenizer o200k_base. Durasi `performance.now` hanya mencakup operasi skrip. |
| Delta masih muncul saat kualitas gagal, dan label privat disalin ke ringkasan | `scripts/phase8-paired-evidence.mjs`, `evaluateManifest` | Gagalkan perbandingan saat correctness, tes atau security FAIL. Untuk sesi owner, tahan delta jika kualitas belum lengkap. Simpan label sebagai digest. |
| Cakupan parsial dan timing replay | Recorder, ledger dan verifier DEV-S01 | Pertahankan resi cakupan terikat trace, per-turn delta, dan `null` saat pengukuran hilang. |

Contoh sintetis. Sebelumnya output dapat mencantumkan `tokenReductionPct: 90`,
`matchesFound: 350`, dan `accuracy: "100%"` dari byte atau konstanta.
Sekarang kegagalan parsing menghasilkan `reportedDeclarationCount: null` dan
`countAvailability: "NOT_AVAILABLE"`, dengan byte stdout dan durasi proses
dilaporkan sesuai observasi. `providerTokens` dan `tokenSavings` tetap `null`.

`SYNTHETIC_ONLY` menandai jenis bukti. `FUNCTIONAL_PASS` menandai pemeriksaan
fixture yang benar-benar lulus. `OBSERVED_PARTIAL` menandai data lokal yang
masih perlu ditinjau. `HARD_GATE_FAILED` mengalahkan klaim efisiensi dan
`NOT_AVAILABLE` menandai metrik yang belum didukung. Verifier tidak menerbitkan
`INDEPENDENTLY_VERIFIED` dari resi yang hanya dideklarasikan. Ringkasan menyertakan
SHA sumber dan hash trace serta hash byte manifest saat dibaca lewat file.
Arsip laporan historis tetap tersedia dengan kontrak aslinya.

## Kontrak bukti AFYX-69

Recorder menerima metadata terstruktur. Gunakan ID buram dan SHA-256 heksadesimal
kecil. Simpan bukti asli secara privat dan berikan hash dari resi yang dapat
diperiksa operator. Jangan masukkan prompt, path pelanggan, isi perubahan,
transkrip, atau token autentikasi.

| `kind` | `actor` | `source` | Syarat tambahan selain `evidenceSha256` |
|---|---|---|---|
| `human_intervention` | `human` | `human_observation` | Resi pengamatan tindakan manusia |
| `policy_denial` | `policy` | `policy_event` | Resi keputusan kebijakan |
| `agent_fallback`, `agent_recovery` | `agent` | `agent_event` | Resi fallback atau recovery |
| `operation_attempt` | `agent` | `agent_event` | `operationSha256` dan `attemptIndex: 1` |
| `explicit_retry` | `agent` | `agent_event` | Operasi yang sama dengan indeks lanjutan dan resi tersendiri |
| `rework` | `agent` atau `human` | `artifact_revision` | `artifactSha256`, `revisionBeforeSha256`, `revisionAfterSha256` dengan rantai revisi yang konsisten |

Untuk kategori AFYX-69, total dan perbandingan memerlukan flag cakupan dan
`run.coverageReceipts[kategori] = { receiptSha256, traceSha256 }`, yang mengikat
resi cakupan ke hash trace pada run itu. Kuncinya adalah `humanEvents`,
`policyEvents`, `fallbackEvents`, `recoveryEvents`, `retryEvents`, dan
`reworkEvents`. Tanpa cakupan, `eventEvidence` hanya menunjukkan batas bawah
yang benar-benar teramati. Nol tool call juga membutuhkan resi `toolEvents`.
Intake mempertahankan trace lama dengan label aktor sebagai data tak lengkap
untuk human intervention dan rework.

Ledger Python menerima anotasi dengan `event_type`, `actor`, `timestamp`
ISO bertimezone, `evidence_ref`, `source`, dan `evidence_sha256`. Gunakan
`attempt_group_id`/`attempt_index` untuk percobaan, atau
`artifact_sha256`/`revision_before`/`revision_after` untuk revisi, dengan
nilai hash untuk operasi, artefak, dan revisi. Baris cakupan mengikat
`complete_categories` dan `receipt_sha256` ke `source_sha256` trace.
Hash label item provider yang tidak dikenal dipakai untuk membedakan tipe secara
privat. Timestamp recorder mengukur penerimaan input. Resi eksternal tetap perlu
diperiksa untuk memverifikasi aktor, cakupan, dan durasi sesi.

Status: **SOURCE PREPARATION ONLY** (2026-10-31). Jira: AFYX-8, AFYX-68, AFYX-69. No real A/B run, installed Alpha GO, Expert D.6 verdict, Forge A8 GO, or release approval is implied by this source.

## Purpose

This is a zero-provider-call, standard-library-only Node.js checker for **already collected** Afyx OFF versus Afyx ON paired engineering work. It reads bounded local evidence, checks structured event file SHA-256, reports only observed metrics and preserves unavailable data as **null/NOT_AVAILABLE**. It never edits a repository, contacts model providers, runs customer code, or writes private evidence to CI.

The existing Phase 8 representative workload/CI evaluates deterministic local fixtures and does **not** become a real human/agent comparative proof by running this checker. PR #138/#139/#140 and the installed Alpha candidate must be accepted independently before product-level conclusions.

## Freeze before either run

Independently fix and record: task specification, source Git SHA, evaluator-only oracle/rubric, permissions, environment, model and effort, approved validation commands and resource budget. Keep OFF and ON worktrees, databases, Context states and user configurations isolated. Counterbalance/randomize condition order over multiple tasks where practical. OFF uses ordinary source tools without Afyx; ON uses an identifiable installed Afyx candidate. Correctness/security/test outcomes take priority over efficiency.

The shared manifest records digest and environment claims; a separate independent reviewer must verify their physical equality and source/artifact identities.

## Private evidence schema

Keep manifest.json, off.ndjson and on.ndjson OUTSIDE Git and agent-accessible workspaces. The manifest contains:

- contract = "afyx.phase8.paired-evidence/v1"
- evidenceClass = "owner_observed" or "synthetic_fixture" (synthetic result always SYNTHETIC_ONLY)
- caseId, taskSha256, oracleSha256, permissionsSha256, environmentSha256 (64 hex characters each), sourceRevision (full 40-character Git SHA), model, effort
- runs = exactly two entries, OFF then ON, each with distinct runId, eventsFile (relative local NDJSON), eventsSha256, quality, coverage
- quality = correctness/tests/security, each PASS, FAIL or NOT_RUN, and evaluatorReceiptSha256 (64 hex or null when all three are NOT_RUN). The receipt digest is *declared*, not an independently authenticated signature.
- coverage = booleans toolEvents/humanEvents/reworkEvents/providerUsage. TRUE only when the entire category is recorded; completeness remains a claim requiring independent verification.
- timing = {capture, liveReceiptSha256}. Use capture REPLAY_OR_UNVERIFIED and null receipt for offline replay, incomplete listener, or source-unknown records. LIVE_MONITORED requires an external SHA-256 receipt from the real agent host proving both boundaries; the intake verifies only the receipt's format, **not** its authenticity. A trusted evaluator must independently validate that receipt. Only LIVE_MONITORED is eligible for a wallMs comparison.

The checker enforces 4 MiB / 20,000 event limits, SHA-256 hashes, no symlinks or path traversal, unique event IDs, one initial start and one final end, monotonic timezone-aware timestamps, and valid actor identities.

Each event row must have id, runId, at (ISO-8601 with timezone), and kind. Supported intermediate event kinds:

| Kind | Required additional fields | Meaning |
|---|---|---|
| tool_call | actor = agent | One tool invocation |
| AFYX-69 event kinds | See the typed evidence contract above | Separate intervention, denial, fallback, recovery, retry and revision lineage |
| provider_usage | source = provider_report; usageSemantics = per_turn_delta; nonnegative inputTokens, cachedInputTokens, outputTokens | Provider-reported per-turn *increments* only; cumulative session snapshots must not be summed |

Start/end timestamps define observed wall duration. Missing/partial category coverage outputs **null** and NOT_AVAILABLE; never silently infer zero. Delta = ON minus OFF; percentage only when OFF is positive. A quality/security/test FAIL blocks performance promotion regardless of costs. Actual owner-observed data is at most ELIGIBLE_FOR_INDEPENDENT_REVIEW; independentAcceptance remains NOT_VERIFIED even if both runs claim PASS. Synthetic fixtures always produce SYNTHETIC_ONLY.

No private patch, transcript, source excerpt, trace event, path, secret, holdout, prompt or raw run ID is emitted in the aggregate summary. Case/model labels may still be sensitive and must be reviewed before public/Jira publication.

## Run locally on authorized evidence only

PowerShell from canonical development repository:

    node scripts/phase8-paired-evidence.mjs --input "D:\private-evaluator\phase8\manifest.json" > "D:\private-evaluator\phase8\summary.json"

Exit 0 means valid schema, NOT acceptance (inspect verdict). Exit 1 means quality fail or missing quality evidence; exit 2 means invalid or tampered input.

Local developer-only regression: node --test scripts/tests/test_phase8_paired_evidence.mjs

GitHub CI executes **synthetic and negative contract tests only**, on Windows/Linux/macOS, without real provider calls or real-workload metrics. AFYX-8, AFYX-68 and AFYX-69 remain In Progress pending authorized paired tasks, raw event corroboration and independent review. Forge A5–A8, Expert D.6, and installed Alpha gates stay independent.


## Local session capture (non-executing host bridge)

A typed **recorder** is now provided at scripts/phase8-session-recorder.mjs. The tool has no model/provider credentials, launches no agent and runs no supplied shell commands. It consumes ONLY small structured telemetry rows from a human-authorized execution host on stdin. Host instrumentation must be started before task execution, finish after task completion, and identify events from the *actual* observed session; this recorder cannot independently prove the host emitted every event or certify correctness.

Example, from a separate private evaluator environment rather than the development worktree (the log source shown here is illustrative only):

    node scripts/phase8-session-recorder.mjs --mode OFF --run-id trial-off-001 --root "D:\private-evaluator\phase8" --workspace-root "D:\private-agent-worktree" < "D:\private-evaluator\phase8\observed-off-events.jsonl" > "D:\private-evaluator\phase8\off-descriptor.json"

Repeat independently with mode ON, a distinct run ID, isolated workspace and output on-descriptor.json. A provider/host integration may instead stream NDJSON rows to stdin in real time. Each *input* record MUST contain ONLY the supported typed fields shown above (no prompt, path, free-text output or credential). The recorder generates its own timestamp, sequence ID and run identity, then emits a hash-checked private off.ndjson/on.ndjson and a private run descriptor, with all coverage flags FALSE, all quality verdicts NOT_RUN and timing marked REPLAY_OR_UNVERIFIED. Only independently corroborated live-host receipts can change timing eligibility. It never infers provider usage or human intervention completeness. Existing traces cannot be overwritten; invalid stream events fail closed and remove incomplete capture.

**Timing caveat:** capture start/end measure the recorder input-listener interval. When input is a previously saved NDJSON file, this is merely replay time, **not agent execution wall time**. Wall time may be reported as real engineering duration only if an auditor verifies the recorder was attached for the full live agent session. Do not attribute a replay-duration measurement to the original task. The script does not guarantee security isolation by itself; the evaluator must enforce actual OS-level read/write/credential boundaries and verify the worktree is disposable and separate. Use no private customer data without authorization.

To construct the OFF/ON manifest, copy the two private descriptor run objects, attach the pre-frozen task/source/rubric/environment identity and independently verified quality receipts. Set each coverage boolean true **only** if the full corresponding host-generated event stream was observed and confirmed. Attach trace-bound coverage receipts as described above. Then invoke the paired-evidence checker. Neither the capture script nor the checker may promote a result to accepted on its own.

Developer-only regression: node --test scripts/tests/test_phase8_session_recorder.mjs. CI exercises synthetic local streams and negative confidentiality/security paths on three OS; it does NOT operate an agent or measure a real comparative workload.

## Menyiapkan sesi disposable untuk AFYX-346 dan AFYX-8

Jalankan dari checkout AFYX yang bersih. Untuk menyiapkan fixture saja, jalankan:

```text
node scripts/prepare-interactive-dogfood-session.mjs
```

Untuk memasang Graph ke direktori sementara dan memeriksa discovery MCP, gunakan arsip platform yang sudah diverifikasi beserta checksum installer yang bersebelahan:

```text
node scripts/prepare-interactive-dogfood-session.mjs --graph-archive PATH_ARSIP --model MODEL_YANG_DIOTORISASI --effort LEVEL_YANG_DIOTORISASI
```

Keluaran menunjuk ke `session.json`. Gunakan `runs.jit` untuk satu pengamatan cold JIT dan, jika berhasil, satu pengamatan warm. Gunakan `runs.off` dan `runs.on` untuk percakapan independen dengan prompt dan revisi fixture yang identik. Terapkan `env` dan `codexArgs` masing-masing pada proses baru. Biarkan approval host berlaku dan gunakan model serta effort yang sama pada kedua sesi. Opsi model dan effort mencatat konfigurasi yang diminta. Identitas efektif tetap harus diverifikasi dari bukti sesi.

Berkas `reviewer/oracle.json` memberi ground truth untuk evaluator, di luar tiga repo fixture. `reviewer/paired-readiness.json` mencatat kesiapan dan metrik kosong. Jalankan verifier Phase 8 setelah bukti operator tersedia menurut skema di atas. Helper berhenti setelah persiapan atau discovery. Status `ARCHIVE_REQUIRED` menandai Graph belum dipasang, dan `NOT_RUN` menandai penerimaan agent serta A/B belum dijalankan. Folder sementara berisi fixture sintetis dan dapat dihapus setelah bukti yang diperlukan disimpan.

### Handoff Owner di Windows

Jalankan perintah ini di PowerShell 7 dari worktree bersih yang sudah berada pada
SHA final di laporan acceptance. Gunakan arsip Graph yang telah diverifikasi
untuk SHA tersebut, dengan `SHA256SUMS` dan manifest rilis di direktori yang
sama. Tentukan satu model dan satu effort yang sudah diizinkan untuk semua sesi.

```powershell
$expectedSha = Read-Host 'SHA final dev dari laporan acceptance'
$originDev = git ls-remote --exit-code origin refs/heads/dev
if ($LASTEXITCODE -ne 0 -or ($originDev -split '\s+')[0] -ne $expectedSha -or
    (git rev-parse HEAD) -ne $expectedSha -or (git status --porcelain)) {
    throw 'Identitas dev dan worktree bersih harus cocok dengan laporan.'
}

$archive = (Resolve-Path -LiteralPath (Read-Host 'Path arsip Graph Windows terverifikasi')).Path
$model = Read-Host 'Model Codex yang diizinkan'
$effort = Read-Host 'Effort yang diizinkan'
if (-not $model -or -not $effort) { throw 'Model dan effort harus ditetapkan.' }

$prepared = node scripts/prepare-interactive-dogfood-session.mjs --graph-archive $archive --model $model --effort $effort
if ($LASTEXITCODE -ne 0) { throw 'Persiapan fixture gagal.' }
$sessionPath = ($prepared | ConvertFrom-Json).manifestPath
$session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json
if ($session.sourceRevision -ne $expectedSha -or $session.graph.status -ne 'DISCOVERED' -or
    $session.graph.sourceRevision -ne $expectedSha) {
    throw 'Identitas artefak atau discovery tidak cocok dengan SHA yang diterima.'
}
$session | Select-Object sourceRevision, fixtureSha256, graph, fixtureCold, agentAcceptance, phase8Acceptance
Get-ChildItem -LiteralPath (Join-Path $session.root 'reviewer') | Select-Object Name
```

Gunakan executable native `codex.exe` yang Anda kenal. Peluncur berikut
menerapkan konfigurasi sesi hanya pada proses anak dan memakai approval normal.
Untuk AFYX-346 jalankan `jit` sekali. Untuk AFYX-8 jalankan `off` dan `on`
masing-masing dalam proses terpisah setelah penyiapan pencatatan bukti.

```powershell
$codexExe = (Resolve-Path -LiteralPath (Read-Host 'Path executable native codex.exe')).Path
if ([IO.Path]::GetExtension($codexExe) -ne '.exe') { throw 'Pilih executable Codex native.' }

function Invoke-AfyxOwnerSession {
    param([Parameter(Mandatory)][ValidateSet('jit','off','on')][string]$Mode)
    $run = $session.runs.$Mode
    $start = [Diagnostics.ProcessStartInfo]::new($codexExe)
    $start.UseShellExecute = $false
    $start.WorkingDirectory = $run.project
    foreach ($entry in $run.env.PSObject.Properties) {
        $start.Environment[$entry.Name] = [string]$entry.Value
    }
    foreach ($argument in $run.codexArgs) { $start.ArgumentList.Add([string]$argument) }
    $start.ArgumentList.Add((Get-Content -Raw -LiteralPath $run.promptPath))
    $process = [Diagnostics.Process]::Start($start)
    try {
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "Sesi $Mode berakhir dengan kode $($process.ExitCode)." }
    } finally {
        $process.Dispose()
    }
}

Invoke-AfyxOwnerSession -Mode jit
# Saat pengambilan bukti A/B siap, jalankan masing-masing satu kali.
# Invoke-AfyxOwnerSession -Mode off
# Invoke-AfyxOwnerSession -Mode on
```

Pada AFYX-346 simpan hasil tool dan jawaban akhir yang telah disanitasi.
Catat apakah permintaan cold menghasilkan Graph, `DEFERRED`, atau kegagalan.
Gunakan `reviewer/oracle.json` untuk memeriksa jawaban. Untuk AFYX-8 catat
model, effort, persetujuan, intervensi, dan event penggunaan yang benar-benar
teramati. Simpan receipt dan bukti yang disanitasi di lokasi privat evaluator.
Setelah manifest OFF/ON disusun menurut kontrak di atas, validasi dengan:

```powershell
$pairedManifest = (Resolve-Path -LiteralPath (Read-Host 'Path manifest privat OFF/ON')).Path
node scripts/phase8-paired-evidence.mjs --input $pairedManifest
```

Serahkan SHA, receipt yang sudah disanitasi, hasil verifikasi ground truth,
dan keputusan verifikator kepada Owner untuk ditinjau pada tiket terkait.
Metrik tanpa observasi tetap `NOT_AVAILABLE`.
