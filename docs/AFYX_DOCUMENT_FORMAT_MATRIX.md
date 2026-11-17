# MB18 B — REA dokumen dan ledger sumber asli

## Identitas dan batas pemeriksaan

Referensi read-only: `.rea_source/markitdown-main`, proyek `microsoft/markitdown`, lisensi MIT, copyright Microsoft Corporation. Revision referensi dari komentar GitHub source ZIP: **`ed178952a6672abdfd35b5f9e76a80b6cefc086e`**. Tiga puluh hash berkas yang direview cocok dengan anggota arsip. Tidak tersedia riwayat `.git` referensi atau verifikasi signature upstream; identitas revision bersumber dari metadata archive, bukan HEAD AFYX atau asumsi latest upstream.

Arsip lokal `markitdown-main.zip` SHA-256:
`dabb65262621992211de980732a255298dfb776f162e51f8c7c7163c52b8409b`.

`document-reference-fingerprint.json` mencatat hash 30 entri sumber, termasuk LICENSE, README, pyproject, public result/converter contracts, dispatcher, converter exports dan seluruh berkas converter, beserta parity archive/extracted 30/30. Hash bukan bukti tunggal independent authorship; ledger ini merekam batas desain dan bahan yang benar-benar dipakai. Source tree referensi tidak diedit, dijalankan, dipasang atau disalin ke produk AFYX.

## Arsitektur yang diamati

Referensi Python >=3.10,<3.15 menerima local file, binary stream, URL, URI dan response; memadukan extension/MIME/sniffing serta stream metadata, lalu mencoba converter terdaftar menurut prioritas spesifik/generik. Public result mengandung Markdown dan optional title; `text_content` merupakan alias legacy. Built-in converter dan plugin/optional services terpisah; kemampuan URL memakai HTTP, OCR/vision/transcription dapat memakai layanan luar. Security/privacy referensi tidak otomatis menjadi jaminan AFYX.

Dependensi dasar yang dideklarasikan pyproject: beautifulsoup4, requests, certifi, markdownify, magika, charset-normalizer, defusedxml. Optional: python-pptx, mammoth, pandas, openpyxl, xlrd, lxml, pdfminer.six, pdfplumber, olefile, pydub, SpeechRecognition, youtube-transcript-api, Azure Document Intelligence/Content Understanding/Identity. Plugin OCR memakai LLM vision. Tidak satu pun dipasang atau dipakai sebagai hidden production engine AFYX pada batch ini.

Unit tests referensi mencakup sample documents, converter behavior, CLI/plugin dan optional document-intelligence; inventory berkas tes dicatat di fingerprint. Suite referensi tidak dijalankan karena bukan validasi engine AFYX dan memerlukan optional dependencies/services. Algoritme internal converter referensi tidak diport; pemeriksaan berfokus pada public contracts, format inventory, dependencies, license dan boundary behavior.

## Matriks lengkap public converter reference (20 ekspor)

| Reference converter / sumber | Kontrak fungsional | AFYX native MB18 | Status / batas |
|---|---|---|---|
| PlainTextConverter | teks termasuk representasi JSON/XML | TXT/MD UTF-8/UTF-16 BOM; JSON fenced canonical; XML fenced validated | PASS subset; encoding lain ditolak secara eksplisit |
| HtmlConverter | HTML menjadi struktur Markdown | tokenizer inert: heading/paragraph/list/table/link/code | PARTIAL; bukan DOM/CSS/renderer HTML penuh |
| CsvConverter | CSV tabular | state machine quoted fields/multiline, Markdown table | PASS bounded subset |
| DocxConverter | OOXML Word | ZIP/XML asli: heading style, paragraph, list marker, table, core metadata | PARTIAL; tanpa drawings/notes/formula/track-changes/pagination; hyperlink URL Word belum dipertahankan |
| XlsxConverter | OOXML spreadsheet | urutan workbook, nama sheet, sparse columns, shared/inline strings, boolean dan cached values | PARTIAL; tidak menghitung formula, date/style formatting atau chart |
| XlsConverter | legacy binary Excel | tidak ada decoder OLE/BIFF | NOT IMPLEMENTED; legacy XLS ditolak |
| PptxConverter | slide presentation | urutan relationship presentation, paragraph text, core metadata | PARTIAL; tanpa drawing/chart/notes/layout |
| PdfConverter | PDF text/layout extraction | admission mendeteksi PDF lalu diagnostics eksplisit | NOT IMPLEMENTED; font maps, stream filters/encryption/OCR belum aman didukung |
| OutlookMsgConverter | Outlook MSG metadata/body/attachment | tidak ada OLE parser | NOT IMPLEMENTED; tidak membaca mailbox/profil pengguna |
| ZipConverter | archive contents | reader central/local header, CRC, stored/deflate, satu level supported text members | PARTIAL; ZIP64/multipart/encryption/non-UTF8 names/nested archive/executable ditolak; unsupported members dilaporkan |
| EpubConverter | publication navigation/content | belum membaca OPF/spine | NOT IMPLEMENTED; EPUB tidak disamakan dengan generic ZIP |
| IpynbConverter | notebook cells/outputs | belum membaca notebook semantic schema | NOT IMPLEMENTED; tidak mengeksekusi notebook |
| ImageConverter | metadata dan optional vision description | tidak ada image parser/vision | NOT IMPLEMENTED; tidak mengunggah gambar |
| AudioConverter | audio metadata dan optional transcription | tidak ada decoder/transcription | NOT IMPLEMENTED; tidak memakai mikrofon atau mengunggah audio |
| RssConverter | RSS/Atom feed | XML generic tervalidasi saja | NOT IMPLEMENTED untuk feed semantics; tidak mengklaim RSS parity |
| WikipediaConverter | specialized web article | HTML offline generic saja | NOT IMPLEMENTED untuk service/source-specific behavior |
| BingSerpConverter | specialized result page | HTML offline generic saja | NOT IMPLEMENTED untuk search integration |
| YouTubeConverter | URL dan transcript | tidak ada remote retrieval/transcription | NOT IMPLEMENTED; network default off |
| DocumentIntelligenceConverter | Azure hosted parsing | tidak ada adapter cloud | NOT IMPLEMENTED; default off |
| ContentUnderstandingConverter | Azure multimodal/structured extraction | tidak ada adapter cloud | NOT IMPLEMENTED; default off |

