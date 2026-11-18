# MB18 — Inventaris Browser reference dan delta native

Inventaris lengkap source: **58 tool factories unik dalam 13 kategori**, termasuk 3 slim tools dan kategori eksperimental. Ini bukan klaim 58 implementasi AFYX.

Package reference: 1.13.0; upstream Git revision arsip: `ec0abfc80568b9585299d739debb8869fabd710f` dari ZIP comment, diverifikasi exact-byte 27 source/member yang direview. Tidak ada .git dalam extraction. Fingerprint tool source: `c649c125cdb4a04b4a159d646330e21ece68b860dc134b3c07a7b55415cc0343`. License Apache-2.0; source eksternal hanya dibaca, tidak disalin ke produk.

| Kategori source | Jumlah |
|---|---|
| DEBUGGING | 16 |
| EMULATION | 2 |
| EXTENSIONS | 5 |
| INPUT | 10 |
| MEMORY | 1 |
| NAVIGATION | 8 |
| NETWORK | 2 |
| NETWORK_MOCKS | 2 |
| PERFORMANCE | 3 |
| PWA | 4 |
| THIRD_PARTY | 2 |
| WEBAUTHN | 1 |
| WEBMCP | 2 |

| Reference capability | Kontrak fungsional | AFYX native | Status | Bukti/batas |
|---|---|---|---|---|
| `open_devtools` | Buka antarmuka DevTools | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `get_devtools_comments` | Baca komentar kolaborasi DevTools | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `resolve_devtools_comment` | Tandai komentar selesai | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `reveal_in_devtools` | Sorot objek pada DevTools | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `list_console_messages` | Console log/error metadata tanpa object/header mentah | `getConsoleMessages` | PASS | buffer/redaction test; live fixture; Session/profile owned, exact-origin network, bounded output |
| `get_console_message` | Detail satu console message | `getConsoleMessages bounded list` | PARTIAL | detail by persistent message ID belum tersedia; Session/profile owned, exact-origin network, bounded output |
| `get_css_styles` | Style elemen termasuk computed dan authored CSS | `getComputedStyles` | PARTIAL | computed color live; authored styles belum; Session/profile owned, exact-origin network, bounded output |
| `emulate` | Emulasi perangkat, viewport dan jaringan | `emulate` | PARTIAL | viewport/offline native; geolocation/CPU/network presets belum; Session/profile owned, exact-origin network, bounded output |
| `install_extension` | Pasang extension browser | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `uninstall_extension` | Hapus extension browser | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `list_extensions` | Daftar extension | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `reload_extension` | Muat ulang extension | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `trigger_extension_action` | Jalankan action extension | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `click` | Klik elemen terpilih | `click(selector)` | PASS | live Apply+dialog; missing-element negative; Session/profile owned, exact-origin network, bounded output |
| `click_at` | Klik koordinat halaman | `clickAt(x,y)` | NOT TESTED | implementasi validasi koordinat; belum live tersendiri; Session/profile owned, exact-origin network, bounded output |
| `hover` | Gerakkan pointer ke elemen | `hover(selector)` | PASS | live fixture; Session/profile owned, exact-origin network, bounded output |
| `fill` | Isi input termasuk berbagai kontrol form | `typeText(selector,text)` | PARTIAL | input teks live; select/checkbox belum; Session/profile owned, exact-origin network, bounded output |
| `type_text` | Ketik teks pada target/fokus | `typeText(selector,text)` | PARTIAL | target selector wajib; teks live; Session/profile owned, exact-origin network, bounded output |
| `drag` | Drag elemen ke target | `drag(from,to)` | PARTIAL | pointer drag implemented; HTML5 DataTransfer dan live test belum; Session/profile owned, exact-origin network, bounded output |
| `fill_form` | Isi kumpulan elemen form | `fillForm(fields)` | PARTIAL | teks live; non-atomic dan kontrol kompleks belum; Session/profile owned, exact-origin network, bounded output |
| `upload_file` | Upload berkas berizin ke input | `uploadFile(selector,path)` | PASS | live fixture; root confinement negative; Session/profile owned, exact-origin network, bounded output |
| `press_key` | Kombinasi tombol browser | `pressKey(key)` | PARTIAL | Tab live; enum navigasi dasar, modifiers belum; Session/profile owned, exact-origin network, bounded output |
| `lighthouse_audit` | Audit Lighthouse | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `set_logpoints` | Kelola debugger logpoint | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `take_heapsnapshot` | Heap snapshot memori | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `list_network_requests` | Daftar request/response dan kegagalan | `getNetworkRequests` | PASS | live status/failure/filter; bounded and redacted; Session/profile owned, exact-origin network, bounded output |
| `get_network_request` | Detail request dan response | `getNetworkRequest` | PARTIAL | metadata live; bodies/credentials sengaja tidak diekspos; Session/profile owned, exact-origin network, bounded output |
| `mock_network` | Ubah/mock respons jaringan | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `remove_network_mock` | Hapus mock jaringan | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `list_pages` | Inventaris halaman session | `listPages` | PASS | live multi-page and ownership negative; Session/profile owned, exact-origin network, bounded output |
| `select_page` | Pilih halaman aktif | `selectPage` | PASS | live; foreign-session page rejected; Session/profile owned, exact-origin network, bounded output |
| `close_page` | Tutup halaman | `closePage` | PASS | live second-page teardown; Session/profile owned, exact-origin network, bounded output |
| `new_page` | Buat halaman baru | `newPage` | PASS | live owned page; default about:blank; Session/profile owned, exact-origin network, bounded output |
| `navigate_page` | Navigasi URL/history/reload dan wait | `navigate` | PARTIAL | URL+load wait live; history/reload belum; Session/profile owned, exact-origin network, bounded output |
| `resize_page` | Ubah ukuran viewport | `emulate` | PASS | live 640x480; Session/profile owned, exact-origin network, bounded output |
| `handle_dialog` | Respons alert/confirm/prompt | `handleDialog` | PARTIAL | alert live; confirm/prompt source only; Session/profile owned, exact-origin network, bounded output |
| `get_tab_id` | Ambil extension tab ID | `listPages pageId` | PARTIAL | ID target CDP tersedia; bukan extension tab ID; Session/profile owned, exact-origin network, bounded output |
| `performance_start_trace` | Mulai CDP trace | `traceStart` | PASS | live recording; duplicate-start negative; Session/profile owned, exact-origin network, bounded output |
| `performance_stop_trace` | Hentikan dan kumpulkan trace | `traceStop/exportTrace` | PASS | live events+exclusive bounded export; Session/profile owned, exact-origin network, bounded output |
| `performance_analyze_insight` | Analisis insight kinerja | `traceStop analysis/performanceMetrics/resourceTiming` | PARTIAL | long-task count and metrics live; LCP/CLS/insight engine belum; Session/profile owned, exact-origin network, bounded output |
| `install_pwa` | Pasang PWA | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `uninstall_pwa` | Hapus PWA | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `launch_pwa` | Jalankan PWA | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `get_os_app_state` | Status aplikasi OS | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `screencast_start` | Mulai screencast | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `screencast_stop` | Hentikan screencast | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `take_screenshot` | Capture gambar halaman | `takeScreenshot` | PASS | live base64 bounded; editable fields masked; Session/profile owned, exact-origin network, bounded output |
| `evaluate_script` | JavaScript dalam halaman | `evaluate` | PASS | live arithmetic/task; host-authorization negative; Session/profile owned, exact-origin network, bounded output |
| `screenshot` | Slim screenshot | `takeScreenshot` | PARTIAL | same native API viewport capture; slim CLI semantics tidak disamakan; Session/profile owned, exact-origin network, bounded output |
| `navigate` | Slim navigation | `navigate` | PARTIAL | same native API URL; upstream slim protocol berbeda; Session/profile owned, exact-origin network, bounded output |
| `evaluate` | Slim evaluation | `evaluate` | PARTIAL | same native API host gated; slim protocol berbeda; Session/profile owned, exact-origin network, bounded output |
| `take_snapshot` | Snapshot struktur accessibility/DOM | `snapshot/findElements/inspectPage` | PARTIAL | live AX depth8/max200 and CSS discovery; full DOM serialized tree belum; Session/profile owned, exact-origin network, bounded output |
| `wait_for` | Menunggu kondisi halaman | `waitFor` | PARTIAL | CSS element live+timeout; composite text/navigation conditions belum; Session/profile owned, exact-origin network, bounded output |
| `list_3p_developer_tools` | Discover tool developer pihak ketiga | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `execute_3p_developer_tool` | Jalankan tool pihak ketiga | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `configure_webauthn` | Konfigurasi authenticator virtual | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `list_webmcp_tools` | Discover tool WebMCP halaman | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |
| `execute_webmcp_tool` | Jalankan tool WebMCP halaman | `—` | NOT IMPLEMENTED | Tidak dieksekusi; bukan bagian parity yang diterima; Berpotensi mengubah trust boundary, data sensitif atau OS; perlu kontrak izin terpisah |

