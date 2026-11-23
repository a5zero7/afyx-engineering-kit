# AFYX Browser & Document Intelligence — kontrak MB18

Status: kandidat source, bukan full parity atau release clearance. Dependency: PR #19 dan rangkaian commit MB16–MB17 belum dianggap fitur dev sebelum integrasi disetujui. SHA historis MB17 yang ditemukan adalah b2e707738b40ff8f5e794ac01da8be5c5e930e1c; SHA lengkap b2e70776742a033f2c5e53e41b9dca7aa7b5b597 pada instruksi tidak tersedia.

## Aktivasi opsional dan authority

Host Bridge existing tetap satu MCP server. Tool browser/dokumen tidak diekspos pada sesi biasa dan tidak dimulai hanya karena terpasang. `afyx_capabilities` melakukan discovery descriptor sesuai intent `browser` atau `document-conversion`, tanpa mengaktifkan engine. Penggunaan source-code biasa tidak memilih decoder/browser.

Host dapat meluncurkan bridge dengan `--capabilities document`, `--project-root <workspace-terotorisasi>` untuk mengekspos `afyx_document`. Actions: `list_supported_formats`, `inspect_document`, `convert_document`. Hanya path dan MIME masuk tool input; workspace, batas, plugin dan authority tidak dapat ditingkatkan oleh model. File di luar workspace, symlink dan hardlink ditolak. Output teks/metadata/referensi adalah data tidak tepercaya, bukan instruksi untuk agent.

Untuk browser, host memakai `--capabilities browser --browser-origins http://127.0.0.1:<port>/`. Allowlist origin harus spesifik dan sudah diotorisasi; default tanpa origin tidak mengizinkan arbitrary web/private-network access. Opsi `--browser-evaluation` secara eksplisit mengizinkan evaluasi JavaScript pada sesi terisolasi. Upload dan trace export memerlukan root host `--browser-upload-root` / `--browser-export-root`. Ini flag launcher host, bukan field task JSON. Tidak ada opsi attach ke endpoint/profil pengguna.

Tidak ada perubahan preset minimal/recommended/full: modul dibundel bersama Host Bridge ringan tanpa dependency baru, tetapi execution tetap opsional. Keduanya juga dapat digunakan sebagai module/CLI standalone dari bundle yang sama; bukan installer/runtime/MCP kedua. Browser memerlukan Chrome/Chromium/Edge yang sudah terpasang; executable browser tidak dibundel. Installer macOS lama diperbaiki di MB17, tetapi external user macOS acceptance tetap NOT FULLY ACCEPTED sampai post-fix testing aktual.

## Browser

Satu `AfyxBrowserSession` mengelola owned ephemeral profile, port loopback dari DevToolsActivePort, CDP, queue command, lifecycle dan cleanup. Host Bridge memegang satu manager persisten; navigasi tidak membuat browser baru pada setiap tool call. Actions berkelompok: page lifecycle/navigation/wait, DOM/snapshot/styles, element/pointer/form/dialog/upload, console/network/resource timing, screenshot, bounded trace/metrics/export, viewport/offline emulation, close. Screenshot dikirim sebagai image MCP dan metadata hash/ukuran, tanpa memasukkan base64 ke text context.

Allowlist exact-origin memeriksa navigasi, redirect dan subresource melalui CDP interception. Ini tidak dipromosikan sebagai firewall OS/DNS pinning atau universal SSRF protection. Masking screenshot top-level editable fields dan redaksi pola umum tidak menjamin semua sensitive visible text/iframe terhapus; hanya gunakan fixture atau halaman yang diotorisasi. Trace summary bounded bukan laporan Lighthouse/core web vitals lengkap. Advanced capability matrix membedakan PASS/PARTIAL/NOT IMPLEMENTED/NOT TESTED; inventory reference lengkap tidak berarti implementation parity.

Standalone CLI: `node scripts/afyx-browser-devtools.mjs --help`. URL memerlukan `--allow-origin` eksplisit. Jangan menonaktifkan sandbox Chrome sebagai workaround.

## Dokumen

Kontrak `AfyxDocument/v1`: `convertDocument(input, policy)`, `inspectDocument(input, policy)`, `listSupportedFormats()`. Input berupa path, bytes atau asynchronous byte stream; `policy.workspaceRoot` diperlukan untuk file. Policy trusted terpisah dan limits hanya dapat diturunkan. Output meliputi status, Markdown deterministik, metadata aktual, referensi sumber, SHA-256 byte asli, diagnostic dan penanda untrusted. Tidak ada writes, network, macros, upstream engine, plugin, OCR atau transcription otomatis.