Tambahan kelompok yang diminta: YAML bukan public dedicated converter pada export reference yang direview; AFYX YAML **UNSUPPORTED** (tidak mengklaim structured YAML). Legacy DOC/PPT juga **NOT IMPLEMENTED**; tidak ada dedicated legacy DOC/PPT converter pada 20 ekspor itu. Email EML, arsip selain ZIP, OCR, video, plugins dan layanan AI tidak tersedia di AFYX MB18. Reference OCR plugin dapat melengkapi PDF/DOCX/XLSX/PPTX dengan vision; hal ini tidak diturunkan menjadi offline parity AFYX.

## Keputusan desain AFYX

Engine AFYX terdiri atas lima flat ESM modules agar dapat dibundel bridge yang sudah ada: `afyx-document-intelligence.mjs` (API, file/stream admission, CLI, worker deadline), `afyx-document-worker.mjs` (isolated execution), `afyx-document-archive.mjs` (ZIP admission/decompression), `afyx-document-xml.mjs` (bounded XML data tree), `afyx-document-formats.mjs` (native format transformations). Nama, pembagian tanggung jawab dan implementasi dibuat untuk kontrak AFYX; tidak mengikuti struktur satu-Python-class-per-reference-converter. Kontrak tersendiri `AfyxDocument/v1`, `source.sha256`, references dan `untrusted:true` tidak mengadopsi API MarkItDown.

Dependensi runtime baru: **tidak ada**. Node >=22.5 sesuai Kit; memakai builtin fs/path/crypto/worker_threads/zlib. Node/libuv/V8/zlib license obligations tetap mengikuti distribusi runtime yang sudah digunakan; tidak membundel salinan runtime atau library baru. ZIP header/CRC, OOXML parts dan Markdown merupakan standard format behavior; kemiripan material karena standar tidak dinyatakan sebagai salinan ekspresi sumber Microsoft. Tidak ada kode, komentar, sample fixtures, notices atau reference repository yang disalin ke payload AFYX. Jika kelak menyalin covered material, lisensi MIT mengharuskan copyright dan permission notice dipertahankan; ledger ini tidak menghapus kewajiban itu.

## Batas keamanan dan resource

File API membutuhkan root workspace **trusted policy** di argumen terpisah; task/document JSON tidak memberi otoritas. Traversal, symlink/junction, hardlink file, alternate data streams, special file dan perubahan file saat baca ditolak. lstat/realpath/fd read-back merupakan mitigasi; tidak ada klaim universal bahwa concurrent hostile filesystem replacement pada semua OS mustahil.

ZIP tidak diekstrak ke disk. CRC/local-central identity, path/collision/special-file/flags, executable/macro, compression ratio <=100, max entry count, input/expanded/output limits dan recursion0 diterapkan. XML menolak DTD/XXE, unknown entities, PI, malformed nesting dan depth>128; predefined/numeric entities hanya data. Tidak ada macro/formula execution, plugins, external fetch, credential access, telemetry, OCR/transcription atau activation dari isi dokumen. OOXML external relationships tidak diakses; metadata menghitung yang diabaikan.

Default: input8MiB, expanded32MiB, entry8MiB, entries128, output2MiB, time3s, worker V8 heap96MiB. Trusted caller hanya dapat memperkecil batas. Heap cap bukan OS RSS quota; buffers dibatasi admission/inflation. Worker deadline menghentikan parsing yang macet; stream timeout tidak menunggu hostile iterator cleanup. Markdown dan metadata tetap untrusted content, bukan agent instruction. Error codes tidak mengeluarkan stack/OS path/source snippets.

## Penerimaan dan batas klaim

Tes AFYX menggunakan fixture disposable asli buatan batch: teks Unicode, encodings, HTML/table/code/link, CSV multiline, JSON/XML, empty/corrupted inputs, ZIP stored/deflate, DOCX/XLSX/PPTX structures+metadata, signature/MIME mismatch, CRC/encryption/ZIP slip/bomb/nesting/macro, XXE/depth, links/path/readonly, output/time/memory-policy bounds, stream timeout dan recovery. Bukti: `document-focused-final.log`, `document-wsl-final.log`.

Post-review menemukan well-formed XML dengan root OOXML salah dapat menghasilkan empty SUCCEEDED; tiga negative fixture mereproduksi masalah. Root content-types/main document/worksheet/slide dan required Word body kini divalidasi. Commit awal `9540307739aa1df0a1da88e234564b30deb6bbfb`, koreksi `7d0dc49929679937fab68c689dee37b9e1c834a5`.

Windows Node26: **42/42 PASS**, 1479.4ms. WSL Ubuntu existing Node24: **42/42 PASS**, 4258.3ms. Biaya ini adalah focused-suite wall time, bukan benchmark throughput maupun agent efficiency. Tidak mengklaim full MarkItDown parity, formal legal clearance, actual installed provider acceptance, macOS real-host PASS atau public release. Parent mengintegrasikan registry/HostBridge/Context boundary dan manifest; Context tetap hanya selection/retrieval/budget/recovery/cache, bukan parser dokumen baru.