## Batas evidence

Skenario live memakai profil disposable dan halaman fixture HTTP eksplisit. Dua origin loopback dengan port berbeda membuktikan penolakan subresource dan redirect: origin terlarang menerima 0 request. Tidak ada bukti bahwa semua jalur egress Chromium/OS telah disandbox: host-approved origin dapat berubah DNS, aplikasi dapat mem-proxy request, dan browser vendor tetap memiliki perilaku background sendiri. Exact-origin authorization adalah boundary kebijakan aplikasi, bukan firewall OS atau klaim universal SSRF defense.

Console redaction menyaring pola kredensial umum; query/userinfo URL dan semua raw headers/bodies dihilangkan. Visible page text, custom secret encodings, dan gambar dapat tetap sensitif. Screenshots menyembunyikan editable fields pada dokumen utama; bukan jaminan masking semua frame/pixel. Eval hanya dengan explicit trusted host permission, dan output eval tetap data halaman tidak tepercaya.

Trace dibatasi 10 detik dan 2MB events (host dapat menurunkan), args event tidak dikembalikan. Perf analysis hanya long-task counts/metrics/timing nyata, bukan substitusi Lighthouse atau insight upstream. No heap/extension/PWA/WebAuthn/third-party/WebMCP execution didukung pada batch ini.

Kebenaran model dan penggunaan hasil oleh Codex/Antigravity belum diuji workstream A; parent melakukan real-agent acceptance terpisah.