Implementasi: TXT/Markdown, HTML, CSV, JSON, XML, safe ZIP inventory/text subset, dan subset DOCX/XLSX/PPTX. Parser ZIP/XML asli memakai Node built-ins; tidak mengeksekusi Office atau script. PDF/EPUB/legacy Office/email/OCR/audio/remote services yang belum didukung harus melaporkan UNSUPPORTED, bukan output kosong yang diklaim sukses. Format terperinci dan fidelity limits tercantum pada matriks.

Batas default: input 8 MiB, total inflate 32 MiB, 128 archive entries, entry 8 MiB, output 2 MiB, deadline 3 detik, worker old-generation heap 96 MiB. Heap worker adalah batas V8, bukan janji batas total RSS proses; worker/native buffers dan runtime memiliki overhead. Worker dihentikan setelah selesai atau melewati deadline. Archives bertingkat/executables/macros/ZIP slip/encryption/CRC mismatch ditolak; DTD/external entities tidak diaktifkan.

Standalone CLI: `node scripts/afyx-document-intelligence.mjs --help`. Tidak memasang MarkItDown atau menjalankan `python -m markitdown`.

## Boundary Context

Catalog `createDocumentationCatalog` tetap memiliki registry, search/filter, cache, hash validation, budgeting dan recovery. Untuk source `convert: true`, trusted host memberikan `documentConversion: {contract, maxOutputBytes, convert}` dan memakai `searchAsync` / `retrieveAsync`. Callback menerima bytes/name yang sudah dibaca dengan admission Context, lalu menjalankan converter standalone. Context tidak mengimpor decoder, network client atau plugin.

Cache hanya in-memory, bounded dan keyed kontrak + source hash + path. Valid content-addressed result dipakai ulang; source diperiksa kembali setelah konversi. Recovery memakai source ID dan SHA asli sehingga perubahan file menghasilkan stale-reference error, bukan konten yang diam-diam diganti. Path tetap membedakan metadata/referensi alias. Tidak ada global indexing/persistence atau konversi eager. API sinkron untuk dokumen teks existing tetap berlaku; source konversi yang belum disiapkan dilaporkan CONVERSION_REQUIRED agar consumer memakai boundary async yang tepat.

## Independensi, QA dan release

Referensi Chrome DevTools MCP Apache-2.0 dan MarkItDown MIT hanya dibaca dalam REA di luar produksi. Revisi arsip dipulihkan dari GitHub ZIP comment dan berkas review dicocokkan ke extraction. Matriks dan ledger memuat bukti desain, hash, sumber kebutuhan, dependency runtime dan batas similarity review; hash berbeda atau nol overlap baris bukan bukti tunggal authorship. Tidak ada source REA, archive reference atau dependency upstream disertakan dalam npm/ZIP produksi. Lisensi runtime Node dan installed browser tetap berlaku; tidak ada klaim bebas semua external license obligations.

Gate source, security, lifecycle, Context, MCP installed, source ownership, residual audit, normal pre-push dan exact-SHA CI tetap wajib. Direct CDP tests, simulated JSON-RPC MCP, real-agent workflows, installer OS dan public release adalah acceptance berbeda. Alpha.8 dan tag existing tidak diubah. Tidak ada Alpha.9/npm publication atau auto-merge yang diotorisasi.

## Koreksi portability setelah kandidat awal

Browser membuat profil pada canonical temporary parent; alias sistem seperti macOS /var menuju /private/var tidak lagi menghasilkan ownership mismatch saat cleanup. Guard terhadap perubahan profil menjadi symlink tetap aktif. Converter memeriksa symlink dari file sampai root workspace trusted (termasuk root), kemudian canonical containment dan identitas handle; alias di atas root yang diotorisasi host tidak menjadi alasan menolak dokumen yang sah. Root symlink dan symlink descendant tetap ditolak. Tes HTTP browser juga selalu menutup server fixture bila cleanup gagal, tanpa menyembunyikan exception asli.

Bukti real Codex lengkap berasal dari kandidat 4e5997b sebelum dua koreksi alias ini. API MCP dan fungsi engineering tetap sama; perubahan mekanik path/cleanup berikutnya diuji langsung dan melalui CI source final. Jangan mengklaim bahwa sesi agent lama menggunakan SHA final yang berbeda.
