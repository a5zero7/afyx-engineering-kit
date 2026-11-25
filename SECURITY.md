# Kebijakan Keamanan AFYX

Copyright (c) 2026 Afyx

## Dukungan dan pelaporan

Perbaikan keamanan ditujukan untuk rilis stabil terbaru dan jalur pengembangan aktif `1.2.0`. Kirim temuan secara privat dengan versi, platform, dampak, dan langkah reproduksi minimal yang telah disanitasi. [Rilis AFYX](https://github.com/a5zero7/afyx-engineering-kit/releases) · [GitHub Private Vulnerability Reporting](https://github.com/a5zero7/afyx-engineering-kit/security/advisories/new)

## Batas akses

- AFYX memproses sumber dan indeks secara lokal. Keluaran MCP dapat memuat data dari repositori. Perlakukan data tersebut sebagai bukti teknis dan gunakan izin baca yang sesuai.
- Graph mempertahankan daftar peer eksplisit sebagai pilihan utama. Host MCP dapat mengizinkan discovery dengan `AFYX_GRAPH_PEER_DISCOVERY_ROOT` yang menunjuk root proyek atau induk langsung. Daftar peer kosong tetap kosong kecuali pemanggil meminta penggabungan melalui `autoDiscoverPeers: true`. Gunakan root yang seluruh ruang lingkupnya sudah diizinkan.
- Discovery memeriksa manifest dan indikator proyek secara terbatas. Node, pnpm, Go, dan Cargo mendukung deklarasi statis dan wildcard satu segmen di akhir. Kandidat harus memiliki indeks yang sudah ada dan segar serta binding kontrak eksplisit. AFYX hanya membuka indeks peer secara baca-saja.
- Instalasi mengubah entri konfigurasi yang dikelola AFYX dan mempertahankan entri milik pengguna atau alat lain. Gunakan lingkup workspace untuk percobaan terisolasi.

## Inspeksi database

SQLite, CSV, dan JSON tetap dibaca dari workspace. PostgreSQL dan MySQL memakai klien native `psql` dan `mysql` dengan konfigurasi eksplisit. Batasi host dalam `allowedHosts`, sediakan role dengan hak baca minimum, dan gunakan `live: true`, `authorized: true`, serta `readOnlyRole: true` hanya setelah administrator memverifikasi role. Untuk query dan EXPLAIN, `approvedRelations` harus berisi tabel yang sudah ditinjau, termasuk kebijakan row-level, tipe, dan ekstensi server. Operator bertanggung jawab menetapkan izin database.

Adapter memverifikasi identitas TLS. MySQL memerlukan `tlsCaFile`; PostgreSQL memakai trust store sistem pada versi libpq yang mendukungnya atau CA yang diberikan. Startup klien dan prompt autentikasi dinonaktifkan. Kredensial yang diberikan secara eksplisit diteruskan hanya melalui environment proses anak. Batasi akses ke akun OS yang menjalankan AFYX karena akun dengan izin inspeksi proses dapat membaca environment. Output berisi metadata terbatas dan kode kegagalan tersanitasi.

Operasi live mendukung katalog tabel dan kolom, proyeksi kolom sederhana dari satu tabel yang disetujui, dan EXPLAIN tanpa eksekusi. Proyeksi melaporkan jumlah baris dalam sampel terbatas. EXPLAIN mengembalikan jenis akses yang dikenali dan estimasi jumlah baris, tanpa menyalin kondisi atau data mentah dari server. Transaksi baca-saja dan timeout menjadi lapisan tambahan setelah validasi operasi. Koneksi live memerlukan otorisasi terpisah dari inspeksi lokal.

## Cleanup sementara

`afyx clean --dry-run --json` mempratinjau pembersihan artefak sementara. Retensi minimum enam jam berlaku di root kanonik `os.tmpdir()`. Pada Windows, root harus berada di dalam profil pengguna OS. Untuk saat ini, hanya spill CLI yang selesai dengan receipt AFYX, digest dan identitas payload yang cocok, serta proses pembuat yang sudah berakhir yang dapat dibersihkan. Receipt memakai batas kepercayaan akun lokal. Direktori dengan file tambahan, link, atau kepemilikan yang meragukan dilewati. Pemeriksaan ulang identitas dilakukan sebelum penghapusan.

## Integritas dan provenance paket

Installer Graph memeriksa checksum, isi arsip, dan identitas manifest. Attestation menambahkan verifikasi kriptografis oleh GitHub CLI dan mengikat subjek SHA-256, repo, SHA sumber, dan workflow rilis Graph. `--verify-attestation` pada instalasi atau update mewajibkan bukti untuk artefak Graph yang dipasang. `AFYX_GRAPH_ATTESTATION_MODE=optional` memungkinkan verifikasi opsional. Jika mode opsional dijalankan offline atau klien tidak tersedia, hasil menyatakan alasan skip dan pemeriksaan integritas tetap berlaku. Kegagalan verifikasi yang sudah dicoba menghentikan pemasangan Graph. Attestation wajib memerlukan verifikasi yang tersedia dan berhasil.
